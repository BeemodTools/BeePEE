/**
 * An item's colors (its Color variable): one for each timer value BEE2 has
 * one for, like its Cube Coloriser. backend/utils/itemColors.js writes them.
 */

/** The timer values with a color: BEE2's 3 to 30 */
export const COLOR_TIMERS = Array.from({ length: 28 }, (_, i) => String(i + 3))

/**
 * A color nobody set: the background of BEE2's ItemVar menu, so its swatch
 * looks empty there
 */
export const EMPTY_COLOR = "240 240 240"

/** Each timer value's color until the item sets its own: empty */
export const DEFAULT_TIMER_COLORS = Object.fromEntries(
    COLOR_TIMERS.map((timer) => [timer, EMPTY_COLOR]),
)

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

/** Whether a color is the empty one (nobody set it) */
export const isEmptyColor = (rgb) => rgbToHex(rgb) === rgbToHex(EMPTY_COLOR)
