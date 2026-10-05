const { submitCrashReport } = require("../utils/crashReporter")
const { getCrashReportEndpoint } = require("../utils/crashReportConfig")
const { reportFailedPackage } = require("../packageManager")

/**
 * Register crash report IPC handlers
 * @param {Electron.IpcMain} ipcMain
 * @param {Electron.BrowserWindow} mainWindow
 */
function register(ipcMain, mainWindow) {
    ipcMain.handle("submit-crash-report", async (event, { userDescription, errorDetails, contact }) => {
        try {
            return await submitCrashReport({ userDescription, errorDetails, contact })
        } catch (error) {
            console.error("Failed to submit crash report:", error)
            return { success: false, error: error.message }
        }
    })

    // Report in the loading popup, for a package that failed to open
    ipcMain.handle("report-failed-package", async (event, failureId) => {
        return { success: reportFailedPackage(failureId) }
    })

    ipcMain.handle("get-crash-report-status", async () => {
        const endpoint = getCrashReportEndpoint()
        return { configured: !!endpoint }
    })

    ipcMain.handle("is-update-available", async () => {
        const updater = global.updaterInstance
        if (updater && updater.updateAvailableVersion) {
            return {
                updateAvailable: true,
                latestVersion: updater.updateAvailableVersion,
                currentVersion: require("../../package.json").version,
            }
        }
        return { updateAvailable: false }
    })
}

module.exports = { register }
