// A package's config groups (Package Config) and the Get Config block

let mockPackageDir = null
jest.mock("electron", () => ({
    app: { isPackaged: false, getPath: () => require("os").tmpdir() },
    dialog: {},
    ipcMain: { handle() {}, on() {} },
    BrowserWindow: { getAllWindows: () => [] },
}))
// The package open in BeePEE
jest.mock("../packageManager", () => ({
    ...jest.requireActual("../packageManager"),
    getCurrentPackageDir: () => mockPackageDir,
}))

const fs = require("fs")
const os = require("os")
const path = require("path")
const { parse } = require("../utils/keyvalues")
const { convertJsonToVdf } = require("../packageManager")
const { Package } = require("../models/package")
const {
    configGroupErrors,
    readConfigGroups,
    withConfigGroups,
} = require("../utils/configGroups")

/** Entries as [key, value or children] */
const keyvalues = (entries) =>
    entries.map(({ key, value, children }) => [
        key,
        children ? keyvalues(children) : value,
    ])

const timerValues = Array.from({ length: 28 }, (_, i) => String(i + 3))
const each = (value) => Object.fromEntries(timerValues.map((t) => [t, value]))

/** A package's groups, as BEE2 packages write them */
const INFO = {
    ID: "TEST",
    Name: "Test",
    ConfigGroup: [
        {
            ID: "SPEEDS",
            Name: "Speeds",
            Description: {
                desc_0: "How fast",
                desc_1: "",
                desc_2: "things go",
            },
            Widget: [
                {
                    ID: "speed",
                    Label: "Speed",
                    Type: "Range",
                    Min: "1",
                    Max: "10",
                    Step: "0.5",
                    Default: "5",
                },
                {
                    ID: "mode",
                    Label: "Mode",
                    Type: "Dropdown",
                    Options: { slow: "Slow", fast: "Fast" },
                    Default: "fast",
                },
                {
                    ID: "lit",
                    Type: "bool",
                    UseTimer: "1",
                    Default: "1",
                    legacy_stylevar_id: "LitStyleVar",
                },
                { ID: "variant", Type: "ItemVariant", ItemID: "ITEM_X" },
            ],
            PrefixKey: "kept",
        },
        {
            ID: "TIMES",
            Name: "Times",
            Widget: {
                ID: "wait",
                Type: "MinuteSeconds",
                UseTimer: "1",
                HasInf: "1",
                Min: "0",
                Max: "120",
                Default: { inf: "60", ...each("30") },
            },
        },
    ],
}

describe("config groups", () => {
    test("are read as the Package Config window edits them", () => {
        const groups = readConfigGroups(JSON.parse(JSON.stringify(INFO)))
        expect(groups.map((g) => [g.id, g.name, g.description])).toEqual([
            ["SPEEDS", "Speeds", "How fast\n\nthings go"],
            ["TIMES", "Times", ""],
        ])
        expect(groups[0].extra).toEqual({ PrefixKey: "kept" })
        const [speed, mode, lit, variant] = groups[0].widgets
        expect(speed).toMatchObject({
            id: "speed",
            type: "slider",
            typeName: "Range",
            timer: false,
            default: "5",
            min: "1",
            max: "10",
            step: "0.5",
            zeroOff: false,
        })
        expect(mode).toMatchObject({
            type: "dropdown",
            options: [
                { id: "slow", label: "Slow" },
                { id: "fast", label: "Fast" },
            ],
            default: "fast",
        })
        // One default for every timer value is each one's
        expect(lit).toMatchObject({
            type: "checkbox",
            label: "",
            timer: true,
            inf: false,
            defaults: each("1"),
            extra: { legacy_stylevar_id: "LitStyleVar" },
        })
        // Not one BeePEE edits: kept as it is
        expect(variant.type).toBeNull()
        expect(groups[1].widgets[0]).toMatchObject({
            type: "timer",
            timer: true,
            inf: true,
            defaults: { inf: "60", ...each("30") },
            min: "0",
            max: "120",
        })
    })

    test("are written back as they were when they aren't changed", () => {
        const info = JSON.parse(JSON.stringify(INFO))
        const groups = JSON.parse(JSON.stringify(readConfigGroups(info)))
        expect(
            withConfigGroups(JSON.parse(JSON.stringify(INFO)), groups),
        ).toEqual(INFO)
    })

    test("changed, are written as BEE2 reads them", () => {
        const groups = JSON.parse(
            JSON.stringify(readConfigGroups(JSON.parse(JSON.stringify(INFO)))),
        )
        // A new group: a color for each timer value, two of them set
        groups.push({
            id: "LIGHTS",
            name: "",
            description: "",
            extra: {},
            widgets: [
                {
                    id: "color",
                    label: "Color",
                    type: "color",
                    typeName: "",
                    tooltip: "The lights'\ncolor",
                    timer: true,
                    inf: false,
                    default: "255 255 255",
                    defaults: { ...each("255 255 255"), 4: "255 0 0" },
                    extra: {},
                },
                {
                    id: "name",
                    label: "",
                    type: "string",
                    typeName: "",
                    tooltip: "",
                    timer: false,
                    inf: false,
                    default: "Lamp",
                    extra: {},
                },
            ],
        })
        // The first group changed: its speed widget's default
        groups[0].widgets[0].default = "7"
        const info = withConfigGroups(JSON.parse(JSON.stringify(INFO)), groups)

        // The group not changed stays as it was
        expect(info.ConfigGroup[1]).toEqual(INFO.ConfigGroup[1])
        // The changed one is written anew, with what BeePEE doesn't edit
        expect(info.ConfigGroup[0]).toEqual({
            ...INFO.ConfigGroup[0],
            Widget: [
                {
                    ID: "speed",
                    Type: "Range",
                    Label: "Speed",
                    Min: "1",
                    Max: "10",
                    Step: "0.5",
                    Default: "7",
                },
                {
                    ID: "mode",
                    Type: "Dropdown",
                    Label: "Mode",
                    Options: { slow: "Slow", fast: "Fast" },
                    Default: "fast",
                },
                {
                    ID: "lit",
                    Type: "bool",
                    UseTimer: "1",
                    // The same for each timer value: one
                    Default: "1",
                    legacy_stylevar_id: "LitStyleVar",
                },
                INFO.ConfigGroup[0].Widget[3],
            ],
        })
        // The new one: its name is its ID, each timer value's colors
        expect(info.ConfigGroup[2]).toEqual({
            ID: "LIGHTS",
            Name: "LIGHTS",
            Widget: [
                {
                    ID: "color",
                    Type: "color",
                    Label: "Color",
                    Tooltip: { desc_0: "The lights'", desc_1: "color" },
                    UseTimer: "1",
                    Default: { ...each("255 255 255"), 4: "255 0 0" },
                },
                { ID: "name", Type: "string", Default: "Lamp" },
            ],
        })

        // BEE2 reads them from info.txt
        const vdf = keyvalues(parse(convertJsonToVdf(info)))
        const lights = vdf.filter(([key]) => key === "ConfigGroup")[2]
        expect(lights).toEqual([
            "ConfigGroup",
            [
                ["ID", "LIGHTS"],
                ["Name", "LIGHTS"],
                [
                    "Widget",
                    [
                        ["ID", "color"],
                        ["Type", "color"],
                        ["Label", "Color"],
                        [
                            "Tooltip",
                            [
                                ["", "The lights'"],
                                ["", "color"],
                            ],
                        ],
                        ["UseTimer", "1"],
                        [
                            "Default",
                            timerValues.map((t) => [
                                t,
                                t === "4" ? "255 0 0" : "255 255 255",
                            ]),
                        ],
                    ],
                ],
                [
                    "Widget",
                    [
                        ["ID", "name"],
                        ["Type", "string"],
                        ["Default", "Lamp"],
                    ],
                ],
            ],
        ])
    })

    test("all removed, take ConfigGroup out; one is written on its own", () => {
        const groups = readConfigGroups(JSON.parse(JSON.stringify(INFO)))
        expect(
            withConfigGroups(JSON.parse(JSON.stringify(INFO)), []).ConfigGroup,
        ).toBeUndefined()
        expect(
            withConfigGroups(JSON.parse(JSON.stringify(INFO)), [groups[1]])
                .ConfigGroup,
        ).toEqual(INFO.ConfigGroup[1])
    })

    test("that BEE2 can't load are errors", () => {
        const widget = (id) => ({ id, type: "string" })
        expect(
            configGroupErrors([
                { id: "A", widgets: [widget("x"), widget("X")] },
                { id: "a", widgets: [] },
                { id: "", widgets: [] },
                { id: "B", widgets: [widget(" ")] },
            ]),
        ).toEqual([
            "Config group A has two widgets with the ID X",
            "Two config groups have the ID a",
            "A config group has no ID",
            "A widget of config group B has no ID",
        ])
        expect(configGroupErrors(readConfigGroups(INFO))).toEqual([])
    })

    describe("saved from the Package Config window", () => {
        let dir
        let handlers

        beforeEach(() => {
            dir = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-config-"))
            fs.writeFileSync(path.join(dir, "info.json"), JSON.stringify(INFO))
            mockPackageDir = dir
            handlers = {}
            require("../handlers/configHandlers").register({
                handle: (name, handler) => (handlers[name] = handler),
            })
        })

        afterEach(() => {
            fs.rmSync(dir, { recursive: true, force: true })
        })

        test("go to the package the window was opened for", async () => {
            const read = await handlers["get-config-groups"]({}, {})
            expect(read).toMatchObject({ success: true, packageDir: dir })
            const groups = read.groups.slice(1)

            const saved = await handlers["save-config-groups"](
                {},
                { packageDir: dir, groups },
            )
            expect(saved.success).toBe(true)
            const info = JSON.parse(
                fs.readFileSync(path.join(dir, "info.json"), "utf8"),
            )
            expect(info.ConfigGroup).toEqual(INFO.ConfigGroup[1])
            expect(info.Name).toBe("Test")

            // Not another package opened since
            mockPackageDir = path.join(os.tmpdir(), "other-package")
            const refused = await handlers["save-config-groups"](
                {},
                { packageDir: dir, groups: [] },
            )
            expect(refused.success).toBe(false)
            expect(refused.error).toMatch(/Another package was opened/)
            expect(
                JSON.parse(fs.readFileSync(path.join(dir, "info.json"), "utf8"))
                    .ConfigGroup,
            ).toEqual(INFO.ConfigGroup[1])
        })

        test("aren't saved when BEE2 couldn't load them", async () => {
            const saved = await handlers["save-config-groups"](
                {},
                {
                    packageDir: dir,
                    groups: [
                        { id: "A", widgets: [] },
                        { id: "A", widgets: [] },
                    ],
                },
            )
            expect(saved).toEqual({
                success: false,
                error: "Two config groups have the ID A",
            })
            expect(
                JSON.parse(
                    fs.readFileSync(path.join(dir, "info.json"), "utf8"),
                ),
            ).toEqual(INFO)
        })
    })
})

describe("Get Config blocks", () => {
    let dir
    let itemDir

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-getconfig-"))
        itemDir = path.join(dir, "items", "lamp")
    })

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true })
    })

    /** The lamp item, with this VBSP config when it's given */
    async function loadItem(vbspConfig) {
        fs.mkdirSync(itemDir, { recursive: true })
        fs.writeFileSync(
            path.join(itemDir, "editoritems.json"),
            JSON.stringify({
                Item: {
                    Type: "ITEM_LAMP",
                    Editor: { SubType: { Name: "Lamp" } },
                    Exporting: {
                        Instances: { 0: { Name: "instances/l.vmf" } },
                    },
                },
            }),
        )
        fs.writeFileSync(
            path.join(itemDir, "properties.json"),
            JSON.stringify({ Properties: {} }),
        )
        fs.writeFileSync(
            path.join(dir, "info.json"),
            JSON.stringify({
                ...INFO,
                Item: {
                    ID: "ITEM_LAMP",
                    Version: { Styles: { BEE2_CLEAN: "lamp" } },
                },
            }),
        )
        if (vbspConfig) {
            fs.writeFileSync(path.join(itemDir, "vbsp_config.cfg"), vbspConfig)
        }
        const pkg = new Package(path.join(dir, "info.json"))
        pkg.packageDir = dir
        await pkg.load()
        return pkg.items[0]
    }

    /** The conditions the item's blocks write, as [key, value or children] */
    async function written(blocks) {
        const item = await loadItem()
        item.saveConditions({ blocks })
        const conditions = parse(
            fs.readFileSync(path.join(itemDir, "vbsp_config.cfg"), "utf8"),
        ).find((entry) => entry.key === "Conditions").children
        // Each block's result (the instance test left out)
        return keyvalues(conditions).map(([, children]) =>
            children.filter(([key]) => key !== "Instance"),
        )
    }

    const getItemConfig = (id, name, into, def) => [
        "GetItemConfig",
        [
            ["ID", id],
            ["Name", name],
            ["ResultVar", into],
            ["Default", def],
        ],
    ]
    const block = (props) => ({
        id: `b${Math.random()}`,
        type: "getConfig",
        variable: "speed",
        group: "SPEEDS",
        widget: "speed",
        timer: "",
        default: "5",
        ...props,
    })

    test("put a widget's value into a fixup with GetItemConfig", async () => {
        expect(
            await written([
                // A single widget
                block({}),
                // A timer widget's value for timer 7, and for an infinite timer
                block({ widget: "lit", timer: "7", default: "0" }),
                block({ group: "TIMES", widget: "wait", timer: "inf" }),
                // Out of range: the nearest timer value
                block({ widget: "lit", timer: "99", default: "0" }),
            ]),
        ).toEqual([
            [["Result", [getItemConfig("SPEEDS", "speed", "$speed", "5")]]],
            [["Result", [getItemConfig("SPEEDS", "lit[7]", "$speed", "0")]]],
            [["Result", [getItemConfig("TIMES", "wait[0]", "$speed", "5")]]],
            [["Result", [getItemConfig("SPEEDS", "lit[30]", "$speed", "0")]]],
        ])
    })

    test("for a fixup's timer value, give an infinite timer 3's value unless they take the infinite one", async () => {
        expect(
            await written([
                block({
                    widget: "lit",
                    timer: "match",
                    matchVariable: "$timer_delay",
                    default: "0",
                }),
                block({
                    group: "TIMES",
                    widget: "wait",
                    timer: "match",
                    matchVariable: "timer_delay",
                    infinite: "inf",
                }),
            ]),
        ).toEqual([
            [
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
                                            "SPEEDS",
                                            "lit[3]",
                                            "$speed",
                                            "0",
                                        ),
                                    ],
                                ],
                                [
                                    "Else",
                                    [
                                        getItemConfig(
                                            "SPEEDS",
                                            "lit[$timer_delay]",
                                            "$speed",
                                            "0",
                                        ),
                                    ],
                                ],
                            ],
                        ],
                    ],
                ],
            ],
            [
                [
                    "Result",
                    [
                        getItemConfig(
                            "TIMES",
                            "wait[$timer_delay]",
                            "$speed",
                            "5",
                        ),
                    ],
                ],
            ],
        ])
    })

    test("unfinished, write nothing", async () => {
        expect(
            await written([
                block({ variable: "" }),
                block({ group: "" }),
                block({ widget: "" }),
                block({ widget: "lit", timer: "match", matchVariable: "" }),
            ]),
        ).toEqual([[], [], [], []])
    })

    test("are what an item's GetItemConfig conditions open as, when they write the same", async () => {
        const condition = (results, extra = "") =>
            `\t"Condition"\n\t{\n${extra}\t\t"Instance" "<ITEM_LAMP>"\n\t\t"Result"\n\t\t{\n${results}\t\t}\n\t}\n`
        const config = (name, into, def, more = "") =>
            `\t\t\t"GetItemConfig"\n\t\t\t{\n\t\t\t\t"ID" "SPEEDS"\n\t\t\t\t"Name" "${name}"\n\t\t\t\t"ResultVar" "${into}"\n\t\t\t\t"Default" "${def}"\n${more}\t\t\t}\n`
        const vbspConfig = [
            '"Conditions"\n{\n',
            // A widget, a slot, the infinite slot, a fixup's slot
            condition(config("speed", "$speed", "5")),
            condition(config("lit[7]", "$lit", "0")),
            condition(config("wait[0]", "$wait", "60")),
            condition(config("wait[$timer_delay]", "$wait", "60")),
            // A fixup's slot, under 3 slot 3's
            condition(
                `\t\t\t"Condition"\n\t\t\t{\n\t\t\t\t"instVar" "$timer_delay < 3"\n\t\t\t\t"Result"\n\t\t\t\t{\n${config("lit[3]", "$lit", "0")}\t\t\t\t}\n\t\t\t\t"Else"\n\t\t\t\t{\n${config("lit[$timer_delay]", "$lit", "0")}\t\t\t\t}\n\t\t\t}\n`,
            ),
            // Not what a Get Config block writes: they stay as they are
            condition(config("speed", "$speed", "5"), '\t\t"Priority" "10"\n'),
            condition(
                config("speed", "$speed", "5", '\t\t\t\t"UseTimer" "1"\n'),
            ),
            condition(
                `\t\t\t"GetItemConfig"\n\t\t\t{\n\t\t\t\t"ID" "SPEEDS"\n\t\t\t\t"Name" "speed"\n\t\t\t\t"Default" "5"\n\t\t\t\t"ResultVar" "$speed"\n\t\t\t}\n`,
            ),
            "}\n",
        ].join("")
        const item = await loadItem(vbspConfig)

        const { blocks } = item.getConditions()
        expect(blocks.map((b) => b.type)).toEqual([
            ...Array(5).fill("getConfig"),
            ...Array(3).fill("rawVbsp"),
        ])
        const props = ({
            group,
            widget,
            variable,
            timer,
            default: def,
            matchVariable,
            infinite,
        }) => ({
            group,
            widget,
            variable,
            timer,
            default: def,
            ...(matchVariable ? { matchVariable, infinite } : {}),
        })
        expect(blocks.slice(0, 5).map(props)).toEqual([
            {
                group: "SPEEDS",
                widget: "speed",
                variable: "$speed",
                timer: "",
                default: "5",
            },
            {
                group: "SPEEDS",
                widget: "lit",
                variable: "$lit",
                timer: "7",
                default: "0",
            },
            {
                group: "SPEEDS",
                widget: "wait",
                variable: "$wait",
                timer: "inf",
                default: "60",
            },
            {
                group: "SPEEDS",
                widget: "wait",
                variable: "$wait",
                timer: "match",
                default: "60",
                matchVariable: "$timer_delay",
                infinite: "inf",
            },
            {
                group: "SPEEDS",
                widget: "lit",
                variable: "$lit",
                timer: "match",
                default: "0",
                matchVariable: "$timer_delay",
                infinite: "3",
            },
        ])

        // Saved as they open: the same conditions, and they open the same
        item.saveConditions({ blocks })
        const text = fs.readFileSync(
            path.join(itemDir, "vbsp_config.cfg"),
            "utf8",
        )
        expect(
            keyvalues(parse(text).find((e) => e.key === "Conditions").children),
        ).toEqual(
            keyvalues(
                parse(vbspConfig).find((e) => e.key === "Conditions").children,
            ),
        )
        expect(item.getConditions().blocks).toEqual(blocks)
    })
})
