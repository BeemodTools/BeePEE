/**
 * Sends this window's console output to BeePEE's log file (through the main
 * process, see backend/handlers/logHandlers.js), so it ends up next to the
 * backend's logs in bug reports. Objects are summarized and long messages
 * cut short, to keep the log small.
 */

const LEVELS = {
    log: "info",
    info: "info",
    warn: "warn",
    error: "error",
    debug: "debug",
}

/** Longest message sent to the log */
const MAX_LENGTH = 2000

/** Longest object (as JSON) in a message */
const MAX_OBJECT_LENGTH = 300

function shorten(text, max) {
    if (text.length <= max) return text
    return `${text.slice(0, max)}... (${text.length - max} more characters)`
}

/** One console argument as text */
function describe(value) {
    if (typeof value === "string") return value
    if (value instanceof Error) {
        return value.stack || `${value.name}: ${value.message}`
    }
    if (value === undefined) return "undefined"
    if (typeof value === "function") {
        return `[function ${value.name || "anonymous"}]`
    }
    if (typeof value !== "object" || value === null) return String(value)
    if (typeof Element !== "undefined" && value instanceof Element) {
        return `<${value.tagName.toLowerCase()}>`
    }
    try {
        const seen = new WeakSet()
        const json = JSON.stringify(value, (key, inner) => {
            if (typeof inner === "bigint") return String(inner)
            if (typeof inner === "function") return "[function]"
            if (inner instanceof Error) return `${inner.name}: ${inner.message}`
            if (typeof inner === "object" && inner !== null) {
                if (seen.has(inner)) return "[circular]"
                seen.add(inner)
            }
            return inner
        })
        return shorten(json ?? String(value), MAX_OBJECT_LENGTH)
    } catch {
        return Object.prototype.toString.call(value)
    }
}

/** Console arguments as one line of text ("%s" etc. filled in) */
export function formatLogArgs(args) {
    let rest = args
    let first = ""
    if (typeof args[0] === "string" && /%[sdifoOc%]/.test(args[0])) {
        rest = args.slice(1)
        first = args[0].replace(/%([sdifoOc%])/g, (match, type) => {
            if (type === "%") return "%"
            if (rest.length === 0) return match
            const value = rest.shift()
            if (type === "c") return "" // CSS styling
            if (type === "d" || type === "i") return String(parseInt(value))
            if (type === "f") return String(parseFloat(value))
            return describe(value)
        })
    }
    const parts = first ? [first, ...rest.map(describe)] : rest.map(describe)
    return shorten(parts.join(" "), MAX_LENGTH)
}

/**
 * Also send everything this window logs (and its uncaught errors) to the log
 * file. Safe to call more than once.
 */
export function forwardLogs() {
    const send = window.electron?.log
    if (typeof send !== "function" || console.beepeeForwarded) return
    console.beepeeForwarded = true

    const forward = (level, text) => {
        try {
            send(level, text)
        } catch {
            // Logging must never break the window
        }
    }

    for (const [method, level] of Object.entries(LEVELS)) {
        const original = console[method]
        console[method] = (...args) => {
            original.apply(console, args)
            forward(level, formatLogArgs(args))
        }
    }

    window.addEventListener("error", (event) => {
        const where = event.filename
            ? ` (${event.filename.split("/").pop()}:${event.lineno})`
            : ""
        const error = event.error ? describe(event.error) : event.message
        forward("error", shorten(`Uncaught ${error}${where}`, MAX_LENGTH))
    })
    window.addEventListener("unhandledrejection", (event) => {
        forward(
            "error",
            shorten(
                `Unhandled promise rejection: ${describe(event.reason)}`,
                MAX_LENGTH,
            ),
        )
    })
}

// Started on import: main.jsx imports this module first, so the logs of
// every other module are forwarded too
forwardLogs()
