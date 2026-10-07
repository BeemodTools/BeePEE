/**
 * Where "Launch BEEMod after export" puts an exported package: a BeePEE
 * folder in the packages folder BEE2 loads (config.cfg's [Directories]
 * package). When BeePM has hooked BEE2 (pointed that setting at BeePM's
 * packages folder), its dev folder there instead, which BeePM leaves alone.
 */
const fs = require("fs")
const path = require("path")
const { beePmHome } = require("./beePmApp")

/** BEE2's settings file */
const bee2ConfigFile = (env = process.env) =>
    path.join(env.APPDATA || "", "BEEMOD2", "config", "config.cfg")

/**
 * A value in a configparser file like BEE2's config.cfg: "key = value" or
 * "key=value" (or ":") under [section], ignoring case
 */
function iniValue(text, section, key) {
    let current = null
    for (const line of String(text).split(/\r?\n/)) {
        const header = /^\s*\[([^\]]+)\]\s*$/.exec(line)
        if (header) {
            current = header[1].trim().toLowerCase()
            continue
        }
        if (current !== section.toLowerCase()) continue
        const match = /^\s*([^=:\s;#[][^=:]*?)\s*[=:]\s?(.*)$/.exec(line)
        if (match && match[1].trim().toLowerCase() === key.toLowerCase()) {
            return match[2].trim()
        }
    }
    return null
}

/** Whether two paths are the same folder (Windows ignores case) */
function samePath(a, b) {
    const normalize = (p) => {
        const resolved = path.resolve(String(p).trim())
        return process.platform === "win32" ? resolved.toLowerCase() : resolved
    }
    return Boolean(a) && Boolean(b) && normalize(a) === normalize(b)
}

/**
 * The packages folder BEE2 loads: its config.cfg's, or its own packages
 * folder. A relative one is under BEE2's folder.
 * @param {string} beemodPath - BEE2's folder
 */
function bee2PackagesDir(beemodPath, env = process.env) {
    let packagesDir = path.join(beemodPath, "packages")
    try {
        let text = fs.readFileSync(bee2ConfigFile(env), "utf8")
        // After a byte order mark
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
        const value = iniValue(text, "Directories", "package")
        if (value) {
            packagesDir = path.isAbsolute(value)
                ? value
                : path.join(beemodPath, value)
        }
    } catch (error) {
        if (error.code !== "ENOENT") {
            console.warn(
                `Failed to read BEEMod's config.cfg, using its packages folder ${packagesDir}:`,
                error,
            )
        }
    }
    return packagesDir
}

/**
 * The folder an export for BEE2 goes in
 * @param {string} beemodPath - BEE2's folder
 * @returns {{folder: string, beePm: boolean}} beePm: BeePM has hooked BEE2,
 *   so it's BeePM's packages folder's dev folder
 */
function bee2ExportFolder(beemodPath, env = process.env) {
    const packagesDir = bee2PackagesDir(beemodPath, env)
    const beePmPackages = path.join(beePmHome(env), "packages")
    if (samePath(packagesDir, beePmPackages)) {
        return { folder: path.join(beePmPackages, "dev"), beePm: true }
    }
    return { folder: path.join(packagesDir, "BeePEE"), beePm: false }
}

module.exports = { iniValue, bee2PackagesDir, bee2ExportFolder }
