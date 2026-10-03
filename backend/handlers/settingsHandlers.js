/**
 * Settings-related IPC handlers
 * Handles app settings like Portal 2 path, BEEMod path, etc.
 */

const fs = require("fs")
const path = require("path")
const { dialog } = require("electron")
const { loadSettings, saveSettings, getSetting, setSetting, deleteAllSettings } = require("../utils/settings")
const { findPortal2Dir } = require("../data")
const { closeSetupWindow, closeSettingsWindow } = require("../items/itemEditor")

// Some settings affect the running app immediately, not just future reads
function applySettingSideEffects(key, value) {
    try {
        if (key === "verboseLogging") {
            require("../utils/logger").logger.setVerbose(value)
        } else if (key === "devMode") {
            // Dev menu is part of the menu template - rebuild it
            require("../menu").rebuildMenu()
        }
    } catch (err) {
        console.warn(`Failed to apply the ${key} setting:`, err)
    }
}

function register(ipcMain, mainWindow) {
    // Get all settings
    ipcMain.handle("get-settings", async () => {
        try {
            const settings = loadSettings()
            return { success: true, settings }
        } catch (error) {
            return { success: false, error: error.message }
        }
    })

    // Save all settings
    ipcMain.handle("save-settings", async (event, settings) => {
        try {
            const result = saveSettings(settings)
            return { success: result }
        } catch (error) {
            return { success: false, error: error.message }
        }
    })

    // Get specific setting
    ipcMain.handle("get-setting", async (event, { key, defaultValue }) => {
        try {
            const value = getSetting(key, defaultValue)
            return { success: true, value }
        } catch (error) {
            return { success: false, error: error.message }
        }
    })

    // Set specific setting
    ipcMain.handle("set-setting", async (event, { key, value }) => {
        try {
            const result = setSetting(key, value)
            if (result) applySettingSideEffects(key, value)
            return { success: result }
        } catch (error) {
            return { success: false, error: error.message }
        }
    })

    // Check if setup is complete
    ipcMain.handle("check-setup-complete", async () => {
        try {
            const setupComplete = getSetting("setupComplete", false)
            const beemodPath = getSetting("beemodPath", null)

            // Setup is complete if the flag is set AND beemodPath exists
            return {
                success: true,
                setupComplete: setupComplete && beemodPath !== null,
                beemodPath
            }
        } catch (error) {
            return { success: false, setupComplete: false, error: error.message }
        }
    })

    // Get Portal 2 path (auto-detect or from settings)
    ipcMain.handle("get-portal2-path", async () => {
        try {
            // First check if user has set a manual override
            const manualPath = getSetting("portal2Path", null)
            if (manualPath && fs.existsSync(manualPath)) {
                return {
                    success: true,
                    path: manualPath,
                    source: "manual",
                    canAutoDetect: false
                }
            }

            // Try to auto-detect from Steam registry
            const autoPath = await findPortal2Dir(console)
            if (autoPath && fs.existsSync(autoPath)) {
                return {
                    success: true,
                    path: autoPath,
                    source: "auto",
                    canAutoDetect: true
                }
            }

            // Could not find Portal 2
            return {
                success: true,
                path: null,
                source: null,
                canAutoDetect: false
            }
        } catch (error) {
            return { success: false, error: error.message, path: null, canAutoDetect: false }
        }
    })

    // Set Portal 2 path manually
    ipcMain.handle("set-portal2-path", async (event, { path: portal2Path }) => {
        try {
            if (portal2Path && !fs.existsSync(portal2Path)) {
                return { success: false, error: "Path does not exist" }
            }

            // Validate it looks like a Portal 2 installation
            if (portal2Path) {
                const gameinfoPath = path.join(portal2Path, "portal2", "gameinfo.txt")
                if (!fs.existsSync(gameinfoPath)) {
                    return { success: false, error: "This does not appear to be a valid Portal 2 installation (gameinfo.txt not found)" }
                }
            }

            const result = setSetting("portal2Path", portal2Path)
            return { success: result }
        } catch (error) {
            return { success: false, error: error.message }
        }
    })

    // Get BEEMod path
    ipcMain.handle("get-beemod-path", async () => {
        try {
            const beemodPath = getSetting("beemodPath", null)
            return { success: true, path: beemodPath }
        } catch (error) {
            return { success: false, error: error.message }
        }
    })

    // Set BEEMod path
    ipcMain.handle("set-beemod-path", async (event, { path: beemodPath }) => {
        try {
            if (beemodPath && !fs.existsSync(beemodPath)) {
                return { success: false, error: "Path does not exist" }
            }

            // Validate it looks like a BEEMod installation
            if (beemodPath) {
                // Look for BEE2.exe or packages folder as validation
                const bee2Exe = path.join(beemodPath, "BEE2.exe")
                const packagesDir = path.join(beemodPath, "packages")

                if (!fs.existsSync(bee2Exe) && !fs.existsSync(packagesDir)) {
                    return { success: false, error: "This does not appear to be a valid BEEMod installation (BEE2.exe or packages folder not found)" }
                }
            }

            const result = setSetting("beemodPath", beemodPath)
            return { success: result }
        } catch (error) {
            return { success: false, error: error.message }
        }
    })

    // Complete setup
    ipcMain.handle("complete-setup", async (event, { portal2Path, beemodPath }) => {
        try {
            // Validate BEEMod path is provided
            if (!beemodPath) {
                return { success: false, error: "BEEMod path is required" }
            }

            // Save Portal 2 path if provided (only needed if auto-detect fails)
            if (portal2Path) {
                const p2Result = setSetting("portal2Path", portal2Path)
                if (!p2Result) {
                    return { success: false, error: "Failed to save Portal 2 path" }
                }
            }

            // Save BEEMod path
            const beeResult = setSetting("beemodPath", beemodPath)
            if (!beeResult) {
                return { success: false, error: "Failed to save BEEMod path" }
            }

            // Mark setup as complete
            const setupResult = setSetting("setupComplete", true)
            if (!setupResult) {
                return { success: false, error: "Failed to mark setup as complete" }
            }

            return { success: true }
        } catch (error) {
            return { success: false, error: error.message }
        }
    })

    // Browse for Portal 2 directory
    ipcMain.handle("browse-portal2-path", async () => {
        try {
            const result = await dialog.showOpenDialog(mainWindow, {
                title: "Select Portal 2 Installation Directory",
                properties: ["openDirectory"],
                buttonLabel: "Select Portal 2 Folder"
            })

            if (result.canceled || result.filePaths.length === 0) {
                return { success: true, path: null, canceled: true }
            }

            const selectedPath = result.filePaths[0]

            // Validate it looks like a Portal 2 installation
            const gameinfoPath = path.join(selectedPath, "portal2", "gameinfo.txt")
            if (!fs.existsSync(gameinfoPath)) {
                return {
                    success: false,
                    error: "This does not appear to be a valid Portal 2 installation. Please select the folder containing the Portal 2 game files (should have a 'portal2' subfolder)."
                }
            }

            return { success: true, path: selectedPath, canceled: false }
        } catch (error) {
            return { success: false, error: error.message }
        }
    })

    // Browse for BEEMod directory
    ipcMain.handle("browse-beemod-path", async () => {
        try {
            const result = await dialog.showOpenDialog(mainWindow, {
                title: "Select BEEMod Installation Directory",
                properties: ["openDirectory"],
                buttonLabel: "Select BEEMod Folder"
            })

            if (result.canceled || result.filePaths.length === 0) {
                return { success: true, path: null, canceled: true }
            }

            const selectedPath = result.filePaths[0]

            // Validate it looks like a BEEMod installation
            const bee2Exe = path.join(selectedPath, "BEE2.exe")
            const packagesDir = path.join(selectedPath, "packages")

            if (!fs.existsSync(bee2Exe) && !fs.existsSync(packagesDir)) {
                return {
                    success: false,
                    error: "This does not appear to be a valid BEEMod installation. Please select the BEEMod folder containing BEE2.exe or the packages folder."
                }
            }

            return { success: true, path: selectedPath, canceled: false }
        } catch (error) {
            return { success: false, error: error.message }
        }
    })

    // Close setup window
    ipcMain.handle("close-setup-window", async () => {
        try {
            closeSetupWindow()
            return { success: true }
        } catch (error) {
            return { success: false, error: error.message }
        }
    })

    // Close settings window
    ipcMain.handle("close-settings-window", async () => {
        try {
            closeSettingsWindow()
            return { success: true }
        } catch (error) {
            return { success: false, error: error.message }
        }
    })

    // Delete all settings. Wiping settings clears setupComplete, so the app
    // restarts into the setup page. An open package is saved first (to the
    // .bpee it came from / was last saved to, or one the user picks) and
    // reopened automatically once setup finishes.
    ipcMain.handle("delete-all-settings", async () => {
        try {
            const { app, BrowserWindow } = require("electron")
            // Lazy require: packageManager pulls in other modules at load time
            const {
                getCurrentPackageDir,
                getCurrentPackageSourcePath,
                savePackageAsBpee,
            } = require("../packageManager")
            const { getLastSavedBpeePath } = require("./shared")

            let reopenPath = null
            const currentPackageDir = getCurrentPackageDir()
            if (currentPackageDir) {
                let target =
                    getLastSavedBpeePath() || getCurrentPackageSourcePath()
                // Imported/zip sources can't be written back as a .bpee
                if (target && !/\.bpee$/i.test(target)) target = null
                if (!target) {
                    const { canceled, filePath } = await dialog.showSaveDialog(
                        BrowserWindow.getFocusedWindow(),
                        {
                            title: "Save Package Before Reset",
                            defaultPath: path.join(
                                app.getPath("documents"),
                                "package.bpee",
                            ),
                            filters: [
                                { name: "BeePEE Package", extensions: ["bpee"] },
                            ],
                        },
                    )
                    if (!canceled && filePath) target = filePath
                }
                if (target) {
                    await savePackageAsBpee(currentPackageDir, target)
                    reopenPath = target
                }
            }

            const result = deleteAllSettings()
            if (result && reopenPath) {
                // Recreate settings.json with just the reopen pointer -
                // setupComplete stays absent, so setup still shows
                setSetting("pendingReopenPackage", reopenPath)
            }
            if (result) {
                // Give the IPC reply a moment to reach the renderer
                setTimeout(() => {
                    app.relaunch()
                    app.exit(0)
                }, 400)
            }
            return { success: result }
        } catch (error) {
            return { success: false, error: error.message }
        }
    })
}

module.exports = { register }
