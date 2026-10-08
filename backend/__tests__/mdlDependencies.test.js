const fs = require("fs")
const os = require("os")
const path = require("path")
const {
    findMdlDependencies,
    gameSearchPaths,
    readMdl,
} = require("../utils/mdlDependencies")
const { buildMdl } = require("./helpers/buildMdl")

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
