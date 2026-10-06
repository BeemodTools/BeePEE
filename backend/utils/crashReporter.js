const fs = require("fs")
const path = require("path")
const os = require("os")
const { app } = require("electron")
const { logger } = require("./logger")
const { getCrashReportEndpoint } = require("./crashReportConfig")
const { isBeta } = require("./betaInfo")
const { getMachineId } = require("./machineId")
const {
    getCurrentPackageDir,
    savePackageAsBpee,
    extractPackage,
    getFailedPackage,
} = require("../packageManager")

const MAX_LOG_BYTES = 500 * 1024 // 500KB read buffer
const MAX_LOG_LINES = 500 // Only upload last 500 lines
const MAX_PACKAGE_SIZE = 50 * 1024 * 1024 // 50MB
const REQUEST_TIMEOUT = 30000 // 30 seconds

/** What the user's and the PC's names become in a report */
const USER = "<user>"
const PC = "<pc>"

/**
 * Account and PC names many people have: they don't say who the user is, and
 * replacing them as words would garble the logs ("run as admin")
 */
const GENERIC_NAMES = new Set([
    "user",
    "users",
    "admin",
    "administrator",
    "owner",
    "default",
    "public",
    "guest",
    "pc",
    "home",
])

/** Files of the package read to take personal details out: up to this big */
const MAX_REDACT_BYTES = 10 * 1024 * 1024

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * The names this user's folder can have in paths: the home folder's
 * (C:\Users\<name>) and the account's
 */
function userFolderNames() {
    const names = new Set()
    const add = (value) => {
        const name = value ? path.basename(String(value)) : ""
        if (name.length > 1) names.add(name)
    }
    add(os.homedir())
    add(process.env.USERPROFILE)
    add(process.env.USERNAME)
    try {
        add(os.userInfo().username)
    } catch {
        // No account info on this system
    }
    return [...names]
}

/** The names this PC goes by (Dropbox's folder has it: "My PC (<name>)") */
function pcNames() {
    const names = new Set()
    for (const value of [os.hostname(), process.env.COMPUTERNAME]) {
        if (!value) continue
        names.add(value)
        // "jane-laptop.local": "jane-laptop" too
        names.add(value.split(".")[0])
    }
    return [...names]
}

/** Whether a name says who the user is, so it's taken out where it's a word */
function isPersonal(name) {
    return name.length > 2 && !GENERIC_NAMES.has(name.toLowerCase())
}

/** `name` as a whole word (not part of a longer one), in any case */
function wholeWord(name) {
    return new RegExp(
        String.raw`(?<![\w-])` + escapeRegExp(name) + String.raw`(?![\w-])`,
        "gi",
    )
}

/**
 * Take personal details out of a report's text:
 * - the user's name in paths: "C:\Users\Jane\Desktop" becomes
 *   "C:\Users\<user>\Desktop", with any slashes (also as escaped in JSON)
 *   and in any case. Other users' folders too, and the home folders of Linux
 *   and macOS (/home/<name>, /Users/<name>).
 * - the account's and the PC's names anywhere else (<user>, <pc>), unless
 *   they're names many people have, like "admin"
 * - Steam IDs (<steamid>), email addresses (<email>) and the organization in
 *   a OneDrive folder's name (<org>)
 * @param {string} text
 * @returns {string}
 */
function redactPersonalInfo(text) {
    if (!text) return text
    let redacted = String(text)
    // This user's folder, whole even when its name has spaces
    for (const name of userFolderNames()) {
        const folder = new RegExp(
            String.raw`(\b[A-Za-z]:[\\/]+Users[\\/]+|/(?:Users|home)/)` +
                escapeRegExp(name) +
                String.raw`(?=[\\/"'\s:]|$)`,
            "gi",
        )
        redacted = redacted.replace(folder, `$1${USER}`)
    }
    // Anyone else's, up to the next separator (short names like JANE~1 too)
    redacted = redacted.replace(
        /(\b[A-Za-z]:[\\/]+Users[\\/]+)(?!<user>)[^\\/"'<>|:*?\s]+/gi,
        `$1${USER}`,
    )
    redacted = redacted.replace(
        /((?:^|[^\w.])\/(?:Users|home)\/)(?!<user>)[^/"'<>|:*?\s]+/gm,
        `$1${USER}`,
    )
    // The names anywhere else
    for (const name of userFolderNames().filter(isPersonal)) {
        redacted = redacted.replace(wholeWord(name), USER)
    }
    for (const name of pcNames().filter(isPersonal)) {
        redacted = redacted.replace(wholeWord(name), PC)
    }
    return (
        redacted
            // Steam accounts: 64-bit IDs (also PeTI's puzzles folders), and
            // the account folders in Steam's userdata
            .replace(/\b7656119\d{10}\b/g, "<steamid>")
            .replace(/(userdata[\\/]+)\d{3,}/gi, "$1<steamid>")
            .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/gi, "<email>")
            .replace(/(OneDrive - )[^\\/\r\n"]+/g, "$1<org>")
    )
}

/**
 * Take personal details out of the text files in a folder (paths in JSON
 * stamps, logs, configs). Binary files are left as they are. Read and
 * written byte for byte (latin1), so other text isn't changed.
 * @param {string} folder
 */
function redactFolder(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        const file = path.join(folder, entry.name)
        if (entry.isDirectory()) {
            redactFolder(file)
            continue
        }
        if (!entry.isFile() || fs.statSync(file).size > MAX_REDACT_BYTES) {
            continue
        }
        const data = fs.readFileSync(file)
        // Text has no NUL bytes
        if (data.subarray(0, 8000).includes(0)) continue
        const text = data.toString("latin1")
        const redacted = redactPersonalInfo(text)
        if (redacted !== text) fs.writeFileSync(file, redacted, "latin1")
    }
}

/**
 * Read the current log file, capped at MAX_LOG_LINES from the end
 * @returns {string} Log contents
 */
function collectLogs() {
    try {
        const logPath = logger.getLogFilePath()
        if (!logPath || !fs.existsSync(logPath)) return ""

        const stats = fs.statSync(logPath)
        let content

        if (stats.size <= MAX_LOG_BYTES) {
            content = fs.readFileSync(logPath, "utf-8")
        } else {
            // Read only the last MAX_LOG_BYTES bytes
            const fd = fs.openSync(logPath, "r")
            const buffer = Buffer.alloc(MAX_LOG_BYTES)
            fs.readSync(fd, buffer, 0, MAX_LOG_BYTES, stats.size - MAX_LOG_BYTES)
            fs.closeSync(fd)
            content = buffer.toString("utf-8")
        }

        // Limit to the last MAX_LOG_LINES lines
        const lines = content.split("\n")
        if (lines.length > MAX_LOG_LINES) {
            return "[...truncated to last " + MAX_LOG_LINES + " lines...]\n" + lines.slice(-MAX_LOG_LINES).join("\n")
        }

        return content
    } catch (err) {
        return `[Failed to collect logs: ${err.message}]`
    }
}

/**
 * Calculate the total size of a directory recursively
 * @param {string} dirPath - Path to directory
 * @returns {number} Total size in bytes
 */
function getDirectorySize(dirPath) {
    let total = 0
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name)
        if (entry.isDirectory()) {
            total += getDirectorySize(fullPath)
        } else {
            total += fs.statSync(fullPath).size
        }
    }
    return total
}

/** Why a package isn't sent: it's over the size limit */
function tooLarge(bytes) {
    const sizeMB = (bytes / (1024 * 1024)).toFixed(1)
    return {
        filePath: null,
        skipped: true,
        reason: `Package too large (${sizeMB} MB, limit is 50 MB)`,
    }
}

/**
 * A temporary .bpee of the package files `fill(folder)` puts in a folder,
 * with personal details taken out of them
 */
async function redactedPackageZip(fill) {
    const name = `beepee-crash-report-${Date.now()}`
    const folder = path.join(app.getPath("temp"), name)
    const tempPath = `${folder}.bpee`
    try {
        await fill(folder)
        const size = getDirectorySize(folder)
        if (size > MAX_PACKAGE_SIZE) return tooLarge(size)
        redactFolder(folder)
        await savePackageAsBpee(folder, tempPath)
        return { filePath: tempPath, skipped: false }
    } finally {
        fs.rmSync(folder, { recursive: true, force: true })
    }
}

/**
 * Create a temporary .bpee ZIP of the current package, from a copy with
 * personal details taken out of its files
 * @returns {Promise<{filePath: string|null, skipped: boolean, reason?: string}>}
 */
async function createTempPackageZip() {
    try {
        const packageDir = getCurrentPackageDir()
        if (!packageDir) {
            return { filePath: null, skipped: true, reason: "No package loaded" }
        }

        const dirSize = getDirectorySize(packageDir)
        if (dirSize > MAX_PACKAGE_SIZE) return tooLarge(dirSize)

        return await redactedPackageZip((folder) =>
            fs.cpSync(packageDir, folder, { recursive: true }),
        )
    } catch (err) {
        return {
            filePath: null,
            skipped: true,
            reason: `Failed to create package ZIP: ${err.message}`,
        }
    }
}

/**
 * Like createTempPackageZip, for a package that failed to open: `source` is
 * what was opened, a package file (unpacked again here) or an info.json
 * (its folder)
 * @returns {Promise<{filePath: string|null, skipped: boolean, reason?: string}>}
 */
async function createFailedPackageZip(source) {
    try {
        if (!source || !fs.existsSync(source)) {
            return {
                filePath: null,
                skipped: true,
                reason: "The package that failed to open isn't there anymore",
            }
        }

        if (path.basename(source).toLowerCase() === "info.json") {
            const packageDir = path.dirname(source)
            const dirSize = getDirectorySize(packageDir)
            if (dirSize > MAX_PACKAGE_SIZE) return tooLarge(dirSize)
            return await redactedPackageZip((folder) =>
                fs.cpSync(packageDir, folder, { recursive: true }),
            )
        }

        const fileSize = fs.statSync(source).size
        if (fileSize > MAX_PACKAGE_SIZE) return tooLarge(fileSize)
        return await redactedPackageZip(async (folder) => {
            fs.mkdirSync(folder, { recursive: true })
            await extractPackage(source, folder)
        })
    } catch (err) {
        return {
            filePath: null,
            skipped: true,
            reason: `Failed to create package ZIP: ${err.message}`,
        }
    }
}

/**
 * Submit a crash report to the configured endpoint
 * @param {Object} params
 * @param {string} params.userDescription - What the user was doing
 * @param {Object|null} params.errorDetails - Error info (type, message, stack, timestamp)
 * @param {string} [params.contact] - Optional Discord username for follow-up
 * @returns {Promise<{success: boolean, error?: string, reason?: string}>}
 */
async function submitCrashReport({ userDescription, errorDetails, contact }) {
    const endpoint = getCrashReportEndpoint()
    if (!endpoint) {
        return { success: false, reason: "No endpoint configured" }
    }

    return logger.section("Sending a crash report", async () => {
        let tempBpeePath = null

        try {
            // Collect all report data, without personal details
            const logs = redactPersonalInfo(collectLogs())
            const packageJson = require("../../package.json")

            // The package the report is about: the one that failed to
            // open, or else the open one
            const failedOpen = errorDetails?.type === "packageOpenFailed"
            const failed = failedOpen
                ? getFailedPackage(errorDetails.failureId)
                : null
            const packageResult = !failedOpen
                ? await createTempPackageZip()
                : failed
                  ? await createFailedPackageZip(failed.source)
                  : {
                        filePath: null,
                        skipped: true,
                        reason: "The package that failed to open is no longer known",
                    }
            tempBpeePath = packageResult.filePath

            // Build FormData
            const formData = new FormData()
            formData.append("logs", logs)
            formData.append(
                "userDescription",
                redactPersonalInfo(userDescription || ""),
            )
            formData.append("contact", (contact || "").trim())
            formData.append(
                "errorDetails",
                redactPersonalInfo(JSON.stringify(errorDetails || null)),
            )
            formData.append("appVersion", packageJson.version)
            // So BEE Bot can block a PC that spams reports (machineId.js)
            formData.append("machineId", getMachineId())
            formData.append("channel", isBeta() ? "beta" : "stable")
            formData.append("timestamp", new Date().toISOString())
            formData.append("platform", process.platform)
            formData.append("osVersion", os.release())
            formData.append("electronVersion", process.versions.electron)

            if (packageResult.skipped) {
                console.log(
                    `Skipped attaching the package: ${packageResult.reason}`,
                )
                formData.append(
                    "packageSkipped",
                    redactPersonalInfo(packageResult.reason),
                )
            }

            // Attach .bpee file if available
            if (tempBpeePath && fs.existsSync(tempBpeePath)) {
                const fileBuffer = fs.readFileSync(tempBpeePath)
                const blob = new Blob([fileBuffer], {
                    type: "application/octet-stream",
                })
                formData.append("package", blob, "crash-report-package.bpee")
            }

            // Send the report
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

            const response = await fetch(endpoint, {
                method: "POST",
                body: formData,
                signal: controller.signal,
            })

            clearTimeout(timeout)

            if (!response.ok) {
                return {
                    success: false,
                    error: `Server responded with ${response.status}: ${response.statusText}`,
                }
            }

            return { success: true }
        } catch (err) {
            if (err.name === "AbortError") {
                return { success: false, error: "Request timed out after 30 seconds" }
            }
            // Node's native fetch wraps the real error in err.cause
            const cause = err.cause
            let message = err.message
            if (cause) {
                if (cause.code === "ECONNREFUSED") {
                    message = `Connection refused - is the server running at ${endpoint}?`
                } else if (cause.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || cause.code === "SELF_SIGNED_CERT_IN_CHAIN" || cause.code === "DEPTH_ZERO_SELF_SIGNED_CERT") {
                    message = "SSL certificate error - the server has an invalid or self-signed certificate"
                } else if (cause.code === "ENOTFOUND") {
                    message = `Server not found - could not resolve ${endpoint}`
                } else if (cause.message && cause.message.includes("WRONG_VERSION_NUMBER")) {
                    message = "SSL mismatch - you're using https:// but the server expects http:// (or vice versa)"
                } else if (cause.message) {
                    message = cause.message
                }
            }
            return { success: false, error: message }
        } finally {
            // Clean up temp .bpee file
            if (tempBpeePath) {
                try {
                    if (fs.existsSync(tempBpeePath)) {
                        fs.unlinkSync(tempBpeePath)
                    }
                } catch (cleanupErr) {
                    console.warn(
                        `Failed to delete the temporary package ${tempBpeePath}:`,
                        cleanupErr,
                    )
                }
            }
        }
    })
}

module.exports = {
    submitCrashReport,
    createFailedPackageZip,
    collectLogs,
    redactPersonalInfo,
    redactFolder,
}
