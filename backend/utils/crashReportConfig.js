/**
 * Crash report endpoint configuration
 *
 * The placeholder below is replaced at build time by scripts/inject-config.js
 * Set CRASH_REPORT_ENDPOINT environment variable before running npm run build
 */

// This placeholder gets replaced at build time
// DO NOT commit an actual endpoint here - use the inject script
const CRASH_REPORT_ENDPOINT = "__CRASH_REPORT_ENDPOINT__"

/**
 * Get the crash report endpoint URL
 * @returns {string|null} The endpoint URL or null if not configured
 */
function getCrashReportEndpoint() {
    // If still placeholder or empty, return null
    if (!CRASH_REPORT_ENDPOINT || CRASH_REPORT_ENDPOINT.startsWith("__")) {
        return null
    }
    return CRASH_REPORT_ENDPOINT
}

module.exports = { getCrashReportEndpoint }
