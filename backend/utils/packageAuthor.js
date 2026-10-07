/**
 * A package's author (info.json's Author): its "made by" credit. It's set
 * when the package is made, or once when it has none, and stays after that.
 * Who may publish it is BeePM's to check (the package's owners there).
 */
const fs = require("fs")
const path = require("path")

/** Whether a package has an author ("Unknown" is what older BeePEE wrote for none) */
const hasAuthor = (author) =>
    typeof author === "string" &&
    !["", "unknown"].includes(author.trim().toLowerCase())

const infoPath = (packageDir) => path.join(packageDir, "info.json")

/** The package's author, or null when it has none */
function readAuthor(packageDir) {
    try {
        const { Author } = JSON.parse(fs.readFileSync(infoPath(packageDir), "utf8"))
        return hasAuthor(Author) ? Author.trim() : null
    } catch {
        return null
    }
}

/**
 * Give the package an author when it has none
 * @returns {boolean} whether it was set
 */
function setAuthorIfNone(packageDir, author) {
    if (!author?.trim()) return false
    const info = JSON.parse(fs.readFileSync(infoPath(packageDir), "utf8"))
    if (hasAuthor(info.Author)) return false
    info.Author = author.trim()
    fs.writeFileSync(infoPath(packageDir), JSON.stringify(info, null, 2))
    return true
}

/**
 * Whether an author names a BeePM user: their handle or display name as a
 * word in it, ignoring case and "@" ("Areng & friends" names @areng)
 * @param {{handle?: string, displayName?: string}} user
 */
function authorNames(author, { handle, displayName } = {}) {
    const text = String(author ?? "").toLowerCase()
    return [handle, displayName].some((name) => {
        const words = String(name ?? "").trim().toLowerCase().replace(/^@/, "")
        if (!words) return false
        const escaped = words.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        return new RegExp(
            `(^|[^\\p{L}\\p{N}])@?${escaped}($|[^\\p{L}\\p{N}])`,
            "u",
        ).test(text)
    })
}

module.exports = { hasAuthor, readAuthor, setAuthorIfNone, authorNames }
