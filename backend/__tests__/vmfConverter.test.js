const fs = require("fs")
const os = require("os")
const path = require("path")
const zlib = require("zlib")
const { parseKeyValues, getValue } = require("../utils/vmfConverter/keyvalues")
const { parseVmf } = require("../utils/vmfConverter/vmf")
const { completeSolid } = require("../utils/vmfConverter/brushes")
const {
    entityMatrix,
    transformPoint,
    transformDirection,
} = require("../utils/vmfConverter/math")
const {
    parseQc,
    parseSmd,
    resolveSequence,
    buildModelGeometry,
    skinMapper,
} = require("../utils/vmfConverter/models")
const {
    parseVmt,
    describeMaterial,
    decodeVtf,
    encodePng,
    FORMAT,
} = require("../utils/vmfConverter/textures")
const { loadVpk, readVpkEntry } = require("../utils/vmfConverter/vpk")
const { convertVmf, assertHasGeometry } = require("../utils/vmfConverter")

const close = (actual, expected) =>
    expected.forEach((value, i) => expect(actual[i]).toBeCloseTo(value, 6))

/** VMF text for an axis-aligned box brush */
function boxSolid(id, min, max, material) {
    const [x0, y0, z0] = min
    const [x1, y1, z1] = max
    const side = (sideId, plane, uaxis, vaxis) => `
        side
        {
            "id" "${sideId}"
            "plane" "${plane}"
            "material" "${material}"
            "uaxis" "${uaxis} 0.25"
            "vaxis" "${vaxis} 0.25"
        }`
    return `
    solid
    {
        "id" "${id}"${side(1, `(${x0} ${y1} ${z1}) (${x1} ${y1} ${z1}) (${x1} ${y0} ${z1})`, "[1 0 0 0]", "[0 -1 0 0]")}${side(2, `(${x0} ${y0} ${z0}) (${x1} ${y0} ${z0}) (${x1} ${y1} ${z0})`, "[1 0 0 0]", "[0 -1 0 0]")}${side(3, `(${x0} ${y1} ${z1}) (${x0} ${y0} ${z1}) (${x0} ${y0} ${z0})`, "[0 1 0 0]", "[0 0 -1 0]")}${side(4, `(${x1} ${y1} ${z0}) (${x1} ${y0} ${z0}) (${x1} ${y0} ${z1})`, "[0 1 0 0]", "[0 0 -1 0]")}${side(5, `(${x1} ${y1} ${z1}) (${x0} ${y1} ${z1}) (${x0} ${y1} ${z0})`, "[1 0 0 0]", "[0 0 -1 0]")}${side(6, `(${x1} ${y0} ${z0}) (${x0} ${y0} ${z0}) (${x0} ${y0} ${z1})`, "[1 0 0 0]", "[0 0 -1 0]")}
    }`
}

/** Minimal VTF 7.2 with a single mip level */
function buildVtf(width, height, format, imageData) {
    const header = Buffer.alloc(80)
    header.write("VTF\0", 0, "latin1")
    header.writeUInt32LE(7, 4)
    header.writeUInt32LE(2, 8)
    header.writeUInt32LE(80, 12)
    header.writeUInt16LE(width, 16)
    header.writeUInt16LE(height, 18)
    header.writeUInt16LE(1, 24)
    header.writeFloatLE(1, 48)
    header.writeInt32LE(format, 52)
    header[56] = 1
    header.writeInt32LE(-1, 57)
    header.writeUInt16LE(1, 63)
    return Buffer.concat([header, imageData])
}

describe("KeyValues", () => {
    test("keeps duplicate keys, nesting, comments and quoted braces", () => {
        const tree = parseKeyValues(`
            // comment
            world
            {
                "classname" "worldspawn"
                solid { "id" "1" }
                solid { "id" "2" }
                "message" "has { braces } inside"
            }`)
        const world = tree[0]
        expect(world.key).toBe("world")
        expect(world.children.filter((n) => n.key === "solid")).toHaveLength(2)
        expect(getValue(world.children, "MESSAGE")).toBe(
            "has { braces } inside",
        )
    })

    test("drops values with false platform conditionals", () => {
        const tree = parseKeyValues(
            `"a" { "$x" "pc" [!$X360] "$x" "console" [$X360] }`,
        )
        expect(getValue(tree[0].children, "$x")).toBe("pc")
    })
})

describe("VMF parsing", () => {
    test("collects world, brush-entity and hidden solids, and entity key/values", () => {
        const vmf = parseVmf(`
            world { "id" "1" ${boxSolid(2, [0, 0, 0], [16, 16, 16], "dev/a")}
                hidden { ${boxSolid(3, [32, 0, 0], [48, 16, 16], "dev/a")} }
            }
            entity { "id" "4" "classname" "func_detail" ${boxSolid(5, [64, 0, 0], [80, 16, 16], "dev/a")} }
            entity { "id" "6" "classname" "prop_dynamic" "Origin" "1 2 3" "DefaultAnim" "idle" }`)
        expect(vmf.solids.map((s) => s.id)).toEqual(["2", "3", "5"])
        expect(vmf.entities).toHaveLength(2)
        expect(vmf.entities[1].get("origin")).toBe("1 2 3")
        expect(vmf.entities[1].get("defaultanim")).toBe("idle")
    })
})

describe("Brush geometry", () => {
    test("turns a box into six outward-facing quads", () => {
        const solid = parseVmf(
            `world { ${boxSolid(1, [0, 0, 0], [32, 32, 16], "dev/a")} }`,
        ).solids[0]
        expect(completeSolid(solid)).toEqual([])
        const corners = new Set()
        for (const side of solid.sides) {
            expect(side.points).toHaveLength(4)
            side.points.forEach((p) => corners.add(p.join(",")))
            const [a, b, c] = side.points
            const n = [
                (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
                (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
                (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
            ]
            const outward = [a[0] - 16, a[1] - 16, a[2] - 8]
            expect(
                n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2],
            ).toBeGreaterThan(0)
        }
        expect(corners.size).toBe(8)
    })
})

describe("Entity angles", () => {
    // Source applies roll (x), then pitch (y), then yaw (z)
    test("yaw turns +X towards +Y", () => {
        close(
            transformDirection(entityMatrix([0, 90, 0], [0, 0, 0]), [1, 0, 0]),
            [0, 1, 0],
        )
    })
    test("positive pitch points +X downwards", () => {
        close(
            transformDirection(entityMatrix([90, 0, 0], [0, 0, 0]), [1, 0, 0]),
            [0, 0, -1],
        )
    })
    test("roll turns +Y towards +Z", () => {
        close(
            transformDirection(entityMatrix([0, 0, 90], [0, 0, 0]), [0, 1, 0]),
            [0, 0, 1],
        )
    })
    test("origin is applied after rotation", () => {
        close(
            transformPoint(entityMatrix([0, 90, 0], [10, 20, 30]), [1, 0, 0]),
            [10, 21, 30],
        )
    })
})

describe("QC parsing (Crowbar output)", () => {
    const qc = parseQc(`// Created by Crowbar 0.68
$modelname "props_backstage/item_dropper.mdl"
$bodygroup "default"
{
	studio "item_dropper_model.smd"
}
$bodygroup "lid"
{
	blank
	studio "lid.smd"
}
$cdmaterials "models\\props_backstage"
$cdmaterials ""
$texturegroup "skinfamilies"
{
	{ "item_dropper"        "glass" }
	{ "item_dropper_orange" "glass" }
}
$animation "a_open" "anims\\open.smd" {
	fps 30
}
$sequence "BindPose" {
	"item_dropper_anims\\BindPose.smd"
	fadein 0.2
	activity "ACT_IDLE" 1
	fps 30
}
$sequence "open" "a_open" fps 30
$sequence "flinch" {
	"flinch.smd"
	delta
}
`)

    test("reads model name, bodies, materials and skins", () => {
        expect(qc.modelName).toBe("props_backstage/item_dropper.mdl")
        expect(qc.bodies).toEqual([
            { name: "default", options: ["item_dropper_model.smd"] },
            { name: "lid", options: [null, "lid.smd"] },
        ])
        expect(qc.cdmaterials).toEqual(["models/props_backstage", ""])
        expect(skinMapper(qc, 1)("item_dropper")).toBe("item_dropper_orange")
        expect(skinMapper(qc, 0)("item_dropper")).toBe("item_dropper")
    })

    test("reads Crowbar's braced $sequence form and $animation references", () => {
        expect(qc.sequences.map((s) => [s.name, s.file, s.delta])).toEqual([
            ["BindPose", "item_dropper_anims/BindPose.smd", false],
            ["open", "anims/open.smd", false],
            ["flinch", "flinch.smd", true],
        ])
    })

    test("resolves DefaultAnim by name or activity, else the first sequence", () => {
        expect(resolveSequence(qc, "OPEN").sequence.name).toBe("open")
        expect(resolveSequence(qc, "act_idle").sequence.name).toBe("BindPose")
        expect(resolveSequence(qc, null)).toMatchObject({
            found: true,
            sequence: { name: "BindPose" },
        })
        expect(resolveSequence(qc, "missing")).toMatchObject({
            found: false,
            sequence: { name: "BindPose" },
        })
    })
})

describe("Model posing", () => {
    const reference = parseSmd(`version 1
nodes
  0 "root" -1
end
skeleton
time 0
  0 0 0 0 0 0 0
end
triangles
mat.bmp
  0 10 0 0 1 0 0 0 0 1 0 1
  0 0 10 0 0 1 0 1 0
  0 0 0 10 0 0 1 0 1 1 0 1
end
`)
    const animation = parseSmd(`version 1
nodes
  0 "root" -1
end
skeleton
time 0
  0 0 0 0 0 0 1.5707963267948966
end
`)
    const model = (sequences) => ({
        qc: { staticProp: false, sequences },
        qcDir: "",
        references: [reference],
    })

    test("parses triangles with and without bone links", () => {
        expect(reference.triangles).toHaveLength(1)
        expect(reference.triangles[0].material).toBe("mat")
        expect(reference.triangles[0].verts[1].links).toEqual([])
        expect(reference.triangles[0].verts[0].links).toEqual([[0, 1]])
    })

    test("reference pose only applies Crowbar's 90 degree frame correction", async () => {
        const { triangles } = await buildModelGeometry(model([]), {
            pose: false,
        })
        close(triangles[0].verts[0].pos, [0, 10, 0])
    })

    test("poses vertices with the sequence's first frame", async () => {
        const { triangles, warning } = await buildModelGeometry(
            model([{ name: "turn", file: "turn.smd", delta: false }]),
            { pose: true, readAnimation: async () => animation },
        )
        expect(warning).toBeNull()
        // +90 deg about Z from the animation, then +90 deg frame correction
        close(triangles[0].verts[0].pos, [-10, 0, 0])
        close(triangles[0].verts[0].normal, [-1, 0, 0])
    })
})

describe("Materials and textures", () => {
    test("reads base textures from VMTs with fallback blocks and conditions", () => {
        const vmt = parseVmt(`LightmappedGeneric
{
$basetexture "Concrete\\Wall_01"
"%keywords" portal
"GPU<2?$basetexture" "concrete/lowend"
$translucent 1
LightmappedGeneric_DX8
{
$basetexture "concrete/dx8"
}
}`)
        expect(describeMaterial(vmt.shader, vmt.params)).toEqual({
            basetexture: "concrete/wall_01",
            bumpmap: null,
            translucent: true,
            alphatest: false,
            tint: null,
            tintMask: false,
        })
    })

    test("reads patch materials' insert block and include", () => {
        const vmt = parseVmt(
            `patch { include "materials/base.vmt" insert { $basetexture "a/b.vtf" } }`,
        )
        expect(vmt.include).toBe("materials/base.vmt")
        expect(vmt.params.get("basetexture")).toBe("a/b.vtf")
    })

    test("decodes uncompressed and DXT1 VTFs", () => {
        const rgba = decodeVtf(
            buildVtf(1, 1, FORMAT.BGRA8888, Buffer.from([1, 2, 3, 4])),
        )
        expect([...rgba.rgba]).toEqual([3, 2, 1, 4])

        const block = Buffer.alloc(8)
        block.writeUInt16LE(0xf800, 0) // red
        block.writeUInt16LE(0x001f, 2) // blue
        block.writeUInt32LE(0b0100, 4) // pixel 0 -> color 0, pixel 1 -> color 1
        const dxt = decodeVtf(buildVtf(4, 4, FORMAT.DXT1, block))
        expect(dxt.width).toBe(4)
        expect([...dxt.rgba.subarray(0, 8)]).toEqual([
            255, 0, 0, 255, 0, 0, 255, 255,
        ])
    })

    test("encodes valid PNG scanlines", () => {
        const png = encodePng(
            2,
            1,
            Buffer.from([255, 0, 0, 128, 0, 255, 0, 255]),
            false,
        )
        expect(png.subarray(1, 4).toString()).toBe("PNG")
        expect(png.readUInt32BE(16)).toBe(2)
        expect(png[25]).toBe(2) // RGB colour type
        const idatLength = png.readUInt32BE(33)
        const raw = zlib.inflateSync(png.subarray(41, 41 + idatLength))
        expect([...raw]).toEqual([0, 255, 0, 0, 0, 255, 0])
    })
})

describe("VPK", () => {
    test("reads entries with preload data from a single-file VPK", async () => {
        const tree = Buffer.concat([
            Buffer.from("txt\0dir\0file\0", "latin1"),
            Buffer.from([
                0, 0, 0, 0, 3, 0, 0xff, 0x7f, 0, 0, 0, 0, 5, 0, 0, 0, 0xff,
                0xff,
            ]),
            Buffer.from("abc\0\0\0", "latin1"),
        ])
        const header = Buffer.alloc(12)
        header.writeUInt32LE(0x55aa1234, 0)
        header.writeUInt32LE(1, 4)
        header.writeUInt32LE(tree.length, 8)
        const file = path.join(os.tmpdir(), `beepee-test-${process.pid}.vpk`)
        fs.writeFileSync(
            file,
            Buffer.concat([header, tree, Buffer.from("defgh")]),
        )
        try {
            const vpk = loadVpk(file)
            const entry = vpk.entries.get("dir/file.txt")
            expect((await readVpkEntry(vpk, entry)).toString()).toBe("abcdefgh")
        } finally {
            fs.rmSync(file, { force: true })
        }
    })
})

describe("convertVmf", () => {
    let root

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-vmf2obj-test-"))
        const content = path.join(root, "content")
        fs.mkdirSync(path.join(content, "materials", "test"), {
            recursive: true,
        })
        fs.writeFileSync(
            path.join(content, "materials", "test", "wall.vmt"),
            `"LightmappedGeneric" { "$basetexture" "test/wall" }`,
        )
        const pixels = Buffer.alloc(4 * 4 * 4, 200)
        fs.writeFileSync(
            path.join(content, "materials", "test", "wall.vtf"),
            buildVtf(4, 4, FORMAT.RGBA8888, pixels),
        )
        fs.writeFileSync(
            path.join(root, "map.vmf"),
            `world { "id" "1" ${boxSolid(2, [0, 0, 0], [64, 64, 64], "TEST/WALL")}
                ${boxSolid(3, [100, 0, 0], [116, 16, 16], "tools/toolsnodraw")} }
            entity { "id" "4" "classname" "func_detail" ${boxSolid(5, [200, 0, 0], [216, 16, 16], "test/wall")} }
            entity { "id" "6" "classname" "prop_static" "model" "models/missing.mdl" "origin" "0 0 0" }`,
        )
    })

    afterAll(() => {
        fs.rmSync(root, { recursive: true, force: true })
    })

    test("writes brushes, brush entities, MTL and PNG textures", async () => {
        const result = await convertVmf(
            path.join(root, "map.vmf"),
            path.join(root, "out", "map"),
            {
                resourcePaths: [path.join(root, "content")],
                skipTools: true,
                quiet: true,
            },
        )

        const obj = fs.readFileSync(result.objPath, "utf8")
        expect(obj).toContain("mtllib map.mtl")
        expect(obj.match(/^o /gm)).toEqual(["o ", "o ", "o "])
        expect(obj.match(/^f /gm)).toHaveLength(12)
        expect(obj).toContain("usemtl test/wall")

        const mtl = fs.readFileSync(result.mtlPath, "utf8")
        expect(mtl).toContain("newmtl test/wall")
        expect(mtl).toContain("map_Kd materials/test/wall.png")

        const png = fs.readFileSync(
            path.join(root, "out", "materials", "test", "wall.png"),
        )
        expect(png.readUInt32BE(16)).toBe(4)
        expect(
            result.warnings.some((w) => w.includes("models/missing.mdl")),
        ).toBe(true)
    })

    test("maps brush textures without mirroring them", async () => {
        const result = await convertVmf(
            path.join(root, "map.vmf"),
            path.join(root, "out2", "map"),
            {
                resourcePaths: [path.join(root, "content")],
                skipTools: true,
                quiet: true,
            },
        )
        const lines = fs.readFileSync(result.objPath, "utf8").split("\n")
        const v = [null]
        const vt = [null]
        let topFace = null
        for (const line of lines) {
            const p = line.split(" ")
            if (p[0] === "v") v.push(p.slice(1, 4).map(Number))
            if (p[0] === "vt") vt.push(p.slice(1, 3).map(Number))
            if (p[0] === "f" && !topFace) {
                const corners = p
                    .slice(1)
                    .filter(Boolean)
                    .map((c) => c.split("/").map(Number))
                if (corners.every(([vi]) => v[vi][2] === 64)) topFace = corners
            }
        }
        // Top face has uaxis [1 0 0]: texture u must grow with +X
        const sorted = [...topFace].sort((x, y) => v[x[0]][0] - v[y[0]][0])
        const [minX, maxX] = [sorted[0], sorted[sorted.length - 1]]
        expect(v[maxX[0]][0]).toBeGreaterThan(v[minX[0]][0])
        expect(vt[maxX[1]][0]).toBeGreaterThan(vt[minX[1]][0])
    })
})

/** Pixel [r, g, b] at (x, y) of a PNG written by encodePng (single IDAT, filter 0) */
function readPngPixel(file, x, y) {
    const png = fs.readFileSync(file)
    const width = png.readUInt32BE(16)
    const channels = png[25] === 6 ? 4 : 3
    const idatLength = png.readUInt32BE(33)
    const raw = zlib.inflateSync(png.subarray(41, 41 + idatLength))
    const offset = y * (width * channels + 1) + 1 + x * channels
    return [raw[offset], raw[offset + 1], raw[offset + 2]]
}

describe("convertVmf: empty results, model entities and tints", () => {
    let root
    const content = () => path.join(root, "content")
    const convert = (name, vmfText) => {
        const vmfPath = path.join(root, `${name}.vmf`)
        fs.writeFileSync(vmfPath, vmfText)
        return convertVmf(vmfPath, path.join(root, "out", name), {
            resourcePaths: [content()],
            skipTools: true,
            quiet: true,
        })
    }

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-vmf2obj-tint-"))
        const materials = path.join(root, "content", "materials", "test")
        fs.mkdirSync(materials, { recursive: true })
        fs.writeFileSync(
            path.join(materials, "wall.vtf"),
            buildVtf(4, 4, FORMAT.RGBA8888, Buffer.alloc(4 * 4 * 4, 200)),
        )
        fs.writeFileSync(
            path.join(materials, "wall.vmt"),
            `"LightmappedGeneric" { "$basetexture" "test/wall" }`,
        )
        fs.writeFileSync(
            path.join(materials, "model.vmt"),
            `"VertexLitGeneric" { "$basetexture" "test/wall" "$color2" "[0.5 0.5 0.5]" }`,
        )
        fs.writeFileSync(
            path.join(materials, "world.vmt"),
            `"LightmappedGeneric" { "$basetexture" "test/wall" "$color2" "[0.5 0.5 0.5]" "$color" "{255 0 0}" }`,
        )
    })

    afterAll(() => {
        fs.rmSync(root, { recursive: true, force: true })
    })

    test("an empty result is an error, not a finished model", async () => {
        const result = await convert(
            "empty",
            `entity { "id" "1" "classname" "info_target" "origin" "0 0 0" }
             entity { "id" "2" "classname" "info_coop_spawn" "model" "models/player/ballbot/ballbot.mdl" }
             entity { "id" "3" "classname" "point_teleport" "model" "models/editor/angle_helper.mdl" }`,
        )
        expect(result.stats.faces).toBe(0)
        expect(result.stats.modelEntities).toBe(0)

        let error
        try {
            assertHasGeometry(result, path.join(root, "empty.vmf"))
        } catch (e) {
            error = e
        }
        expect(error.userFacing).toBe(true)
        expect(error.message).toContain(
            "No geometry was generated from empty.vmf",
        )
        expect(error.message).toContain("no brushes and no models")
        expect(fs.existsSync(result.objPath)).toBe(false)
        expect(fs.existsSync(result.mtlPath)).toBe(false)
    })

    test("explains tool-only brushes and converts NPCs with models", async () => {
        const result = await convert(
            "tools",
            `world { ${boxSolid(2, [0, 0, 0], [16, 16, 16], "tools/toolsnodraw")} }
             entity { "id" "4" "classname" "npc_portal_turret_floor" "model" "models/npcs/missing.mdl" }`,
        )
        expect(result.stats.modelEntities).toBe(1)
        expect(
            result.warnings.some((w) => w.includes("models/npcs/missing.mdl")),
        ).toBe(true)
        expect(() => assertHasGeometry(result, "tools.vmf")).toThrow(
            /6 brush face\(s\) only use tool textures[\s\S]*1 model\(s\) couldn't be loaded/,
        )
    })

    test("bakes a brush entity's render color into a tinted texture copy", async () => {
        const result = await convert(
            "rendercolor",
            `world { "id" "1" ${boxSolid(2, [0, 0, 0], [16, 16, 16], "test/wall")} }
             entity { "id" "3" "classname" "func_brush" "rendercolor" "255 0 0" ${boxSolid(4, [32, 0, 0], [48, 16, 16], "test/wall")} }`,
        )
        const obj = fs.readFileSync(result.objPath, "utf8")
        expect(obj).toContain("usemtl test/wall\n")
        expect(obj).toContain("usemtl test/wall_tint_ff0000\n")
        const mtl = fs.readFileSync(result.mtlPath, "utf8")
        expect(mtl).toContain("newmtl test/wall_tint_ff0000")
        expect(mtl).toContain("map_Kd materials/test/wall_tint_ff0000.png")

        const textures = path.join(root, "out", "materials", "test")
        expect(readPngPixel(path.join(textures, "wall.png"), 1, 1)).toEqual([
            200, 200, 200,
        ])
        expect(
            readPngPixel(path.join(textures, "wall_tint_ff0000.png"), 1, 1),
        ).toEqual([200, 0, 0])
    })

    test("applies $color2 on model materials and only $color on world materials", async () => {
        const result = await convert(
            "materialtint",
            `world { "id" "1" ${boxSolid(2, [0, 0, 0], [16, 16, 16], "test/model")}
                ${boxSolid(3, [32, 0, 0], [48, 16, 16], "test/world")} }`,
        )
        const mtl = fs.readFileSync(result.mtlPath, "utf8")
        expect(mtl).toContain("map_Kd materials/test/wall_tint_808080.png")
        expect(mtl).toContain("map_Kd materials/test/wall_tint_ff0000.png")
        const textures = path.join(root, "out", "materials", "test")
        expect(
            readPngPixel(path.join(textures, "wall_tint_808080.png"), 0, 0),
        ).toEqual([100, 100, 100])
        expect(
            readPngPixel(path.join(textures, "wall_tint_ff0000.png"), 0, 0),
        ).toEqual([200, 0, 0])
    })
})

describe("convertVmf: placeholders and built-in models", () => {
    let root

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-vmf2obj-builtin-"))
        fs.mkdirSync(path.join(root, "content", "materials"), {
            recursive: true,
        })
    })

    afterAll(() => {
        fs.rmSync(root, { recursive: true, force: true })
    })

    const convert = (name, vmfText) => {
        const vmfPath = path.join(root, `${name}.vmf`)
        fs.writeFileSync(vmfPath, vmfText)
        return convertVmf(vmfPath, path.join(root, "out", name), {
            resourcePaths: [path.join(root, "content")],
            skipTools: true,
            quiet: true,
        })
    }

    test("keeps faces with missing materials, using a purple/black placeholder", async () => {
        const result = await convert(
            "missing",
            `world { "id" "1" ${boxSolid(2, [0, 0, 0], [16, 16, 16], "test/doesnotexist")} }`,
        )
        expect(result.stats.faces).toBe(6)
        expect(result.stats.placeholderMaterials).toBe(1)
        expect(fs.readFileSync(result.objPath, "utf8")).toContain(
            "usemtl test/doesnotexist",
        )
        expect(fs.readFileSync(result.mtlPath, "utf8")).toContain(
            "map_Kd materials/bpee_missing_texture.png",
        )
        const png = path.join(
            root,
            "out",
            "materials",
            "bpee_missing_texture.png",
        )
        expect(readPngPixel(png, 0, 0)).toEqual([255, 0, 255])
        expect(readPngPixel(png, 100, 0)).toEqual([0, 0, 0])
        expect(result.warnings.some((w) => w.includes("placeholder"))).toBe(
            true,
        )
    })

    test("uses built-in models for entities without a model keyvalue", async () => {
        const result = await convert(
            "builtin",
            `entity { "id" "1" "classname" "npc_security_camera" "origin" "0 0 0" }
             entity { "id" "2" "classname" "prop_weighted_cube" "CubeType" "2" "origin" "0 0 0" }
             entity { "id" "3" "classname" "prop_portal" "origin" "0 0 0" }`,
        )
        // Camera and cube are models; the portal isn't
        expect(result.stats.modelEntities).toBe(2)
        expect(result.warnings.join("\n")).toContain(
            "models/props/security_camera.mdl",
        )
        expect(result.warnings.join("\n")).toContain(
            "models/props/reflection_cube.mdl",
        )
        expect(result.warnings.join("\n")).not.toContain("prop_portal")
    })
})

describe("convertVmf: overlays", () => {
    let root

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-vmf2obj-overlay-"))
        const materials = path.join(root, "content", "materials", "test")
        fs.mkdirSync(materials, { recursive: true })
        fs.writeFileSync(
            path.join(materials, "decal.vtf"),
            buildVtf(4, 4, FORMAT.RGBA8888, Buffer.alloc(4 * 4 * 4, 128)),
        )
        fs.writeFileSync(
            path.join(materials, "decal.vmt"),
            `"LightmappedGeneric" { "$basetexture" "test/decal" "$translucent" "1" "$decal" "1" }`,
        )
    })

    afterAll(() => {
        fs.rmSync(root, { recursive: true, force: true })
    })

    test("writes an info_overlay as a lifted, front-facing textured quad", async () => {
        const vmfPath = path.join(root, "overlay.vmf")
        fs.writeFileSync(
            vmfPath,
            `entity
            {
                "id" "7"
                "classname" "info_overlay"
                "material" "TEST/DECAL"
                "BasisOrigin" "0 0 16"
                "BasisU" "1 0 0"
                "BasisV" "0 1 0"
                "BasisNormal" "0 0 1"
                "uv0" "-8 -8 0"
                "uv1" "-8 8 0"
                "uv2" "8 8 0"
                "uv3" "8 -8 0"
                "StartU" "0"
                "EndU" "1"
                "StartV" "1"
                "EndV" "0"
                "origin" "0 0 16"
            }`,
        )
        const result = await convertVmf(
            vmfPath,
            path.join(root, "out", "overlay"),
            {
                resourcePaths: [path.join(root, "content")],
                quiet: true,
            },
        )
        expect(result.stats.overlays).toBe(1)
        expect(result.stats.faces).toBe(1)

        const v = [null]
        const vt = [null]
        let face = null
        for (const line of fs
            .readFileSync(result.objPath, "utf8")
            .split("\n")) {
            const p = line.trim().split(/\s+/)
            if (p[0] === "v") v.push(p.slice(1, 4).map(Number))
            if (p[0] === "vt") vt.push(p.slice(1, 3).map(Number))
            if (p[0] === "f")
                face = p.slice(1).map((c) => c.split("/").map(Number))
        }
        expect(fs.readFileSync(result.objPath, "utf8")).toContain("o overlay_7")
        const corners = face.map(([vi, ti]) => ({ pos: v[vi], uv: vt[ti] }))

        // Lifted off the surface along the normal
        corners.forEach((c) => expect(c.pos[2]).toBeCloseTo(16.25, 6))

        // Counter-clockwise when seen from the normal side
        const [a, b, c] = corners.map((k) => k.pos)
        const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        expect(nz).toBeGreaterThan(0)

        // u grows along BasisU; OBJ v is flipped from Source's t
        const at = (x, y) =>
            corners.find((k) => k.pos[0] === x && k.pos[1] === y).uv
        expect(at(-8, -8)).toEqual([0, 0])
        expect(at(8, -8)).toEqual([1, 0])
        expect(at(8, 8)).toEqual([1, 1])

        const mtl = fs.readFileSync(result.mtlPath, "utf8")
        expect(mtl).toContain("map_Kd materials/test/decal.png")
        expect(mtl).toContain("# beepee:translucent")
    })

    test("lifts higher render orders further so they stay on top", async () => {
        const vmfPath = path.join(root, "overlay_order.vmf")
        fs.writeFileSync(
            vmfPath,
            `entity
            {
                "id" "8"
                "classname" "info_overlay"
                "material" "test/decal"
                "BasisOrigin" "0 0 16"
                "BasisU" "1 0 0"
                "BasisV" "0 1 0"
                "BasisNormal" "0 0 1"
                "uv0" "-8 -8 0"
                "uv1" "-8 8 0"
                "uv2" "8 8 0"
                "uv3" "8 -8 0"
                "RenderOrder" "2"
            }`,
        )
        const result = await convertVmf(
            vmfPath,
            path.join(root, "out", "overlay_order"),
            {
                resourcePaths: [path.join(root, "content")],
                quiet: true,
            },
        )
        const heights = fs
            .readFileSync(result.objPath, "utf8")
            .split("\n")
            .filter((line) => line.startsWith("v "))
            .map((line) => Number(line.split(/\s+/)[3]))
        expect(heights).toHaveLength(4)
        heights.forEach((z) => expect(z).toBeCloseTo(16.75, 6))
    })
})

describe("editor model VMTs", () => {
    const { editorVmt } = require("../utils/mdlConverter")

    test("opaque textures keep the original VMT", () => {
        expect(editorVmt("item", "tex")).toBe(`patch
{
include "materials/models/props_map_editor/item_lighting_common.vmt"
insert
{
$basetexture "models/props_map_editor/bpee/item/tex"
$selfillum 1
$model 1
}
}
`)
    })

    test("translucent and alphatest textures keep their transparency", () => {
        const translucent = editorVmt("item", "tex", "translucent")
        expect(translucent).toContain("$model 1\n$translucent 1\n}")
        const alphatest = editorVmt("item", "tex", "alphatest")
        expect(alphatest).toContain(
            "$model 1\n$alphatest 1\n$alphatestreference .5\n}",
        )
        // With $selfillum the shaders ignore the base alpha for opacity
        expect(translucent).not.toContain("$selfillum")
        expect(alphatest).not.toContain("$selfillum")
    })
})
