/**
 * A particle file (.pcf, binary DMX) for tests: particle systems with a
 * material, and models drawn by a "Render models" renderer
 * @param {{name: string, material?: string, models?: string[]}[]} systems
 * @param {{version?: number}} [options] - The DMX encoding: 2 (the game's
 *   older files, strings written out) or 5 (newer ones, strings in a table)
 * @returns {Buffer}
 */
function buildPcf(systems, { version = 5 } = {}) {
    // Elements: the root, then each system and its renderer
    const elements = [
        { type: "DmElement", name: "untitled", attributes: [] },
    ]
    const root = elements[0]
    const systemIndexes = []
    for (const system of systems) {
        const index = elements.length
        systemIndexes.push(index)
        const definition = {
            type: "DmeParticleSystemDefinition",
            name: system.name,
            attributes: [
                ["max_particles", "int", 16],
                ["material", "string", system.material ?? ""],
                ["color", "color", null],
                ["cull_radius", "vector3", null],
            ],
        }
        elements.push(definition)
        const renderers = []
        if (system.models?.length) {
            renderers.push(elements.length)
            elements.push({
                type: "DmeParticleOperator",
                name: "Render models",
                attributes: [
                    ["functionName", "string", "Render models"],
                    ...system.models.map((model, i) => [
                        `sequence ${i} model`,
                        "string",
                        model,
                    ]),
                    ["orient model z to normal", "bool", false],
                ],
            })
        }
        definition.attributes.push(["renderers", "elements", renderers])
        definition.attributes.push(["operators", "strings", ["unused"]])
    }
    root.attributes.push([
        "particleSystemDefinitions",
        "elements",
        systemIndexes,
    ])

    // The string table: types and attribute names, and from encoding 4
    // element names and (single) string values too
    const table = []
    const tableIndex = new Map()
    const intern = (text) => {
        if (!tableIndex.has(text)) {
            tableIndex.set(text, table.length)
            table.push(text)
        }
        return tableIndex.get(text)
    }
    for (const element of elements) {
        intern(element.type)
        if (version >= 4) intern(element.name)
        for (const [name, kind, value] of element.attributes) {
            intern(name)
            if (version >= 4 && kind === "string") intern(value)
        }
    }

    const parts = []
    const int = (value) => {
        const b = Buffer.alloc(4)
        b.writeInt32LE(value)
        parts.push(b)
    }
    const index = (text) => {
        const b = Buffer.alloc(version >= 5 ? 4 : 2)
        if (version >= 5) b.writeInt32LE(intern(text))
        else b.writeInt16LE(intern(text))
        parts.push(b)
    }
    const inline = (text) => parts.push(Buffer.from(`${text}\0`, "utf8"))
    const byte = (value) => parts.push(Buffer.from([value]))

    parts.push(
        Buffer.from(
            `<!-- dmx encoding binary ${version} format pcf ${version >= 5 ? 2 : 1} -->\n\0`,
            "latin1",
        ),
    )
    if (version >= 4) int(table.length)
    else {
        const b = Buffer.alloc(2)
        b.writeInt16LE(table.length)
        parts.push(b)
    }
    for (const text of table) inline(text)

    int(elements.length)
    for (const element of elements) {
        index(element.type)
        if (version >= 4) index(element.name)
        else inline(element.name)
        parts.push(Buffer.alloc(16, elements.indexOf(element)))
    }
    for (const element of elements) {
        int(element.attributes.length)
        for (const [name, kind, value] of element.attributes) {
            index(name)
            if (kind === "int") {
                byte(2)
                int(value)
            } else if (kind === "bool") {
                byte(4)
                byte(value ? 1 : 0)
            } else if (kind === "string") {
                byte(5)
                if (version >= 4) index(value)
                else inline(value)
            } else if (kind === "color") {
                byte(8)
                parts.push(Buffer.from([255, 128, 0, 255]))
            } else if (kind === "vector3") {
                byte(10)
                parts.push(Buffer.alloc(12))
            } else if (kind === "elements") {
                byte(15)
                int(value.length)
                for (const i of value) int(i)
            } else if (kind === "strings") {
                // String arrays are always written out
                byte(19)
                int(value.length)
                for (const text of value) inline(text)
            }
        }
    }
    return Buffer.concat(parts)
}

module.exports = { buildPcf }
