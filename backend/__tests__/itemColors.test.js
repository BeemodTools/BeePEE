jest.mock("electron", () => ({
    app: { isPackaged: false, getPath: () => require("os").tmpdir() },
    dialog: {},
    ipcMain: { handle() {}, on() {} },
}))

const fs = require("fs")
const os = require("os")
const path = require("path")
const { parse } = require("../utils/keyvalues")
const { Package } = require("../models/package")
const { colorGroupId } = require("../utils/itemColors")

/** Entries as [key, value or children] */
const keyvalues = (entries) =>
    entries.map(({ key, value, children }) => [
        key,
        children ? keyvalues(children) : value,
    ])

/** 1.2.0's timer color widget, as its Color variable wrote it */
const colorWidget = {
    ID: "color",
    Label: "Color",
    Type: "color",
    UseTimer: "1",
    Default: Object.fromEntries(
        Array.from({ length: 28 }, (_, i) => [String(i + 3), "240 240 240"]),
    ),
}

describe("1.2.0's item colors", () => {
    let dir
    let itemDir

    /** The package, with the BOMB item and the group its Color variable made */
    const loadItem = async (groupId = "ITEM_BOMB") => {
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
                ConfigGroup: {
                    ID: groupId,
                    Name: "Bomb - Color",
                    Widget: colorWidget,
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

    test("stay a config group of the package: saving the item's variables keeps it", async () => {
        const item = await loadItem()
        expect(
            item.saveVariables([
                { presetKey: "TimerDelay", customValue: "3", type: "number" },
            ]),
        ).toBe(true)
        expect(info().ConfigGroup).toEqual({
            ID: "ITEM_BOMB",
            Name: "Bomb - Color",
            Widget: colorWidget,
        })
        // Not a variable anymore
        expect(item.getVariables().map((v) => v.presetKey)).toEqual([
            "TimerDelay",
        ])
    })

    test("Set Color blocks open as Get Config blocks that write the same conditions", async () => {
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

        // What 1.2.0 wrote for them
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

        // The editor gets them as Get Config blocks of the color group
        const getConfig = (block, timer) => {
            const { color, ...rest } = block
            return {
                ...rest,
                type: "getConfig",
                displayName: "Get Config",
                group: "ITEM_BOMB",
                widget: "color",
                timer,
                default: "240 240 240",
            }
        }
        const opened = item.getConditions().blocks
        expect(opened).toEqual([
            getConfig(blocks[0], "match"),
            {
                ...blocks[1],
                thenBlocks: [getConfig(blocks[1].thenBlocks[0], "7")],
            },
            getConfig(blocks[2], "3"),
            getConfig(blocks[3], "match"),
        ])

        // Saved as they are, they write the same
        const text = fs.readFileSync(
            path.join(itemDir, "vbsp_config.cfg"),
            "utf8",
        )
        item.saveConditions({ blocks: opened })
        expect(
            fs.readFileSync(path.join(itemDir, "vbsp_config.cfg"), "utf8"),
        ).toBe(text)
    })

    test("are fetched from their group's ID as it's written (BEE2 matches it exactly)", async () => {
        const item = await loadItem("Item_Bomb")
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
