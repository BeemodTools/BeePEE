const { app, BrowserWindow, ipcMain, protocol, dialog } = require("electron")
const path = require("path")
const { createMainMenu } = require("./menu.js")
const fs = require("fs")
const { reg_events } = require("./events.js")
const { createSetupWindow } = require("./items/itemEditor.js")
const { WindowTitleManager } = require("./windowTitleManager.js")
const { setMainWindow, clearPackagesDirectory, cleanupDeletedDirectories } = require("./packageManager.js")
const { logger, initializeLogger } = require("./utils/logger.js")
const { ensurePackagesDir, getPackagesDir } = require("./utils/packagesDir.js")
const { isDev } = require("./utils/isDev.js")
const { AutoUpdater } = require("./autoUpdater.js")

// Store reference to main window for file association handling
let mainWindow = null
let isLoadingFileOnStartup = false // Flag to prevent window from showing during file load
let updaterInstance = null // Auto-updater instance

// Register custom schemes as privileged BEFORE app is ready
// This ensures that the 'beep' scheme can be used with fetch API and other web features.
protocol.registerSchemesAsPrivileged([
    {
        scheme: "beep",
        privileges: {
            standard: true,
            secure: true,
            bypassCSP: true,
            allowServiceWorkers: true,
            supportFetchAPI: true,
            corsEnabled: true,
        },
    },
])

const createWindow = () => {
    const win = new BrowserWindow({
        title: "BeePEE",
        width: 1032, // Compensate for the sidebar
        height: 512,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
        },
        show: false, // Don't show until ready
    })

    // Pipe renderer console output into main-process logger for easier debugging
    win.webContents.on("console-message", (event, level, message, line, sourceId) => {
        const prefix = `[renderer:${sourceId}:${line}] ${message}`
        if (level >= 2) {
            logger.error(prefix)
        } else if (level === 1) {
            logger.warn(prefix)
        } else {
            logger.info(prefix)
        }
    })

    // Initialize window title manager
    const titleManager = new WindowTitleManager(win)
    global.titleManager = titleManager

    // Confirm quitting while the package has changes not yet written to
    // its .bpee (the "*" in the title). Save writes the file and quits;
    // a cancelled Save As aborts the quit.
    win.on("close", (e) => {
        if (!global.titleManager?.hasUnsavedChanges) return
        const choice = dialog.showMessageBoxSync(win, {
            type: "warning",
            buttons: ["Cancel", "Quit Without Saving", "Save"],
            defaultId: 2,
            cancelId: 0,
            title: "Unsaved Changes",
            message: "Your package has unsaved changes.",
            detail: "Save writes them to the .bpee file before quitting.",
        })
        if (choice === 0) {
            e.preventDefault()
        } else if (choice === 2) {
            e.preventDefault()
            const { saveCurrentPackage } = require("./menu.js")
            saveCurrentPackage(win)
                .then((saved) => {
                    // Star is cleared now, so this close sails through
                    if (saved) win.close()
                })
                .catch((err) =>
                    dialog.showErrorBox("Save Failed", err.message),
                )
        }
    })

    // Set main window reference for progress updates
    setMainWindow(win)

    createMainMenu(win)

    // Show window when ready (unless loading a file on startup)
    win.once("ready-to-show", () => {
        if (!isLoadingFileOnStartup) {
            win.show()
            logger.info("Window shown (no file loading on startup)")
        } else {
            logger.info("Window ready but hidden (loading file on startup)")
        }
    })

    // Load content
    if (isDev) {
        win.loadURL("http://localhost:5173")
    } else {
        win.loadFile(path.join(app.getAppPath(), "dist", "index.html"))
    }

    // Register IPC handlers after window is created
    reg_events(win)

    // Store reference to main window for file association handling
    mainWindow = win

    // Initialize auto-updater
    updaterInstance = new AutoUpdater(win)
    global.updaterInstance = updaterInstance // Expose to IPC handlers

    // Check for updates on startup
    updaterInstance.checkOnStartup()

    // Start periodic update checks
    updaterInstance.startPeriodicChecks()

    return win
}

ipcMain.handle("api:loadImage", async (event, filePath) => {
    try {
        const imageBuffer = fs.readFileSync(filePath)
        const base64 = imageBuffer.toString("base64")
        const ext = path.extname(filePath).toLowerCase()

        // Determine MIME type
        let mimeType = "image/png"
        if (ext === ".jpg" || ext === ".jpeg") mimeType = "image/jpeg"
        if (ext === ".gif") mimeType = "image/gif"
        if (ext === ".svg") mimeType = "image/svg+xml"

        return `data:${mimeType};base64,${base64}`
    } catch (error) {
        logger.error("Error loading image:", error)
        return null
    }
})

// Check if required Python bin folders exist for areng_ tools
function checkArengBinFolders() {
    const baseDir = app.isPackaged
        ? path.join(process.resourcesPath, "extraResources")
        : path.join(__dirname, "libs")

    const requiredFolders = [
        path.join(baseDir, "areng_cartoonify", "_internal"),
        path.join(baseDir, "areng_obj23ds", "_internal"),
    ]

    const missingFolders = []
    for (const folder of requiredFolders) {
        if (!fs.existsSync(folder)) {
            missingFolders.push(path.basename(path.dirname(folder)))
        }
    }

    return missingFolders
}

app.whenReady().then(async () => {
    // Initialize logger
    initializeLogger()

    // Clean up any leftover renamed directories from previous sessions
    cleanupDeletedDirectories()

    // Check for required Python bin folders
    const missingBins = checkArengBinFolders()
    if (missingBins.length > 0) {
        const { dialog } = require("electron")
        logger.error("Missing Python bin folders for:", missingBins.join(", "))

        dialog.showErrorBox(
            "Missing Python Runtime",
            `BeePEE is missing required Python runtime files.\n\n` +
            `Missing folders: ${missingBins.join(", ")}\n\n` +
            `The following features will not work:\n` +
            `• VMF to OBJ conversion (cartoonify)\n` +
            `• OBJ to 3DS conversion (model generation)\n\n` +
            `Please download the full BeePEE release from GitHub or rebuild the Python executables.`
        )
    }

    // Ensure packages directory exists at startup
    try {
        ensurePackagesDir()
        logger.info("Packages directory initialized")
    } catch (error) {
        logger.error("Failed to initialize packages directory:", error)
        // Continue anyway - error will be caught when trying to create packages
    }

    // Check if setup is complete
    const { getSetting } = require("./utils/settings.js")

    // Apply verbose logging preference
    logger.setVerbose(getSetting("verboseLogging", false))

    const setupComplete = getSetting("setupComplete", false)
    const beemodPath = getSetting("beemodPath", null)
    const needsSetup = !setupComplete || !beemodPath

    if (needsSetup) {
        logger.info("First run detected - showing setup window")

        // Register settings handlers early so setup window can use them
        const { registerSettingsHandlersEarly } = require("./handlers")
        registerSettingsHandlersEarly(ipcMain)

        // Show setup window and wait for it to close
        await createSetupWindow(null)
        logger.info("Setup window closed")

        // Check if setup was completed - if not, quit the app
        const setupCompleteNow = getSetting("setupComplete", false)
        const beemodPathNow = getSetting("beemodPath", null)
        if (!setupCompleteNow || !beemodPathNow) {
            logger.info("Setup was cancelled - quitting app")
            app.quit()
            return
        }
    }

    // Register custom file protocol for secure local file access
    protocol.handle("beep", async (request) => {
        try {
            let url = request.url.replace("beep://", "")

            // Handle URL decoding (e.g., %20 -> space, %2F -> /)
            try {
                url = decodeURIComponent(url)
            } catch (decodeError) {
                logger.error("Failed to decode URL:", url, decodeError)
                return new Response("Bad Request: Invalid URL encoding", {
                    status: 400,
                })
            }

            // Handle Windows drive letters and paths
            if (process.platform === "win32") {
                // Pattern 1: "c/Users/..." -> "C:/Users/..."
                if (url.match(/^[a-z]\//)) {
                    url = url.charAt(0).toUpperCase() + ":" + url.slice(1)
                }
                // Pattern 2: "/c/Users/..." -> "C:/Users/..." (some systems add leading slash)
                else if (url.match(/^\/[a-z]\//)) {
                    url = url.charAt(1).toUpperCase() + ":" + url.slice(2)
                }
                // Pattern 3: "c:/Users/..." -> "C:/Users/..." (already has colon)
                else if (url.match(/^[a-z]:\//)) {
                    url = url.charAt(0).toUpperCase() + url.slice(1)
                }
            }

            // Convert to absolute path
            let filePath
            try {
                filePath = path.resolve(url)
            } catch (pathError) {
                logger.error("Failed to resolve path:", url, pathError)
                return new Response("Bad Request: Invalid file path", {
                    status: 400,
                })
            }

            // Security: Only allow access to files within the project directory OR packages directory
            const projectRoot = path.resolve(__dirname, "..")
            const packagesRoot = path.resolve(getPackagesDir())
            const normalizedFilePath = path.normalize(filePath)
            const normalizedProjectRoot = path.normalize(projectRoot)
            const normalizedPackagesRoot = path.normalize(packagesRoot)

            const isInProject = normalizedFilePath.startsWith(normalizedProjectRoot)
            const isInPackages = normalizedFilePath.startsWith(normalizedPackagesRoot)

            if (!isInProject && !isInPackages) {
                logger.warn(
                    `Security check failed: ${normalizedFilePath} is not within ${normalizedProjectRoot} or ${normalizedPackagesRoot}`,
                )
                return new Response("Forbidden: Access denied", { status: 403 })
            }

            // Check if file exists and is accessible before attempting to fetch
            let stats
            try {
                if (!fs.existsSync(filePath)) {
                    logger.warn(`File not found: ${filePath}`)
                    return new Response("Not Found", { status: 404 })
                }

                stats = fs.statSync(filePath)
            } catch (fsError) {
                logger.error(
                    `File system error accessing ${filePath}:`,
                    fsError,
                )
                return new Response(
                    "Internal Server Error: File access error",
                    { status: 500 },
                )
            }

            // Check if it's actually a file (not a directory)
            if (!stats.isFile()) {
                logger.warn(`Not a file: ${filePath}`)
                return new Response("Bad Request: Path is not a file", {
                    status: 400,
                })
            }

            // Check file permissions (readable)
            try {
                fs.accessSync(filePath, fs.constants.R_OK)
            } catch (accessError) {
                logger.error(`File not readable: ${filePath}`, accessError)
                return new Response("Forbidden: File not readable", {
                    status: 403,
                })
            }

            logger.debug(`Serving file: ${filePath}`)

            // Get file extension and set appropriate MIME type
            const ext = path.extname(filePath).toLowerCase()
            const mimeTypes = {
                ".obj": "text/plain",
                ".mtl": "text/plain",
                ".tga": "image/tga",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".png": "image/png",
                ".gif": "image/gif",
                ".bmp": "image/bmp",
                ".txt": "text/plain",
                ".json": "application/json",
                ".xml": "application/xml",
                ".css": "text/css",
                ".js": "application/javascript",
                ".html": "text/html",
            }

            // Read file directly using fs.readFile instead of net.fetch
            // This ensures file handles are released immediately after reading
            const fileBuffer = await fs.promises.readFile(filePath)

            return new Response(fileBuffer, {
                status: 200,
                headers: {
                    "content-type": mimeTypes[ext] || "application/octet-stream",
                    "content-length": fileBuffer.length.toString(),
                },
            })
        } catch (error) {
            logger.error("Beep protocol handler error:", error)
            return new Response("Internal Server Error", { status: 500 })
        }
    })

    logger.info("🔧 Registered beep:// protocol for secure file access")

    const window = createWindow()

    // A settings reset saves the open package and leaves a one-shot pointer
    // to reopen it after the user runs through setup again
    const { loadSettings, saveSettings } = require("./utils/settings.js")
    const pendingReopen = getSetting("pendingReopenPackage", null)
    if (pendingReopen) {
        const s = loadSettings()
        delete s.pendingReopenPackage
        saveSettings(s)
    }

    // Auto-open the pending-reopen package (post-reset) or the last package
    // if enabled (skipped when a file association is already loading one)
    const openLast = getSetting("openLastPackageOnStartup", false)
    const lastPackagePath = getSetting("lastPackagePath", null)
    const startupPackage =
        pendingReopen && fs.existsSync(pendingReopen)
            ? pendingReopen
            : openLast && lastPackagePath && fs.existsSync(lastPackagePath)
              ? lastPackagePath
              : null
    if (!isLoadingFileOnStartup && startupPackage) {
        logger.info(`Opening package on startup: ${startupPackage}`)
        window.webContents.once("did-finish-load", () => {
            setTimeout(() => handleFileOpen(startupPackage), 500)
        })
    }

    // Beta builds greet the tester with a warning on every launch
    const { isBeta } = require("./utils/betaInfo.js")
    if (isBeta()) {
        window.webContents.once("did-finish-load", () => {
            setTimeout(() => {
                dialog.showMessageBox(window, {
                    type: "warning",
                    title: "Beta Release",
                    message: `You are running a BETA version of BeePEE (v${require("../package.json").version})`,
                    detail:
                        "Beta builds are bug prone and less stable than regular releases.\n\n" +
                        "\n" +
                        "Please stress test as much as you can. We must find bugs.\n" +
                        "If you encounter any bugs, report them via Help > Report Bug.\n" +
                        "Keep backups of important packages before opening them in this version.",
                    buttons: ["Got it"],
                })
            }, 500)
        })
    }

    // Check for version change and show changelog if needed
    const { getLastSeenVersion, setLastSeenVersion } = require("./utils/settings.js")
    const { createChangelogWindow } = require("./items/itemEditor.js")
    const packageJson = require("../package.json")
    const currentVersion = packageJson.version
    const lastSeenVersion = getLastSeenVersion()

    // Show changelog only once after update (not on first install)
    if (lastSeenVersion && lastSeenVersion !== currentVersion) {
        logger.info(`Version changed from ${lastSeenVersion} to ${currentVersion}, showing changelog`)
        // Wait for window to be ready before showing changelog
        window.webContents.once("did-finish-load", () => {
            setTimeout(() => {
                createChangelogWindow(window)
                setLastSeenVersion(currentVersion)
            }, 1000) // Small delay to ensure main window is fully loaded
        })
    } else if (!lastSeenVersion) {
        // First run - just set the version without showing changelog
        logger.info(`First run detected, setting version to ${currentVersion}`)
        setLastSeenVersion(currentVersion)
    } else {
        logger.info(`Version unchanged: ${currentVersion}`)
    }

    // Configure VMF2OBJ resource paths on startup
    try {
        const { findPortal2Resources } = require("./data")

        // Create a console-compatible wrapper for logger
        const logWrapper = {
            log: (...args) => logger.info(...args),
            error: (...args) => logger.error(...args),
            warn: (...args) => logger.warn(...args),
            debug: (...args) => logger.debug(...args),
        }

        const p2Resources = await findPortal2Resources(logWrapper)

        if (p2Resources?.root) {
            const { setExtraResourcePaths } = require("./utils/vmf2obj")
            const resourcePaths = []

            logger.info("🔍 Portal 2 resources found:")
            logger.debug("  Root:", p2Resources.root)
            logger.debug("  Search paths:", p2Resources.searchPaths || [])
            logger.debug("  DLC folders:", p2Resources.dlcFolders || [])

            // Add main Portal 2 VPK file (contains all materials and models)
            resourcePaths.push(`${p2Resources.root}\\portal2\\pak01_dir.vpk`)
            // Note: We don't add the portal2 folder directly to avoid VMF2OBJ scanning
            // thousands of unrelated files that can cause StringIndexOutOfBoundsException

            // Add search paths from gameinfo.txt
            if (p2Resources.searchPaths) {
                logger.debug(
                    `🔍 Processing ${p2Resources.searchPaths.length} search paths...`,
                )
                for (const searchPath of p2Resources.searchPaths) {
                    logger.debug(`  📁 Processing search path: "${searchPath}"`)

                    // Handle |gameinfo_path| placeholder
                    let processedPath = searchPath
                    if (searchPath.includes("|gameinfo_path|")) {
                        processedPath = searchPath.replace(
                            "|gameinfo_path|",
                            "",
                        )
                        logger.debug(
                            `    🔄 Replaced |gameinfo_path| with: "${processedPath}"`,
                        )
                    }

                    // Search paths are relative to Portal 2 root, not portal2 subfolder
                    let fullPath
                    if (processedPath.startsWith("..")) {
                        // Handle relative paths like "../bee2" - go up from portal2/ to Portal 2/
                        fullPath = path.join(p2Resources.root, processedPath)
                    } else {
                        // Handle absolute paths like "Hammer" - they're relative to Portal 2 root
                        fullPath = path.join(p2Resources.root, processedPath)
                    }
                    logger.debug(`    🎯 Full path: ${fullPath}`)

                    if (fs.existsSync(fullPath)) {
                        // Check if this path actually contains useful resources for VMF2OBJ
                        const isVpk = fullPath.toLowerCase().endsWith(".vpk")

                        if (isVpk) {
                            // Only add VPK files to avoid directory scanning issues
                            resourcePaths.push(fullPath)
                            logger.debug(`    ✅ Added VPK: ${fullPath}`)
                        } else {
                            // For custom content (BEE2, mods), we allow directories with materials/models
                            // Note: VMF2OBJ crashes on files without extensions - ensure your
                            // custom content folders don't contain extension-less files
                            const materialsPath = path.join(fullPath, "materials")
                            const modelsPath = path.join(fullPath, "models")
                            const hasMaterials = fs.existsSync(materialsPath)
                            const hasModels = fs.existsSync(modelsPath)

                            if (hasMaterials || hasModels) {
                                resourcePaths.push(fullPath)
                                logger.debug(
                                    `    ✅ Added custom content folder: ${fullPath}`,
                                )
                            } else {
                                logger.debug(
                                    `    ⚠️ Path exists but no materials/models/VPK: ${fullPath}`,
                                )
                            }
                        }
                    } else {
                        logger.debug(`    ❌ Path does not exist: ${fullPath}`)
                    }
                }
            }

            // Add DLC folders
            if (p2Resources.dlcFolders) {
                logger.debug(
                    `🔍 Processing ${p2Resources.dlcFolders.length} DLC folders...`,
                )
                for (const dlc of p2Resources.dlcFolders) {
                    logger.debug(
                        `  📁 Processing DLC: ${dlc.name} at ${dlc.path}`,
                    )

                    // Add DLC VPK if it exists (VPK files are safe)
                    const dlcVpkPath = path.join(dlc.path, "pak01_dir.vpk")
                    if (fs.existsSync(dlcVpkPath)) {
                        resourcePaths.push(dlcVpkPath)
                        logger.debug(`    ✅ Added DLC VPK: ${dlcVpkPath}`)
                    } else {
                        logger.debug(`    ❌ DLC VPK not found: ${dlcVpkPath}`)
                    }

                    // Note: We don't add DLC folders directly to avoid VMF2OBJ
                    // scanning issues. VPK files contain all necessary content.
                }
            } else {
                logger.debug(`⚠️ No DLC folders found`)
            }

            setExtraResourcePaths(resourcePaths)
            logger.info("VMF2OBJ resource paths configured:", resourcePaths)
        }
    } catch (error) {
        logger.warn("Could not setup Portal 2 resource paths:", error?.message || error)
    }
})

// Handle uncaught exceptions and unhandled rejections
// Debounce crash report dialogs to avoid spamming on rapid errors
let lastCrashDialogTime = 0
const CRASH_DIALOG_DEBOUNCE = 5000 // 5 seconds

function sendCrashReportEvent(errorData) {
    const now = Date.now()
    if (now - lastCrashDialogTime < CRASH_DIALOG_DEBOUNCE) return
    lastCrashDialogTime = now

    try {
        const { createCrashReportWindow } = require("./items/itemEditor")
        createCrashReportWindow(errorData)
    } catch (err) {
        logger.error("Failed to open crash report window:", err)
    }
}

process.on("uncaughtException", (error) => {
    logger.error("Uncaught Exception:", error)
    if (logger.originalConsole) {
        logger.originalConsole.error("Uncaught Exception:", error)
    }
    sendCrashReportEvent({
        type: "uncaughtException",
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
    })
})

process.on("unhandledRejection", (reason, promise) => {
    logger.error("Unhandled Rejection at:", promise, "reason:", reason)
    if (logger.originalConsole) {
        logger.originalConsole.error("Unhandled Rejection at:", promise, "reason:", reason)
    }
    const message = reason instanceof Error ? reason.message : String(reason)
    const stack = reason instanceof Error ? reason.stack : undefined
    sendCrashReportEvent({
        type: "unhandledRejection",
        message,
        stack,
        timestamp: new Date().toISOString(),
    })
})

// Clean up packages directory when app exits (only in production)
app.on("before-quit", () => {
    try {
        // Only clean up packages in production - in dev mode the packages folder
        // is inside the project and we don't want to delete user's work
        if (!isDev) {
            logger.info("Cleaning up packages directory...")
            clearPackagesDirectory()
            logger.info("Packages directory cleaned up successfully")
        } else {
            logger.info("Skipping packages cleanup in development mode")
        }
    } catch (error) {
        logger.error("Failed to clean up packages directory:", error.message)
    } finally {
        // Stop periodic update checks
        if (updaterInstance) {
            updaterInstance.stopPeriodicChecks()
        }

        // Close logger stream
        logger.close()
    }
})

// ============================================
// FILE ASSOCIATION HANDLING
// ============================================

// Check if a file was passed on startup (before app is ready)
if (process.platform === "win32" || process.platform === "linux") {
    const args = process.argv.slice(1) // Skip electron executable
    const startupFilePath = args.find(arg =>
        arg.endsWith(".bpee") || arg.endsWith(".bee_pack")
    )
    if (startupFilePath && !startupFilePath.startsWith("--")) {
        logger.info(`File detected on startup (before app ready): ${startupFilePath}`)
        isLoadingFileOnStartup = true
    }
}

// Helper function to handle opening a file
async function handleFileOpen(filePath, isStartup = false) {
    if (!filePath || !fs.existsSync(filePath)) {
        logger.warn(`File does not exist: ${filePath}`)
        return
    }

    const ext = path.extname(filePath).toLowerCase()
    logger.info(`Opening file: ${filePath} (${ext}) [startup: ${isStartup}]`)

    // Wait for app to be ready
    await app.whenReady()

    // Get or create main window
    if (!mainWindow || mainWindow.isDestroyed()) {
        logger.info("Main window not available, waiting for it to be created...")
        // Window will be created by app.whenReady, wait a bit
        await new Promise(resolve => setTimeout(resolve, 1000))
    }

    if (!mainWindow || mainWindow.isDestroyed()) {
        logger.error("Main window still not available")
        return
    }

    try {
        if (ext === ".bpee") {
            // Load .bpee package
            logger.info("Loading .bpee package...")
            const { loadPackage } = require("./packageManager")
            const pkg = await loadPackage(filePath)
            mainWindow.webContents.send("package:loaded", {
                items: pkg.items,
                signages: pkg.signages,
            })
            logger.info("Package loaded successfully")
        } else if (ext === ".bee_pack") {
            // Import .bee_pack package
            logger.info("Importing .bee_pack package...")
            const { importPackage, loadPackage } = require("./packageManager")
            await importPackage(filePath)

            // Continue progress from import (70%) to load (80%)
            mainWindow.webContents.send("package-loading-progress", {
                progress: 80,
                message: "Loading imported package...",
            })

            // Already extracted and converted by importPackage() above
            const pkg = await loadPackage(filePath, true, true)

            // Send final completion message
            mainWindow.webContents.send("package-loading-progress", {
                progress: 100,
                message: "Package imported and loaded successfully!",
            })

            mainWindow.webContents.send("package:loaded", {
                items: pkg.items,
                signages: pkg.signages,
            })
            logger.info("Package imported and loaded successfully")
        } else {
            logger.warn(`Unsupported file type: ${ext}`)
        }

        // Show window after loading completes (if it was hidden during startup)
        if (isStartup && isLoadingFileOnStartup) {
            logger.info("Showing window after file load completed")
            mainWindow.show()
            isLoadingFileOnStartup = false // Reset flag
        }
    } catch (error) {
        logger.error(`Failed to open file ${filePath}:`, error)
        const { dialog } = require("electron")
        dialog.showErrorBox(
            "Open Failed",
            `Failed to open ${path.basename(filePath)}: ${error.message}`
        )

        // Show window even on error (if it was hidden during startup)
        if (isStartup && isLoadingFileOnStartup) {
            logger.info("Showing window after file load error")
            mainWindow.show()
            isLoadingFileOnStartup = false // Reset flag
        }
    }
}

// Single instance lock - prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
    // Another instance is already running, quit this one
    logger.info("Another instance is already running, quitting...")
    app.quit()
} else {
    // Handle second-instance event (when user tries to open another file while app is running)
    app.on("second-instance", (event, commandLine, workingDirectory) => {
        logger.info("Second instance detected, processing command line:", commandLine)

        // Focus the existing window
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore()
            mainWindow.focus()
        }

        // Find the file path in command line arguments
        // On Windows, the file path is typically the last argument
        const filePath = commandLine.find(arg =>
            arg.endsWith(".bpee") || arg.endsWith(".bee_pack")
        )

        if (filePath) {
            logger.info(`Opening file from second instance: ${filePath}`)
            handleFileOpen(filePath)
        }
    })

    // Handle macOS open-file event
    app.on("open-file", (event, filePath) => {
        event.preventDefault()
        logger.info(`macOS open-file event: ${filePath}`)
        handleFileOpen(filePath)
    })

    // Handle Windows/Linux command line arguments
    // Check if a file was passed as argument on startup
    if (process.platform === "win32" || process.platform === "linux") {
        const args = process.argv.slice(1) // Skip electron executable
        const filePath = args.find(arg =>
            arg.endsWith(".bpee") || arg.endsWith(".bee_pack")
        )

        if (filePath && !filePath.startsWith("--")) {
            logger.info(`Starting file load: ${filePath}`)
            // Delay the file open until the window is created
            app.whenReady().then(() => {
                setTimeout(() => handleFileOpen(filePath, true), 1500)
            })
        }
    }
}
