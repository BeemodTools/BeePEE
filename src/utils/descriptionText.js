/**
 * A description as text: a VDF description is a string, or a block of lines
 * (its repeated "" keys, read as "desc_N"). Empty lines are left out.
 */
export function descriptionText(description) {
    if (description && typeof description === "object") {
        return Object.keys(description)
            .filter((key) => key.startsWith("desc_"))
            .sort((a, b) => parseInt(a.slice(5), 10) - parseInt(b.slice(5), 10))
            .map((key) => description[key])
            .filter((value) => value && String(value).trim() !== "")
            .join("\n")
            .trim()
    }
    return description ? String(description) : ""
}
