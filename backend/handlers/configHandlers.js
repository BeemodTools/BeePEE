/**
 * The package's config groups (Edit > Package Config): read for its window
 * and the item editor's Get Config blocks, and saved from the window
 */

const fs = require("fs")
const path = require("path")
const { BrowserWindow } = require("electron")
const { packages, getCurrentPackageDir } = require("../packageManager")
const {
    configGroupErrors,
    readConfigGroups,
    withConfigGroups,
} = require("../utils/configGroups")

/** "1 group", "3 groups" */
const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`

/** The package an item is in, or the open one */
function packageDirOf(itemId) {
    if (itemId) {
        const item = packages
            .flatMap((p) => p.items)
            .find((i) => i.id === itemId)
        if (item) return item.packagePath
    }
    return getCurrentPackageDir()
}

const readInfo = (packageDir) =>
    JSON.parse(fs.readFileSync(path.join(packageDir, "info.json"), "utf-8"))

function register(ipcMain) {
    // The config groups of an item's package, or of the open one
    ipcMain.handle("get-config-groups", async (event, { itemId } = {}) => {
        try {
            const packageDir = packageDirOf(itemId)
            if (!packageDir) {
                return { success: false, error: "No package is open" }
            }
            const info = readInfo(packageDir)
            return {
                success: true,
                packageDir,
                packageId: info.ID || "",
                packageName: info.Name || info.ID || "",
                groups: readConfigGroups(info),
            }
        } catch (error) {
            console.error("Failed to read the package's config groups:", error)
            return { success: false, error: error.message }
        }
    })

    // Save the Package Config window's groups in the package it was opened
    // for (not another one opened since)
    ipcMain.handle(
        "save-config-groups",
        async (event, { packageDir, groups } = {}) => {
            try {
                if (!packageDir || packageDir !== getCurrentPackageDir()) {
                    throw new Error(
                        "Another package was opened since this window was: open Package Config again",
                    )
                }
                if (!Array.isArray(groups)) {
                    throw new Error("The config groups to save aren't a list")
                }
                const errors = configGroupErrors(groups)
                if (errors.length > 0) throw new Error(errors[0])

                const infoPath = path.join(packageDir, "info.json")
                const info = withConfigGroups(readInfo(packageDir), groups)
                fs.writeFileSync(infoPath, JSON.stringify(info, null, 2))
                console.log(
                    `Saved the package's ${plural(groups.length, "config group")}`,
                )
                // The package has changes its .bpee doesn't
                global.titleManager?.setUnsavedChanges(true)
                // Item editors list them in their Get Config blocks
                for (const window of BrowserWindow.getAllWindows()) {
                    if (!window.isDestroyed()) {
                        window.webContents.send("config-groups-changed")
                    }
                }
                return { success: true, groups: readConfigGroups(info) }
            } catch (error) {
                console.error(
                    "Failed to save the package's config groups:",
                    error,
                )
                return { success: false, error: error.message }
            }
        },
    )
}

module.exports = { register }
