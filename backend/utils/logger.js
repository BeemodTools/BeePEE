const fs = require("fs")
const path = require("path")
const util = require("util")
const { AsyncLocalStorage } = require("async_hooks")
const { app } = require("electron")

/**
 * Logger: plain text lines to the console and a log file. Work can be split
 * into steps with logger.section(): everything logged while a step runs, also
 * from the functions it calls, is drawn as a tree under the step's title:
 *
 *   Model generation for "Laser Catcher" (TIMER DELAY)
 *   ├─ Converting 2 instances to OBJ
 *   │  ├─ laser_catcher_0: 2285 faces, 3 props, 12 materials
 *   │  └─ ✓ Done in 1.2 s
 *   └─ ✓ Done in 4.8 s
 *
 * The windows' console output is logged too (see logHandlers.js), marked with
 * the window it came from: "[Item Editor] Saved item ...".
 *
 * To keep the logs small: objects are printed shallow, very long messages are
 * cut short, a line repeated many times in a row is written once with a count,
 * a log file holds at most MAX_FILE_BYTES (then the log continues in a new
 * file) and only the MAX_LOG_FILES most recent files are kept.
 */

/**
 * The section code runs in: { depth, closing, closed, buffer, parent }.
 * Work a section starts (timers, events) keeps its section, even after the
 * section ended, so lines are logged in the innermost section still running.
 */
const sections = new AsyncLocalStorage()

/** The innermost section still running, or null */
function currentSection() {
    return currentSectionFrom(sections.getStore())
}

/** `section` or, when it ended, its innermost parent still running */
function currentSectionFrom(section) {
    while (section?.closed) section = section.parent
    return section ?? null
}

const LABELS = { warn: "Warning: ", error: "Error: " }

/** How steps end (plain Unicode symbols, not emoji) */
const DONE = "✓"
const FAILED = "✗"

/** How objects in log messages are printed */
const INSPECT_OPTIONS = {
    depth: 3,
    maxArrayLength: 20,
    maxStringLength: 1000,
    breakLength: 120,
}

/** Longer messages are cut short */
const MAX_MESSAGE_LENGTH = 4000

/** A log file holds at most this much, then the log continues in a new file */
const MAX_FILE_BYTES = 5 * 1024 * 1024

const MAX_LOG_FILES = 10

/** How long since `start`, for "✓ Done in ..." lines */
function elapsed(start) {
    const ms = Date.now() - start
    return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

/** Log message arguments as text, like console.log prints them */
function formatText(args) {
    const text = util.formatWithOptions(
        INSPECT_OPTIONS,
        ...args.map((arg) =>
            arg instanceof Error ? (arg.stack ?? arg.message) : arg,
        ),
    )
    if (text.length <= MAX_MESSAGE_LENGTH) return text
    const left = text.length - MAX_MESSAGE_LENGTH
    return `${text.slice(0, MAX_MESSAGE_LENGTH)}... (${left} more characters)`
}

/**
 * A log line as plain text, drawn into the tree of the section it's in
 * @param {string} level - info, warn, error, debug or trace
 * @param {any[]} args - Like console.log's (Errors show their stack)
 * @param {Object|null} [section] - The section it's logged in
 */
function formatLine(level, args, section = currentSection()) {
    const text = formatText(args)
    const depth = section?.depth ?? 0
    // No label on how steps end ("✓ Done in", "✗ ... failed after"), or when
    // the text already says it ("Error: ENOENT ...", "Warning ...")
    const label =
        section?.closing ||
        text.startsWith(DONE) ||
        text.startsWith(FAILED) ||
        /^\w*(error|warning)\b/i.test(text)
            ? ""
            : (LABELS[level] ?? "")
    if (depth === 0) return label + text
    const indent = "│  ".repeat(depth - 1)
    const first = indent + (section.closing ? "└─ " : "├─ ")
    const rest = indent + (section.closing ? "   " : "│  ")
    const lines = (first + label + text)
        .split("\n")
        .map((line, i) => (i === 0 ? line : rest + line).trimEnd())
    // A spacer after each step's end, keeping the tree's lines going
    if (section.closing) lines.push(indent.trimEnd())
    return lines.join("\n")
}

/** Local time with milliseconds, for log file lines */
function timestamp() {
    const now = new Date()
    return `${now.toTimeString().slice(0, 8)}.${String(now.getMilliseconds()).padStart(3, "0")}`
}

class Logger {
    constructor() {
        this.logDir = null
        this.logFile = null
        this.stream = null
        this.maxLogFiles = MAX_LOG_FILES
        this.isInitialized = false
        this.verbose = false
        this.fileBytes = 0
        this.filePart = 1
        this.fileTime = null
        // The last line written to the file, and how often it came again
        this.lastLine = null
        this.repeats = 0
    }

    /**
     * Enable/disable verbose (debug) logging at runtime
     */
    setVerbose(enabled) {
        this.verbose = !!enabled
    }

    /** Whether debug lines are logged: in development, or when verbose */
    get debugEnabled() {
        return !app?.isPackaged || this.verbose
    }

    /**
     * Initialize the logger - must be called after app is ready
     */
    initialize() {
        if (this.isInitialized) return

        try {
            this.logDir = path.join(app.getPath("userData"), "logs")
            if (!fs.existsSync(this.logDir)) {
                fs.mkdirSync(this.logDir, { recursive: true })
            }
            this.fileTime = new Date().toISOString().replace(/[:.]/g, "-")
            this.openLogFile()
            this.isInitialized = true
            this.interceptConsole()
            console.log(`BeePEE ${app.getVersion()}, log file: ${this.logFile}`)
        } catch (error) {
            // Fallback to console if logger initialization fails
            console.error("Failed to initialize logger:", error)
        }
    }

    /** Start the next log file, and remove old ones */
    openLogFile() {
        const part = this.filePart > 1 ? `-${this.filePart}` : ""
        this.logFile = path.join(
            this.logDir,
            `beepee-${this.fileTime}${part}.log`,
        )
        this.stream = fs.createWriteStream(this.logFile, { flags: "a" })
        this.fileBytes = 0
        this.rotateLogs()
    }

    /**
     * Send all console output through the logger (formatted, and into the file)
     */
    interceptConsole() {
        if (!this.originalConsole) {
            this.originalConsole = {
                log: console.log.bind(console),
                error: console.error.bind(console),
                warn: console.warn.bind(console),
                info: console.info.bind(console),
                debug: console.debug.bind(console),
                trace: console.trace.bind(console),
            }
        }
        console.log = (...args) => this.output("info", args, "log")
        console.info = (...args) => this.output("info", args, "info")
        console.warn = (...args) => this.output("warn", args, "warn")
        console.error = (...args) => this.output("error", args, "error")
        console.debug = (...args) => {
            if (this.debugEnabled) this.output("debug", args, "debug")
        }
        console.trace = (...args) => this.output("trace", args, "trace")
    }

    /**
     * Restore original console methods (for testing or cleanup)
     */
    restoreConsole() {
        if (this.originalConsole) {
            console.log = this.originalConsole.log
            console.error = this.originalConsole.error
            console.warn = this.originalConsole.warn
            console.info = this.originalConsole.info
            console.debug = this.originalConsole.debug
            console.trace = this.originalConsole.trace
        }
    }

    /**
     * Remove old log files, keeping the most recent ones
     */
    rotateLogs() {
        try {
            if (!fs.existsSync(this.logDir)) return

            const currentFileName = path.basename(this.logFile)
            const files = fs
                .readdirSync(this.logDir)
                .filter(
                    (file) =>
                        file.startsWith("beepee-") &&
                        file.endsWith(".log") &&
                        file !== currentFileName,
                )
                .map((file) => ({
                    name: file,
                    path: path.join(this.logDir, file),
                    time: fs
                        .statSync(path.join(this.logDir, file))
                        .mtime.getTime(),
                }))
                .sort((a, b) => b.time - a.time) // newest first

            // The current file counts too
            for (const file of files.slice(this.maxLogFiles - 1)) {
                try {
                    fs.unlinkSync(file.path)
                } catch (err) {
                    console.error(
                        `Failed to delete log file ${file.name}:`,
                        err,
                    )
                }
            }
        } catch (error) {
            console.error("Failed to rotate logs:", error)
        }
    }

    /**
     * Log a line in the current section
     * @param {string} level
     * @param {any[]} args
     * @param {string|null} consoleMethod - Console method to also print with
     *   (null: only the log file)
     */
    output(level, args, consoleMethod) {
        const section = currentSection()
        const line = formatLine(level, args, section)
        this.route(
            { level, line, consoleMethod, time: timestamp() },
            section?.buffer ?? null,
            section,
        )
    }

    /**
     * Write a line now, or keep it in a buffered section's block
     * @param {Object} entry
     * @param {Object[]|null} buffer
     * @param {Object|null} [section] - The section the line is in: the
     *   titles of it and the sections around it are written first, if they
     *   aren't yet
     */
    route(entry, buffer, section = null) {
        this.writeTitles(section)
        if (buffer) buffer.push(entry)
        else this.emit(entry)
    }

    /**
     * A section's title waits for its first line (so a section with no lines
     * can end up as one line): write the waiting titles of `section` and the
     * sections around it, outermost first
     */
    writeTitles(section) {
        const waiting = []
        for (let s = section; s?.title; s = s.parent) waiting.unshift(s)
        for (const s of waiting) {
            const { title } = s
            s.title = null
            // Stamped now, so the log's times keep going forward
            title.time = timestamp()
            if (s.buffer) s.buffer.push(title)
            else this.emit(title)
        }
    }

    /**
     * Write a formatted line to the console and the log file (with the time
     * it was logged: lines of parallel steps are written later, as a block)
     */
    emit({ line, consoleMethod, time }) {
        if (consoleMethod) {
            const target = this.originalConsole ?? console
            target[consoleMethod](line)
        }
        if (!this.isInitialized || !this.stream) return
        if (line === this.lastLine) {
            this.repeats++
            return
        }
        this.flushRepeats()
        this.lastLine = line
        this.writeToFile(line, time)
    }

    /** Note how often the last line came again (written once to save space) */
    flushRepeats() {
        if (this.repeats === 0) return
        const times = this.repeats === 1 ? "time" : "times"
        const tree = this.lastLine.match(/^[│├└─ ]*/)[0]
        const prefix = tree.replace(/└─ $/, "├─ ")
        this.writeToFile(`${prefix}(repeated ${this.repeats} more ${times})`)
        this.repeats = 0
    }

    writeToFile(line, time = timestamp()) {
        try {
            // The time goes on the first line, the rest line up under it
            const pad = " ".repeat(time.length + 2)
            const text = `${line
                .split("\n")
                .map((part, i) =>
                    ((i === 0 ? `${time}  ` : pad) + part).trimEnd(),
                )
                .join("\n")}\n`
            this.stream.write(text)
            this.fileBytes += Buffer.byteLength(text)
            if (this.fileBytes > MAX_FILE_BYTES) {
                this.filePart++
                const previous = this.stream
                this.openLogFile()
                previous.end(
                    `${timestamp()}  Log file is full, continued in ${path.basename(this.logFile)}\n`,
                )
                this.stream.write(
                    `${timestamp()}  Continued from ${path.basename(previous.path)}\n`,
                )
            }
        } catch (error) {
            const target = this.originalConsole ?? console
            target.error("Failed to write to log file:", error)
        }
    }

    /**
     * Run `fn` as a step: its title is logged, everything logged while it
     * runs is drawn as a tree under it, and it ends with "✓ Done in ..." or,
     * when it throws or returns { success: false, error }, with
     * "✗ Failed after ...: <reason>" (thrown errors are re-thrown). A step
     * that logs nothing is one line: "✓ <title> in ...".
     * @param {string} title
     * @param {() => any} fn
     * @param {{buffered?: boolean}} [options] - buffered: for steps that run
     *   in parallel: each step's lines are written as one block, in the
     *   order the steps started
     * @returns {Promise<any>} What `fn` returns
     */
    async section(title, fn, { buffered = false } = {}) {
        const parent = currentSection()
        let block = null
        if (buffered) {
            block = { entries: [], done: false }
            this.blocksOf(parent).push(block)
        }
        const buffer = block ? block.entries : (parent?.buffer ?? null)
        const entry = (level, line) => ({
            level,
            line,
            consoleMethod: level === "error" ? "error" : "log",
            time: timestamp(),
        })
        const store = {
            depth: (parent?.depth ?? 0) + 1,
            closing: false,
            closed: false,
            buffer,
            parent,
            // Written with the step's first line (see writeTitles)
            title: entry("info", formatLine("info", [title], parent)),
        }
        const close = (failed, text) => {
            const level = failed ? "error" : "info"
            const mark = failed ? FAILED : DONE
            if (store.title) {
                // Nothing was logged in the step: one line
                store.title = null
                const line = `${mark} ${title} ${text}`
                this.route(
                    entry(level, formatLine(level, [line], parent)),
                    buffer,
                    parent,
                )
            } else {
                const ending = text.charAt(0).toUpperCase() + text.slice(1)
                const line = formatLine(level, [`${mark} ${ending}`], {
                    ...store,
                    closing: true,
                })
                this.route(entry(level, line), buffer)
            }
        }

        const start = Date.now()
        try {
            const result = await sections.run(store, fn)
            if (result?.success === false) {
                const reason = result.error ? `: ${result.error}` : ""
                close(true, `failed after ${elapsed(start)}${reason}`)
            } else {
                close(
                    false,
                    `${store.title ? "in" : "done in"} ${elapsed(start)}`,
                )
            }
            return result
        } catch (error) {
            const reason = error?.message ?? error
            close(true, `failed after ${elapsed(start)}: ${reason}`)
            throw error
        } finally {
            store.closed = true
            if (block) {
                block.done = true
                this.flushBlocks(parent)
            }
        }
    }

    /** The blocks of parallel steps waiting to be written, under `parent` */
    blocksOf(parent) {
        if (!parent) return (this.topBlocks ??= [])
        return (parent.blocks ??= [])
    }

    /** Write the blocks of finished parallel steps, in the order they started */
    flushBlocks(parent) {
        const queue = this.blocksOf(parent)
        while (queue.length > 0 && queue[0].done) {
            const { entries } = queue.shift()
            const target = currentSectionFrom(parent)
            for (const entry of entries) {
                this.route(entry, target?.buffer ?? null, target)
            }
        }
    }

    /**
     * Log a line from a window's console (see logHandlers.js)
     * @param {string} windowName - e.g. "Item Editor"
     * @param {"info"|"warn"|"error"|"debug"} level
     * @param {string} text
     */
    fromWindow(windowName, level, text) {
        if (level === "debug" && !this.debugEnabled) return
        const method = { warn: "warn", error: "error" }[level] ?? "log"
        this.output(level, [`[${windowName}] ${text}`], method)
    }

    /**
     * Log info message
     */
    info(message, ...args) {
        this.output("info", [message, ...args], "log")
    }

    /**
     * Log warning message
     */
    warn(message, ...args) {
        this.output("warn", [message, ...args], "warn")
    }

    /**
     * Log error message
     */
    error(message, ...args) {
        this.output("error", [message, ...args], "error")
    }

    /**
     * Log debug message (log file only, in development or when verbose
     * logging is enabled)
     */
    debug(message, ...args) {
        if (this.debugEnabled) {
            this.output("debug", [message, ...args], null)
        }
    }

    /**
     * Log trace message (log file only)
     */
    trace(message, ...args) {
        this.output("trace", [message, ...args], null)
    }

    /**
     * Close the log stream
     */
    close() {
        if (this.stream) {
            try {
                this.flushRepeats()
                this.writeToFile("Log closed")
                this.stream.end()
            } catch (error) {
                const target = this.originalConsole ?? console
                target.error("Error closing logger:", error)
            }
            this.stream = null
        }
        this.isInitialized = false
    }

    /**
     * Get the path to the current log file
     */
    getLogFilePath() {
        return this.logFile
    }

    /**
     * Get the logs directory path
     */
    getLogsDirectory() {
        return this.logDir
    }
}

// Create singleton instance
const logger = new Logger()

module.exports = {
    logger,
    initializeLogger: () => logger.initialize(),
    formatLine,
}
