jest.mock("electron", () => ({ app: { isPackaged: false } }))

// A fake Portal 2 install, made in beforeAll
let mockRoot = null
jest.mock("../data", () => ({
    findPortal2Resources: async () => ({ root: mockRoot }),
}))

// A VMF named "unreadable" can't be read (a file another program has open)
jest.mock("../utils/autopacker", () => {
    const actual = jest.requireActual("../utils/autopacker")
    return {
        ...actual,
        sortInstanceFiles: jest.fn((vmfPath, ...rest) =>
            jest.requireActual("path").basename(vmfPath) === "unreadable.vmf"
                ? Promise.reject(new Error("EBUSY: resource busy or locked"))
                : actual.sortInstanceFiles(vmfPath, ...rest),
        ),
    }
})

const fs = require("fs")
const os = require("os")
const path = require("path")
const { buildMdl } = require("./helpers/buildMdl")
const {
    instanceFiles,
    noteRemovedFiles,
    removeUnusedFiles,
    takeRemovedFiles,
} = require("../utils/packageFiles")

function write(file, content = "x") {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
}

/** A VMF: a brush with these materials, and these entities */
function vmf(materials, entities = []) {
    const sides = materials.map(
        (material, i) =>
            `side { "id" "${i + 3}" "plane" "(0 0 0) (1 0 0) (0 1 0)" "material" "${material}" }`,
    )
    return [
        `versioninfo { "editorversion" "400" }`,
        `world { "id" "1" "classname" "worldspawn" solid { "id" "2" ${sides.join(" ")} } }`,
        ...entities.map(
            (entity, i) => `entity { "id" "${100 + i}" ${entity} }`,
        ),
    ].join("\n")
}

/** What item A's instance uses that nothing else does */
const ONLY_A = [
    "materials/custom/only_a.vmt",
    "materials/custom/only_a_tex.vtf",
    "materials/models/custom/prop_a_skin.vmt",
    "materials/models/custom/prop_a_tex.vtf",
    "models/custom/prop_a.dx90.vtx",
    "models/custom/prop_a.mdl",
    "models/custom/prop_a.vvd",
    "sound/custom/beep_a.wav",
]

describe("the files a package's instances use", () => {
    let root

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-package-files-"))
        mockRoot = root
        const game = path.join(root, "portal2")
        write(
            path.join(game, "gameinfo.txt"),
            `"GameInfo" { FileSystem { SearchPaths { Game |gameinfo_path|. } } }`,
        )
        // The game's own material
        write(
            path.join(game, "materials/metal/base.vmt"),
            '"LightmappedGeneric" { "$basetexture" "metal/base" }',
        )
        write(path.join(game, "materials/metal/base.vtf"))
    })

    afterAll(() => {
        fs.rmSync(root, { recursive: true, force: true })
    })

    /**
     * A package: item A's instance, item B's, a template, and the files
     * they use. Item B's conditions name a material A's instance uses too.
     */
    function makePackage(name) {
        const dir = path.join(root, name)
        const res = (file) => path.join(dir, "resources", file)
        write(
            res("instances/bpee/item_a/a.vmf"),
            vmf(
                [
                    "CUSTOM/SHARED",
                    "custom/only_a",
                    "custom/cond",
                    "custom/templ",
                    "metal/base",
                    "models/props_map_editor/editor_skin",
                ],
                [
                    `"classname" "prop_dynamic" "model" "models/custom/prop_a.mdl"`,
                    `"classname" "ambient_generic" "message" ")custom/beep_a.wav"`,
                ],
            ),
        )
        write(
            res("instances/bpee/item_b/b.vmf"),
            vmf(["custom/shared", "custom/only_b"]),
        )
        // A brush template (BEE2 has them outside resources)
        write(path.join(dir, "templates/t.vmf"), vmf(["custom/templ"]))
        for (const material of [
            "shared",
            "only_a",
            "only_b",
            "cond",
            "templ",
        ]) {
            write(
                res(`materials/custom/${material}.vmt`),
                `"LightmappedGeneric" { "$basetexture" "custom/${material}_tex" }`,
            )
            write(res(`materials/custom/${material}_tex.vtf`))
        }
        write(
            res("materials/models/props_map_editor/editor_skin.vmt"),
            '"VertexLitGeneric" {}',
        )
        write(
            res("models/custom/prop_a.mdl"),
            buildMdl("prop_a_skin", "models/custom/"),
        )
        write(res("models/custom/prop_a.vvd"))
        write(res("models/custom/prop_a.dx90.vtx"))
        write(
            res("materials/models/custom/prop_a_skin.vmt"),
            '"VertexLitGeneric" { "$basetexture" "models/custom/prop_a_tex" }',
        )
        write(res("materials/models/custom/prop_a_tex.vtf"))
        write(res("sound/custom/beep_a.wav"))
        write(
            path.join(dir, "items/item_b/vbsp_config.cfg"),
            `"Conditions" { "Condition" { "Result" { "AddOverlay" { "Material" "custom/cond" } } } }`,
        )
        write(
            path.join(dir, "info.json"),
            JSON.stringify({
                ID: name,
                Item: [{ ID: "ITEM_A" }, { ID: "ITEM_B" }],
            }),
        )
        return dir
    }

    const instanceA = (dir) =>
        path.join(dir, "resources/instances/bpee/item_a/a.vmf")
    const exists = (dir, file) =>
        fs.existsSync(path.join(dir, "resources", file))

    test("are what they name and what those need, that the package has", async () => {
        const dir = makePackage("finds")
        const files = await instanceFiles(dir, [instanceA(dir)])
        expect([...files].sort()).toEqual(
            [
                ...ONLY_A,
                "materials/custom/cond.vmt",
                "materials/custom/cond_tex.vtf",
                "materials/custom/shared.vmt",
                "materials/custom/shared_tex.vtf",
                "materials/custom/templ.vmt",
                "materials/custom/templ_tex.vtf",
                "materials/models/props_map_editor/editor_skin.vmt",
            ].sort(),
        )
    })

    test("only a removed instance used are deleted", async () => {
        const dir = makePackage("removes")
        const files = await instanceFiles(dir, [instanceA(dir)])
        fs.unlinkSync(instanceA(dir))

        expect(await removeUnusedFiles(dir, files)).toEqual(ONLY_A)
        for (const file of ONLY_A) expect(exists(dir, file)).toBe(false)
        // Item B's instance, its conditions and the template use these,
        // and the editor's files stay
        for (const file of [
            "materials/custom/shared.vmt",
            "materials/custom/shared_tex.vtf",
            "materials/custom/cond.vmt",
            "materials/custom/cond_tex.vtf",
            "materials/custom/templ.vmt",
            "materials/custom/templ_tex.vtf",
            "materials/models/props_map_editor/editor_skin.vmt",
        ]) {
            expect(exists(dir, file)).toBe(true)
        }
        // Folders left empty go too
        expect(exists(dir, "sound")).toBe(false)
        expect(exists(dir, "models")).toBe(false)
        expect(exists(dir, "materials/models/custom")).toBe(false)
        expect(exists(dir, "materials/models/props_map_editor")).toBe(true)
    })

    test("an instance added in the same save uses are kept", async () => {
        const dir = makePackage("readded")
        noteRemovedFiles(dir, await instanceFiles(dir, [instanceA(dir)]))
        fs.unlinkSync(instanceA(dir))
        // Added after it was removed: an instance with the same prop
        write(
            path.join(dir, "resources/instances/bpee/item_a/a2.vmf"),
            vmf(
                [],
                [
                    `"classname" "prop_dynamic" "model" "models/custom/prop_a.mdl"`,
                ],
            ),
        )

        expect(await removeUnusedFiles(dir, takeRemovedFiles(dir))).toEqual([
            "materials/custom/only_a.vmt",
            "materials/custom/only_a_tex.vtf",
            "sound/custom/beep_a.wav",
        ])
        expect(exists(dir, "models/custom/prop_a.mdl")).toBe(true)
        expect(exists(dir, "materials/models/custom/prop_a_tex.vtf")).toBe(true)
        // Taken: nothing's noted anymore
        expect(takeRemovedFiles(dir).size).toBe(0)
    })

    test("packed after the last search are seen", async () => {
        const dir = makePackage("packed")
        // Searching builds the file index
        const files = await instanceFiles(dir, [instanceA(dir)])
        fs.unlinkSync(instanceA(dir))
        // Packed since: a material with item A's texture, for a new instance
        write(
            path.join(dir, "resources/materials/custom/new.vmt"),
            '"LightmappedGeneric" { "$basetexture" "custom/only_a_tex" }',
        )
        write(
            path.join(dir, "resources/instances/bpee/item_a/a3.vmf"),
            vmf(["custom/new"]),
        )

        const removed = await removeUnusedFiles(dir, files)
        expect(removed).toContain("materials/custom/only_a.vmt")
        expect(removed).not.toContain("materials/custom/only_a_tex.vtf")
        expect(exists(dir, "materials/custom/only_a_tex.vtf")).toBe(true)
    })

    test("are all kept when a VMF can't be read", async () => {
        const dir = makePackage("locked")
        const files = await instanceFiles(dir, [instanceA(dir)])
        expect(files.size).toBe(15)
        fs.unlinkSync(instanceA(dir))
        write(
            path.join(dir, "resources/instances/other/unreadable.vmf"),
            vmf(["custom/only_a"]),
        )

        expect(await removeUnusedFiles(dir, files)).toEqual([])
        for (const file of ONLY_A) expect(exists(dir, file)).toBe(true)
    })

    test("are all kept when Portal 2 isn't found", async () => {
        const dir = makePackage("noportal")
        const files = await instanceFiles(dir, [instanceA(dir)])
        fs.unlinkSync(instanceA(dir))

        mockRoot = null
        try {
            expect(await removeUnusedFiles(dir, files)).toEqual([])
            // And none are found to delete later
            expect(
                (
                    await instanceFiles(dir, [
                        path.join(dir, "resources/instances/bpee/item_b/b.vmf"),
                    ])
                ).size,
            ).toBe(0)
        } finally {
            mockRoot = root
        }
        for (const file of ONLY_A) expect(exists(dir, file)).toBe(true)
    })
})
