/**
 * The BeePM app (BeemodTools/BeePM), which publishes packages to BeePM.
 * BeePEE hands it an exported .bee_pack with a beepm://publish link; BeePM's
 * installer registers those links, and the author still reviews, agrees to
 * the terms and clicks Publish in BeePM.
 */
const fs = require("fs")
const os = require("os")
const path = require("path")
const { app, shell } = require("electron")

/** Where to get BeePM: its newest release */
const BEEPM_DOWNLOAD_URL = "https://github.com/BeemodTools/BeePM/releases/latest"

/** A BeePM handle: like GitHub usernames */
const HANDLE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/

/** Whether an app (BeePM) opens beepm:// links on this PC */
function isBeePmInstalled() {
    try {
        return app.getApplicationNameForProtocol("beepm://") !== ""
    } catch (error) {
        console.warn("Failed to check for BeePM:", error)
        return false
    }
}

/**
 * The link that opens BeePM's Publish with a .bee_pack. BeePM only takes an
 * absolute path to one .bee_pack.
 */
function beePmPublishUrl(beePackPath) {
    return `beepm://publish?file=${encodeURIComponent(beePackPath)}`
}

/** Open BeePM's Publish with a .bee_pack */
function publishWithBeePm(beePackPath) {
    return shell.openExternal(beePmPublishUrl(beePackPath))
}

/**
 * BeePM's folder, found the way BeePM finds it: BEEPM_HOME, or "beepm" in the
 * roaming app data folder
 */
function beePmHome(env = process.env) {
    if (env.BEEPM_HOME) return env.BEEPM_HOME
    const appData =
        env.APPDATA ||
        (process.platform === "darwin"
            ? path.join(os.homedir(), "Library", "Application Support")
            : env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"))
    return path.join(appData, "beepm")
}

/**
 * The handle of whoever's logged in to BeePM on this PC (the app's login,
 * else the CLI's), or null. Only the handle is taken from the login file;
 * its token is never used or kept.
 */
function beePmHandle(env = process.env) {
    const configDir = path.join(beePmHome(env), "config")
    for (const file of ["credentials-app.json", "credentials.json"]) {
        try {
            let text = fs.readFileSync(path.join(configDir, file), "utf8")
            // After a byte order mark
            if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
            const handle = JSON.parse(text)?.user?.handle
            if (typeof handle === "string" && HANDLE.test(handle)) return handle
        } catch {
            // Not logged in with this one
        }
    }
    return null
}

module.exports = {
    BEEPM_DOWNLOAD_URL,
    isBeePmInstalled,
    beePmPublishUrl,
    publishWithBeePm,
    beePmHome,
    beePmHandle,
}
