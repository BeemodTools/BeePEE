/**
 * Injects crash report endpoints before build
 * Run with: node scripts/inject-config.js
 *
 * Reads CRASH_REPORT_ENDPOINT, CRASH_REPORT_ENDPOINT_BETA and SALT from
 * .env (or environment) and writes them to a GITIGNORED generated file that
 * crashReportConfig.js reads at runtime. Tracked source is never touched,
 * so the real values can't be committed by accident.
 */

const fs = require("fs")
const path = require("path")
const dotenv = require("dotenv")

const GENERATED_FILE = path.join(
    __dirname,
    "..",
    "backend",
    "utils",
    "crashEndpoints.generated.json",
)
const ENV_FILE = path.join(__dirname, "..", ".env")

function injectConfig() {
    // .env, under the environment: variables set there take precedence
    dotenv.config({ path: ENV_FILE, quiet: true })
    const endpoint = process.env.CRASH_REPORT_ENDPOINT
    const endpointBeta = process.env.CRASH_REPORT_ENDPOINT_BETA
    // What BeePEE's ID for the PC is hashed with (backend/utils/machineId.js)
    const salt = process.env.SALT

    if (!endpoint) {
        console.warn(
            "WARN: CRASH_REPORT_ENDPOINT not set - crash reporting will be disabled in this build",
        )
        console.warn("      Set it in .env file or as environment variable")
    }
    if (!endpointBeta) {
        console.warn(
            "WARN: CRASH_REPORT_ENDPOINT_BETA not set - beta builds will fall back to the stable endpoint",
        )
    }

    if (!salt) {
        console.warn(
            "WARN: SALT not set - bug reports from this build won't have a machine ID",
        )
    }

    const out = {}
    if (endpoint) out.endpoint = endpoint
    if (endpointBeta) out.endpointBeta = endpointBeta
    if (salt) out.salt = salt

    fs.writeFileSync(GENERATED_FILE, JSON.stringify(out, null, 4), "utf-8")
    console.log(
        `OK: Wrote crash report endpoints to ${path.basename(GENERATED_FILE)} (gitignored)`,
    )
}

injectConfig()
