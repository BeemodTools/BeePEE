/**
 * Shared state and helper functions for IPC handlers
 */

const { BrowserWindow, dialog, nativeImage } = require("electron")
const fs = require("fs")
const path = require("path")
const { saveItem } = require("../saveItem")
const { Item } = require("../models/items")
const {
    packages,
    getLastSavedBpeePath,
    setLastSavedBpeePath,
} = require("../packageManager")
const { sendItemUpdateToEditor } = require("../items/itemEditor")
const { logger } = require("../utils/logger")
const { imageDataUrl } = require("../utils/imageDataUrl")

// Track open preview windows to prevent duplicates
const openPreviewWindows = new Map()

/**
 * Helper to load original itemJSON from info.json
 */
function loadOriginalItemJSON(packagePath, itemId) {
    // Try to find info.json in the packagePath or its parent
    let infoPath = fs.existsSync(path.join(packagePath, "info.json"))
        ? path.join(packagePath, "info.json")
        : path.join(path.dirname(packagePath), "info.json")
    if (!fs.existsSync(infoPath)) {
        throw new Error(`info.json not found for package: ${packagePath}`)
    }
    const parsedInfo = JSON.parse(fs.readFileSync(infoPath, "utf-8"))
    let rawitems = parsedInfo["Item"]
    if (!rawitems) throw new Error("Invalid package format - no items found")
    if (!Array.isArray(rawitems)) rawitems = [rawitems]
    const found = rawitems.find((el) => el.ID === itemId)
    if (!found) throw new Error(`Item with ID ${itemId} not found in info.json`)
    return found
}

/** The icon preview's page: the icon, as big as the window lets it be */
const ICON_PREVIEW_PAGE = `<!DOCTYPE html>
<html>
<head>
    <meta name="viewport" content="width=device-width" />
    <title>Icon Preview</title>
    <style>
        html, body { height: 100%; margin: 0; }
        body {
            box-sizing: border-box;
            padding: 20px;
            background: #2d2d2d;
            display: flex;
            justify-content: center;
            align-items: center;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            color: #ff6666;
        }
        img {
            width: min(100%, calc(100vh - 40px));
            aspect-ratio: 1;
            object-fit: contain;
            border: 1px solid #555;
            background: #fff;
            image-rendering: pixelated;
        }
    </style>
</head>
<body><img id="icon" alt="" /></body>
</html>`

/** Show the icon file as it is now in a preview window */
function showPreviewIcon(previewWindow, iconPath) {
    let script
    try {
        const src = JSON.stringify(imageDataUrl(iconPath))
        script = `document.getElementById("icon").src = ${src}`
    } catch (error) {
        console.error(`Failed to read the icon ${iconPath}:`, error)
        const message = JSON.stringify(`Can't show the icon: ${error.message}`)
        script = `document.body.textContent = ${message}`
    }
    previewWindow.webContents.executeJavaScript(script).catch(() => {})
}

/**
 * Create an icon preview window (or bring the icon's to the front, with the
 * icon as its file is now)
 */
function createIconPreviewWindow(iconPath, itemName, parentWindow) {
    const existingWindow = openPreviewWindows.get(iconPath)
    if (existingWindow && !existingWindow.isDestroyed()) {
        if (existingWindow.isMinimized()) existingWindow.restore()
        existingWindow.show()
        existingWindow.focus()
        showPreviewIcon(existingWindow, iconPath)
        return
    }
    openPreviewWindows.delete(iconPath)
    console.log(`Opening the icon preview of ${iconPath}`)

    const title = itemName ? `${itemName} - Icon Preview` : `Icon Preview`
    // The icon as the window's icon (a PNG or the like)
    const windowIcon = nativeImage.createFromPath(iconPath)

    const previewWindow = new BrowserWindow({
        width: 296, // 256 + 40px padding for window chrome
        height: 336, // 256 + 80px for title bar and padding
        minWidth: 160,
        minHeight: 200,
        resizable: true,
        minimizable: false,
        title: title,
        alwaysOnTop: true, // Keep preview on top without parent relationship
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
        ...(windowIcon.isEmpty() ? {} : { icon: windowIcon }),
    })

    // Track the window
    openPreviewWindows.set(iconPath, previewWindow)

    // Clean up when window is closed
    previewWindow.on("closed", () => {
        if (openPreviewWindows.get(iconPath) === previewWindow) {
            openPreviewWindows.delete(iconPath)
        }
    })

    // The icon goes in once the page is there (big icons don't fit in the
    // page's data: URL)
    previewWindow.webContents.on("did-finish-load", () =>
        showPreviewIcon(previewWindow, iconPath),
    )
    previewWindow.loadURL(
        `data:text/html;charset=UTF-8,${encodeURIComponent(ICON_PREVIEW_PAGE)}`,
    )

    // Remove menu bar
    previewWindow.setMenuBarVisibility(false)
}

// NOTE: createModelPreviewWindow has been moved to backend/items/itemEditor.js
// to follow the same pattern as other windows (ItemEditor, CreateItemPage, etc.)

/**
 * Handle item save logic - shared by multiple handlers
 */
async function handleItemSave(item, event, mainWindow) {
    try {
        return await logger.section(`Saving item "${item?.name}"`, async () => {
            // Validate input
            if (!item?.fullItemPath) {
                throw new Error("Invalid item path")
            }
            if (!item?.name?.trim()) {
                throw new Error("Item name cannot be empty")
            }

            // Use the new saveItem function to handle file operations
            const { editorItems, properties, infoDescription } =
                await saveItem(item)

            // Find the current item instance in memory to get the most up-to-date data
            const packagePath =
                item.packagePath || path.dirname(path.dirname(item.fullItemPath))

            // Try to find the existing item instance first
            let updatedItemInstance = packages
                .flatMap((p) => p.items)
                .find((i) => i.id === item.id)

            if (updatedItemInstance) {
                // Reload the item's data from disk to get the latest changes
                updatedItemInstance.reloadItemData()
                // Its colors' group (BEE2's ItemVar menu) goes by its name
                const colors = updatedItemInstance.getColorCount()
                if (colors > 0) updatedItemInstance.saveColorCount(colors)
                if (infoDescription !== undefined) {
                    updatedItemInstance.infoDescription = infoDescription
                }

                // Update the icon path if it was changed during save
                if (item.iconData && item.iconData.stagedIconPath) {
                    const bee2ItemsPath = path.join(
                        packagePath,
                        "resources",
                        "BEE2",
                        "items",
                    )
                    const relativePath = path.relative(
                        bee2ItemsPath,
                        item.iconData.stagedIconPath,
                    )
                    updatedItemInstance.icon = item.iconData.stagedIconPath
                }
            } else {
                // Fallback: reconstruct from disk if not found in memory
                let itemJSON
                try {
                    itemJSON = loadOriginalItemJSON(packagePath, item.id)
                } catch (e) {
                    // fallback to minimal itemJSON if info.json is missing or item not found
                    const itemFolder =
                        item.itemFolder || path.basename(item.fullItemPath)
                    itemJSON = {
                        ID: item.id,
                        Version: { Styles: { BEE2_CLEAN: itemFolder } },
                    }
                }
                updatedItemInstance = new Item({ packagePath, itemJSON })
            }

            const updatedItem = updatedItemInstance.toJSONWithExistence()

            logger.debug(
                `Saved item ${updatedItem.id} (icon ${updatedItem.icon}${item.iconData ? ", changed" : ""})`,
            )

            // Send the updated item data to both windows
            event.sender.send("item-updated", updatedItem) // Send to editor window
            mainWindow.webContents.send("item-updated", updatedItem) // Send to main window

            // Also notify the editor window through the dedicated function
            sendItemUpdateToEditor(item.id, updatedItem)

            // The item is saved into the WORKING package, which now differs
            // from the .bpee on disk — the main window stays starred until
            // File > Save Package writes the actual file
            if (global.titleManager) {
                global.titleManager.setUnsavedChanges(true)
            }

            return { success: true }
        })
    } catch (error) {
        console.error(`Failed to save item "${item?.name}":`, error)
        dialog.showErrorBox(
            "Save Failed",
            `Failed to save item: ${error.message}\n\nPlease check the file permissions and try again.`,
        )
        throw error
    }
}

module.exports = {
    getLastSavedBpeePath,
    setLastSavedBpeePath,
    openPreviewWindows,
    loadOriginalItemJSON,
    createIconPreviewWindow,
    handleItemSave,
}
