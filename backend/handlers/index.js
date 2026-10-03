/**
 * Handler aggregation module
 * Imports and registers all IPC handlers
 */

const appHandlers = require("./appHandlers")
const itemHandlers = require("./itemHandlers")
const packageHandlers = require("./packageHandlers")
const instanceHandlers = require("./instanceHandlers")
const propertyHandlers = require("./propertyHandlers")
const modelHandlers = require("./modelHandlers")
const conditionHandlers = require("./conditionHandlers")
const conversionHandlers = require("./conversionHandlers")
const resourceHandlers = require("./resourceHandlers")
const updateHandlers = require("./updateHandlers")
const dialogHandlers = require("./dialogHandlers")
const crashReportHandlers = require("./crashReportHandlers")
const signageHandlers = require("./signageHandlers")
const settingsHandlers = require("./settingsHandlers")
const importHandlers = require("./importHandlers")
const iconHandlers = require("./iconHandlers")

// Track if settings handlers were registered early (for setup window)
let settingsHandlersRegistered = false

/**
 * Register settings handlers early (for setup window before main window exists)
 */
function registerSettingsHandlersEarly(ipcMain) {
    if (!settingsHandlersRegistered) {
        settingsHandlers.register(ipcMain, null)
        settingsHandlersRegistered = true
    }
}

/**
 * Register all IPC handlers
 * @param {Electron.IpcMain} ipcMain - The Electron IPC main instance
 * @param {Electron.BrowserWindow} mainWindow - The main application window
 */
function registerAll(ipcMain, mainWindow) {
    appHandlers.register(ipcMain, mainWindow)
    itemHandlers.register(ipcMain, mainWindow)
    packageHandlers.register(ipcMain, mainWindow)
    instanceHandlers.register(ipcMain, mainWindow)
    propertyHandlers.register(ipcMain, mainWindow)
    modelHandlers.register(ipcMain, mainWindow)
    conditionHandlers.register(ipcMain, mainWindow)
    conversionHandlers.register(ipcMain, mainWindow)
    resourceHandlers.register(ipcMain, mainWindow)
    updateHandlers.register(ipcMain, mainWindow)
    dialogHandlers.register(ipcMain, mainWindow)
    crashReportHandlers.register(ipcMain, mainWindow)
    signageHandlers.register(ipcMain, mainWindow)
    importHandlers.register(ipcMain, mainWindow)
    iconHandlers.register(ipcMain, mainWindow)

    // Only register settings handlers if not already registered
    if (!settingsHandlersRegistered) {
        settingsHandlers.register(ipcMain, mainWindow)
        settingsHandlersRegistered = true
    }
}

module.exports = { registerAll, registerSettingsHandlersEarly }
