const fs = require("fs")
const os = require("os")
const path = require("path")
const { Item } = require("../models/items")

/**
 * An item whose editoritems have the instances given (by index) and whose
 * VBSP config switches to the paths given; every instance's VMF exists
 */
function makeItem(dir, instances, switchesTo) {
    const itemDir = path.join(dir, "items", "testitem")
    fs.mkdirSync(itemDir, { recursive: true })
    fs.writeFileSync(
        path.join(itemDir, "editoritems.json"),
        JSON.stringify({
            Item: {
                Type: "TEST_ITEM",
                ItemClass: "ItemBase",
                Editor: { SubType: { Name: "Test" } },
                Exporting: {
                    Instances: Object.fromEntries(
                        Object.entries(instances).map(([index, name]) => [
                            index,
                            { Name: name },
                        ]),
                    ),
                },
            },
        }),
    )
    fs.writeFileSync(
        path.join(itemDir, "properties.json"),
        JSON.stringify({ Properties: { Authors: "Tester" } }),
    )
    if (switchesTo.length) {
        fs.writeFileSync(
            path.join(itemDir, "vbsp_config.cfg"),
            [
                '"Conditions"',
                "{",
                '\t"Condition"',
                "\t{",
                '\t\t"instance" "<TEST_ITEM>"',
                '\t\t"Result"',
                "\t\t{",
                ...switchesTo.map((name) => `\t\t\t"changeInstance" "${name}"`),
                "\t\t}",
                "\t}",
                "}",
            ].join("\n"),
        )
    }
    for (const name of [...Object.values(instances), ...switchesTo]) {
        const file = vmf(dir, name)
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, 'world { "id" "1" "classname" "worldspawn" }')
    }
    return new Item({
        packagePath: dir,
        itemJSON: {
            ID: "TEST_ITEM",
            Version: { Styles: { BEE2_CLEAN: "testitem" } },
        },
    })
}

/** Where an instance's VMF is in the package */
const vmf = (dir, name) =>
    path.join(dir, "resources", name.replace(/^instances\/BEE2\//, "instances/"))

/** The editoritems' instances, by index */
const fileInstances = (dir) =>
    Object.fromEntries(
        Object.entries(
            JSON.parse(
                fs.readFileSync(
                    path.join(dir, "items", "testitem", "editoritems.json"),
                    "utf8",
                ),
            ).Item.Exporting?.Instances ?? {},
        ).map(([index, instance]) => [index, instance.Name]),
    )

const names = (item) =>
    Object.fromEntries(
        Object.entries(item.instances).map(([index, i]) => [index, i.Name]),
    )

describe("the instances an item's conditions switch to", () => {
    let dir

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-cond-inst-"))
    })

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true })
    })

    test("are registered under the editoritems' indices, not over another instance", () => {
        // Index 1 was removed: the new one fills it (BEE2 would make the gap
        // a blank instance), and doesn't go over index 2
        const item = makeItem(
            dir,
            {
                0: "instances/BEE2/test/main.vmf",
                2: "instances/BEE2/test/other.vmf",
            },
            ["instances/BEE2/test/switched.vmf"],
        )
        expect(item.autoImportVBSPInstances()).toBe(true)
        const expected = {
            0: "instances/BEE2/test/main.vmf",
            1: "instances/BEE2/test/switched.vmf",
            2: "instances/BEE2/test/other.vmf",
        }
        expect(fileInstances(dir)).toEqual(expected)
        expect(names(item)).toEqual(expected)
    })

    test("stay removed, with their file, and come back when added again", () => {
        const item = makeItem(
            dir,
            {
                0: "instances/BEE2/test/main.vmf",
                1: "instances/BEE2/test/switched.vmf",
            },
            ["instances/BEE2/test/switched.vmf"],
        )
        item.removeInstance("1")
        expect(fileInstances(dir)).toEqual({ 0: "instances/BEE2/test/main.vmf" })
        // The conditions still switch to it
        expect(fs.existsSync(vmf(dir, "instances/BEE2/test/switched.vmf"))).toBe(
            true,
        )
        item.reloadInstances()
        expect(names(item)).toEqual({ 0: "instances/BEE2/test/main.vmf" })

        expect(item.addInstance("instances/BEE2/test/switched.vmf")).toBe("1")
        expect(item.getMetadata().removedInstances).toEqual([])
        expect(names(item)[1]).toBe("instances/BEE2/test/switched.vmf")
    })

    test("can be removed when the user sees them as removable", () => {
        // Registered from the conditions, then removed: no "Cannot remove
        // VBSP instances"
        const item = makeItem(dir, { 0: "instances/BEE2/test/main.vmf" }, [
            "instances/BEE2/test/switched.vmf",
        ])
        item.autoImportVBSPInstances()
        expect(() => item.removeInstance("1")).not.toThrow()
        expect(Object.keys(item.instances)).toEqual(["0"])
    })
})

describe("removing an instance", () => {
    let dir

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-remove-inst-"))
    })

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true })
    })

    test("keeps a VMF another instance still uses", () => {
        const shared = "instances/BEE2/test/shared.vmf"
        const item = makeItem(dir, { 0: shared, 1: shared }, [])
        item.removeInstance("0")
        expect(fs.existsSync(vmf(dir, shared))).toBe(true)
        item.removeInstance("1")
        expect(fs.existsSync(vmf(dir, shared))).toBe(false)
    })

    test("keeps a VMF another item uses", () => {
        const name = "instances/BEE2/test/main.vmf"
        const item = makeItem(dir, { 0: name }, [])
        item.removeInstance("0", { keepFile: true })
        expect(fs.existsSync(vmf(dir, name))).toBe(true)
        expect(fileInstances(dir)).toEqual({})
    })

    test("takes its name along, so an instance added at its index has none", () => {
        const item = makeItem(
            dir,
            {
                0: "instances/BEE2/test/main.vmf",
                1: "instances/BEE2/test/other.vmf",
            },
            [],
        )
        item.setInstanceName("1", "Trophy")
        item.removeInstance("1")
        expect(item.getInstanceNames()).toEqual({})
        expect(item.addInstance("instances/BEE2/test/new.vmf")).toBe("1")
        expect(item.getInstanceName("1")).toBe("Instance 1")
    })
})
