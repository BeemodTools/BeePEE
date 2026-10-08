/**
 * Basic application handlers - file dialogs, app info, package status
 */

const { dialog, app, BrowserWindow } = require("electron")
const fs = require("fs")
const { packages, loadPackage, getCurrentPackageDir } = require("../packageManager")

function register(ipcMain, mainWindow) {
    // Show open dialog - resolves Electron's { canceled, filePaths }. It's
    // attached to the window that asked (e.g. a signage editor), so that
    // window, not the main one, is in front again after picking a file.
    ipcMain.handle("show-open-dialog", async (event, options) => {
        const win = BrowserWindow.fromWebContents(event.sender) || mainWindow
        return dialog.showOpenDialog(win, options)
    })

    // Check if file exists
    // Note: Frontend may pass filePath directly or wrapped in object
    ipcMain.handle("check-file-exists", async (event, arg) => {
        try {
            // Support both formats: direct filePath string or { filePath } object
            const filePath = typeof arg === 'string' ? arg : arg?.filePath
            return fs.existsSync(filePath)
        } catch (error) {
            console.error("Failed to check whether a file exists:", error)
            return false
        }
    })

    // Get app version
    ipcMain.handle("get-app-version", () => {
        return app.getVersion()
    })

    // Set unsaved changes indicator
    // Note: Frontend passes hasChanges directly (not wrapped in object)
    ipcMain.handle("set-unsaved-changes", async (event, hasChanges) => {
        if (global.titleManager) {
            global.titleManager.setUnsavedChanges(hasChanges)
        }
        return { success: true }
    })

    // Reload package from disk
    ipcMain.handle("reload-package", async () => {
        try {
            const currentPackageDir = getCurrentPackageDir()
            if (!currentPackageDir) {
                return { success: false, error: "No package loaded" }
            }

            const infoPath = require("path").join(currentPackageDir, "info.json")
            const pkg = await loadPackage(infoPath)

            // Send updated items and signages to main window
            mainWindow.webContents.send("package:loaded", {
                items: pkg.items.map((item) => item.toJSONWithExistence()),
                signages: pkg.signages,
            })

            return { success: true }
        } catch (error) {
            return { success: false, error: error.message }
        }
    })

    // Check if package is loaded
    // Note: Returns boolean for compatibility with old code
    ipcMain.handle("check-package-loaded", async () => {
        const currentPackageDir = getCurrentPackageDir()
        return !!currentPackageDir
    })

    // Get current items
    // Note: Returns array directly for compatibility with old code
    ipcMain.handle("get-current-items", async () => {
        try {
            if (packages.length === 0) {
                return []
            }
            const currentPackage = packages[0]
            return currentPackage.items.map((item) =>
                item.toJSONWithExistence(),
            )
        } catch (error) {
            console.error("Failed to get current items:", error)
            return []
        }
    })

    // Get current signages
    ipcMain.handle("get-current-signages", async () => {
        try {
            if (packages.length === 0) {
                return []
            }
            const currentPackage = packages[0]
            return currentPackage.signages || []
        } catch (error) {
            console.error("Failed to get current signages:", error)
            return []
        }
    })
}

module.exports = { register }
