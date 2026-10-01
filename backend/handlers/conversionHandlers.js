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
                    console.warn(`mkdir attempt ${attempt + 1} failed (${error.code}), retrying in ${(attempt + 1) * 200}ms...`)
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
                    error.stack ? `stack:\n${error.stack}` : null,
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
                // Close any open model preview windows to release file handles
                await closeAllModelPreviewWindows()

                const item = packages
                    .flatMap((p) => p.items)
                    .find((i) => i.id === itemId)
                if (!item) throw new Error("Item not found")

                // If this is a variable-based conversion, handle it differently
                if (options.isVariable) {
                    return handleVariableConversion(event, item, instanceKey, options)
                }

                // --- Original single-instance conversion logic ---
                const instance = item.instances?.[instanceKey]
                if (!instance?.Name) throw new Error("Instance not found")

                const vmfPath = Instance.getCleanPath(
                    item.packagePath,
                    instance.Name,
                )

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

                // Convert OBJ to MDL
                let mdlResult = null
                try {
                        const { convertAndInstallMDL } = require("../utils/mdlConverter")

                    const itemName = item.id
                        .replace(/[^a-zA-Z0-9_-]/g, "_")
                        .toLowerCase()

                    mdlResult = await convertAndInstallMDL(
                        objPath,
                        item.packagePath,
                        itemName,
                        { scale: options.scale || 1.0 },
                    )

                    if (mdlResult.success && mdlResult.relativeModelPath) {
                        const editorItems = item.getEditorItems()
                        const subType = Array.isArray(editorItems.Item.Editor.SubType)
                            ? editorItems.Item.Editor.SubType[0]
                            : editorItems.Item.Editor.SubType

                        if (!subType.Model) {
                            subType.Model = {}
                        }
                        subType.Model.ModelName = mdlResult.relativeModelPath

                        if (!Array.isArray(editorItems.Item.Editor.SubType)) {
                            editorItems.Item.Editor.SubType = [subType]
                        }

                        mdlResult.stagedEditorItems = editorItems
                    }
                } catch (mdlError) {
                    console.error("❌ MDL conversion failed:", mdlError)
                    mdlResult = {
                        success: false,
                        error: mdlError.message,
                    }
                }

                return {
                    success: true,
                    vmfPath,
                    tempDir,
                    objPath,
                    mtlPath,
                    mdlResult,
                    ...result,
                }
            } catch (error) {
                const details = [
                    error.message,
                    error.stack ? `stack:\n${error.stack}` : null,
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
}

/**
 * Handle variable-based model conversion (multiple instances)
 */
async function handleVariableConversion(event, item, instanceKey, options) {
    console.log(`🔄 Variable model conversion: "${item.name}" (${instanceKey})`)

    const { mapVariableValuesToInstances } = require("../utils/mdlConverter")
    const conditions = item.getConditions()

    const valueInstanceMap = mapVariableValuesToInstances(conditions, instanceKey, item)

    // Handle DEFAULT or "First Instance"
    const normalizedKey = String(instanceKey).toUpperCase()
    if (normalizedKey === "DEFAULT" || normalizedKey === "FIRST INSTANCE") {
        return handleDefaultConversion(event, item, options)
    }

    // Sort the map
    const sortedEntries = [...valueInstanceMap.entries()].sort(([valA], [valB]) => {
        const numA = Number(valA)
        const numB = Number(valB)
        if (numA === -1 && numB !== -1) return -1
        if (numB === -1 && numA !== -1) return 1
        return numA - numB
    })
    let sortedValueInstanceMap = new Map(sortedEntries)

    if (sortedValueInstanceMap.size === 0) {
        // For cubeType variables, fall back to using the first instance
        if (String(instanceKey).toLowerCase().includes("cubetype")) {
            const instanceKeys = Object.keys(item.instances).sort(
                (a, b) => parseInt(a, 10) - parseInt(b, 10),
            )
            const firstKey = instanceKeys[0]
            const firstInstance = firstKey ? item.instances[firstKey] : null

            if (!firstInstance?.Name) {
                return { success: false, error: "No instances available for fallback" }
            }

            const cubeTypeMap = new Map()
            for (let i = 0; i <= 4; i++) {
                cubeTypeMap.set(String(i), firstInstance.Name)
            }
            sortedValueInstanceMap = cubeTypeMap
        } else {
            dialog.showMessageBox({
                type: "warning",
                title: "No Instances Found",
                message: `No instances found for variable "${instanceKey}".`,
                detail: "Make sure the VBSP blocks are configured correctly.",
            })
            return { success: false, error: `No instances found for variable "${instanceKey}"` }
        }
    }

    let finalInstanceMap = sortedValueInstanceMap

    // Timer variable handling (0-30 fill)
    if (String(instanceKey).toLowerCase().includes("timer")) {
        finalInstanceMap = handleTimerVariable(sortedValueInstanceMap)
    }

    // VMF Atlas approach
    return handleAtlasConversion(event, item, instanceKey, finalInstanceMap, options)
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

    let mdlResult = null
    try {
        const { convertAndInstallMDL } = require("../utils/mdlConverter")
        const itemName = item.id.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase()

        mdlResult = await convertAndInstallMDL(objPath, item.packagePath, itemName, {
            scale: options.scale || 1.0,
        })

        if (mdlResult.success && mdlResult.relativeModelPath) {
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
        }
    } catch (mdlError) {
        console.error("❌ MDL conversion failed (DEFAULT):", mdlError)
        mdlResult = { success: false, error: mdlError.message }
    }

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
 * Handle timer variable (fill 0-30 range)
 */
function handleTimerVariable(sortedValueInstanceMap) {

    let baseInstance = null
    if (sortedValueInstanceMap.has("0") || sortedValueInstanceMap.has(0)) {
        const zeroKey = sortedValueInstanceMap.has("0") ? "0" : 0
        baseInstance = sortedValueInstanceMap.get(zeroKey)
    } else if (sortedValueInstanceMap.size > 0) {
        const minKey = [...sortedValueInstanceMap.keys()]
            .map((k) => Number(k))
            .filter((n) => !isNaN(n))
            .sort((a, b) => a - b)[0]
        baseInstance = sortedValueInstanceMap.get(String(minKey))
    }

    if (!baseInstance) {
        throw new Error("No timer instances found.")
    }

    const completeTimerMap = new Map()
    for (let i = 0; i <= 30; i++) {
        const keyStr = String(i)
        if (sortedValueInstanceMap.has(keyStr)) {
            completeTimerMap.set(keyStr, sortedValueInstanceMap.get(keyStr))
        } else {
            completeTimerMap.set(keyStr, baseInstance)
        }
    }

    return completeTimerMap
}

/**
 * Handle multi-model conversion: one model per unique instance
 */
async function handleAtlasConversion(event, item, instanceKey, finalInstanceMap, options) {

    const uniqueInstances = [...new Set(finalInstanceMap.values())]

    // Create persistent models directory for this item
    const itemName = item.id.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase()
    const modelsDir = path.join(item.packagePath, ".bpee", itemName, "models")
    await mkdirWithRetry(modelsDir)
    const tempDir = modelsDir // Use persistent location

    const vmfFiles = []
    for (const instancePath of uniqueInstances) {
        const vmfPath = Instance.getCleanPath(item.packagePath, instancePath)

        if (!fs.existsSync(vmfPath)) {
            console.warn(`   ⚠️ VMF file not found: ${vmfPath}`)
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

    const conversionPromises = variantResults.map(async (variant) => {
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
                },
            )

            return {
                instancePath,
                modelPath: mdlResult.relativeModelPath,
                value: instancePath,
            }
        } catch (error) {
            console.error(`   ❌ FAILED to convert ${variant.name}:`, error.message)
            return { instancePath, error: error.message }
        }
    })

    const conversionResults = [...objFailures, ...(await Promise.all(conversionPromises))]

    const successfulResults = conversionResults.filter((r) => r.modelPath)
    const failedResults = conversionResults.filter((r) => r.error)

    console.log(`Model conversion: ${successfulResults.length} succeeded, ${failedResults.length} failed`)

    if (successfulResults.length === 0) {
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

    // Add SubTypeProperty
    const toPascalCase = (str) => {
        return str
            .split(/[\s_]+/)
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join("")
    }
    editorItems.Item.Editor.SubTypeProperty = toPascalCase(instanceKey)

    const newSubTypes = buildSubTypes(
        baseSubType,
        finalInstanceMap,
        conversionResults,
        instanceKey,
        successfulResults[0].modelPath,
    )

    editorItems.Item.Editor.SubType = newSubTypes

    dialog.showMessageBox({
        type: successfulResults.length === conversionResults.length ? "info" : "warning",
        title: "Multi-Model Generation Complete",
        message: `Successfully converted ${successfulResults.length} of ${conversionResults.length} models.`,
        detail: `Click Save in the editor to apply ${newSubTypes.length} SubTypes to editoritems.json.`,
    })

    return { success: true, results: conversionResults, stagedEditorItems: editorItems }
}

/**
 * Build SubType array for editoritems.json
 */
function buildSubTypes(baseSubType, finalInstanceMap, conversionResults, instanceKey, defaultModelPath) {
    const newSubTypes = []
    let isFirstSubType = true
    const isTimer = String(instanceKey).toLowerCase().includes("timer")

    const valueToModelMap = new Map()
    for (const [value, instancePath] of finalInstanceMap.entries()) {
        if (isTimer) {
            const numValue = Number(value)
            if (isNaN(numValue) || numValue < 0 || numValue > 30) {
                continue
            }
        }
        const result = conversionResults.find((r) => r.instancePath === instancePath)
        if (result && result.modelPath) {
            valueToModelMap.set(String(value), result.modelPath)
        }
    }

    if (isTimer) {
        // Timer: exactly 31 subtypes
        for (let i = 0; i <= 30; i++) {
            const valueStr = String(i)
            const modelPath = valueToModelMap.get(valueStr) || defaultModelPath

            let newSubType
            if (isFirstSubType) {
                newSubType = JSON.parse(JSON.stringify(baseSubType))
                isFirstSubType = false
            } else {
                newSubType = {
                    Name: baseSubType.Name,
                    Model: {},
                }
                if (baseSubType.Sounds) {
                    newSubType.Sounds = JSON.parse(JSON.stringify(baseSubType.Sounds))
                }
                if (baseSubType.Animations) {
                    newSubType.Animations = JSON.parse(JSON.stringify(baseSubType.Animations))
                }
            }

            if (!newSubType.Model) newSubType.Model = {}
            newSubType.Model.ModelName = modelPath
            newSubType.Name = baseSubType.Name

            newSubTypes.push(newSubType)
        }
    } else {
        // Non-timer: generate based on actual models
        for (const [value, instancePath] of finalInstanceMap.entries()) {
            const result = conversionResults.find((r) => r.instancePath === instancePath)
            if (result && result.modelPath) {
                let newSubType
                if (isFirstSubType) {
                    newSubType = JSON.parse(JSON.stringify(baseSubType))
                    isFirstSubType = false
                } else {
                    newSubType = {
                        Name: baseSubType.Name,
                        Model: {},
                    }
                    if (baseSubType.Sounds) {
                        newSubType.Sounds = JSON.parse(JSON.stringify(baseSubType.Sounds))
                    }
                    if (baseSubType.Animations) {
                        newSubType.Animations = JSON.parse(JSON.stringify(baseSubType.Animations))
                    }
                }

                if (!newSubType.Model) newSubType.Model = {}
                newSubType.Model.ModelName = result.modelPath
                newSubType.Name = baseSubType.Name

                newSubTypes.push(newSubType)
            }
        }
    }

    return newSubTypes
}

module.exports = { register }
