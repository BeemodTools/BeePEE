jest.mock("electron", () => ({ app: { isPackaged: false } }))

const fs = require("fs")
const os = require("os")
const path = require("path")
const { Item } = require("../models/items")

/** An item with these instances (index: path), each one's VMF there */
function makeItem(dir, instances, meta = null) {
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
    if (meta) {
        fs.writeFileSync(path.join(itemDir, "meta.json"), JSON.stringify(meta))
    }
    for (const name of ["a", "b", "c", "d"]) addVmf(dir, name)
    return new Item({
        packagePath: dir,
        itemJSON: {
            ID: "TEST_ITEM",
            Version: { Styles: { BEE2_CLEAN: "testitem" } },
        },
    })
}

/** An instance's path in the item, and its VMF in the package */
const inst = (name) => `instances/BEE2/test/${name}.vmf`
function addVmf(dir, name) {
    const file = path.join(dir, "resources", "instances", "test", `${name}.vmf`)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, 'world { "id" "1" "classname" "worldspawn" }')
}

/** The editoritems' instances, by index (to their file's name) */
const fileInstances = (dir) =>
    Object.fromEntries(
        Object.entries(
            JSON.parse(
                fs.readFileSync(
                    path.join(dir, "items", "testitem", "editoritems.json"),
                    "utf8",
                ),
            ).Item.Exporting?.Instances ?? {},
        ).map(([index, data]) => [index, path.basename(data.Name, ".vmf")]),
    )

/** What the item editor's Save does: removals, then additions, then names, then numbering */
function save(item, { remove = [], add = [], names = {} }) {
    for (const index of remove) item.removeInstance(index)
    const added = add.map((name) => item.addInstance(inst(name)))
    for (const [index, name] of Object.entries(names)) {
        item.setInstanceName(index, name)
    }
    item.renumberInstances()
    return added
}

describe("an item's instances", () => {
    let dir

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-instances-"))
    })

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true })
    })

    test("are numbered from 0 again when one is removed (a gap is a blank instance to BEE2)", () => {
        const item = makeItem(dir, { 0: inst("a"), 1: inst("b"), 2: inst("c") })
        item.setInstanceName("1", "Bee")
        item.setInstanceName("2", "Sea")

        save(item, { remove: ["0"] })
        expect(fileInstances(dir)).toEqual({ 0: "b", 1: "c" })
        // Their names went with them
        expect(item.getInstanceName("0")).toBe("Bee")
        expect(item.getInstanceName("1")).toBe("Sea")
    })

    test("added after one was removed, a new one fills its index: instance 0 first", () => {
        const item = makeItem(dir, { 0: inst("a"), 1: inst("b") })
        // The editor removes the main instance and adds its replacement in
        // one save
        const [index] = save(item, { remove: ["0"], add: ["c"] })
        expect(index).toBe("0")
        expect(fileInstances(dir)).toEqual({ 0: "c", 1: "b" })
    })

    test("always have an instance 0, however they're added and removed", () => {
        const item = makeItem(dir, { 0: inst("a") })
        save(item, { add: ["b"] })
        save(item, { remove: ["0"] })
        save(item, { add: ["c"] })
        save(item, { remove: ["0"] })
        save(item, { add: ["d"], remove: ["0"] })
        expect(fileInstances(dir)).toEqual({ 0: "d" })
    })

    test("saved with gaps (by earlier versions) are numbered from 0 when the package opens", () => {
        // The handrail started at 1 and the Portal Manager had only 2
        const item = makeItem(
            dir,
            { 1: inst("a"), 3: inst("b"), bee2_frame: inst("c") },
            {
                instanceNames: { 1: "Handrail", 3: "Corner", 5: "Gone" },
                instanceErrors: { 3: "Missing" },
            },
        )
        expect(item.repairEditorItems()).toContain(
            "its instances are numbered from 0 with no gaps",
        )
        // Named instances (BEE2's bee2_...) stay as they are
        expect(fileInstances(dir)).toEqual({ 0: "a", 1: "b", bee2_frame: "c" })
        expect(item.getInstanceName("0")).toBe("Handrail")
        expect(item.getInstanceName("1")).toBe("Corner")
        expect(item.getMetadata().instanceNames).toEqual({
            0: "Handrail",
            1: "Corner",
        })
        expect(item.getMetadata().instanceErrors).toEqual({ 1: "Missing" })

        // Numbered already: nothing to do
        expect(item.repairEditorItems()).toEqual([])
    })
})
