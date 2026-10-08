const openEditors = new Map()
const openSignageEditors = new Map() // Track signage editor windows
const openModelPreviewWindows = new Map() // Track model preview windows
const openIconMakers = new Map() // Track icon maker windows (one per item)
const openTimerColors = new Map() // Track Default Colors windows (one per item)
let createItemWindow = null // Track the create item window
let createPackageWindow = null // Track the create package window
let signageDesignerWindow = null // Track the signage designer window
let packageInformationWindow = null // Track the package information window
let changelogWindow = null // Track the changelog window
let crashReportWindow = null // Track the crash report window
let setupWindow = null // Track the setup window
let settingsWindow = null // Track the settings window
const { BrowserWindow, app, Menu, screen } = require("electron")
const { logger } = require("../utils/logger")

const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`

// Native File/Edit menu for the signage designer window. Items forward an
// action name to the window's renderer, which performs it (the designer's
// state - layers, undo stack, etc. - lives there). Accelerators use
// `registerAccelerator: false` so the shortcut is DISPLAYED (right-aligned,
// native) but NOT bound - the designer's own keydown handler keeps owning the
// real shortcuts (with its input-field guard) and nothing double-fires.
function buildSignageDesignerMenu(win) {
    const send = (action) => () => {
        if (win && !win.isDestroyed()) {
            win.webContents.send("signage-designer-menu", action)
        }
    }
    // Show the accelerator hint natively without binding it.
    const item = (label, action, accelerator) => ({
        label,
        click: send(action),
        ...(accelerator ? { accelerator, registerAccelerator: false } : {}),
    })
    return Menu.buildFromTemplate([
        {
            label: "File",
            submenu: [
                item("Load Design…", "load"),
                { type: "separator" },
                item("Export as PNG…", "exportPng"),
                item("Export as .bpsign…", "exportBpsign"),
                { type: "separator" },
                item("Save Signage", "save"),
                { type: "separator" },
                // Preferences live in the shared settings window, opened
                // straight to the Signage tab
                {
                    label: "Preferences…",
                    click: () => createSettingsWindow(null, "signage"),
                },
                item("Close", "close"),
            ],
        },
        {
            label: "Edit",
            submenu: [
                item("Undo", "undo", "CmdOrCtrl+Z"),
                item("Redo", "redo", "CmdOrCtrl+Y"),
                { type: "separator" },
                item("Add Text", "addText", "CmdOrCtrl+T"),
                { type: "separator" },
                item("Cut", "cut", "CmdOrCtrl+X"),
                item("Copy", "copy", "CmdOrCtrl+C"),
                item("Paste", "paste", "CmdOrCtrl+V"),
                item("Duplicate", "duplicate", "CmdOrCtrl+D"),
                item("Delete", "delete", "Delete"),
                { type: "separator" },
                item("Group", "group", "CmdOrCtrl+G"),
                item("Ungroup", "ungroup", "CmdOrCtrl+Shift+G"),
                { type: "separator" },
                item("Flip Horizontal", "flipH"),
                item("Flip Vertical", "flipV"),
                { type: "separator" },
                item("Select All", "selectAll", "CmdOrCtrl+A"),
            ],
        },
        {
            label: "View",
            submenu: [
                item("Zoom In", "zoomIn", "CmdOrCtrl+="),
                item("Zoom Out", "zoomOut", "CmdOrCtrl+-"),
                item("Reset Zoom", "zoomReset", "CmdOrCtrl+0"),
            ],
        },
    ])
}
const path = require("path")
const { isDev } = require("../utils/isDev.js")

function createItemEditor(item, mainWindow) {
    if (openEditors.has(item.id)) {
        openEditors.get(item.id).focus()
        return
    }

    const window = new BrowserWindow({
        width: 960,
        height: 1024,
        title: `BeePEE - Edit ${item.name}`,
        // Remove parent to ensure separate taskbar entry
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, "..", "preload.js"),
        },
        devTools: isDev,
        // Ensure window shows in taskbar independently
        skipTaskbar: false,
        minimizable: true,
        maximizable: true,
        resizable: true,
    })

    openEditors.set(item.id, window)

    window.on("closed", () => {
        openEditors.delete(item.id)
        // Its icon maker hands the icons it makes to this window, and its
        // Default Colors window the colors
        closeIconMakerWindow(item.id)
        closeTimerColorsWindow(item.id)
    })

    if (isDev) {
        window.loadURL(`http://localhost:5173/?route=editor`)
    } else {
        // Use app.getAppPath() for reliable path resolution in packaged app
        const appPath = app.getAppPath()
        window.loadFile(path.join(appPath, "dist", "index.html"), {
            query: { route: "editor" },
        })
    }

    window.setMenuBarVisibility(false)

    window.webContents.once("did-finish-load", () => {
        setTimeout(() => {
            window.webContents.send("load-item", item.toJSONWithExistence())
        }, 100)
    })
}

// Function to send item-updated event to the correct editor window
function sendItemUpdateToEditor(itemId, updatedItem) {
    const editorWindow = openEditors.get(itemId)
    if (editorWindow && !editorWindow.isDestroyed()) {
        editorWindow.webContents.send("item-updated", updatedItem)
    }
}

/**
 * Open an item's icon maker in its own window, or bring it up if it's open
 * already. The page (src/pages/IconMakerPage.jsx) gets the item from its
 * address and hands the icon it makes to the item's editor
 * (sendMadeIconToEditor), so it closes with that editor.
 * @param {{id: string, name: string}} item
 */
function createIconMakerWindow(item) {
    const existing = openIconMakers.get(item.id)
    if (existing && !existing.isDestroyed()) {
        if (existing.isMinimized()) existing.restore()
        existing.focus()
        return existing
    }

    const window = new BrowserWindow({
        // The 512px view with the settings beside it, and the buttons
        width: 880,
        height: 660,
        useContentSize: true,
        minWidth: 480,
        minHeight: 360,
        title: `Make Icon: ${item.name}`,
        backgroundColor: "#1e1e1e",
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, "..", "preload.js"),
        },
        skipTaskbar: false,
        minimizable: true,
        maximizable: true,
        resizable: true,
        autoHideMenuBar: true,
    })

    openIconMakers.set(item.id, window)

    window.on("closed", () => {
        if (openIconMakers.get(item.id) === window) {
            openIconMakers.delete(item.id)
        }
    })

    const query = { route: "icon-maker", itemId: item.id, itemName: item.name }
    if (isDev) {
        window.loadURL(`http://localhost:5173/?${new URLSearchParams(query)}`)
    } else {
        const appPath = app.getAppPath()
        window.loadFile(path.join(appPath, "dist", "index.html"), { query })
    }

    window.setMenuBarVisibility(false)
    return window
}

function closeIconMakerWindow(itemId) {
    const window = openIconMakers.get(itemId)
    if (window && !window.isDestroyed()) window.close()
}

// Hands an icon the icon maker made ({ filePath, fileName }) to the item's
// editor window, which stages it like a picked icon file (applied on Save).
// Returns false when that editor isn't open.
function sendMadeIconToEditor(itemId, icon) {
    const editorWindow = openEditors.get(itemId)
    if (editorWindow && !editorWindow.isDestroyed()) {
        editorWindow.webContents.send("icon-made", icon)
        editorWindow.focus()
        return true
    }
    return false
}

/**
 * An item's Default Colors window (item editor > Variables > Color): the
 * color players start with for each timer value in BEE2's ItemVar menu.
 * @param {Object} item
 * @param {Object} colors - Timer value to "R G B", as the item's editor has them
 */
function createTimerColorsWindow(item, colors) {
    const existing = openTimerColors.get(item.id)
    if (existing && !existing.isDestroyed()) {
        if (existing.isMinimized()) existing.restore()
        existing.focus()
        return existing
    }

    const editorWindow = openEditors.get(item.id)
    const window = new BrowserWindow({
        // The 28 swatches, and the buttons
        width: 560,
        height: 400,
        useContentSize: true,
        title: `Default Colors: ${item.name}`,
        backgroundColor: "#1e1e1e",
        // Above the item's editor
        parent:
            editorWindow && !editorWindow.isDestroyed()
                ? editorWindow
                : undefined,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, "..", "preload.js"),
        },
        skipTaskbar: false,
        minimizable: false,
        maximizable: false,
        resizable: false,
        autoHideMenuBar: true,
    })

    openTimerColors.set(item.id, window)

    window.on("closed", () => {
        if (openTimerColors.get(item.id) === window) {
            openTimerColors.delete(item.id)
        }
    })

    const query = {
        route: "timer-colors",
        itemId: item.id,
        itemName: item.name,
        colors: JSON.stringify(colors ?? {}),
    }
    if (isDev) {
        window.loadURL(`http://localhost:5173/?${new URLSearchParams(query)}`)
    } else {
        const appPath = app.getAppPath()
        window.loadFile(path.join(appPath, "dist", "index.html"), { query })
    }

    window.setMenuBarVisibility(false)
    return window
}

function closeTimerColorsWindow(itemId) {
    const window = openTimerColors.get(itemId)
    if (window && !window.isDestroyed()) window.close()
}

// Hands the Default Colors window's colors to the item's editor window,
// which applies them on Save. Returns false when that editor isn't open.
function sendTimerColorsToEditor(itemId, colors) {
    const editorWindow = openEditors.get(itemId)
    if (editorWindow && !editorWindow.isDestroyed()) {
        editorWindow.webContents.send("timer-colors-picked", colors)
        editorWindow.focus()
        return true
    }
    return false
}

/**
 * Create a signage editor window
 * @param {object} signage - The signage object to edit
 * @param {BrowserWindow} mainWindow - The main window reference
 */
function createSignageEditor(signage, mainWindow) {
    if (openSignageEditors.has(signage.id)) {
        openSignageEditors.get(signage.id).focus()
        return
    }

    const window = new BrowserWindow({
        width: 960,
        height: 1024,
        title: `BeePEE - Edit Signage: ${signage.name}`,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, "..", "preload.js"),
        },
        devTools: isDev,
        skipTaskbar: false,
        minimizable: true,
        maximizable: true,
        resizable: true,
        autoHideMenuBar: true,
    })

    openSignageEditors.set(signage.id, window)

    window.on("closed", () => {
        openSignageEditors.delete(signage.id)
    })

    if (isDev) {
        window.loadURL(`http://localhost:5173/?route=signage-editor`)
    } else {
        const appPath = app.getAppPath()
        window.loadFile(path.join(appPath, "dist", "index.html"), {
            query: { route: "signage-editor" },
        })
    }

    window.setMenuBarVisibility(false)

    // Send signage data after the window has finished loading
    window.webContents.once("did-finish-load", () => {
        setTimeout(() => {
            window.webContents.send("load-signage", signage)
        }, 100)
    })
}

// Function to send signage-updated event to the correct editor window
function sendSignageUpdateToEditor(signageId, updatedSignage) {
    const editorWindow = openSignageEditors.get(signageId)
    if (editorWindow && !editorWindow.isDestroyed()) {
        editorWindow.webContents.send("signage-updated", updatedSignage)
    }
}

// Delivers a staged (uncommitted) designer save to the signage's editor
// window - the editor previews it and its Save button performs the real
// commit. Returns false when that editor isn't open.
function sendStagedDesignToEditor(signageId, payload) {
    const editorWindow = openSignageEditors.get(signageId)
    if (editorWindow && !editorWindow.isDestroyed()) {
        editorWindow.webContents.send("signage-design-staged", payload)
        editorWindow.focus()
        return true
    }
    return false
}

function createItemCreationWindow(mainWindow) {
    // If window already exists, focus it
    if (createItemWindow && !createItemWindow.isDestroyed()) {
        createItemWindow.focus()
        return
    }

    createItemWindow = new BrowserWindow({
        width: 500,
        height: 500,
        title: "BeePEE - Create New Item",
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, "..", "preload.js"),
        },
        devTools: isDev,
        skipTaskbar: false,
        minimizable: true,
        maximizable: false,
        resizable: false,
        autoHideMenuBar: true,
    })

    createItemWindow.on("closed", () => {
        createItemWindow = null
    })

    if (isDev) {
        createItemWindow.loadURL(`http://localhost:5173/?route=create-item`)
    } else {
        // Use app.getAppPath() for reliable path resolution in packaged app
        const appPath = app.getAppPath()
        createItemWindow.loadFile(path.join(appPath, "dist", "index.html"), {
            query: { route: "create-item" },
        })
    }

    createItemWindow.setMenuBarVisibility(false)
}

function createSignageDesignerWindow(mainWindow, editPayload = null) {
    // If window already exists, focus it (and load a design if one was asked)
    if (signageDesignerWindow && !signageDesignerWindow.isDestroyed()) {
        signageDesignerWindow.focus()
        if (editPayload) {
            signageDesignerWindow.webContents.send(
                "load-signage-design",
                editPayload,
            )
        }
        return
    }

    signageDesignerWindow = new BrowserWindow({
        width: 1280,
        height: 900,
        minWidth: 1024,
        minHeight: 720,
        title: "BeePEE - Signage Designer",
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, "..", "preload.js"),
        },
        devTools: isDev,
        skipTaskbar: false,
        minimizable: true,
        maximizable: true,
        resizable: true,
        autoHideMenuBar: false,
    })

    // Give the designer its own native File/Edit menu bar
    signageDesignerWindow.setMenu(buildSignageDesignerMenu(signageDesignerWindow))

    signageDesignerWindow.on("closed", () => {
        signageDesignerWindow = null
    })

    // Deliver an edit payload once the page is ready to receive it
    if (editPayload) {
        signageDesignerWindow.webContents.once("did-finish-load", () => {
            signageDesignerWindow.webContents.send(
                "load-signage-design",
                editPayload,
            )
        })
    }

    if (isDev) {
        signageDesignerWindow.loadURL(
            `http://localhost:5173/?route=signage-designer`,
        )
    } else {
        // Use app.getAppPath() for reliable path resolution in packaged app
        const appPath = app.getAppPath()
        signageDesignerWindow.loadFile(
            path.join(appPath, "dist", "index.html"),
            {
                query: { route: "signage-designer" },
            },
        )
    }
}

/** A window's content height, at most what fits on the main screen */
function heightOnScreen(height) {
    try {
        // Room for the title bar
        return Math.min(height, screen.getPrimaryDisplay().workArea.height - 40)
    } catch {
        return height
    }
}

function createPackageCreationWindow(mainWindow) {
    // If window already exists, focus it
    if (createPackageWindow && !createPackageWindow.isDestroyed()) {
        createPackageWindow.focus()
        return
    }

    createPackageWindow = new BrowserWindow({
        // The page's size, with its BeePM fields (bee-package.json)
        useContentSize: true,
        width: 484,
        height: heightOnScreen(890),
        title: "BeePEE - Create New Package",
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, "..", "preload.js"),
        },
        devTools: isDev,
        skipTaskbar: false,
        minimizable: true,
        maximizable: false,
        resizable: false,
        autoHideMenuBar: true,
    })

    createPackageWindow.on("closed", () => {
        createPackageWindow = null
    })

    if (isDev) {
        createPackageWindow.loadURL(`http://localhost:5173/?route=create-package`)
    } else {
        // Use app.getAppPath() for reliable path resolution in packaged app
        const appPath = app.getAppPath()
        createPackageWindow.loadFile(
            path.join(appPath, "dist", "index.html"),
            {
                query: { route: "create-package" },
            },
        )
    }

    createPackageWindow.setMenuBarVisibility(false)
}

function createPackageInformationWindow(mainWindow) {
    // If window already exists, focus it
    if (packageInformationWindow && !packageInformationWindow.isDestroyed()) {
        packageInformationWindow.focus()
        return
    }

    packageInformationWindow = new BrowserWindow({
        // The page's size, with its BeePM fields (bee-package.json)
        useContentSize: true,
        width: 484,
        height: heightOnScreen(890),
        title: "BeePEE - Package Information",
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, "..", "preload.js"),
        },
        devTools: isDev,
        skipTaskbar: false,
        minimizable: true,
        maximizable: false,
        resizable: false,
        autoHideMenuBar: true,
    })

    packageInformationWindow.on("closed", () => {
        packageInformationWindow = null
    })

    if (isDev) {
        packageInformationWindow.loadURL(
            `http://localhost:5173/?route=package-information`,
        )
    } else {
        // Use app.getAppPath() for reliable path resolution in packaged app
        const appPath = app.getAppPath()
        packageInformationWindow.loadFile(
            path.join(appPath, "dist", "index.html"),
            {
                query: { route: "package-information" },
            },
        )
    }

    packageInformationWindow.setMenuBarVisibility(false)
}

function createChangelogWindow(mainWindow) {
    // If window already exists, focus it
    if (changelogWindow && !changelogWindow.isDestroyed()) {
        changelogWindow.focus()
        return
    }

    changelogWindow = new BrowserWindow({
        width: 800,
        height: 700,
        title: "BeePEE - What's New",
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, "..", "preload.js"),
        },
        devTools: isDev,
        skipTaskbar: false,
        minimizable: true,
        maximizable: true,
        resizable: true,
        autoHideMenuBar: true,
    })

    changelogWindow.on("closed", () => {
        changelogWindow = null
    })

    if (isDev) {
        changelogWindow.loadURL(`http://localhost:5173/?route=changelog`)
    } else {
        // Use app.getAppPath() for reliable path resolution in packaged app
        const appPath = app.getAppPath()
        changelogWindow.loadFile(path.join(appPath, "dist", "index.html"), {
            query: { route: "changelog" },
        })
    }

    changelogWindow.setMenuBarVisibility(false)
}

/**
 * Create a 3D model preview window
 * @param {object} modelData - Object containing objUrl, mtlUrl, title, and optional segments
 */
function createModelPreviewWindow(modelData) {
    const { objPath, title = "Model Preview" } = modelData
    // One window per model (or per key, like a model shown another way)
    const windowKey = modelData.key || objPath || `preview-${Date.now()}`

    // If window already exists for this model, focus it
    if (openModelPreviewWindows.has(windowKey)) {
        const existingWindow = openModelPreviewWindows.get(windowKey)
        if (!existingWindow.isDestroyed()) {
            existingWindow.focus()
            return existingWindow
        }
        openModelPreviewWindows.delete(windowKey)
    }

    const previewWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        title,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, "..", "preload.js"),
            webSecurity: false, // Required for loading local files via beep://
        },
        devTools: isDev,
        skipTaskbar: false,
        minimizable: true,
        maximizable: true,
        resizable: true,
        autoHideMenuBar: true,
    })

    openModelPreviewWindows.set(windowKey, previewWindow)

    previewWindow.on("closed", () => {
        openModelPreviewWindows.delete(windowKey)
    })

    // Also clean up when window is about to close
    previewWindow.on("close", () => {
        try {
            if (previewWindow.webContents && !previewWindow.webContents.isDestroyed()) {
                previewWindow.webContents.session.clearStorageData({
                    storages: ["cachestorage", "filesystem", "indexdb", "localstorage", "shadercache", "websql", "serviceworkers"],
                })
            }
        } catch (e) {
            // Ignore cleanup errors
        }
    })

    if (isDev) {
        previewWindow.loadURL(`http://localhost:5173/?route=model-preview`)
    } else {
        const appPath = app.getAppPath()
        previewWindow.loadFile(path.join(appPath, "dist", "index.html"), {
            query: { route: "model-preview" },
        })
    }

    previewWindow.setMenuBarVisibility(false)

    // Send model data after the window has finished loading
    previewWindow.webContents.once("did-finish-load", () => {
        setTimeout(() => {
            previewWindow.webContents.send("model-preview-data", modelData)
        }, 100)
    })

    return previewWindow
}

/** The crash report window's title for an error (none: a bug the user reports) */
function crashReportTitle(errorDetails) {
    if (!errorDetails) return "BeePEE - Report a Bug"
    if (errorDetails.type === "packageOpenFailed") {
        return "BeePEE - Package Failed to Open"
    }
    if (errorDetails.type === "itemsSkipped") {
        return "BeePEE - Items Weren't Loaded"
    }
    return "BeePEE - Unexpected Error"
}

/**
 * Create a crash report window
 * @param {Object|null} errorDetails - Error info or null for manual bug report
 * @param {Object} [options]
 * @param {boolean} [options.replace] - When the window is open already, show
 *   this error in it (the user asked to report it)
 */
function createCrashReportWindow(errorDetails, { replace = false } = {}) {
    // If window already exists, focus it
    if (crashReportWindow && !crashReportWindow.isDestroyed()) {
        if (replace) {
            crashReportWindow.webContents.send("crash-report-data", {
                errorDetails: errorDetails || null,
                isManual: !errorDetails,
            })
            crashReportWindow.setTitle(crashReportTitle(errorDetails))
        }
        crashReportWindow.focus()
        return
    }

    const isManual = !errorDetails

    crashReportWindow = new BrowserWindow({
        width: 500,
        height: 550,
        title: crashReportTitle(errorDetails),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, "..", "preload.js"),
        },
        devTools: isDev,
        skipTaskbar: false,
        minimizable: true,
        maximizable: true,
        resizable: true,
        autoHideMenuBar: true,
    })

    crashReportWindow.on("closed", () => {
        crashReportWindow = null
    })

    if (isDev) {
        crashReportWindow.loadURL(`http://localhost:5173/?route=crash-report`)
    } else {
        const appPath = app.getAppPath()
        crashReportWindow.loadFile(path.join(appPath, "dist", "index.html"), {
            query: { route: "crash-report" },
        })
    }

    crashReportWindow.setMenuBarVisibility(false)

    // Send crash report data after the window has finished loading
    crashReportWindow.webContents.once("did-finish-load", () => {
        setTimeout(() => {
            crashReportWindow.webContents.send("crash-report-data", {
                errorDetails: errorDetails || null,
                isManual,
            })
        }, 100)
    })
}

/**
 * Close all model preview windows to release file handles
 */
async function closeAllModelPreviewWindows() {
    const closePromises = []
    for (const [key, window] of openModelPreviewWindows) {
        if (window && !window.isDestroyed()) {
            // Clear all session caches before closing
            try {
                const session = window.webContents.session
                await session.clearCache()
                await session.clearStorageData({
                    storages: ["appcache", "cookies", "filesystem", "indexdb", "localstorage", "shadercache", "websql", "serviceworkers", "cachestorage"],
                })
            } catch (e) {
                // Ignore cleanup errors
            }

            closePromises.push(
                new Promise((resolve) => {
                    window.once("closed", resolve)
                    window.close()
                })
            )
        } else {
            openModelPreviewWindows.delete(key)
        }
    }

    if (closePromises.length > 0) {
        await Promise.all(closePromises)
        // Give more time for file handles to be released after cache clear
        await new Promise((resolve) => setTimeout(resolve, 500))

        // Force garbage collection if available
        if (global.gc) {
            global.gc()
            await new Promise((resolve) => setTimeout(resolve, 100))
        }
    }
}

/**
 * Close all item editor windows to release file handles
 */
async function closeAllEditorWindows() {
    const closePromises = []
    for (const [key, window] of openEditors) {
        if (window && !window.isDestroyed()) {
            // Clear all session caches before closing
            try {
                const session = window.webContents.session
                await session.clearCache()
                await session.clearStorageData({
                    storages: ["appcache", "cookies", "filesystem", "indexdb", "localstorage", "shadercache", "websql", "serviceworkers", "cachestorage"],
                })
            } catch (e) {
                // Ignore cleanup errors
            }

            closePromises.push(
                new Promise((resolve) => {
                    window.once("closed", resolve)
                    window.close()
                })
            )
        } else {
            openEditors.delete(key)
        }
    }

    if (closePromises.length > 0) {
        console.log(
            `Closing ${plural(closePromises.length, "item editor window")}`,
        )
        await Promise.all(closePromises)
        // Give time for file handles to be released
        await new Promise((resolve) => setTimeout(resolve, 300))

        // Force garbage collection if available
        if (global.gc) {
            global.gc()
            await new Promise((resolve) => setTimeout(resolve, 100))
        }
    }
}

/**
 * Close all signage editor windows
 */
async function closeAllSignageEditorWindows() {
    const closePromises = []
    for (const [key, window] of openSignageEditors) {
        if (window && !window.isDestroyed()) {
            closePromises.push(
                new Promise((resolve) => {
                    window.once("closed", resolve)
                    window.close()
                })
            )
        } else {
            openSignageEditors.delete(key)
        }
    }

    if (closePromises.length > 0) {
        console.log(
            `Closing ${plural(closePromises.length, "signage editor window")}`,
        )
        await Promise.all(closePromises)
        await new Promise((resolve) => setTimeout(resolve, 300))
    }
}

/**
 * Close all icon maker windows
 */
async function closeAllIconMakerWindows() {
    const closing = [...openIconMakers.values()]
        .filter((window) => !window.isDestroyed())
        .map(
            (window) =>
                new Promise((resolve) => {
                    window.once("closed", resolve)
                    window.close()
                }),
        )
    await Promise.all(closing)
}

/**
 * Close all windows (editors, model previews, etc.) to release all file handles
 */
async function closeAllWindows() {
    const isOpen = (window) => window && !window.isDestroyed()
    const open = [
        ...openEditors.values(),
        ...openIconMakers.values(),
        ...openSignageEditors.values(),
        ...openModelPreviewWindows.values(),
        createItemWindow,
        createPackageWindow,
    ].filter(isOpen).length
    const closeAll = async () => {
        await closeAllIconMakerWindows()
        await closeAllEditorWindows()
        await closeAllSignageEditorWindows()
        await closeAllModelPreviewWindows()

        // Also close create item and create package windows if open
        if (createItemWindow && !createItemWindow.isDestroyed()) {
            createItemWindow.close()
        }
        if (createPackageWindow && !createPackageWindow.isDestroyed()) {
            createPackageWindow.close()
        }

        // Give extra time for all handles to be released
        await new Promise((resolve) => setTimeout(resolve, 500))

        // Force garbage collection
        if (global.gc) {
            global.gc()
            await new Promise((resolve) => setTimeout(resolve, 200))
        }
    }
    // Only worth logging when there were windows to close
    if (open === 0) return closeAll()
    const windows = open === 1 ? "1 window" : `${open} windows`
    return logger.section(`Closing ${windows} to release files`, closeAll)
}

/**
 * Create the setup window for first-run configuration
 * @param {BrowserWindow} mainWindow - The main window reference
 * @returns {Promise} Resolves when setup is complete or window is closed
 */
function createSetupWindow(mainWindow) {
    return new Promise((resolve) => {
        // If window already exists, focus it
        if (setupWindow && !setupWindow.isDestroyed()) {
            setupWindow.focus()
            return
        }

        setupWindow = new BrowserWindow({
            width: 640,
            height: 640,
            title: "BeePEE Setup",
            resizable: false,
            minimizable: false,
            maximizable: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, "..", "preload.js"),
            },
            devTools: isDev,
            autoHideMenuBar: true,
        })

        setupWindow.setMenuBarVisibility(false)

        setupWindow.on("closed", () => {
            setupWindow = null
            resolve()
        })

        if (isDev) {
            setupWindow.loadURL(`http://localhost:5173/?route=setup`)
        } else {
            const appPath = app.getAppPath()
            setupWindow.loadFile(path.join(appPath, "dist", "index.html"), {
                query: { route: "setup" },
            })
        }
    })
}

/**
 * Close the setup window
 */
function closeSetupWindow() {
    if (setupWindow && !setupWindow.isDestroyed()) {
        setupWindow.close()
    }
}

/**
 * Create the settings/preferences window
 * @param {BrowserWindow} mainWindow - The main window reference
 * @param {string} [initialTab] - Tab to open on ("signage")
 */
function createSettingsWindow(mainWindow, initialTab) {
    // If window already exists, focus it
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.focus()
        return
    }

    settingsWindow = new BrowserWindow({
        width: 960,
        height: 1024,
        title: "BeePEE - Preferences",
        resizable: true,
        minimizable: true,
        maximizable: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, "..", "preload.js"),
        },
        devTools: isDev,
        autoHideMenuBar: true,
    })

    settingsWindow.setMenuBarVisibility(false)

    settingsWindow.on("closed", () => {
        settingsWindow = null
    })

    const tabQuery = initialTab ? `&tab=${initialTab}` : ""
    if (isDev) {
        settingsWindow.loadURL(
            `http://localhost:5173/?route=settings${tabQuery}`,
        )
    } else {
        const appPath = app.getAppPath()
        settingsWindow.loadFile(path.join(appPath, "dist", "index.html"), {
            query: {
                route: "settings",
                ...(initialTab ? { tab: initialTab } : {}),
            },
        })
    }
}

/**
 * Close the settings window
 */
function closeSettingsWindow() {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.close()
    }
}

let importItemsWindow = null

/**
 * Create the Item Importer window (File > Import from Package...)
 */
function createImportItemsWindow(mainWindow) {
    if (importItemsWindow && !importItemsWindow.isDestroyed()) {
        importItemsWindow.focus()
        return
    }

    // Match the main window's size. No parent relationship - closing a
    // parented child can minimize the whole app on Windows.
    let width = 900
    let height = 700
    try {
        if (mainWindow && !mainWindow.isDestroyed()) {
            const bounds = mainWindow.getBounds()
            width = bounds.width
            height = bounds.height
        }
    } catch {
        /* fall back to defaults */
    }

    importItemsWindow = new BrowserWindow({
        width,
        height,
        title: "BeePEE - Import from Package",
        resizable: true,
        minimizable: true,
        maximizable: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, "..", "preload.js"),
        },
        devTools: isDev,
        autoHideMenuBar: true,
    })

    importItemsWindow.setMenuBarVisibility(false)

    importItemsWindow.on("closed", () => {
        importItemsWindow = null
    })

    if (isDev) {
        importItemsWindow.loadURL(
            `http://localhost:5173/?route=import-items`,
        )
    } else {
        const appPath = app.getAppPath()
        importItemsWindow.loadFile(path.join(appPath, "dist", "index.html"), {
            query: { route: "import-items" },
        })
    }
}

function closeImportItemsWindow() {
    if (importItemsWindow && !importItemsWindow.isDestroyed()) {
        importItemsWindow.close()
    }
}

module.exports = {
    createItemEditor,
    sendItemUpdateToEditor,
    openEditors,
    createIconMakerWindow,
    sendMadeIconToEditor,
    createTimerColorsWindow,
    sendTimerColorsToEditor,
    createSignageEditor,
    sendSignageUpdateToEditor,
    sendStagedDesignToEditor,
    openSignageEditors,
    createItemCreationWindow,
    getCreateItemWindow: () => createItemWindow,
    createSignageDesignerWindow,
    getSignageDesignerWindow: () => signageDesignerWindow,
    createPackageCreationWindow,
    getCreatePackageWindow: () => createPackageWindow,
    createPackageInformationWindow,
    getPackageInformationWindow: () => packageInformationWindow,
    createChangelogWindow,
    getChangelogWindow: () => changelogWindow,
    createCrashReportWindow,
    getCrashReportWindow: () => crashReportWindow,
    createModelPreviewWindow,
    closeAllModelPreviewWindows,
    closeAllEditorWindows,
    closeAllWindows,
    openModelPreviewWindows,
    createSetupWindow,
    closeSetupWindow,
    getSetupWindow: () => setupWindow,
    createSettingsWindow,
    closeSettingsWindow,
    getSettingsWindow: () => settingsWindow,
    createImportItemsWindow,
    closeImportItemsWindow,
}
