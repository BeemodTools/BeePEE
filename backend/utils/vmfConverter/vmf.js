/**
 * VMF reader: extracts brushes (from the world, brush entities and hidden
 * groups, in document order) and entity key/values.
 */

const { parseKeyValues, getValue, getBlocks } = require("./keyvalues")

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g

function parseNumbers(text) {
    return (String(text ?? "").match(NUMBER) || []).map(Number)
}

/** "(x y z) (x y z) (x y z)" -> three points */
function parsePlane(text) {
    const points = []
    for (const match of String(text ?? "").matchAll(/\(([^)]*)\)/g)) {
        const n = parseNumbers(match[1])
        if (n.length >= 3) points.push([n[0], n[1], n[2]])
    }
    return points.length >= 3 ? points.slice(0, 3) : null
}

/** "[x y z shift] scale" -> texture axis */
function parseTextureAxis(text) {
    const match = String(text ?? "").match(/\[([^\]]*)\]\s*(\S+)/)
    if (!match) return null
    const n = parseNumbers(match[1])
    if (n.length < 4) return null
    return { axis: [n[0], n[1], n[2]], shift: n[3], scale: Number(match[2]) }
}

/** Read the numbered "rowN" values of a displacement sub-block in row order */
function readRows(block) {
    if (!block) return []
    return block.children
        .filter(
            (node) => node.children === undefined && /^row\d+$/i.test(node.key),
        )
        .sort((a, b) => Number(a.key.slice(3)) - Number(b.key.slice(3)))
        .map((node) => parseNumbers(node.value))
}

function parseDisplacement(block) {
    const children = block.children
    const start = parseNumbers(getValue(children, "startposition"))
    const normals = readRows(getBlocks(children, "normals")[0]).map((row) => {
        const vectors = []
        for (let i = 0; i + 2 < row.length; i += 3) {
            vectors.push([row[i], row[i + 1], row[i + 2]])
        }
        return vectors
    })
    const distances = readRows(getBlocks(children, "distances")[0])
    if (start.length < 3 || normals.length < 2 || distances.length < 2) {
        return null
    }
    return {
        power: Number(getValue(children, "power")),
        startPosition: [start[0], start[1], start[2]],
        normals,
        distances,
    }
}

function parseSide(block) {
    const children = block.children
    const plane = parsePlane(getValue(children, "plane"))
    if (!plane) return null
    const dispBlock = getBlocks(children, "dispinfo")[0]
    return {
        id: getValue(children, "id") ?? "",
        plane,
        points: plane,
        material: (getValue(children, "material") ?? "")
            .replace(/\\/g, "/")
            .trim(),
        uAxis: parseTextureAxis(getValue(children, "uaxis")),
        vAxis: parseTextureAxis(getValue(children, "vaxis")),
        dispinfo: dispBlock ? parseDisplacement(dispBlock) : null,
    }
}

function parseSolid(block) {
    return {
        id: getValue(block.children, "id") ?? "",
        sides: getBlocks(block.children, "side").map(parseSide).filter(Boolean),
    }
}

function parseEntity(block) {
    const keyValues = new Map()
    for (const node of block.children) {
        if (node.children === undefined) {
            keyValues.set(node.key.toLowerCase(), node.value)
        }
    }
    return {
        classname: keyValues.get("classname") ?? "",
        keyValues,
        get(key) {
            return keyValues.get(key.toLowerCase())
        },
    }
}

/**
 * Parse VMF text
 * @param {string} text
 * @returns {{solids: Array, entities: Array}} Solids of brush entities carry
 *   their entity as `owner` (world brushes have none)
 */
function parseVmf(text) {
    const solids = []
    const entities = []

    const walk = (nodes, owner) => {
        for (const node of nodes) {
            if (node.children === undefined) continue
            const key = node.key.toLowerCase()
            if (key === "solid") {
                solids.push({ ...parseSolid(node), owner })
            } else if (key === "entity") {
                const entity = parseEntity(node)
                entities.push(entity)
                walk(node.children, entity)
            } else {
                walk(node.children, owner)
            }
        }
    }

    walk(parseKeyValues(text), null)
    return { solids, entities }
}

module.exports = { parseVmf, parseNumbers, parsePlane, parseTextureAxis }
