/**
 * OBJ to 3DS conversion for the puzzle editor's collision/selection models
 * (replaces the Python convert_obj_to_3ds.exe and writes the same bytes).
 *
 * The 3DS holds one triangle mesh object named "collision": vertices are
 * scaled, then rotated by roll (X), pitch (Y) and yaw (Z) in degrees.
 * Polygons are split into triangle fans. 3DS counts are 16-bit, so bigger
 * meshes are split into several objects ("collision", "collision2", ...).
 */

const fs = require("fs")
const path = require("path")

/** Most vertices or faces one 3DS object can hold */
const MAX_COUNT = 0xffff

// Degrees to radians the way Python's math.radians does it
const DEG_TO_RAD = Math.PI / 180

function rotate(x, y, z, roll, pitch, yaw) {
    const cosRoll = Math.cos(roll * DEG_TO_RAD)
    const sinRoll = Math.sin(roll * DEG_TO_RAD)
    const yRolled = y * cosRoll - z * sinRoll
    const zRolled = y * sinRoll + z * cosRoll

    const cosPitch = Math.cos(pitch * DEG_TO_RAD)
    const sinPitch = Math.sin(pitch * DEG_TO_RAD)
    const xPitched = x * cosPitch + zRolled * sinPitch
    const zPitched = -x * sinPitch + zRolled * cosPitch

    const cosYaw = Math.cos(yaw * DEG_TO_RAD)
    const sinYaw = Math.sin(yaw * DEG_TO_RAD)
    return [
        xPitched * cosYaw - yRolled * sinYaw,
        xPitched * sinYaw + yRolled * cosYaw,
        zPitched,
    ]
}

/**
 * Vertices (scaled and rotated) and triangles of an OBJ
 * @returns {{vertices: number[][], faces: number[][]}}
 */
function parseObj(text, { scale = 1, roll = 0, pitch = 0, yaw = 0 } = {}) {
    const vertices = []
    const faces = []
    for (const rawLine of text.split("\n")) {
        const line = rawLine.trim()
        if (line.startsWith("v ")) {
            const parts = line.split(/\s+/)
            if (parts.length >= 4) {
                const [x, y, z] = parts.slice(1, 4).map(Number)
                vertices.push(
                    rotate(x * scale, y * scale, z * scale, roll, pitch, yaw),
                )
            }
        } else if (line.startsWith("f ")) {
            const indices = line
                .split(/\s+/)
                .slice(1)
                .map((part) => Number.parseInt(part.split("/")[0], 10) - 1)
            for (let i = 1; i + 1 < indices.length; i++) {
                faces.push([indices[0], indices[i], indices[i + 1]])
            }
        }
    }
    if (!vertices.length) throw new Error("No vertices found in OBJ file")
    if (!faces.length) throw new Error("No faces found in OBJ file")
    return { vertices, faces }
}

/** A 3DS chunk: id, length (including the 6-byte header) and contents */
function chunk(id, ...contents) {
    const header = Buffer.alloc(6)
    const length = contents.reduce((sum, part) => sum + part.length, 6)
    header.writeUInt16LE(id, 0)
    header.writeUInt32LE(length, 2)
    return Buffer.concat([header, ...contents])
}

function meshObject(name, vertices, faces) {
    const vertexData = Buffer.alloc(2 + vertices.length * 12)
    vertexData.writeUInt16LE(vertices.length, 0)
    vertices.forEach((vertex, i) => {
        for (let c = 0; c < 3; c++) {
            vertexData.writeFloatLE(vertex[c], 2 + i * 12 + c * 4)
        }
    })
    const faceData = Buffer.alloc(2 + faces.length * 8)
    faceData.writeUInt16LE(faces.length, 0)
    faces.forEach((face, i) => {
        for (let c = 0; c < 3; c++)
            faceData.writeUInt16LE(face[c], 2 + i * 8 + c * 2)
        // Face flags (8 bytes per face: 3 indices and flags)
        faceData.writeUInt16LE(0, 2 + i * 8 + 6)
    })
    return chunk(
        0x4000,
        Buffer.from(`${name}\0`, "latin1"),
        chunk(0x4100, chunk(0x4110, vertexData), chunk(0x4120, faceData)),
    )
}

/** Split a mesh into parts with at most MAX_COUNT vertices and faces each */
function splitMesh(vertices, faces) {
    if (vertices.length <= MAX_COUNT && faces.length <= MAX_COUNT) {
        return [{ vertices, faces }]
    }
    const parts = []
    let part = null
    let remap = null
    for (const face of faces) {
        const added = face.filter((index) => !remap?.has(index)).length
        if (
            !part ||
            part.faces.length >= MAX_COUNT ||
            part.vertices.length + added > MAX_COUNT
        ) {
            part = { vertices: [], faces: [] }
            remap = new Map()
            parts.push(part)
        }
        part.faces.push(
            face.map((index) => {
                if (!remap.has(index)) {
                    remap.set(index, part.vertices.length)
                    part.vertices.push(vertices[index])
                }
                return remap.get(index)
            }),
        )
    }
    return parts
}

/**
 * Build a 3DS file from OBJ text
 * @param {string} text - OBJ contents
 * @param {{scale?: number, roll?: number, pitch?: number, yaw?: number}} options
 * @returns {Buffer}
 */
function objTo3ds(text, options = {}) {
    const { vertices, faces } = parseObj(text, options)
    const objects = splitMesh(vertices, faces).map((part, i) =>
        meshObject(
            i === 0 ? "collision" : `collision${i + 1}`,
            part.vertices,
            part.faces,
        ),
    )
    return chunk(0x4d4d, chunk(0x3d3d, ...objects))
}

/**
 * Convert an OBJ file to a 3DS file
 * @param {string} objPath
 * @param {string} outputPath
 * @param {{scale?: number, roll?: number, pitch?: number, yaw?: number}} options
 */
async function convertObjFileTo3ds(objPath, outputPath, options = {}) {
    const text = await fs.promises.readFile(objPath, "utf8")
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.promises.writeFile(outputPath, objTo3ds(text, options))
    return outputPath
}

module.exports = { objTo3ds, convertObjFileTo3ds }
