jest.mock("electron", () => ({
    app: { isPackaged: false, getPath: () => require("os").tmpdir() },
}))

const fs = require("fs")
const os = require("os")
const path = require("path")
const { Package } = require("../models/package")

let dir

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-editoritems-"))
})

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
})

/** Load a package with these items: { id, folder, item (its editoritems Item block) } */
async function loadPackage(items) {
    for (const { folder, item } of items) {
        const itemDir = path.join(dir, "items", folder)
        fs.mkdirSync(itemDir, { recursive: true })
        fs.writeFileSync(
            path.join(itemDir, "editoritems.json"),
            JSON.stringify({ Item: item }),
        )
        fs.writeFileSync(
            path.join(itemDir, "properties.json"),
            JSON.stringify({ Properties: {} }),
        )
    }
    fs.writeFileSync(
        path.join(dir, "info.json"),
        JSON.stringify({
            ID: "TEST",
            Name: "Test",
            Item: items.map(({ id, folder }) => ({
                ID: id,
                Version: { Styles: { BEE2_CLEAN: folder } },
            })),
        }),
    )
    const pkg = new Package(path.join(dir, "info.json"))
    pkg.packageDir = dir
    await pkg.load()
    return pkg
}

const editoritemsOf = (folder) =>
    JSON.parse(
        fs.readFileSync(
            path.join(dir, "items", folder, "editoritems.json"),
            "utf8",
        ),
    ).Item

/** An item's editoritems Item block, with its name as its palette name */
const itemBlock = (id, name, more = {}) => ({
    Type: id,
    ItemClass: "ItemBase",
    Editor: { SubType: { Name: name, Palette: { Tooltip: name.toUpperCase() } } },
    Exporting: { Instances: {} },
    ...more,
})

const inputs = {
    BEE2: {
        Type: "AND",
        Enable_cmd: "cube_dropper,Enable,,0,-1",
        Disable_cmd: "cube_dropper,Disable,,0,-1",
    },
}

/** BEE2's editoritems.txt docs: "ConnectionCount ... Required for all items accepting an input" */
describe("ConnectionCount", () => {
    test("is added to an item with inputs when its package loads", async () => {
        await loadPackage([
            {
                id: "bpee_dropper_03AF",
                folder: "dropper",
                item: itemBlock("bpee_dropper_03AF", "Dropper", {
                    Properties: { StartEnabled: { DefaultValue: 1, Index: 2 } },
                    Exporting: { Instances: {}, Inputs: inputs },
                }),
            },
            // One it has (in any case) stays as it is
            {
                id: "bpee_door_03AF",
                folder: "door",
                item: itemBlock("bpee_door_03AF", "Door", {
                    Properties: { connectioncount: { DefaultValue: 0, Index: 3 } },
                    Exporting: { Instances: {}, Inputs: inputs },
                }),
            },
            { id: "bpee_vase_03AF", folder: "vase", item: itemBlock("bpee_vase_03AF", "Vase") },
            // BEE2's antline indicators take inputs without it
            {
                id: "ITEM_INDICATOR_TOGGLE",
                folder: "toggle",
                item: itemBlock("ITEM_INDICATOR_TOGGLE", "Toggle", {
                    Exporting: { Instances: {}, Inputs: inputs },
                }),
            },
        ])

        expect(editoritemsOf("dropper").Properties).toEqual({
            ConnectionCount: { DefaultValue: 0, Index: 1 },
            StartEnabled: { DefaultValue: 1, Index: 2 },
        })
        expect(editoritemsOf("door").Properties).toEqual({
            connectioncount: { DefaultValue: 0, Index: 3 },
        })
        expect(editoritemsOf("vase").Properties).toBeUndefined()
        expect(editoritemsOf("toggle").Properties).toBeUndefined()
    })

    test("is added when an item gets an input", async () => {
        const pkg = await loadPackage([
            { id: "bpee_vase_03AF", folder: "vase", item: itemBlock("bpee_vase_03AF", "Vase") },
        ])
        pkg.items[0].addInput("BEE2", inputs.BEE2)

        expect(editoritemsOf("vase").Properties).toEqual({
            ConnectionCount: { DefaultValue: 0, Index: 1 },
        })
    })
})

/** The palette name is what Portal 2's palette shows for the item */
describe("the palette name", () => {
    test("is the item's name in capitals when its package loads, if it was blank", async () => {
        await loadPackage([
            {
                id: "bpee_exposedcubedropper_03AF",
                folder: "dropper",
                item: itemBlock("bpee_exposedcubedropper_03AF", "Exposed cube dropper", {
                    Editor: {
                        SubType: [
                            { Name: "Exposed cube dropper", Palette: { Tooltip: "" } },
                            { Name: "Exposed sphere dropper", Palette: {} },
                        ],
                    },
                }),
            },
            // The package's own stays
            {
                id: "ITEM_BUTTON_FLOOR",
                folder: "button",
                item: itemBlock("ITEM_BUTTON_FLOOR", "Weighted Button", {
                    Editor: {
                        SubType: {
                            Name: "Weighted Button",
                            Palette: { Tooltip: "PORTAL2_PuzzleEditor_Palette_floor_button" },
                        },
                    },
                }),
            },
            // A subtype that isn't in the palette gets no palette name
            {
                id: "bpee_hidden_03AF",
                folder: "hidden",
                item: itemBlock("bpee_hidden_03AF", "Hidden", {
                    Editor: { SubType: { Name: "Hidden" } },
                }),
            },
        ])

        expect(
            editoritemsOf("dropper").Editor.SubType.map((s) => s.Palette.Tooltip),
        ).toEqual(["EXPOSED CUBE DROPPER", "EXPOSED SPHERE DROPPER"])
        expect(editoritemsOf("button").Editor.SubType.Palette.Tooltip).toBe(
            "PORTAL2_PuzzleEditor_Palette_floor_button",
        )
        expect(editoritemsOf("hidden").Editor.SubType.Palette).toBeUndefined()
    })

    test("follows the item's name when it's renamed and saved", async () => {
        const pkg = await loadPackage([
            {
                id: "bpee_dropper_03AF",
                folder: "dropper",
                item: itemBlock("bpee_dropper_03AF", "Exposed cube dropper"),
            },
            // The package's own stays
            {
                id: "bpee_buttons_03AF",
                folder: "buttons",
                item: itemBlock("bpee_buttons_03AF", "Weighted Button", {
                    Editor: {
                        SubType: {
                            Name: "Weighted Button",
                            Palette: { Tooltip: "BUTTONS" },
                        },
                    },
                }),
            },
        ])
        const { saveItem } = require("../saveItem")
        for (const item of pkg.items) {
            await saveItem({
                id: item.id,
                name: `${item.name} 2`,
                fullItemPath: item.fullItemPath,
                details: { ...item.details },
            })
        }

        expect(editoritemsOf("dropper").Editor.SubType).toEqual({
            Name: "Exposed cube dropper 2",
            Palette: { Tooltip: "EXPOSED CUBE DROPPER 2" },
        })
        expect(editoritemsOf("buttons").Editor.SubType.Palette.Tooltip).toBe(
            "BUTTONS",
        )
    })
})
