/**
 * Item CRUD handlers - create, edit, delete items
 */

const { dialog } = require("electron")
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const {
    packages,
    loadPackage,
    Package,
    getCurrentPackageDir,
} = require("../packageManager")
const {
    createItemEditor,
    sendItemUpdateToEditor,
    createItemCreationWindow,
    getCreateItemWindow,
} = require("../items/itemEditor")
const { Item } = require("../models/items")
const { descriptionValue } = require("../saveItem")
const { APP_VERSION } = require("../utils/keyvalues")
const { vmfStatsCache } = require("../utils/vmfParser")
const { withColors } = require("../utils/itemColors")
const { Instance } = require("../items/Instance")
const { instanceFiles, removeUnusedFiles } = require("../utils/packageFiles")

/** "1 instance", "3 instances" */
const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`

function register(ipcMain, mainWindow) {
    // Open item editor
    // Note: Frontend passes item directly (not wrapped in object)
    ipcMain.handle("open-item-editor", async (event, item) => {
        try {
            // Find the actual Item instance from the packages
            const actualItem = packages
                .flatMap((p) => p.items)
                .find((i) => i.id === item.id)
            if (!actualItem) {
                throw new Error(`Item not found: ${item.id}`)
            }
            createItemEditor(actualItem, mainWindow)
            return { success: true }
        } catch (error) {
            console.error(
                `Failed to open the item editor for ${item?.id}:`,
                error,
            )
            throw error
        }
    })

    // The item as the item editor has it ("load-item" and "item-updated"
    // send the same), to show what a save wrote
    ipcMain.handle("get-item", async (event, { itemId }) => {
        const item = packages
            .flatMap((p) => p.items)
            .find((i) => i.id === itemId)
        if (!item) return { success: false, error: `Item ${itemId} not found` }
        return { success: true, item: item.toJSONWithExistence() }
    })

    // Open create item window
    ipcMain.handle("open-create-item-window", async () => {
        try {
            createItemCreationWindow(mainWindow)
            return { success: true }
        } catch (error) {
            console.error("Failed to open the item creation window:", error)
            throw error
        }
    })

    // Create item (full)
    ipcMain.handle(
        "create-item",
        async (
            event,
            { name, description, author, iconPath, instances },
        ) => {
            try {
                // Validate required fields
                if (!name?.trim()) {
                    throw new Error("Item name is required")
                }
                if (!author?.trim()) {
                    throw new Error("Author name is required")
                }
                if (!instances || instances.length === 0) {
                    throw new Error("At least one instance is required")
                }

                const currentPackageDir = getCurrentPackageDir()
                if (!currentPackageDir) {
                    throw new Error(
                        "No package is currently loaded. Please create or open a package first.",
                    )
                }

                const packagePath = currentPackageDir

                // Generate a unique item ID
                const sanitizedName = name
                    .replace(/[^a-zA-Z0-9]/g, "")
                    .toLowerCase()
                const sanitizedAuthor = author
                    .replace(/[^a-zA-Z0-9]/g, "")
                    .toLowerCase()
                const uuid = crypto
                    .randomBytes(2)
                    .toString("hex")
                    .toUpperCase()

                let itemId = `bpee_${sanitizedName}_${sanitizedAuthor}_${uuid}`

                // Check for collisions and regenerate UUID if needed
                const existingItems = packages.flatMap((p) => p.items)
                let attempts = 0
                while (
                    existingItems.some((i) => i.id === itemId) &&
                    attempts < 10
                ) {
                    const newUuid = crypto
                        .randomBytes(2)
                        .toString("hex")
                        .toUpperCase()
                    itemId = `bpee_${sanitizedName}_${sanitizedAuthor}_${newUuid}`
                    attempts++
                }

                if (attempts >= 10) {
                    throw new Error(
                        "Failed to generate unique item ID after multiple attempts",
                    )
                }

                // Create item folder
                const itemFolder = `${sanitizedName}_${sanitizedAuthor}`
                const itemFolderPath = path.join(
                    packagePath,
                    "items",
                    itemFolder,
                )
                if (!fs.existsSync(itemFolderPath)) {
                    fs.mkdirSync(itemFolderPath, { recursive: true })
                }

                // Create editoritems.json. Its Type is the item's ID, as in
                // info.json
                const editoritems = {
                    Item: {
                        Type: itemId,
                        ItemClass: "ItemBase",
                        SubtypeProperty: null,
                        Editor: {
                            SubType: {
                                Name: name,
                                // What Portal 2's palette shows: the name in
                                // capitals, as BEE2's items have it
                                Palette: {
                                    Tooltip: name.trim().toUpperCase(),
                                    Position: "0 0 0",
                                },
                            },
                        },
                        Exporting: {
                            TargetName: itemId,
                            Instances: {},
                        },
                    },
                }

                // Process instances
                const instanceDir = path.join(
                    packagePath,
                    "resources",
                    "instances",
                    "bpee",
                    itemId,
                )
                if (!fs.existsSync(instanceDir)) {
                    fs.mkdirSync(instanceDir, { recursive: true })
                }

                for (let index = 0; index < instances.length; index++) {
                    const instancePath = instances[index]

                    // Copy instance file if it exists
                    if (fs.existsSync(instancePath)) {
                        const instanceFileName =
                            index === 0
                                ? "instance.vmf"
                                : `instance_${index}.vmf`
                        const targetPath = path.join(
                            instanceDir,
                            instanceFileName,
                        )
                        fs.copyFileSync(instancePath, targetPath)
                    }

                    // Add to editoritems - use relative path with BEE2 prefix
                    const instanceFileName =
                        index === 0 ? "instance.vmf" : `instance_${index}.vmf`
                    const vmfStats = vmfStatsCache.getStats(
                        path.join(instanceDir, instanceFileName),
                    )

                    editoritems.Item.Exporting.Instances[index.toString()] = {
                        Name: `instances/BEE2/bpee/${itemId}/${instanceFileName}`,
                        EntityCount: vmfStats.EntityCount || 0,
                        BrushCount: vmfStats.BrushCount || 0,
                        BrushSideCount: vmfStats.BrushSideCount || 0,
                    }
                }

                // Write editoritems.json
                fs.writeFileSync(
                    path.join(itemFolderPath, "editoritems.json"),
                    JSON.stringify(editoritems, null, 2),
                )

                // Create properties.json
                const properties = {
                    Properties: {
                        Authors: author,
                        ...(description?.trim() && {
                            Description: descriptionValue(description),
                        }),
                    },
                }
                fs.writeFileSync(
                    path.join(itemFolderPath, "properties.json"),
                    JSON.stringify(properties, null, 2),
                )

                // Copy icon if provided
                if (iconPath && fs.existsSync(iconPath)) {
                    // Read package info to get ID
                    const infoPath = path.join(packagePath, "info.json")
                    const packageInfo = JSON.parse(
                        fs.readFileSync(infoPath, "utf-8"),
                    )
                    const packageId =
                        packageInfo.ID ||
                        packageInfo.id ||
                        path.basename(packagePath)

                    const iconDir = path.join(
                        packagePath,
                        "resources",
                        "BEE2",
                        "items",
                        packageId,
                    )
                    if (!fs.existsSync(iconDir)) {
                        fs.mkdirSync(iconDir, { recursive: true })
                    }
                    const iconExtension = path.extname(iconPath)
                    const iconFileName = `${sanitizedName}${iconExtension}`
                    const targetIconPath = path.join(iconDir, iconFileName)
                    fs.copyFileSync(iconPath, targetIconPath)

                    // Update properties.json with icon path
                    properties.Properties.Icon = {
                        0: `${packageId}/${iconFileName}`,
                    }
                    fs.writeFileSync(
                        path.join(itemFolderPath, "properties.json"),
                        JSON.stringify(properties, null, 2),
                    )
                }

                // Update package info.json
                const infoPath = path.join(packagePath, "info.json")
                const packageInfo = JSON.parse(
                    fs.readFileSync(infoPath, "utf-8"),
                )

                // Ensure Item array exists
                if (!packageInfo.Item) {
                    packageInfo.Item = []
                } else if (!Array.isArray(packageInfo.Item)) {
                    packageInfo.Item = [packageInfo.Item]
                }

                // Add new item entry
                packageInfo.Item.push({
                    ID: itemId,
                    Version: {
                        Styles: {
                            BEE2_CLEAN: itemFolder,
                        },
                    },
                })

                fs.writeFileSync(
                    infoPath,
                    JSON.stringify(packageInfo, null, 2),
                )

                // Create item instance and add to package
                const itemJSON = {
                    ID: itemId,
                    Version: {
                        Styles: {
                            BEE2_CLEAN: itemFolder,
                        },
                    },
                }

                const newItem = new Item({ packagePath, itemJSON })
                // Made with this BeePEE (the Meta tab says so)
                newItem.updateMetadata({
                    madeWithBeePEE: true,
                    createdVersion: APP_VERSION,
                    lastSavedVersion: APP_VERSION,
                })
                const pkg = packages.find((p) => p.packageDir === packagePath)
                if (pkg) {
                    pkg.items.push(newItem)
                } else {
                    console.warn(
                        `No loaded package matches ${packagePath}, so the new item isn't listed`,
                    )
                }
                console.log(
                    `Created item "${name}" (${itemId}) with ${plural(instances.length, "instance")}`,
                )

                // Package changed on disk (working dir) but not the .bpee
                global.titleManager?.setUnsavedChanges(true)

                // Send package loaded event to refresh UI
                mainWindow.webContents.send("package:loaded", {
                    items: packages
                        .flatMap((p) => p.items)
                        .map((i) => i.toJSONWithExistence()),
                    signages: packages.flatMap((p) => p.signages || []),
                })

                // Close the creation window
                const createWindow = getCreateItemWindow()
                if (createWindow && !createWindow.isDestroyed()) {
                    createWindow.close()
                }

                return { success: true, itemId }
            } catch (error) {
                console.error(`Failed to create item "${name}":`, error)
                dialog.showErrorBox(
                    "Failed to Create Item",
                    error.message || "An unknown error occurred",
                )
                return { success: false, error: error.message }
            }
        },
    )

    // Create item (simplified)
    ipcMain.handle(
        "create-item-simple",
        async (event, { name, itemId: providedItemId, description, author }) => {
            try {
                // Support both 'name' and 'itemId' as the item identifier
                const itemName = name || providedItemId
                if (!itemName?.trim()) {
                    throw new Error("Item name is required")
                }

                const currentPackageDir = getCurrentPackageDir()
                if (!currentPackageDir) {
                    throw new Error("No package is currently loaded")
                }

                const packagePath = currentPackageDir
                const sanitizedName = itemName
                    .replace(/[^a-zA-Z0-9]/g, "")
                    .toLowerCase()
                const uuid = crypto
                    .randomBytes(2)
                    .toString("hex")
                    .toUpperCase()

                const itemId = `bpee_${sanitizedName}_${uuid}`
                const itemFolder = sanitizedName
                const itemFolderPath = path.join(
                    packagePath,
                    "items",
                    itemFolder,
                )

                fs.mkdirSync(itemFolderPath, { recursive: true })

                // Create minimal editoritems.json. Its Type is the item's ID,
                // as in info.json
                const editoritems = {
                    Item: {
                        Type: itemId,
                        ItemClass: "ItemBase",
                        Editor: {
                            SubType: {
                                Name: itemName,
                                // What Portal 2's palette shows: the name in
                                // capitals, as BEE2's items have it
                                Palette: {
                                    Tooltip: itemName.trim().toUpperCase(),
                                },
                            },
                        },
                        Exporting: {
                            TargetName: itemId,
                            Instances: {},
                        },
                    },
                }

                fs.writeFileSync(
                    path.join(itemFolderPath, "editoritems.json"),
                    JSON.stringify(editoritems, null, 2),
                )

                // Create properties.json
                const properties = {
                    Properties: {
                        Authors: author || "Unknown",
                        ...(description?.trim() && {
                            Description: descriptionValue(description),
                        }),
                    },
                }
                fs.writeFileSync(
                    path.join(itemFolderPath, "properties.json"),
                    JSON.stringify(properties, null, 2),
                )

                // Update package info.json
                const infoPath = path.join(packagePath, "info.json")
                const packageInfo = JSON.parse(
                    fs.readFileSync(infoPath, "utf-8"),
                )

                if (!packageInfo.Item) {
                    packageInfo.Item = []
                } else if (!Array.isArray(packageInfo.Item)) {
                    packageInfo.Item = [packageInfo.Item]
                }

                packageInfo.Item.push({
                    ID: itemId,
                    Version: {
                        Styles: {
                            BEE2_CLEAN: itemFolder,
                        },
                    },
                })

                fs.writeFileSync(
                    infoPath,
                    JSON.stringify(packageInfo, null, 2),
                )

                // Create item instance
                const itemJSON = {
                    ID: itemId,
                    Version: {
                        Styles: {
                            BEE2_CLEAN: itemFolder,
                        },
                    },
                }

                const newItem = new Item({ packagePath, itemJSON })
                // Made with this BeePEE (the Meta tab says so)
                newItem.updateMetadata({
                    madeWithBeePEE: true,
                    createdVersion: APP_VERSION,
                    lastSavedVersion: APP_VERSION,
                })
                const pkg = packages.find((p) => p.packageDir === packagePath)
                if (pkg) {
                    pkg.items.push(newItem)
                } else {
                    console.warn(
                        `No loaded package matches ${packagePath}, so the new item isn't listed`,
                    )
                }
                console.log(`Created item "${itemName}" (${itemId})`)

                // Package changed on disk (working dir) but not the .bpee
                global.titleManager?.setUnsavedChanges(true)

                // Send update
                mainWindow.webContents.send("package:loaded", {
                    items: packages
                        .flatMap((p) => p.items)
                        .map((i) => i.toJSONWithExistence()),
                    signages: packages.flatMap((p) => p.signages || []),
                })

                // Close the create item window
                const createWindow = getCreateItemWindow()
                if (createWindow && !createWindow.isDestroyed()) {
                    createWindow.close()
                }

                return { success: true, itemId, item: newItem.toJSONWithExistence() }
            } catch (error) {
                console.error(
                    `Failed to create item "${name || providedItemId}":`,
                    error,
                )
                return { success: false, error: error.message }
            }
        },
    )

    // Delete item
    ipcMain.handle("delete-item", async (event, { itemId }) => {
        try {
            // Find the item
            let targetItem = null
            let targetPackage = null

            for (const pkg of packages) {
                const item = pkg.items.find((i) => i.id === itemId)
                if (item) {
                    targetItem = item
                    targetPackage = pkg
                    break
                }
            }

            if (!targetItem) {
                throw new Error("Item not found")
            }

            const packagePath = targetItem.packagePath

            // The files its instances use: deleted below when nothing else
            // in the package uses them
            const usedFiles = await instanceFiles(
                packagePath,
                Object.values(targetItem.instances ?? {}).map((data) =>
                    Instance.getCleanPath(packagePath, data.Name),
                ),
            )

            // Delete item folder
            if (
                targetItem.fullItemPath &&
                fs.existsSync(targetItem.fullItemPath)
            ) {
                fs.rmSync(targetItem.fullItemPath, {
                    recursive: true,
                    force: true,
                })
            }

            // Delete instance files
            const instanceDir = path.join(
                packagePath,
                "resources",
                "instances",
                "bpee",
                itemId,
            )
            if (fs.existsSync(instanceDir)) {
                fs.rmSync(instanceDir, { recursive: true, force: true })
            }

            // Delete icon files
            if (targetItem.icon && fs.existsSync(targetItem.icon)) {
                fs.unlinkSync(targetItem.icon)
            }

            // Also delete palette icon if it exists
            const paletteIconDir = path.join(
                packagePath,
                "resources",
                "materials",
                "models",
                "props_map_editor",
                "palette",
                "bpee",
                "item",
            )
            if (fs.existsSync(paletteIconDir)) {
                fs.rmSync(paletteIconDir, { recursive: true, force: true })
            }

            // Update package info.json
            const infoPath = path.join(packagePath, "info.json")
            const packageInfo = JSON.parse(fs.readFileSync(infoPath, "utf-8"))

            if (packageInfo.Item) {
                if (Array.isArray(packageInfo.Item)) {
                    packageInfo.Item = packageInfo.Item.filter(
                        (item) => item.ID !== itemId,
                    )
                } else if (packageInfo.Item.ID === itemId) {
                    delete packageInfo.Item
                }
            }
            // And its colors (its config group's color widget)
            withColors(packageInfo, { itemId, on: false })

            fs.writeFileSync(infoPath, JSON.stringify(packageInfo, null, 2))

            // Remove from in-memory package
            if (targetPackage) {
                targetPackage.items = targetPackage.items.filter(
                    (i) => i.id !== itemId,
                )
            }
            console.log(`Deleted item "${targetItem.name}" (${itemId})`)
            await removeUnusedFiles(packagePath, usedFiles)

            // Package changed on disk (working dir) but not the .bpee
            global.titleManager?.setUnsavedChanges(true)

            // Send update
            mainWindow.webContents.send("package:loaded", {
                items: packages
                    .flatMap((p) => p.items)
                    .map((i) => i.toJSONWithExistence()),
                signages: packages.flatMap((p) => p.signages || []),
            })

            return { success: true }
        } catch (error) {
            console.error(`Failed to delete item ${itemId}:`, error)
            dialog.showErrorBox("Failed to Delete Item", error.message)
            return { success: false, error: error.message }
        }
    })
}

module.exports = { register }
