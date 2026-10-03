/**
 * Icon maker: generates an item's model to take its palette icon from (see
 * src/components/items/IconMaker.jsx), and saves the icon the window renders.
 * The icon is staged like a picked icon file: Save copies it into the package
 * and makes the palette VTF (saveItem.js).
 */

const fs = require("fs")
const path = require("path")
const { packages } = require("../packageManager")
const { Instance } = require("../items/Instance")
const { convertVmfToObj } = require("../utils/vmf2obj")
const { logger } = require("../utils/logger")

const IMAGE_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".tga": "image/x-tga",
}

/** The icon maker's folder for an item, in the package's staging folder */
function iconFolder(item) {
    const safeId = item.id.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase()
    return path.join(item.packagePath, ".bpee", safeId, "icon")
}

function findItem(itemId) {
    const item = packages.flatMap((p) => p.items).find((i) => i.id === itemId)
    if (!item) throw new Error("Item not found")
    return item
}

function register(ipcMain) {
    // The model of one of the item's instances: its OBJ and MTL text, and
    // the textures the MTL names as data URLs (the editor window can't load
    // local files itself)
    ipcMain.handle(
        "icon-maker-generate-model",
        async (event, { itemId, instanceKey }) => {
            try {
                const item = findItem(itemId)
                const instance = item.instances?.[instanceKey]
                if (!instance?.Name) throw new Error("Instance not found")
                const vmfPath = Instance.getCleanPath(
                    item.packagePath,
                    instance.Name,
                )
                return await logger.section(
                    `Making the icon model of "${item.name}" (instance ${instanceKey})`,
                    async () => {
                        const outputDir = path.join(iconFolder(item), "model")
                        // A clean folder: only this instance's textures
                        fs.rmSync(outputDir, { recursive: true, force: true })
                        const result = await convertVmfToObj(vmfPath, {
                            outputDir,
                            textureStyle: "cartoon",
                        })
                        const mtl = fs.readFileSync(result.mtlPath, "utf8")
                        const textures = {}
                        for (const [, name] of mtl.matchAll(
                            /^map_\w+\s+(.+)$/gm,
                        )) {
                            const relative = name.trim()
                            const file = path.join(outputDir, relative)
                            const type =
                                IMAGE_TYPES[path.extname(file).toLowerCase()]
                            if (textures[relative] || !type) continue
                            if (!fs.existsSync(file)) continue
                            const data = fs
                                .readFileSync(file)
                                .toString("base64")
                            textures[relative] = `data:${type};base64,${data}`
                        }
                        return {
                            success: true,
                            obj: fs.readFileSync(result.objPath, "utf8"),
                            mtl,
                            textures,
                        }
                    },
                )
            } catch (error) {
                return { success: false, error: error.message }
            }
        },
    )

    // Save the rendered icon (a PNG) to stage it as the item's icon
    ipcMain.handle("icon-maker-save-icon", async (event, { itemId, png }) => {
        try {
            const item = findItem(itemId)
            const folder = iconFolder(item)
            fs.mkdirSync(folder, { recursive: true })
            // A new name each time, so the editor shows the new icon; the
            // older ones aren't needed any more
            for (const name of fs.readdirSync(folder)) {
                if (/^icon_\d+\.png$/.test(name)) {
                    fs.rmSync(path.join(folder, name), { force: true })
                }
            }
            const fileName = `icon_${Date.now()}.png`
            const filePath = path.join(folder, fileName)
            fs.writeFileSync(filePath, Buffer.from(png, "base64"))
            console.log(`Made an icon for "${item.name}": ${filePath}`)
            return { success: true, filePath, fileName }
        } catch (error) {
            console.error("Failed to save the made icon:", error)
            return { success: false, error: error.message }
        }
    })
}

module.exports = { register, iconFolder }
