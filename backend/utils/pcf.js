/**
 * Particle files (.pcf): binary DMX, read like srctools reads them. What
 * autopacking needs from one: the particle systems it defines (by name, as
 * info_particle_system's effect_name names them), and the materials and
 * models they draw with.
 */

/** Sizes of DMX attribute values with a fixed size, by type */
const VALUE_SIZES = {
    2: 4, // int
    3: 4, // float
    4: 1, // bool
    7: 4, // time
    8: 4, // color
    9: 8, // vector2
    10: 12, // vector3
    11: 16, // vector4
    12: 12, // angle
    13: 16, // quaternion
    14: 64, // matrix
}
const ELEMENT = 1
const STRING = 5
const BINARY = 6
/** Array types are the single value's type plus this */
const ARRAY_OFFSET = 14

/**
 * Read a binary DMX file (encodings 1 to 5, which Source 1 games write)
 * @param {Buffer} buffer
 * @returns {{format: string, elements: {type: string, name: string, attributes: Map<string, *>}[]}}
 *   Element attributes are their values: arrays for array attributes,
 *   element indexes for element ones
 * @throws {Error} when it isn't binary DMX
 */
function readDmx(buffer) {
    const headerEnd = buffer.indexOf(0x0a)
    const header =
        headerEnd > 0 ? buffer.toString("latin1", 0, headerEnd) : ""
    const match =
        /<!--\s*dmx encoding binary (\d+) format (\S+) \d+\s*-->/.exec(header)
    if (!match) throw new Error("Not a binary DMX file")
    const version = Number(match[1])
    let at = headerEnd + 2 // the header's newline and a null

    const need = (bytes) => {
        if (at + bytes > buffer.length) throw new Error("The file ends early")
    }
    const int = () => {
        need(4)
        const value = buffer.readInt32LE(at)
        at += 4
        return value
    }
    const short = () => {
        need(2)
        const value = buffer.readInt16LE(at)
        at += 2
        return value
    }
    const text = () => {
        const end = buffer.indexOf(0, at)
        if (end === -1) throw new Error("The file ends early")
        const value = buffer.toString("utf8", at, end)
        at = end + 1
        return value
    }

    // Names, types and (from encoding 4) strings are in a table
    let table = null
    let tableIndex = null
    if (version >= 2) {
        const count = version >= 4 ? int() : short()
        tableIndex = version >= 5 ? int : short
        table = []
        for (let i = 0; i < count; i++) table.push(text())
    }
    const fromTable = () => {
        const value = table[tableIndex()]
        if (value === undefined) throw new Error("A string isn't in its table")
        return value
    }

    const elementCount = int()
    if (elementCount < 0 || elementCount > buffer.length) {
        throw new Error("Wrong element count")
    }
    const elements = []
    for (let i = 0; i < elementCount; i++) {
        const type = table ? fromTable() : text()
        const name = table && version >= 4 ? fromTable() : text()
        need(16)
        at += 16 // Its ID
        elements.push({ type, name, attributes: new Map() })
    }

    for (const element of elements) {
        const count = int()
        for (let a = 0; a < count; a++) {
            const name = table ? fromTable() : text()
            need(1)
            const typeId = buffer[at++]
            const isArray = typeId > ARRAY_OFFSET
            const type = isArray ? typeId - ARRAY_OFFSET : typeId
            const value = (inArray) => {
                if (type === ELEMENT) {
                    const index = int()
                    // -2: an element in another file, by its ID
                    if (index === -2) return { id: text() }
                    return index
                }
                if (type === STRING) {
                    return !inArray && table && version >= 4
                        ? fromTable()
                        : text()
                }
                if (type === BINARY) {
                    const size = int()
                    need(size)
                    at += size
                    return null
                }
                const size = VALUE_SIZES[type]
                if (!size) throw new Error(`Unknown attribute type ${typeId}`)
                need(size)
                const start = at
                at += size
                if (type === 2) return buffer.readInt32LE(start)
                if (type === 3) return buffer.readFloatLE(start)
                if (type === 4) return buffer[start] !== 0
                return null
            }
            if (isArray) {
                const length = int()
                if (length < 0 || length > buffer.length) {
                    throw new Error("Wrong array length")
                }
                const values = []
                for (let i = 0; i < length; i++) values.push(value(true))
                element.attributes.set(name, values)
            } else {
                element.attributes.set(name, value(false))
            }
        }
    }
    return { format: match[2], elements }
}

/** A path relative to a content folder as a content path ("particle\\x.vmt" -> "materials/particle/x.vmt") */
function contentPath(folder, value, extension) {
    let file = String(value ?? "")
        .trim()
        .replace(/\\/g, "/")
        .replace(/^\/+/, "")
        .toLowerCase()
    if (!file) return null
    if (!file.startsWith(`${folder}/`)) file = `${folder}/${file}`
    return file.endsWith(extension) ? file : `${file}${extension}`
}

/**
 * What a particle file has: the particle systems it defines, and the
 * materials and models they draw with (all of its systems: the whole file is
 * packed)
 * @param {Buffer} buffer
 * @returns {{systems: string[], materials: string[], models: string[]}}
 *   Systems by lowercase name; materials and models as content paths
 *   ("materials/particle/x.vmt", "models/x.mdl")
 * @throws {Error} when it isn't a particle file
 */
function readPcf(buffer) {
    const { elements } = readDmx(buffer)
    const systems = new Set()
    const materials = new Set()
    const models = new Set()
    for (const element of elements) {
        if (element.type === "DmeParticleSystemDefinition") {
            systems.add(element.name.toLowerCase())
            const material = contentPath(
                "materials",
                element.attributes.get("material"),
                ".vmt",
            )
            if (material) materials.add(material)
        } else if (element.type === "DmeParticleOperator") {
            // The "Render models" renderer: "sequence 0 model", ...
            for (const [name, value] of element.attributes) {
                if (!/^sequence \d+ model$/i.test(name)) continue
                const model = contentPath("models", value, ".mdl")
                if (model) models.add(model)
            }
        }
    }
    return {
        systems: [...systems].sort(),
        materials: [...materials].sort(),
        models: [...models].sort(),
    }
}

module.exports = { readDmx, readPcf }
