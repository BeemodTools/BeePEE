/**
 * Logs from the windows: each window's console output (sent by
 * src/utils/logForwarding.js) goes into BeePEE's log, marked with the window
 * it came from, e.g. "[Item Editor] Saved item ...".
 */

const { logger } = require("../utils/logger")

const LEVELS = new Set(["info", "warn", "error", "debug"])

/** Window names for routes that don't read well title-cased */
const WINDOW_NAMES = {
    editor: "Item Editor",
}

/**
 * The name of the window a message came from, from its "?route=" (see App.jsx)
 * @param {Electron.WebContents} webContents
 */
function windowName(webContents) {
    try {
        const route = new URL(webContents.getURL()).searchParams.get("route")
        if (!route) return "Main window"
        return (
            WINDOW_NAMES[route] ??
            route
                .split("-")
                .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                .join(" ")
        )
    } catch {
        return "Window"
    }
}

let registered = false

/**
 * Start logging the windows' console output (once, before any window opens)
 * @param {Electron.IpcMain} ipcMain
 */
function register(ipcMain) {
    if (registered) return
    registered = true

    ipcMain.on("renderer:log", (event, level, text) => {
        if (!LEVELS.has(level) || typeof text !== "string") return
        logger.fromWindow(windowName(event.sender), level, text)
    })
}

module.exports = { register, windowName }
