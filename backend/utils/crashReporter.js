const fs = require("fs")
const path = require("path")
const os = require("os")
const { app } = require("electron")
const { logger } = require("./logger")
const { getCrashReportEndpoint } = require("./crashReportConfig")
const { isBeta } = require("./betaInfo")
const { getCurrentPackageDir, savePackageAsBpee } = require("../packageManager")

const MAX_LOG_BYTES = 500 * 1024 // 500KB read buffer
const MAX_LOG_LINES = 500 // Only upload last 500 lines
const MAX_PACKAGE_SIZE = 50 * 1024 * 1024 // 50MB
const REQUEST_TIMEOUT = 30000 // 30 seconds

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

/**
 * Create a temporary .bpee ZIP of the current package
 * @returns {Promise<{filePath: string|null, skipped: boolean, reason?: string}>}
 */
async function createTempPackageZip() {
    try {
        const packageDir = getCurrentPackageDir()
        if (!packageDir) {
            return { filePath: null, skipped: true, reason: "No package loaded" }
        }

        const dirSize = getDirectorySize(packageDir)
        if (dirSize > MAX_PACKAGE_SIZE) {
            const sizeMB = (dirSize / (1024 * 1024)).toFixed(1)
            return {
                filePath: null,
                skipped: true,
                reason: `Package too large (${sizeMB} MB, limit is 50 MB)`,
            }
        }

        const tempPath = path.join(
            app.getPath("temp"),
            `beepee-crash-report-${Date.now()}.bpee`,
        )
        await savePackageAsBpee(packageDir, tempPath)
        return { filePath: tempPath, skipped: false }
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
            // Collect all report data
            const logs = collectLogs()
            const packageJson = require("../../package.json")

            const packageResult = await createTempPackageZip()
            tempBpeePath = packageResult.filePath

            // Build FormData
            const formData = new FormData()
            formData.append("logs", logs)
            formData.append("userDescription", userDescription || "")
            formData.append("contact", (contact || "").trim())
            formData.append(
                "errorDetails",
                JSON.stringify(errorDetails || null),
            )
            formData.append("appVersion", packageJson.version)
            formData.append("channel", isBeta() ? "beta" : "stable")
            formData.append("timestamp", new Date().toISOString())
            formData.append("platform", process.platform)
            formData.append("osVersion", os.release())
            formData.append("electronVersion", process.versions.electron)

            if (packageResult.skipped) {
                console.log(
                    `Skipped attaching the package: ${packageResult.reason}`,
                )
                formData.append("packageSkipped", packageResult.reason)
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

module.exports = { submitCrashReport, collectLogs }
