const fs = require("fs")
const os = require("os")
const path = require("path")
const {
    findMdlDependencies,
    gameSearchPaths,
    readMdl,
} = require("../utils/mdlDependencies")

/**
 * A minimal MDL: one texture, one $cdmaterials folder, one skin family and
 * one mesh using the texture
 */
function buildMdl(textureName, cdmaterials) {
    const buffer = Buffer.alloc(1024)
    buffer.write("IDST", 0, "latin1")
    buffer.writeInt32LE(49, 4)
    const strings = 900
    buffer.write(`${cdmaterials}\0${textureName}\0`, strings, "latin1")

    // Texture struct at 400: name offset is relative to the struct
    buffer.writeInt32LE(1, 204)
    buffer.writeInt32LE(400, 208)
    buffer.writeInt32LE(strings + cdmaterials.length + 1 - 400, 400)
    // $cdmaterials: an array of offsets from the start of the file
    buffer.writeInt32LE(1, 212)
    buffer.writeInt32LE(470, 216)
    buffer.writeInt32LE(strings, 470)
    // Skin table: 1 family x 1 column -> texture 0
    buffer.writeInt32LE(1, 220)
    buffer.writeInt32LE(1, 224)
    buffer.writeInt32LE(480, 228)
    buffer.writeUInt16LE(0, 480)
    // Body part at 500 -> model at 520 -> mesh at 700 using column 0
    buffer.writeInt32LE(1, 232)
    buffer.writeInt32LE(500, 236)
    buffer.writeInt32LE(1, 504)
    buffer.writeInt32LE(20, 512)
    buffer.writeInt32LE(1, 520 + 72)
    buffer.writeInt32LE(180, 520 + 76)
    buffer.writeInt32LE(0, 700)
    return buffer
}

describe("findMdlDependencies", () => {
    let root
    const write = (file, data) => {
        const target = path.join(root, file)
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, data)
    }

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-mdldeps-"))
        write(
            "portal2/gameinfo.txt",
            `"GameInfo" { FileSystem { SearchPaths { Game |gameinfo_path|. Game custom } } }`,
        )
        write("portal2/models/test/box.mdl", buildMdl("Box", "models\\test\\"))
        // Gib model from the .phy's "break" block
        const phyHeader = Buffer.alloc(16)
        phyHeader.writeInt32LE(16, 0)
        write(
            "portal2/models/test/box.phy",
            Buffer.concat([
                phyHeader,
                Buffer.from(`break { "model" "test/gib" "health" "1" }\0`),
            ]),
        )
        write("custom/models/test/gib.mdl", buildMdl("gib", "models/test"))
        write(
            "portal2/materials/models/test/box.vmt",
            `patch { include "materials/models/test/base.vmt" insert { "$bumpmap" "models/test/box_normal" } }`,
        )
        write(
            "portal2/materials/models/test/base.vmt",
            `"VertexLitGeneric" {
                "$basetexture" "models\\test\\box"
                "$envmap" "env_cubemap"
                "%tooltexture" "models/test/tool"
                "GPU>=2?$detail" "models/test/missing_detail"
                "$bottommaterial" "models/test/water"
                "$surfaceprop" "metal"
            }`,
        )
        write("portal2/materials/models/test/box.vtf", "")
        write(
            "custom/materials/models/test/gib.vmt",
            `"VertexLitGeneric" { "$basetexture" "models/test/gib" }`,
        )
    })

    afterAll(() => {
        fs.rmSync(root, { recursive: true, force: true })
    })

    test("reads textures, materials folders and used skins from an MDL", () => {
        const mdl = readMdl(buildMdl("Box", "models\\test"))
        expect(mdl.textures).toEqual(["Box"])
        expect(mdl.cdmaterials).toEqual(["models/test/", ""])
        expect(mdl.includes).toEqual([])
    })

    test("finds materials like srctools does", async () => {
        const result = await findMdlDependencies("test/box", {
            portal2Root: root,
        })
        expect(result.success).toBe(true)
        expect(result.mdlPath).toBe("models/test/box.mdl")
        expect(result.materials).toEqual(
            [
                // The texture's VMT, found through $cdmaterials
                "materials/models/test/box.vmt",
                // Its patch parent, and textures from both
                "materials/models/test/base.vmt",
                "materials/models/test/box.vtf",
                "materials/models/test/box_normal.vtf",
                "materials/models/test/tool.vtf",
                // Conditional and missing textures are listed too
                "materials/models/test/missing_detail.vtf",
                // Material parameters
                "materials/models/test/water.vmt",
                // The gib's material, from another search path
                "materials/models/test/gib.vmt",
                "materials/models/test/gib.vtf",
            ].sort(),
        )
        expect(result.models).toEqual([
            "models/test/box.mdl",
            "models/test/box.phy",
            "models/test/gib.mdl",
        ])
    })

    test("lists missing models without dependencies", async () => {
        const result = await findMdlDependencies("models/test/nothing.mdl", {
            portal2Root: root,
        })
        expect(result).toEqual({
            success: true,
            mdlPath: "models/test/nothing.mdl",
            materials: [],
            models: ["models/test/nothing.mdl"],
        })
    })

    test("searches DLC, update and platform folders like the game", () => {
        for (const folder of ["portal2_dlc1", "update", "platform"]) {
            fs.mkdirSync(path.join(root, folder), { recursive: true })
        }
        expect(
            gameSearchPaths(root).map((p) =>
                path.relative(root, p).replace(/\\/g, "/"),
            ),
        ).toEqual(["update", "portal2_dlc1", "portal2", "custom", "platform"])
    })
})
