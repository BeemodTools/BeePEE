/**
 * Valve Pak (VPK v1/v2) directory reader.
 * https://developer.valvesoftware.com/wiki/VPK_(file_format)
 */

const fs = require("fs")

const VPK_SIGNATURE = 0x55aa1234
const ARCHIVE_IN_DIR = 0x7fff
const HEADER_SIZE = { 1: 12, 2: 28 }

// Parsed directories are reused across conversions while the file is unchanged
const indexCache = new Map()

function readNullTerminated(buffer, offset) {
    const end = buffer.indexOf(0, offset)
    if (end === -1) throw new Error("Unterminated string in VPK directory")
    return { value: buffer.toString("latin1", offset, end), next: end + 1 }
}

function parseVpk(dirPath) {
    const fd = fs.openSync(dirPath, "r")
    try {
        const header = Buffer.alloc(28)
        fs.readSync(fd, header, 0, 28, 0)
        if (header.readUInt32LE(0) !== VPK_SIGNATURE) {
            throw new Error("Not a VPK file (bad signature)")
        }
        const version = header.readUInt32LE(4)
        const headerSize = HEADER_SIZE[version]
        if (!headerSize) throw new Error(`Unsupported VPK version ${version}`)
        const treeSize = header.readUInt32LE(8)

        const tree = Buffer.alloc(treeSize)
        fs.readSync(fd, tree, 0, treeSize, headerSize)

        const entries = new Map()
        let p = 0
        for (;;) {
            const ext = readNullTerminated(tree, p)
            p = ext.next
            if (!ext.value) break
            for (;;) {
                const dir = readNullTerminated(tree, p)
                p = dir.next
                if (!dir.value) break
                for (;;) {
                    const name = readNullTerminated(tree, p)
                    p = name.next
                    if (!name.value) break

                    const preloadSize = tree.readUInt16LE(p + 4)
                    const entry = {
                        archiveIndex: tree.readUInt16LE(p + 6),
                        offset: tree.readUInt32LE(p + 8),
                        length: tree.readUInt32LE(p + 12),
                        preload: null,
                    }
                    p += 18
                    if (preloadSize > 0) {
                        entry.preload = Buffer.from(
                            tree.subarray(p, p + preloadSize),
                        )
                        p += preloadSize
                    }

                    const folder = dir.value === " " ? "" : `${dir.value}/`
                    const extension = ext.value === " " ? "" : `.${ext.value}`
                    const fullPath =
                        `${folder}${name.value}${extension}`.toLowerCase()
                    if (!entries.has(fullPath)) entries.set(fullPath, entry)
                }
            }
        }

        const isMultiPart = /_dir\.vpk$/i.test(dirPath)
        return {
            dirPath,
            entries,
            isMultiPart,
            archiveBase: isMultiPart
                ? dirPath.slice(0, -"_dir.vpk".length)
                : null,
            dataStart: headerSize + treeSize,
        }
    } finally {
        fs.closeSync(fd)
    }
}

/**
 * Load (or reuse) the directory index of a VPK file
 * @param {string} dirPath - Path to a *_dir.vpk or single-file .vpk
 */
function loadVpk(dirPath) {
    const stat = fs.statSync(dirPath)
    const cached = indexCache.get(dirPath)
    if (
        cached &&
        cached.mtimeMs === stat.mtimeMs &&
        cached.size === stat.size
    ) {
        return cached.vpk
    }
    const vpk = parseVpk(dirPath)
    indexCache.set(dirPath, { mtimeMs: stat.mtimeMs, size: stat.size, vpk })
    return vpk
}

/**
 * Read a file's bytes out of a VPK
 * @param {Object} vpk - Result of loadVpk
 * @param {Object} entry - Entry from vpk.entries
 * @returns {Promise<Buffer>}
 */
async function readVpkEntry(vpk, entry) {
    if (entry.length === 0) return entry.preload || Buffer.alloc(0)

    let file = vpk.dirPath
    let position = entry.offset
    if (entry.archiveIndex === ARCHIVE_IN_DIR) {
        position = vpk.dataStart + entry.offset
    } else if (vpk.isMultiPart) {
        file = `${vpk.archiveBase}_${String(entry.archiveIndex).padStart(3, "0")}.vpk`
    }

    const data = Buffer.alloc(entry.length)
    const handle = await fs.promises.open(file, "r")
    try {
        const { bytesRead } = await handle.read(data, 0, entry.length, position)
        if (bytesRead !== entry.length) {
            throw new Error(`Short read from ${file}`)
        }
    } finally {
        await handle.close()
    }
    return entry.preload ? Buffer.concat([entry.preload, data]) : data
}

module.exports = { loadVpk, readVpkEntry }
