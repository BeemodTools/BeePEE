const fs = require("fs")
const path = require("path")

const TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
}

/**
 * An image file as a data URL, for windows to show: a VTF (an item's palette
 * texture) as a PNG
 */
function imageDataUrl(file) {
    const bytes = fs.readFileSync(file)
    const ext = path.extname(file).toLowerCase()
    if (ext === ".vtf") {
        const {
            decodeVtf,
            encodePng,
        } = require("./vmfConverter/textures")
        const { width, height, rgba } = decodeVtf(bytes)
        const png = encodePng(width, height, rgba, true)
        return `data:image/png;base64,${png.toString("base64")}`
    }
    return `data:${TYPES[ext] ?? "image/png"};base64,${bytes.toString("base64")}`
}

module.exports = { imageDataUrl }
