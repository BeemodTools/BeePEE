const { objTo3ds } = require("../utils/objTo3ds")

/** Read the objects of a 3DS file written by objTo3ds */
function readObjects(buffer) {
    expect(buffer.readUInt16LE(0)).toBe(0x4d4d)
    expect(buffer.readUInt32LE(2)).toBe(buffer.length)
    expect(buffer.readUInt16LE(6)).toBe(0x3d3d)
    expect(buffer.readUInt32LE(8)).toBe(buffer.length - 6)
    const objects = []
    let offset = 12
    while (offset < buffer.length) {
        expect(buffer.readUInt16LE(offset)).toBe(0x4000)
        const length = buffer.readUInt32LE(offset + 2)
        let p = offset + 6
        let name = ""
        while (buffer[p]) name += String.fromCharCode(buffer[p++])
        p++
        expect(buffer.readUInt16LE(p)).toBe(0x4100)
        let q = p + 6
        expect(buffer.readUInt16LE(q)).toBe(0x4110)
        const vertexCount = buffer.readUInt16LE(q + 6)
        const vertices = []
        for (let i = 0; i < vertexCount; i++) {
            const v = q + 8 + i * 12
            vertices.push([0, 4, 8].map((c) => buffer.readFloatLE(v + c)))
        }
        q += buffer.readUInt32LE(q + 2)
        expect(buffer.readUInt16LE(q)).toBe(0x4120)
        const faceCount = buffer.readUInt16LE(q + 6)
        const faces = []
        for (let i = 0; i < faceCount; i++) {
            const f = q + 8 + i * 8
            faces.push([0, 2, 4].map((c) => buffer.readUInt16LE(f + c)))
        }
        objects.push({ name, vertices, faces })
        offset += length
    }
    return objects
}

describe("objTo3ds", () => {
    test("writes one collision mesh with the OBJ's triangles", () => {
        const objects = readObjects(
            objTo3ds(
                `v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvt 0 0\nf 1/1 2/1 3/1 4/1\n`,
            ),
        )
        expect(objects).toHaveLength(1)
        expect(objects[0].name).toBe("collision")
        expect(objects[0].vertices).toHaveLength(4)
        // Polygons become triangle fans
        expect(objects[0].faces).toEqual([
            [0, 1, 2],
            [0, 2, 3],
        ])
    })

    test("scales, then rotates by roll, pitch and yaw", () => {
        const [object] = readObjects(
            objTo3ds("v 1 0 0\nv 0 1 0\nv 0 0 1\nf 1 2 3\n", {
                scale: 2,
                yaw: 90,
            }),
        )
        const round = (v) => v.map((c) => Math.round(c * 1000) / 1000 + 0)
        expect(object.vertices.map(round)).toEqual([
            [0, 2, 0],
            [-2, 0, 0],
            [0, 0, 2],
        ])
    })

    test("splits meshes too big for 16-bit counts into several objects", () => {
        // 70000 separate triangles: 210000 vertices
        const lines = []
        for (let i = 0; i < 70000; i++) {
            lines.push(`v ${i} 0 0`, `v ${i} 1 0`, `v ${i} 0 1`)
            lines.push(`f ${i * 3 + 1} ${i * 3 + 2} ${i * 3 + 3}`)
        }
        const objects = readObjects(objTo3ds(lines.join("\n")))
        expect(objects.length).toBeGreaterThan(1)
        expect(objects.map((o) => o.name).slice(0, 2)).toEqual([
            "collision",
            "collision2",
        ])
        for (const object of objects) {
            expect(object.vertices.length).toBeLessThanOrEqual(0xffff)
            expect(object.faces.length).toBeLessThanOrEqual(0xffff)
        }
        expect(objects.reduce((sum, o) => sum + o.faces.length, 0)).toBe(70000)
        // A triangle keeps its own corners after the split
        const last = objects[objects.length - 1]
        const [a, b, c] = last.faces[last.faces.length - 1].map(
            (i) => last.vertices[i],
        )
        expect([a[0], b[1], c[2]]).toEqual([69999, 1, 1])
    })

    test("rejects OBJs without geometry", () => {
        expect(() => objTo3ds("# nothing\n")).toThrow("No vertices")
    })
})
