/**
 * VMF to OBJ/MDL conversion handlers
 */

const { dialog } = require("electron")
const fs = require("fs")
const path = require("path")
const { packages } = require("../packageManager")
const { convertVmfToObj, convertVmfsToObj } = require("../utils/vmf2obj")
const { Instance } = require("../items/Instance")
const { fixInstancePath } = require("./instanceHandlers")
const { closeAllModelPreviewWindows } = require("../items/itemEditor")
const { instanceModel, keepMadeModels, findItem } = require("./iconHandlers")
const { logger } = require("../utils/logger")

/** "1 model", "3 models" */
const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`

/**
 * Helper to create directory with retry logic for EPERM errors
 */
async function mkdirWithRetry(dirPath, maxAttempts = 5) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true })
            }
            return true
        } catch (error) {
            if (error.code === "EPERM" || error.code === "EBUSY") {
                if (attempt < maxAttempts - 1) {
                    console.warn(`Could not create ${dirPath} (${error.code}), retrying in ${(attempt + 1) * 200} ms`)
                    await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 200))
                } else {
                    throw error
                }
            } else {
                throw error
            }
        }
    }
}

function register(ipcMain, mainWindow) {
    // VMF2OBJ conversion handler (direct)
    ipcMain.handle(
        "convert-vmf-to-obj",
        async (event, { vmfPath, outputDir }) => {
            try {
                const result = await convertVmfToObj(vmfPath, { outputDir })
                return { success: true, ...result }
            } catch (error) {
                const details = [
                    error.message,
                    error.stack && !error.userFacing ? `stack:\n${error.stack}` : null,
                    error.cmd ? `cmd: ${error.cmd}` : null,
                    error.cwd ? `cwd: ${error.cwd}` : null,
                ]
                    .filter(Boolean)
                    .join("\n")
                dialog.showErrorBox("VMF to OBJ Conversion Failed", details)
                return {
                    success: false,
                    error: error.message,
                    cmd: error.cmd,
                    cwd: error.cwd,
                }
            }
        },
    )

    // VMF2OBJ conversion by instance key (resolves VMF path server-side)
    ipcMain.handle(
        "convert-instance-to-obj",
        async (event, { itemId, instanceKey, options = {} }) => {
            try {
                const item = packages
                    .flatMap((p) => p.items)
                    .find((i) => i.id === itemId)
                const variant = options.isVariable
                    ? `${instanceKey} variants`
                    : `instance ${instanceKey}`
                return await logger.section(
                    `Model generation for "${item?.name ?? itemId}" (${variant})`,
                    () => convertInstance(event, item, instanceKey, options),
                )
            } catch (error) {
                const details = [
                    error.message,
                    error.stack && !error.userFacing ? `stack:\n${error.stack}` : null,
                    error.cmd ? `cmd: ${error.cmd}` : null,
                    error.cwd ? `cwd: ${error.cwd}` : null,
                ]
                    .filter(Boolean)
                    .join("\n")
                dialog.showErrorBox("VMF to OBJ Conversion Failed", details)
                return {
                    success: false,
                    error: error.message,
                    cmd: error.cmd,
                    cwd: error.cwd,
                }
            }
        },
    )

    // Make the item's model from the icon maker's model of one of its
    // instances (see iconHandlers.js), without converting the VMF again
    ipcMain.handle(
        "make-model-from-icon-model",
        async (event, { itemId, instanceKey }) => {
            try {
                const item = findItem(itemId)
                return await logger.section(
                    `Making the model of "${item.name}" from the icon maker's model (instance ${instanceKey})`,
                    () => convertIconModel(item, instanceKey),
                )
            } catch (error) {
                return { success: false, error: error.message }
            }
        },
    )
}

/**
 * Make the item's model from the icon maker's model of one of its instances:
 * the kept one, or made now when it's missing or out of date
 * @returns {Promise<Object>} { success, objPath, mtlPath, mdlResult } like
 *   Make Model's; not a success when no model was staged
 */
async function convertIconModel(item, instanceKey) {
    // Close any open model preview windows to release file handles
    await closeAllModelPreviewWindows()

    const { objPath, mtlPath, made } = await instanceModel(item, instanceKey)
    if (!made) console.log(`Using the model the icon maker made before: ${objPath}`)

    const mdlResult = await makeModel(item, objPath, {})
    if (!mdlResult.success || !mdlResult.stagedEditorItems) {
        return {
            success: false,
            error: mdlResult.error ?? "No model was made",
            objPath,
            mtlPath,
            mdlResult,
        }
    }
    return { success: true, objPath, mtlPath, mdlResult }
}

/**
 * Make Model for one item: the variants of a variable (one model each), or
 * one instance
 */
async function convertInstance(event, item, instanceKey, options) {
    // Close any open model preview windows to release file handles
    await closeAllModelPreviewWindows()

    if (!item) throw new Error("Item not found")

    // Models are made from the item's saved instances (the editor offers to
    // save the ones added since)
    if (!Object.values(item.instances ?? {}).some((i) => i?.Name)) {
        const error = new Error(
            `"${item.name}" has no saved instances to make a model from. Add an instance in the Instances tab and save the item.`,
        )
        error.userFacing = true
        throw error
    }

    // If this is a variable-based conversion, handle it differently
    if (options.isVariable) {
        return handleVariableConversion(event, item, instanceKey, options)
    }

    // --- Original single-instance conversion logic ---
    const instance = item.instances?.[instanceKey]
    if (!instance?.Name) throw new Error("Instance not found")

    const vmfPath = Instance.getCleanPath(item.packagePath, instance.Name)

    // Create persistent models directory for this item
    const itemName = item.id.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase()
    const modelsDir = path.join(item.packagePath, ".bpee", itemName, "models")
    await mkdirWithRetry(modelsDir)
    const tempDir = modelsDir // Use persistent location

    const result = await convertVmfToObj(vmfPath, {
        outputDir: tempDir,
        textureStyle: options.textureStyle || "cartoon",
    })

    const fileBase = path.basename(vmfPath, path.extname(vmfPath))
    const objPath = path.join(tempDir, `${fileBase}.obj`)
    const mtlPath = path.join(tempDir, `${fileBase}.mtl`)
    // The icon maker uses it too
    keepMadeModels(
        item,
        [{ vmfPath, objPath, mtlPath }],
        options.textureStyle || "cartoon",
    )

    // Convert OBJ to MDL
    const mdlResult = await makeModel(item, objPath, options)

    return {
        success: true,
        vmfPath,
        tempDir,
        objPath,
        mtlPath,
        mdlResult,
        ...result,
    }
}

/**
 * Compile the item's OBJ to an MDL and stage it as the item's model (applied
 * when the item is saved)
 * @returns {Promise<Object>} convertAndInstallMDL's result with
 *   stagedEditorItems, or { success: false, error }
 */
async function makeModel(item, objPath, options) {
    let mdlResult
    try {
        const { convertAndInstallMDL } = require("../utils/mdlConverter")
        const itemName = item.id.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase()
        mdlResult = await convertAndInstallMDL(objPath, item.packagePath, itemName, {
            scale: options.scale || 1.0,
        })
    } catch (mdlError) {
        // Logged as the failed "Making ....mdl" step
        return { success: false, error: mdlError.message }
    }

    if (mdlResult.success && mdlResult.relativeModelPath) {
        try {
            const editorItems = item.getEditorItems()
            const subType = Array.isArray(editorItems.Item.Editor.SubType)
                ? editorItems.Item.Editor.SubType[0]
                : editorItems.Item.Editor.SubType

            if (!subType.Model) subType.Model = {}
            subType.Model.ModelName = mdlResult.relativeModelPath

            if (!Array.isArray(editorItems.Item.Editor.SubType)) {
                editorItems.Item.Editor.SubType = [subType]
            }

            mdlResult.stagedEditorItems = editorItems
            console.log("Staged as the item's model (applied on Save)")
        } catch (error) {
            console.error("Failed to set the new model in the item's editoritems:", error)
            return { success: false, error: error.message }
        }
    }
    return mdlResult
}

/**
 * Make Model for a variable: one model for each instance its values give,
 * as BEE2's conditions give them (see variableValueInstances)
 */
async function handleVariableConversion(event, item, instanceKey, options) {
    // Handle DEFAULT or "First Instance"
    const normalizedKey = String(instanceKey).toUpperCase()
    if (normalizedKey === "DEFAULT" || normalizedKey === "FIRST INSTANCE") {
        return handleDefaultConversion(event, item, options)
    }

    const { variableValueInstances } = require("../utils/mdlConverter")
    const plan = variableValueInstances(item, instanceKey)

    // What the conditions give each value
    const byFile = new Map()
    for (const { value, file } of plan.values) {
        const key = file ?? "(no instance)"
        if (!byFile.has(key)) byFile.set(key, [])
        byFile.get(key).push(value)
    }
    for (const [file, values] of byFile) {
        console.log(`${plan.property} ${values.join(", ")}: ${file}`)
    }
    const uncertain = plan.values.filter((v) => v.uncertain)
    if (uncertain.length > 0) {
        console.warn(
            `Conditions that test things BeePEE can't know (like style settings) can change the instance of ${plan.property} ${uncertain.map((v) => v.value).join(", ")}: their models may not be the ones BEE2 shows`,
        )
    }

    const finalInstanceMap = new Map(
        plan.values.filter((v) => v.file).map((v) => [v.value, v.file]),
    )
    if (finalInstanceMap.size === 0) {
        dialog.showMessageBox({
            type: "warning",
            title: "No Instances Found",
            message: `No instances found for variable "${instanceKey}".`,
            detail: "The item's VBSP conditions remove its instance for every value.",
        })
        return { success: false, error: `No instances found for variable "${instanceKey}"` }
    }

    return handleAtlasConversion(event, item, plan, finalInstanceMap, options)
}

/**
 * Handle DEFAULT/First Instance conversion
 */
async function handleDefaultConversion(event, item, options) {

    const instanceKeys = Object.keys(item.instances).sort(
        (a, b) => parseInt(a, 10) - parseInt(b, 10),
    )
    const firstKey = instanceKeys[0]
    const firstInstance = firstKey ? item.instances[firstKey] : null

    if (!firstInstance?.Name) {
        throw new Error("No instances available for DEFAULT generation")
    }

    const vmfPath = Instance.getCleanPath(item.packagePath, firstInstance.Name)

    // Create persistent models directory for this item
    const itemName = item.id.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase()
    const modelsDir = path.join(item.packagePath, ".bpee", itemName, "models")
    await mkdirWithRetry(modelsDir)
    const tempDir = modelsDir // Use persistent location

    const result = await convertVmfToObj(vmfPath, {
        outputDir: tempDir,
        textureStyle: options.textureStyle || "cartoon",
    })

    const fileBase = path.basename(vmfPath, path.extname(vmfPath))
    const objPath = path.join(tempDir, `${fileBase}.obj`)
    const mtlPath = path.join(tempDir, `${fileBase}.mtl`)
    // The icon maker uses it too
    keepMadeModels(
        item,
        [{ vmfPath, objPath, mtlPath }],
        options.textureStyle || "cartoon",
    )

    const mdlResult = await makeModel(item, objPath, options)

    return {
        success: true,
        vmfPath,
        tempDir,
        objPath,
        mtlPath,
        mdlResult,
        ...result,
    }
}

/**
 * Handle multi-model conversion: one model per unique instance
 */
async function handleAtlasConversion(event, item, plan, finalInstanceMap, options) {
    const instanceKey = plan.property

    const uniqueInstances = [...new Set(finalInstanceMap.values())]
    console.log(
        `${plural(finalInstanceMap.size, "value")} of ${instanceKey} use ${plural(uniqueInstances.length, "instance")}`,
    )

    // Create persistent models directory for this item
    const itemName = item.id.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase()
    const modelsDir = path.join(item.packagePath, ".bpee", itemName, "models")
    await mkdirWithRetry(modelsDir)
    const tempDir = modelsDir // Use persistent location

    const vmfFiles = []
    for (const instancePath of uniqueInstances) {
        const vmfPath = Instance.getCleanPath(item.packagePath, instancePath)

        if (!fs.existsSync(vmfPath)) {
            console.warn(`Instance file not found: ${vmfPath}`)
            continue
        }

        vmfFiles.push({
            path: vmfPath,
            instancePath,
        })
    }

    if (vmfFiles.length === 0) {
        return { success: false, error: "No valid VMF files found" }
    }

    event.sender.send("conversion-progress", {
        stage: "vmf2obj",
        message: `Converting ${vmfFiles.length} models to OBJ...`,
    })

    // Each instance is converted on its own (sharing one converter session),
    // so brushes, brush entities and props all stay in their own model
    const objResults = await convertVmfsToObj(
        vmfFiles.map((file, index) => ({
            vmfPath: file.path,
            outputName: `${itemName}_${index}`,
        })),
        {
            outputDir: tempDir,
            textureStyle: options.textureStyle || "cartoon",
            timeoutMs: 600000,
        },
    )

    // The icon maker uses them too
    keepMadeModels(
        item,
        objResults.filter((result) => !result.error),
        options.textureStyle || "cartoon",
    )

    const variantResults = []
    const objFailures = []
    objResults.forEach((result, index) => {
        const { instancePath } = vmfFiles[index]
        if (result.error) {
            objFailures.push({ instancePath, error: result.error })
        } else {
            variantResults.push({ name: result.outputName, objPath: result.objPath, instancePath })
        }
    })

    // Convert materials once (shared)
    const { convertMaterialsToPackage } = require("../utils/mdlConverter")
    const materialsSourceDir = path.join(tempDir, "materials")
    const sharedFolderName = item.id.toLowerCase()

    const sharedMaterialsPath = path.join(
        item.packagePath,
        ".bpee",
        "materials",
        "models",
        "props_map_editor",
        "bpee",
        sharedFolderName,
    )

    await convertMaterialsToPackage(
        materialsSourceDir,
        sharedMaterialsPath,
        tempDir,
        sharedFolderName,
    )

    // Convert each variant OBJ to MDL
    event.sender.send("conversion-progress", {
        stage: "mdl",
        message: `Converting ${variantResults.length} models to MDL format...`,
    })

    const compileModel = async (variant) => {
        const { instancePath } = variant

        try {
            const { convertAndInstallMDL } = require("../utils/mdlConverter")
            const mdlResult = await convertAndInstallMDL(
                variant.objPath,
                item.packagePath,
                variant.name,
                {
                    scale: options.scale || 1.0,
                    skipMaterialConversion: true,
                    sharedMaterialsPath: sharedMaterialsPath,
                    sharedModelFolder: sharedFolderName,
                    // Compiled alongside the other variants
                    logBuffered: true,
                },
            )

            return {
                instancePath,
                modelPath: mdlResult.relativeModelPath,
                value: instancePath,
            }
        } catch (error) {
            // Logged as the variant's failed "Making ....mdl" step
            return { instancePath, error: error.message }
        }
    }

    const compiled = await logger.section(
        `Compiling ${plural(variantResults.length, "model")}`,
        () => Promise.all(variantResults.map(compileModel)),
    )
    const conversionResults = [...objFailures, ...compiled]

    const successfulResults = conversionResults.filter((r) => r.modelPath)
    const failedResults = conversionResults.filter((r) => r.error)

    if (successfulResults.length === 0) {
        console.error(`None of the ${plural(conversionResults.length, "model")} could be made`)
        dialog.showMessageBox({
            type: "error",
            title: "All Conversions Failed",
            message: "No models could be generated.",
            detail: failedResults
                .map((r) => `${path.basename(r.instancePath)}: ${r.error}`)
                .join("\n"),
        })
        return { success: false, results: conversionResults }
    }

    // Update editoritems.json with new SubType structure
    const editorItems = item.getEditorItems()

    if (!Array.isArray(editorItems.Item.Editor.SubType)) {
        editorItems.Item.Editor.SubType = [editorItems.Item.Editor.SubType]
    }

    const baseSubType = JSON.parse(JSON.stringify(editorItems.Item.Editor.SubType[0]))

    // The property that picks the SubType
    editorItems.Item.Editor.SubTypeProperty = plan.property

    const newSubTypes = buildSubTypes(
        baseSubType,
        plan,
        finalInstanceMap,
        conversionResults,
    )

    editorItems.Item.Editor.SubType = newSubTypes
    // A warning when some models couldn't be made (their steps say why)
    const summarize = failedResults.length > 0 ? console.warn : console.log
    summarize(
        `Made ${successfulResults.length} of ${plural(conversionResults.length, "model")}, staged as ${plural(newSubTypes.length, "subtype")} (applied on Save)`,
    )

    // Say which models couldn't be made (when all were, the item editor says
    // so itself and opens their preview)
    if (failedResults.length > 0) {
        const failureDetail = failedResults
            .map((r) => `• ${path.basename(r.instancePath)}: ${r.error}`)
            .join("\n")
        dialog.showMessageBox({
            type: "warning",
            title: "Multi-Model Generation Complete",
            message: `Successfully converted ${successfulResults.length} of ${conversionResults.length} models.`,
            detail: `Click Save in the editor to apply ${newSubTypes.length} SubTypes to editoritems.json.\n\nNot generated:\n${failureDetail}`,
        })
    }

    return { success: true, results: conversionResults, stagedEditorItems: editorItems }
}

/**
 * The item's SubTypes, one for each value of the variable, in order (the
 * editor shows SubType N for value N): each with the model of its value's
 * instance, or of the default value's when its instance has none
 */
function buildSubTypes(baseSubType, plan, finalInstanceMap, conversionResults) {
    const modelOf = (value) => {
        const instancePath = finalInstanceMap.get(value)
        const result = conversionResults.find(
            (r) => r.instancePath === instancePath,
        )
        return result?.modelPath ?? null
    }
    const defaultModel =
        modelOf(plan.defaultValue) ??
        conversionResults.find((r) => r.modelPath).modelPath

    return plan.values.map(({ value }, index) => {
        // The first keeps everything else the SubType had
        const subType =
            index === 0
                ? JSON.parse(JSON.stringify(baseSubType))
                : { Name: baseSubType.Name, Model: {} }
        if (index > 0 && baseSubType.Sounds) {
            subType.Sounds = JSON.parse(JSON.stringify(baseSubType.Sounds))
        }
        if (index > 0 && baseSubType.Animations) {
            subType.Animations = JSON.parse(
                JSON.stringify(baseSubType.Animations),
            )
        }
        if (!subType.Model) subType.Model = {}
        subType.Model.ModelName = modelOf(value) ?? defaultModel
        subType.Name = baseSubType.Name
        return subType
    })
}

module.exports = { register, buildSubTypes }
