/**
 * A package's config groups: info.json's ConfigGroup, the widgets players
 * set in BEE2's ItemVar menu, which conditions read with GetItemConfig (Get
 * Config blocks). The Package Config window edits them as plain objects
 * (readConfigGroups), written back with withConfigGroups. Keys BeePEE doesn't
 * edit stay as they were, and so do widgets of types it doesn't edit (item
 * variants).
 *
 * As BEE2 4.46.1 reads them:
 *
 *   "ConfigGroup"
 *   {
 *       "ID" "SPEEDS"              GetItemConfig's ID, as it's written
 *       "Name" "Speeds"
 *       "Description" "..."
 *       "Widget"
 *       {
 *           "ID" "speed"           GetItemConfig's Name (casefolded)
 *           "Label" "Speed"
 *           "Type" "slider"
 *           "Tooltip" "..."
 *           "UseTimer" "1"         a value for each timer value, 3 to 30
 *           "HasInf" "1"           and one for an infinite timer
 *           "Min" "0"
 *           "Max" "10"
 *           "Default" "5"          or each one's: { "3" "5" ... "30" "5" }
 *       }
 *   }
 */

/** The widget types BeePEE edits, with each one's names BEE2 takes */
const WIDGET_TYPES = {
    checkbox: ["checkbox", "boolean", "bool"],
    dropdown: ["dropdown"],
    slider: ["slider", "range"],
    string: ["string", "str", "text"],
    color: ["color", "colour", "rgb"],
    timer: ["timer", "minuteseconds"],
}

/** The timer values a timer widget has a value for */
const TIMER_VALUES = Array.from({ length: 28 }, (_, i) => String(i + 3))

/** An infinite timer's value (HasInf) */
const INFINITE = "inf"

/** Keys of a group and of a widget BeePEE edits (lowercase) */
const GROUP_KEYS = new Set(["id", "name", "description", "widget"])
const WIDGET_KEYS = new Set([
    "id",
    "label",
    "type",
    "tooltip",
    "usetimer",
    "hasinf",
    "default",
    "options",
    "min",
    "max",
    "step",
    "zerooff",
])

/** A JSON value that may be one entry or a list of them, as a list */
const asList = (value) =>
    value === undefined || value === null ? [] : [value].flat()

/** A list back as JSON writes repeated keys: one entry on its own */
const fromList = (list) => (list.length === 1 ? list[0] : list)

/** An object's key, whatever its case ("ConfigGroup", "configgroup") */
const keyOf = (object, key) =>
    Object.keys(object ?? {}).find((k) => k.toLowerCase() === key.toLowerCase())

/** A key's value, whatever the key's case */
const valueOf = (object, key) =>
    object && typeof object === "object"
        ? object[keyOf(object, key)]
        : undefined

/** A keyvalues boolean ("1", "true", ...) */
const isOn = (value) => /^(1|true|yes|on)$/i.test(String(value ?? "").trim())

/** The canonical type of a widget's Type, or null for one BeePEE doesn't edit */
function typeOf(name) {
    const lower = String(name ?? "").toLowerCase()
    return (
        Object.keys(WIDGET_TYPES).find((type) =>
            WIDGET_TYPES[type].includes(lower),
        ) ?? null
    )
}

/**
 * Text written as a string, or as lines (a block of "" keys, read as
 * "desc_N"), like a description
 */
function textOf(value) {
    if (value === undefined || value === null) return ""
    if (Array.isArray(value)) return value.map(textOf).join("\n")
    if (typeof value === "object") {
        return Object.keys(value)
            .filter((key) => key.startsWith("desc_"))
            .sort((a, b) => parseInt(a.slice(5), 10) - parseInt(b.slice(5), 10))
            .map((key) => String(value[key] ?? ""))
            .join("\n")
    }
    return String(value)
}

/** Text as keyvalues has it: a string, or lines when it has several */
function textValue(text) {
    const lines = String(text ?? "").split(/\r?\n/)
    if (lines.length === 1) return lines[0]
    return Object.fromEntries(lines.map((line, i) => [`desc_${i}`, line]))
}

/** The keys of an object BeePEE doesn't edit, as they are */
const extraOf = (object, known) =>
    Object.fromEntries(
        Object.entries(object ?? {}).filter(
            ([key]) => !known.has(key.toLowerCase()),
        ),
    )

/** A widget as the Package Config window edits it */
function readWidget(widget) {
    const typeName = String(valueOf(widget, "Type") ?? "")
    const type = typeOf(typeName)
    const base = {
        id: String(valueOf(widget, "ID") ?? ""),
        label: textOf(valueOf(widget, "Label")),
        type,
        typeName,
    }
    // Item variants and types BEE2 adds later: kept as they are
    if (!type) return { ...base, raw: widget }

    const timer = isOn(valueOf(widget, "UseTimer"))
    const inf = timer && isOn(valueOf(widget, "HasInf"))
    const def = valueOf(widget, "Default")
    const single =
        def && typeof def === "object"
            ? String(valueOf(def, "3") ?? Object.values(def)[0] ?? "")
            : String(def ?? "")
    const read = {
        ...base,
        tooltip: textOf(valueOf(widget, "Tooltip")),
        timer,
        inf,
        default: single,
        extra: extraOf(widget, WIDGET_KEYS),
    }
    if (timer) {
        // Each timer value's (one written for all is each one's)
        const each = (value) =>
            def && typeof def === "object"
                ? String(valueOf(def, value) ?? "")
                : single
        read.defaults = Object.fromEntries(
            [...(inf ? [INFINITE] : []), ...TIMER_VALUES].map((value) => [
                value,
                each(value),
            ]),
        )
    }
    if (type === "dropdown") {
        const options = valueOf(widget, "Options")
        read.options =
            options && typeof options === "object"
                ? Object.entries(options).map(([id, label]) => ({
                      id,
                      label: textOf(label),
                  }))
                : []
    }
    if (type === "slider" || type === "timer") {
        for (const key of ["Min", "Max"]) {
            const value = valueOf(widget, key)
            read[key.toLowerCase()] = value === undefined ? "" : String(value)
        }
    }
    if (type === "slider") {
        const step = valueOf(widget, "Step")
        read.step = step === undefined ? "" : String(step)
        read.zeroOff = isOn(valueOf(widget, "ZeroOff"))
    }
    return read
}

/**
 * A config group as the Package Config window edits it, with the one
 * info.json has (raw): written back as it was when it isn't changed
 */
function readGroup(group) {
    return {
        id: String(valueOf(group, "ID") ?? ""),
        name: textOf(valueOf(group, "Name")),
        description: textOf(valueOf(group, "Description")),
        widgets: asList(valueOf(group, "Widget"))
            .filter((widget) => widget && typeof widget === "object")
            .map(readWidget),
        extra: extraOf(group, GROUP_KEYS),
        raw: group,
    }
}

/** A package's config groups, as the Package Config window edits them */
function readConfigGroups(info) {
    return asList(valueOf(info, "ConfigGroup"))
        .filter((group) => group && typeof group === "object")
        .map(readGroup)
}

/** What a group has, but not as info.json had it */
const contentOf = (group) =>
    JSON.stringify(group, (key, value) => (key === "raw" ? undefined : value))

/** A widget as info.json has it */
function writeWidget(widget) {
    if (!widget.type) return widget.raw
    const written = {
        ID: widget.id,
        // The name it had, unless it's another type now
        Type:
            typeOf(widget.typeName) === widget.type
                ? widget.typeName
                : widget.type,
    }
    // BEE2 shows the ID without one
    if (widget.label) written.Label = widget.label
    if (widget.tooltip) written.Tooltip = textValue(widget.tooltip)
    const timer = Boolean(widget.timer)
    const inf = timer && Boolean(widget.inf)
    if (timer) written.UseTimer = "1"
    if (inf) written.HasInf = "1"
    if (widget.type === "dropdown") {
        written.Options = Object.fromEntries(
            (widget.options ?? []).map((option) => [
                option.id,
                option.label || option.id,
            ]),
        )
    }
    if (widget.type === "slider" || widget.type === "timer") {
        if (widget.min !== "" && widget.min !== undefined)
            written.Min = widget.min
        if (widget.max !== "" && widget.max !== undefined)
            written.Max = widget.max
    }
    if (widget.type === "slider") {
        if (widget.step !== "" && widget.step !== undefined) {
            written.Step = widget.step
        }
        if (widget.zeroOff) written.ZeroOff = "1"
    }
    if (timer) {
        // Each timer value's, or one when they're all the same
        const values = [...(inf ? [INFINITE] : []), ...TIMER_VALUES]
        const each = (value) =>
            String(widget.defaults?.[value] ?? widget.default ?? "")
        written.Default = values.every((value) => each(value) === each("3"))
            ? each("3")
            : Object.fromEntries(values.map((value) => [value, each(value)]))
    } else {
        written.Default = String(widget.default ?? "")
    }
    return { ...written, ...widget.extra }
}

/** A config group as info.json has it: as it was, unless it's changed */
function writeGroup(group) {
    if (group.raw && contentOf(readGroup(group.raw)) === contentOf(group)) {
        return group.raw
    }
    // BEE2 can't load a group without a name
    const written = { ID: group.id, Name: group.name || group.id }
    if (group.description) written.Description = textValue(group.description)
    Object.assign(written, group.extra)
    const widgets = (group.widgets ?? []).map(writeWidget).filter(Boolean)
    if (widgets.length > 0) written.Widget = fromList(widgets)
    return written
}

/**
 * A package's info.json with these config groups (as the Package Config
 * window edits them) in place of its own
 * @returns {Object} The info, changed in place
 */
function withConfigGroups(info, groups) {
    const key = keyOf(info, "ConfigGroup") ?? "ConfigGroup"
    const written = groups.map(writeGroup)
    if (written.length > 0) info[key] = fromList(written)
    else delete info[key]
    return info
}

/** What's wrong with config groups that BEE2 can't load, or [] */
function configGroupErrors(groups) {
    const errors = []
    const groupIds = new Set()
    for (const group of groups) {
        const id = String(group.id ?? "").trim()
        if (!id) {
            errors.push("A config group has no ID")
            continue
        }
        if (groupIds.has(id.toLowerCase())) {
            errors.push(`Two config groups have the ID ${id}`)
        }
        groupIds.add(id.toLowerCase())
        // BEE2 fails to load a package with two widgets of one ID in a group
        const widgetIds = new Set()
        for (const widget of group.widgets ?? []) {
            const widgetId = String(widget.id ?? "").trim()
            if (!widgetId) {
                errors.push(`A widget of config group ${id} has no ID`)
                continue
            }
            if (widgetIds.has(widgetId.toLowerCase())) {
                errors.push(
                    `Config group ${id} has two widgets with the ID ${widgetId}`,
                )
            }
            widgetIds.add(widgetId.toLowerCase())
        }
    }
    return errors
}

module.exports = {
    INFINITE,
    TIMER_VALUES,
    WIDGET_TYPES,
    configGroupErrors,
    readConfigGroups,
    withConfigGroups,
}
