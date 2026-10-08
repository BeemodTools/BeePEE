/**
 * An item's colors (its Color variable): a color for each timer value, 3 to
 * 30, that players pick in BEE2's ItemVar menu, like BEE2's Cube Coloriser.
 * The item sets the ones they start with (its Default Colors window).
 * It's a timer color widget in the item's own config group in the package's
 * info.json. (A color widget without UseTimer never shows its swatch in
 * BEE2's menu, and one with HasInf fails to show at all, as of BEE2 4.46.1.)
 * Set Color blocks put a color into a fixup with BEE2's GetItemConfig:
 * "color[$timer_delay]" is the one for the timer's value.
 *
 *   "ConfigGroup"
 *   {
 *       "ID" "<ITEM_ID>"
 *       "Name" "<item name> - Color"
 *       "Widget"
 *       {
 *           "ID" "color"
 *           "Label" "Color"
 *           "Type" "color"
 *           "UseTimer" "1"
 *           "Default" { "3" "240 240 240" ... "30" "240 240 240" }
 *       }
 *   }
 */

/** The widget the colors are */
const COLOR_WIDGET = "color"

/** The timer values that have a color */
const FIRST_TIMER = 3
const LAST_TIMER = 30

/**
 * A color nobody set: the background of BEE2's ItemVar menu, so its swatch
 * looks empty there (src/utils/timerColors.js has it too)
 */
const EMPTY_COLOR = "240 240 240"

/** Each timer value's color until the item sets its own: empty */
const DEFAULT_COLORS = Object.fromEntries(
    Array.from({ length: LAST_TIMER - FIRST_TIMER + 1 }, (_, i) => [
        String(FIRST_TIMER + i),
        EMPTY_COLOR,
    ]),
)

/** A JSON value that may be one entry or a list of them, as a list */
const asList = (value) =>
    value === undefined || value === null ? [] : [value].flat()

/** A list back as JSON writes repeated keys: one entry on its own */
const fromList = (list) => (list.length === 1 ? list[0] : list)

/** A key's value whatever its case ("ID", "id") */
const valueOf = (object, key) => {
    const found = Object.keys(object ?? {}).find(
        (k) => k.toLowerCase() === key.toLowerCase(),
    )
    return found === undefined ? undefined : object[found]
}

const widgetId = (widget) => String(valueOf(widget, "ID") ?? "").toLowerCase()

/** BeePEE's colors: the timer widget, or 1.2.0-beta.5 dev builds' color1.. */
const isColorWidget = (widget) =>
    widgetId(widget) === COLOR_WIDGET ||
    (/^color\d+$/.test(widgetId(widget)) &&
        /^(color|colour|rgb)$/i.test(String(valueOf(widget, "Type") ?? "")))

/** The item's config group in a package's info.json, or undefined */
function itemGroup(info, itemId) {
    return asList(info?.ConfigGroup).find(
        (group) =>
            String(valueOf(group, "ID") ?? "").toLowerCase() ===
            String(itemId).toLowerCase(),
    )
}

/** Whether the item has colors: its config group's timer color widget */
function hasColors(info, itemId) {
    return asList(valueOf(itemGroup(info, itemId), "Widget")).some(
        (widget) => widgetId(widget) === COLOR_WIDGET,
    )
}

/**
 * The ID of the item's config group as info.json has it, or the item's ID
 * without one. GetItemConfig has to match it exactly: BEE2 keeps the
 * players' colors under the group's ID as written.
 */
function colorGroupId(info, itemId) {
    const group = itemGroup(info, itemId)
    return group ? String(valueOf(group, "ID")) : itemId
}

/** The group's name: the item's, so the ItemVar menu says whose it is */
const groupName = (itemName) => `${itemName} - Color`

/**
 * A color as BEE2 saves players' picks ("255 128 0"), from that or
 * "#ff8000" (BEE2 reads both), or null when it's neither
 */
function rgbOf(value) {
    const text = String(value ?? "").trim()
    const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(text)
    const parts = hex
        ? hex.slice(1).map((part) => parseInt(part, 16))
        : text.split(/\s+/).map(Number)
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
        return null
    }
    return parts.map((n) => Math.min(255, Math.max(0, Math.round(n)))).join(" ")
}

/**
 * Every timer value's default color: `colors`' (an object of timer value
 * to color, or one color for all), and empty for the rest
 */
function fullColors(colors) {
    const each = (timer) =>
        rgbOf(
            colors && typeof colors === "object"
                ? valueOf(colors, String(timer))
                : colors,
        ) ?? DEFAULT_COLORS[timer]
    return Object.fromEntries(
        Object.keys(DEFAULT_COLORS).map((timer) => [timer, each(timer)]),
    )
}

/** The item's default colors (each timer value's), as info.json has them */
function colorDefaults(info, itemId) {
    const widget = asList(valueOf(itemGroup(info, itemId), "Widget")).find(
        (each) => widgetId(each) === COLOR_WIDGET,
    )
    return fullColors(valueOf(widget, "Default"))
}

/**
 * A package's info.json with the item's colors in it, or taken out. Other
 * widgets in the item's group, and other groups, stay; colors that were
 * there keep how they were written, but their defaults are `defaults` when
 * given (each timer value's color). The group goes by the item's name
 * unless it has other widgets too.
 * @returns {Object} The info, changed in place
 */
function withColors(info, { itemId, itemName, on, defaults }) {
    const groups = asList(info.ConfigGroup)
    let group = itemGroup(info, itemId)
    if (!group) {
        if (!on) return info
        group = { ID: itemId, Name: groupName(itemName || itemId) }
        groups.push(group)
    }

    const widgetsKey =
        Object.keys(group).find((k) => k.toLowerCase() === "widget") ?? "Widget"
    const widgets = asList(group[widgetsKey])
    const kept = widgets.filter((widget) => !isColorWidget(widget))
    const color = on
        ? (widgets.find((widget) => widgetId(widget) === COLOR_WIDGET) ?? {
              ID: COLOR_WIDGET,
              Label: "Color",
              Type: "color",
              UseTimer: "1",
              Default: { ...DEFAULT_COLORS },
          })
        : null
    if (color && defaults) {
        const key =
            Object.keys(color).find((k) => k.toLowerCase() === "default") ??
            "Default"
        color[key] = fullColors(defaults)
    }
    if (on && itemName && kept.length === 0) group.Name = groupName(itemName)

    const all = color ? [color, ...kept] : kept
    if (all.length > 0) {
        group[widgetsKey] = fromList(all)
    } else {
        // Nothing left in it: the group goes
        groups.splice(groups.indexOf(group), 1)
    }
    if (groups.length > 0) info.ConfigGroup = fromList(groups)
    else delete info.ConfigGroup
    return info
}

module.exports = {
    COLOR_WIDGET,
    FIRST_TIMER,
    LAST_TIMER,
    EMPTY_COLOR,
    DEFAULT_COLORS,
    hasColors,
    colorDefaults,
    colorGroupId,
    withColors,
}
