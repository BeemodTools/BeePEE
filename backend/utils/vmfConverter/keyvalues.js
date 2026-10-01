/**
 * Tolerant KeyValues parser for VMF, VMT and similar Valve text formats.
 *
 * Produces an ordered tree that keeps duplicate keys, which VMF relies on
 * (many `solid`, `side` and `entity` blocks share a name).
 *
 * Node shape: { key: string, value: string } for key/value pairs and
 *             { key: string, children: Node[] } for blocks.
 */

const QUOTE = 34 // "
const OPEN = 123 // {
const CLOSE = 125 // }
const SLASH = 47 // /
const NEWLINE = 10
const BRACKET = 91 // [

function isSpace(code) {
    return (
        code === 32 ||
        code === 9 ||
        code === 10 ||
        code === 13 ||
        code === 11 ||
        code === 12 ||
        code === 0xfeff
    )
}

/**
 * Evaluate a `[$WIN32]` style platform conditional. BeePEE only runs on
 * Windows PCs, so only the Windows/PC flags are true.
 * @param {string} condition - Text between the brackets
 * @returns {boolean}
 */
function evaluatePlatformCondition(condition) {
    const TRUE_FLAGS = new Set(["$WIN32", "$WINDOWS", "$WIN64"])
    return condition.split("||").some((anyPart) =>
        anyPart.split("&&").every((term) => {
            let flag = term.trim()
            let negate = false
            while (flag.startsWith("!")) {
                negate = !negate
                flag = flag.slice(1).trim()
            }
            const value = TRUE_FLAGS.has(flag.toUpperCase())
            return negate ? !value : value
        }),
    )
}

/**
 * Split KeyValues text into tokens.
 * @param {string} text
 * @returns {Array<{type: "string"|"open"|"close"|"condition", value?: string}>}
 */
function tokenize(text) {
    const tokens = []
    const length = text.length
    let i = 0

    while (i < length) {
        const code = text.charCodeAt(i)

        if (isSpace(code)) {
            i++
            continue
        }

        // Comments run to the end of the line
        if (code === SLASH && text.charCodeAt(i + 1) === SLASH) {
            const end = text.indexOf("\n", i)
            i = end === -1 ? length : end + 1
            continue
        }

        if (code === OPEN) {
            tokens.push({ type: "open" })
            i++
            continue
        }

        if (code === CLOSE) {
            tokens.push({ type: "close" })
            i++
            continue
        }

        if (code === QUOTE) {
            const end = text.indexOf('"', i + 1)
            const stop = end === -1 ? length : end
            tokens.push({ type: "string", value: text.slice(i + 1, stop) })
            i = stop + 1
            continue
        }

        if (code === BRACKET) {
            const end = text.indexOf("]", i + 1)
            const lineEnd = text.indexOf("\n", i + 1)
            // Only treat it as a conditional if it closes on the same line
            if (end !== -1 && (lineEnd === -1 || end < lineEnd)) {
                tokens.push({
                    type: "condition",
                    value: text.slice(i + 1, end),
                })
                i = end + 1
                continue
            }
        }

        // Unquoted token: runs until whitespace, a quote or a brace
        let j = i
        while (j < length) {
            const c = text.charCodeAt(j)
            if (isSpace(c) || c === QUOTE || c === OPEN || c === CLOSE) break
            j++
        }
        tokens.push({ type: "string", value: text.slice(i, j) })
        i = j
    }

    return tokens
}

/**
 * Parse KeyValues text into an ordered tree.
 * Unbalanced braces and dangling keys are tolerated rather than fatal.
 * @param {string} text
 * @returns {Array<{key: string, value?: string, children?: Array}>}
 */
function parseKeyValues(text) {
    const root = []
    const stack = [root]
    let pendingKey = null
    let pendingCondition = null
    let lastNode = null

    for (const token of tokenize(text)) {
        const current = stack[stack.length - 1]

        switch (token.type) {
            case "string":
                if (pendingKey === null) {
                    pendingKey = token.value
                } else {
                    lastNode = { key: pendingKey, value: token.value }
                    current.push(lastNode)
                    pendingKey = null
                }
                break

            case "open": {
                const node = { key: pendingKey ?? "", children: [] }
                if (
                    pendingCondition === null ||
                    evaluatePlatformCondition(pendingCondition)
                ) {
                    current.push(node)
                }
                stack.push(node.children)
                lastNode = node
                pendingKey = null
                pendingCondition = null
                break
            }

            case "close":
                pendingKey = null
                pendingCondition = null
                if (stack.length > 1) stack.pop()
                break

            case "condition":
                if (pendingKey !== null) {
                    // Applies to the block that follows ("key" [$X] { ... })
                    pendingCondition = token.value
                } else if (
                    lastNode &&
                    current[current.length - 1] === lastNode &&
                    !evaluatePlatformCondition(token.value)
                ) {
                    current.pop()
                    lastNode = null
                }
                break
        }
    }

    return root
}

/**
 * Get the last value of a key in a block (KeyValues lookups are case-insensitive)
 * @param {Array} children - Block children
 * @param {string} key
 * @returns {string|undefined}
 */
function getValue(children, key) {
    const lower = key.toLowerCase()
    let found
    for (const node of children) {
        if (node.children === undefined && node.key.toLowerCase() === lower) {
            found = node.value
        }
    }
    return found
}

/**
 * Get all child blocks with the given name
 * @param {Array} children - Block children
 * @param {string} key
 * @returns {Array}
 */
function getBlocks(children, key) {
    const lower = key.toLowerCase()
    return children.filter(
        (node) =>
            node.children !== undefined && node.key.toLowerCase() === lower,
    )
}

module.exports = {
    tokenize,
    parseKeyValues,
    getValue,
    getBlocks,
    evaluatePlatformCondition,
}
