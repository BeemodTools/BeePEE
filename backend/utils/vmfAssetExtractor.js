const fs = require("fs")
const path = require("path")
const { parseKeyValues } = require("./vmfConverter/keyvalues")

/** Leading characters that set how a sound plays: ")ambient/x.wav" */
const SOUND_CHARS = /^[*#@><^)}$!?&~]+/

const SOUND_FILE = /\.(wav|mp3|ogg)$/i

/** Keys that name a sound: a sound file or a soundscript entry */
const SOUND_KEYS = new Set([
    "noise1",
    "noise2",
    "startsound",
    "stopsound",
    "movesound",
    "startclosesound",
    "closesound",
    "soundopenoverride",
    "soundcloseoverride",
    "soundmoveoverride",
    "soundlockedoverride",
    "soundunlockedoverride",
    "sound",
    "soundfile",
    "soundname",
])

/** Entities whose "message" is a sound (for others it's text) */
const SOUND_MESSAGE_CLASSES = new Set(["ambient_generic", "func_rotating"])

/** Keys that name a material: overlays, decals, beams, ropes, ... */
const MATERIAL_KEYS = new Set([
    "material",
    "texture",
    "texturename",
    "ropematerial",
    "spritename",
    "smokematerial",
    "overlaymaterial",
    "dustmaterial",
])

/** Materials every game has, never packed */
const SKIPPED_MATERIALS = ["tools/", "dev/", "skybox/"]

/** A keyvalue's value, or null when empty or an instance variable ("$skin") */
function cleanValue(value) {
    const text = String(value ?? "").trim()
    return text && !text.startsWith("$") ? text : null
}

const slashes = (value) => value.replace(/\\/g, "/").toLowerCase()

/**
 * Whether an entity's "model" keyvalue is the model it has in game. Weighted
 * cubes and floor turrets pick theirs by their type: their "model" is only
 * shown in Hammer, unless they have a custom model (a cube's type 6 or
 * HammerAddons custom model type, a turret's model index 1).
 * @param {string} classname - Lowercase
 * @param {Object<string, string>} keyvalues - By lowercase key
 */
function usesModelKeyvalue(classname, keyvalues) {
    if (classname === "prop_weighted_cube") {
        return (
            keyvalues.cubetype === "6" ||
            Number.parseInt(keyvalues.comp_custom_model_type ?? "0", 10) > 0
        )
    }
    if (classname === "npc_portal_turret_floor") {
        return keyvalues.modelindex === "1"
    }
    return true
}

/**
 * Extract the assets a VMF uses: the models, materials, sounds and scripts its
 * entities and brushes name
 * @param {string} vmfPath - Path to the VMF file
 * @returns {{MODEL: string[], MATERIAL: string[], SOUND: string[], SOUNDSCRIPT: string[], SCRIPT: string[]}}
 *   MODEL: model paths ("models/props/x.mdl"). MATERIAL: material paths
 *   under materials/, without extension ("metal/black_wall_metal_002c").
 *   SOUND: sound files under sound/ ("ambient/hum.wav"). SOUNDSCRIPT: names
 *   of soundscript entries ("portal.button_down"). SCRIPT: script files
 *   under scripts/ ("vscripts/bee2/foo.nut").
 */
function extractAssetsFromVMF(vmfPath) {
    if (!fs.existsSync(vmfPath)) {
        throw new Error("VMF file not found")
    }

    try {
        const nodes = parseKeyValues(fs.readFileSync(vmfPath, "utf-8"))
        const found = {
            MODEL: new Set(),
            MATERIAL: new Set(),
            SOUND: new Set(),
            SOUNDSCRIPT: new Set(),
            SCRIPT: new Set(),
        }

        const addMaterial = (value) => {
            const material = slashes(value)
                .replace(/^materials\//, "")
                .replace(/\.(vmt|spr)$/, "")
            // func_breakable's "material" is a number: glass, wood, metal, ...
            if (/^\d+$/.test(material)) return
            if (
                !SKIPPED_MATERIALS.some((prefix) => material.startsWith(prefix))
            ) {
                found.MATERIAL.add(material)
            }
        }
        const addModel = (value) => {
            const model = slashes(value)
            // Brush entity models ("*3") are in the map itself, and sprites
            // (env_sprite, env_glow) are materials
            if (model.startsWith("*")) return
            if (/\.(vmt|spr)$/.test(model)) addMaterial(model)
            else found.MODEL.add(model)
        }
        const addSound = (value) => {
            const file = slashes(value).replace(SOUND_CHARS, "")
            if (SOUND_FILE.test(file)) {
                found.SOUND.add(file.replace(/^sound\//, ""))
            } else if (!/^\d+$/.test(file)) {
                // Not a number (some sound keys are a choice of sounds)
                found.SOUNDSCRIPT.add(file)
            }
        }
        // VScripts are named from scripts/vscripts/, ".nut" optional
        const addVScript = (value) => {
            let script = slashes(value)
                .replace(/^\/+/, "")
                .replace(/^scripts\/vscripts\//, "")
            if (!path.posix.extname(script)) script += ".nut"
            found.SCRIPT.add(`vscripts/${script}`)
        }

        const addEntity = (block) => {
            const leaves = block.children.filter(
                (c) => c.children === undefined,
            )
            const classname = slashes(
                leaves.find((c) => c.key.toLowerCase() === "classname")
                    ?.value ?? "",
            )
            const keyvalues = Object.fromEntries(
                leaves.map(({ key, value }) => [
                    key.toLowerCase(),
                    String(value ?? "").trim(),
                ]),
            )
            for (const { key, value } of leaves) {
                const name = key.toLowerCase()
                const text = cleanValue(value)
                if (!text) continue
                if (name === "model") {
                    if (usesModelKeyvalue(classname, keyvalues)) addModel(text)
                } else if (
                    MATERIAL_KEYS.has(name) ||
                    /^overlayname\d+$/.test(name)
                ) {
                    // env_screenoverlay: overlayname1, overlayname2, ...
                    addMaterial(text)
                } else if (name === "vscripts") {
                    for (const script of text.split(/\s+/)) addVScript(script)
                } else if (name === "scriptfile") {
                    found.SCRIPT.add(slashes(text).replace(/^scripts\//, ""))
                } else if (
                    SOUND_KEYS.has(name) ||
                    (name === "message" &&
                        SOUND_MESSAGE_CLASSES.has(classname)) ||
                    SOUND_FILE.test(text)
                ) {
                    addSound(text)
                }
            }

            // Scripts run by outputs: "target<ESC>RunScriptFile<ESC>file.nut..."
            const connections = block.children.find(
                (c) => c.children && c.key.toLowerCase() === "connections",
            )
            for (const output of connections?.children ?? []) {
                if (output.children !== undefined) continue
                const parts = output.value.split(
                    output.value.includes("\x1b") ? "\x1b" : ",",
                )
                const param = cleanValue(parts[2])
                if (
                    parts[1]?.trim().toLowerCase() === "runscriptfile" &&
                    param
                ) {
                    addVScript(param)
                }
            }
        }

        const walk = (blocks) => {
            for (const block of blocks) {
                if (!block.children) continue
                const kind = block.key.toLowerCase()
                if (kind === "side") {
                    // Brush faces
                    const material = block.children.find(
                        (c) =>
                            c.children === undefined &&
                            c.key.toLowerCase() === "material",
                    )
                    const value = cleanValue(material?.value)
                    if (value) addMaterial(value)
                } else if (kind === "entity" || kind === "world") {
                    addEntity(block)
                }
                walk(block.children)
            }
        }
        walk(nodes)

        return Object.fromEntries(
            Object.entries(found).map(([type, values]) => [
                type,
                [...values].sort(),
            ]),
        )
    } catch (error) {
        console.error(`Failed to extract the assets of ${vmfPath}:`, error)
        throw error
    }
}

module.exports = { extractAssetsFromVMF }
