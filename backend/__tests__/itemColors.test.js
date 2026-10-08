jest.mock("electron", () => ({
    app: { isPackaged: false, getPath: () => require("os").tmpdir() },
    dialog: {},
    ipcMain: { handle() {}, on() {} },
}))

const fs = require("fs")
const os = require("os")
const path = require("path")
const { parse } = require("../utils/keyvalues")
const { convertJsonToVdf } = require("../packageManager")
const { Package } = require("../models/package")
const {
    MAX_COLORS,
    colorCount,
    colorGroupId,
    withColors,
} = require("../utils/itemColors")

/** Entries as [key, value or children] */
const keyvalues = (entries) =>
    entries.map(({ key, value, children }) => [
        key,
        children ? keyvalues(children) : value,
    ])

const color = (n, Default) => ({
    ID: `color${n}`,
    Label: `Color ${n}`,
    Type: "color",
    Default,
})

describe("an item's colors", () => {
    test("are color widgets in the item's own config group", () => {
        const info = { ID: "TEST", Item: { ID: "ITEM_BOMB" } }
        withColors(info, { itemId: "ITEM_BOMB", itemName: "Bomb", count: 3 })
        expect(info.ConfigGroup).toEqual({
            ID: "ITEM_BOMB",
            Name: "Bomb",
            Widget: [
                color(1, "25 25 230"),
                color(2, "230 25 25"),
                color(3, "25 230 25"),
            ],
        })
        expect(colorCount(info, "item_bomb")).toBe(3)
        expect(colorCount(info, "ITEM_OTHER")).toBe(0)
    })

    test("one is just Color", () => {
        const info = {}
        withColors(info, { itemId: "ITEM_BOMB", itemName: "Bomb", count: 1 })
        expect(info.ConfigGroup.Widget).toEqual({
            ID: "color1",
            Label: "Color",
            Type: "color",
            Default: "25 25 230",
        })
    })

    test("are 1 to 30, all different", () => {
        const info = {}
        withColors(info, { itemId: "ITEM_BOMB", itemName: "Bomb", count: 99 })
        expect(colorCount(info, "ITEM_BOMB")).toBe(MAX_COLORS)
        const defaults = info.ConfigGroup.Widget.map((widget) => widget.Default)
        expect(new Set(defaults).size).toBe(MAX_COLORS)
    })

    test("keep the group's other widgets, other groups, and how a color was written", () => {
        const other = { ID: "OTHER", Name: "Other", Widget: color(1, "1 2 3") }
        const info = {
            ConfigGroup: [
                other,
                {
                    id: "ITEM_BOMB",
                    Name: "Bomb Settings",
                    widget: [
                        {
                            id: "Color1",
                            Label: "Fuse",
                            Type: "rgb",
                            Default: "#ff0000",
                        },
                        { ID: "speed", Label: "Speed", Type: "slider" },
                    ],
                },
            ],
        }
        withColors(info, { itemId: "ITEM_BOMB", itemName: "Bomb", count: 2 })
        expect(info.ConfigGroup[0]).toEqual(other)
        expect(info.ConfigGroup[1]).toEqual({
            id: "ITEM_BOMB",
            Name: "Bomb",
            widget: [
                {
                    id: "Color1",
                    Label: "Fuse",
                    Type: "rgb",
                    Default: "#ff0000",
                },
                color(2, "230 25 25"),
                { ID: "speed", Label: "Speed", Type: "slider" },
            ],
        })

        // None: the colors go, the group stays for its other widget
        withColors(info, { itemId: "ITEM_BOMB", itemName: "Bomb 2", count: 0 })
        expect(info.ConfigGroup[1]).toEqual({
            id: "ITEM_BOMB",
            Name: "Bomb",
            widget: { ID: "speed", Label: "Speed", Type: "slider" },
        })
    })

    test("none take the group out when nothing else is in it", () => {
        const info = { ID: "TEST" }
        withColors(info, { itemId: "ITEM_BOMB", itemName: "Bomb", count: 2 })
        withColors(info, { itemId: "ITEM_BOMB", count: 0 })
        expect(info).toEqual({ ID: "TEST" })
        expect(
            withColors({ ID: "TEST" }, { itemId: "ITEM_BOMB", count: 0 }),
        ).toEqual({ ID: "TEST" })
    })

    describe("of an item", () => {
        let dir
        let itemDir

        /** The package, with the BOMB item */
        const loadItem = async () => {
            fs.mkdirSync(itemDir, { recursive: true })
            fs.writeFileSync(
                path.join(itemDir, "editoritems.json"),
                JSON.stringify({
                    Item: {
                        Type: "ITEM_BOMB",
                        Editor: { SubType: { Name: "Bomb" } },
                        Exporting: {
                            Instances: { 0: { Name: "instances/b.vmf" } },
                        },
                    },
                }),
            )
            fs.writeFileSync(
                path.join(itemDir, "properties.json"),
                JSON.stringify({ Properties: { Authors: "Tester" } }),
            )
            fs.writeFileSync(
                path.join(dir, "info.json"),
                JSON.stringify({
                    ID: "TEST",
                    Name: "Test",
                    Item: {
                        ID: "ITEM_BOMB",
                        Version: { Styles: { BEE2_CLEAN: "bomb" } },
                    },
                }),
            )
            const pkg = new Package(path.join(dir, "info.json"))
            pkg.packageDir = dir
            await pkg.load()
            return pkg.items[0]
        }

        const info = () =>
            JSON.parse(fs.readFileSync(path.join(dir, "info.json"), "utf8"))

        beforeEach(() => {
            dir = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-colors-"))
            itemDir = path.join(dir, "items", "bomb")
        })

        afterEach(() => {
            fs.rmSync(dir, { recursive: true, force: true })
        })

        test("are its Color variable, saved in info.json, not as a property", async () => {
            const item = await loadItem()
            expect(
                item.saveVariables([
                    {
                        presetKey: "StartEnabled",
                        customValue: "1",
                        type: "boolean",
                    },
                    { presetKey: "Color", customValue: "3", type: "colors" },
                ]),
            ).toBe(true)

            const editorItems = JSON.parse(
                fs.readFileSync(path.join(itemDir, "editoritems.json"), "utf8"),
            )
            expect(Object.keys(editorItems.Item.Properties)).toEqual([
                "StartEnabled",
            ])
            expect(info().ConfigGroup).toEqual({
                ID: "ITEM_BOMB",
                Name: "Bomb",
                Widget: [
                    color(1, "25 25 230"),
                    color(2, "230 25 25"),
                    color(3, "25 230 25"),
                ],
            })
            expect(
                item
                    .getVariables()
                    .map((v) => [v.presetKey, v.type, v.customValue]),
            ).toEqual([
                ["StartEnabled", "boolean", "1"],
                ["Color", "colors", "3"],
            ])

            // BEE2 reads them from info.txt
            const vdf = keyvalues(parse(convertJsonToVdf(info())))
            expect(vdf.find(([key]) => key === "ConfigGroup")).toEqual([
                "ConfigGroup",
                [
                    ["ID", "ITEM_BOMB"],
                    ["Name", "Bomb"],
                    ...[
                        ["color1", "Color 1", "25 25 230"],
                        ["color2", "Color 2", "230 25 25"],
                        ["color3", "Color 3", "25 230 25"],
                    ].map(([id, label, value]) => [
                        "Widget",
                        [
                            ["ID", id],
                            ["Label", label],
                            ["Type", "color"],
                            ["Default", value],
                        ],
                    ]),
                ],
            ])

            // Taking the variable out takes them out
            expect(item.saveVariables([])).toBe(true)
            expect(info().ConfigGroup).toBeUndefined()
            expect(item.getVariables()).toEqual([])
        })

        test("go in a fixup with a Set Color block", async () => {
            const item = await loadItem()
            const blocks = [
                {
                    id: "set",
                    type: "setColor",
                    variable: "$item_color",
                    color: "3",
                },
                // The color of the timer's value ("color5" at 5)
                {
                    id: "timer",
                    type: "setColor",
                    variable: "item_color",
                    color: "match",
                    matchVariable: "$timer_delay",
                },
                {
                    id: "if",
                    type: "if",
                    variable: "$start_enabled",
                    operator: "==",
                    value: "1",
                    thenBlocks: [
                        {
                            id: "inIf",
                            type: "setColor",
                            variable: "$on_color",
                            color: "2",
                        },
                    ],
                },
                // No fixup to match yet: nothing
                {
                    id: "unfinished",
                    type: "setColor",
                    variable: "$item_color",
                    color: "match",
                },
            ]
            item.saveConditions({ blocks })

            const getItemConfig = (name, into) => [
                "GetItemConfig",
                [
                    ["ID", "ITEM_BOMB"],
                    ["Name", name],
                    ["ResultVar", into],
                    ["Default", "25 25 230"],
                ],
            ]
            const instance = ["Instance", "<ITEM_BOMB>"]
            const conditions = parse(
                fs.readFileSync(path.join(itemDir, "vbsp_config.cfg"), "utf8"),
            ).find((entry) => entry.key === "Conditions").children
            expect(keyvalues(conditions)).toEqual([
                [
                    "Condition",
                    [
                        instance,
                        ["Result", [getItemConfig("color3", "$item_color")]],
                    ],
                ],
                [
                    "Condition",
                    [
                        instance,
                        [
                            "Result",
                            [getItemConfig("color$timer_delay", "$item_color")],
                        ],
                    ],
                ],
                [
                    "Condition",
                    [
                        instance,
                        ["instVar", "$start_enabled == 1"],
                        ["Result", [getItemConfig("color2", "$on_color")]],
                    ],
                ],
                ["Condition", [instance]],
            ])
            // And they're the editor's blocks when it opens them again
            expect(item.getConditions().blocks).toEqual(blocks)
        })

        test("are fetched from their group's ID as it's written (BEE2 matches it exactly)", async () => {
            const item = await loadItem()
            fs.writeFileSync(
                path.join(dir, "info.json"),
                JSON.stringify({
                    ...info(),
                    ConfigGroup: {
                        ID: "Item_Bomb",
                        Name: "Bomb",
                        Widget: color(1, "1 2 3"),
                    },
                }),
            )
            expect(colorGroupId(info(), "ITEM_BOMB")).toBe("Item_Bomb")
            expect(colorGroupId({}, "ITEM_BOMB")).toBe("ITEM_BOMB")

            item.saveConditions({
                blocks: [
                    {
                        id: "set",
                        type: "setColor",
                        variable: "$item_color",
                        color: "1",
                    },
                ],
            })
            const text = fs.readFileSync(
                path.join(itemDir, "vbsp_config.cfg"),
                "utf8",
            )
            expect(text).toMatch(/"ID"\s+"Item_Bomb"/)
        })
    })
})
