/**
 * Materials and textures: VMT parsing, VTF decoding and PNG encoding.
 * Replaces VTFCmd/VTFLib, which the Java VMF2OBJ shelled out to.
 */

const zlib = require("zlib")
const { parseKeyValues } = require("./keyvalues")

// ---------------------------------------------------------------------------
// VMT
// ---------------------------------------------------------------------------

function compare(left, op, right) {
    switch (op) {
        case ">=":
            return left >= right
        case "<=":
            return left <= right
        case ">":
            return left > right
        case "<":
            return left < right
        default:
            return left === right
    }
}

/**
 * Evaluate a VMT key condition such as "GPU>=2", "!srgb" or "360"
 * (as in "GPU>=2?$basetexture"). Assumes a high-end Windows PC.
 */
function evaluateMaterialCondition(condition) {
    let text = condition.trim().toLowerCase()
    let negate = false
    while (text.startsWith("!")) {
        negate = !negate
        text = text.slice(1).trim()
    }

    let result = false
    const gpu = text.match(/^gpu\s*(>=|<=|==|>|<)\s*(\d+)$/)
    const dx = text.match(/^(>=|<=|==|>|<)\s*dx(\d+)$/)
    if (gpu) {
        result = compare(3, gpu[1], Number(gpu[2]))
    } else if (dx) {
        result = compare(95, dx[1], Number(dx[2]))
    } else if (text === "srgb") {
        result = true
    }
    return negate ? !result : result
}

function applyParam(params, rawKey, value) {
    let key = rawKey.trim()
    const question = key.lastIndexOf("?")
    if (question !== -1) {
        if (!evaluateMaterialCondition(key.slice(0, question))) return
        key = key.slice(question + 1)
    }
    if (key.startsWith("%")) return
    params.set(key.replace(/^\$/, "").toLowerCase(), value)
}

/**
 * Parse VMT text. Only top-level parameters are read (fallback shader blocks
 * and proxies are ignored); "patch" materials keep their insert/replace blocks.
 * @returns {{shader: string, params: Map<string, string>, include?: string}}
 */
function parseVmt(text) {
    const shaderBlock = parseKeyValues(text).find((node) => node.children)
    if (!shaderBlock) throw new Error("No shader block")

    const shader = shaderBlock.key.toLowerCase()
    const params = new Map()
    for (const node of shaderBlock.children) {
        if (node.children === undefined)
            applyParam(params, node.key, node.value)
    }

    if (shader !== "patch") return { shader, params }

    const patchParams = new Map()
    for (const node of shaderBlock.children) {
        const key = node.key.toLowerCase()
        if (node.children && (key === "insert" || key === "replace")) {
            for (const child of node.children) {
                if (child.children === undefined) {
                    applyParam(patchParams, child.key, child.value)
                }
            }
        }
    }
    return { shader, params: patchParams, include: params.get("include") }
}

/** Normalize a texture reference: lowercase, forward slashes, no .vtf */
function normalizeTexturePath(value) {
    if (typeof value !== "string") return null
    const normalized = value
        .replace(/\\/g, "/")
        .replace(/\/{2,}/g, "/")
        .replace(/^\/+/, "")
        .trim()
        .toLowerCase()
        .replace(/\.vtf$/, "")
    return normalized || null
}

function isTruthyParam(value) {
    if (value === undefined) return false
    const n = Number(String(value).trim())
    return Number.isFinite(n) && n !== 0
}

/**
 * Pull the fields the converter needs out of parsed VMT params
 * @returns {{basetexture: string|null, bumpmap: string|null, translucent: boolean, alphatest: boolean}}
 */
function describeMaterial(shader, params) {
    if (shader === "water") {
        // Water has no displayable base texture; use an obvious placeholder
        return {
            basetexture: "tools/toolsdotted",
            bumpmap: null,
            translucent: false,
            alphatest: false,
        }
    }
    return {
        basetexture: normalizeTexturePath(params.get("basetexture")),
        bumpmap: normalizeTexturePath(params.get("bumpmap")),
        translucent: isTruthyParam(params.get("translucent")),
        alphatest: isTruthyParam(params.get("alphatest")),
    }
}

// ---------------------------------------------------------------------------
// VTF
// ---------------------------------------------------------------------------

const FORMAT = {
    RGBA8888: 0,
    ABGR8888: 1,
    RGB888: 2,
    BGR888: 3,
    RGB565: 4,
    I8: 5,
    IA88: 6,
    P8: 7,
    A8: 8,
    RGB888_BLUESCREEN: 9,
    BGR888_BLUESCREEN: 10,
    ARGB8888: 11,
    BGRA8888: 12,
    DXT1: 13,
    DXT3: 14,
    DXT5: 15,
    BGRX8888: 16,
    BGR565: 17,
    BGRX5551: 18,
    BGRA4444: 19,
    DXT1_ONEBITALPHA: 20,
    BGRA5551: 21,
    UV88: 22,
    UVWQ8888: 23,
    RGBA16161616F: 24,
    RGBA16161616: 25,
    UVLX8888: 26,
    R32F: 27,
    RGB323232F: 28,
    RGBA32323232F: 29,
}

const BYTES_PER_PIXEL = {
    [FORMAT.RGBA8888]: 4,
    [FORMAT.ABGR8888]: 4,
    [FORMAT.RGB888]: 3,
    [FORMAT.BGR888]: 3,
    [FORMAT.RGB565]: 2,
    [FORMAT.I8]: 1,
    [FORMAT.IA88]: 2,
    [FORMAT.P8]: 1,
    [FORMAT.A8]: 1,
    [FORMAT.RGB888_BLUESCREEN]: 3,
    [FORMAT.BGR888_BLUESCREEN]: 3,
    [FORMAT.ARGB8888]: 4,
    [FORMAT.BGRA8888]: 4,
    [FORMAT.BGRX8888]: 4,
    [FORMAT.BGR565]: 2,
    [FORMAT.BGRX5551]: 2,
    [FORMAT.BGRA4444]: 2,
    [FORMAT.BGRA5551]: 2,
    [FORMAT.UV88]: 2,
    [FORMAT.UVWQ8888]: 4,
    [FORMAT.RGBA16161616F]: 8,
    [FORMAT.RGBA16161616]: 8,
    [FORMAT.UVLX8888]: 4,
    [FORMAT.R32F]: 4,
    [FORMAT.RGB323232F]: 12,
    [FORMAT.RGBA32323232F]: 16,
}

const isDxt1 = (format) =>
    format === FORMAT.DXT1 || format === FORMAT.DXT1_ONEBITALPHA

function imageSize(format, width, height) {
    if (isDxt1(format) || format === FORMAT.DXT3 || format === FORMAT.DXT5) {
        const blocks =
            Math.max(1, Math.ceil(width / 4)) *
            Math.max(1, Math.ceil(height / 4))
        return blocks * (isDxt1(format) ? 8 : 16)
    }
    const bpp = BYTES_PER_PIXEL[format]
    if (!bpp) throw new Error(`Unsupported VTF image format ${format}`)
    return width * height * bpp
}

function expand565(c) {
    const r = (c >> 11) & 31
    const g = (c >> 5) & 63
    const b = c & 31
    return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)]
}

function decodeDxt(data, offset, width, height, format) {
    const out = Buffer.alloc(width * height * 4)
    const blocksX = Math.max(1, Math.ceil(width / 4))
    const blocksY = Math.max(1, Math.ceil(height / 4))
    const blockSize = isDxt1(format) ? 8 : 16
    const colors = new Uint8Array(16)
    const alphas = new Uint8Array(16)
    let p = offset

    for (let by = 0; by < blocksY; by++) {
        for (let bx = 0; bx < blocksX; bx++) {
            const colorOffset = isDxt1(format) ? p : p + 8
            const c0 = data.readUInt16LE(colorOffset)
            const c1 = data.readUInt16LE(colorOffset + 2)
            const bits = data.readUInt32LE(colorOffset + 4)
            const a = expand565(c0)
            const b = expand565(c1)
            colors.set([a[0], a[1], a[2], 255, b[0], b[1], b[2], 255])
            if (!isDxt1(format) || c0 > c1) {
                for (let i = 0; i < 3; i++) {
                    colors[8 + i] = ((2 * a[i] + b[i] + 1) / 3) | 0
                    colors[12 + i] = ((a[i] + 2 * b[i] + 1) / 3) | 0
                }
                colors[11] = 255
                colors[15] = 255
            } else {
                for (let i = 0; i < 3; i++) {
                    colors[8 + i] = ((a[i] + b[i]) / 2) | 0
                    colors[12 + i] = 0
                }
                colors[11] = 255
                colors[15] = 0
            }

            if (format === FORMAT.DXT3) {
                for (let i = 0; i < 16; i++) {
                    const byte = data[p + (i >> 1)]
                    alphas[i] = ((i & 1 ? byte >> 4 : byte) & 15) * 17
                }
            } else if (format === FORMAT.DXT5) {
                const a0 = data[p]
                const a1 = data[p + 1]
                const table = [a0, a1]
                if (a0 > a1) {
                    for (let i = 1; i <= 6; i++)
                        table.push((((7 - i) * a0 + i * a1) / 7) | 0)
                } else {
                    for (let i = 1; i <= 4; i++)
                        table.push((((5 - i) * a0 + i * a1) / 5) | 0)
                    table.push(0, 255)
                }
                const lo =
                    data[p + 2] | (data[p + 3] << 8) | (data[p + 4] << 16)
                const hi =
                    data[p + 5] | (data[p + 6] << 8) | (data[p + 7] << 16)
                for (let i = 0; i < 16; i++) {
                    const index =
                        i < 8 ? (lo >> (3 * i)) & 7 : (hi >> (3 * (i - 8))) & 7
                    alphas[i] = table[index]
                }
            }

            for (let py = 0; py < 4; py++) {
                const y = by * 4 + py
                if (y >= height) break
                for (let px = 0; px < 4; px++) {
                    const x = bx * 4 + px
                    if (x >= width) break
                    const i = py * 4 + px
                    const index = (bits >>> (2 * i)) & 3
                    const o = (y * width + x) * 4
                    out[o] = colors[index * 4]
                    out[o + 1] = colors[index * 4 + 1]
                    out[o + 2] = colors[index * 4 + 2]
                    out[o + 3] = isDxt1(format)
                        ? colors[index * 4 + 3]
                        : alphas[i]
                }
            }
            p += blockSize
        }
    }
    return out
}

function halfToFloat(h) {
    const exponent = (h >> 10) & 31
    const mantissa = h & 1023
    const sign = h & 32768 ? -1 : 1
    if (exponent === 0) return sign * 2 ** -14 * (mantissa / 1024)
    if (exponent === 31) return mantissa ? NaN : sign * Infinity
    return sign * 2 ** (exponent - 15) * (1 + mantissa / 1024)
}

const toByte = (f) =>
    Number.isNaN(f) ? 0 : Math.max(0, Math.min(255, Math.round(f * 255)))

function decodeUncompressed(data, offset, width, height, format) {
    const out = Buffer.alloc(width * height * 4)
    const bpp = BYTES_PER_PIXEL[format]
    for (let i = 0; i < width * height; i++) {
        const s = offset + i * bpp
        const o = i * 4
        let r = 0
        let g = 0
        let b = 0
        let a = 255
        switch (format) {
            case FORMAT.RGBA8888:
            case FORMAT.UVWQ8888:
                r = data[s]
                g = data[s + 1]
                b = data[s + 2]
                a = data[s + 3]
                break
            case FORMAT.ABGR8888:
                a = data[s]
                b = data[s + 1]
                g = data[s + 2]
                r = data[s + 3]
                break
            case FORMAT.ARGB8888:
                a = data[s]
                r = data[s + 1]
                g = data[s + 2]
                b = data[s + 3]
                break
            case FORMAT.BGRA8888:
                b = data[s]
                g = data[s + 1]
                r = data[s + 2]
                a = data[s + 3]
                break
            case FORMAT.BGRX8888:
                b = data[s]
                g = data[s + 1]
                r = data[s + 2]
                break
            case FORMAT.UVLX8888:
                r = data[s]
                g = data[s + 1]
                b = data[s + 2]
                break
            case FORMAT.RGB888:
            case FORMAT.RGB888_BLUESCREEN:
                r = data[s]
                g = data[s + 1]
                b = data[s + 2]
                break
            case FORMAT.BGR888:
            case FORMAT.BGR888_BLUESCREEN:
                b = data[s]
                g = data[s + 1]
                r = data[s + 2]
                break
            case FORMAT.RGB565:
            case FORMAT.BGR565: {
                const v = data.readUInt16LE(s)
                const low = ((v & 31) << 3) | ((v & 31) >> 2)
                const mid = (((v >> 5) & 63) << 2) | (((v >> 5) & 63) >> 4)
                const high = (((v >> 11) & 31) << 3) | (((v >> 11) & 31) >> 2)
                g = mid
                if (format === FORMAT.RGB565) {
                    r = low
                    b = high
                } else {
                    b = low
                    r = high
                }
                break
            }
            case FORMAT.BGRA5551:
            case FORMAT.BGRX5551: {
                const v = data.readUInt16LE(s)
                const ch = (shift) =>
                    (((v >> shift) & 31) << 3) | (((v >> shift) & 31) >> 2)
                b = ch(0)
                g = ch(5)
                r = ch(10)
                if (format === FORMAT.BGRA5551) a = v & 32768 ? 255 : 0
                break
            }
            case FORMAT.BGRA4444: {
                const v = data.readUInt16LE(s)
                b = (v & 15) * 17
                g = ((v >> 4) & 15) * 17
                r = ((v >> 8) & 15) * 17
                a = ((v >> 12) & 15) * 17
                break
            }
            case FORMAT.I8:
                r = g = b = data[s]
                break
            case FORMAT.IA88:
                r = g = b = data[s]
                a = data[s + 1]
                break
            case FORMAT.A8:
                a = data[s]
                break
            case FORMAT.UV88:
                r = data[s]
                g = data[s + 1]
                break
            case FORMAT.RGBA16161616F:
                r = toByte(halfToFloat(data.readUInt16LE(s)))
                g = toByte(halfToFloat(data.readUInt16LE(s + 2)))
                b = toByte(halfToFloat(data.readUInt16LE(s + 4)))
                a = toByte(halfToFloat(data.readUInt16LE(s + 6)))
                break
            case FORMAT.RGBA16161616:
                r = data.readUInt16LE(s) >> 8
                g = data.readUInt16LE(s + 2) >> 8
                b = data.readUInt16LE(s + 4) >> 8
                a = data.readUInt16LE(s + 6) >> 8
                break
            case FORMAT.R32F:
                r = g = b = toByte(data.readFloatLE(s))
                break
            case FORMAT.RGB323232F:
                r = toByte(data.readFloatLE(s))
                g = toByte(data.readFloatLE(s + 4))
                b = toByte(data.readFloatLE(s + 8))
                break
            case FORMAT.RGBA32323232F:
                r = toByte(data.readFloatLE(s))
                g = toByte(data.readFloatLE(s + 4))
                b = toByte(data.readFloatLE(s + 8))
                a = toByte(data.readFloatLE(s + 12))
                break
            default:
                throw new Error(`Unsupported VTF image format ${format}`)
        }
        if (
            (format === FORMAT.RGB888_BLUESCREEN ||
                format === FORMAT.BGR888_BLUESCREEN) &&
            r === 0 &&
            g === 0 &&
            b === 255
        ) {
            a = 0
        }
        out[o] = r
        out[o + 1] = g
        out[o + 2] = b
        out[o + 3] = a
    }
    return out
}

/** Read width/height from a VTF header without decoding */
function readVtfSize(data) {
    if (data.length < 20 || data.toString("latin1", 0, 4) !== "VTF\0") {
        throw new Error("Not a VTF file")
    }
    return { width: data.readUInt16LE(16), height: data.readUInt16LE(18) }
}

/**
 * Decode the largest mipmap of the first frame/face/slice of a VTF
 * @param {Buffer} data
 * @returns {{width: number, height: number, rgba: Buffer}}
 */
function decodeVtf(data) {
    const { width, height } = readVtfSize(data)
    const major = data.readUInt32LE(4)
    const minor = data.readUInt32LE(8)
    if (major !== 7)
        throw new Error(`Unsupported VTF version ${major}.${minor}`)
    const headerSize = data.readUInt32LE(12)
    const flags = data.readUInt32LE(20)
    const frames = Math.max(1, data.readUInt16LE(24))
    const firstFrame = data.readUInt16LE(26)
    const format = data.readInt32LE(52)
    const mipCount = Math.max(1, data[56])
    const lowFormat = data.readInt32LE(57)
    const lowWidth = data[61]
    const lowHeight = data[62]
    const depth = minor >= 2 ? Math.max(1, data.readUInt16LE(63)) : 1

    const ENVMAP = 0x4000
    let faces = 1
    if (flags & ENVMAP) faces = minor < 5 && firstFrame !== 0xffff ? 7 : 6

    let offset
    if (minor >= 3) {
        const resourceCount = data.readUInt32LE(68)
        offset = -1
        for (let i = 0; i < resourceCount; i++) {
            const at = 80 + i * 8
            const tag = data.toString("latin1", at, at + 3)
            if (tag === "AXC")
                throw new Error("Compressed (Strata) VTFs are not supported")
            if (tag === "\x30\0\0") offset = data.readUInt32LE(at + 4)
        }
        if (offset === -1) throw new Error("VTF has no high-resolution image")
    } else {
        offset = headerSize
        if (lowFormat !== -1 && lowWidth && lowHeight) {
            offset += imageSize(lowFormat, lowWidth, lowHeight)
        }
    }

    // Mipmaps are stored smallest first; skip to the full-size one
    for (let mip = mipCount - 1; mip >= 1; mip--) {
        const w = Math.max(1, width >> mip)
        const h = Math.max(1, height >> mip)
        const d = Math.max(1, depth >> mip)
        offset += imageSize(format, w, h) * frames * faces * d
    }

    if (offset + imageSize(format, width, height) > data.length) {
        throw new Error("VTF image data is truncated")
    }

    const rgba =
        isDxt1(format) || format === FORMAT.DXT3 || format === FORMAT.DXT5
            ? decodeDxt(data, offset, width, height, format)
            : decodeUncompressed(data, offset, width, height, format)
    return { width, height, rgba }
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
    const table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
        let c = n
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        table[n] = c >>> 0
    }
    return table
})()

function crc32(buffer) {
    let c = 0xffffffff
    for (let i = 0; i < buffer.length; i++) {
        c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
    }
    return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc32(body), body.length + 4)
    return out
}

/**
 * Encode RGBA pixels as a PNG
 * @param {number} width
 * @param {number} height
 * @param {Buffer} rgba - width * height * 4 bytes
 * @param {boolean} withAlpha - Keep the alpha channel (RGBA) or drop it (RGB)
 */
function encodePng(width, height, rgba, withAlpha) {
    const channels = withAlpha ? 4 : 3
    const stride = width * channels + 1
    const raw = Buffer.alloc(stride * height)
    for (let y = 0; y < height; y++) {
        let o = y * stride + 1
        let s = y * width * 4
        for (let x = 0; x < width; x++, s += 4) {
            raw[o++] = rgba[s]
            raw[o++] = rgba[s + 1]
            raw[o++] = rgba[s + 2]
            if (withAlpha) raw[o++] = rgba[s + 3]
        }
    }

    const header = Buffer.alloc(13)
    header.writeUInt32BE(width, 0)
    header.writeUInt32BE(height, 4)
    header[8] = 8 // bit depth
    header[9] = withAlpha ? 6 : 2 // color type
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk("IHDR", header),
        pngChunk("IDAT", zlib.deflateSync(raw)),
        pngChunk("IEND", Buffer.alloc(0)),
    ])
}

module.exports = {
    parseVmt,
    describeMaterial,
    evaluateMaterialCondition,
    normalizeTexturePath,
    decodeVtf,
    readVtfSize,
    encodePng,
    FORMAT,
}
