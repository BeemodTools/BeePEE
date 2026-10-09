/**
 * A description as text: a VDF description is a string, or a block of lines
 * (its repeated "" keys, read as "desc_N"). Its empty lines stay, since BEE2
 * reads descriptions as Markdown, where they split paragraphs; only the ones
 * before and after the text are left out.
 */
export function descriptionText(description) {
    if (description && typeof description === "object") {
        const lines = Object.keys(description)
            .filter((key) => key.startsWith("desc_"))
            .sort((a, b) => parseInt(a.slice(5), 10) - parseInt(b.slice(5), 10))
            .map((key) => String(description[key] ?? ""))
        while (lines.length && !lines[0].trim()) lines.shift()
        while (lines.length && !lines.at(-1).trim()) lines.pop()
        return lines.join("\n")
    }
    return description ? String(description) : ""
}
