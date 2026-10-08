jest.mock("electron", () => ({
    app: { isPackaged: false, getPath: () => require("os").tmpdir() },
    dialog: {},
    ipcMain: { handle() {}, on() {} },
}))

const fs = require("fs")
const os = require("os")
const path = require("path")
const { runConditions } = require("../utils/vbspEvaluator")

const INSTANCES = {
    0: "instances/test/item.vmf",
    1: "instances/test/item_reversed.vmf",
    2: "instances/test/item_big.vmf",
    bee2_frame: "instances/test/frame.vmf",
}

/** The file the item's instance ends up as, and whether that's certain */
const run = (text, fixups = {}, file = INSTANCES[0]) =>
    runConditions({ text, itemId: "ITEM_TEST", instances: INSTANCES, file, fixups })

/** Conditions text from lines */
const conditions = (...lines) =>
    ['"Conditions"', "{", ...lines, "}"].join("\n")

describe("VBSP conditions run on an item's instance", () => {
    test("pick a Switch case by the fixup, or <default>", () => {
        const text = conditions(
            '"Condition" { "instance" "<ITEM_TEST>"',
            '  "Switch" { "method" "first" "test" "instvar"',
            '    "$cube_type 1" { "changeInstance" "<ITEM_TEST:1>" }',
            '    "$cube_type = 2" { "changeInstance" "<ITEM_TEST:2>" }',
            '    "<default>" { "changeInstance" "<ITEM_TEST:bee2_frame>" }',
            "  } }",
        )
        expect(run(text, { cube_type: 1 }).file).toBe(INSTANCES[1])
        expect(run(text, { $cube_type: "2" }).file).toBe(INSTANCES[2])
        expect(run(text, { cube_type: 4 })).toEqual({
            file: INSTANCES.bee2_frame,
            overlays: [],
            uncertain: false,
        })
    })

    test("compare fixups as numbers, and read one alone as true or false", () => {
        const text = conditions(
            '"Condition" { "instvar" "$timer_delay >= 10" "Result" { "suffix" "slow" } }',
            '"Condition" { "$start_reversed" "" "instvar" "$timer_delay != 0" "Result" { "suffix" "rev" } }',
        )
        expect(run(text, { timer_delay: 9, start_reversed: 1 }).file).toBe(
            "instances/test/item_rev.vmf",
        )
        expect(run(text, { timer_delay: 30, start_reversed: 0 }).file).toBe(
            "instances/test/item_slow.vmf",
        )
        expect(run(text, { timer_delay: 0, start_reversed: 1 }).file).toBe(
            INSTANCES[0],
        )
    })

    test("run Else, nested conditions and fixup results in order", () => {
        const text = conditions(
            '"Condition" { "instvar" "$start_open 1"',
            '  "Result" { "$variant" "open" }',
            '  "Else" { "setInstVar" "$variant closed" }',
            '  "Condition" { "instvar" "$variant open" "Result" { "changeInstance" "instances/test/open.vmf" } }',
            '  "ElseCondition" { "Result" { "changeInstance" "instances/test/$variant.vmf" } }',
            "}",
        )
        expect(run(text, { start_open: 1 }).file).toBe("instances/test/open.vmf")
        expect(run(text, { start_open: 0 }).file).toBe("instances/test/closed.vmf")
    })

    test("by priority, smaller first", () => {
        const text = conditions(
            '"Condition" { "Priority" "10" "instance" "<ITEM_TEST:1>" "Result" { "changeInstance" "<ITEM_TEST:2>" } }',
            '"Condition" { "Priority" "-5" "Result" { "changeInstance" "<ITEM_TEST:reversed,1>" } }',
        )
        expect(run(text).file).toBe(INSTANCES[2])
    })

    test("test the instance as it is when they run", () => {
        const text = conditions(
            '"Condition" { "instance" "<ITEM_TEST>" "Result" { "changeInstance" "instances/other/x.vmf" } }',
            // No longer one of the item's
            '"Condition" { "instance" "<ITEM_TEST>" "Result" { "changeInstance" "" } }',
            '"Condition" { "instance" "<OTHER_ITEM>" "Result" { "changeInstance" "" } }',
        )
        expect(run(text).file).toBe("instances/other/x.vmf")
    })

    test("map and invert fixups", () => {
        const text = conditions(
            '"Condition" { "Result" {',
            '  "setInstVar" "$blue !$start_reversed"',
            '  "MapInstVar" { "$cube_type" "$size" "0" "small" "1" "big" }',
            '} }',
            '"Condition" { "instvar" "$blue 1" "instvar" "$size big" "Result" { "changeInstance" "<ITEM_TEST:2>" } }',
        )
        expect(run(text, { start_reversed: 0, cube_type: 1 }).file).toBe(
            INSTANCES[2],
        )
        expect(run(text, { start_reversed: 1, cube_type: 1 }).file).toBe(
            INSTANCES[0],
        )
    })

    test("follow tests BeePEE can't tell both ways", () => {
        // Each way adds the same instance: certain
        const same = conditions(
            '"Condition" { "Result" { "changeInstance" "" } }',
            '"Condition" { "styleVar" "BigItems"',
            '  "Result" { "addOverlay" { "file" "instances/test/main.vmf" } }',
            '  "Else" { "addOverlay" "instances/test/main.vmf" } }',
        )
        expect(run(same)).toEqual({
            file: null,
            overlays: ["instances/test/main.vmf"],
            uncertain: false,
        })

        // Different ways: the most common, uncertain
        const different = conditions(
            '"Condition" { "styleVar" "Old" "Result" { "changeInstance" "<ITEM_TEST:1>" } }',
            '"Condition" { "has" "glados" "Result" { "changeInstance" "<ITEM_TEST:2>" } }',
        )
        const result = run(different)
        expect(result.uncertain).toBe(true)
        expect([INSTANCES[0], INSTANCES[1], INSTANCES[2]]).toContain(result.file)
    })

    test("follow random results each way", () => {
        const text = conditions(
            '"Condition" { "Result" { "random" {',
            '  "changeInstance" "<ITEM_TEST:1>"',
            '  "changeInstance" "<ITEM_TEST:1>"',
            '  "changeInstance" "<ITEM_TEST:2>"',
            "} } }",
        )
        expect(run(text)).toEqual({
            file: INSTANCES[1],
            overlays: [],
            uncertain: true,
        })
    })
})

describe("model making's SubTypes", () => {
    test("are in the order of the values, each with its value's model", () => {
        const { buildSubTypes } = require("../handlers/conversionHandlers")
        const plan = {
            property: "CubeType",
            defaultValue: "0",
            values: ["0", "1", "2", "3", "4"].map((value) => ({ value })),
        }
        // No instance for 0 and 3; 4's model failed
        const finalInstanceMap = new Map([
            ["1", "a.vmf"],
            ["2", "b.vmf"],
            ["4", "c.vmf"],
        ])
        const results = [
            { instancePath: "a.vmf", modelPath: "a.mdl" },
            { instancePath: "b.vmf", modelPath: "b.mdl" },
            { instancePath: "c.vmf", error: "failed" },
        ]
        const subTypes = buildSubTypes(
            { Name: "Item", Model: { ModelName: "old.mdl" }, Palette: {} },
            plan,
            finalInstanceMap,
            results,
        )
        expect(subTypes.map((s) => s.Model.ModelName)).toEqual([
            "a.mdl",
            "a.mdl",
            "b.mdl",
            "a.mdl",
            "a.mdl",
        ])
        // The first keeps the rest of the SubType
        expect(subTypes[0].Palette).toEqual({})
        expect(subTypes[1].Palette).toBeUndefined()
    })
})

describe("the instance of each value of a variable", () => {
    let dir

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-values-"))
    })

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true })
    })

    test("comes from the item's conditions, with its other fixups at their defaults", async () => {
        const itemDir = path.join(dir, "items", "funnel")
        fs.mkdirSync(itemDir, { recursive: true })
        fs.writeFileSync(
            path.join(itemDir, "editoritems.json"),
            JSON.stringify({
                Item: {
                    Type: "ITEM_FUNNEL",
                    Editor: { SubType: { Name: "Funnel" } },
                    Properties: {
                        CubeType: { DefaultValue: 0, Index: 2 },
                        StartEnabled: { DefaultValue: 1, Index: 3 },
                    },
                    Exporting: { Instances: { 0: { Name: "instances/dummy.vmf" } } },
                },
            }),
        )
        fs.writeFileSync(
            path.join(itemDir, "properties.json"),
            JSON.stringify({ Properties: { Authors: "Tester" } }),
        )
        // The dummy instance goes; the angle's instance goes on top
        fs.writeFileSync(
            path.join(itemDir, "vbsp_config.cfg"),
            [
                '"Conditions"',
                "{",
                '"Condition" { "instance" "<ITEM_FUNNEL>" "Result" {',
                '  "changeInstance" ""',
                '  "Switch" { "test" "instvar"',
                '    "$cube_type 1" { "$angle" "30" }',
                '    "$cube_type 2" { "$angle" "45" }',
                '    "<default>" { "$angle" "flat" }',
                "  }",
                '  "Condition" { "instvar" "$start_enabled" "Result" {',
                '    "addOverlay" { "file" "instances/funnel_$angle.vmf" } } }',
                "} }",
                "}",
            ].join("\n"),
        )
        fs.writeFileSync(
            path.join(dir, "info.json"),
            JSON.stringify({
                ID: "TEST",
                Name: "Test",
                Item: { ID: "ITEM_FUNNEL", Version: { Styles: { BEE2_CLEAN: "funnel" } } },
            }),
        )
        const { Package } = require("../models/package")
        const pkg = new Package(path.join(dir, "info.json"))
        pkg.packageDir = dir
        await pkg.load()

        const { variableValueInstances } = require("../utils/mdlConverter")
        const plan = variableValueInstances(pkg.items[0], "Cube Type")
        expect(plan.property).toBe("CubeType")
        expect(plan.defaultValue).toBe("0")
        expect(plan.values).toEqual([
            { value: "0", file: "instances/funnel_flat.vmf", overlay: true, uncertain: false },
            { value: "1", file: "instances/funnel_30.vmf", overlay: true, uncertain: false },
            { value: "2", file: "instances/funnel_45.vmf", overlay: true, uncertain: false },
            { value: "3", file: "instances/funnel_flat.vmf", overlay: true, uncertain: false },
            { value: "4", file: "instances/funnel_flat.vmf", overlay: true, uncertain: false },
        ])

        // Start Enabled off: no overlay, so no instance
        const enabled = variableValueInstances(pkg.items[0], "Start Enabled")
        expect(enabled.values.map((v) => v.file)).toEqual([
            null,
            "instances/funnel_flat.vmf",
        ])
    })
})
