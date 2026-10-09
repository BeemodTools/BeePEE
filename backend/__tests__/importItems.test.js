// Importing items from another package (Edit > Import from Package): with
// the files their instances and conditions use, and their config groups

jest.mock("electron", () => ({
    app: { isPackaged: false },
    dialog: {
        showOpenDialog: async () => ({
            canceled: false,
            filePaths: ["C:/packages/source.bpee"],
        }),
        showErrorBox: jest.fn(),
    },
}))

// A fake Portal 2 install, and the packages, made in beforeAll
let mockRoot = null
let mockSource = null
let mockTarget = null
jest.mock("../data", () => ({
    findPortal2Resources: async () => ({ root: mockRoot }),
}))
jest.mock("../packageManager", () => ({
    packages: [],
    getCurrentPackageDir: () => mockTarget,
    // The source is a folder already (processVdfFiles has nothing to do)
    extractPackage: async (file, dir) =>
        require("fs").cpSync(mockSource, dir, { recursive: true }),
    processVdfFiles: () => {},
}))
jest.mock("../items/itemEditor", () => ({
    createImportItemsWindow: () => {},
    closeImportItemsWindow: () => {},
}))

const fs = require("fs")
const os = require("os")
const path = require("path")
const { buildMdl } = require("./helpers/buildMdl")
const { register, startImportFlow } = require("../handlers/importHandlers")

/** Write a file: text, a Buffer, or an object as JSON */
function write(file, content = "x") {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const isJson = typeof content === "object" && !Buffer.isBuffer(content)
    fs.writeFileSync(file, isJson ? JSON.stringify(content) : content)
}

/** A VMF: a brush with these materials, and these entities */
function vmf(materials, entities = []) {
    const sides = materials.map(
        (material, i) =>
            `side { "id" "${i + 3}" "plane" "(0 0 0) (1 0 0) (0 1 0)" "material" "${material}" }`,
    )
    return [
        `world { "id" "1" "classname" "worldspawn" solid { "id" "2" ${sides.join(" ")} } }`,
        ...entities.map(
            (entity, i) => `entity { "id" "${100 + i}" ${entity} }`,
        ),
    ].join("\n")
}

const COLOR_GROUP = {
    ID: "COLOR_ITEM",
    Name: "Color Item - Color",
    Widget: { ID: "color", Label: "Color", Type: "color", UseTimer: "1" },
}
const SPEED_GROUP = {
    ID: "Speed_Cfg",
    Name: "Speeds",
    Widget: { ID: "speed", Type: "slider" },
}
const UNUSED_GROUP = { ID: "UNUSED_CFG", Name: "Unused" }

describe("importing items from a package", () => {
    let root

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-import-items-"))
        mockRoot = path.join(root, "Portal 2")
        write(
            path.join(mockRoot, "portal2/gameinfo.txt"),
            `"GameInfo" { FileSystem { SearchPaths { Game |gameinfo_path|. } } }`,
        )
        write(
            path.join(mockRoot, "portal2/materials/metal/base.vmt"),
            '"LightmappedGeneric" { "$basetexture" "metal/base" }',
        )

        // The package the items come from: COLOR_ITEM has two styles, each
        // with its instance, autopacked files, colors and a condition that
        // reads another config group
        mockSource = path.join(root, "source")
        const src = (file) => path.join(mockSource, file)
        write(src("info.json"), {
            ID: "SOURCE",
            Name: "Source",
            Item: [
                {
                    ID: "COLOR_ITEM",
                    Version: {
                        Styles: {
                            BEE2_CLEAN: "color_item",
                            BEE2_OVERGROWTH: "color_item_og",
                        },
                    },
                },
                {
                    ID: "OTHER_ITEM",
                    Version: { Styles: { BEE2_CLEAN: "other" } },
                },
            ],
            ConfigGroup: [COLOR_GROUP, SPEED_GROUP, UNUSED_GROUP],
            BrushTemplate: [
                { ID: "TEMP_COLOR_FRAME", File: "color_frame.vmf" },
                { ID: "TEMP_UNUSED", File: "unused.vmf" },
                // Leads out of the packages
                { ID: "TEMP_ESCAPE", File: "../../outside/escaped.vmf" },
            ],
        })
        write(src("templates/color_frame.vmf"), vmf(["custom/framed"]))
        write(src("templates/unused.vmf"), vmf(["custom/unrelated"]))
        write(path.join(root, "outside/escaped.vmf"), vmf(["custom/unrelated"]))
        const editoritems = (name, ...instances) => ({
            Item: {
                Type: "COLOR_ITEM",
                Editor: { SubType: { Name: name } },
                Exporting: {
                    Instances: Object.fromEntries(
                        instances.map((instance, i) => [i, { Name: instance }]),
                    ),
                },
            },
        })
        write(
            src("items/color_item/editoritems.json"),
            editoritems(
                "Color Item",
                "instances/BEE2/bpee/color_item/main.vmf",
            ),
        )
        write(src("items/color_item/properties.json"), { Properties: {} })
        write(
            src("items/color_item/vbsp_config.cfg"),
            [
                '"Conditions"',
                "{",
                '\t"Condition"',
                "\t{",
                '\t\t"Result"',
                "\t\t{",
                '\t\t\t"GetItemConfig" { "ID" "SPEED_CFG" "Name" "speed" "ResultVar" "$speed" }',
                '\t\t\t"AddOverlay" { "Material" "custom/decal" }',
                '\t\t\t"TemplateBrush" { "ID" "TEMP_COLOR_FRAME:frame_vis" }',
                '\t\t\t"TemplateBrush" { "ID" "TEMP_ESCAPE" }',
                "\t\t}",
                "\t}",
                "}",
            ].join("\n"),
        )
        write(
            src("items/color_item_og/editoritems.json"),
            editoritems(
                "Color Item",
                "instances/BEE2/bpee/color_item/mossy.vmf",
                // Leads out of the packages
                "instances/BEE2/../../../outside/escaped.vmf",
            ),
        )
        write(src("items/color_item_og/properties.json"), { Properties: {} })
        write(
            src("resources/instances/bpee/color_item/main.vmf"),
            vmf(
                ["custom/painted", "metal/base"],
                [`"classname" "prop_dynamic" "model" "models/custom/lamp.mdl"`],
            ),
        )
        write(
            src("resources/instances/bpee/color_item/mossy.vmf"),
            vmf(["custom/mossy"]),
        )
        for (const material of [
            "painted",
            "mossy",
            "decal",
            "framed",
            "unrelated",
        ]) {
            write(
                src(`resources/materials/custom/${material}.vmt`),
                `"LightmappedGeneric" { "$basetexture" "custom/${material}_tex" }`,
            )
            write(src(`resources/materials/custom/${material}_tex.vtf`))
        }
        write(
            src("resources/models/custom/lamp.mdl"),
            buildMdl("lamp_skin", "models/custom/"),
        )
        write(src("resources/models/custom/lamp.vvd"))
        write(
            src("resources/materials/models/custom/lamp_skin.vmt"),
            '"VertexLitGeneric" { "$basetexture" "models/custom/lamp_tex" }',
        )
        write(src("resources/materials/models/custom/lamp_tex.vtf"))
        // What BeePEE keeps for the item
        write(src(".bpee/color_item/models/preview.obj"), "o lamp")

        // The package they go into, which has a config group of its own
        // (deeper, so a path leading out of it isn't one leading out of the
        // source)
        mockTarget = path.join(root, "nested", "target")
        write(path.join(mockTarget, "info.json"), {
            ID: "TARGET",
            Item: [],
            ConfigGroup: { ID: "TARGET_OWN", Name: "Own" },
        })
    })

    afterAll(() => {
        fs.rmSync(root, { recursive: true, force: true })
    })

    test("brings the files their instances and conditions use, and their config groups", async () => {
        const handlers = {}
        const mainWindow = {
            webContents: { send: jest.fn() },
            isDestroyed: () => false,
            focus: () => {},
        }
        register(
            { handle: (name, handler) => (handlers[name] = handler) },
            mainWindow,
        )

        // The package's extracted in the test's folder, where the paths
        // leading out of it lead to a file
        const tmpdir = jest.spyOn(os, "tmpdir").mockReturnValue(root)
        let result
        try {
            await startImportFlow(mainWindow)
            const manifest = await handlers["import-items-manifest"]()
            expect(manifest.items.map((item) => item.id)).toEqual([
                "COLOR_ITEM",
                "OTHER_ITEM",
            ])
            result = await handlers["import-items-execute"](
                {},
                { itemIds: ["COLOR_ITEM"], signageIds: [] },
            )
        } finally {
            tmpdir.mockRestore()
        }
        expect(result.success).toBe(true)

        const exists = (file) => fs.existsSync(path.join(mockTarget, file))
        // Both styles' instances
        expect(exists("resources/instances/bpee/color_item/main.vmf")).toBe(
            true,
        )
        expect(exists("resources/instances/bpee/color_item/mossy.vmf")).toBe(
            true,
        )
        // What they use (the lamp's material too), and what the condition does
        for (const file of [
            "materials/custom/painted.vmt",
            "materials/custom/painted_tex.vtf",
            "materials/custom/mossy.vmt",
            "materials/custom/mossy_tex.vtf",
            "models/custom/lamp.mdl",
            "models/custom/lamp.vvd",
            "materials/models/custom/lamp_skin.vmt",
            "materials/models/custom/lamp_tex.vtf",
            "materials/custom/decal.vmt",
            "materials/custom/decal_tex.vtf",
            "materials/custom/framed.vmt",
            "materials/custom/framed_tex.vtf",
        ]) {
            expect(exists(`resources/${file}`)).toBe(true)
        }
        // Not other items' files, or the game's
        expect(exists("resources/materials/custom/unrelated.vmt")).toBe(false)
        expect(exists("resources/materials/metal/base.vmt")).toBe(false)
        expect(exists(".bpee/color_item/models/preview.obj")).toBe(true)
        // The template its condition uses
        expect(exists("templates/color_frame.vmf")).toBe(true)
        expect(exists("templates/unused.vmf")).toBe(false)
        // Nothing went out of the package
        expect(fs.existsSync(path.join(root, "nested/outside"))).toBe(false)

        // Its colors' group and the one its condition reads, after the
        // package's own
        const info = JSON.parse(
            fs.readFileSync(path.join(mockTarget, "info.json"), "utf8"),
        )
        expect(info.ConfigGroup).toEqual([
            { ID: "TARGET_OWN", Name: "Own" },
            COLOR_GROUP,
            SPEED_GROUP,
        ])
        expect(info.BrushTemplate).toEqual({
            ID: "TEMP_COLOR_FRAME",
            File: "color_frame.vmf",
        })
        expect(info.Item.map((item) => item.ID)).toEqual(["COLOR_ITEM"])
    })
})
