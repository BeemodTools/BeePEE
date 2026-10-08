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
    DEFAULT_COLORS,
    hasColors,
    colorDefaults,
    colorGroupId,
    withColors,
} = require("../utils/itemColors")

/** Entries as [key, value or children] */
const keyvalues = (entries) =>
    entries.map(({ key, value, children }) => [
        key,
        children ? keyvalues(children) : value,
    ])

/** BeePEE's timer color widget, as it writes it */
const colorWidget = {
    ID: "color",
    Label: "Color",
    Type: "color",
    UseTimer: "1",
    Default: DEFAULT_COLORS,
}

describe("an item's colors", () => {
    test("are a timer color widget in the item's own config group, like the Cube Coloriser's", () => {
        const info = { ID: "TEST", Item: { ID: "ITEM_BOMB" } }
        withColors(info, { itemId: "ITEM_BOMB", itemName: "Bomb", on: true })
        expect(info.ConfigGroup).toEqual({
            ID: "ITEM_BOMB",
            Name: "Bomb - Color",
            Widget: colorWidget,
        })
        expect(hasColors(info, "item_bomb")).toBe(true)
        expect(hasColors(info, "ITEM_OTHER")).toBe(false)

        // A color for each timer value BEE2 has one for, 3 to 30: empty (the
        // background of BEE2's ItemVar menu) until the item sets them
        expect(DEFAULT_COLORS).toEqual(
            Object.fromEntries(
                Array.from({ length: 28 }, (_, i) => [
                    String(i + 3),
                    "240 240 240",
                ]),
            ),
        )
    })

    test("keep the group's other widgets, other groups, and how the colors were written", () => {
        const other = { ID: "OTHER", Name: "Other", Widget: colorWidget }
        const picked = {
            id: "Color",
            Label: "Fuse",
            Type: "color",
            UseTimer: "1",
            Default: { 3: "1 2 3" },
        }
        const speed = { ID: "speed", Label: "Speed", Type: "slider" }
        const info = {
            ConfigGroup: [
                other,
                {
                    id: "ITEM_BOMB",
                    Name: "Bomb Settings",
                    widget: [picked, speed],
                },
            ],
        }
        withColors(info, { itemId: "ITEM_BOMB", itemName: "Bomb", on: true })
        expect(info.ConfigGroup).toEqual([
            other,
            // With other widgets, the group keeps its name
            { id: "ITEM_BOMB", Name: "Bomb Settings", widget: [picked, speed] },
        ])

        // Taken out: the group stays for its other widget
        withColors(info, { itemId: "ITEM_BOMB", on: false })
        expect(info.ConfigGroup[1]).toEqual({
            id: "ITEM_BOMB",
            Name: "Bomb Settings",
            widget: speed,
        })
    })

    test("replace the color1, color2... widgets of earlier dev builds", () => {
        const info = {
            ConfigGroup: {
                ID: "ITEM_BOMB",
                Name: "Bomb",
                Widget: [
                    {
                        ID: "color1",
                        Label: "Color 1",
                        Type: "color",
                        Default: "25 25 230",
                    },
                    {
                        ID: "color2",
                        Label: "Color 2",
                        Type: "color",
                        Default: "230 25 25",
                    },
                ],
            },
        }
        expect(hasColors(info, "ITEM_BOMB")).toBe(false)
        withColors(info, { itemId: "ITEM_BOMB", itemName: "Bomb", on: true })
        expect(info.ConfigGroup).toEqual({
            ID: "ITEM_BOMB",
            Name: "Bomb - Color",
            Widget: colorWidget,
        })
    })

    test("taken out, take the group out when nothing else is in it", () => {
        const info = { ID: "TEST" }
        withColors(info, { itemId: "ITEM_BOMB", itemName: "Bomb", on: true })
        withColors(info, { itemId: "ITEM_BOMB", on: false })
        expect(info).toEqual({ ID: "TEST" })
        expect(
            withColors({ ID: "TEST" }, { itemId: "ITEM_BOMB", on: false }),
        ).toEqual({ ID: "TEST" })
    })

    test("have defaults the item sets, each timer value's (empty for the rest)", () => {
        const info = {}
        withColors(info, {
            itemId: "ITEM_BOMB",
            itemName: "Bomb",
            on: true,
            // BEE2 reads "#rrggbb" too; it saves "R G B"
            defaults: { 3: "255 0 0", 7: "#00ff80", 8: "not a color" },
        })
        expect(info.ConfigGroup.Widget.Default).toEqual({
            ...DEFAULT_COLORS,
            3: "255 0 0",
            7: "0 255 128",
        })
        expect(colorDefaults(info, "ITEM_BOMB")).toEqual(
            info.ConfigGroup.Widget.Default,
        )

        // Saving without defaults (a rename) keeps them
        withColors(info, { itemId: "ITEM_BOMB", itemName: "Bombs", on: true })
        expect(info.ConfigGroup.Name).toBe("Bombs - Color")
        expect(info.ConfigGroup.Widget.Default[3]).toBe("255 0 0")

        // One default for every timer value, or none: read as each one's
        const one = {
            ConfigGroup: {
                ID: "ITEM_BOMB",
                Widget: { ...colorWidget, default: "#0000ff" },
            },
        }
        delete one.ConfigGroup.Widget.Default
        expect(Object.values(colorDefaults(one, "ITEM_BOMB"))).toEqual(
            Array(28).fill("0 0 255"),
        )
        expect(colorDefaults({}, "ITEM_BOMB")).toEqual(DEFAULT_COLORS)
        // Written back under the key it had
        withColors(one, {
            itemId: "ITEM_BOMB",
            on: true,
            defaults: { 3: "1 2 3" },
        })
        expect(one.ConfigGroup.Widget.default[3]).toBe("1 2 3")
        expect(one.ConfigGroup.Widget.Default).toBeUndefined()
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
                        presetKey: "TimerDelay",
                        customValue: "3",
                        type: "number",
                    },
                    { presetKey: "Color", customValue: "1", type: "colors" },
                ]),
            ).toBe(true)

            const editorItems = JSON.parse(
                fs.readFileSync(path.join(itemDir, "editoritems.json"), "utf8"),
            )
            expect(Object.keys(editorItems.Item.Properties)).toEqual([
                "TimerDelay",
            ])
            expect(info().ConfigGroup).toEqual({
                ID: "ITEM_BOMB",
                Name: "Bomb - Color",
                Widget: colorWidget,
            })
            expect(
                item.getVariables().map((v) => [v.presetKey, v.type]),
            ).toEqual([
                ["TimerDelay", "number"],
                ["Color", "colors"],
            ])

            // BEE2 reads them from info.txt
            const vdf = keyvalues(parse(convertJsonToVdf(info())))
            expect(vdf.find(([key]) => key === "ConfigGroup")).toEqual([
                "ConfigGroup",
                [
                    ["ID", "ITEM_BOMB"],
                    ["Name", "Bomb - Color"],
                    [
                        "Widget",
                        [
                            ["ID", "color"],
                            ["Label", "Color"],
                            ["Type", "color"],
                            ["UseTimer", "1"],
                            ["Default", Object.entries(DEFAULT_COLORS)],
                        ],
                    ],
                ],
            ])

            // The default colors set in the Variables tab
            const defaults = { ...DEFAULT_COLORS, 3: "255 255 255" }
            expect(item.getVariables()[1].colors).toEqual(DEFAULT_COLORS)
            expect(
                item.saveVariables([
                    {
                        presetKey: "TimerDelay",
                        customValue: "3",
                        type: "number",
                    },
                    {
                        presetKey: "Color",
                        customValue: "1",
                        type: "colors",
                        colors: defaults,
                    },
                ]),
            ).toBe(true)
            expect(info().ConfigGroup.Widget.Default).toEqual(defaults)
            expect(item.getVariables()[1].colors).toEqual(defaults)

            // Taking the variable out takes them out
            expect(
                item.saveVariables([
                    {
                        presetKey: "TimerDelay",
                        customValue: "3",
                        type: "number",
                    },
                ]),
            ).toBe(true)
            expect(info().ConfigGroup).toBeUndefined()
            expect(item.getVariables().map((v) => v.presetKey)).toEqual([
                "TimerDelay",
            ])
        })

        test("go in a fixup with a Set Color block", async () => {
            const item = await loadItem()
            const blocks = [
                // The timer's color (under 3, like an infinite timer: 3's)
                {
                    id: "timer",
                    type: "setColor",
                    variable: "item_color",
                    color: "match",
                    matchVariable: "$timer_delay",
                },
                // Timer 7's color, in an If
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
                            color: "7",
                        },
                    ],
                },
                // An earlier dev build's Color 1: the nearest timer, 3
                {
                    id: "old",
                    type: "setColor",
                    variable: "$old_color",
                    color: "1",
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
                    ["Default", "240 240 240"],
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
                        [
                            "Result",
                            [
                                [
                                    "Condition",
                                    [
                                        ["instVar", "$timer_delay < 3"],
                                        [
                                            "Result",
                                            [
                                                getItemConfig(
                                                    "color[3]",
                                                    "$item_color",
                                                ),
                                            ],
                                        ],
                                        [
                                            "Else",
                                            [
                                                getItemConfig(
                                                    "color[$timer_delay]",
                                                    "$item_color",
                                                ),
                                            ],
                                        ],
                                    ],
                                ],
                            ],
                        ],
                    ],
                ],
                [
                    "Condition",
                    [
                        instance,
                        ["instVar", "$start_enabled == 1"],
                        ["Result", [getItemConfig("color[7]", "$on_color")]],
                    ],
                ],
                [
                    "Condition",
                    [
                        instance,
                        ["Result", [getItemConfig("color[3]", "$old_color")]],
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
                        Name: "Bomb - Color",
                        Widget: colorWidget,
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
                        color: "5",
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
