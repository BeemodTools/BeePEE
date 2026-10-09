/**
 * The package's config groups (Package Config) as the window and Get Config
 * blocks have them: backend/utils/configGroups.js reads and writes them. A
 * widget is one setting players change in BEE2's ItemVar menu.
 */

/** The widget types, as the window names them */
export const WIDGET_TYPES = {
    checkbox: "Checkbox",
    dropdown: "Dropdown",
    slider: "Slider",
    string: "Text",
    color: "Color",
    timer: "Time (min:sec)",
}

/** The timer values a timer widget has a value for: BEE2's 3 to 30 */
export const TIMER_VALUES = Array.from({ length: 28 }, (_, i) => String(i + 3))

/** An infinite timer's value (a widget with one) */
export const INFINITE = "inf"

/** The timer values a widget has a value for (none: it has one) */
export const timerValuesOf = (widget) =>
    widget?.timer ? [...(widget.inf ? [INFINITE] : []), ...TIMER_VALUES] : []

/** What BEE2 gives a widget without a value set: a new one's */
export const NEW_DEFAULTS = {
    checkbox: "0",
    dropdown: "",
    slider: "0",
    string: "",
    color: "255 255 255",
    timer: "0",
}

/** Whether a type's value field shows its label (a swatch or a checkbox doesn't) */
export const labelsItself = (type) => !["color", "checkbox"].includes(type)

/** A widget's default: its one, or timer 3's */
export const defaultOf = (widget) =>
    widget?.timer ? (widget.defaults?.["3"] ?? "") : (widget?.default ?? "")

/** An ID made from a name: "Light Color" as LIGHT_COLOR, or light_color */
export function idFrom(name, { upper = false } = {}) {
    const id = String(name ?? "")
        .trim()
        .replace(/[^A-Za-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
    return upper ? id.toUpperCase() : id.toLowerCase()
}

/** `id`, or with a number after it when `taken` has it (case-insensitive) */
export function freeId(id, taken) {
    const has = (each) =>
        [...taken].some((other) => other.toLowerCase() === each.toLowerCase())
    if (!has(id)) return id
    let n = 2
    while (has(`${id}_${n}`)) n++
    return `${id}_${n}`
}

/** IDs BEE2 and GetItemConfig read without trouble */
const ID_PATTERN = /^[A-Za-z0-9_-]+$/

/** "90" seconds as "1:30" */
export const minutesSeconds = (seconds) => {
    const total = Math.max(0, Math.round(Number(seconds) || 0))
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`
}

const isNumber = (value) =>
    String(value ?? "").trim() !== "" && Number.isFinite(Number(value))

/** What's wrong with a value for a widget, or null */
export function valueError(widget, value) {
    const text = String(value ?? "")
    switch (widget.type) {
        case "checkbox":
            return text === "0" || text === "1" ? null : "Not on or off"
        case "dropdown":
            return (widget.options ?? []).some((option) => option.id === text)
                ? null
                : "Not one of its options"
        case "slider":
            return isNumber(text) ? null : "Not a number"
        case "timer":
            return /^\d+$/.test(text.trim()) ? null : "Not a number of seconds"
        case "color": {
            const parts = text.trim().split(/\s+/).map(Number)
            return parts.length === 3 &&
                parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
                ? null
                : 'Not a color ("R G B")'
        }
        default:
            return null
    }
}

/**
 * What's wrong with the groups: errors BEE2 can't load the package with (or
 * Get Config blocks can't read), and warnings, each with where it is
 * @returns {{type: "error"|"warning", message: string, group: number, widget?: number, field?: string}[]}
 */
export function configProblems(groups) {
    const problems = []
    const groupIds = new Set()
    groups.forEach((group, g) => {
        const add = (type, message, more = {}) =>
            problems.push({ type, message, group: g, ...more })
        const id = String(group.id ?? "").trim()
        if (!id) add("error", "It needs an ID", { field: "id" })
        else if (groupIds.has(id.toLowerCase())) {
            add("error", `Another group has the ID ${id}`, { field: "id" })
        } else if (group.isNew && !ID_PATTERN.test(id)) {
            add("error", "Its ID can only have letters, numbers, _ and -", {
                field: "id",
            })
        }
        groupIds.add(id.toLowerCase())
        if (!String(group.name ?? "").trim()) {
            add("error", "It needs a name (BEE2 shows it)", { field: "name" })
        }

        const widgetIds = new Set()
        ;(group.widgets ?? []).forEach((widget, w) => {
            if (!widget.type) return
            const addWidget = (type, message, field) =>
                add(type, message, { widget: w, field })
            const widgetId = String(widget.id ?? "").trim()
            if (!widgetId) addWidget("error", "It needs an ID", "id")
            else if (widgetIds.has(widgetId.toLowerCase())) {
                addWidget(
                    "error",
                    `Another widget of the group has the ID ${widgetId}`,
                    "id",
                )
            } else if (widget.isNew && !ID_PATTERN.test(widgetId)) {
                addWidget(
                    "error",
                    "Its ID can only have letters, numbers, _ and -",
                    "id",
                )
            }
            widgetIds.add(widgetId.toLowerCase())

            if (widget.type === "dropdown") {
                const options = widget.options ?? []
                if (options.length === 0) {
                    addWidget("error", "It needs an option", "options")
                }
                const optionIds = new Set()
                for (const option of options) {
                    const optionId = String(option.id ?? "").trim()
                    if (!optionId) {
                        addWidget("error", "An option has no ID", "options")
                    } else if (optionIds.has(optionId)) {
                        addWidget(
                            "error",
                            `Two options have the ID ${optionId}`,
                            "options",
                        )
                    }
                    optionIds.add(optionId)
                }
            }
            if (widget.type === "slider" || widget.type === "timer") {
                const min = widget.min === "" ? 0 : Number(widget.min)
                const max =
                    widget.max === ""
                        ? widget.type === "timer"
                            ? 60
                            : 100
                        : Number(widget.max)
                if (!Number.isFinite(min) || !Number.isFinite(max)) {
                    addWidget(
                        "error",
                        "Its minimum and maximum must be numbers",
                        "range",
                    )
                } else if (min > max) {
                    addWidget(
                        "error",
                        "Its minimum is over its maximum",
                        "range",
                    )
                }
                if (
                    widget.type === "slider" &&
                    widget.step !== "" &&
                    !(Number(widget.step) > 0)
                ) {
                    addWidget("error", "Its step must be over 0", "range")
                }
            }
            if (widget.type === "color") {
                if (!widget.timer) {
                    addWidget(
                        "warning",
                        "BEE2 4.46 doesn't show a color's swatch unless it has a value for each timer value",
                        "timer",
                    )
                } else if (widget.inf) {
                    addWidget(
                        "error",
                        "BEE2 4.46 can't show a color with an infinite timer's value",
                        "timer",
                    )
                }
            }

            const values = widget.timer
                ? timerValuesOf(widget).map((t) => widget.defaults?.[t])
                : [widget.default]
            if (values.some((value) => valueError(widget, value))) {
                addWidget(
                    "error",
                    widget.timer
                        ? "Some timer values' defaults aren't right for it"
                        : `Its default: ${valueError(widget, values[0])}`,
                    "default",
                )
            }
        })
    })
    return problems
}
