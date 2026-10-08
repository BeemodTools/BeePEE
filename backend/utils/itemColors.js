/**
 * An item's colors (its Color variable): color widgets in the item's own
 * config group in the package's info.json, which BEE2 shows in its ItemVar
 * menu for players to pick. Set Color blocks put one into a fixup with
 * BEE2's GetItemConfig ("color3", or "color$timer_delay" for the one
 * matching a fixup's value).
 *
 *   "ConfigGroup"
 *   {
 *       "ID" "<ITEM_ID>"
 *       "Name" "<item name>"
 *       "Widget" { "ID" "color1" "Label" "Color 1" "Type" "color" "Default" "25 25 230" }
 *       ...
 *   }
 */

/** How many colors an item can have: one per timer value */
const MAX_COLORS = 30

/** Each color's default until players pick their own: all different */
const DEFAULT_COLORS = [
    "25 25 230",
    "230 25 25",
    "25 230 25",
    "230 230 25",
    "230 25 230",
    "25 230 230",
    "230 230 230",
    "25 25 25",
    "128 128 128",
    "25 25 128",
    "25 128 25",
    "25 128 128",
    "25 128 230",
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
    "230 128 25",
    "230 128 128",
    "230 128 230",
    "230 230 128",
    "32 192 32",
    "255 160 0",
    "160 64 255",
]

/** The widget of color n (from 1) */
const colorWidgetId = (n) => `color${n}`

const COLOR_WIDGET = /^color(\d+)$/i

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

/** The item's config group in a package's info.json, or undefined */
function itemGroup(info, itemId) {
    return asList(info?.ConfigGroup).find(
        (group) =>
            String(valueOf(group, "ID") ?? "").toLowerCase() ===
            String(itemId).toLowerCase(),
    )
}

/**
 * How many colors an item has: its config group's color widgets, color1
 * up without a gap
 */
function colorCount(info, itemId) {
    const group = itemGroup(info, itemId)
    const ids = new Set(
        asList(valueOf(group, "Widget")).map((widget) =>
            String(valueOf(widget, "ID") ?? "").toLowerCase(),
        ),
    )
    let count = 0
    while (count < MAX_COLORS && ids.has(colorWidgetId(count + 1))) count++
    return count
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

/** A color's default ("25 25 230") */
const defaultColor = (n) =>
    DEFAULT_COLORS[(Math.max(1, n) - 1) % DEFAULT_COLORS.length]

/**
 * A package's info.json with the item's colors set to `count` (0 takes
 * them out). Other widgets in the item's group, and other groups, stay; a
 * color that was there keeps how it was written.
 * @returns {Object} The info, changed in place
 */
function withColors(info, { itemId, itemName, count }) {
    const total = Math.max(0, Math.min(MAX_COLORS, Math.round(count || 0)))
    const groups = asList(info.ConfigGroup)
    let group = itemGroup(info, itemId)
    if (!group) {
        if (total === 0) return info
        // BEE2 needs a group's name: it heads the group in the menu
        group = { ID: itemId, Name: itemName || itemId }
        groups.push(group)
    }
    // Named after the item while it has colors (a group of only other
    // widgets keeps its name)
    if (itemName && total > 0) group.Name = itemName

    const widgetsKey =
        Object.keys(group).find((k) => k.toLowerCase() === "widget") ?? "Widget"
    const widgets = asList(group[widgetsKey])
    const kept = widgets.filter(
        (widget) => !COLOR_WIDGET.test(String(valueOf(widget, "ID") ?? "")),
    )
    const existing = new Map(
        widgets
            .filter((widget) =>
                COLOR_WIDGET.test(String(valueOf(widget, "ID") ?? "")),
            )
            .map((widget) => [
                String(valueOf(widget, "ID")).toLowerCase(),
                widget,
            ]),
    )
    const colors = []
    for (let n = 1; n <= total; n++) {
        colors.push(
            existing.get(colorWidgetId(n)) ?? {
                ID: colorWidgetId(n),
                Label: total === 1 ? "Color" : `Color ${n}`,
                Type: "color",
                Default: defaultColor(n),
            },
        )
    }

    const all = [...colors, ...kept]
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
    MAX_COLORS,
    colorWidgetId,
    colorCount,
    colorGroupId,
    defaultColor,
    withColors,
}
