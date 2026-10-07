/**
 * The BeePM app (BeemodTools/BeePM), which publishes packages to BeePM.
 * BeePEE hands it an exported .bee_pack with a beepm://publish link; BeePM's
 * installer registers those links, and the author still reviews, agrees to
 * the terms and clicks Publish in BeePM.
 */
const { app, shell } = require("electron")

/** Where to get BeePM: its newest release */
const BEEPM_DOWNLOAD_URL = "https://github.com/BeemodTools/BeePM/releases/latest"

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

module.exports = {
    BEEPM_DOWNLOAD_URL,
    isBeePmInstalled,
    beePmPublishUrl,
    publishWithBeePm,
}
