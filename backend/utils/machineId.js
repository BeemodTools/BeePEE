/**
 * BeePEE's ID for the PC it runs on, sent with bug reports so BEE Bot can
 * block one that spams them. It's a hash of the PC's own ID (Windows'
 * MachineGuid, macOS' IOPlatformUUID, Linux's machine-id): the same every
 * time, also when BeePEE is reinstalled, but it can't be turned back into
 * the PC's ID or say anything about the PC. Where that can't be read, it's
 * made from a random one kept in BeePEE's settings.
 *
 * Not from the hardware's serial numbers: reading them is slow, and many
 * boards and VMs have none ("To be filled by O.E.M."), which would give those
 * PCs all the same ID.
 */

const crypto = require("crypto")
const fs = require("fs")
const path = require("path")
const { execFileSync } = require("child_process")
const { getSetting, setSetting } = require("./settings")

/** Hashed with the PC's ID: BeePEE's hash of it isn't any other app's */
const SALT = "beepee-machine-id"

/** The PC's own ID, or null when it can't be read */
function readPcId() {
    try {
        if (process.platform === "win32") {
            const reg = path.join(
                process.env.windir || "C:\\Windows",
                "System32",
                "reg.exe",
            )
            const out = execFileSync(
                reg,
                [
                    "query",
                    "HKLM\\SOFTWARE\\Microsoft\\Cryptography",
                    "/v",
                    "MachineGuid",
                    // The 64-bit registry's, from a 32-bit BeePEE too
                    "/reg:64",
                ],
                { encoding: "utf8", windowsHide: true, timeout: 5000 },
            )
            return out.match(/MachineGuid\s+REG_SZ\s+(\S+)/i)?.[1] ?? null
        }
        if (process.platform === "darwin") {
            const out = execFileSync(
                "ioreg",
                ["-rd1", "-c", "IOPlatformExpertDevice"],
                { encoding: "utf8", timeout: 5000 },
            )
            return out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1] ?? null
        }
        for (const file of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
            if (fs.existsSync(file)) {
                return fs.readFileSync(file, "utf8").trim() || null
            }
        }
    } catch (error) {
        console.warn(`Couldn't read this PC's ID: ${error.message}`)
    }
    return null
}

let machineId = null

/** BeePEE's ID for this PC: 16 hex characters */
function getMachineId() {
    if (machineId) return machineId
    let source = readPcId()
    if (!source) {
        source = getSetting("machineIdSeed")
        if (!source) {
            source = crypto.randomUUID()
            setSetting("machineIdSeed", source)
        }
    }
    machineId = crypto
        .createHash("sha256")
        .update(`${SALT}:${source}`)
        .digest("hex")
        .slice(0, 16)
    return machineId
}

module.exports = { getMachineId }
