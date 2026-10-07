/**
 * bee-package.json fields (BeePM's) for the Create Package and BeePM Package
 * Info windows. The names and checks are backend/utils/beePackage.js's, which
 * checks them again when it writes the file.
 */

/** A package's name in BeePM: lowercase a-z 0-9 . _ -, 1-64, alphanumeric at both ends */
const NAME = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/

/** A version: strict semver with no "v" and no +build, as BeePM takes it */
const VERSION =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?$/

/** A BeePM name from a package's name: "Better Underground Assets" -> "better-underground-assets" */
export function beePmName(text) {
    return String(text ?? "")
        // Letters without their accents ("Ü" -> "U"), and no apostrophes
        .normalize("NFKD")
        .replace(/\p{M}/gu, "")
        .replace(/['’]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/-{2,}/g, "-")
        .slice(0, 64)
        .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
}

/** What's wrong with the BeePM name, or null */
export function nameProblem(name) {
    if (!name) return "Needs a name"
    return NAME.test(name)
        ? null
        : "Letters, numbers, - _ and ., starting and ending with a letter or number"
}

/** What's wrong with the version, or null */
export function versionProblem(version) {
    return VERSION.test(version) ? null : "Like 1.0.0"
}

/** The fields a new package starts with */
export const newBeePmFields = (packageName = "") => ({
    scope: null,
    name: beePmName(packageName),
    version: "1.0.0",
    compatibleWith: "",
    dependencies: {},
})

/** The fields to save (without what's only shown) */
export const savedBeePmFields = ({ name, version, compatibleWith, dependencies }) => ({
    name,
    version,
    compatibleWith,
    dependencies,
})
