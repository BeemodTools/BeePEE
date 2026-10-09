/**
 * Instance management handlers - add, remove, edit instances
 */

const { app, dialog, BrowserWindow } = require("electron")
const { spawn } = require("child_process")
const fs = require("fs")
const path = require("path")
const { packages } = require("../packageManager")
const { sendItemUpdateToEditor } = require("../items/itemEditor")
const { Instance } = require("../items/Instance")
const { vmfStatsCache } = require("../utils/vmfParser")
const { instanceBehindSurface } = require("../utils/behindSurface")
const { getHammerPath, getHammerAvailability, findPortal2Dir } = require("../data")

/**
 * Helper function to fix instance paths by removing BEE2/ prefix
 */
function fixInstancePath(instancePath) {
    let normalizedPath = instancePath.replace(/\\/g, "/")

    if (normalizedPath.startsWith("instances/BEE2/")) {
        return normalizedPath.replace("instances/BEE2/", "instances/")
    }
    if (normalizedPath.startsWith("instances/bee2/")) {
        return normalizedPath.replace("instances/bee2/", "instances/")
    }
    return normalizedPath
}

/**
 * Helper function to fix all instances in an item
 */
function fixItemInstances(item) {
    let hasChanges = false

    for (const [index, instanceData] of Object.entries(item.instances)) {
        const oldPath = instanceData.Name
        const newPath = fixInstancePath(oldPath)

        if (oldPath !== newPath) {
            console.log(
                `Fixed an instance path of "${item.name}": ${oldPath} -> ${newPath}`,
            )
            instanceData.Name = newPath
            hasChanges = true
        }
    }

    if (hasChanges) {
        const editoritems = item.getEditorItems()
        if (editoritems.Item?.Exporting?.Instances) {
            for (const [index, instanceData] of Object.entries(
                editoritems.Item.Exporting.Instances,
            )) {
                const oldPath = instanceData.Name
                const newPath = fixInstancePath(oldPath)

                if (oldPath !== newPath) {
                    instanceData.Name = newPath
                }
            }
            item.saveEditorItems(editoritems)
        }
    }

    return hasChanges
}

function register(ipcMain, mainWindow) {
    // Add instance
    ipcMain.handle("add-instance", async (event, { itemId, instanceName }) => {
        try {
            const item = packages
                .flatMap((p) => p.items)
                .find((i) => i.id === itemId)
            if (!item) {
                throw new Error("Item not found")
            }

            const newIndex = item.addInstance(instanceName)
            console.log(
                `Added instance ${newIndex} (${instanceName}) to "${item.name}"`,
            )

            const updatedItem = item.toJSONWithExistence()
            mainWindow.webContents.send("item-updated", updatedItem)
            sendItemUpdateToEditor(itemId, updatedItem)

            return { success: true, index: newIndex }
        } catch (error) {
            console.error(`Failed to add instance ${instanceName}:`, error)
            dialog.showErrorBox(
                "Failed to Add Instance",
                `Could not add instance: ${error.message}`,
            )
            return { success: false, error: error.message }
        }
    })

    // Add instance from file path (for buffered save)
    ipcMain.handle(
        "add-instance-from-file",
        async (event, { itemId, filePath, instanceName }) => {
            try {
                const item = packages
                    .flatMap((p) => p.items)
                    .find((i) => i.id === itemId)
                if (!item) {
                    throw new Error("Item not found")
                }

                if (!fs.existsSync(filePath)) {
                    throw new Error("Source file not found")
                }

                const actualFilePath = fixInstancePath(instanceName)
                const targetPath = path.join(
                    item.packagePath,
                    "resources",
                    actualFilePath,
                )
                const targetDir = path.dirname(targetPath)

                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true })
                }

                fs.copyFileSync(filePath, targetPath)

                // Perform autopacking for the instance
                try {
                    const { autopackInstance } = require("../utils/autopacker")
                    const autopackResult = await autopackInstance(
                        filePath,
                        item.packagePath,
                        item.name,
                    )

                    if (!autopackResult.success) {
                        console.warn(
                            `Adding ${instanceName} without all of its assets, as autopacking failed`,
                        )
                    }
                } catch (autopackError) {
                    console.warn(
                        `Failed to autopack ${instanceName}, adding it anyway:`,
                        autopackError,
                    )
                }

                const newIndex = item.addInstance(instanceName)

                const fileName = path.basename(instanceName, ".vmf")
                item.setInstanceName(newIndex, fileName)
                console.log(
                    `Added instance ${newIndex} (${instanceName}) to "${item.name}"`,
                )

                const updatedItem = item.toJSONWithExistence()
                mainWindow.webContents.send("item-updated", updatedItem)
                sendItemUpdateToEditor(itemId, updatedItem)

                return { success: true, index: newIndex }
            } catch (error) {
                console.error(`Failed to add instance ${instanceName}:`, error)
                dialog.showErrorBox(
                    "Failed to Add Instance",
                    `Could not add instance: ${error.message}`,
                )
                return { success: false, error: error.message }
            }
        },
    )

    // Select instance file (for buffered save)
    ipcMain.handle("select-instance-file", async (event, { itemId }) => {
        try {
            const item = packages
                .flatMap((p) => p.items)
                .find((i) => i.id === itemId)
            if (!item) {
                throw new Error("Item not found")
            }

            const result = await dialog.showOpenDialog(mainWindow, {
                title: "Select VMF Instance File(s)",
                properties: ["openFile", "multiSelections"],
                filters: [
                    {
                        name: "VMF Files",
                        extensions: ["vmf"],
                    },
                    {
                        name: "All Files",
                        extensions: ["*"],
                    },
                ],
            })

            if (result.canceled || result.filePaths.length === 0) {
                return { success: false, canceled: true }
            }

            const getUniqueInstanceFileName = (originalFileName) => {
                const existingInstances = Object.values(item.instances)
                const existingPaths = existingInstances.map((inst) =>
                    path.basename(inst.Name),
                )

                let fileName = originalFileName
                let counter = 1

                while (existingPaths.includes(fileName)) {
                    const nameWithoutExt = path.basename(originalFileName, ".vmf")
                    fileName = `${nameWithoutExt}_${counter}.vmf`
                    counter++
                }

                return fileName
            }

            const results = result.filePaths.map((selectedFilePath) => {
                const originalFileName = path.basename(selectedFilePath)

                if (!originalFileName.toLowerCase().endsWith(".vmf")) {
                    return {
                        success: false,
                        error: "Selected file must be a VMF file",
                        filePath: selectedFilePath,
                    }
                }

                const instanceFileName = getUniqueInstanceFileName(originalFileName)
                const instanceName = `instances/BEE2/bpee/${item.id}/${instanceFileName}`

                return {
                    success: true,
                    filePath: selectedFilePath,
                    instanceName: instanceName,
                    fileName: originalFileName,
                }
            })

            return {
                success: true,
                files: results,
            }
        } catch (error) {
            console.error("Failed to select instance files:", error)
            dialog.showErrorBox(
                "Failed to Select Instance File",
                `Could not select instance file: ${error.message}`,
            )
            return { success: false, error: error.message }
        }
    })

    // Add instance with file dialog (legacy)
    ipcMain.handle("add-instance-file-dialog", async (event, { itemId }) => {
        try {
            const item = packages
                .flatMap((p) => p.items)
                .find((i) => i.id === itemId)
            if (!item) {
                throw new Error("Item not found")
            }

            const result = await dialog.showOpenDialog(mainWindow, {
                title: "Select VMF Instance File",
                properties: ["openFile"],
                filters: [
                    {
                        name: "VMF Files",
                        extensions: ["vmf"],
                    },
                    {
                        name: "All Files",
                        extensions: ["*"],
                    },
                ],
            })

            if (result.canceled || result.filePaths.length === 0) {
                return { success: false, canceled: true }
            }

            const selectedFilePath = result.filePaths[0]
            const originalFileName = path.basename(selectedFilePath)

            if (!originalFileName.toLowerCase().endsWith(".vmf")) {
                throw new Error("Selected file must be a VMF file")
            }

            const getUniqueInstanceFileName = (fileName) => {
                const existingInstances = Object.values(item.instances)
                const existingPaths = existingInstances.map((inst) =>
                    path.basename(inst.Name),
                )

                let uniqueFileName = fileName
                let counter = 1

                while (existingPaths.includes(uniqueFileName)) {
                    const nameWithoutExt = path.basename(fileName, ".vmf")
                    uniqueFileName = `${nameWithoutExt}_${counter}.vmf`
                    counter++
                }

                return uniqueFileName
            }

            const instanceFileName = getUniqueInstanceFileName(originalFileName)
            const instanceName = `instances/BEE2/bpee/${item.id}/${instanceFileName}`

            const actualFilePath = fixInstancePath(instanceName)
            const targetPath = path.join(
                item.packagePath,
                "resources",
                actualFilePath,
            )
            const targetDir = path.dirname(targetPath)

            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true })
            }

            fs.copyFileSync(selectedFilePath, targetPath)

            const newIndex = item.addInstance(instanceName)

            const displayName = path.basename(instanceName, ".vmf")
            item.setInstanceName(newIndex, displayName)
            console.log(
                `Added instance ${newIndex} (${instanceName}) to "${item.name}"`,
            )

            const updatedItem = item.toJSONWithExistence()
            mainWindow.webContents.send("item-updated", updatedItem)
            sendItemUpdateToEditor(itemId, updatedItem)

            return {
                success: true,
                index: newIndex,
                instanceName: instanceName,
            }
        } catch (error) {
            console.error("Failed to add an instance:", error)
            dialog.showErrorBox(
                "Failed to Add Instance",
                `Could not add instance: ${error.message}`,
            )
            return { success: false, error: error.message }
        }
    })

    // Replace instance with file dialog
    ipcMain.handle(
        "replace-instance-file-dialog",
        async (event, { itemId, instanceIndex }) => {
            try {
                const item = packages
                    .flatMap((p) => p.items)
                    .find((i) => i.id === itemId)
                if (!item) {
                    throw new Error("Item not found")
                }

                const instanceData = item.instances[instanceIndex]
                if (!instanceData) {
                    throw new Error(`Instance ${instanceIndex} not found`)
                }

                const result = await dialog.showOpenDialog(mainWindow, {
                    title: "Select Replacement VMF Instance File",
                    properties: ["openFile"],
                    filters: [
                        {
                            name: "VMF Files",
                            extensions: ["vmf"],
                        },
                        {
                            name: "All Files",
                            extensions: ["*"],
                        },
                    ],
                })

                if (result.canceled || result.filePaths.length === 0) {
                    return { success: false, canceled: true }
                }

                const selectedFilePath = result.filePaths[0]
                const fileName = path.basename(selectedFilePath)

                if (!fileName.toLowerCase().endsWith(".vmf")) {
                    throw new Error("Selected file must be a VMF file")
                }

                const actualInstancePath = fixInstancePath(instanceData.Name)
                const currentInstancePath = Instance.getCleanPath(
                    item.packagePath,
                    actualInstancePath,
                )

                fs.copyFileSync(selectedFilePath, currentInstancePath)

                item._loadedInstances.delete(instanceIndex)
                vmfStatsCache.clearCache(currentInstancePath)

                // Update VMF stats
                try {
                    const editoritems = item.getEditorItems()
                    if (editoritems.Item?.Exporting?.Instances?.[instanceIndex]) {
                        const fullInstancePath = Instance.getCleanPath(
                            item.packagePath,
                            fixInstancePath(instanceData.Name),
                        )
                        const vmfStats = vmfStatsCache.getStats(fullInstancePath)

                        editoritems.Item.Exporting.Instances[instanceIndex] = {
                            ...editoritems.Item.Exporting.Instances[instanceIndex],
                            ...vmfStats,
                        }
                        item.saveEditorItems(editoritems)
                    }
                } catch (error) {
                    console.warn(
                        `Failed to update the VMF stats of instance ${instanceIndex} in the editoritems:`,
                        error,
                    )
                }
                console.log(
                    `Replaced instance ${instanceIndex} of "${item.name}" with ${selectedFilePath}`,
                )

                // Pack the new instance's custom files, as when adding one
                let missingFiles = []
                let neededBy = {}
                try {
                    const { autopackInstance } = require("../utils/autopacker")
                    const autopackResult = await autopackInstance(
                        selectedFilePath,
                        item.packagePath,
                        item.name,
                    )
                    missingFiles = autopackResult.missingFiles ?? []
                    neededBy = autopackResult.neededBy ?? {}
                } catch (autopackError) {
                    console.warn(
                        `Failed to autopack the replacement of instance ${instanceIndex}:`,
                        autopackError,
                    )
                }

                const updatedItem = item.toJSONWithExistence()
                mainWindow.webContents.send("item-updated", updatedItem)
                sendItemUpdateToEditor(itemId, updatedItem)

                return {
                    success: true,
                    instanceName: instanceData.Name,
                    fileName,
                    missingFiles,
                    neededBy,
                }
            } catch (error) {
                console.error(
                    `Failed to replace instance ${instanceIndex}:`,
                    error,
                )
                dialog.showErrorBox(
                    "Failed to Replace Instance",
                    `Could not replace instance: ${error.message}`,
                )
                return { success: false, error: error.message }
            }
        },
    )

    // Autopack an instance again: pack the custom files it uses that aren't
    // in the package yet (new ones after editing it, or ones that weren't
    // found or mounted before). Files already in the package are kept.
    ipcMain.handle(
        "autopack-instance-again",
        async (event, { itemId, instanceIndex }) => {
            try {
                const item = packages
                    .flatMap((p) => p.items)
                    .find((i) => i.id === itemId)
                if (!item) {
                    throw new Error("Item not found")
                }
                const instanceData = item.instances[instanceIndex]
                if (!instanceData) {
                    throw new Error(`Instance ${instanceIndex} not found`)
                }
                const vmfPath = Instance.getCleanPath(
                    item.packagePath,
                    fixInstancePath(instanceData.Name),
                )
                if (!fs.existsSync(vmfPath)) {
                    throw new Error("The instance's VMF file doesn't exist")
                }

                const { autopackInstance } = require("../utils/autopacker")
                const result = await autopackInstance(
                    vmfPath,
                    item.packagePath,
                    item.name,
                )
                const packed = result.packedFiles?.length ?? 0
                // The package has new files its .bpee doesn't
                if (packed > 0) global.titleManager?.setUnsavedChanges(true)

                return {
                    success: result.success,
                    error: result.error ?? null,
                    skipped: result.skipped === true,
                    packed,
                    custom: result.totalAssets ?? 0,
                    missingFiles: result.missingFiles ?? [],
                    neededBy: result.neededBy ?? {},
                    fileName: path.basename(instanceData.Name),
                }
            } catch (error) {
                console.error(
                    `Failed to autopack instance ${instanceIndex} again:`,
                    error,
                )
                return { success: false, error: error.message }
            }
        },
    )

    // Remove instance
    ipcMain.handle(
        "remove-instance",
        async (event, { itemId, instanceIndex }) => {
            try {
                const item = packages
                    .flatMap((p) => p.items)
                    .find((i) => i.id === itemId)
                if (!item) {
                    throw new Error("Item not found")
                }

                const instanceData = item.instances[instanceIndex]
                if (instanceData) {
                    try {
                        const actualInstancePath = fixInstancePath(instanceData.Name)
                        const fullInstancePath = Instance.getCleanPath(
                            item.packagePath,
                            actualInstancePath,
                        )
                        vmfStatsCache.clearCache(fullInstancePath)
                    } catch (error) {
                        console.warn(
                            `Failed to clear the cached VMF stats of instance ${instanceIndex}:`,
                            error,
                        )
                    }
                }

                // Another item of the package can use the same VMF
                const pkg = packages.find((p) => p.items.includes(item))
                const file = item.instanceFileKey(instanceData?.Name)
                const keepFile = !!pkg?.items.some(
                    (other) =>
                        other !== item &&
                        Object.values(other.instances).some(
                            (data) => other.instanceFileKey(data.Name) === file,
                        ),
                )
                item.removeInstance(instanceIndex, { keepFile })
                console.log(
                    `Removed instance ${instanceIndex} (${instanceData?.Name}) from "${item.name}"`,
                )

                const updatedItem = item.toJSONWithExistence()
                mainWindow.webContents.send("item-updated", updatedItem)
                sendItemUpdateToEditor(itemId, updatedItem)

                return { success: true }
            } catch (error) {
                console.error(
                    `Failed to remove instance ${instanceIndex}:`,
                    error,
                )
                dialog.showErrorBox(
                    "Failed to Remove Instance",
                    `Could not remove instance: ${error.message}`,
                )
                return { success: false, error: error.message }
            }
        },
    )

    // Number the item's instances 0, 1, 2... with no gaps again: the item
    // editor, after it removed and added instances (removing one leaves a
    // gap, which BEE2 makes a blank instance)
    ipcMain.handle("renumber-instances", async (event, { itemId }) => {
        try {
            const item = packages
                .flatMap((p) => p.items)
                .find((i) => i.id === itemId)
            if (!item) {
                throw new Error("Item not found")
            }
            const moved = item.renumberInstances()
            if (Object.keys(moved).length) {
                const updatedItem = item.toJSONWithExistence()
                mainWindow.webContents.send("item-updated", updatedItem)
                sendItemUpdateToEditor(itemId, updatedItem)
            }
            return { success: true, moved }
        } catch (error) {
            console.error(`Failed to number the instances of ${itemId}:`, error)
            return { success: false, error: error.message }
        }
    })

    // Get valid instances only (for UI filtering)
    ipcMain.handle("get-valid-instances", async (event, { itemId }) => {
        try {
            const item = packages
                .flatMap((p) => p.items)
                .find((i) => i.id === itemId)
            if (!item) throw new Error("Item not found")

            const validInstances = item.getValidInstances()
            return { success: true, instances: validInstances }
        } catch (error) {
            return { success: false, error: error.message }
        }
    })

    // Edit instance in Hammer
    ipcMain.handle(
        "edit-instance",
        async (event, { packagePath, instanceName, itemId }) => {
            try {
                const hammerStatus = getHammerAvailability()
                if (!hammerStatus.available) {
                    throw new Error(
                        "Neither Hammer++ nor Hammer was found in Portal 2's bin directory",
                    )
                }

                const item = packages
                    .flatMap((p) => p.items)
                    .find((i) => i.id === itemId)
                if (!item) {
                    throw new Error("Item not found")
                }

                const actualInstancePath = fixInstancePath(instanceName)
                const instancePath = path.normalize(
                    Instance.getCleanPath(packagePath, actualInstancePath),
                )

                const resourcesDir = path.normalize(
                    path.join(packagePath, "resources"),
                )
                if (!instancePath.startsWith(resourcesDir)) {
                    throw new Error(
                        `Invalid instance path: ${instancePath} (must be within package resources directory)`,
                    )
                }

                if (!fs.existsSync(instancePath)) {
                    throw new Error(`Instance file not found: ${instancePath}`)
                }

                const hammer = spawn(getHammerPath(), [instancePath], {
                    detached: true,
                    stdio: "ignore",
                })

                hammer.unref()
                console.log(`Opened ${instancePath} in ${hammerStatus.type}`)

                return { success: true, editorType: hammerStatus.type }
            } catch (error) {
                console.error(
                    `Failed to open ${instanceName} in Hammer:`,
                    error,
                )
                const errorMessage = `Could not open instance in Hammer: ${error.message}`
                dialog.showErrorBox("Failed to Launch Hammer", errorMessage)
                return { success: false, error: errorMessage }
            }
        },
    )

    // Instance naming handlers
    ipcMain.handle(
        "get-instance-name",
        async (event, { itemId, instanceIndex }) => {
            try {
                const item = packages
                    .flatMap((p) => p.items)
                    .find((i) => i.id === itemId)

                if (!item) {
                    throw new Error(`Item ${itemId} not found`)
                }

                const name = item.getInstanceName(instanceIndex)
                return { success: true, name }
            } catch (error) {
                console.error(
                    `Failed to get the name of instance ${instanceIndex}:`,
                    error,
                )
                return { success: false, error: error.message }
            }
        },
    )

    ipcMain.handle(
        "set-instance-name",
        async (event, { itemId, instanceIndex, name }) => {
            try {
                const item = packages
                    .flatMap((p) => p.items)
                    .find((i) => i.id === itemId)

                if (!item) {
                    throw new Error(`Item ${itemId} not found`)
                }

                item.setInstanceName(instanceIndex, name)

                const updatedItem = item.toJSONWithExistence()
                event.sender.send("item-updated", updatedItem)

                const mainWin = BrowserWindow.getAllWindows().find((w) =>
                    w.getTitle().includes("BeePEE"),
                )
                if (mainWin) {
                    mainWin.webContents.send("item-updated", updatedItem)
                }

                return { success: true }
            } catch (error) {
                console.error(
                    `Failed to rename instance ${instanceIndex}:`,
                    error,
                )
                return { success: false, error: error.message }
            }
        },
    )

    ipcMain.handle(
        "remove-instance-name",
        async (event, { itemId, instanceIndex }) => {
            try {
                const item = packages
                    .flatMap((p) => p.items)
                    .find((i) => i.id === itemId)

                if (!item) {
                    throw new Error(`Item ${itemId} not found`)
                }

                item.removeInstanceName(instanceIndex)

                const updatedItem = item.toJSONWithExistence()
                event.sender.send("item-updated", updatedItem)

                const mainWin = BrowserWindow.getAllWindows().find((w) =>
                    w.getTitle().includes("BeePEE"),
                )
                if (mainWin) {
                    mainWin.webContents.send("item-updated", updatedItem)
                }

                return { success: true }
            } catch (error) {
                console.error(
                    `Failed to remove the name of instance ${instanceIndex}:`,
                    error,
                )
                return { success: false, error: error.message }
            }
        },
    )

    // What each of an item's instances has behind the surface the item is
    // placed on (the Instances tab's leak warning), by index
    ipcMain.handle(
        "get-instances-behind-surface",
        async (event, { itemId }) => {
            const item = packages
                .flatMap((p) => p.items)
                .find((i) => i.id === itemId)
            if (!item) {
                return { success: false, error: `Item ${itemId} not found` }
            }
            return {
                success: true,
                behindSurface: item.getInstancesBehindSurface(),
            }
        },
    )

    // What a VMF has behind the surface the item is placed on, for an
    // instance that isn't added yet (the Instances tab's leak warning)
    ipcMain.handle(
        "check-instance-behind-surface",
        async (event, { itemId, vmfPath }) => {
            const item = packages
                .flatMap((p) => p.items)
                .find((i) => i.id === itemId)
            if (!item) {
                return { success: false, error: `Item ${itemId} not found` }
            }
            const frame = item.instanceFrame()
            return {
                success: true,
                behindSurface: frame
                    ? instanceBehindSurface(vmfPath, frame)
                    : null,
            }
        },
    )

    // Check if VMF uses external assets (not in base Portal 2)
    ipcMain.handle("check-vmf-external-assets", async (event, { vmfPath }) => {
        try {
            if (!fs.existsSync(vmfPath)) {
                return { success: false, error: "VMF file not found" }
            }

            // Get Portal 2 directory
            const portal2Dir = await findPortal2Dir()
            if (!portal2Dir) {
                return {
                    success: false,
                    error: "Could not find Portal 2 installation",
                    assets: { external: [], found: [] }
                }
            }

            // Sorted like autopacking does (see autopacker.js): "found" are
            // the custom files autopacking packs, "external" the rest (the
            // game's files, BEE2's files and missing ones)
            const { sortInstanceFiles } = require("../utils/autopacker")
            const files = await sortInstanceFiles(vmfPath, portal2Dir)
            const asset = (file) => ({
                type: file.startsWith("models/")
                    ? "MODEL"
                    : file.startsWith("sound/")
                      ? "SOUND"
                      : file.startsWith("scripts/")
                        ? "SCRIPT"
                        : file.startsWith("particles/")
                          ? "PARTICLE"
                          : "MATERIAL",
                path: file,
            })
            const foundAssets = files.custom.map(({ file }) => asset(file))
            // Files it uses that don't exist or aren't mounted properly
            const missingAssets = files.missing.map((file) => ({
                ...asset(file),
                neededBy: files.neededBy[file] ?? null,
            }))
            if (missingAssets.length > 0) {
                console.warn(
                    `${path.basename(vmfPath)} uses ${missingAssets.length} file(s) that don't exist or aren't mounted properly: ${files.missing.join(", ")}`,
                )
            }
            const externalAssets = [
                ...files.baseGame,
                ...files.bee2,
                ...files.missing,
                ...files.missingDependencies,
            ].map(asset)

            return {
                success: true,
                hasExternalAssets: externalAssets.length > 0,
                assets: {
                    external: externalAssets,
                    found: foundAssets,
                    missing: missingAssets,
                },
                summary: {
                    totalAssets: externalAssets.length + foundAssets.length,
                    externalCount: externalAssets.length,
                    foundCount: foundAssets.length,
                    missingCount: missingAssets.length,
                }
            }
        } catch (error) {
            console.error(
                `Failed to check the external assets of ${vmfPath}:`,
                error,
            )
            return { success: false, error: error.message }
        }
    })
}

module.exports = { register, fixInstancePath, fixItemInstances }
