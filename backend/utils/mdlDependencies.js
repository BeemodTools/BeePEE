/**
 * Material dependencies of Source models, worked out like srctools'
 * PackList does it (this replaces the Python find_mdl_deps.exe):
 *  - the model's textures, as the first VMT found in its $cdmaterials
 *    folders (plus the textures' own folders and the root), for the skin
 *    table columns its meshes use
 *  - for each VMT: its "patch" parents, and every parameter srctools types
 *    as a texture (listed even when the file is missing) or a material
 *  - the same for models it includes ($includemodel) and its gibs ("break"
 *    models in the .phy)
 * Files are looked up like the game does: the search paths in
 * gameinfo.txt, plus the DLC, update and platform folders, VPKs first.
 */

const fs = require("fs")
const path = require("path")
const { parseKeyValues } = require("./vmfConverter/keyvalues")
const { buildResourceIndex } = require("./vmfConverter/resources")

/** Material parameters srctools types as textures (from its shader database) */
const TEXTURE_PARAMS = new Set([
    "%tooltexture",
    "albedo",
    "alphamasktexture",
    "ambientoccltexture",
    "anisodirtexture",
    "ao",
    "aomap",
    "aoscreenbuffer",
    "aotexture",
    "backingtexture",
    "basetexture",
    "basetexture2",
    "basetexture3",
    "basetexture4",
    "blendmodulatetexture",
    "bloomtexture",
    "blurredtexture",
    "blurtexture",
    "brdf_integration",
    "bumpcompress",
    "bumpmap",
    "bumpmap2",
    "bumpmap3",
    "bumpmap4",
    "bumpmapdetail",
    "bumpmask",
    "bumpstretch",
    "canvas",
    "cbtexture",
    "cloudalphatexture",
    "colorbar",
    "colorizer",
    "colorwarptexture",
    "compress",
    "cookietexture",
    "corecolortexture",
    "corneatexture",
    "crtexture",
    "decaltexture",
    "delta",
    "depthtexture",
    "detail",
    "detail1",
    "detail2",
    "detailnormal",
    "displacementmap",
    "distortmap",
    "dudvmap",
    "dust_texture",
    "effectmaskstexture",
    "emissiontexture",
    "emissiontexture2",
    "emissiontexture3",
    "emissiontexture4",
    "emissiveblendbasetexture",
    "emissiveblendflowtexture",
    "emissiveblendtexture",
    "envmap",
    "envmapmask",
    "envmapmask2",
    "exposure_texture",
    "exptexture",
    "fb_texture",
    "fbtexture",
    "fleshbordertexture1d",
    "fleshcubetexture",
    "fleshinteriornoisetexture",
    "fleshinteriortexture",
    "fleshnormaltexture",
    "fleshsubsurfacetexture",
    "flow_noise_texture",
    "flowbounds",
    "flowmap",
    "fow",
    "frame_texture",
    "frametexture",
    "fresnelcolorwarptexture",
    "fresnelrangestexture",
    "fresnelwarptexture",
    "frontndtexture",
    "glassenvmap",
    "glint",
    "gradienttexture",
    "grain",
    "grain_texture",
    "grime",
    "grunge",
    "grungetexture",
    "hdrbasetexture",
    "hdrcompressedtexture",
    "hdrcompressedtexture0",
    "hdrcompressedtexture1",
    "hdrcompressedtexture2",
    "holomask",
    "holospectrum",
    "input",
    "input_texture",
    "internal_vignettetexture",
    "iridescentwarp",
    "iris",
    "lightmap",
    "lightwarptexture",
    "logomap",
    "maps1",
    "maps2",
    "maps3",
    "maskmap",
    "masks1",
    "masks2",
    "maskstexture",
    "materialmask",
    "mraotexture",
    "mraotexture2",
    "mraotexture3",
    "mraotexture4",
    "noise",
    "noisemap",
    "noisetexture",
    "normalmap",
    "normalmap2",
    "normalmap3",
    "normalmap4",
    "normaltexture",
    "offsetmap",
    "opacitytexture",
    "originaltexture",
    "overlaytexture",
    "paintenvmap",
    "paintsplatbubble",
    "paintsplatbubblelayout",
    "paintsplatenvmap",
    "paintsplatnormalmap",
    "painttexture",
    "pattern",
    "pattern1",
    "pattern2",
    "phongexponenttexture",
    "phongwarptexture",
    "portalcolortexture",
    "portalmasktexture",
    "postexture",
    "ramptexture",
    "reflecttexture",
    "refracttexture",
    "refracttinttexture",
    "rmamap",
    "rmamap2",
    "rmamap3",
    "rmamap4",
    "sampleoffsettexture",
    "scenedepth",
    "screeneffecttexture",
    "selfillummap",
    "selfillummask",
    "selfillumtexture",
    "shadowdepthtexture",
    "sheenmap",
    "sheenmapmask",
    "sidespeed",
    "simpleoverlay",
    "smallfb",
    "sourcemrtrendertarget",
    "specmasktexture",
    "spectexture",
    "spectexture2",
    "spectexture3",
    "spectexture4",
    "spherenormal",
    "srctexture0",
    "srctexture1",
    "srctexture2",
    "srctexture3",
    "staticblendtexture",
    "stitchtexture",
    "stretch",
    "stripetexture",
    "surfacetexture",
    "test_texture",
    "texture0",
    "texture1",
    "texture2",
    "texture3",
    "texture4",
    "tintmask",
    "tintmasktexture",
    "transmatmaskstexture",
    "underwateroverlay",
    "velocity_texture",
    "vignette_texture",
    "vignette_tile",
    "warptexture",
    "weartexture",
    "wfxbumpmap",
    "wfxdiffuse",
    "wfxrma",
    "ytexture",
])

/** Material parameters srctools types as materials */
const MATERIAL_PARAMS = new Set([
    "bottommaterial",
    "crackmaterial",
    "translucent_material",
])

/** Files that come with a model */
const MODEL_FILE_EXTENSIONS = [
    ".phy",
    ".vvd",
    ".ani",
    ".dx90.vtx",
    ".dx80.vtx",
    ".sw.vtx",
    ".vtx",
]

/** How long a built file index is reused after its last use */
const INDEX_TTL_MS = 60 * 1000

/**
 * A path in srctools' form: forward slashes, lowercase, no "." segments or
 * leading slash. Returns null for paths escaping the root.
 */
function unifyPath(value) {
    const parts = []
    for (const part of String(value).replace(/\\/g, "/").split("/")) {
        if (part === "" || part === ".") continue
        if (part === "..") {
            if (!parts.length) return null
            parts.pop()
        } else {
            parts.push(part)
        }
    }
    return parts.join("/").toLowerCase()
}

/** Strip a file extension, unless the dot is in a folder name */
function stripExtension(file) {
    const dot = file.lastIndexOf(".")
    return dot === -1 || file.includes("/", dot) ? file : file.slice(0, dot)
}

const texturePath = (value) => {
    let file = unifyPath(value)
    if (!file) return null
    if (!file.startsWith("materials/")) file = `materials/${file}`
    return file.endsWith(".hdr") ? `${file}.vtf` : `${stripExtension(file)}.vtf`
}

const materialPath = (value) => {
    let file = unifyPath(value)
    if (!file) return null
    if (file.endsWith(".spr")) file = `sprites/${file.slice(0, -4)}.vmt`
    if (!file.startsWith("materials/")) file = `materials/${file}`
    return file.endsWith(".vmt") ? file : `${stripExtension(file)}.vmt`
}

const modelPath = (value) => {
    let file = unifyPath(value)
    if (!file) return null
    if (!file.startsWith("models/")) file = `models/${file}`
    return file.endsWith(".mdl") ? file : `${stripExtension(file)}.mdl`
}

/**
 * The folders and VPKs the game reads, in srctools' order (VPKs first)
 * @param {string} portal2Root - Portal 2's install folder
 * @returns {string[]}
 */
function gameSearchPaths(portal2Root) {
    const gameDir = path.join(portal2Root, "portal2")
    const searchPaths = []
    try {
        const gameinfo = parseKeyValues(
            fs.readFileSync(path.join(gameDir, "gameinfo.txt"), "utf8"),
        )
        const find = (nodes, key) =>
            nodes.find(
                (node) => node.key.toLowerCase() === key && node.children,
            )
        const info = find(gameinfo, "gameinfo")
        const fileSystem = info && find(info.children, "filesystem")
        const entries = fileSystem && find(fileSystem.children, "searchpaths")
        for (const entry of entries?.children ?? []) {
            if (entry.children !== undefined) continue
            let value = entry.value.trim()
            let base = portal2Root
            for (const token of [
                "|gameinfo_path|",
                "|all_source_engine_paths|",
            ]) {
                if (value.toLowerCase().startsWith(token)) {
                    base = token === "|gameinfo_path|" ? gameDir : portal2Root
                    value = value.slice(token.length)
                }
            }
            const full = path.resolve(base, value || ".")
            if (path.basename(full).endsWith("*")) {
                // "folder/*" or "folder_*": every match
                const prefix = path.basename(full).slice(0, -1)
                const parent = path.dirname(full)
                let names = []
                try {
                    names = fs.readdirSync(parent)
                } catch {}
                for (const name of names) {
                    if (!name.toLowerCase().startsWith(prefix.toLowerCase()))
                        continue
                    const match = path.join(parent, name)
                    const isVpk =
                        /\.vpk$/i.test(name) && !/\d{3}\.vpk$/i.test(name)
                    if (isVpk || fs.statSync(match).isDirectory())
                        searchPaths.push(match)
                }
            } else {
                searchPaths.push(full)
            }
        }
    } catch {
        searchPaths.push(gameDir)
    }

    // DLC folders (named after the first search path), platform and update
    if (searchPaths.length) {
        const first = searchPaths[0]
        for (let i = 1; fs.existsSync(`${first}_dlc${i}`); i++) {
            searchPaths.unshift(`${first}_dlc${i}`)
        }
        searchPaths.push(path.join(portal2Root, "platform"))
        const update = path.join(path.dirname(first), "update")
        if (fs.existsSync(update)) searchPaths.unshift(update)
    }

    const vpks = []
    const folders = []
    for (const searchPath of searchPaths) {
        let stat = null
        try {
            stat = fs.statSync(searchPath)
        } catch {}
        if (stat?.isDirectory()) {
            folders.push(searchPath)
            for (let i = 1; ; i++) {
                const vpk = path.join(
                    searchPath,
                    `pak${String(i).padStart(2, "0")}_dir.vpk`,
                )
                if (!fs.existsSync(vpk)) break
                vpks.push(vpk)
            }
        } else if (/\.vpk$/i.test(searchPath)) {
            if (stat?.isFile()) vpks.push(searchPath)
            const dirVpk = searchPath.replace(/(?<!_dir)\.vpk$/i, "_dir.vpk")
            if (dirVpk !== searchPath && fs.existsSync(dirVpk))
                vpks.push(dirVpk)
        }
    }
    return [...vpks, ...folders]
}

const indexes = new Map()

/**
 * The file index for a set of search paths, built once and reused for a while
 * @param {string[]} searchPaths
 * @param {string[]} [folders] - The subfolders of loose folders to index
 *   (VPKs are indexed whole)
 */
function getIndex(searchPaths, folders = ["materials", "models"]) {
    const key = `${searchPaths.join("|")}|${folders.join(",")}`.toLowerCase()
    let entry = indexes.get(key)
    if (!entry || Date.now() - entry.used > INDEX_TTL_MS) {
        entry = { index: buildResourceIndex(searchPaths, undefined, folders) }
        indexes.set(key, entry)
    }
    entry.used = Date.now()
    return entry.index
}

/**
 * The game's file index: its VPKs, then its folders (see gameSearchPaths)
 * and `extraPaths`, with loose sound, script and particle files too
 * @param {string} portal2Root
 * @param {string[]} [extraPaths] - Searched after the game's own
 * @returns {Promise<import("./vmfConverter/resources").ResourceIndex>}
 */
function gameIndex(portal2Root, extraPaths = []) {
    return getIndex(
        [...gameSearchPaths(portal2Root), ...extraPaths],
        ["materials", "models", "sound", "scripts", "particles"],
    )
}

const readInt = (buffer, offset) =>
    offset >= 0 && offset + 4 <= buffer.length ? buffer.readInt32LE(offset) : 0

function readString(buffer, offset) {
    if (offset <= 0 || offset >= buffer.length) return ""
    let end = offset
    while (end < buffer.length && buffer[end] !== 0) end++
    return buffer.toString("latin1", offset, end)
}

/**
 * The parts of an MDL file that lead to other files: materials folders,
 * the textures its meshes use (any skin) and included models
 */
function readMdl(buffer) {
    if (buffer.length < 344 || buffer.toString("latin1", 0, 4) !== "IDST") {
        throw new Error("Not an MDL file")
    }
    const int = (offset) => readInt(buffer, offset)

    const cdmaterials = []
    for (let i = 0; i < int(212); i++) {
        let folder = readString(buffer, int(int(216) + i * 4))
            .replace(/\\/g, "/")
            .replace(/^\/+/, "")
        if (folder && !folder.endsWith("/")) folder += "/"
        cdmaterials.push(folder)
    }

    const textures = []
    for (let i = 0; i < int(204); i++) {
        const struct = int(208) + i * 64
        textures.push(readString(buffer, struct + int(struct)))
    }

    // Skin table columns used by any mesh (studiomdl adds unused ones)
    const used = new Set()
    for (let b = 0; b < int(232); b++) {
        const bodyPart = int(236) + b * 16
        for (let m = 0; m < int(bodyPart + 4); m++) {
            const model = bodyPart + int(bodyPart + 12) + m * 148
            for (let s = 0; s < int(model + 72); s++) {
                used.add(int(model + int(model + 76) + s * 116))
            }
        }
    }
    const columns = int(220)
    const names = new Set()
    for (let family = 0; family < int(224); family++) {
        for (const column of used) {
            if (column < 0 || column >= columns) continue
            const offset = int(228) + (family * columns + column) * 2
            if (offset + 2 > buffer.length) continue
            const name = textures[buffer.readUInt16LE(offset)]
            if (name !== undefined) {
                names.add(name.replace(/\\/g, "/").replace(/^\/+/, ""))
            }
        }
    }

    // Textures' own folders and the root are searched too
    for (const name of textures) {
        const texture = name.replace(/\\/g, "/")
        if (texture.includes("/")) {
            const folder = texture.slice(0, texture.lastIndexOf("/"))
            if (!cdmaterials.includes(folder)) cdmaterials.push(folder)
        }
    }
    if (!cdmaterials.includes("")) cdmaterials.push("")

    const includes = []
    for (let i = 0; i < int(336); i++) {
        const struct = int(340) + i * 8
        const name = int(struct + 4)
        if (name) includes.push(readString(buffer, struct + name))
    }
    return { cdmaterials, textures: [...names], includes }
}

/** Gib models listed in "break" blocks of a .phy file's keyvalues */
function readPhyBreakModels(buffer) {
    let offset = readInt(buffer, 0)
    const solids = readInt(buffer, 8)
    for (let i = 0; i < solids && offset + 4 <= buffer.length; i++) {
        offset += 4 + readInt(buffer, offset)
    }
    const text = readString(buffer, offset)
    const models = []
    try {
        for (const node of parseKeyValues(text)) {
            if (node.key.toLowerCase() !== "break" || !node.children) continue
            for (const child of node.children) {
                if (child.key.toLowerCase() === "model" && child.value) {
                    models.push(child.value)
                }
            }
        }
    } catch {}
    return models
}

/** A VMT's parameters (patch materials merged into their includes) */
async function materialParams(index, file, parents, depth = 0) {
    const data = await index.read(file)
    if (!data) return null
    const shader = parseKeyValues(data.toString("utf8")).find(
        (node) => node.children,
    )
    if (!shader) return null
    const leaves = (nodes) =>
        nodes
            .filter((node) => node.children === undefined)
            .map((node) => [node.key.toLowerCase(), node.value])

    if (shader.key.toLowerCase() !== "patch") {
        return new Map(leaves(shader.children))
    }
    const include = leaves(shader.children).find(([key]) => key === "include")
    let params = new Map()
    if (include && depth < 8) {
        const parent = materialPath(include[1])
        if (parent) {
            parents.push(parent)
            params =
                (await materialParams(index, parent, parents, depth + 1)) ??
                params
        }
    }
    for (const block of shader.children.filter((node) => node.children)) {
        const kind = block.key.toLowerCase()
        if (kind !== "insert" && kind !== "replace") continue
        for (const [key, value] of leaves(block.children)) {
            if (kind === "insert" || params.has(key)) params.set(key, value)
        }
    }
    return params
}

/**
 * Collects what models and materials need, with srctools' rules: a model's
 * files, materials, included models and gibs; a material's textures and the
 * materials it includes or names
 * @param {Object} index - A file index (see getIndex)
 */
function dependencyCollector(index, { missingModelMaterials = false } = {}) {
    const materials = new Set()
    const models = new Set()
    const visitedMaterials = new Set()
    // Which file needs each file (the first one found)
    const requiredBy = new Map()
    const noteNeed = (file, by) => {
        if (file && by && !requiredBy.has(file)) requiredBy.set(file, by)
    }

    const addMaterial = async (file, by) => {
        if (!file || visitedMaterials.has(file)) return
        visitedMaterials.add(file)
        materials.add(file)
        noteNeed(file, by)
        const parents = []
        const params = await materialParams(index, file, parents)
        for (const parent of parents) await addMaterial(parent, file)
        for (const [rawKey, rawValue] of params ?? []) {
            // Conditional parameters ("gpu>=2?$basetexture") count too
            const key = rawKey.slice(rawKey.indexOf("?") + 1).replace(/^\$/, "")
            const value = String(rawValue).toLowerCase()
            if (TEXTURE_PARAMS.has(key)) {
                if (value === "env_cubemap" || value.startsWith("_rt_"))
                    continue
                const texture = texturePath(value)
                if (texture) {
                    materials.add(texture)
                    noteNeed(texture, file)
                }
            } else if (MATERIAL_PARAMS.has(key)) {
                await addMaterial(materialPath(value), file)
            }
        }
    }

    const addModel = async (file, by) => {
        if (!file || models.has(file)) return
        models.add(file)
        noteNeed(file, by)
        const data = await index.read(file)
        if (!data) return
        const stem = file.slice(0, -".mdl".length)
        for (const extension of MODEL_FILE_EXTENSIONS) {
            if (index.has(stem + extension)) {
                models.add(stem + extension)
                noteNeed(stem + extension, file)
            }
        }
        const mdl = readMdl(data)
        for (const name of mdl.textures) {
            const candidates = mdl.cdmaterials
                .map((folder) => materialPath(`${folder}${name}`))
                .filter(Boolean)
            const vmt = candidates.find((candidate) => index.has(candidate))
            if (vmt) {
                await addMaterial(vmt, file)
            } else if (missingModelMaterials && candidates.length) {
                // Not anywhere: listed (as in its first folder) so it can
                // be reported missing
                await addMaterial(candidates[0], file)
            }
        }
        for (const include of mdl.includes) {
            await addModel(modelPath(include), file)
        }
        const phy = await index.read(file.replace(/\.mdl$/, ".phy"))
        if (phy) {
            for (const gib of readPhyBreakModels(phy)) {
                await addModel(modelPath(gib), file)
            }
        }
    }

    return { materials, models, requiredBy, addMaterial, addModel }
}

/**
 * Find the files a model needs
 * @param {string} mdlPath - Model path, like "models/props/cube.mdl" (folder and extension optional)
 * @param {{portal2Root: string, searchPaths?: string[]}} options - Extra
 *   search paths (folders or VPKs) are searched after the game's own
 * @returns {Promise<{success: boolean, mdlPath: string, materials?: string[], models?: string[], error?: string}>}
 *   Like find_mdl_deps.exe: materials and models with their extensions, sorted
 */
async function findMdlDependencies(mdlPath, options) {
    const start = modelPath(mdlPath) ?? String(mdlPath)
    try {
        const index = await getIndex([
            ...gameSearchPaths(options.portal2Root),
            ...(options.searchPaths ?? []),
        ])
        const { materials, models, addModel } = dependencyCollector(index)
        // A model that isn't found is listed without dependencies, as in srctools
        await addModel(start)
        return {
            success: true,
            mdlPath: start,
            materials: [...materials].sort(),
            models: [...models].sort(),
        }
    } catch (error) {
        return { success: false, mdlPath: start, error: error.message }
    }
}

/**
 * Find every file models and materials need (themselves included)
 * @param {Object} index - The game's file index (see gameIndex)
 * @param {{models?: string[], materials?: string[]}} start - Model and
 *   material paths ("models/" or "materials/" and the extension optional)
 * @returns {Promise<{files: string[], requiredBy: Map<string, string>}>}
 *   Content paths with extensions, sorted, and which file needs each (for
 *   those another file needs). Model materials that aren't anywhere are
 *   listed too, as in the model's first materials folder.
 */
async function findDependencies(index, { models = [], materials = [] }) {
    const collector = dependencyCollector(index, {
        missingModelMaterials: true,
    })
    for (const model of models) {
        try {
            await collector.addModel(modelPath(model))
        } catch (error) {
            // Its own files are listed, not what's in it
            console.warn(`Could not read ${model}: ${error.message}`)
        }
    }
    for (const material of materials) {
        await collector.addMaterial(materialPath(material))
    }
    return {
        files: [...collector.models, ...collector.materials].sort(),
        requiredBy: collector.requiredBy,
    }
}

module.exports = {
    findMdlDependencies,
    findDependencies,
    gameIndex,
    gameSearchPaths,
    readMdl,
}
