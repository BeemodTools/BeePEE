/**
 * Icon maker: generates an item's model to take its palette icon from (see
 * src/components/items/IconMaker.jsx), and saves the icon the window renders.
 * The icon maker has its own window (src/pages/IconMakerPage.jsx), which
 * hands the icon to the item's editor. There it's staged like a picked icon
 * file: Save copies it into the package and makes the palette VTF
 * (saveItem.js).
 *
 * Each instance's model is kept in .bpee/<item>/icon/models/<instance>/ with
 * a stamp of the VMF it was made from, so it's only made again when the VMF
 * changes. The models Make Model makes are kept there too (keepMadeModels).
 * The Model Chooser can use these models as the item's model too.
 */

const fs = require("fs")
const path = require("path")
const { packages } = require("../packageManager")
const { Instance } = require("../items/Instance")
const { convertVmfToObj, MODEL_FORMAT } = require("../utils/vmf2obj")
const { parseVmf } = require("../utils/vmfConverter/vmf")
const { hasDrawableContent } = require("../utils/vmfConverter")
const { logger } = require("../utils/logger")
const {
    createIconMakerWindow,
    sendMadeIconToEditor,
} = require("../items/itemEditor")

const IMAGE_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".tga": "image/x-tga",
}

/** What a kept model was made from (next to its OBJ) */
const STAMP = "source.json"

/** The icon maker's folder for an item, in the package's staging folder */
function iconFolder(item) {
    const safeId = item.id.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase()
    return path.join(item.packagePath, ".bpee", safeId, "icon")
}

/** Where an instance's model is kept */
function instanceModelFolder(item, instanceKey) {
    const safeKey = String(instanceKey).replace(/[^a-zA-Z0-9_-]/g, "_")
    return path.join(iconFolder(item), "models", safeKey)
}

function findItem(itemId) {
    const item = packages.flatMap((p) => p.items).find((i) => i.id === itemId)
    if (!item) throw new Error("Item not found")
    return item
}

/** The instance's VMF and its size and date, which the stamp compares */
function instanceSource(item, instanceKey) {
    const instance = item.instances?.[instanceKey]
    if (!instance?.Name) throw new Error("Instance not found")
    const vmf = Instance.getCleanPath(item.packagePath, instance.Name)
    let stats = null
    try {
        stats = fs.statSync(vmf)
    } catch {
        // Missing: converting it says so
    }
    return { vmf, size: stats?.size, modified: stats?.mtimeMs }
}

/**
 * The kept model of an instance, if it was made from the VMF as it is now
 * (by the converter as it is now: MODEL_FORMAT)
 * @returns {{folder: string, objPath: string, mtlPath: string} | null}
 */
function keptInstanceModel(item, instanceKey) {
    const folder = instanceModelFolder(item, instanceKey)
    let stamp
    try {
        stamp = JSON.parse(fs.readFileSync(path.join(folder, STAMP), "utf8"))
    } catch {
        return null
    }
    const source = instanceSource(item, instanceKey)
    if (
        source.size === undefined ||
        stamp.format !== MODEL_FORMAT ||
        stamp.vmf !== source.vmf ||
        stamp.size !== source.size ||
        stamp.modified !== source.modified
    ) {
        return null
    }
    const objPath = path.join(folder, stamp.obj)
    const mtlPath = path.join(folder, stamp.mtl)
    if (!fs.existsSync(objPath) || !fs.existsSync(mtlPath)) return null
    return { folder, objPath, mtlPath }
}

// Models being made, by folder: asking for one that's being made waits for
// it instead of making it twice at once
const making = new Map()

/**
 * An instance's model: the kept one, or made (and kept) now
 * @returns {Promise<{folder: string, objPath: string, mtlPath: string, made: boolean}>}
 */
function instanceModel(item, instanceKey) {
    const kept = keptInstanceModel(item, instanceKey)
    if (kept) return Promise.resolve({ ...kept, made: false })
    const folder = instanceModelFolder(item, instanceKey)
    if (!making.has(folder)) {
        const make = async () => {
            const source = instanceSource(item, instanceKey)
            // A clean folder: only this instance's textures
            fs.rmSync(folder, { recursive: true, force: true })
            const result = await convertVmfToObj(source.vmf, {
                outputDir: folder,
                textureStyle: "cartoon",
            })
            fs.writeFileSync(
                path.join(folder, STAMP),
                JSON.stringify({
                    ...source,
                    format: MODEL_FORMAT,
                    obj: path.basename(result.objPath),
                    mtl: path.basename(result.mtlPath),
                }),
            )
            return {
                folder,
                objPath: result.objPath,
                mtlPath: result.mtlPath,
                made: true,
            }
        }
        making.set(
            folder,
            make().finally(() => making.delete(folder)),
        )
    }
    return making.get(folder)
}

/** Whether two paths are the same file (Windows' paths are in any case) */
function samePath(a, b) {
    return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
}

/**
 * Keep a model Make Model made of the item's instance, for the icon maker to
 * use instead of making it again: its OBJ, and the materials it uses with
 * their textures. Copied: Make Model's folder is shared by the item's
 * models, and its next ones replace files in it.
 */
function keepMadeModel(item, instanceKey, { objPath, mtlPath }, textureStyle) {
    const folder = instanceModelFolder(item, instanceKey)
    // Being made by the icon maker right now: it keeps its own
    if (making.has(folder)) return false
    const source = instanceSource(item, instanceKey)
    if (source.size === undefined) return false

    // The MTL of variants made together lists all of their materials
    const obj = fs.readFileSync(objPath, "utf8")
    const used = new Set(
        [...obj.matchAll(/^usemtl\s+(.+)$/gm)].map(([, name]) => name.trim()),
    )
    const mtl = fs
        .readFileSync(mtlPath, "utf8")
        .split(/\n(?=newmtl )/)
        .filter(
            (block, index) =>
                index === 0 ||
                used.has(block.slice("newmtl ".length).split("\n")[0].trim()),
        )
        .join("\n")

    fs.rmSync(folder, { recursive: true, force: true })
    fs.mkdirSync(folder, { recursive: true })
    const from = path.dirname(objPath)
    for (const [, name] of mtl.matchAll(/^map_\w+\s+(.+)$/gm)) {
        const relative = name.trim()
        const file = path.resolve(from, relative)
        if (path.relative(from, file).startsWith("..")) continue
        if (!fs.existsSync(file)) continue
        const copy = path.join(folder, relative)
        fs.mkdirSync(path.dirname(copy), { recursive: true })
        fs.copyFileSync(file, copy)
    }
    fs.writeFileSync(path.join(folder, path.basename(objPath)), obj)
    fs.writeFileSync(path.join(folder, path.basename(mtlPath)), mtl)
    fs.writeFileSync(
        path.join(folder, STAMP),
        JSON.stringify({
            ...source,
            format: MODEL_FORMAT,
            textureStyle,
            obj: path.basename(objPath),
            mtl: path.basename(mtlPath),
        }),
    )
    return true
}

/**
 * Keep the models Make Model made ({ vmfPath, objPath, mtlPath }) for each of
 * the item's instances with their VMF (see keepMadeModel). Make Model goes
 * on when one can't be kept.
 */
function keepMadeModels(item, models, textureStyle) {
    let kept = 0
    for (const { vmfPath, objPath, mtlPath } of models) {
        if (!vmfPath || !objPath || !mtlPath) continue
        for (const key of instanceKeys(item)) {
            try {
                if (!samePath(instanceSource(item, key).vmf, vmfPath)) continue
                if (keepMadeModel(item, key, { objPath, mtlPath }, textureStyle)) {
                    kept++
                }
            } catch (error) {
                console.warn(
                    `Couldn't keep the model of instance ${key} for the icon maker: ${error.message}`,
                )
            }
        }
    }
    if (kept > 0) {
        console.log(
            `Kept ${kept === 1 ? "the model" : `${kept} models`} for the icon maker`,
        )
    }
}

/**
 * A model's OBJ and MTL text, and the textures the MTL names as data URLs
 * (the editor window can't load local files itself)
 */
function readModel({ folder, objPath, mtlPath }) {
    const mtl = fs.readFileSync(mtlPath, "utf8")
    const textures = {}
    for (const [, name] of mtl.matchAll(/^map_\w+\s+(.+)$/gm)) {
        const relative = name.trim()
        const file = path.join(folder, relative)
        const type = IMAGE_TYPES[path.extname(file).toLowerCase()]
        if (textures[relative] || !type) continue
        if (!fs.existsSync(file)) continue
        const data = fs.readFileSync(file).toString("base64")
        textures[relative] = `data:${type};base64,${data}`
    }
    return { obj: fs.readFileSync(objPath, "utf8"), mtl, textures }
}

/** The item's instances with a VMF, in key order */
function instanceKeys(item) {
    return Object.entries(item.instances ?? {})
        .filter(([, instance]) => instance?.Name)
        .map(([key]) => key)
        .sort((a, b) => Number(a) - Number(b))
}

// Whether VMFs have something to draw, by path, size and date
const drawable = new Map()

/**
 * Why an instance can't be made into a model: "missing" (its VMF doesn't
 * exist) or "empty" (nothing in it to draw); null when it can
 */
function instanceProblem(item, instanceKey) {
    const source = instanceSource(item, instanceKey)
    if (source.size === undefined) return "missing"
    if (source.size === 0) return "empty"
    const key = `${source.vmf}|${source.size}|${source.modified}`
    if (!drawable.has(key)) {
        let result
        try {
            const vmf = parseVmf(fs.readFileSync(source.vmf, "utf8"))
            result = hasDrawableContent(vmf)
        } catch {
            // Unreadable: converting it says why
            result = true
        }
        drawable.set(key, result)
    }
    return drawable.get(key) ? null : "empty"
}

/** The item's instances that can be made into a model, in key order */
function usableInstanceKeys(item) {
    return instanceKeys(item).filter((key) => !instanceProblem(item, key))
}

function register(ipcMain) {
    // The model of one of the item's instances (kept from before when its
    // VMF hasn't changed)
    ipcMain.handle(
        "icon-maker-generate-model",
        async (event, { itemId, instanceKey }) => {
            try {
                const item = findItem(itemId)
                const problem = instanceProblem(item, instanceKey)
                if (problem === "missing") {
                    throw new Error("The instance's VMF file doesn't exist")
                }
                if (problem === "empty") {
                    throw new Error("The instance's VMF has nothing to draw")
                }
                const kept = keptInstanceModel(item, instanceKey)
                if (kept) return { success: true, ...readModel(kept) }
                return await logger.section(
                    `Making the icon model of "${item.name}" (instance ${instanceKey})`,
                    async () => ({
                        success: true,
                        ...readModel(await instanceModel(item, instanceKey)),
                    }),
                )
            } catch (error) {
                return { success: false, error: error.message }
            }
        },
    )

    // Make the models of all the item's instances that aren't kept yet, so
    // switching instances in the icon maker doesn't wait for one
    ipcMain.handle("icon-maker-generate-all", async (event, { itemId }) => {
        try {
            const item = findItem(itemId)
            const missing = usableInstanceKeys(item).filter(
                (key) => !keptInstanceModel(item, key),
            )
            const failed = {}
            if (missing.length > 0) {
                await logger.section(
                    `Making the icon models of "${item.name}" (${missing.length} ${missing.length === 1 ? "instance" : "instances"})`,
                    async () => {
                        for (const key of missing) {
                            try {
                                await instanceModel(item, key)
                            } catch (error) {
                                console.warn(
                                    `Couldn't make the model of instance ${key}: ${error.message}`,
                                )
                                failed[key] = error.message
                            }
                        }
                    },
                )
            }
            return {
                success: true,
                made: missing.length - Object.keys(failed).length,
                failed,
            }
        } catch (error) {
            return { success: false, error: error.message }
        }
    })

    // The instances the icon maker shows: those whose VMF exists and has
    // something to draw (leftOut: the others, and why)
    ipcMain.handle("icon-maker-list-instances", async (event, { itemId }) => {
        try {
            const item = findItem(itemId)
            const instances = []
            const leftOut = []
            for (const key of instanceKeys(item)) {
                const name = item.instances[key].Name.split(/[\\/]/).pop()
                const problem = instanceProblem(item, key)
                if (problem) leftOut.push({ instanceKey: key, name, problem })
                else instances.push({ instanceKey: key, name })
            }
            return { success: true, instances, leftOut }
        } catch (error) {
            return { success: false, error: error.message }
        }
    })

    // The instances whose model the icon maker has made (and still matches
    // their VMF), for the Model Chooser
    ipcMain.handle("icon-maker-list-models", async (event, { itemId }) => {
        try {
            const item = findItem(itemId)
            const models = usableInstanceKeys(item)
                .filter((key) => keptInstanceModel(item, key))
                .map((key) => ({
                    instanceKey: key,
                    name: item.instances[key].Name.split(/[\\/]/).pop(),
                }))
            return { success: true, models }
        } catch (error) {
            return { success: false, error: error.message }
        }
    })

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

    // Open the item's icon maker in its own window
    ipcMain.handle("open-icon-maker", async (event, { itemId }) => {
        try {
            createIconMakerWindow(findItem(itemId))
            return { success: true }
        } catch (error) {
            console.error(`Failed to open the icon maker for ${itemId}:`, error)
            return { success: false, error: error.message }
        }
    })

    // Hand a saved icon to the item's editor, which stages it
    ipcMain.handle(
        "icon-maker-send-to-editor",
        async (event, { itemId, filePath, fileName }) => {
            if (sendMadeIconToEditor(itemId, { filePath, fileName })) {
                return { success: true }
            }
            return { success: false, error: "The item's editor isn't open" }
        },
    )
}

module.exports = {
    register,
    iconFolder,
    instanceModel,
    keptInstanceModel,
    keepMadeModels,
    findItem,
}
