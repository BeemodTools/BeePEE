/**
 * bee-package.json fields (BeePM's) for the Create Package and Package
 * Information windows. The names and checks are backend/utils/beePackage.js's,
 * which checks them again when it writes the file.
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

/** Compare two versions by semver's precedence: < 0 when a is older than b */
export function compareVersions(a, b) {
    const parse = (version) => {
        const [core, pre] = String(version).split("+")[0].split(/-(.*)/s)
        return { parts: core.split(".").map(Number), pre: pre ? pre.split(".") : [] }
    }
    const x = parse(a)
    const y = parse(b)
    for (let i = 0; i < 3; i++) {
        if (x.parts[i] !== y.parts[i]) return x.parts[i] - y.parts[i]
    }
    // A prerelease comes before its release
    if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length
    for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
        const [p, q] = [x.pre[i], y.pre[i]]
        if (p === undefined || q === undefined) return p === undefined ? -1 : 1
        if (p === q) continue
        const [pNumber, qNumber] = [/^\d+$/.test(p), /^\d+$/.test(q)]
        if (pNumber && qNumber) return Number(p) - Number(q)
        // Numbers come before words
        if (pNumber !== qNumber) return pNumber ? -1 : 1
        return p < q ? -1 : 1
    }
    return 0
}

/**
 * The version after one BeePM has, the way BeePM picks it (semver's patch
 * bump): 1.0.1 -> 1.0.2, and 2.0.0-beta.1 -> 2.0.0
 */
export function nextVersion(version) {
    const [major, minor, patch] = String(version).split(/[-+]/)[0].split(".").map(Number)
    return /-/.test(String(version).split("+")[0])
        ? `${major}.${minor}.${patch}`
        : `${major}.${minor}.${patch + 1}`
}

/**
 * What's wrong with the version, or null. publishedVersion: the highest one
 * BeePM has, which it has to be newer than.
 */
export function versionProblem(version, publishedVersion = null) {
    if (!VERSION.test(version)) return "Like 1.0.0"
    if (publishedVersion && compareVersions(version, publishedVersion) <= 0) {
        return `BeePM has ${publishedVersion}`
    }
    return null
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
