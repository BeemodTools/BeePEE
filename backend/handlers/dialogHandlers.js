/**
 * Dialog and preview handlers - icons, models
 */

const { dialog } = require("electron")
const fs = require("fs")
const path = require("path")
const { packages } = require("../packageManager")
const { sendItemUpdateToEditor, createModelPreviewWindow } = require("../items/itemEditor")
const { Item } = require("../models/items")
const { createIconPreviewWindow, loadOriginalItemJSON } = require("./shared")
const { logger } = require("../utils/logger")

/**
 * Convert a file path to a beep:// URL for secure protocol
 */
function toBeepUrl(p) {
    if (!p) return null

    try {
        // Remove any existing protocol prefixes
        let cleanPath = p
            .replace(/^file:\/\/\//, "")
            .replace(/^file:\/\//, "")
            .replace(/^beep:\/\//, "")

        // Handle Windows drive letters
        if (process.platform === "win32") {
            if (cleanPath.match(/^[a-z]\//)) {
                cleanPath = cleanPath.charAt(0).toUpperCase() + ":" + cleanPath.slice(1)
            } else if (cleanPath.match(/^[a-z]:\//)) {
                cleanPath = cleanPath.charAt(0).toUpperCase() + cleanPath.slice(1)
            }
        }

        // Normalize path and convert backslashes to forward slashes
        const normalized = path.normalize(cleanPath).replace(/\\/g, "/")

        return `beep://${normalized}`
    } catch (error) {
        console.error(`Failed to make a beep:// URL for ${p}:`, error)
        return null
    }
}

function register(ipcMain, mainWindow) {
    // Register icon preview handler
    ipcMain.handle(
        "show-icon-preview",
        async (event, { iconPath, itemName }) => {
            try {
                if (!iconPath || !fs.existsSync(iconPath)) {
                    // Like a staged icon replaced since
                    dialog.showErrorBox(
                        "Can't Show the Icon",
                        `The icon's file isn't there anymore:\n${iconPath}`,
                    )
                    throw new Error("Icon file not found")
                }

                createIconPreviewWindow(iconPath, itemName, mainWindow)

                return { success: true }
            } catch (error) {
                console.error(
                    `Failed to show the icon preview of ${iconPath}:`,
                    error,
                )
                throw error
            }
        },
    )

    // List model segments for an item (persistent storage)
    ipcMain.handle(
        "list-model-segments",
        async (event, { itemId }) => {
            try {
                const item = packages
                    .flatMap((p) => p.items)
                    .find((i) => i.id === itemId)
                if (!item) {
                    return { success: false, error: "Item not found", segments: [] }
                }

                const itemName = item.id.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase()
                let modelsDir = path.join(item.packagePath, ".bpee", itemName, "models")

                // Fall back to old tempmdl location for backward compatibility
                if (!fs.existsSync(modelsDir)) {
                    const legacyDir = path.join(item.packagePath, ".bpee", "tempmdl")
                    if (fs.existsSync(legacyDir)) {
                        modelsDir = legacyDir
                    } else {
                        return { success: true, segments: [], modelsDir: null }
                    }
                }

                const files = fs.readdirSync(modelsDir)
                const objFiles = files
                    .filter(f => f.endsWith('.obj') && !f.includes('_sourcecoords') && !f.includes('_combined'))
                    .map(f => {
                        // Parse segment index from filename: itemName_X.obj
                        const match = f.match(/_(\d+)\.obj$/i)
                        const index = match ? parseInt(match[1], 10) : 0
                        const objPath = path.join(modelsDir, f)
                        const mtlPath = path.join(modelsDir, f.replace('.obj', '.mtl'))
                        return {
                            name: f,
                            path: objPath,
                            mtlPath: fs.existsSync(mtlPath) ? mtlPath : null,
                            index,
                            label: `Segment ${index}`
                        }
                    })
                    .sort((a, b) => a.index - b.index)

                return { success: true, segments: objFiles, modelsDir }
            } catch (error) {
                console.error(
                    `Failed to list the model segments of item ${itemId}:`,
                    error,
                )
                return { success: false, error: error.message, segments: [] }
            }
        },
    )

    // Register model preview handler
    ipcMain.handle(
        "show-model-preview",
        async (event, { objPath, mtlPath, title, segments = null }) => {
            try {
                if (!objPath || !fs.existsSync(objPath)) {
                    throw new Error("OBJ file not found")
                }

                // If objPath is a directory, find the first OBJ file in it
                let actualObjPath = objPath
                let actualMtlPath = mtlPath

                const stats = fs.statSync(objPath)
                if (stats.isDirectory()) {
                    const files = fs.readdirSync(objPath)

                    // First, try to find the combined file
                    let objFile = files.find(
                        (f) =>
                            f.includes("_combined.obj") &&
                            !f.includes("_sourcecoords"),
                    )

                    // If no combined file, fall back to any .obj file
                    if (!objFile) {
                        objFile = files.find(
                            (f) =>
                                f.endsWith(".obj") &&
                                !f.includes("_sourcecoords"),
                        )
                    }

                    if (!objFile) {
                        throw new Error(
                            "No OBJ files found in models directory",
                        )
                    }

                    actualObjPath = path.join(objPath, objFile)
                    actualMtlPath = actualObjPath.replace(".obj", ".mtl")
                }

                // Convert paths to beep:// URLs
                const objUrl = toBeepUrl(actualObjPath)
                const mtlUrl = actualMtlPath && fs.existsSync(actualMtlPath) ? toBeepUrl(actualMtlPath) : null

                // Transform segments to include beep:// URLs
                const segmentsWithUrls = segments ? segments.map(seg => ({
                    ...seg,
                    objUrl: toBeepUrl(seg.path),
                    mtlUrl: seg.mtlPath ? toBeepUrl(seg.mtlPath) : null
                })) : null

                logger.debug(
                    `Opening the model preview of ${actualObjPath} (${mtlUrl ? "with" : "without"} MTL, ${segmentsWithUrls?.length || 0} segments)`,
                )

                // Create the preview window with model data
                createModelPreviewWindow({
                    objPath: actualObjPath,
                    objUrl,
                    mtlUrl,
                    title: title || "Model Preview",
                    segments: segmentsWithUrls,
                })
                return { success: true }
            } catch (error) {
                console.error(
                    `Failed to show the model preview of ${objPath}:`,
                    error,
                )
                throw error
            }
        },
    )

    // Register icon file browse handler (for staging)
    ipcMain.handle("browse-for-icon-file", async (event) => {
        try {
            const result = await dialog.showOpenDialog(mainWindow, {
                title: "Select Icon File",
                properties: ["openFile"],
                filters: [
                    {
                        name: "Image Files",
                        extensions: ["png", "jpg", "jpeg", "tga", "vtf"],
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
            const fileExt = path.extname(fileName).toLowerCase()

            const validExtensions = [".png", ".jpg", ".jpeg", ".tga", ".vtf"]
            if (!validExtensions.includes(fileExt)) {
                throw new Error(
                    "Selected file must be an image file (PNG, JPG, TGA, or VTF)",
                )
            }

            return {
                success: true,
                filePath: selectedFilePath,
                fileName: fileName,
            }
        } catch (error) {
            console.error("Failed to browse for icon file:", error)
            return { success: false, error: error.message }
        }
    })

    // Register icon browse handler (with immediate save)
    ipcMain.handle("browse-for-icon", async (event, { itemId }) => {
        try {
            const item = packages
                .flatMap((p) => p.items)
                .find((i) => i.id === itemId)
            if (!item) {
                throw new Error("Item not found")
            }

            const result = await dialog.showOpenDialog(mainWindow, {
                title: "Select Icon File",
                properties: ["openFile"],
                filters: [
                    {
                        name: "Image Files",
                        extensions: ["png", "jpg", "jpeg", "tga", "vtf"],
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
            const fileExt = path.extname(fileName).toLowerCase()

            const validExtensions = [".png", ".jpg", ".jpeg", ".tga", ".vtf"]
            if (!validExtensions.includes(fileExt)) {
                throw new Error(
                    "Selected file must be an image file (PNG, JPG, TGA, or VTF)",
                )
            }

            // Get the current icon path or create a new one
            let targetIconPath
            if (item.icon && fs.existsSync(item.icon)) {
                const currentDir = path.dirname(item.icon)
                const currentBaseName = path.basename(
                    item.icon,
                    path.extname(item.icon),
                )
                targetIconPath = path.join(currentDir, currentBaseName + fileExt)

                if (item.icon !== targetIconPath && fs.existsSync(item.icon)) {
                    fs.unlinkSync(item.icon)
                }
            } else {
                const iconDir = path.join(
                    item.packagePath,
                    "resources",
                    "BEE2",
                    "items",
                    "beepkg",
                )
                if (!fs.existsSync(iconDir)) {
                    fs.mkdirSync(iconDir, { recursive: true })
                }
                const safeItemName = item.name
                    .replace(/[^a-zA-Z0-9_-]/g, "_")
                    .toLowerCase()
                targetIconPath = path.join(iconDir, safeItemName + fileExt)
            }

            fs.copyFileSync(selectedFilePath, targetIconPath)

            // Convert icon to VTF using item ID for unique path
            const { convertImageToVTF } = require("../utils/vtfConverter")
            const vtfPath = path.join(
                item.packagePath,
                `resources/materials/models/props_map_editor/palette/bpee/${item.id}`,
                `${item.id}.vtf`,
            )
            try {
                await convertImageToVTF(selectedFilePath, vtfPath, {
                    format: "DXT5",
                    generateMipmaps: true,
                })
                console.log(
                    `Converted ${fileName} to VTF for the icon of "${item.name}"`,
                )
            } catch (error) {
                console.error(
                    `Failed to convert the icon of "${item.name}" to VTF:`,
                    error,
                )
            }

            // Update the item's icon path in the properties file
            const propertiesPath = path.join(item.fullItemPath, "properties.json")
            if (fs.existsSync(propertiesPath)) {
                const properties = JSON.parse(fs.readFileSync(propertiesPath, "utf-8"))
                const bee2ItemsPath = path.join(
                    item.packagePath,
                    "resources",
                    "BEE2",
                    "items",
                )
                const relativePath = path.relative(bee2ItemsPath, targetIconPath)

                if (!properties.Properties) properties.Properties = {}
                if (!properties.Properties.Icon) properties.Properties.Icon = {}
                properties.Properties.Icon["0"] = relativePath.replace(/\\/g, "/")

                fs.writeFileSync(propertiesPath, JSON.stringify(properties, null, 2))
            }

            // Update editoritems.json to use item-specific palette path
            const editorItemsPath = path.join(item.fullItemPath, "editoritems.json")
            if (fs.existsSync(editorItemsPath)) {
                const editorItems = JSON.parse(fs.readFileSync(editorItemsPath, "utf-8"))
                const editor = editorItems.Item?.Editor
                if (editor?.SubType) {
                    const subType = Array.isArray(editor.SubType)
                        ? editor.SubType[0]
                        : editor.SubType

                    if (!subType.Palette) subType.Palette = {}
                    subType.Palette.Image = `palette/bpee/${item.id}/${item.id}`

                    fs.writeFileSync(editorItemsPath, JSON.stringify(editorItems, null, 2))
                }
            }

            // Reload the item to get updated data
            const updatedItemInstance = new Item({
                packagePath: item.packagePath,
                itemJSON: loadOriginalItemJSON(item.packagePath, item.id),
            })
            const updatedItem = updatedItemInstance.toJSON()

            mainWindow.webContents.send("item-updated", updatedItem)
            sendItemUpdateToEditor(itemId, updatedItem)

            return { success: true, iconPath: targetIconPath }
        } catch (error) {
            console.error(`Failed to set the icon of item ${itemId}:`, error)
            dialog.showErrorBox(
                "Failed to Set Icon",
                `Could not set icon: ${error.message}`,
            )
            return { success: false, error: error.message }
        }
    })
}

module.exports = { register }
