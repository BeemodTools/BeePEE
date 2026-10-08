/**
 * An item's colors (its Color variable): one for each timer value BEE2 has
 * one for, like its Cube Coloriser. backend/utils/itemColors.js writes them.
 */

/** The timer values with a color: BEE2's 3 to 30 */
export const COLOR_TIMERS = Array.from({ length: 28 }, (_, i) => String(i + 3))

/** Each one's default color unless the item sets its own: the Cube Coloriser's */
export const DEFAULT_TIMER_COLORS = {
    3: "25 25 230",
    4: "230 25 25",
    5: "25 230 25",
    6: "230 230 25",
    7: "230 25 230",
    8: "25 230 230",
    9: "25 25 25",
    10: "128 128 128",
    11: "230 230 230",
    12: "25 25 128",
    13: "25 128 25",
    14: "25 128 128",
    15: "25 128 230",
    16: "25 230 128",
    17: "128 25 25",
    18: "128 25 128",
    19: "128 25 230",
    20: "128 128 25",
    21: "128 128 230",
    22: "128 230 25",
    23: "128 230 128",
    24: "128 230 230",
    25: "230 25 128",
    26: "230 128 25",
    27: "230 128 128",
    28: "230 128 230",
    29: "230 230 128",
    30: "32 192 32",
}

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
