/**
 * The colors of BeePEE 1.2.0's Color variable: a timer color widget in a
 * config group of the item's own (its ID the item's), which its Set Color
 * blocks put into a fixup with BEE2's GetItemConfig ("color[$timer_delay]").
 * Colors are color widgets of Package Config's groups now, read with Get
 * Config blocks: a Set Color block opens as one that writes what it did, and
 * the group stays, one of the package's.
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
 * looks empty there (Set Color blocks' default)
 */
const EMPTY_COLOR = "240 240 240"

/** A JSON value that may be one entry or a list of them, as a list */
const asList = (value) =>
    value === undefined || value === null ? [] : [value].flat()

/** A key's value whatever its case ("ID", "id") */
const valueOf = (object, key) => {
    const found = Object.keys(object ?? {}).find(
        (k) => k.toLowerCase() === key.toLowerCase(),
    )
    return found === undefined ? undefined : object[found]
}

/**
 * The ID of the item's config group as info.json has it, or the item's ID
 * without one. GetItemConfig has to match it exactly: BEE2 keeps the
 * players' colors under the group's ID as written.
 */
function colorGroupId(info, itemId) {
    const group = asList(valueOf(info, "ConfigGroup")).find(
        (each) =>
            String(valueOf(each, "ID") ?? "").toLowerCase() ===
            String(itemId).toLowerCase(),
    )
    return group ? String(valueOf(group, "ID")) : itemId
}

module.exports = {
    COLOR_WIDGET,
    FIRST_TIMER,
    LAST_TIMER,
    EMPTY_COLOR,
    colorGroupId,
}
