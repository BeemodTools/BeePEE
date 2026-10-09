/**
 * The files of a package that its instances and configs use, for what goes
 * with the autopacker: deleting the files only removed instances used, and
 * importing an item with the files it uses.
 *
 * What a VMF uses is what the autopacker finds (sortInstanceFiles): the
 * models, materials, sounds, scripts and particles it names, and what those
 * need (a model's materials, a material's textures, ...). Config files can
 * name content too (conditions adding a prop or an overlay, signage's
 * overlays): what they name, and what that needs, is used too.
 */

const fs = require("fs")
const path = require("path")
const { sortInstanceFiles } = require("./autopacker")
const {
    findDependencies,
    forgetIndexes,
    gameIndex,
} = require("./mdlDependencies")
const { safeJoin } = require("./vmfConverter/resources")
const { findPortal2Resources } = require("../data")

/** "1 file", "3 files" */
const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`

/** The folders of resources the game reads content from */
const CONTENT_FOLDERS = ["materials", "models", "sound", "scripts", "particles"]

/** Editor models and palette images, never deleted with an instance */
const EDITOR_FILES = /^(materials\/)?models\/props_map_editor\//

/** What separates the names in config text (no content path has these) */
const SEPARATORS = /["'\s{}[\](),;:=|<>]+/

/** Leading characters that set how a sound plays: ")ambient/x.wav" */
const SOUND_CHARS = /^[*#@><^)}$!?&~]+/

/** Files named in the log (the rest are counted) */
const MAX_LISTED = 10

function listSome(names) {
    const shown = names.slice(0, MAX_LISTED).join(", ")
    const more = names.length - MAX_LISTED
    return more > 0 ? `${shown} and ${more} more` : shown
}

/** Every file under a folder, relative to it, with forward slashes */
function filesUnder(dir, base = dir, out = []) {
    let entries = []
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
        return out
    }
    for (const entry of entries) {
        const file = path.join(dir, entry.name)
        if (entry.isDirectory()) filesUnder(file, base, out)
        else out.push(path.relative(base, file).split(path.sep).join("/"))
    }
    return out
}

/**
 * A package's content files: each one's content path, lowercase
 * ("materials/x.vmt"), to its path in resources
 */
function contentFiles(packageDir) {
    const resources = path.join(packageDir, "resources")
    const files = new Map()
    for (const folder of CONTENT_FOLDERS) {
        for (const file of filesUnder(path.join(resources, folder))) {
            files.set(`${folder}/${file}`.toLowerCase(), `${folder}/${file}`)
        }
    }
    return files
}

/** The VMFs in a package: its instances, and its brush templates */
function vmfFiles(packageDir) {
    return ["resources", "templates"].flatMap((folder) => {
        const dir = path.join(packageDir, folder)
        return filesUnder(dir)
            .filter((file) => /\.vmf$/i.test(file))
            .map((file) => path.join(dir, file))
    })
}

/** The text of the config files (.json, .cfg, .txt) in folders */
function configTexts(dirs) {
    const texts = []
    for (const dir of dirs) {
        for (const file of filesUnder(dir)) {
            if (!/\.(json|cfg|txt)$/i.test(file)) continue
            try {
                texts.push(fs.readFileSync(path.join(dir, file), "utf8"))
            } catch {}
        }
    }
    return texts
}

/** A package's config files' text: its info.json, and its items' */
function packageConfigTexts(packageDir) {
    const texts = configTexts([path.join(packageDir, "items")])
    try {
        texts.push(fs.readFileSync(path.join(packageDir, "info.json"), "utf8"))
    } catch {}
    return texts
}

/**
 * The names in config text, lowercase: IDs, file names, ... ("TEMP_X:vis"
 * is "temp_x" and "vis")
 */
function namesIn(texts) {
    const names = new Set()
    for (const text of texts) {
        const parts = text.toLowerCase().replace(/\\/g, "/").split(SEPARATORS)
        for (const name of parts) if (name) names.add(name)
    }
    return names
}

/**
 * The content files config text names, from `files` (see contentFiles):
 * "metal/black" names materials/metal/black.vmt, "props/x.mdl" names
 * models/props/x.mdl, and so on
 * @returns {Set<string>} Their content paths, lowercase
 */
function filesNamedIn(texts, files) {
    const named = new Set()
    const add = (file) => {
        if (files.has(file)) named.add(file)
    }
    for (const each of namesIn(texts)) {
        const name = each.replace(SOUND_CHARS, "").replace(/^\/+/, "")
        if (!name) continue
        const stem = name.replace(/\.(vmt|vtf|mdl|nut|pcf)$/, "")
        const under = (folder) =>
            stem.startsWith(`${folder}/`) ? stem : `${folder}/${stem}`
        add(name)
        add(`${under("materials")}.vmt`)
        add(`${under("materials")}.vtf`)
        add(`${under("models")}.mdl`)
        add(name.startsWith("sound/") ? name : `sound/${name}`)
        add(`${under("scripts/vscripts")}.nut`)
        add(`${under("particles")}.pcf`)
        // Editoritems' editor models and palette images
        add(`${under("models/props_map_editor")}.mdl`)
        add(`${under("materials/models/props_map_editor")}.vtf`)
    }
    return named
}

/**
 * The files of a package that VMFs and config text use: what they name and
 * what those need. Throws when a VMF can't be read.
 * @param {string} packageDir
 * @param {string} portal2Root - Its index tells what's the game's
 * @param {{vmfPaths?: string[], texts?: string[]}} users
 * @param {Set<string>} [wanted] - Stop once all of these are found
 * @returns {Promise<Set<string>>} Content paths, lowercase
 */
async function filesUsed(
    packageDir,
    portal2Root,
    { vmfPaths = [], texts = [] },
    wanted = null,
) {
    const files = contentFiles(packageDir)
    const used = new Set()
    const add = (file) => {
        const key = String(file).toLowerCase()
        if (files.has(key)) used.add(key)
    }
    const done = () => wanted && [...wanted].every((file) => used.has(file))

    const named = filesNamedIn(texts, files)
    for (const file of named) used.add(file)
    const models = [...named].filter((file) => file.endsWith(".mdl"))
    const materials = [...named].filter((file) => file.endsWith(".vmt"))
    if (models.length > 0 || materials.length > 0) {
        const resources = path.join(packageDir, "resources")
        const index = await gameIndex(portal2Root, [resources])
        const dependencies = await findDependencies(index, {
            models,
            materials,
        })
        for (const file of dependencies.files) add(file)
    }

    for (const vmfPath of vmfPaths) {
        if (done()) break
        const { needed } = await sortInstanceFiles(
            vmfPath,
            portal2Root,
            packageDir,
        )
        for (const file of needed) add(file)
    }
    return used
}

/**
 * The files of a package that VMFs of it use (see filesUsed): none when
 * Portal 2 isn't found, or when they can't be read
 */
async function instanceFiles(packageDir, vmfPaths) {
    const existing = vmfPaths.filter((file) => fs.existsSync(file))
    if (existing.length === 0) return new Set()
    const portal2 = await findPortal2Resources()
    if (!portal2?.root) return new Set()
    try {
        return await filesUsed(packageDir, portal2.root, {
            vmfPaths: existing,
        })
    } catch (error) {
        console.warn(
            `Couldn't tell which files of the package ${plural(existing.length, "instance")} use: ${error.message}`,
        )
        return new Set()
    }
}

/** Remove a folder, and the ones it's in, while they're empty */
function removeEmptyFolders(dir, root) {
    let folder = dir
    while (folder.startsWith(root + path.sep)) {
        try {
            if (fs.readdirSync(folder).length > 0) return
            fs.rmdirSync(folder)
        } catch {
            return
        }
        folder = path.dirname(folder)
    }
}

/**
 * Delete files of a package that nothing in it uses anymore, of `files`
 * (ones instances that were removed used): no VMF of it (instances, brush
 * templates) and none of its config files use them. Editor models and
 * palette images stay. Nothing is deleted when Portal 2 isn't found, or
 * when a VMF can't be read.
 * @param {string} packageDir
 * @param {Iterable<string>} files - Content paths, lowercase
 * @returns {Promise<string[]>} The deleted ones
 */
async function removeUnusedFiles(packageDir, files) {
    const candidates = new Set(
        [...files].filter((file) => !EDITOR_FILES.test(file)),
    )
    if (candidates.size === 0) return []
    try {
        const portal2 = await findPortal2Resources()
        if (!portal2?.root) {
            console.log(
                `Kept the ${plural(candidates.size, "file")} removed instances used, as Portal 2 wasn't found (what the rest use can't be told)`,
            )
            return []
        }
        // Instances were added, removed or replaced: the index has to list
        // the package's files as they are now
        forgetIndexes()
        const used = await filesUsed(
            packageDir,
            portal2.root,
            {
                vmfPaths: vmfFiles(packageDir),
                texts: packageConfigTexts(packageDir),
            },
            candidates,
        )
        const present = contentFiles(packageDir)
        const unused = [...candidates]
            .filter((file) => present.has(file) && !used.has(file))
            .sort()
        if (unused.length === 0) return []

        const resources = path.resolve(packageDir, "resources")
        const removed = []
        for (const file of unused) {
            try {
                const target = safeJoin(resources, present.get(file))
                fs.unlinkSync(target)
                removed.push(file)
                removeEmptyFolders(path.dirname(target), resources)
            } catch (error) {
                console.warn(
                    `Couldn't delete ${file}, which nothing uses anymore: ${error.message}`,
                )
            }
        }
        // The index has them still
        forgetIndexes()
        console.log(
            `Deleted ${plural(removed.length, "file")} nothing in the package uses anymore: ${listSome(removed)}`,
        )
        return removed
    } catch (error) {
        console.warn(
            `Kept the files removed instances used, as what the package's other VMFs use couldn't be told: ${error.message}`,
        )
        return []
    }
}

// Files that instances the item editor removed used, deleted when it's done
// saving (removeUnusedFiles): it adds instances after removing them, and one
// it adds can use them. Package folder -> content paths.
const removedFiles = new Map()

/** Note the files instances about to be removed use (see removedFiles) */
function noteRemovedFiles(packageDir, files) {
    if (!removedFiles.has(packageDir)) removedFiles.set(packageDir, new Set())
    for (const file of files) removedFiles.get(packageDir).add(file)
}

/** The files noted for a package, forgotten */
function takeRemovedFiles(packageDir) {
    const files = removedFiles.get(packageDir) ?? new Set()
    removedFiles.delete(packageDir)
    return files
}

module.exports = {
    contentFiles,
    configTexts,
    filesNamedIn,
    filesUsed,
    instanceFiles,
    namesIn,
    noteRemovedFiles,
    removeUnusedFiles,
    takeRemovedFiles,
}
