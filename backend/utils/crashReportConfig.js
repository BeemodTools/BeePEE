/**
 * Crash report endpoint configuration
 *
 * Endpoints are injected at BUILD time by scripts/inject-config.js, which
 * writes them into crashEndpoints.generated.json - a gitignored file next
 * to this one. Real URLs never live in tracked source, so they can't be
 * committed by accident. Set CRASH_REPORT_ENDPOINT (stable),
 * CRASH_REPORT_ENDPOINT_BETA (beta) and SALT (machineId.js's) in .env
 * before building.
 */

const fs = require("fs")
const path = require("path")
const { isBeta } = require("./betaInfo")

const GENERATED_FILE = path.join(__dirname, "crashEndpoints.generated.json")

function loadEndpoints() {
    try {
        return JSON.parse(fs.readFileSync(GENERATED_FILE, "utf-8"))
    } catch {
        // Missing file = endpoints not configured (e.g. dev builds)
        return {}
    }
}

/**
 * Get the crash report endpoint URL for this build's channel.
 * Beta builds use the beta endpoint, falling back to the stable one
 * if no beta endpoint was configured.
 * @returns {string|null} The endpoint URL or null if not configured
 */
function getCrashReportEndpoint() {
    const g = loadEndpoints()
    if (isBeta()) return g.endpointBeta || g.endpoint || null
    return g.endpoint || null
}

/**
 * SALT, which BeePEE's ID for the PC is hashed with (machineId.js), as the
 * build put it in
 * @returns {string|null} null in a dev run (machineId.js reads .env then)
 */
function getSalt() {
    return loadEndpoints().salt || null
}

module.exports = { getCrashReportEndpoint, getSalt }
