/**
 * Colors as BEE2 saves them ("255 128 0"), for color widgets (Package
 * Config) and BeePEE's color picker
 */

/**
 * Colors to start from in the color picker: BEE2's Cube Coloriser's, with
 * the portals' blue and orange in place of its nearest two
 */
export const PRESET_COLORS = [
    "25 25 230",
    "230 25 25",
    "25 230 25",
    "230 230 25",
    "230 25 230",
    "25 230 230",
    "25 25 25",
    "128 128 128",
    "230 230 230",
    "25 25 128",
    "25 128 25",
    "25 128 128",
    "2 114 210", // Portal 1: #0272d2, the blue portal
    "25 230 128",
    "128 25 25",
    "128 25 128",
    "128 25 230",
    "128 128 25",
    "128 128 230",
    "128 230 25",
    "128 230 128",
    "128 230 230",
    "230 25 128",
    "252 131 0", // Portal 2: #fc8300, the orange portal
    "230 128 128",
    "230 128 230",
    "230 230 128",
    "32 192 32",
].map(rgbToHex)

/** "255 128 0" (how BEE2 saves colors) as "#ff8000" */
export function rgbToHex(rgb) {
    const parts = String(rgb ?? "")
        .trim()
        .split(/\s+/)
        .map(Number)
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
        return "#000000"
    }
    return `#${parts
        .map((n) =>
            Math.min(255, Math.max(0, Math.round(n)))
                .toString(16)
                .padStart(2, "0"),
        )
        .join("")}`
}

/** "#ff8000" as "255 128 0" */
export const hexToRgb = (hex) =>
    [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(" ")
