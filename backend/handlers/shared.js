/**
 * Shared state and helper functions for IPC handlers
 */

const { BrowserWindow, dialog } = require("electron")
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

/**
 * Create an icon preview window
 */
function createIconPreviewWindow(iconPath, itemName, parentWindow) {
    // If a preview window is already open for this icon, focus it instead
    if (openPreviewWindows.has(iconPath)) {
        const existingWindow = openPreviewWindows.get(iconPath)
        if (!existingWindow.isDestroyed()) {
            existingWindow.focus()
            return
        }
        // Window was destroyed, remove from map
        openPreviewWindows.delete(iconPath)
    }

    const title = itemName ? `${itemName} - Icon Preview` : `Icon Preview`

    const previewWindow = new BrowserWindow({
        width: 296, // 256 + 40px padding for window chrome
        height: 336, // 256 + 80px for title bar and padding
        resizable: false,
        maximizable: false,
        minimizable: false,
        title: title,
        alwaysOnTop: true, // Keep preview on top without parent relationship
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false, // Allow loading local files
        },
        icon: iconPath, // Set the window icon to the preview image
    })

    // Track the window
    openPreviewWindows.set(iconPath, previewWindow)

    // Clean up when window is closed
    previewWindow.on("closed", () => {
        openPreviewWindows.delete(iconPath)
    })

    // Create simple HTML to display the image
    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Icon Preview</title>
        <style>
            body {
                margin: 0;
                padding: 20px;
                background: #2d2d2d;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: calc(100vh - 40px);
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            }
            img {
                width: 256px;
                height: 256px;
                object-fit: contain;
                border: 1px solid #555;
                background: #fff;
                image-rendering: pixelated;
            }
        </style>
    </head>
    <body>
        <img src="file://${iconPath.replace(/\\/g, "/")}" alt="Icon Preview" />
    </body>
    </html>
    `

    // Load the HTML content
    previewWindow.loadURL(
        `data:text/html;charset=UTF-8,${encodeURIComponent(htmlContent)}`,
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
            const { editorItems, properties } = await saveItem(item)

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
