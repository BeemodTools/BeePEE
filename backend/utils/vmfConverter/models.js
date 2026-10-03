/**
 * Prop models: decompiles MDLs with Crowbar, parses the QC/SMD output and
 * poses the reference mesh with the sequence the entity would show in game.
 */

const fs = require("fs")
const path = require("path")
const { spawn } = require("child_process")
const {
    eulerMatrix,
    multiply,
    invertRigid,
    transformPoint,
    transformDirection,
    normalize,
    isNearIdentity,
    IDENTITY,
} = require("./math")
const { safeJoin } = require("./resources")

// Crowbar writes SMDs in studiomdl's input frame; the compiled model is rotated
// 90 degrees about Z from that (studiomdl's default rotation).
const CROWBAR_TO_MODEL = eulerMatrix(0, 0, Math.PI / 2)

const CROWBAR_TIMEOUT_MS = 120000

// ---------------------------------------------------------------------------
// QC
// ---------------------------------------------------------------------------

function tokenizeQc(text) {
    const tokens = []
    const length = text.length
    let line = 1
    let i = 0
    while (i < length) {
        const c = text[i]
        if (c === "\n") {
            line++
            i++
        } else if (c === " " || c === "\t" || c === "\r" || c === "﻿") {
            i++
        } else if (c === "/" && text[i + 1] === "/") {
            while (i < length && text[i] !== "\n") i++
        } else if (c === "/" && text[i + 1] === "*") {
            const end = text.indexOf("*/", i + 2)
            const stop = end === -1 ? length : end + 2
            for (let j = i; j < stop; j++) if (text[j] === "\n") line++
            i = stop
        } else if (c === "{" || c === "}") {
            tokens.push({ brace: c, line })
            i++
        } else if (c === '"') {
            const end = text.indexOf('"', i + 1)
            const stop = end === -1 ? length : end
            tokens.push({ value: text.slice(i + 1, stop), quoted: true, line })
            i = stop + 1
        } else {
            let j = i
            while (j < length && !/[\s{}"]/.test(text[j])) j++
            tokens.push({ value: text.slice(i, j), quoted: false, line })
            i = j
        }
    }
    return tokens
}

const isCommand = (token) =>
    token && !token.brace && !token.quoted && token.value.startsWith("$")

/** Split QC tokens into $commands with same-line arguments and an optional block */
function readQcCommands(tokens) {
    const commands = []
    let i = 0
    while (i < tokens.length) {
        const token = tokens[i++]
        if (!isCommand(token)) continue
        const command = {
            name: token.value.toLowerCase(),
            args: [],
            block: null,
        }
        while (
            i < tokens.length &&
            !tokens[i].brace &&
            tokens[i].line === token.line &&
            !isCommand(tokens[i])
        ) {
            command.args.push(tokens[i++].value)
        }
        if (i < tokens.length && tokens[i].brace === "{") {
            let depth = 0
            const start = i
            for (; i < tokens.length; i++) {
                if (tokens[i].brace === "{") depth++
                else if (tokens[i].brace === "}" && --depth === 0) break
            }
            command.block = tokens.slice(start + 1, i)
            i++
        }
        commands.push(command)
    }
    return commands
}

/** Top-level (depth 0) tokens of a block */
function topLevel(block) {
    const out = []
    let depth = 0
    for (const token of block || []) {
        if (token.brace === "{") depth++
        else if (token.brace === "}") depth--
        else if (depth === 0) out.push(token)
    }
    return out
}

const SEQUENCE_OPTIONS = new Set([
    "activity",
    "fps",
    "loop",
    "snap",
    "delta",
    "realtime",
    "hidden",
    "autoplay",
    "fadein",
    "fadeout",
    "blend",
    "blendwidth",
    "blendref",
    "blendcenter",
    "blendcomp",
    "calcblend",
    "node",
    "transition",
    "rtransition",
    "exitphase",
    "addlayer",
    "blendlayer",
    "iklock",
    "ikrule",
    "keyvalues",
    "event",
    "frame",
    "origin",
    "rotate",
    "scale",
    "posecycle",
    "weightlist",
    "worldspace",
    "subtract",
    "post",
    "predelta",
    "noanimation",
    "numframes",
    "walkframe",
    "ignorebonemerge",
    "cmdlist",
])

/**
 * Parse the parts of a (Crowbar-written) QC that the converter needs
 * @param {string} text
 */
function parseQc(text) {
    const qc = {
        modelName: null,
        bodies: [],
        cdmaterials: [],
        sequences: [],
        textureGroups: [],
        staticProp: false,
    }
    const animations = new Map()
    const sequences = []

    for (const command of readQcCommands(tokenizeQc(text))) {
        const { name, args, block } = command
        switch (name) {
            case "$modelname":
                if (args[0]) qc.modelName = args[0].replace(/\\/g, "/")
                break
            case "$cdmaterials":
                for (const arg of args) {
                    qc.cdmaterials.push(
                        arg
                            .replace(/\\/g, "/")
                            .replace(/^\/+|\/+$/g, "")
                            .trim(),
                    )
                }
                break
            case "$staticprop":
                qc.staticProp = true
                break
            case "$body":
            case "$model":
                if (args[1])
                    qc.bodies.push({ name: args[0], options: [args[1]] })
                break
            case "$bodygroup": {
                const options = []
                const items = topLevel(block)
                for (let i = 0; i < items.length; i++) {
                    const word = items[i].value.toLowerCase()
                    if (word === "studio" && items[i + 1]) {
                        options.push(items[++i].value)
                    } else if (word === "blank") {
                        options.push(null)
                    }
                }
                qc.bodies.push({ name: args[0], options })
                break
            }
            case "$texturegroup": {
                const rows = []
                let row = null
                let depth = 0
                for (const token of block || []) {
                    if (token.brace === "{") {
                        depth++
                        row = []
                    } else if (token.brace === "}") {
                        depth--
                        if (row) rows.push(row)
                        row = null
                    } else if (depth === 1 && row) {
                        row.push(token.value.toLowerCase())
                    }
                }
                if (rows.length) qc.textureGroups.push(rows)
                break
            }
            case "$animation":
            case "$sequence": {
                if (!args[0]) break
                const blockItems = topLevel(block)
                const words = [
                    ...args.slice(1),
                    ...blockItems.map((t) => t.value),
                ]
                const lowerWords = words.map((w) => w.toLowerCase())
                const source = words.find((word, i) => {
                    if (SEQUENCE_OPTIONS.has(lowerWords[i])) return false
                    // skip option values (e.g. "activity ACT_IDLE 1", "fps 30")
                    return !/^-?[\d.]+$/.test(word) && !/^act_/i.test(word)
                })
                const activityIndex = lowerWords.indexOf("activity")
                const entry = {
                    name: args[0],
                    source: source ?? null,
                    delta:
                        lowerWords.includes("delta") ||
                        lowerWords.includes("subtract"),
                    activity:
                        activityIndex !== -1 ? words[activityIndex + 1] : null,
                }
                if (name === "$animation")
                    animations.set(args[0].toLowerCase(), entry)
                else sequences.push(entry)
                break
            }
        }
    }

    for (const sequence of sequences) {
        let file = sequence.source
        let delta = sequence.delta
        const animation = file ? animations.get(file.toLowerCase()) : null
        if (animation) {
            file = animation.source
            delta = delta || animation.delta
        }
        if (file && !/\.(smd|dmx)$/i.test(file)) file += ".smd"
        qc.sequences.push({
            name: sequence.name,
            file: file ? file.replace(/\\/g, "/") : null,
            delta,
            activity: sequence.activity,
        })
    }
    return qc
}

/**
 * Find the sequence a prop shows: DefaultAnim by name (or activity), falling
 * back to the first sequence like the engine does.
 */
function resolveSequence(qc, requested) {
    if (requested) {
        const lower = requested.toLowerCase()
        const byName = qc.sequences.find((s) => s.name.toLowerCase() === lower)
        if (byName) return { sequence: byName, found: true }
        const byActivity = qc.sequences.find(
            (s) => s.activity && s.activity.toLowerCase() === lower,
        )
        if (byActivity) return { sequence: byActivity, found: true }
    }
    return { sequence: qc.sequences[0] ?? null, found: !requested }
}

// ---------------------------------------------------------------------------
// SMD
// ---------------------------------------------------------------------------

const IMAGE_EXTENSION = /\.(bmp|tga|vtf|png|jpe?g|psd|dds)$/i

/**
 * Parse an SMD file
 * @param {string} text
 * @param {{triangles?: boolean}} options - Skip triangle parsing for animations
 */
function parseSmd(text, { triangles = true } = {}) {
    const nodes = new Map()
    const frames = []
    const tris = []
    let section = null
    let frame = null
    let material = null
    let verts = []

    for (const rawLine of text.split("\n")) {
        const line = rawLine.trim()
        if (!line || line.startsWith("//")) continue
        if (section === null) {
            if (
                line === "nodes" ||
                line === "skeleton" ||
                line === "triangles"
            ) {
                section = line
            }
            continue
        }
        if (line === "end") {
            section = null
            continue
        }

        if (section === "nodes") {
            const m = line.match(/^(\d+)\s+"([^"]*)"\s+(-?\d+)/)
            if (m) nodes.set(Number(m[1]), { name: m[2], parent: Number(m[3]) })
        } else if (section === "skeleton") {
            if (line.startsWith("time")) {
                frame = new Map()
                frames.push(frame)
            } else if (frame) {
                const n = line.split(/\s+/).map(Number)
                if (n.length >= 7) frame.set(n[0], n.slice(1, 7))
            }
        } else if (section === "triangles" && triangles) {
            if (material === null) {
                material = line
                    .replace(/\\/g, "/")
                    .replace(IMAGE_EXTENSION, "")
                    .toLowerCase()
                verts = []
                continue
            }
            const n = line.split(/\s+/)
            if (n.length < 9) continue
            const links = []
            const count = n.length >= 10 ? Number(n[9]) : 0
            for (let k = 0; k < count && 11 + k * 2 < n.length; k++) {
                links.push([Number(n[10 + k * 2]), Number(n[11 + k * 2])])
            }
            verts.push({
                bone: Number(n[0]),
                pos: [Number(n[1]), Number(n[2]), Number(n[3])],
                normal: [Number(n[4]), Number(n[5]), Number(n[6])],
                uv: [n[7], n[8]],
                links,
            })
            if (verts.length === 3) {
                tris.push({ material, verts })
                material = null
            }
        }
    }
    return { nodes, frames, triangles: tris }
}

/**
 * World matrices per bone name for one frame. Bones missing from the frame
 * keep their value from earlier frames, then fall back to `defaults`.
 */
function worldMatricesByName(smd, frameIndex, defaults = new Map()) {
    const local = new Map()
    const lastFrame = Math.min(frameIndex, smd.frames.length - 1)
    for (let f = 0; f <= lastFrame; f++) {
        for (const [id, v] of smd.frames[f]) {
            local.set(id, eulerMatrix(v[3], v[4], v[5], v[0], v[1], v[2]))
        }
    }

    const world = new Map()
    const resolve = (id, depth = 0) => {
        if (world.has(id)) return world.get(id)
        const node = smd.nodes.get(id)
        if (!node) return IDENTITY
        const own = local.get(id) ?? defaults.get(node.name) ?? IDENTITY
        const parent =
            node.parent >= 0 && depth < 256
                ? resolve(node.parent, depth + 1)
                : null
        const matrix = parent ? multiply(parent, own) : own
        world.set(id, matrix)
        return matrix
    }

    const byName = new Map()
    for (const [id, node] of smd.nodes) byName.set(node.name, resolve(id))
    return byName
}

function localMatricesByName(smd) {
    const out = new Map()
    if (!smd.frames.length) return out
    for (const [id, v] of smd.frames[0]) {
        const node = smd.nodes.get(id)
        if (node)
            out.set(node.name, eulerMatrix(v[3], v[4], v[5], v[0], v[1], v[2]))
    }
    return out
}

// ---------------------------------------------------------------------------
// Crowbar
// ---------------------------------------------------------------------------

function runCrowbar(crowbarPath, mdlPath, workDir) {
    return new Promise((resolve, reject) => {
        // Run from the (writable) temp folder rather than the install folder
        const child = spawn(crowbarPath, ["-p", mdlPath], {
            cwd: workDir,
            windowsHide: true,
        })
        let output = ""
        child.stdout?.on("data", (d) => (output += d.toString()))
        child.stderr?.on("data", (d) => (output += d.toString()))
        const timer = setTimeout(() => {
            child.kill()
            reject(
                new Error(
                    `Crowbar timed out decompiling ${path.basename(mdlPath)}`,
                ),
            )
        }, CROWBAR_TIMEOUT_MS)
        child.on("error", (error) => {
            clearTimeout(timer)
            reject(error)
        })
        child.on("close", () => {
            clearTimeout(timer)
            resolve(output)
        })
    })
}

async function findQc(modelDir, baseName) {
    // Crowbar writes next to the MDL, or into a per-model folder when its
    // "DecompileFolderForEachModelIsChecked" setting is on
    const candidates = [
        path.join(modelDir, `${baseName}.qc`),
        path.join(modelDir, baseName, `${baseName}.qc`),
    ]
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate
    }
    for (const dir of [modelDir, path.join(modelDir, baseName)]) {
        const qcs = (await fs.promises.readdir(dir).catch(() => [])).filter(
            (f) => f.toLowerCase().endsWith(".qc"),
        )
        if (qcs.length === 1) return path.join(dir, qcs[0])
    }
    return null
}

/**
 * Extract a model's files from the resources and decompile it
 * @returns {Promise<{qc: Object, qcDir: string, references: Array}>}
 */
async function loadModel({ resources, tempDir, crowbarPath }, modelPath) {
    if (!resources.has(modelPath)) {
        throw new Error(`Model not found in resources: ${modelPath}`)
    }
    if (!crowbarPath || !fs.existsSync(crowbarPath)) {
        throw new Error("Crowbar (CrowbarCommandLineDecomp.exe) not found")
    }

    const base = modelPath.replace(/\.mdl$/i, "")
    const files = resources
        .listWithPrefix(`${base}.`)
        .filter((file) => !/\.(vmt|vtf)$/.test(file))
    for (const file of files) {
        const target = safeJoin(tempDir, file)
        await fs.promises.mkdir(path.dirname(target), { recursive: true })
        await fs.promises.writeFile(target, await resources.read(file))
    }

    const mdlFile = safeJoin(tempDir, modelPath)
    const output = await runCrowbar(crowbarPath, mdlFile, tempDir)
    const qcPath = await findQc(path.dirname(mdlFile), path.basename(base))
    if (!qcPath) {
        const detail = output.trim().split(/\r?\n/).slice(-3).join(" ")
        throw new Error(
            `Crowbar produced no QC file for ${modelPath}. ${detail}`.trim(),
        )
    }

    const qc = parseQc(await fs.promises.readFile(qcPath, "utf8"))
    const qcDir = path.dirname(qcPath)
    const references = []
    const missing = []
    for (const body of qc.bodies) {
        // Default body: the first option of every body group
        const file = body.options[0]
        if (!file) continue
        const smdPath = path.join(qcDir, file)
        try {
            references.push(
                parseSmd(await fs.promises.readFile(smdPath, "utf8")),
            )
        } catch {
            missing.push(file)
        }
    }
    if (references.length === 0) {
        throw new Error(`No reference SMD found for ${modelPath}`)
    }
    return { qc, qcDir, references, missing }
}

/**
 * Model-space triangles for a model, optionally posed with a sequence
 * @param {Object} model - Result of loadModel
 * @param {{pose: boolean, sequence?: string, lastFrame?: boolean, readAnimation: (file: string) => Promise<Object>}} options
 * @returns {Promise<{triangles: Array, warning: string|null}>}
 */
async function buildModelGeometry(model, options) {
    let warning = null
    let animation = null
    let frameIndex = 0

    if (options.pose && !model.qc.staticProp && model.qc.sequences.length) {
        const { sequence, found } = resolveSequence(model.qc, options.sequence)
        if (!found) {
            warning = `DefaultAnim "${options.sequence}" not found, using "${sequence?.name}"`
        }
        if (sequence?.file && !sequence.delta) {
            try {
                animation = await options.readAnimation(
                    path.join(model.qcDir, sequence.file),
                )
                if (animation.frames.length === 0) animation = null
                else if (options.lastFrame)
                    frameIndex = animation.frames.length - 1
            } catch {
                warning = `Could not read animation ${sequence.file}`
            }
        }
    }

    const triangles = []
    for (const reference of model.references) {
        let skinByBone = null
        if (animation) {
            const bindLocal = localMatricesByName(reference)
            const bind = worldMatricesByName(reference, 0)
            const posed = worldMatricesByName(animation, frameIndex, bindLocal)
            skinByBone = new Map()
            let changed = false
            for (const [id, node] of reference.nodes) {
                const bindWorld = bind.get(node.name)
                const poseWorld = posed.get(node.name)
                const skin =
                    bindWorld && poseWorld
                        ? multiply(poseWorld, invertRigid(bindWorld))
                        : IDENTITY
                if (!isNearIdentity(skin)) changed = true
                skinByBone.set(id, skin)
            }
            if (!changed) skinByBone = null
        }

        for (const tri of reference.triangles) {
            const verts = tri.verts.map((v) => {
                let pos = v.pos
                let normal = v.normal
                if (skinByBone) {
                    const links = v.links.length ? v.links : [[v.bone, 1]]
                    let total = 0
                    for (const [, weight] of links) total += weight
                    const weighted = total > 0 ? links : [[v.bone, 1]]
                    const sum = total > 0 ? total : 1
                    const p = [0, 0, 0]
                    const n = [0, 0, 0]
                    for (const [bone, weight] of weighted) {
                        const skin = skinByBone.get(bone) ?? IDENTITY
                        const w = weight / sum
                        const tp = transformPoint(skin, v.pos)
                        const tn = transformDirection(skin, v.normal)
                        for (let i = 0; i < 3; i++) {
                            p[i] += tp[i] * w
                            n[i] += tn[i] * w
                        }
                    }
                    pos = p
                    normal = n
                }
                return {
                    pos: transformPoint(CROWBAR_TO_MODEL, pos),
                    normal: normalize(
                        transformDirection(CROWBAR_TO_MODEL, normal),
                    ),
                    uv: v.uv,
                }
            })
            triangles.push({ material: tri.material, verts })
        }
    }
    return { triangles, warning }
}

/**
 * Map material names for a skin family using the QC $texturegroup
 * @returns {(material: string) => string}
 */
function skinMapper(qc, skin) {
    const group = qc.textureGroups[0]
    if (!group || !skin || skin <= 0 || skin >= group.length) return (m) => m
    const base = group[0]
    const replacement = group[skin]
    const map = new Map()
    base.forEach((name, i) => {
        if (replacement[i])
            map.set(
                name.replace(IMAGE_EXTENSION, ""),
                replacement[i].replace(IMAGE_EXTENSION, ""),
            )
    })
    return (material) => map.get(material) ?? material
}

module.exports = {
    CROWBAR_TO_MODEL,
    parseQc,
    parseSmd,
    resolveSequence,
    loadModel,
    buildModelGeometry,
    skinMapper,
}
