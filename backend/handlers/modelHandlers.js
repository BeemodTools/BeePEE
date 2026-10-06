/**
 * Model name, metadata, and save handlers
 */

const { dialog, BrowserWindow } = require("electron")
const fs = require("fs")
const path = require("path")
const { packages } = require("../packageManager")
const { sendItemUpdateToEditor } = require("../items/itemEditor")
const { handleItemSave } = require("./shared")

/**
 * The item's editoritems as they are now, with what Make Model made: its
 * SubTypes (their models) and the property that picks one. Make Model staged
 * the whole file as it was then, so writing that would undo what was saved
 * since, the same save's variables, instances, inputs and outputs and name
 * too. The first SubType's name and palette are the Info tab's, as now.
 * @param {Object} current - item.getEditorItems()
 * @param {Object} staged - Make Model's stagedEditorItems
 */
function withMadeModels(current, staged) {
    const editor = current.Item?.Editor ?? {}
    const made = staged.Item?.Editor ?? {}
    const nowFirst = [editor.SubType].flat()[0]
    const madeSubTypes = [made.SubType].flat().filter(Boolean)
    const madeName = madeSubTypes[0]?.Name
    const subTypes = madeSubTypes.map((subType, index) => {
        if (!nowFirst) return subType
        return {
            ...subType,
            // Every SubType of a variable's models has the item's name
            ...((index === 0 || subType.Name === madeName) &&
                nowFirst.Name !== undefined && { Name: nowFirst.Name }),
            ...(index === 0 && nowFirst.Palette && { Palette: nowFirst.Palette }),
        }
    })
    const { SubType: _subType, SubTypeProperty: _property, ...rest } = editor
    current.Item.Editor = {
        ...(made.SubTypeProperty !== undefined && {
            SubTypeProperty: made.SubTypeProperty,
        }),
        SubType: Array.isArray(made.SubType) ? subTypes : subTypes[0],
        ...rest,
    }
    return current
}

function register(ipcMain, mainWindow) {
    // Save item handler
    // Note: Frontend passes itemData directly (not wrapped in object)
    ipcMain.handle("save-item", async (event, itemData) => {
        return handleItemSave(itemData, event, mainWindow)
    })

    // Model name management handlers
    ipcMain.handle("get-model-name", async (event, { itemId }) => {
        try {
            const item = packages
                .flatMap((p) => p.items)
                .find((i) => i.id === itemId)
            if (!item) throw new Error("Item not found")

            return { success: true, modelName: item.getModelName() }
        } catch (error) {
            return { success: false, error: error.message }
        }
    })

    ipcMain.handle("save-model-name", async (event, { itemId, modelName }) => {
        try {
            const item = packages
                .flatMap((p) => p.items)
                .find((i) => i.id === itemId)
            if (!item) throw new Error("Item not found")

            const success = item.setModelName(modelName)
            if (!success) {
                throw new Error("Failed to save model name to editoritems.json")
            }

            // If switching away from a bpee/ generated model, clear hasCustomModel flag
            if (!modelName || !modelName.startsWith("bpee/")) {
                const metadata = item.getMetadata()
                if (metadata?.hasCustomModel) {
                    item.updateMetadata({ hasCustomModel: false })
                }
            }

            const updatedItem = item.toJSONWithExistence()
            mainWindow.webContents.send("item-updated", updatedItem)
            sendItemUpdateToEditor(itemId, updatedItem)

            return { success: true }
        } catch (error) {
            console.error(
                `Failed to save the model name of item ${itemId}:`,
                error,
            )
            dialog.showErrorBox("Failed to Save Model Name", error.message)
            return { success: false, error: error.message }
        }
    })

    // Metadata management handlers
    ipcMain.handle("get-item-metadata", async (event, { itemId }) => {
        try {
            const item = packages
                .flatMap((p) => p.items)
                .find((i) => i.id === itemId)
            if (!item) throw new Error("Item not found")

            return { success: true, metadata: item.getMetadata() }
        } catch (error) {
            return { success: false, error: error.message }
        }
    })

    ipcMain.handle(
        "update-item-metadata",
        async (event, { itemId, metadata }) => {
            try {
                const item = packages
                    .flatMap((p) => p.items)
                    .find((i) => i.id === itemId)
                if (!item) throw new Error("Item not found")

                const success = item.updateMetadata(metadata)
                if (success) {
                    const updatedItem = item.toJSONWithExistence()
                    mainWindow.webContents.send("item-updated", updatedItem)
                    sendItemUpdateToEditor(itemId, updatedItem)
                }

                return { success }
            } catch (error) {
                console.error(
                    `Failed to update the metadata of item ${itemId}:`,
                    error,
                )
                dialog.showErrorBox("Failed to Update Metadata", error.message)
                return { success: false, error: error.message }
            }
        },
    )

    // Instance metadata handler
    ipcMain.handle(
        "get-instance-metadata",
        async (event, { itemId, instanceIndex }) => {
            try {
                const item = packages
                    .flatMap((p) => p.items)
                    .find((i) => i.id === itemId)
                if (!item) throw new Error("Item not found")

                const metadata = item.getInstanceMetadata(instanceIndex)
                return { success: true, metadata }
            } catch (error) {
                return { success: false, error: error.message }
            }
        },
    )

    // Save staged editoritems (from model generation)
    ipcMain.handle("save-staged-editoritems", async (event, { itemId, stagedEditorItems, hasObjFiles = false }) => {
        try {
            const item = packages
                .flatMap((p) => p.items)
                .find((i) => i.id === itemId)
            if (!item) throw new Error("Item not found")

            if (!stagedEditorItems) {
                throw new Error("No staged editoritems provided")
            }

            item.saveEditorItems(
                withMadeModels(item.getEditorItems(), stagedEditorItems),
            )

            // Check if a custom model was added
            const subType = stagedEditorItems?.Item?.Editor?.SubType
            const subTypes = Array.isArray(subType) ? subType : [subType]

            let hasValidCustomModel = false
            for (const st of subTypes) {
                if (!st?.Model?.ModelName) continue

                const modelName = st.Model.ModelName
                if (typeof modelName === 'string' && modelName.startsWith('bpee/')) {
                    const modelPath = path.join(item.packagePath, "resources", "models", "props_map_editor", modelName)

                    if (fs.existsSync(modelPath) && hasObjFiles) {
                        hasValidCustomModel = true
                        break
                    }
                }
            }

            if (hasValidCustomModel) {
                item.updateMetadata({ hasCustomModel: true })
            }

            const updatedItem = item.toJSONWithExistence()
            mainWindow.webContents.send("item-updated", updatedItem)
            sendItemUpdateToEditor(itemId, updatedItem)

            console.log(`Saved the staged editoritems of "${item.name}"`)
            return { success: true }
        } catch (error) {
            console.error(
                `Failed to save the staged editoritems of item ${itemId}:`,
                error,
            )
            return { success: false, error: error.message }
        }
    })

    // Copy staged model/material files from .bpee/ to resources/
    ipcMain.handle("copy-staged-model-files", async (event, { itemId }) => {
        try {
            const item = packages
                .flatMap((p) => p.items)
                .find((i) => i.id === itemId)
            if (!item) throw new Error("Item not found")

            const packagePath = item.packagePath
            const stagingDir = path.join(packagePath, ".bpee")

            if (!fs.existsSync(stagingDir)) {
                return { success: true, copied: false }
            }

            // Copy staged models
            const stagedModelsDir = path.join(stagingDir, "models")
            if (fs.existsSync(stagedModelsDir)) {
                const targetModelsDir = path.join(packagePath, "resources", "models")
                copyRecursive(stagedModelsDir, targetModelsDir, packagePath)
            }

            // Copy staged materials
            const stagedMaterialsDir = path.join(stagingDir, "materials")
            if (fs.existsSync(stagedMaterialsDir)) {
                const targetMaterialsDir = path.join(packagePath, "resources", "materials")
                copyRecursive(stagedMaterialsDir, targetMaterialsDir, packagePath)
            }

            // Check if OBJ files exist in .bpee/{itemName}/models/
            const itemName = item.id.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase()
            const objModelsDir = path.join(stagingDir, itemName, "models")
            let hasObjFiles = false

            if (fs.existsSync(objModelsDir)) {
                const files = fs.readdirSync(objModelsDir)
                hasObjFiles = files.some(file => file.endsWith('.obj'))
            }

            // Clean up staging directory after successful copy
            if (fs.existsSync(stagedModelsDir)) {
                fs.rmSync(stagedModelsDir, { recursive: true, force: true })
            }
            if (fs.existsSync(stagedMaterialsDir)) {
                fs.rmSync(stagedMaterialsDir, { recursive: true, force: true })
            }
            // Clean up tempmdl directory if it exists
            const tempmdlDir = path.join(stagingDir, "tempmdl")
            if (fs.existsSync(tempmdlDir)) {
                fs.rmSync(tempmdlDir, { recursive: true, force: true })
            }

            return { success: true, copied: true, hasObjFiles }
        } catch (error) {
            console.error(
                `Failed to copy the staged model files of item ${itemId}:`,
                error,
            )
            return { success: false, error: error.message }
        }
    })
}

/**
 * Recursively copy files from source to destination
 */
function copyRecursive(src, dest, packagePath) {
    if (!fs.existsSync(src)) return

    if (fs.statSync(src).isDirectory()) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true })
        }
        for (const file of fs.readdirSync(src)) {
            copyRecursive(path.join(src, file), path.join(dest, file), packagePath)
        }
    } else {
        fs.copyFileSync(src, dest)
    }
}

module.exports = { register, withMadeModels }
