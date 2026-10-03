/**
 * Game content lookup across VPK files and loose content folders.
 * Paths are matched case-insensitively and the first resource path that
 * contains a file wins (same precedence as the original VMF2OBJ).
 */

const fs = require("fs")
const path = require("path")
const { loadVpk, readVpkEntry } = require("./vpk")

/** Normalize a content path: lowercase, forward slashes, no leading slash */
function normalizeContentPath(p) {
    return p
        .replace(/\\/g, "/")
        .replace(/\/{2,}/g, "/")
        .replace(/^\/+/, "")
        .trim()
        .toLowerCase()
}

/** Join a content path under a root folder, refusing paths that escape it */
function safeJoin(root, contentPath) {
    const base = path.resolve(root)
    const target = path.resolve(base, ...contentPath.split("/"))
    if (target !== base && !target.startsWith(base + path.sep)) {
        throw new Error(`Refusing to write outside ${root}: ${contentPath}`)
    }
    return target
}

class ResourceIndex {
    constructor() {
        this.files = new Map()
        this.dirs = new Map()
    }

    add(contentPath, source) {
        if (this.files.has(contentPath)) return
        this.files.set(contentPath, source)
        const slash = contentPath.lastIndexOf("/")
        const dir = slash === -1 ? "" : contentPath.slice(0, slash)
        const name = contentPath.slice(slash + 1)
        let names = this.dirs.get(dir)
        if (!names) {
            names = []
            this.dirs.set(dir, names)
        }
        names.push(name)
    }

    has(contentPath) {
        return this.files.has(normalizeContentPath(contentPath))
    }

    /**
     * Read a file by content path
     * @returns {Promise<Buffer|null>} null when not found
     */
    async read(contentPath) {
        const source = this.files.get(normalizeContentPath(contentPath))
        if (!source) return null
        if (source.vpk) return readVpkEntry(source.vpk, source.entry)
        return fs.promises.readFile(source.file)
    }

    /**
     * List content paths in the same folder that start with a prefix,
     * e.g. "models/props/door." -> door.mdl, door.vvd, door.dx90.vtx ...
     */
    listWithPrefix(prefix) {
        const normalized = normalizeContentPath(prefix)
        const slash = normalized.lastIndexOf("/")
        const dir = slash === -1 ? "" : normalized.slice(0, slash)
        const namePrefix = normalized.slice(slash + 1)
        const names = this.dirs.get(dir) || []
        return names
            .filter((name) => name.startsWith(namePrefix))
            .map((name) => (dir ? `${dir}/${name}` : name))
    }
}

async function addFolder(index, root) {
    const entries = await fs.promises.readdir(root, {
        recursive: true,
        withFileTypes: true,
    })
    for (const entry of entries) {
        if (!entry.isFile()) continue
        const parent = entry.parentPath ?? entry.path
        const file = path.join(parent, entry.name)
        index.add(normalizeContentPath(path.relative(root, file)), { file })
    }
}

/**
 * Build an index over VPK files and content folders (folders that contain
 * "materials"/"models" subfolders, not those subfolders themselves).
 * @param {string[]} resourcePaths
 * @param {(message: string) => void} warn
 * @returns {Promise<ResourceIndex>}
 */
async function buildResourceIndex(resourcePaths, warn = () => {}) {
    const index = new ResourceIndex()
    for (const resourcePath of resourcePaths) {
        try {
            const stat = await fs.promises.stat(resourcePath)
            if (stat.isDirectory()) {
                await addFolder(index, resourcePath)
            } else {
                const vpk = loadVpk(resourcePath)
                for (const [contentPath, entry] of vpk.entries) {
                    index.add(contentPath, { vpk, entry })
                }
            }
        } catch (error) {
            warn(
                `Could not load resource path ${resourcePath}: ${error.message}`,
            )
        }
    }
    return index
}

module.exports = {
    ResourceIndex,
    buildResourceIndex,
    normalizeContentPath,
    safeJoin,
}
