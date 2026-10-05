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
const {
    VmfConverter,
    convertVmf,
    assertHasGeometry,
    hasDrawableContent,
} = require("../utils/vmfConverter")

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
            additive: false,
            alpha: 1,
            alphaTestReference: 0.5,
            modulate: false,
            decalScale: 1,
            basetexture2: null,
            blendModulate: null,
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
             entity { "id" "4" "classname" "npc_portal_turret_floor" "ModelIndex" "1" "model" "models/npcs/missing.mdl" }`,
        )
        expect(result.stats.modelEntities).toBe(1)
        expect(
            result.warnings.some((w) => w.includes("models/npcs/missing.mdl")),
        ).toBe(true)
        expect(() => assertHasGeometry(result, "tools.vmf")).toThrow(
            /6 brush face\(s\) only use tool or dev textures[\s\S]*1 model\(s\) couldn't be loaded/,
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

    test("colors props with their render color, masked materials only inside the mask", async () => {
        const folder = path.join(content(), "materials", "test")
        fs.writeFileSync(
            path.join(folder, "masked.vmt"),
            `"VertexLitGeneric" { "$basetexture" "test/wall" "$blendtintbybasealpha" "1" }`,
        )
        fs.writeFileSync(
            path.join(folder, "plain.vmt"),
            `"VertexLitGeneric" { "$basetexture" "test/wall" }`,
        )
        const models = {
            "models/recolorable.mdl": ["masked", "plain"],
            "models/fixed.mdl": ["plain"],
        }
        const triangle = (material) => ({
            material,
            verts: [
                [0, 0, 0],
                [16, 0, 0],
                [0, 16, 0],
            ].map((pos) => ({ pos, normal: [0, 0, 1], uv: [0, 0] })),
        })

        const converter = await new VmfConverter({
            resourcePaths: [content()],
            quiet: true,
        }).init()
        // Stand-ins for decompiled models
        converter.getModel = async () => ({
            qc: {
                cdmaterials: ["test"],
                textureGroups: [],
                modelName: null,
                sequences: [],
            },
            references: [],
            missing: [],
        })
        converter.getGeometry = async (modelPath) => ({
            triangles: models[modelPath].map(triangle),
        })
        const vmfPath = path.join(root, "props.vmf")
        fs.writeFileSync(
            vmfPath,
            Object.keys(models)
                .map(
                    (model, i) =>
                        `entity { "id" "${i + 1}" "classname" "prop_static" "model" "${model}" "origin" "0 0 0" "rendercolor" "255 0 0" }`,
                )
                .join("\n"),
        )
        try {
            const result = await converter.convert(
                vmfPath,
                path.join(root, "out", "props"),
            )
            const obj = fs.readFileSync(result.objPath, "utf8")
            // The mask colors part of its material; materials without a
            // mask take the whole color, in both models
            expect(obj).toContain("usemtl masked_tint_ff0000m\n")
            expect(obj).toContain("usemtl plain_tint_ff0000\n")
            expect(obj).not.toContain("usemtl plain\n")
        } finally {
            await converter.dispose()
        }
    })

    test("draws gel blobs as a ball in their gel's color, not their placeholder model", async () => {
        const vmf = `entity { "id" "1" "classname" "prop_paint_bomb" "model" "models/error.mdl" "painttype" "2" "skin" "2" "origin" "0 0 128" }`
        expect(hasDrawableContent(parseVmf(vmf))).toBe(true)
        const result = await convert("gel", vmf)
        const obj = fs.readFileSync(result.objPath, "utf8")
        expect(obj).toContain("usemtl bpee_gel_2\n")
        expect(obj).not.toMatch(/error/)
        expect(
            readPngPixel(
                path.join(
                    root,
                    "out",
                    "materials",
                    "bpee_colors",
                    "bpee_gel_2.png",
                ),
                0,
                0,
            ),
        ).toEqual([255, 106, 0])
        // A ball around the entity's origin
        const heights = [...obj.matchAll(/^v \S+ \S+ (\S+)$/gm)].map((m) =>
            Number(m[1]),
        )
        expect(Math.min(...heights)).toBeCloseTo(104)
        expect(Math.max(...heights)).toBeCloseTo(152)
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
    const solidVtf = (size, rgba) =>
        buildVtf(
            size,
            size,
            FORMAT.RGBA8888,
            Buffer.concat(Array(size * size).fill(Buffer.from(rgba))),
        )
    const material = (name, rgba, vmt) => {
        const folder = path.join(root, "content", "materials", "test")
        fs.writeFileSync(path.join(folder, `${name}.vtf`), solidVtf(4, rgba))
        fs.writeFileSync(path.join(folder, `${name}.vmt`), vmt(`test/${name}`))
    }
    const overlay = (id, mat, [x, y], size, extra = "") => `
        entity
        {
            "id" "${id}"
            "classname" "info_overlay"
            "material" "${mat}"
            "BasisOrigin" "${x} ${y} 8"
            "BasisU" "1 0 0"
            "BasisV" "0 1 0"
            "BasisNormal" "0 0 1"
            "uv0" "${-size / 2} ${-size / 2} 0"
            "uv1" "${-size / 2} ${size / 2} 0"
            "uv2" "${size / 2} ${size / 2} 0"
            "uv3" "${size / 2} ${-size / 2} 0"
            "StartU" "0"
            "EndU" "1"
            "StartV" "0"
            "EndV" "1"
            ${extra}
        }`
    const convert = (name, faceSize, overlays) => {
        const vmfPath = path.join(root, `${name}.vmf`)
        fs.writeFileSync(
            vmfPath,
            `world { ${boxSolid(2, [0, 0, 0], [faceSize, faceSize, 8], "test/base")} }
            ${overlays.join("\n")}`,
        )
        return convertVmf(vmfPath, path.join(root, "out", name), {
            resourcePaths: [path.join(root, "content")],
            quiet: true,
        })
    }
    // The top face's texture is 4 texels per unit: u along x, v along -y
    const baked = (name, faceSize) => {
        const file = path.join(
            root,
            "out",
            "materials",
            "bpee_overlays",
            `bpee_overlay_${name}_1.png`,
        )
        return {
            file,
            width: fs.readFileSync(file).readUInt32BE(16),
            at: (x, y) =>
                readPngPixel(
                    file,
                    Math.floor(x * 4),
                    Math.floor((faceSize - y) * 4),
                ),
        }
    }

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-vmf2obj-overlay-"))
        fs.mkdirSync(path.join(root, "content", "materials", "test"), {
            recursive: true,
        })
        const lit = (extra) => (texture) =>
            `"LightmappedGeneric" { "$basetexture" "${texture}" ${extra} }`
        material("base", [100, 100, 100, 255], lit(""))
        material("red", [255, 0, 0, 255], lit(`"$translucent" "1"`))
        material("blue", [0, 0, 255, 255], lit(""))
        material("half", [255, 255, 255, 128], lit(`"$translucent" "1"`))
        material("glow", [50, 0, 0, 255], lit(`"$additive" "1"`))
        material(
            "modulate",
            [64, 128, 255, 255],
            (texture) => `"DecalModulate" { "$basetexture" "${texture}" }`,
        )
        material("faint", [0, 255, 0, 100], lit(`"$alphatest" "1"`))
        material("solid", [0, 255, 0, 200], lit(`"$alphatest" "1"`))
    })

    afterAll(() => {
        fs.rmSync(root, { recursive: true, force: true })
    })

    test("bakes an overlay into the texture of the face it's on", async () => {
        const result = await convert("single", 16, [
            overlay(7, "TEST/RED", [8, 8], 8, `"sides" "1"`),
        ])
        expect(result.stats.overlays).toBe(1)

        const obj = fs.readFileSync(result.objPath, "utf8")
        expect(obj).toContain("usemtl bpee_overlay_single_1")
        expect(obj).toContain("usemtl test/base")
        expect(fs.readFileSync(result.mtlPath, "utf8")).toContain(
            "map_Kd materials/bpee_overlays/bpee_overlay_single_1.png",
        )

        // A copy of the face's 16 units of texture with the overlay in the middle
        const png = baked("single", 16)
        expect(png.width).toBe(64)
        expect(png.at(8, 8)).toEqual([255, 0, 0])
        expect(png.at(1, 1)).toEqual([100, 100, 100])
        expect(png.at(14, 3)).toEqual([100, 100, 100])

        // The face's texture coordinates cover exactly the baked texture
        const vt = [null]
        let faceCoords = null
        let current = null
        for (const line of obj.split("\n")) {
            const p = line.trim().split(/\s+/)
            if (p[0] === "vt") vt.push(p.slice(1, 3).map(Number))
            if (p[0] === "usemtl") current = p[1]
            if (p[0] === "f" && current === "bpee_overlay_single_1") {
                faceCoords = p.slice(1).map((c) => vt[Number(c.split("/")[1])])
            }
        }
        const us = faceCoords.map((c) => c[0])
        const vs = faceCoords.map((c) => c[1])
        close([Math.min(...us), Math.max(...us)], [0, 1])
        close([Math.min(...vs), Math.max(...vs)], [0, 1])
    })

    test("clips overlays that overhang their face to it", async () => {
        const result = await convert("overhang", 16, [
            overlay(7, "test/red", [8, 8], 40, `"sides" "1"`),
        ])
        expect(result.stats.overlays).toBe(1)
        const png = baked("overhang", 16)
        expect(png.width).toBe(64) // the face, not the overlay
        expect(png.at(0.1, 0.1)).toEqual([255, 0, 0])
        expect(png.at(15.9, 15.9)).toEqual([255, 0, 0])
    })

    test("draws higher render orders on top", async () => {
        await convert("order", 16, [
            overlay(7, "test/blue", [8, 8], 8, `"sides" "1" "RenderOrder" "1"`),
            overlay(8, "test/red", [8, 8], 8, `"sides" "1"`),
        ])
        expect(baked("order", 16).at(8, 8)).toEqual([0, 0, 255])
    })

    test("blends overlays like their shaders", async () => {
        const result = await convert("blend", 48, [
            overlay(1, "test/half", [8, 8], 8, `"sides" "1"`),
            overlay(2, "test/glow", [24, 8], 8, `"sides" "1"`),
            overlay(3, "test/modulate", [40, 8], 8, `"sides" "1"`),
            overlay(4, "test/faint", [8, 24], 8, `"sides" "1"`),
            overlay(5, "test/solid", [24, 24], 8, `"sides" "1"`),
        ])
        expect(result.stats.overlays).toBe(5)
        const png = baked("blend", 48)
        // $translucent: alpha blend (128/255 of white over grey)
        expect(png.at(8, 8)).toEqual([178, 178, 178])
        // $additive: added
        expect(png.at(24, 8)).toEqual([150, 100, 100])
        // DecalModulate: 2 * overlay * face
        expect(png.at(40, 8)).toEqual([50, 100, 200])
        // $alphatest: drawn only where alpha passes 0.5
        expect(png.at(8, 24)).toEqual([100, 100, 100])
        expect(png.at(24, 24)).toEqual([0, 255, 0])
    })

    test("leaves out overlays that aren't on any face", async () => {
        const result = await convert("missing", 16, [
            overlay(7, "test/red", [8, 8], 8, `"sides" "999"`),
            overlay(8, "test/red", [8, 8], 8),
        ])
        expect(result.stats.overlays).toBe(0)
        expect(result.warnings).toContain(
            "2 overlays (test/red) are not on any visible brush face in this instance, so they were left out",
        )
        expect(fs.readFileSync(result.mtlPath, "utf8")).not.toContain(
            "bpee_overlay",
        )
    })
})

describe("convertVmf: decals and displacement blends", () => {
    let root
    const folder = () => path.join(root, "content", "materials", "test")
    const vtf = (size, texels) =>
        buildVtf(size, size, FORMAT.RGBA8888, Buffer.from(texels.flat()))
    const convert = (name, vmfText) => {
        const vmfPath = path.join(root, `${name}.vmf`)
        fs.writeFileSync(vmfPath, vmfText)
        return convertVmf(vmfPath, path.join(root, "out", name), {
            resourcePaths: [path.join(root, "content")],
            quiet: true,
        })
    }
    const decal = (id, texture, origin) => `
        entity
        {
            "id" "${id}"
            "classname" "infodecal"
            "texture" "${texture}"
            "origin" "${origin.join(" ")}"
        }`
    const bakedFile = (folderName, file) =>
        path.join(root, "out", "materials", folderName, file)
    const RED = [255, 0, 0]
    const GREEN = [0, 255, 0]
    const BLUE = [0, 0, 255]
    const WHITE = [255, 255, 255]
    const GREY = [100, 100, 100]

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-vmf2obj-decal-"))
        fs.mkdirSync(folder(), { recursive: true })
        fs.writeFileSync(
            path.join(folder(), "base.vtf"),
            vtf(4, Array(16).fill([...GREY, 255])),
        )
        fs.writeFileSync(
            path.join(folder(), "base.vmt"),
            `"LightmappedGeneric" { "$basetexture" "test/base" }`,
        )
        // 4x4 decal with a colored quadrant per corner (rows top to bottom)
        const quadrants = []
        for (let y = 0; y < 4; y++) {
            for (let x = 0; x < 4; x++) {
                const color =
                    y < 2 ? (x < 2 ? RED : GREEN) : x < 2 ? BLUE : WHITE
                quadrants.push([...color, 255])
            }
        }
        fs.writeFileSync(path.join(folder(), "quad.vtf"), vtf(4, quadrants))
        // $decalscale 2: 4 texels make an 8 unit decal
        fs.writeFileSync(
            path.join(folder(), "quad.vmt"),
            `"LightmappedGeneric" { "$basetexture" "test/quad" "$decal" "1" "$translucent" "1" "$decalscale" "2" }`,
        )
        fs.writeFileSync(
            path.join(folder(), "blue.vtf"),
            vtf(4, Array(16).fill([...BLUE, 255])),
        )
        fs.writeFileSync(
            path.join(folder(), "blend.vmt"),
            `"WorldVertexTransition" { "$basetexture" "test/base" "$basetexture2" "test/blue" }`,
        )
    })

    afterAll(() => {
        fs.rmSync(root, { recursive: true, force: true })
    })

    test("puts decals on floors with S along +X, like the engine", async () => {
        // 2 units above the top of a 16x16x8 box (side 1)
        const result = await convert(
            "floor",
            `world { ${boxSolid(2, [0, 0, 0], [16, 16, 8], "test/base")} }
            ${decal(7, "test/quad", [8, 8, 10])}`,
        )
        expect(result.stats.decals).toBe(1)
        const file = bakedFile("bpee_overlays", "bpee_overlay_floor_1.png")
        // The top face's texture is 4 texels per unit: u along x, v along -y
        const at = (x, y) =>
            readPngPixel(file, Math.floor(x * 4), Math.floor((16 - y) * 4))
        // The image's top is towards +Y; the decal covers x and y 4-12
        expect(at(5, 11)).toEqual(RED)
        expect(at(11, 11)).toEqual(GREEN)
        expect(at(5, 5)).toEqual(BLUE)
        expect(at(11, 5)).toEqual(WHITE)
        expect(at(1, 1)).toEqual(GREY)
        expect(at(14, 14)).toEqual(GREY)
    })

    test("puts decals on walls with T pointing down", async () => {
        // 1 unit out from the box's +X face (side 4)
        const result = await convert(
            "wall",
            `world { ${boxSolid(2, [0, 0, 0], [16, 16, 8], "test/base")} }
            ${decal(7, "test/quad", [17, 8, 4])}`,
        )
        expect(result.stats.decals).toBe(1)
        const file = bakedFile("bpee_overlays", "bpee_overlay_wall_4.png")
        // That face's texture: u along y, v along -z
        const at = (y, z) =>
            readPngPixel(file, Math.floor(y * 4), Math.floor((8 - z) * 4))
        expect(at(5, 7)).toEqual(RED)
        expect(at(11, 7)).toEqual(GREEN)
        expect(at(5, 1)).toEqual(BLUE)
        expect(at(11, 1)).toEqual(WHITE)
        expect(at(1, 4)).toEqual(GREY)
    })

    test("leaves out decals further than 4 units from every face", async () => {
        const result = await convert(
            "far",
            `world { ${boxSolid(2, [0, 0, 0], [16, 16, 8], "test/base")} }
            ${decal(7, "test/quad", [8, 8, 13])}`,
        )
        expect(result.stats.decals).toBe(0)
        expect(result.warnings).toContain(
            "A decal (test/quad) is not close to any visible brush face in this instance, so it was left out",
        )
    })

    const blendVmf = (alphaRow) => {
        const rows = (row) =>
            Array.from({ length: 5 }, (_, i) => `"row${i}" "${row}"`).join("\n")
        const dispinfo = `
            dispinfo
            {
                "power" "2"
                "startposition" "[0 0 8]"
                normals { ${rows(Array(5).fill("0 0 1").join(" "))} }
                distances { ${rows("0 0 0 0 0")} }
                alphas { ${rows(alphaRow)} }
            }`
        return `world { ${boxSolid(
            2,
            [0, 0, 0],
            [16, 16, 8],
            "test/blend",
        ).replace('"id" "1"', `"id" "1" ${dispinfo}`)} }`
    }

    test("bakes displacement blends by vertex alpha", async () => {
        const result = await convert("blend", blendVmf("0 0 128 255 255"))
        expect(result.stats.blends).toBe(1)

        const obj = fs.readFileSync(result.objPath, "utf8")
        expect(obj).toContain("usemtl bpee_blend_blend_1")
        // The displacement's texture coordinates span the baked texture
        const coords = obj
            .split("\n")
            .filter((line) => line.startsWith("vt "))
            .map((line) => line.split(" ").slice(1).map(Number))
        expect(Math.min(...coords.flat())).toBe(0)
        expect(Math.max(...coords.flat())).toBe(1)

        // Columns of the vertex grid run along the image's width
        const file = bakedFile("bpee_blends", "bpee_blend_blend_1.png")
        const png = fs.readFileSync(file)
        const width = png.readUInt32BE(16)
        const height = png.readUInt32BE(20)
        const middle = Math.floor(height / 2)
        expect(readPngPixel(file, 0, middle)).toEqual(GREY)
        expect(readPngPixel(file, width - 1, middle)).toEqual(BLUE)
        const halfway = readPngPixel(file, Math.floor(width / 2), middle)
        expect(halfway[0]).toBeGreaterThan(0)
        expect(halfway[0]).toBeLessThan(100)
        expect(halfway[2]).toBeGreaterThan(100)
        expect(halfway[2]).toBeLessThan(255)
    })

    test("leaves displacements that only show $basetexture as they are", async () => {
        const result = await convert("unblended", blendVmf("0 0 0 0 0"))
        expect(result.stats.blends).toBe(0)
        expect(fs.readFileSync(result.objPath, "utf8")).toContain(
            "usemtl test/blend",
        )
    })
})

describe("bakeBlend", () => {
    const { bakeBlend, smoothstep } = require("../utils/vmfConverter/blends")
    const solid = (rgba) => ({
        width: 2,
        height: 2,
        rgba: Buffer.from(Array(4).fill(rgba).flat()),
    })

    test("smoothstep matches HLSL", () => {
        expect(smoothstep(0.2, 0.8, 0.1)).toBe(0)
        expect(smoothstep(0.2, 0.8, 0.5)).toBeCloseTo(0.5, 6)
        expect(smoothstep(0.2, 0.8, 0.9)).toBe(1)
        expect(smoothstep(0.5, 0.5, 0.6)).toBe(1)
    })

    test("sharpens the blend with $blendmodulatetexture", () => {
        // Alpha goes 0 -> 1 across the grid; green 128 and red 0 make the
        // blend a hard step in the middle
        const grid = {
            rows: 2,
            cols: 2,
            uv: (i, j) => [j * 4, i * 4],
            alpha: (i, j) => j,
        }
        const image = bakeBlend(
            grid,
            solid([0, 0, 0, 255]),
            solid([255, 255, 255, 255]),
            solid([0, 128, 0, 255]),
            false,
        )
        expect(image.width).toBe(8)
        const pixel = (x) => image.rgba[(x + image.width * 4) * 4]
        expect(pixel(2)).toBe(0)
        expect(pixel(3)).toBe(0)
        expect(pixel(4)).toBe(255)
        expect(pixel(5)).toBe(255)
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

describe("convertVmf: glass and entities hidden at the start", () => {
    let root

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-vmf2obj-glass-"))
        const materials = path.join(root, "content", "materials", "test")
        fs.mkdirSync(materials, { recursive: true })
        // Glass like Portal 2's: the Refract shader has no base texture
        fs.writeFileSync(
            path.join(materials, "glass.vmt"),
            `"Refract" { "$refracttint" "{255 255 255}" "$normalmap" "test/glass_normal" "$translucent" "1" }`,
        )
        // Invisible like BEE2's collision material: no visible pixel
        fs.writeFileSync(
            path.join(materials, "alpha.vtf"),
            buildVtf(4, 4, FORMAT.RGBA8888, Buffer.alloc(4 * 4 * 4, 0)),
        )
        fs.writeFileSync(
            path.join(materials, "invisible.vmt"),
            `"LightmappedGeneric" { "$basetexture" "test/alpha" "$translucent" "1" }`,
        )
        fs.writeFileSync(
            path.join(materials, "wall.vtf"),
            buildVtf(4, 4, FORMAT.RGBA8888, Buffer.alloc(4 * 4 * 4, 200)),
        )
        fs.writeFileSync(
            path.join(materials, "faded.vmt"),
            `"LightmappedGeneric" { "$basetexture" "test/wall" "$alpha" "0" }`,
        )
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

    test("draws Refract glass see-through in its tint", () => {
        expect(
            describeMaterial(
                "refract",
                new Map([["refracttint", "{235 247 247}"]]),
            ),
        ).toMatchObject({
            basetexture: null,
            translucent: true,
            glass: [235 / 255, 247 / 255, 247 / 255],
        })
    })

    test("gives glass a translucent texture instead of the placeholder", async () => {
        const result = await convert(
            "glass",
            `world { "id" "1" ${boxSolid(2, [0, 0, 0], [16, 16, 16], "test/glass")} }`,
        )
        expect(result.stats.placeholderMaterials).toBe(0)
        const mtl = fs.readFileSync(result.mtlPath, "utf8")
        const texture = mtl.match(/map_Kd (materials\/bpee_glass\/\S+\.png)/)
        expect(texture).not.toBeNull()
        expect(mtl).toContain("# beepee:translucent")

        const png = fs.readFileSync(path.join(root, "out", texture[1]))
        // RGBA, partly see-through (the alpha is the 4th byte of the pixel)
        expect(png[25]).toBe(6)
        const raw = zlib.inflateSync(
            png.subarray(41, 41 + png.readUInt32BE(33)),
        )
        expect(raw[1 + 3]).toBeGreaterThan(0)
        expect(raw[1 + 3]).toBeLessThan(255)
    })

    test("leaves out faces that can't be seen", async () => {
        const result = await convert(
            "invisible",
            `world { "id" "1" ${boxSolid(2, [0, 0, 0], [16, 16, 16], "test/glass")}
                ${boxSolid(3, [32, 0, 0], [48, 16, 16], "test/invisible")}
                ${boxSolid(4, [64, 0, 0], [80, 16, 16], "test/faded")} }`,
        )
        expect(result.stats.faces).toBe(6)
        expect(result.stats.invisibleFaces).toBe(12)
        const obj = fs.readFileSync(result.objPath, "utf8")
        expect(obj).not.toContain("test/invisible")
        expect(obj).not.toContain("test/faded")
        // Only the shown box's corners
        expect(obj.match(/^v /gm)).toHaveLength(8)
    })

    test("picks a floor turret's model and skin like the game", () => {
        const { entities } = parseVmf(
            `entity { "id" "1" "classname" "npc_portal_turret_floor" "ModelIndex" "4" "SkinNumber" "1" }
            entity { "id" "2" "classname" "npc_portal_turret_floor" }
            entity { "id" "3" "classname" "npc_portal_turret_floor" "ModelIndex" "1" "model" "models/custom/turret.mdl" }`,
        )
        const converter = Object.create(VmfConverter.prototype)
        expect(entities.map((entity) => converter.modelOf(entity))).toEqual([
            { path: "models/npcs/turret/turret_skeleton.mdl", skin: 1 },
            { path: "models/npcs/turret/turret.mdl", skin: 0 },
            { path: "models/custom/turret.mdl", skin: 0 },
        ])
    })

    test("leaves out faces with dev textures, like tool textures", async () => {
        const result = await convert(
            "dev",
            `world { "id" "1" ${boxSolid(2, [0, 0, 0], [16, 16, 16], "test/glass")}
                ${boxSolid(3, [32, 0, 0], [48, 16, 16], "DEV/DEV_MEASUREGENERIC01")} }`,
        )
        expect(result.stats.faces).toBe(6)
        expect(result.stats.toolFaces).toBe(6)
        expect(fs.readFileSync(result.objPath, "utf8")).not.toMatch(
            /dev_measure/i,
        )
    })

    test("leaves out entities that can't be seen at the start", async () => {
        const glassBox = (id, x) =>
            boxSolid(id, [x, 0, 0], [x + 16, 16, 16], "test/glass")
        const result = await convert(
            "hidden",
            `world { "id" "1" }
            entity { "id" "2" "classname" "func_brush" ${glassBox(3, 0)} }
            entity { "id" "4" "classname" "func_brush" "rendermode" "2" "renderamt" "0" ${glassBox(5, 32)} }
            entity { "id" "6" "classname" "func_brush" "StartDisabled" "1" ${glassBox(7, 64)} }
            entity { "id" "8" "classname" "func_brush" "rendermode" "10" ${glassBox(9, 96)} }
            entity { "id" "10" "classname" "func_brush" "rendermode" "0" "renderamt" "0" ${glassBox(11, 128)} }
            entity { "id" "12" "classname" "prop_dynamic" "model" "models/missing.mdl" "renderamt" "0" "rendermode" "2" "origin" "0 0 0" }`,
        )
        // Shown: the plain brush, and the one whose renderamt doesn't apply
        // (rendermode 0)
        expect(result.stats.faces).toBe(12)
        expect(result.stats.hiddenEntities).toBe(4)
        expect(result.stats.modelEntities).toBe(0)
    })
})

describe("weighted cubes", () => {
    // modelOf doesn't need a session
    const converter = Object.create(VmfConverter.prototype)
    const cube = (keyvalues) =>
        converter.modelOf(
            parseVmf(
                `entity { "id" "1" "classname" "prop_weighted_cube" ${keyvalues} }`,
            ).entities[0],
        )

    test("pick their model by cube type, not the model shown in Hammer", () => {
        expect(
            cube(
                `"model" "models/props/cubes/standard_cube_rusty.mdl" "skintype" "0" "newskins" "2"`,
            ),
        ).toEqual({ path: "models/props/metal_box.mdl", skin: 0 })
        expect(
            cube(`"CubeType" "2" "model" "models/props/metal_box.mdl"`),
        ).toEqual({
            path: "models/props/reflection_cube.mdl",
            skin: 0,
        })
    })

    test("are rusted by their skin type, where the cube has a rusted skin", () => {
        expect(cube(`"CubeType" "0" "SkinType" "1"`)).toEqual({
            path: "models/props/metal_box.mdl",
            skin: 3,
        })
        expect(cube(`"CubeType" "2" "SkinType" "1"`)).toEqual({
            path: "models/props/reflection_cube.mdl",
            skin: 1,
        })
        // No rusted companion cube
        expect(cube(`"CubeType" "1" "SkinType" "1"`)).toEqual({
            path: "models/props/metal_box.mdl",
            skin: 1,
        })
        // Older maps set the skin themselves
        expect(cube(`"CubeType" "0" "SkinType" "1" "newskins" "0"`)).toEqual({
            path: "models/props/metal_box.mdl",
            skin: null,
        })
    })

    test("use their model keyvalue when it's a custom model", () => {
        expect(
            cube(
                `"CubeType" "6" "model" "models/BEE2/cube_color/clean_standard.mdl"`,
            ),
        ).toEqual({
            path: "models/bee2/cube_color/clean_standard.mdl",
            skin: null,
        })
        expect(
            cube(
                `"comp_custom_model_type" "1" "model" "models/custom/cube.mdl"`,
            ),
        ).toEqual({
            path: "models/custom/cube.mdl",
            skin: null,
        })
    })
})
