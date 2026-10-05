jest.mock("electron", () => ({
    app: { isPackaged: false, getPath: () => require("os").tmpdir() },
    dialog: {},
    ipcMain: { handle() {}, on() {} },
}))

const fs = require("fs")
const os = require("os")
const path = require("path")
const { parse, sameEntries, GENERATED_HEADER } = require("../utils/keyvalues")
const { rawBlocks } = require("../utils/vbspConditions")
const { processVdfFiles } = require("../packageManager")
const { Package } = require("../models/package")

// A BEE2 item's vbsp_config: a section besides Conditions, comments, a
// MapInstVar (its value mappings come after the in/out pair: a JS object
// would put them first), and repeated keys with other keys between them
const CONFIG = [
    '"DropperItems"',
    "\t{",
    '\t"Cube"',
    "\t\t{",
    '\t\t"ID" "BOMB_CUBE"',
    "\t\t}",
    "\t}",
    "",
    '"Conditions"',
    "\t{",
    "\t// Bomb time from the cube type",
    '\t"Condition"',
    "\t\t{",
    '\t\t"instance" "<ITEM_BOMB>"',
    '\t\t"Result"',
    "\t\t\t{",
    '\t\t\t"MapInstVar"',
    "\t\t\t\t{",
    '\t\t\t\t"$cube_type" "$bomb_time"',
    '\t\t\t\t"0" "3"',
    '\t\t\t\t"1" "5"',
    "\t\t\t\t}",
    '\t\t\t"setInstVar" "$a 1"',
    '\t\t\t"AddOverlay" "instances/a.vmf"',
    '\t\t\t"setInstVar" "$a 2"',
    "\t\t\t}",
    "\t\t}",
    '\t"Condition"',
    "\t\t{",
    '\t\t"instvar" "$x 1"',
    '\t\t"instvar" "$y 1"',
    '\t\t"Switch"',
    "\t\t\t{",
    '\t\t\t"flag" "instvar"',
    '\t\t\t"$cube_type 0" { "Changeinstance" "instances/cube0.vmf" }',
    '\t\t\t"$cube_type 1" { "Changeinstance" "instances/cube1.vmf" }',
    "\t\t\t}",
    "\t\t} // the end",
    "\t}",
    "",
].join("\r\n")

/** The text's top-level entries other than "Conditions" */
const otherSections = (text) =>
    parse(text).filter((entry) => entry.key !== "Conditions")

/** The conditions in the text's "Conditions" block */
const conditionsIn = (text) =>
    parse(text).find((entry) => entry.key === "Conditions")?.children ?? []

describe("VBSP conditions", () => {
    let dir
    let itemDir
    let cfg

    /** The package, with the BOMB item (its vbsp_config.cfg is `config`) */
    const loadItem = async (config = CONFIG) => {
        fs.mkdirSync(itemDir, { recursive: true })
        fs.writeFileSync(
            path.join(itemDir, "editoritems.json"),
            JSON.stringify({
                Item: {
                    Type: "ITEM_BOMB",
                    Editor: { SubType: { Name: "Bomb" } },
                    Exporting: { Instances: { 0: { Name: "instances/b.vmf" } } },
                },
            }),
        )
        fs.writeFileSync(
            path.join(itemDir, "properties.json"),
            JSON.stringify({ Properties: { Authors: "Tester" } }),
        )
        if (config !== null) fs.writeFileSync(cfg, config)
        fs.writeFileSync(
            path.join(dir, "info.json"),
            JSON.stringify({
                ID: "TEST",
                Name: "Test",
                Item: { ID: "ITEM_BOMB", Version: { Styles: { BEE2_CLEAN: "bomb" } } },
            }),
        )
        const pkg = new Package(path.join(dir, "info.json"))
        pkg.packageDir = dir
        await pkg.load()
        return pkg.items[0]
    }

    const NEW_BLOCK = {
        id: "new",
        type: "changeInstance",
        instanceName: "instances/new.vmf",
    }

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-vbsp-"))
        itemDir = path.join(dir, "items", "bomb")
        cfg = path.join(itemDir, "vbsp_config.cfg")
    })

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true })
    })

    test("are read in order, keeping repeated keys and numbers where they are", () => {
        const [, conditions] = parse(CONFIG)
        const [first] = conditions.children
        const result = first.children.find((entry) => entry.key === "Result")
        expect(result.children.map((entry) => entry.key)).toEqual([
            "MapInstVar",
            "setInstVar",
            "AddOverlay",
            "setInstVar",
        ])
        expect(result.children[0].children.map((entry) => entry.key)).toEqual([
            "$cube_type",
            "0",
            "1",
        ])
    })

    test("stay as they are when a package is imported", () => {
        fs.mkdirSync(itemDir, { recursive: true })
        fs.writeFileSync(cfg, CONFIG)
        processVdfFiles(dir)
        expect(fs.readFileSync(cfg, "utf8")).toBe(CONFIG)
        expect(fs.existsSync(path.join(itemDir, "vbsp_config.json"))).toBe(false)
    })

    test("are raw blocks: each one its condition's text, with the comment above it", () => {
        const blocks = rawBlocks(CONFIG)
        expect(blocks.map((block) => block.type)).toEqual(["rawVbsp", "rawVbsp"])
        expect(blocks[0].vdf).toMatch(/^\r\n\t\/\/ Bomb time from the cube type\r\n\t"Condition"/)
        expect(blocks[1].vdf).toMatch(/\t\t} \/\/ the end$/)
        expect(
            sameEntries(
                blocks.flatMap((block) => parse(block.vdf)),
                conditionsIn(CONFIG),
            ),
        ).toBe(true)
    })

    test("are written back as they were, with BeePEE's header", async () => {
        const item = await loadItem()
        const { blocks, error } = item.getConditions()
        expect(error).toBeUndefined()
        expect(blocks).toHaveLength(2)

        item.saveConditions({ blocks })
        expect(fs.readFileSync(cfg, "utf8")).toBe(`${GENERATED_HEADER}\r\n${CONFIG}`)

        // Saved again: one header
        item.saveConditions({ blocks: item.getConditions().blocks })
        expect(fs.readFileSync(cfg, "utf8")).toBe(`${GENERATED_HEADER}\r\n${CONFIG}`)
    })

    test("change only in Conditions when blocks are moved, taken out or added", async () => {
        const item = await loadItem()
        const [first, second] = item.getConditions().blocks

        item.saveConditions({ blocks: [second, NEW_BLOCK] })
        const text = fs.readFileSync(cfg, "utf8")
        expect(sameEntries(otherSections(text), otherSections(CONFIG))).toBe(true)
        expect(text.slice(text.indexOf('"DropperItems"'), text.indexOf('"Conditions"')))
            .toBe(CONFIG.slice(0, CONFIG.indexOf('"Conditions"')))
        const conditions = conditionsIn(text)
        expect(sameEntries([conditions[0]], parse(second.vdf))).toBe(true)
        expect(keyvalues(conditions[1].children)).toEqual([
            ["Instance", "<ITEM_BOMB>"],
            ["Result", [["changeInstance", "instances/new.vmf"]]],
        ])

        // ... and BeePEE's blocks come back, for the editor
        expect(item.getConditions().blocks).toEqual([second, NEW_BLOCK])

        // Moved: their text goes with them
        item.saveConditions({ blocks: [NEW_BLOCK, second, first] })
        const moved = fs.readFileSync(cfg, "utf8")
        expect(conditionsIn(moved)).toHaveLength(3)
        expect(moved).toContain(second.vdf + first.vdf)
    })

    test("come from the file when it changed since the editor saved its blocks", async () => {
        const item = await loadItem()
        item.saveConditions({ blocks: [NEW_BLOCK] })
        expect(item.getConditions().blocks).toEqual([NEW_BLOCK])

        // Edited outside BeePEE
        const edited = fs
            .readFileSync(cfg, "utf8")
            .replace("instances/new.vmf", "instances/other.vmf")
        fs.writeFileSync(cfg, edited)
        const [block] = item.getConditions().blocks
        expect(block.type).toBe("rawVbsp")
        expect(block.vdf).toContain("instances/other.vmf")
    })

    test("removed, leave the file's other sections (or no file)", async () => {
        const item = await loadItem()
        item.saveConditions({ blocks: [] })
        const text = fs.readFileSync(cfg, "utf8")
        expect(conditionsIn(text)).toEqual([])
        expect(sameEntries(otherSections(text), otherSections(CONFIG))).toBe(true)
        expect(item.getConditions().blocks).toEqual([])

        fs.writeFileSync(cfg, '"Conditions"\n{\n\t"Condition" { "instance" "<ITEM_BOMB>" }\n}\n')
        item.saveConditions({ blocks: [] })
        expect(fs.existsSync(cfg)).toBe(false)
    })

    test("of an item without a VBSP config start one", async () => {
        const item = await loadItem(null)
        expect(item.getConditions()).toEqual({ blocks: [] })
        item.saveConditions({ blocks: [NEW_BLOCK] })
        const text = fs.readFileSync(cfg, "utf8")
        expect(text.startsWith(`${GENERATED_HEADER}\n"Conditions"\n{\n\t"Condition"`)).toBe(true)
        expect(conditionsIn(text)).toHaveLength(1)
    })

    test("from an older import's vbsp_config.json are read, and saved as vbsp_config.cfg", async () => {
        const item = await loadItem(null)
        const json = path.join(itemDir, "vbsp_config.json")
        fs.writeFileSync(
            json,
            JSON.stringify({
                Conditions: {
                    Condition_1700000000_abc: {
                        instance: "<ITEM_BOMB>",
                        Result: { AddOverlay: "instances/a.vmf" },
                    },
                },
            }),
        )
        const { blocks } = item.getConditions()
        expect(blocks).toHaveLength(1)
        expect(parse(blocks[0].vdf)[0].key).toBe("Condition")

        item.saveConditions({ blocks })
        expect(fs.existsSync(json)).toBe(false)
        const [condition] = conditionsIn(fs.readFileSync(cfg, "utf8"))
        expect(condition.children.map(({ key }) => key)).toEqual(["instance", "Result"])
    })

    test("that can't be read are left as they are", async () => {
        const broken = '"Conditions"\n{\n\t"Condition"\n\t{\n'
        const item = await loadItem(broken)
        const { blocks, error } = item.getConditions()
        expect(blocks).toEqual([])
        expect(error).toMatch(/can't be read \(line 4: a \{ has no \}\)/)
        expect(() => item.saveConditions({ blocks: [NEW_BLOCK] })).toThrow()
        expect(fs.readFileSync(cfg, "utf8")).toBe(broken)
    })

    test("keep the bytes of a file that isn't UTF-8", async () => {
        const latin1 = Buffer.from(
            `// Caf\xe9\r\n"Conditions"\r\n{\r\n\t"Condition" { "instance" "<ITEM_BOMB>" }\r\n}\r\n`,
            "latin1",
        )
        const item = await loadItem(latin1)
        item.saveConditions(item.getConditions())
        const saved = fs.readFileSync(cfg)
        expect(saved.subarray(saved.indexOf("// Caf"))).toEqual(latin1)
    })

    test("refuse to save what isn't a list of blocks", async () => {
        const item = await loadItem()
        expect(() => item.saveConditions({ blocks: { blocks: [] } })).toThrow(
            "aren't a list of blocks",
        )
        expect(fs.readFileSync(cfg, "utf8")).toBe(CONFIG)
    })

    /** Entries as [key, value or entries] */
    const keyvalues = (entries) =>
        entries.map(({ key, value, children }) => [
            key,
            children ? keyvalues(children) : value,
        ])

    test("from the editor's blocks are what BEE2 reads", async () => {
        const item = await loadItem(null)
        const block = (type, fields = {}) => ({ id: type, type, ...fields })
        item.saveConditions({
            blocks: [
                block("setInstVar", { variable: "$start_open", newValue: "1" }),
                block("randomSelection", {
                    options: ["instances/a.vmf", "Option 2", "instances/b.vmf"],
                }),
                block("addGlobalEnt", { instanceName: "instances/global.vmf" }),
                block("offsetInstance", { offset: "0 0 64" }),
                // No instance picked: changeInstance "" would remove it
                block("changeInstance"),
                block("if", {
                    variable: "$start_open",
                    operator: "==",
                    value: "1",
                    thenBlocks: [
                        block("addOverlay", { overlayName: "instances/o1.vmf" }),
                        block("addOverlay", { overlayName: "instances/o2.vmf" }),
                    ],
                }),
            ],
        })
        const instance = ["Instance", "<ITEM_BOMB>"]
        expect(keyvalues(conditionsIn(fs.readFileSync(cfg, "utf8")))).toEqual([
            // Results go in a Result block (BEE2 reads the rest as tests)
            ["Condition", [instance, ["Result", [["setInstVar", "$start_open 1"]]]]],
            [
                "Condition",
                [
                    instance,
                    [
                        "Result",
                        [
                            [
                                "random",
                                [
                                    ["changeInstance", "instances/a.vmf"],
                                    ["changeInstance", "instances/b.vmf"],
                                ],
                            ],
                        ],
                    ],
                ],
            ],
            [
                "Condition",
                [instance, ["Result", [["addGlobal", [["file", "instances/global.vmf"]]]]]],
            ],
            ["Condition", [instance, ["Result", [["offsetInstance", "0 0 64"]]]]],
            ["Condition", [instance]],
            [
                "Condition",
                [
                    instance,
                    ["instVar", "$start_open == 1"],
                    [
                        "Result",
                        [
                            ["addOverlay", "instances/o1.vmf"],
                            ["addOverlay", "instances/o2.vmf"],
                        ],
                    ],
                ],
            ],
        ])
    })

    test("written before blocks were fixed stay the editor's blocks, and are fixed when saved", async () => {
        const fixup = {
            id: "fixup",
            type: "setInstVar",
            variable: "$start_open",
            newValue: "1",
        }
        // As BeePEE wrote a Change Fixup before
        const old = [
            '"Conditions"',
            "{",
            '\t"Condition"',
            "\t{",
            '\t\t"Instance" "<ITEM_BOMB>"',
            '\t\t"unknown"',
            "\t\t{",
            '\t\t\t"type" "setInstVar"',
            '\t\t\t"data"',
            "\t\t\t{",
            '\t\t\t\t"id" "fixup"',
            '\t\t\t\t"type" "setInstVar"',
            '\t\t\t\t"variable" "$start_open"',
            '\t\t\t\t"newValue" "1"',
            "\t\t\t}",
            "\t\t}",
            "\t}",
            "}",
            "",
        ].join("\n")
        const item = await loadItem(old)
        fs.writeFileSync(
            path.join(itemDir, "meta.json"),
            JSON.stringify({ vbsp_blocks: [fixup] }),
        )
        expect(item.getConditions().blocks).toEqual([fixup])

        item.saveConditions({ blocks: [fixup] })
        expect(keyvalues(conditionsIn(fs.readFileSync(cfg, "utf8")))).toEqual([
            [
                "Condition",
                [
                    ["Instance", "<ITEM_BOMB>"],
                    ["Result", [["setInstVar", "$start_open 1"]]],
                ],
            ],
        ])
        expect(item.getConditions().blocks).toEqual([fixup])
    })

    test("ButtonType's switch changes each case to its instance", async () => {
        const item = await loadItem(null)
        item.autoGenerateButtonTypeConditions({
            Item: {
                Exporting: {
                    Instances: {
                        0: { Name: "instances/weighted.vmf" },
                        // BEE2's short form
                        1: "instances/cube.vmf",
                    },
                },
            },
        })
        const [condition] = conditionsIn(fs.readFileSync(cfg, "utf8"))
        const cases = condition.children
            .find((entry) => entry.key === "Switch")
            .children.filter((entry) => entry.children)
        expect(keyvalues(cases)).toEqual([
            ["$button_type = 0", [["changeInstance", "instances/weighted.vmf"]]],
            ["$button_type = 1", [["changeInstance", "instances/cube.vmf"]]],
        ])
    })

    test("name their instances in changeInstance, in any case", async () => {
        const item = await loadItem(
            [
                '"Conditions"',
                "{",
                '\t"Condition"',
                "\t{",
                '\t\t"Result"',
                "\t\t{",
                '\t\t\t"changeInstance" "instances/a.vmf"',
                '\t\t\t"ChangeInstance" "instances/b.vmf"',
                '\t\t\t"Changeinstance" "instances/c.vmf"',
                "\t\t}",
                "\t}",
                "}",
            ].join("\n"),
        )
        const found = []
        item.extractChangeInstances(item.readVbspObject(), found)
        expect(found).toEqual([
            "instances/a.vmf",
            "instances/b.vmf",
            "instances/c.vmf",
        ])
        // The load registered them as the item's
        expect(Object.values(item.instances).map(({ Name }) => Name)).toEqual(
            expect.arrayContaining(found),
        )
    })
})
