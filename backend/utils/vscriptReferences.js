/**
 * What a VScript (Squirrel, .nut) uses that has to be packed with it, read
 * from its code (comments left out): the scripts it includes or runs, the
 * particle systems it starts, and the files it names (models, materials,
 * sounds).
 */

/** Leading characters that set how a sound plays: ")ambient/x.wav" */
const SOUND_CHARS = /^[*#@><^)}$!?&~]+/

/** Squirrel code with its comments (//, # and /* *\/) blanked, strings kept */
function withoutComments(source) {
    let code = ""
    let at = 0
    while (at < source.length) {
        const char = source[at]
        const next = source[at + 1]
        if ((char === "/" && next === "/") || char === "#") {
            while (at < source.length && source[at] !== "\n") at++
        } else if (char === "/" && next === "*") {
            const end = source.indexOf("*/", at + 2)
            at = end === -1 ? source.length : end + 2
            code += " "
        } else if (char === "@" && next === '"') {
            // A verbatim string: "" is a quote in it
            let end = at + 2
            while (end < source.length) {
                if (source[end] === '"' && source[end + 1] !== '"') break
                end += source[end] === '"' ? 2 : 1
            }
            code += source.slice(at, end + 1)
            at = end + 1
        } else if (char === '"' || char === "'") {
            let end = at + 1
            while (end < source.length && source[end] !== char) {
                if (source[end] === "\n") break
                end += source[end] === "\\" ? 2 : 1
            }
            code += source.slice(at, end + 1)
            at = end + 1
        } else {
            code += char
            at++
        }
    }
    return code
}

/** A string literal's text as its value: "a\\b" is a\b */
const unescape = (text) => text.replace(/\\(.)/g, "$1")

/** A path as a content path under folder, with extension when it has none */
function underFolder(folder, value, extension) {
    let file = String(value)
        .trim()
        .replace(/\\/g, "/")
        .replace(/\/{2,}/g, "/")
        .replace(/^\/+/, "")
        .toLowerCase()
    if (!file) return null
    if (!file.startsWith(`${folder}/`)) file = `${folder}/${file}`
    return /\.[a-z0-9]+$/.test(file.slice(file.lastIndexOf("/"))) ||
        !extension
        ? file
        : `${file}${extension}`
}

/** The first string argument of calls to these functions: "Name(\"value\"" */
function firstArguments(code, names) {
    const pattern = new RegExp(
        `\\b(?:${names.join("|")})\\s*\\(\\s*@?"([^"\\n]+)"`,
        "g",
    )
    return [...code.matchAll(pattern)].map((match) => unescape(match[1]))
}

/**
 * What a script uses
 * @param {string} source - Its code
 * @returns {{scripts: string[], particles: string[], models: string[], materials: string[], sounds: string[]}}
 *   Scripts, models, materials and sounds as content paths
 *   ("scripts/vscripts/x.nut", "models/x.mdl", ...), particle systems by
 *   lowercase name
 */
function vscriptReferences(source) {
    const code = withoutComments(String(source ?? ""))
    const scripts = new Set()
    const particles = new Set()
    const models = new Set()
    const materials = new Set()
    const sounds = new Set()

    // IncludeScript("x"), DoIncludeScript("x", scope), and running one:
    // EntFire(target, "RunScriptFile", "x.nut")
    const included = [
        ...firstArguments(code, ["IncludeScript", "DoIncludeScript"]),
        ...[
            ...code.matchAll(/"RunScriptFile"\s*,\s*@?"([^"\n]+)"/gi),
        ].map((match) => unescape(match[1])),
    ]
    for (const name of included) {
        const script = underFolder(
            "scripts/vscripts",
            name.replace(/^scripts[\\/]vscripts[\\/]/i, ""),
            ".nut",
        )
        if (script) scripts.add(script)
    }

    for (const name of firstArguments(code, [
        "DispatchParticleEffect",
        "PrecacheParticleSystem",
    ])) {
        particles.add(name.trim().toLowerCase())
    }

    // Strings naming files: "models/x.mdl", "x.vmt", ")ambient/x.wav"
    for (const [, value] of code.matchAll(
        /"([^"\n]*\.(?:mdl|vmt|wav|mp3|ogg))"/gi,
    )) {
        const file = unescape(value).trim()
        if (/\.mdl$/i.test(file)) {
            models.add(underFolder("models", file))
        } else if (/\.vmt$/i.test(file)) {
            materials.add(underFolder("materials", file))
        } else {
            sounds.add(underFolder("sound", file.replace(SOUND_CHARS, "")))
        }
    }

    const list = (values) => [...values].filter(Boolean).sort()
    return {
        scripts: list(scripts),
        particles: list(particles),
        models: list(models),
        materials: list(materials),
        sounds: list(sounds),
    }
}

module.exports = { vscriptReferences, withoutComments }
