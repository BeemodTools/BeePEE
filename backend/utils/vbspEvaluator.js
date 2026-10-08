/**
 * Which instance BEE2 places for an item: the item's VBSP conditions run on
 * its instance the way BEE2 runs them (see the vbsp_config conditions docs),
 * as far as BeePEE can tell. Model making uses it to know the instance each
 * value of a variable gives (a cube type, a timer delay, ...).
 *
 * Some tests BeePEE can't tell (styleVar, orientation, ...), and some results
 * are chosen at random. Those are followed every way they can go, each a
 * "world" of its own; when the worlds end with different instances, the most
 * common one is the answer, and it's uncertain.
 */
const { parse } = require("./keyvalues")

const lower = (text) => String(text ?? "").toLowerCase()

/** An instance path as BEE2 compares them */
const normalizePath = (file) =>
    lower(file).trim().replace(/\\/g, "/").replace(/\/+/g, "/")

/** Keys on a condition's own level that aren't tests */
const NOT_TESTS = new Set([
    "priority",
    "result",
    "results",
    "else",
    "condition",
    "elsecondition",
    "switch",
    "elseswitch",
])

/** Worlds followed at most; past that, the first ones */
const MAX_WORLDS = 256

/** A value as true or false, as BEE2 reads one (srctools' conv_bool) */
function truthy(value) {
    const text = lower(value).trim()
    if (["1", "true", "t", "yes", "y", "on"].includes(text)) return true
    if (["0", "false", "f", "no", "n", "off", ""].includes(text)) return false
    const number = Number(text)
    return !Number.isNaN(number) && number !== 0
}

/** Two values compared as numbers when both are, else as text */
function compare(a, operator, b) {
    const left = String(a).trim()
    const right = String(b).trim()
    const numbers =
        left !== "" &&
        right !== "" &&
        !Number.isNaN(Number(left)) &&
        !Number.isNaN(Number(right))
    const x = numbers ? Number(left) : left
    const y = numbers ? Number(right) : right
    switch (operator) {
        case "=":
        case "==":
            return x === y
        case "!=":
            return x !== y
        case "<":
            return x < y
        case ">":
            return x > y
        case "<=":
            return x <= y
        case ">=":
            return x >= y
        default:
            return null
    }
}

/** Instance numbers for BEE2's built-in subtype keywords */
const SUBTYPE_KEYWORDS = {
    standard: [0],
    companion: [1],
    comp: [1],
    reflect: [2],
    redirect: [2],
    reflection: [2],
    redirection: [2],
    laser: [2],
    sphere: [3],
    edgeless: [3],
    ball: [3],
    franken: [4],
    monster: [4],
    btn_weighted: [0, 1],
    btn_floor: [0, 1],
    btn_cube: [2, 3],
    btn_sphere: [4, 5],
    btn_ball: [4, 5],
    btn_edgeless: [4, 5],
    btn_white: [0, 2, 4],
    btn_black: [1, 3, 5],
}
for (const [name, white] of [
    ["weighted", 0],
    ["floor", 0],
    ["cube", 2],
    ["sphere", 4],
    ["ball", 4],
    ["edgeless", 4],
]) {
    SUBTYPE_KEYWORDS[`${name}_white`] = [white]
    SUBTYPE_KEYWORDS[`${name}_black`] = [white + 1]
}

/** What a world shows: its instance, or the first one added on top */
function shown(world) {
    if (world.file !== null) return `file:${normalizePath(world.file)}`
    if (world.overlays.length) return `overlay:${normalizePath(world.overlays[0])}`
    return "none"
}

/**
 * Run an item's VBSP conditions on its instance
 * @param {Object} options
 * @param {string} options.text - The item's vbsp_config text
 * @param {string} options.itemId
 * @param {Object<string, string>} options.instances - Its editoritems
 *   instances: key ("0", "1", "bee2_frame") to file
 * @param {string} options.file - The instance it starts as
 * @param {Object<string, string>} options.fixups - Its $fixup values
 * @returns {{file: string|null, overlays: string[], uncertain: boolean}}
 *   The file it ends up as (null: removed), and the instances added on top
 *   of it (addOverlay)
 */
function runConditions({ text, itemId, instances, file, fixups }) {
    const start = {
        file,
        fixups: Object.fromEntries(
            Object.entries(fixups ?? {}).map(([name, value]) => [
                lower(name).replace(/^\$/, ""),
                String(value ?? ""),
            ]),
        ),
        overlays: [],
        uncertain: false,
    }
    const clone = (world) => ({
        ...world,
        fixups: { ...world.fixups },
        overlays: [...world.overlays],
    })
    let tooMany = false
    // The same worlds once (both ways of most tests end alike), at most
    // MAX_WORLDS of them
    const limit = (worlds) => {
        const seen = new Set()
        const unique = worlds.filter((world) => {
            const key = JSON.stringify(world)
            if (seen.has(key)) return false
            seen.add(key)
            return true
        })
        if (unique.length <= MAX_WORLDS) return unique
        tooMany = true
        return unique.slice(0, MAX_WORLDS)
    }

    // A <ITEM_ID:subtypes> lookup's files (none for another item's), or
    // null when it isn't one
    const lookup = (ref) => {
        const match = String(ref).trim().match(/^<([^:>]+)(?::([^>]*))?>$/)
        if (!match) return null
        if (lower(match[1]) !== lower(itemId)) return []
        const keys = Object.keys(instances)
        if (!match[2]) {
            return keys
                .filter((key) => /^\d+$/.test(key))
                .map((key) => instances[key])
        }
        return match[2]
            .split(",")
            .map((subtype) => subtype.trim())
            .flatMap((subtype) => {
                if (/^\d+$/.test(subtype)) return [String(Number(subtype))]
                const custom = keys.find((key) => lower(key) === lower(subtype))
                if (custom) return [custom]
                return (SUBTYPE_KEYWORDS[lower(subtype)] ?? []).map(String)
            })
            .map((key) => instances[key])
            .filter(Boolean)
    }

    const fixup = (world, name) =>
        world.fixups[lower(name).replace(/^\$/, "")] ?? ""
    const setFixup = (world, name, value) => {
        world.fixups[lower(name).replace(/^\$/, "")] = value
    }
    // "$var" or text with $vars in it, with their values ("!$var": not it)
    const substitute = (world, value) =>
        String(value ?? "").replace(/(!?)\$([A-Za-z_]\w*)/g, (m, not, name) =>
            not ? (truthy(fixup(world, name)) ? "0" : "1") : fixup(world, name),
        )

    /** instvar's argument: "$var op value", "$var value" or "$var" */
    const instvar = (world, argument) => {
        const parts = String(argument ?? "").trim().split(/\s+/)
        if (parts.length === 1) return truthy(substitute(world, parts[0]))
        if (parts.length > 3) return null
        const [a, operator, b] =
            parts.length === 2 ? [parts[0], "==", parts[1]] : parts
        return compare(
            substitute(world, a),
            substitute(world, operator),
            substitute(world, b),
        )
    }

    /** A test in a world: true, false, or null (BeePEE can't tell) */
    const test = (world, name, value, children) => {
        const key = lower(name)
        if (key.startsWith("$")) {
            return instvar(world, `${name} ${value ?? ""}`)
        }
        switch (key) {
            case "instance": {
                if (world.file === null) return false
                const current = normalizePath(world.file)
                const files = lookup(value)
                if (files) return files.some((f) => normalizePath(f) === current)
                if (/^\[.*\]$/.test(String(value).trim())) return false
                const wanted = normalizePath(substitute(world, value))
                return current === wanted || current === `${wanted}.vmf`
            }
            case "instflag":
            case "instpart":
                return (
                    world.file !== null &&
                    normalizePath(world.file).includes(normalizePath(value))
                )
            case "instvar":
                return instvar(world, value)
            case "debug":
                return true
            case "not": {
                const [inner] = children ?? []
                if (!inner) return null
                const result = test(world, inner.key, inner.value, inner.children)
                return result === null ? null : !result
            }
            case "and":
            case "nand":
            case "or":
            case "nor": {
                const results = (children ?? []).map((inner) =>
                    test(world, inner.key, inner.value, inner.children),
                )
                const all = key === "and" || key === "nand"
                const result = all
                    ? results.includes(false)
                        ? false
                        : results.includes(null)
                          ? null
                          : true
                    : results.includes(true)
                      ? true
                      : results.includes(null)
                        ? null
                        : false
                if (result === null || key === "and" || key === "or") {
                    return result
                }
                return !result
            }
            default:
                return null
        }
    }

    /** Results, in order, in each world: the worlds after them */
    const runResults = (entries, worlds) => {
        for (const entry of entries ?? []) {
            worlds = limit(worlds.flatMap((world) => runResult(entry, world)))
        }
        return worlds
    }

    const runResult = (entry, world) => {
        const key = lower(entry.key)
        if (key.startsWith("$") && !entry.children) {
            setFixup(world, key, substitute(world, entry.value))
            return [world]
        }
        switch (key) {
            case "changeinstance": {
                const value = String(entry.value ?? "").trim()
                if (value === "") {
                    world.file = null
                    return [world]
                }
                const files = lookup(value)
                if (!files) world.file = substitute(world, value)
                else if (files.length > 0) world.file = files[0]
                // Another item's instance: not one BeePEE knows
                else world.uncertain = true
                return [world]
            }
            case "addoverlay":
            case "overlayinst": {
                // Its file, or a block with "file" (and more)
                const name = entry.children
                    ? entry.children.find((e) => lower(e.key) === "file")?.value
                    : entry.value
                const added = substitute(world, name).trim()
                const files = lookup(added)
                if (files) world.overlays.push(...files.slice(0, 1))
                else if (added) world.overlays.push(added)
                return [world]
            }
            case "suffix":
            case "instsuffix":
                if (world.file !== null) {
                    const suffix = substitute(world, entry.value).trim()
                    world.file = world.file.replace(
                        /(\.vmf)?$/i,
                        (ext) => `_${suffix}${ext}`,
                    )
                }
                return [world]
            case "setinstvar":
            case "assign":
            case "setfixupvar": {
                const [name, ...rest] = String(entry.value ?? "")
                    .trim()
                    .split(/\s+/)
                if (name) setFixup(world, name, substitute(world, rest.join(" ")))
                return [world]
            }
            case "mapinstvar": {
                const [pair, ...table] = entry.children ?? []
                if (!pair) return [world]
                const from = fixup(world, pair.key)
                const mapped = table.find((row) => row.key === from)
                if (mapped) {
                    setFixup(world, pair.value, substitute(world, mapped.value))
                }
                return [world]
            }
            case "result":
            case "results":
            case "group":
                return runResults(entry.children, [world])
            case "condition":
                return runCondition(entry.children, world)
            case "switch":
                return runSwitch(entry.children, world)
            case "random": {
                // One of its results (or a group of them), at random
                const settings = new Set(["chance", "weights", "seed"])
                const options = (entry.children ?? []).filter(
                    (e) => !settings.has(lower(e.key)),
                )
                if (options.length === 0) return [world]
                const worlds = options.flatMap((option) =>
                    runResults([option], [clone(world)]),
                )
                const chance = (entry.children ?? []).find(
                    (e) => lower(e.key) === "chance",
                )
                // A chance under 100%: maybe none of them
                if (chance && Number(chance.value) < 100) worlds.push(world)
                return worlds
            }
            case "variant": {
                // A "_varN" suffix, at random
                const count = Number(
                    entry.children
                        ? entry.children.find((e) => lower(e.key) === "number")
                              ?.value
                        : entry.value,
                )
                if (!(count >= 1) || world.file === null) return [world]
                return Array.from({ length: Math.min(count, 32) }, (_, n) => {
                    const variant = clone(world)
                    variant.file = world.file.replace(
                        /(\.vmf)?$/i,
                        (ext) => `_var${n + 1}${ext}`,
                    )
                    return variant
                })
            }
            default:
                return [world]
        }
    }

    const runSwitch = (entries, world) => {
        const settings = {}
        const cases = []
        let fallback = null
        for (const entry of entries ?? []) {
            if (!entry.children) settings[lower(entry.key)] = entry.value
            else if (lower(entry.key) === "<default>") fallback = entry
            else cases.push(entry)
        }
        const method = lower(settings.method || "first")
        const testName = settings.test ?? settings.flag ?? ""

        if (method === "random") {
            // One of the cases its test passes (any, without a test)
            let worlds = []
            const pending = [world]
            for (const entry of cases) {
                const result = testName ? test(world, testName, entry.key) : true
                if (result !== false) {
                    worlds.push(...runResults(entry.children, [clone(world)]))
                }
            }
            if (worlds.length === 0) {
                worlds = fallback ? runResults(fallback.children, pending) : pending
            }
            return limit(worlds)
        }

        if (method === "all") {
            // Every case its test passes, in order; <default> when none
            let worlds = [{ world, matched: false }]
            for (const entry of cases) {
                worlds = worlds.flatMap(({ world: current, matched }) => {
                    const result = test(current, testName, entry.key)
                    const ran = () =>
                        runResults(entry.children, [clone(current)]).map(
                            (w) => ({ world: w, matched: true }),
                        )
                    if (result === true) return ran()
                    if (result === false) return [{ world: current, matched }]
                    return [...ran(), { world: current, matched }]
                })
            }
            return limit(
                worlds.flatMap(({ world: current, matched }) =>
                    matched || !fallback
                        ? [current]
                        : runResults(fallback.children, [current]),
                ),
            )
        }

        // first (or last): the first case its test passes
        const ordered = method === "last" ? [...cases].reverse() : cases
        const done = []
        let pending = [world]
        for (const entry of ordered) {
            const next = []
            for (const current of pending) {
                const result = test(current, testName, entry.key)
                if (result === true || result === null) {
                    done.push(
                        ...runResults(entry.children, [
                            result === null ? clone(current) : current,
                        ]),
                    )
                }
                if (result === false || result === null) next.push(current)
            }
            pending = next
        }
        for (const current of pending) {
            done.push(
                ...(fallback
                    ? runResults(fallback.children, [current])
                    : [current]),
            )
        }
        return limit(done)
    }

    /** Which branch a key on a condition's own level is in */
    const branch = (key) => {
        if (["result", "results", "condition", "switch"].includes(key)) {
            return "then"
        }
        if (["else", "elsecondition", "elseswitch"].includes(key)) return "else"
        return null
    }

    /** A condition in a world: the worlds after it */
    const runCondition = (entries, world) => {
        let passed = true
        for (const entry of entries ?? []) {
            if (NOT_TESTS.has(lower(entry.key))) continue
            const result = test(world, entry.key, entry.value, entry.children)
            if (result === false) {
                passed = false
                break
            }
            if (result === null) passed = null
        }
        const runBranch = (which, current) => {
            let worlds = [current]
            for (const entry of entries ?? []) {
                const key = lower(entry.key)
                if (branch(key) !== which) continue
                worlds = limit(
                    worlds.flatMap((w) => {
                        if (key === "condition" || key === "elsecondition") {
                            return runCondition(entry.children, w)
                        }
                        if (key === "switch" || key === "elseswitch") {
                            return runSwitch(entry.children, w)
                        }
                        return runResults(entry.children, [w])
                    }),
                )
            }
            return worlds
        }
        if (passed === true) return runBranch("then", world)
        if (passed === false) return runBranch("else", world)
        // A test BeePEE can't tell: both ways
        return [
            ...runBranch("then", clone(world)),
            ...runBranch("else", world),
        ]
    }

    // The conditions, by priority (smaller first), then in the file's order
    const conditions = parse(text)
        .filter((e) => e.children && lower(e.key) === "conditions")
        .flatMap((e) => e.children)
        .filter((e) => e.children && lower(e.key) === "condition")
        .map((condition, index) => {
            const priority = condition.children.find(
                (e) => lower(e.key) === "priority",
            )
            return { condition, index, priority: Number(priority?.value) || 0 }
        })
        .sort((a, b) => a.priority - b.priority || a.index - b.index)
    let worlds = [start]
    for (const { condition } of conditions) {
        worlds = limit(
            worlds.flatMap((world) => runCondition(condition.children, world)),
        )
    }

    // The most common outcome (the first of them on a tie)
    const counts = new Map()
    for (const world of worlds) {
        counts.set(shown(world), (counts.get(shown(world)) ?? 0) + 1)
    }
    const best = [...counts.entries()].reduce((a, b) => (b[1] > a[1] ? b : a))
    const answer = worlds.find((world) => shown(world) === best[0])
    return {
        file: answer.file,
        overlays: answer.overlays,
        uncertain:
            tooMany || counts.size > 1 || worlds.some((world) => world.uncertain),
    }
}

module.exports = { runConditions }
