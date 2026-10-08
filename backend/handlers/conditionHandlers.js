/**
 * Conditions and VBSP conversion handlers
 */

const { dialog } = require("electron")
const fs = require("fs")
const path = require("path")
const { packages } = require("../packageManager")
const { sendItemUpdateToEditor } = require("../items/itemEditor")

const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`

function register(ipcMain, mainWindow) {
    // Conditions management handlers
    ipcMain.handle("get-conditions", async (event, { itemId }) => {
        try {
            const item = packages
                .flatMap((p) => p.items)
                .find((i) => i.id === itemId)
            if (!item) throw new Error("Item not found")

            return { success: true, conditions: item.getConditions() }
        } catch (error) {
            return { success: false, error: error.message }
        }
    })

    ipcMain.handle("save-conditions", async (event, { itemId, conditions }) => {
        try {
            const item = packages
                .flatMap((p) => p.items)
                .find((i) => i.id === itemId)
            if (!item) throw new Error("Item not found")

            // Convert blocks to VBSP format and save
            const success = item.saveConditions(conditions)
            if (!success) {
                throw new Error("Failed to save conditions to VBSP config")
            }
            console.log(
                `Saved ${plural(conditions?.blocks?.length ?? 0, "condition block")} of "${item.name}"`,
            )

            // Send updated item data to frontend
            const updatedItem = item.toJSONWithExistence()
            mainWindow.webContents.send("item-updated", updatedItem)
            sendItemUpdateToEditor(itemId, updatedItem)

            return { success: true }
        } catch (error) {
            console.error(
                `Failed to save the conditions of item ${itemId}:`,
                error,
            )
            dialog.showErrorBox("Failed to Save Conditions", error.message)
            return { success: false, error: error.message }
        }
    })

    // Load VBSP prefabs
    ipcMain.handle("get-vbsp-prefabs", async () => {
        try {
            // Check both dev and packaged paths
            const devPath = path.join(__dirname, "..", "prefabs", "vbsp_prefabs.json")
            const packagedPath = path.join(process.resourcesPath || "", "prefabs", "vbsp_prefabs.json")

            let prefabsPath = null
            if (fs.existsSync(devPath)) {
                prefabsPath = devPath
            } else if (fs.existsSync(packagedPath)) {
                prefabsPath = packagedPath
            }

            if (!prefabsPath) {
                return { success: false, error: "Prefabs file not found" }
            }

            const prefabsData = JSON.parse(fs.readFileSync(prefabsPath, "utf-8"))
            return { success: true, prefabs: prefabsData }
        } catch (error) {
            console.error("Failed to load VBSP prefabs:", error)
            return { success: false, error: error.message }
        }
    })
}

module.exports = { register }
