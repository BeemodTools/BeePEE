const { Menu, shell } = require("electron")
const {
    loadPackage,
    importPackage,
    savePackageAsBpee,
    exportPackageAsBeePack,
    clearPackagesDirectory,
    closePackage,
    getCurrentPackageDir,
    getCurrentPackageSourcePath,
    getLastSavedBpeePath,
    setLastSavedBpeePath,
    showPackageOpenError,
} = require("./packageManager")
const { app, dialog, BrowserWindow } = require("electron")
const path = require("path")
const fs = require("fs")
const { exec } = require("child_process")

// Helper to kill BEE2.exe process if running
function killBeemod() {
    return new Promise((resolve) => {
        exec('taskkill /F /IM BEE2.exe', (err) => {
            // Ignore errors (process might not be running)
            if (err) {
                console.log(
                    "BEE2.exe isn't running or couldn't be closed:",
                    err.message,
                )
            } else {
                console.log("Closed BEE2.exe before exporting")
            }
            // Small delay to ensure file locks are released
            setTimeout(resolve, 500)
        })
    })
}
const {
    createPackageCreationWindow,
    createPackageInformationWindow,
    createChangelogWindow,
    createCrashReportWindow,
    createSettingsWindow,
} = require("./items/itemEditor")
const { isDev } = require("./utils/isDev.js")
const { ensurePackagesDir } = require("./utils/packagesDir")
const { logger } = require("./utils/logger")
const { getSetting } = require("./utils/settings")
const {
    BEEPM_DOWNLOAD_URL,
    isBeePmInstalled,
    publishWithBeePm,
    beePmLogin,
} = require("./utils/beePmApp")
const {
    readAuthor,
    setAuthorIfNone,
    authorNames,
} = require("./utils/packageAuthor")
const { bee2ExportFolder } = require("./utils/bee2Packages")

// Window the menu was built for (needed to rebuild when settings change)
let menuMainWindow = null

// Menu items that only make sense with a package loaded
const PACKAGE_MENU_IDS = [
    "close-package",
    "save-package",
    "save-package-as",
    "export-package",
    "export-beepm",
    "package-information",
    "import-items",
]

// Enable/disable package-dependent menu items based on whether a package is loaded
function updateMenuState() {
    const menu = Menu.getApplicationMenu()
    if (!menu) return
    const hasPackage = !!getCurrentPackageDir()
    for (const id of PACKAGE_MENU_IDS) {
        const item = menu.getMenuItemById(id)
        if (item) item.enabled = hasPackage
    }
}

// Rebuild the menu from scratch (e.g. when the devMode setting changes)
function rebuildMenu() {
    if (menuMainWindow && !menuMainWindow.isDestroyed()) {
        createMainMenu(menuMainWindow)
    }
}

// Helper to get the current package name for saving
function getCurrentPackageName() {
    const currentPackageDir = getCurrentPackageDir()
    if (currentPackageDir) {
        // Try to get the actual package name from info.json
        try {
            const infoPath = path.join(currentPackageDir, "info.json")
            if (fs.existsSync(infoPath)) {
                const packageInfo = JSON.parse(fs.readFileSync(infoPath, "utf-8"))
                if (packageInfo.Name) {
                    // Sanitize the name for use as filename
                    return packageInfo.Name.replace(/[^a-zA-Z0-9_ -]/g, "_")
                }
            }
        } catch (err) {
            // Fall back to folder name if info.json can't be read
        }
        return path.basename(currentPackageDir)
    }
    return "package"
}

// Save the working package to its .bpee. Falls back to the file the
// package was opened from, and only asks for a location when neither is
// known. Returns true when the file was actually written.
async function saveCurrentPackage(win) {
    const currentPackageDir = getCurrentPackageDir()
    if (!currentPackageDir) return false
    let target = getLastSavedBpeePath()
    if (!target) {
        const source = getCurrentPackageSourcePath?.()
        if (source && /\.bpee$/i.test(source)) target = source
    }
    if (!target) {
        const { canceled, filePath } = await dialog.showSaveDialog(win, {
            title: "Save Package As",
            defaultPath: getCurrentPackageName() + ".bpee",
            filters: [{ name: "BeePEE Package", extensions: ["bpee"] }],
        })
        if (canceled || !filePath) return false
        target = filePath
    }
    await savePackageAsBpee(currentPackageDir, target)
    setLastSavedBpeePath(target)
    // The .bpee now matches the working package
    global.titleManager?.setUnsavedChanges(false)
    return true
}

/**
 * Before the open package is closed or replaced by another one: when it has
 * changes not yet written to its .bpee (the "*" in the title), ask whether
 * to save them first, like quitting does
 * @param {string} discardLabel - The button that goes on without saving
 * @returns {Promise<boolean>} Whether to go on (not when cancelled, or when
 *   saving didn't happen)
 */
async function confirmUnsavedChanges(win, discardLabel) {
    if (!global.titleManager?.hasUnsavedChanges) return true
    const choice = dialog.showMessageBoxSync(win, {
        type: "warning",
        buttons: ["Cancel", discardLabel, "Save"],
        defaultId: 2,
        cancelId: 0,
        title: "Unsaved Changes",
        message: "Your package has unsaved changes.",
        detail: "Save writes them to the .bpee file first.",
    })
    if (choice === 0) return false
    if (choice === 1) return true
    try {
        // Not saved when Save As was cancelled
        return await saveCurrentPackage(win)
    } catch (err) {
        console.error("Failed to save the package:", err)
        dialog.showErrorBox("Save Failed", err.message)
        return false
    }
}

// Back the package up as a .bpee before it's exported, when that setting is
// on (the 10 newest are kept). A failed backup doesn't stop the export.
async function backupBeforeExport(currentPackageDir) {
    if (!getSetting("autoBackupBeforeExport", true)) return
    try {
        const backupsDir = path.join(app.getPath("userData"), "backups")
        fs.mkdirSync(backupsDir, { recursive: true })
        const stamp = new Date().toISOString().replace(/[:.]/g, "-")
        const backupPath = path.join(
            backupsDir,
            `${getCurrentPackageName()}-${stamp}.bpee`,
        )
        await savePackageAsBpee(currentPackageDir, backupPath)
        console.log(`Saved a backup before exporting: ${backupPath}`)

        // Keep only the 10 most recent backups
        const backups = fs
            .readdirSync(backupsDir)
            .filter((f) => f.endsWith(".bpee"))
            .map((f) => ({
                name: f,
                path: path.join(backupsDir, f),
                time: fs.statSync(path.join(backupsDir, f)).mtime.getTime(),
            }))
            .sort((a, b) => b.time - a.time)
        for (const old of backups.slice(10)) {
            try {
                fs.unlinkSync(old.path)
            } catch (err) {
                console.warn(`Failed to delete old backup ${old.name}:`, err)
            }
        }
    } catch (err) {
        console.warn("Failed to back up the package, exporting anyway:", err)
    }
}

// Before exporting to BeePM: the package's author against who's logged in to
// BeePM (who it'll be published under). Only a heads-up, since an author can
// be a display name, a team or credit someone else, and BeePM itself checks
// who may publish. Without a BeePM login there's nothing to check.
// Returns whether to go on.
async function authorFitsBeePmLogin(win, currentPackageDir) {
    const login = beePmLogin()
    if (!login) return true
    const { handle } = login
    const author = readAuthor(currentPackageDir)

    if (!author) {
        const { response } = await dialog.showMessageBox(win, {
            type: "question",
            buttons: [`Use @${handle}`, "Export Without", "Cancel"],
            defaultId: 0,
            cancelId: 2,
            title: "No Author",
            message: "This package has no author.",
            detail: "Use your BeePM handle? It can't be changed afterwards. For another name, cancel and set it in Edit > Package Information.",
        })
        if (response === 2) return false
        if (response === 0 && setAuthorIfNone(currentPackageDir, handle)) {
            // Written to the working package, not the .bpee
            global.titleManager?.setUnsavedChanges(true)
        }
        return true
    }

    if (authorNames(author, login)) return true
    const { response } = await dialog.showMessageBox(win, {
        type: "warning",
        buttons: ["Export Anyway", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        title: "Different Author",
        message: `This package's author is ${author}, but you're logged in to BeePM as @${handle}.`,
        detail: `It'll be published under @${handle}.`,
    })
    return response === 0
}

// Export the package as a .bee_pack and open it in BeePM's Publish, where
// the author reviews it and publishes it. Without BeePM, offers its GitHub.
async function exportToBeePm(win) {
    const currentPackageDir = getCurrentPackageDir()
    if (!currentPackageDir) return

    if (!isBeePmInstalled()) {
        const { response } = await dialog.showMessageBox(win, {
            type: "info",
            buttons: ["Open GitHub", "Cancel"],
            defaultId: 0,
            cancelId: 1,
            title: "BeePM Not Found",
            message: "BeePM isn't installed.",
            detail: "Get it from GitHub, then export to BeePM again.",
        })
        if (response === 0) await shell.openExternal(BEEPM_DOWNLOAD_URL)
        return
    }

    if (!(await authorFitsBeePmLogin(win, currentPackageDir))) return

    // BeePM reads it from here when it checks and publishes it
    const filePath = path.join(
        app.getPath("userData"),
        "beepm",
        `${getCurrentPackageName()}.bee_pack`,
    )
    try {
        await backupBeforeExport(currentPackageDir)
        await exportPackageAsBeePack(currentPackageDir, filePath)
    } catch (err) {
        // The in-app export progress dialog already reported this failure
        console.error("Failed to export the package for BeePM:", err)
        return
    }
    try {
        await publishWithBeePm(filePath)
        console.log(`Opened ${filePath} in BeePM`)
    } catch (err) {
        console.error("Failed to open BeePM:", err)
        dialog.showErrorBox(
            "Failed to Open BeePM",
            `${err.message}\n\nThe package was exported to ${filePath}`,
        )
    }
}

function createMainMenu(mainWindow) {
    menuMainWindow = mainWindow
    const template = [
        {
            label: "File",
            submenu: [
                {
                    label: "New Package",
                    accelerator: "Ctrl+N",
                    click: async () => {
                        if (getCurrentPackageDir()) {
                            const proceed = await confirmUnsavedChanges(
                                mainWindow,
                                "Continue Without Saving",
                            )
                            if (!proceed) return
                            try {
                                await closePackage()
                                mainWindow.webContents.send("package:closed")
                            } catch (error) {
                                console.error(
                                    "Failed to close the package:",
                                    error,
                                )
                                dialog.showErrorBox(
                                    "Close Failed",
                                    `Failed to close package: ${error.message}`,
                                )
                                return
                            }
                        }
                        // Open create package window
                        createPackageCreationWindow(mainWindow)
                    },
                },
                {
                    label: "Load Package...",
                    accelerator: "Ctrl+O",
                    click: async () => {
                        const result = await dialog.showOpenDialog(mainWindow, {
                            properties: ["openFile"],
                            filters: [
                                {
                                    name: "BeePEE Package",
                                    extensions: ["bpee"],
                                },
                            ],
                        })
                        if (result.canceled) return null
                        const proceed = await confirmUnsavedChanges(
                            mainWindow,
                            "Open Without Saving",
                        )
                        if (!proceed) return null
                        try {
                            // Ensure packages directory exists
                            ensurePackagesDir()

                            const pkg = await loadPackage(result.filePaths[0])
                            // currentPackageDir is now managed in packageManager.js
                            mainWindow.webContents.send("package:loaded", {
                                items: pkg.items,
                                signages: pkg.signages,
                            })
                        } catch (error) {
                            console.error(
                                `Failed to open ${result.filePaths[0]}:`,
                                error,
                            )
                            await showPackageOpenError(
                                mainWindow,
                                "Open Failed",
                                `Failed to open package: ${error.message}`,
                                error,
                            )
                        }
                    },
                },
                {
                    label: "Import Package...",
                    accelerator: "Ctrl+I",
                    click: async () => {
                        const result = await dialog.showOpenDialog(mainWindow, {
                            properties: ["openFile"],
                            filters: [
                                {
                                    name: "BEEmod Package",
                                    extensions: ["bee_pack", "zip"],
                                },
                            ],
                        })
                        if (result.canceled) return null
                        const proceed = await confirmUnsavedChanges(
                            mainWindow,
                            "Import Without Saving",
                        )
                        if (!proceed) return null
                        try {
                            await importPackage(result.filePaths[0])
                            // Continue progress from import (70%) to load (80%)
                            mainWindow.webContents.send(
                                "package-loading-progress",
                                {
                                    progress: 80,
                                    message: "Loading imported package...",
                                },
                            )
                            // Skip progress reset AND re-extraction - the
                            // import above already extracted and converted
                            const pkg = await loadPackage(
                                result.filePaths[0],
                                true,
                                true,
                            )
                            // currentPackageDir is now managed in packageManager.js

                            // Send final completion message
                            mainWindow.webContents.send(
                                "package-loading-progress",
                                {
                                    progress: 100,
                                    message:
                                        "Package imported and loaded successfully!",
                                },
                            )

                            mainWindow.webContents.send("package:loaded", {
                                items: pkg.items,
                                signages: pkg.signages,
                            })
                        } catch (error) {
                            // Error is already sent to frontend via progress update
                            // No need for additional dialog since we show it in the loading popup
                        }
                    },
                },
                {
                    label: "Restore Backup...",
                    click: async () => {
                        // Pre-export snapshots live in userData/backups
                        // (newest 10 kept) - open the picker right there
                        const backupsDir = path.join(
                            app.getPath("userData"),
                            "backups",
                        )
                        try {
                            fs.mkdirSync(backupsDir, { recursive: true })
                        } catch {
                            /* picker still opens at its default location */
                        }
                        const result = await dialog.showOpenDialog(mainWindow, {
                            title: "Restore Package Backup",
                            defaultPath: backupsDir,
                            properties: ["openFile"],
                            filters: [
                                { name: "BeePEE Package", extensions: ["bpee"] },
                            ],
                        })
                        if (result.canceled || !result.filePaths.length) return
                        const backupPath = result.filePaths[0]

                        // Ask where the restored copy should live: working
                        // directly out of the backups folder would make the
                        // next Save overwrite the backup itself
                        const baseName = path
                            .basename(backupPath, ".bpee")
                            // strip the -<ISO timestamp> suffix backups carry
                            .replace(/-\d{4}-\d{2}-\d{2}T[\d-]+Z$/, "")
                        const saveTo = await dialog.showSaveDialog(mainWindow, {
                            title: "Save Restored Package As",
                            defaultPath: path.join(
                                app.getPath("documents"),
                                `${baseName} (restored).bpee`,
                            ),
                            filters: [
                                { name: "BeePEE Package", extensions: ["bpee"] },
                            ],
                        })
                        if (saveTo.canceled || !saveTo.filePath) return
                        const proceed = await confirmUnsavedChanges(
                            mainWindow,
                            "Restore Without Saving",
                        )
                        if (!proceed) return
                        try {
                            fs.copyFileSync(backupPath, saveTo.filePath)
                            ensurePackagesDir()
                            const pkg = await loadPackage(saveTo.filePath)
                            // Future saves target the restored copy
                            setLastSavedBpeePath(saveTo.filePath)
                            mainWindow.webContents.send("package:loaded", {
                                items: pkg.items,
                                signages: pkg.signages,
                            })
                        } catch (error) {
                            console.error(`Failed to restore ${backupPath}:`, error)
                            await showPackageOpenError(
                                mainWindow,
                                "Restore Failed",
                                `Failed to restore backup: ${error.message}`,
                                error,
                            )
                        }
                    },
                },
                { type: "separator" },
                {
                    id: "close-package",
                    label: "Close Package",
                    accelerator: "Ctrl+W",
                    click: async () => {
                        // Same guard as quitting: don't silently drop
                        // changes that were never written to the .bpee
                        const proceed = await confirmUnsavedChanges(
                            mainWindow,
                            "Close Without Saving",
                        )
                        if (!proceed) return
                        try {
                            await closePackage()
                            mainWindow.webContents.send("package:closed")
                        } catch (error) {
                            console.error("Failed to close the package:", error)
                            dialog.showErrorBox(
                                "Close Failed",
                                `Failed to close package: ${error.message}`,
                            )
                        }
                    },
                },
                { type: "separator" },
                {
                    id: "save-package",
                    label: "Save Package",
                    accelerator: "Ctrl+S",
                    click: async () => {
                        try {
                            const saved = await saveCurrentPackage(mainWindow)
                            if (saved) {
                                dialog.showMessageBox(mainWindow, {
                                    message: `Package saved to: ${getLastSavedBpeePath()}`,
                                    type: "info",
                                })
                            }
                        } catch (err) {
                            console.error("Failed to save the package:", err)
                            dialog.showErrorBox("Save Failed", err.message)
                        }
                    },
                },
                {
                    id: "save-package-as",
                    label: "Save Package As...",
                    accelerator: "Ctrl+Shift+S",
                    click: async () => {
                        try {
                            const currentPackageDir = getCurrentPackageDir()
                            if (!currentPackageDir)
                                throw new Error("No package loaded")
                            const { canceled, filePath } =
                                await dialog.showSaveDialog(mainWindow, {
                                    title: "Save Package As",
                                    defaultPath:
                                        getCurrentPackageName() + ".bpee",
                                    filters: [
                                        {
                                            name: "BeePEE Package",
                                            extensions: ["bpee"],
                                        },
                                    ],
                                })
                            if (canceled || !filePath) return
                            await savePackageAsBpee(currentPackageDir, filePath)
                            setLastSavedBpeePath(filePath)
                            // The .bpee now matches the working package
                            global.titleManager?.setUnsavedChanges(false)
                            dialog.showMessageBox(mainWindow, {
                                message: `Package saved to: ${filePath}`,
                                type: "info",
                            })
                        } catch (err) {
                            console.error("Failed to save the package:", err)
                            dialog.showErrorBox("Save As Failed", err.message)
                        }
                    },
                },
                { type: "separator" },
                {
                    id: "export-package",
                    label: "Export Package...",
                    accelerator: "Ctrl+E",
                    click: async () => {
                        try {
                            const currentPackageDir = getCurrentPackageDir()
                            if (!currentPackageDir)
                                throw new Error("No package loaded")

                            // When "Launch BEEMod after export" is on, the export
                            // is sent straight to the BEEMod packages folder (no
                            // save dialog) and BEE2 is launched afterwards.
                            const launchBeemod = getSetting("launchBeemodAfterExport", false)
                            const beemodPath = getSetting("beemodPath", null)
                            const exportToBeemod = launchBeemod && !!beemodPath

                            if (launchBeemod && !beemodPath) {
                                console.warn(
                                    "Launch BEEMod after export is on, but no BEEMod path is set, so asking where to export instead",
                                )
                            }

                            let filePath

                            if (exportToBeemod) {
                                // A BeePEE folder in the packages folder BEE2
                                // loads
                                const folder = bee2ExportFolder(beemodPath)
                                fs.mkdirSync(folder, { recursive: true })
                                filePath = path.join(folder, getCurrentPackageName() + ".bee_pack")

                                // Kill BEE2.exe if running to release file locks
                                await killBeemod()
                            } else {
                                // Show save dialog (preferred format from settings)
                                const exportFormat = getSetting("exportFormat", "bee_pack")
                                const formatFilters = [
                                    {
                                        name: "BEEmod Package",
                                        extensions: ["bee_pack"],
                                    },
                                    {
                                        name: "Zip Archive",
                                        extensions: ["zip"],
                                    },
                                ]
                                if (exportFormat === "zip") formatFilters.reverse()

                                const result = await dialog.showSaveDialog(mainWindow, {
                                    title: "Export Package",
                                    defaultPath:
                                        getCurrentPackageName() +
                                        (exportFormat === "zip" ? ".zip" : ".bee_pack"),
                                    filters: formatFilters,
                                })
                                if (result.canceled || !result.filePath) return
                                filePath = result.filePath
                            }

                            await backupBeforeExport(currentPackageDir)
                            await exportPackageAsBeePack(currentPackageDir, filePath)

                            // Open folder or launch BEEMod based on settings
                            const openFolder = getSetting("openFolderAfterExport", true)

                            if (exportToBeemod) {
                                // Launch BEE2.exe
                                const bee2Exe = path.join(beemodPath, "BEE2.exe")
                                if (fs.existsSync(bee2Exe)) {
                                    console.log(`Launching ${bee2Exe}`)
                                    // Use exec with start command for Windows
                                    exec(`start "" "${bee2Exe}"`, { cwd: beemodPath }, (err) => {
                                        if (err) console.error(`Failed to launch ${bee2Exe}:`, err)
                                    })
                                } else {
                                    console.warn(
                                        `Failed to launch BEEMod: ${bee2Exe} doesn't exist`,
                                    )
                                }
                                dialog.showMessageBox(mainWindow, {
                                    message: "Package exported to BEEMod packages folder!",
                                    type: "info",
                                })
                            } else if (openFolder) {
                                shell.showItemInFolder(filePath)
                            } else {
                                dialog.showMessageBox(mainWindow, {
                                    message: `Package exported to: ${filePath}`,
                                    type: "info",
                                })
                            }
                        } catch (err) {
                            // The in-app export progress dialog already
                            // reported this failure - a native error box on
                            // top of it is just noise
                            console.error("Failed to export the package:", err)
                        }
                    },
                },
                {
                    id: "export-beepm",
                    label: "Export to BeePM...",
                    click: () => exportToBeePm(mainWindow),
                },
                { type: "separator" },
                {
                    label: "Preferences...",
                    accelerator: "Ctrl+,",
                    click: () => {
                        createSettingsWindow(mainWindow)
                    },
                },
                { type: "separator" },
                {
                    label: process.platform === "darwin" ? "Quit" : "Exit",
                    accelerator:
                        process.platform === "darwin" ? "Cmd+Q" : "Alt+F4",
                    role: "quit",
                },
            ],
        },
        {
            label: "Edit",
            submenu: [
                { role: "undo", accelerator: "Ctrl+Z" },
                { role: "redo", accelerator: "Ctrl+Y" },
                { type: "separator" },
                { role: "cut", accelerator: "Ctrl+X" },
                { role: "copy", accelerator: "Ctrl+C" },
                { role: "paste", accelerator: "Ctrl+V" },
                { role: "selectAll", accelerator: "Ctrl+A" },
                { type: "separator" },
                {
                    id: "package-information",
                    label: "Package Information...",
                    accelerator: "Ctrl+Shift+I",
                    click: () => {
                        const currentPackageDir = getCurrentPackageDir()
                        if (!currentPackageDir) {
                            dialog.showMessageBox(mainWindow, {
                                type: "info",
                                message: "No package is currently open",
                                detail: "Please open or create a package first",
                            })
                            return
                        }
                        createPackageInformationWindow(mainWindow)
                    },
                },
                { type: "separator" },
                {
                    id: "import-items",
                    label: "Import from Package...",
                    // File picker first; the importer window opens once the
                    // chosen package is extracted (lazy require avoids a
                    // menu <-> handlers import cycle)
                    click: () =>
                        require("./handlers/importHandlers").startImportFlow(
                            mainWindow,
                        ),
                },
            ],
        },
        {
            label: "Help",
            submenu: [
                {
                    label: "GitHub Repository",
                    click: () => {
                        shell.openExternal(
                            "https://github.com/BeemodTools/BeePEE",
                        )
                    },
                },
                {
                    label: "Tutorial",
                    click: () => {
                        shell.openExternal(
                            "https://github.com/BeemodTools/BeePEE/wiki",
                        )
                    },
                },
                {
                    label: "Discord Server",
                    click: () => {
                        shell.openExternal("https://discord.gg/WPzDn4sZY3")
                    },
                },
                { type: "separator" },
                {
                    label: "Report Bug...",
                    click: () => {
                        createCrashReportWindow(null)
                    },
                },
                {
                    label: "Open Logs Folder",
                    click: () => {
                        const logsDir = logger.getLogsDirectory()
                        if (logsDir) {
                            shell.openPath(logsDir)
                        }
                    },
                },
                { type: "separator" },
                {
                    label: "What's New...",
                    click: () => {
                        createChangelogWindow(mainWindow)
                    },
                },
                {
                    label: "Check for Updates...",
                    click: () => {
                        if (global.updaterInstance) {
                            global.updaterInstance.checkForUpdates(false) // Non-silent check
                        } else {
                            dialog.showMessageBox({
                                type: "error",
                                title: "Error",
                                message: "Update checker is not available.",
                                buttons: ["OK"],
                            })
                        }
                    },
                },
            ],
        },
    ]

    // Add developer tools in development mode, or when the Developer mode setting is on
    if (isDev || getSetting("devMode", false)) {
        template.push({
            label: "Dev",
            submenu: [
                {
                    label: "Toggle Developer Tools",
                    accelerator: "F12",
                    click: () => {
                        const focusedWindow = BrowserWindow.getFocusedWindow()
                        if (focusedWindow) {
                            focusedWindow.webContents.toggleDevTools()
                        }
                    },
                },
                { type: "separator" },
                {
                    label: "Clear Packages Directory",
                    click: async () => {
                        const { response } = await dialog.showMessageBox(
                            mainWindow,
                            {
                                type: "warning",
                                buttons: ["Cancel", "Clear"],
                                defaultId: 0,
                                cancelId: 0,
                                title: "Clear Packages Directory",
                                message:
                                    "Are you sure you want to clear all contents of the packages directory? This cannot be undone.",
                            },
                        )
                        if (response === 1) {
                            // User chose 'Clear'
                            try {
                                // Close any open packages first
                                await closePackage()
                                mainWindow.webContents.send("package:closed")

                                // Then clear the directory
                                await clearPackagesDirectory()
                                dialog.showMessageBox(mainWindow, {
                                    message: "Packages directory cleared.",
                                    type: "info",
                                })
                            } catch (err) {
                                console.error(
                                    "Failed to clear the packages folder:",
                                    err,
                                )
                                dialog.showErrorBox("Clear Failed", err.message)
                            }
                        }
                    },
                },
            ],
        })
    }

    const menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)
    updateMenuState()
    return menu
}

module.exports = {
    createMainMenu,
    updateMenuState,
    rebuildMenu,
    saveCurrentPackage,
    confirmUnsavedChanges,
}
