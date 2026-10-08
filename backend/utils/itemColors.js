/**
 * An item's colors (its Color variable): a color for each timer value, 3 to
 * 30, that players pick in BEE2's ItemVar menu, like BEE2's Cube Coloriser.
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
 *           "Default" { "3" "25 25 230" ... "30" "32 192 32" }
 *       }
 *   }
 */

/** The widget the colors are */
const COLOR_WIDGET = "color"

/** The timer values that have a color */
const FIRST_TIMER = 3
const LAST_TIMER = 30

/** Each timer value's color until players pick their own: the Cube Coloriser's */
const DEFAULT_COLORS = {
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
 * A package's info.json with the item's colors in it, or taken out. Other
 * widgets in the item's group, and other groups, stay; colors that were
 * there keep how they were written. The group goes by the item's name
 * unless it has other widgets too.
 * @returns {Object} The info, changed in place
 */
function withColors(info, { itemId, itemName, on }) {
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
    DEFAULT_COLORS,
    hasColors,
    colorGroupId,
    withColors,
}
