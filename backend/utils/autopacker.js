/**
 * Autopacking: when an instance is added to an item, the files it uses that
 * aren't part of the game are copied into the package.
 *
 * What the instance needs: the models, materials, sounds and scripts its VMF
 * names (vmfAssetExtractor.js), plus everything those need: a model's other
 * files (.vvd, .phy, .ani, .vtx), materials, included models and gibs, a
 * material's textures and included materials (mdlDependencies.js), and the
 * sound files of custom soundscript entries.
 *
 * Where each file comes from, in the game's file index (VPKs first, then the
 * gameinfo.txt folders and the DLC folders, like the game):
 * - the original game, never packed:
 *   - the game's VPKs (portal2/pak01_dir.vpk, ...)
 *   - the official DLCs (portal2_dlc1, portal2_dlc2), platform and update:
 *     only the game has files there
 *   - loose files in Portal 2/portal2 that Steam put there, dated like the
 *     game's own files (see gameDays): the game ships its scripts loose,
 *     outside its VPKs
 * - BEE2's, never packed: its folder, and the DLC folder it puts its
 *   generated VPK in
 * - in the package already: nothing to do
 * - custom, packed: anything else, also files added to Portal 2/portal2
 *   and files in other VPKs (extracted)
 * - not found: missing, warned about
 */

const fs = require("fs")
const path = require("path")
const { extractAssetsFromVMF } = require("./vmfAssetExtractor")
const {
    findDependencies,
    gameIndex,
    gameSearchPaths,
} = require("./mdlDependencies")
const { parseKeyValues } = require("./vmfConverter/keyvalues")
const { safeJoin } = require("./vmfConverter/resources")
const { loadVpk } = require("./vmfConverter/vpk")
const { findPortal2Resources } = require("../data")
const { logger } = require("./logger")

/** "1 file", "3 files" */
const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`

/** Leading characters that set how a sound plays: ")ambient/x.wav" */
const SOUND_CHARS = /^[*#@><^)}$!?&~]+/

/** Missing files named in the warning (the rest are counted) */
const MAX_LISTED = 10

/**
 * Folders only the game has files in, under its install folder (the
 * official DLCs, platform and update)
 */
const GAME_ONLY_FOLDERS = ["portal2_dlc1", "portal2_dlc2", "platform", "update"]

/** The game's folder, where people add files too */
const GAME_FOLDER = "portal2"

/** The VPKs Steam keeps up to date, under the game's install folder */
const GAME_VPKS = [
    "portal2/pak01_dir.vpk",
    "update/pak01_dir.vpk",
    "portal2_dlc1/pak01_dir.vpk",
    "portal2_dlc2/pak01_dir.vpk",
]

/** BEE2 marks the DLC folder it puts its generated VPK in with this file */
const BEE2_VPK_MARKER = "bee2_vpk_autogen_marker.txt"

/** BEE2's own files, some made only when it exports (antigel materials, ...) */
const BEE2_CONTENT = /^(materials|models|sound|scripts\/vscripts)\/bee2\//

/** How long what's known about the game's folders is reused */
const FOLDERS_TTL_MS = 60 * 1000

/** A file's date, as "2025-6-9" (local time) */
function fileDay(file) {
    try {
        const date = fs.statSync(file).mtime
        return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
    } catch {
        return null
    }
}

/**
 * The days Steam wrote the game's own files on (installing or updating it):
 * the dates of its VPKs and of the files in platform/, which only the game
 * has
 * @param {string} portal2Root
 * @returns {Set<string>}
 */
function gameDays(portal2Root) {
    const days = new Set()
    for (const vpk of GAME_VPKS) days.add(fileDay(path.join(portal2Root, vpk)))
    const walk = (folder) => {
        let entries = []
        try {
            entries = fs.readdirSync(folder, { withFileTypes: true })
        } catch {}
        for (const entry of entries) {
            const full = path.join(folder, entry.name)
            if (entry.isDirectory()) walk(full)
            else days.add(fileDay(full))
        }
    }
    walk(path.join(portal2Root, "platform"))
    days.delete(null)
    return days
}

/** Whether a folder has the VPK BEE2 generates */
function hasBee2Vpk(folder) {
    try {
        return fs
            .readdirSync(folder)
            .filter((name) => /_dir\.vpk$/i.test(name))
            .some((name) =>
                loadVpk(path.join(folder, name)).entries.has(BEE2_VPK_MARKER),
            )
    } catch {
        return false
    }
}

/** Whether `file` is inside `folder` */
function isInside(file, folder) {
    const relative = path.relative(folder, file)
    return (
        relative !== "" &&
        !relative.startsWith("..") &&
        !path.isAbsolute(relative)
    )
}

/** "a, b, c and 4 more" */
function listSome(names) {
    const shown = names.slice(0, MAX_LISTED).join(", ")
    const more = names.length - MAX_LISTED
    return more > 0 ? `${shown} and ${more} more` : shown
}

/**
 * The entries of soundscript files, by lowercase sound name
 * @param {Object} index - The game's file index
 * @param {string[]} files - Soundscript content paths ("scripts/x.txt")
 * @returns {Promise<Map<string, {file: string, waves: string[]}>>} The
 *   sound files under sound/, without the leading sound characters
 */
async function readSoundscripts(index, files) {
    const entries = new Map()
    for (const file of files) {
        let nodes
        try {
            nodes = parseKeyValues((await index.read(file)).toString("utf8"))
        } catch {
            continue // Not a KeyValues file
        }
        for (const node of nodes) {
            if (!node.children) continue
            const waves = []
            const collect = (children) => {
                for (const child of children) {
                    if (child.children) collect(child.children)
                    else if (child.key.toLowerCase() === "wave") {
                        const wave = child.value
                            .replace(/\\/g, "/")
                            .toLowerCase()
                            .replace(SOUND_CHARS, "")
                        if (wave) waves.push(wave)
                    }
                }
            }
            collect(node.children) // "wave", and those in "rndwave"
            if (waves.length) {
                entries.set(node.key.toLowerCase(), { file, waves })
            }
        }
    }
    return entries
}

const folderInfos = new Map()

/**
 * What the game's folders are: BEE2's, the game's own, and the days the game's
 * files were written on. Found once, then reused for a while.
 * @param {string} portal2Root
 */
function gameFolderInfo(portal2Root) {
    const cached = folderInfos.get(portal2Root)
    if (cached && Date.now() - cached.time < FOLDERS_TTL_MS) return cached
    const folders = gameSearchPaths(portal2Root).filter(
        (searchPath) => !/\.vpk$/i.test(searchPath),
    )
    const info = {
        time: Date.now(),
        bee2Folders: folders.filter(
            (folder) =>
                path.basename(folder).toLowerCase() === "bee2" ||
                hasBee2Vpk(folder),
        ),
        gameOnlyFolders: GAME_ONLY_FOLDERS.map((name) =>
            path.join(portal2Root, name),
        ),
        gameFolder: path.join(portal2Root, GAME_FOLDER),
        days: gameDays(portal2Root),
    }
    folderInfos.set(portal2Root, info)
    return info
}

/**
 * Find the files an instance needs and sort them by where they come from
 * @param {string} vmfPath - The instance
 * @param {string} portal2Root - Portal 2's install folder
 * @param {string} [packageDir] - The package the instance is added to: its
 *   files count as packed already
 * @returns {Promise<{references: Object, needed: string[], neededBy: Object<string, string>, custom: {file: string, source: string, fromVpk: boolean, read: () => Promise<Buffer>}[], inPackage: string[], baseGame: string[], bee2: string[], missing: string[], missingDependencies: string[]}>}
 *   Content paths ("materials/x.vmt"); custom ones with where they are (a
 *   loose file or a VPK) and how to read them.
 *   missing: files the instance or its custom content needs that aren't
 *   anywhere (neededBy: what needs those that the instance doesn't name);
 *   missingDependencies: files the game's own content names that aren't
 *   anywhere (like gibs its models name but the game doesn't have)
 */
async function sortInstanceFiles(vmfPath, portal2Root, packageDir) {
    const references = extractAssetsFromVMF(vmfPath)
    const resources = packageDir ? path.join(packageDir, "resources") : null
    // The package's files are in the index too (last), so what its models
    // and materials need is known
    const extraPaths = resources && fs.existsSync(resources) ? [resources] : []
    const index = await gameIndex(portal2Root, extraPaths)

    const { bee2Folders, gameOnlyFolders, gameFolder, days } =
        gameFolderInfo(portal2Root)
    const inAny = (file, list) => list.some((folder) => isInside(file, folder))
    const where = (file) => {
        const source = index.source(file)
        if (!source) return BEE2_CONTENT.test(file) ? "bee2" : "missing"
        // A loose file, or the VPK the file is in
        const location = source.file ?? source.vpk.dirPath
        if (resources && isInside(location, resources)) return "inPackage"
        if (inAny(location, bee2Folders)) return "bee2"
        if (inAny(location, gameOnlyFolders)) return "baseGame"
        if (isInside(location, gameFolder)) {
            // The game's VPKs, and the files Steam put there
            if (source.vpk || days.has(fileDay(location))) return "baseGame"
        }
        return "custom"
    }

    const dependencies = await findDependencies(index, {
        models: references.MODEL,
        materials: references.MATERIAL.map((m) => `materials/${m}`),
    })
    const needed = new Set(dependencies.files)
    for (const sound of references.SOUND) needed.add(`sound/${sound}`)
    for (const script of references.SCRIPT) needed.add(`scripts/${script}`)

    // What the instance names itself (the rest is what those need)
    const named = new Set([
        ...references.MODEL.map((model) => {
            const file = model.startsWith("models/") ? model : `models/${model}`
            return file.endsWith(".mdl") ? file : `${file}.mdl`
        }),
        ...references.MATERIAL.map((material) => `materials/${material}.vmt`),
        ...references.SOUND.map((sound) => `sound/${sound}`),
        ...references.SCRIPT.map((script) => `scripts/${script}`),
    ])

    // Sounds named by a soundscript entry: when the entry is custom, its
    // sound files and its soundscript file. Entries of the game's own
    // soundscripts play the game's own sounds.
    if (references.SOUNDSCRIPT.length > 0) {
        const soundscriptFiles = index
            .listWithPrefix("scripts/")
            .filter((file) => file.endsWith(".txt") && where(file) === "custom")
        const entries = await readSoundscripts(index, soundscriptFiles)
        for (const name of references.SOUNDSCRIPT) {
            const entry = entries.get(name)
            if (!entry) continue
            needed.add(entry.file)
            for (const wave of entry.waves) {
                needed.add(`sound/${wave}`)
                named.add(`sound/${wave}`)
            }
        }
    }

    const sorted = {
        custom: [],
        inPackage: [],
        baseGame: [],
        bee2: [],
        missing: [],
        missingDependencies: [],
    }
    // A model's other files (.vvd, .phy, .vtx, ...) belong with its .mdl: a
    // stray copy of one next to custom content doesn't make the game's model
    // custom
    const modelKinds = new Map()
    for (const file of needed) {
        if (file.endsWith(".mdl"))
            modelKinds.set(file.slice(0, -4), where(file))
    }
    const kindOf = (file) => {
        const model = file.match(
            /^(models\/.*?)\.(?:phy|vvd|ani|(?:dx90\.|dx80\.|sw\.)?vtx)$/,
        )
        const modelKind = model && modelKinds.get(model[1])
        if (modelKind && modelKind !== "custom" && modelKind !== "missing") {
            return modelKind
        }
        return where(file)
    }

    // Missing files of custom content (a custom material's texture, a custom
    // model's materials, ...) are reported with what needs them; those of
    // the game's own content aren't the instance's problem
    const neededBy = {}
    for (const file of [...needed].sort()) {
        let kind = kindOf(file)
        if (kind === "missing" && !named.has(file)) {
            const by = dependencies.requiredBy.get(file)
            const byKind = by && kindOf(by)
            if (byKind === "custom" || byKind === "inPackage")
                neededBy[file] = by
            else kind = "missingDependencies"
        }
        if (kind !== "custom") {
            sorted[kind].push(file)
            continue
        }
        const source = index.source(file)
        sorted.custom.push({
            file,
            source: source.file ?? source.vpk.dirPath,
            fromVpk: !source.file,
            read: () => index.read(file),
        })
    }
    return { references, needed: [...needed].sort(), neededBy, ...sorted }
}

/**
 * Perform autopacking for an instance VMF file
 * @param {string} instancePath - Path to the instance VMF file
 * @param {string} packageDir - Package directory path
 * @param {string} itemName - Name of the item
 * @returns {Promise<Object>} Result object with success status and packed files
 */
async function autopackInstance(instancePath, packageDir, itemName) {
    const title = `Autopacking ${instancePath} for "${itemName}"`
    return logger.section(title, async () => {
        try {
            const portal2Resources = await findPortal2Resources()
            if (!portal2Resources?.root) {
                console.warn(
                    "Skipped autopacking, Portal 2 wasn't found (the instance's assets must be packed by hand)",
                )
                return {
                    success: true,
                    skipped: true,
                    reason: "Portal 2 not installed",
                    totalAssets: 0,
                    packedAssets: 0,
                }
            }

            const files = await sortInstanceFiles(
                instancePath,
                portal2Resources.root,
                packageDir,
            )
            const { MODEL, MATERIAL, SOUND, SOUNDSCRIPT, SCRIPT } =
                files.references
            console.log(
                `The instance uses ${plural(MODEL.length, "model")}, ${plural(MATERIAL.length, "material")}, ${plural(SOUND.length + SOUNDSCRIPT.length, "sound")} and ${plural(SCRIPT.length, "script")}`,
            )
            console.log(
                `They need ${plural(files.needed.length, "file")}: ${files.custom.length} to pack, ${files.inPackage.length} already in the package, ${files.baseGame.length} from the original game, ${files.bee2.length} from BEE2`,
            )
            if (files.missing.length > 0) {
                const described = files.missing.map((file) =>
                    files.neededBy[file]
                        ? `${file} (used by ${files.neededBy[file]})`
                        : file,
                )
                const these =
                    files.missing.length === 1
                        ? "This file doesn't exist or isn't"
                        : `These ${files.missing.length} files don't exist or aren't`
                console.warn(
                    `${these} mounted properly: ${listSome(described)}`,
                )
            }
            if (files.missingDependencies.length > 0) {
                logger.debug(
                    `${plural(files.missingDependencies.length, "file")} its models and materials name weren't found: ${listSome(files.missingDependencies)}`,
                )
            }

            // Copy the custom files: resources/{content path}
            const resources = path.join(packageDir, "resources")
            const packedFiles = []
            for (const { file, source, fromVpk, read } of files.custom) {
                const target = safeJoin(resources, file)
                if (fs.existsSync(target)) continue
                fs.mkdirSync(path.dirname(target), { recursive: true })
                // Files in a VPK are extracted from it
                if (fromVpk) fs.writeFileSync(target, await read())
                else fs.copyFileSync(source, target)
                packedFiles.push(target)
                logger.debug(`Packed ${file} from ${source}`)
            }

            const verificationResults = files.custom.map(({ file }) => ({
                asset: file,
                found: fs.existsSync(safeJoin(resources, file)),
            }))
            const notPacked = verificationResults
                .filter((result) => !result.found)
                .map((result) => result.asset)
            const already = files.custom.length - packedFiles.length
            console.log(
                `Packed ${plural(packedFiles.length, "file")}` +
                    (already > 0
                        ? ` (${already} were in the package already)`
                        : ""),
            )

            return {
                success: notPacked.length === 0,
                error: notPacked.length
                    ? `Failed to pack ${plural(notPacked.length, "file")}: ${listSome(notPacked)}`
                    : null,
                packedFiles,
                verificationResults,
                totalAssets: files.custom.length,
                packedAssets: files.custom.length - notPacked.length,
                missingFiles: files.missing,
                neededBy: files.neededBy,
            }
        } catch (error) {
            console.error("Autopacking failed:", error)
            return {
                success: false,
                error: error.message,
                packedFiles: [],
                verificationResults: [],
                totalAssets: 0,
                packedAssets: 0,
            }
        }
    })
}

module.exports = {
    autopackInstance,
    sortInstanceFiles,
}
