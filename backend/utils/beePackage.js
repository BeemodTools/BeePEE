/**
 * A package's bee-package.json: what BeePM (the BEE2 package registry,
 * BeemodTools/BeePM) needs to publish it, at the package's root next to
 * info.txt. BeePEE writes the fields people pick and leaves the rest to their
 * defaults: the display name and description come from info.txt, the scope
 * (@handle/) from whoever publishes, and the BEE2 ID always from info.txt.
 * The checks here are BeePM's own (its core/src/manifest.js and names.js).
 */

const fs = require("fs")
const path = require("path")

const FILE = "bee-package.json"

/** The registry: BEEPM_REGISTRY_URL to use another (like a local one) */
const REGISTRY_URL = (
    process.env.BEEPM_REGISTRY_URL || "https://beepm.beemodtools.org"
).replace(/\/+$/, "")

/** A package's name in BeePM: lowercase a-z 0-9 . _ -, 1-64, alphanumeric at both ends */
const NAME = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/

/** A BeePM handle (the scope in @scope/name): like GitHub usernames */
const HANDLE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/

/** BEE2's own packages are @beemod/<BEE2 ID> */
const BUILTIN_SCOPE = "beemod"
const BEE_ID = /^[A-Z0-9_]{1,128}$/

/** A version: strict semver with no "v" and no +build, as BeePM takes it */
const VERSION =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?$/

/** A BeePM name from a package's name: "Better Underground Assets" -> "better-underground-assets" */
function beePmName(text) {
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

/** A name without its @scope/ */
const withoutScope = (name) => String(name ?? "").replace(/^@[^/]+\//, "")

/** The handle in a "@scope/name", or null */
function scopeOf(name) {
    const scope = /^@([^/@\s]+)\//.exec(String(name ?? "").trim())?.[1]
    return scope && HANDLE.test(scope.toLowerCase()) ? scope.toLowerCase() : null
}

/** "@scope/name" as BeePM reads one ({ scope, name }), or null if it isn't one */
function parsePackageName(fullName) {
    const match = /^@([^/@\s]+)\/([^/@\s]+)$/.exec(String(fullName ?? "").trim())
    if (!match) return null
    const scope = match[1].toLowerCase()
    const builtIn = scope === BUILTIN_SCOPE
    const name = builtIn ? match[2].toUpperCase() : match[2].toLowerCase()
    if (!HANDLE.test(scope) || !(builtIn ? BEE_ID : NAME).test(name)) {
        return null
    }
    return { scope, name }
}

/**
 * What's wrong with the fields people set, or null
 * @param {{name: string, version: string, compatibleWith?: string, dependencies?: Object}} fields
 */
function problemWith({ name, version, compatibleWith, dependencies }) {
    if (!NAME.test(withoutScope(name).trim().toLowerCase())) {
        return "The BeePM name can only have letters, numbers, - _ and ., up to 64, starting and ending with a letter or number"
    }
    if (!VERSION.test(String(version ?? ""))) {
        return "The version has to be like 1.0.0"
    }
    if (compatibleWith != null && typeof compatibleWith !== "string") {
        return "The BEE2 versions it works with aren't text"
    }
    if (dependencies != null && (typeof dependencies !== "object" || Array.isArray(dependencies))) {
        return "The packages it needs aren't a list of names"
    }
    for (const [dependency, range] of Object.entries(dependencies ?? {})) {
        if (!parsePackageName(dependency) || (range != null && typeof range !== "string")) {
            return `"${dependency}" isn't a BeePM package it can need`
        }
    }
    return null
}

/** A package folder's bee-package.json as it is, or null */
function readFile(packageDir) {
    try {
        let text = fs.readFileSync(path.join(packageDir, FILE), "utf8")
        // After a byte order mark
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
        const json = JSON.parse(text)
        return json && typeof json === "object" && !Array.isArray(json)
            ? json
            : null
    } catch {
        return null
    }
}

/**
 * The fields to show for a package: from its bee-package.json, or made from
 * its name (info.json's) when it has none. A name written by older BeePEE
 * (the display name) becomes a BeePM name, and a list of BEE2 versions
 * becomes a range ("2.4.45 || 2.4.46"), like BeePM's own editor does.
 * @returns {{scope: string|null, name: string, version: string, compatibleWith: string, dependencies: Object, exists: boolean}}
 */
function readBeePackage(packageDir, packageName) {
    const file = readFile(packageDir)
    const name = withoutScope(file?.name).trim().toLowerCase()
    const compatibleWith = Array.isArray(file?.compatibleWith)
        ? file.compatibleWith.join(" || ")
        : file?.compatibleWith
    const dependencies = file?.dependencies
    return {
        scope: scopeOf(file?.name),
        name: NAME.test(name)
            ? name
            : beePmName(withoutScope(file?.name) || packageName),
        version: VERSION.test(String(file?.version ?? "").trim())
            ? file.version.trim()
            : "1.0.0",
        compatibleWith:
            typeof compatibleWith === "string" ? compatibleWith.trim() : "",
        dependencies:
            dependencies && typeof dependencies === "object" && !Array.isArray(dependencies)
                ? dependencies
                : {},
        exists: file !== null,
    }
}

/**
 * Write a package's bee-package.json with the fields people set. A scope the
 * file had (@handle/) stays, and so do fields BeePEE doesn't set
 * (display_name, description); the old ones BeePM ignores or checks against
 * the publisher (id, author) go, so the scope is the publisher's handle.
 * @throws {Error} when a field isn't valid (problemWith)
 */
function writeBeePackage(packageDir, fields) {
    const problem = problemWith(fields)
    if (problem) throw new Error(problem)
    const { id: _id, author: _author, ...kept } = readFile(packageDir) ?? {}
    const scope = scopeOf(kept.name)
    const name = withoutScope(fields.name).trim().toLowerCase()
    const beePackage = {
        ...kept,
        name: scope ? `@${scope}/${name}` : name,
        version: fields.version,
    }
    delete beePackage.compatibleWith
    delete beePackage.dependencies
    if (fields.compatibleWith?.trim()) {
        beePackage.compatibleWith = fields.compatibleWith.trim()
    }
    if (Object.keys(fields.dependencies ?? {}).length > 0) {
        beePackage.dependencies = fields.dependencies
    }
    fs.writeFileSync(
        path.join(packageDir, FILE),
        `${JSON.stringify(beePackage, null, 4)}\n`,
    )
    return beePackage
}

/** Compare two versions by semver's precedence: < 0 when a is older than b */
function compareVersions(a, b) {
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

/** GET a registry path's JSON (null when BeePM doesn't have it) */
async function registryJson(pathAndQuery) {
    const response = await fetch(`${REGISTRY_URL}${pathAndQuery}`, {
        signal: AbortSignal.timeout(8000),
    })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`BeePM answered ${response.status}`)
    return response.json()
}

/**
 * The package BeePM has with a BEE2 ID, and its highest version: found the
 * way BeePM finds it when it suggests a new version (one package with that
 * ID, every version it lists)
 * @returns {Promise<{name: string, version: string|null}|null>} null when
 *   BeePM has none (or more than one)
 * @throws {Error} when BeePM can't be reached
 */
async function publishedOnBeePm(beeId) {
    if (!String(beeId ?? "").trim()) return null
    const lookup = await registryJson(
        `/v1/lookup?beeId=${encodeURIComponent(String(beeId).trim())}`,
    )
    const names = lookup?.packages ?? []
    if (names.length !== 1) return null
    const parsed = parsePackageName(names[0])
    if (!parsed) return null
    const doc = await registryJson(
        `/v1/packages/${parsed.scope}/${encodeURIComponent(parsed.name)}`,
    )
    const versions = Object.keys(doc?.versions ?? {}).filter((v) => VERSION.test(v))
    return {
        name: names[0],
        version: versions.sort(compareVersions).pop() ?? null,
    }
}

/**
 * Packages in BeePM that match a search (all of them for "")
 * @returns {Promise<{name: string, displayName: string, latest: string|null, beeId: string|null}[]>}
 * @throws {Error} when BeePM can't be reached
 */
async function searchBeePm(query, { limit = 20 } = {}) {
    const url = `${REGISTRY_URL}/v1/packages?q=${encodeURIComponent(String(query ?? "").trim())}&limit=${limit}`
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!response.ok) throw new Error(`BeePM answered ${response.status}`)
    const { packages = [] } = await response.json()
    return packages.map((p) => {
        const name = String(p.name).startsWith("@")
            ? p.name
            : `@${p.scope}/${p.name}`
        return {
            name,
            displayName: p.displayName || name,
            latest: p.latest || null,
            beeId: p.beeId || null,
        }
    })
}

module.exports = {
    FILE,
    beePmName,
    problemWith,
    readBeePackage,
    writeBeePackage,
    searchBeePm,
    compareVersions,
    publishedOnBeePm,
}
