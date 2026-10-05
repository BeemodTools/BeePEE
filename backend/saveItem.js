const fs = require("fs")
const path = require("path")
const {
    convertImageToVTF,
    getVTFPathFromImagePath,
    updateEditorItemsWithVTF,
} = require("./utils/vtfConverter")

/**
 * Handles VTF conversion for palette images referenced in editoritems.json
 * Uses the item ID for unique paths: palette/bpee/{itemId}/{itemId}
 * @param {Object} editorItems - The editoritems JSON object
 * @param {string} iconPath - Path to the icon file that was just saved
 * @param {string} packagePath - Path to the package directory
 * @param {string} editorItemsPath - Path to the editoritems.json file
 * @param {string} itemId - The item's unique ID
 */
async function handleVTFConversion(
    editorItems,
    iconPath,
    packagePath,
    editorItemsPath,
    itemId,
) {
    const editor = editorItems.Item?.Editor
    if (!editor?.SubType) return

    const subType = Array.isArray(editor.SubType)
        ? editor.SubType[0]
        : editor.SubType

    // Use item ID for unique VTF path
    const vtfPath = path.join(
        packagePath,
        "resources",
        "materials",
        "models",
        "props_map_editor",
        "palette",
        "bpee",
        itemId,
        `${itemId}.vtf`,
    )

    try {
        // Convert the icon to VTF format
        await convertImageToVTF(iconPath, vtfPath, {
            format: "DXT5",
            generateMipmaps: true,
        })

        // Update editoritems to use the item-specific path
        if (!subType.Palette) subType.Palette = {}
        subType.Palette.Image = `palette/bpee/${itemId}/${itemId}`

        console.log(`Converted the palette icon to ${vtfPath}`)
    } catch (error) {
        // The caller logs the error with its stack
        console.error(`Failed to convert ${iconPath} to VTF: ${error.message}`)
        throw error
    }
}

/**
 * A description as VDF JSON keeps it: a string, or with several lines,
 * "desc_N" keys (properties.txt's and info.txt's repeated "" keys). A raw
 * string containing newlines would produce invalid VDF on export, which
 * hangs BEEmod on startup.
 */
function descriptionValue(description) {
    if (typeof description !== "string" || !/\r?\n/.test(description)) {
        return description
    }
    const lines = {}
    description.split(/\r?\n/).forEach((line, index) => {
        lines[`desc_${index}`] = line
    })
    return lines
}

/**
 * Save the item's description in info.json, where info.txt's is: its "Item"
 * block's "Description" (for all of its styles)
 */
function saveInfoDescription(packagePath, itemId, description) {
    const infoPath = path.join(packagePath, "info.json")
    const info = JSON.parse(fs.readFileSync(infoPath, "utf-8"))
    const keyOf = (object, key) =>
        Object.keys(object).find((k) => k.toLowerCase() === key.toLowerCase())
    const itemsKey = keyOf(info, "Item")
    const block = itemsKey
        ? [info[itemsKey]]
              .flat()
              .find((each) => each && each[keyOf(each, "ID")] === itemId)
        : null
    if (!block) throw new Error(`info.json has no item ${itemId}`)
    const value = descriptionValue(description)
    block[keyOf(block, "Description") ?? "Description"] = value
    fs.writeFileSync(infoPath, JSON.stringify(info, null, 4))
    return value
}

async function saveItem(item) {
    // Get the item's editor items and properties files
    const editorItemsPath = path.join(item.fullItemPath, "editoritems.json")
    const propertiesPath = path.join(item.fullItemPath, "properties.json")

    // Check if files exist
    if (!fs.existsSync(editorItemsPath)) {
        throw new Error(`Editor items file not found: ${editorItemsPath}`)
    }
    if (!fs.existsSync(propertiesPath)) {
        throw new Error(`Properties file not found: ${propertiesPath}`)
    }

    // Read current files
    let editorItems, properties
    try {
        editorItems = JSON.parse(fs.readFileSync(editorItemsPath, "utf-8"))
    } catch (error) {
        throw new Error(`Failed to read editor items: ${error.message}`)
    }

    try {
        properties = JSON.parse(fs.readFileSync(propertiesPath, "utf-8"))
    } catch (error) {
        throw new Error(`Failed to read properties: ${error.message}`)
    }

    // Validate file structure
    if (!editorItems?.Item?.Editor?.SubType) {
        throw new Error(
            "This item has no Editor block in its editoritems (BEE2 uses it itself; it's never in the palette), so it can't be saved here",
        )
    }
    if (!properties?.Properties) {
        throw new Error("Invalid properties format")
    }

    // Update editor items
    if (Array.isArray(editorItems.Item.Editor.SubType)) {
        editorItems.Item.Editor.SubType[0].Name = item.name
    } else {
        editorItems.Item.Editor.SubType.Name = item.name
    }

    // Update MovementHandle if provided
    if (item.movementHandle) {
        editorItems.Item.Editor.MovementHandle = item.movementHandle
    }

    // Update properties
    properties.Properties = {
        ...properties.Properties,
        ...item.details,
    }

    // The editor sends Description as a plain (possibly multiline) string
    properties.Properties.Description = descriptionValue(
        properties.Properties.Description,
    )
    if (properties.Properties.Description === undefined) {
        delete properties.Properties.Description
    }

    // Handle staged icon if provided
    if (item.iconData && item.iconData.stagedIconPath) {
        try {
            const stagedIconPath = item.iconData.stagedIconPath
            const stagedIconName = item.iconData.stagedIconName

            if (fs.existsSync(stagedIconPath)) {
                const fileExt = path.extname(stagedIconName).toLowerCase()

                // Get the current icon path or create a new one
                const packagePath = path.dirname(
                    path.dirname(item.fullItemPath),
                )
                let targetIconPath

                // Check if item already has an icon
                const currentIconPath = properties.Properties.Icon?.["0"]
                if (currentIconPath) {
                    // Replace existing icon - keep same directory but update extension if needed
                    const bee2ItemsPath = path.join(
                        packagePath,
                        "resources",
                        "BEE2",
                        "items",
                    )
                    const currentFullPath = path.join(
                        bee2ItemsPath,
                        currentIconPath,
                    )
                    const currentDir = path.dirname(currentFullPath)
                    const currentBaseName = path.basename(
                        currentFullPath,
                        path.extname(currentFullPath),
                    )
                    targetIconPath = path.join(
                        currentDir,
                        currentBaseName + fileExt,
                    )

                    // Delete the old icon file if it's different from the new target
                    if (
                        currentFullPath !== targetIconPath &&
                        fs.existsSync(currentFullPath)
                    ) {
                        fs.unlinkSync(currentFullPath)
                    }
                } else {
                    // Create new icon path - use item name as filename in the BEE2/items structure
                    const iconDir = path.join(
                        packagePath,
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

                // Copy the staged icon file to the target location
                fs.copyFileSync(stagedIconPath, targetIconPath)

                // Update the properties file with the new icon path (relative to resources/BEE2/items/)
                const bee2ItemsPath = path.join(
                    packagePath,
                    "resources",
                    "BEE2",
                    "items",
                )
                const relativePath = path.relative(
                    bee2ItemsPath,
                    targetIconPath,
                )

                if (!properties.Properties.Icon) properties.Properties.Icon = {}
                properties.Properties.Icon["0"] = relativePath.replace(
                    /\\/g,
                    "/",
                )

                console.log(
                    `Updated the icon of "${item.name}": ${targetIconPath}`,
                )

                // Also convert to VTF and update editoritems.json if the item uses palette images
                try {
                    await handleVTFConversion(
                        editorItems,
                        targetIconPath,
                        packagePath,
                        editorItemsPath,
                        item.id,
                    )
                } catch (error) {
                    console.error(
                        `Failed to make the palette icon of "${item.name}", saving without it:`,
                        error,
                    )
                    // Don't throw here - let the save continue even if VTF conversion fails
                }
            } else {
                console.warn(
                    `Skipped the new icon of "${item.name}", its file is missing: ${stagedIconPath}`,
                )
            }
        } catch (error) {
            console.error(`Failed to update the icon of "${item.name}":`, error)
            // Don't throw here - let the save continue even if icon fails
        }
    }

    // Save the files
    let infoDescription
    try {
        fs.writeFileSync(editorItemsPath, JSON.stringify(editorItems, null, 4))
        fs.writeFileSync(propertiesPath, JSON.stringify(properties, null, 4))
        // The description the editor showed from info.txt
        if (typeof item.infoDescription === "string") {
            infoDescription = saveInfoDescription(
                item.packagePath ||
                    path.dirname(path.dirname(item.fullItemPath)),
                item.id,
                item.infoDescription,
            )
        }

        // Update metadata lastModified timestamp if item has metadata
        if (item.metadata) {
            const metaPath = path.join(item.fullItemPath, "meta.json")
            if (fs.existsSync(metaPath)) {
                try {
                    const metadata = JSON.parse(
                        fs.readFileSync(metaPath, "utf-8"),
                    )
                    metadata.lastModified = new Date().toISOString()
                    fs.writeFileSync(
                        metaPath,
                        JSON.stringify(metadata, null, 4),
                    )
                } catch (error) {
                    console.warn(
                        `Failed to update the modified time in the meta.json of "${item.name}":`,
                        error,
                    )
                }
            }
        }
    } catch (error) {
        throw new Error(`Failed to write files: ${error.message}`)
    }

    return { editorItems, properties, infoDescription }
}

module.exports = { saveItem }
