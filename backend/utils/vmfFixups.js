/**
 * The fixups instances use: the $names in their VMFs ("rendercolor"
 * "$item_color"), which BEE2 replaces with the values the item's instance
 * has. Conditions set them (Change Fixup, Get Config blocks), so the item
 * editor offers them there.
 */

const fs = require("fs")
const path = require("path")

/** A fixup's name: $ and a word */
const FIXUP = /\$([A-Za-z_][A-Za-z0-9_]*)/g

/** The fixups VMF text uses, as each is first written (BEE2 ignores case) */
function fixupsIn(text) {
    const found = new Map()
    for (const [, name] of String(text ?? "").matchAll(FIXUP)) {
        const key = name.toLowerCase()
        if (!found.has(key)) found.set(key, `$${name}`)
    }
    return [...found.values()]
}

/**
 * The fixups VMFs use, each with the files it's in
 * @param {string[]} vmfPaths
 * @returns {{name: string, files: string[]}[]} By name
 */
function fixupsOfVmfs(vmfPaths) {
    const fixups = new Map()
    for (const vmfPath of new Set(vmfPaths)) {
        let text
        try {
            text = fs.readFileSync(vmfPath, "utf8")
        } catch {
            continue
        }
        for (const name of fixupsIn(text)) {
            const key = name.toLowerCase()
            if (!fixups.has(key)) fixups.set(key, { name, files: [] })
            fixups.get(key).files.push(path.basename(vmfPath))
        }
    }
    return [...fixups.values()].sort((a, b) =>
        a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
    )
}

module.exports = { fixupsIn, fixupsOfVmfs }
