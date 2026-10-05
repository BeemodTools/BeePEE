jest.mock("electron", () => ({
    app: { isPackaged: false, getPath: () => require("os").tmpdir() },
}))

const fs = require("fs")
const os = require("os")
const path = require("path")
const { Package } = require("../models/package")

/** An editoritems Item block for an item called `name` */
const itemBlock = (name, instance) => ({
    Type: name.toUpperCase().replace(/\W/g, "_"),
    Editor: { SubType: { Name: name } },
    Exporting: { Instances: { 0: { Name: instance } } },
})

describe("loading a package's items", () => {
    let dir

    /** Write an item's folder (editoritems and properties) */
    const writeItem = (folder, editoritems) => {
        const itemDir = path.join(dir, "items", folder)
        fs.mkdirSync(itemDir, { recursive: true })
        fs.writeFileSync(
            path.join(itemDir, "editoritems.json"),
            JSON.stringify(editoritems),
        )
        fs.writeFileSync(
            path.join(itemDir, "properties.json"),
            JSON.stringify({ Properties: { Authors: "Tester" } }),
        )
    }

    const loadPackage = async (items) => {
        fs.writeFileSync(
            path.join(dir, "info.json"),
            JSON.stringify({ ID: "TEST", Name: "Test", Item: items }),
        )
        const pkg = new Package(path.join(dir, "info.json"))
        pkg.packageDir = dir
        await pkg.load()
        return pkg
    }

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-items-"))
    })

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true })
    })

    test("finds the folder of an item with several versions and style blocks", async () => {
        writeItem("skull_blue_ped", {
            Item: itemBlock("Skull Button", "a.vmf"),
        })
        const pkg = await loadPackage([
            {
                ID: "ITEM_SKULL",
                // Two "Version" blocks become an array
                Version: [
                    {
                        ID: "VER_BLUE",
                        Styles: {
                            BEE2_PORTAL_1: {
                                Base: "BEE2_CLEAN",
                                Config: "p1.cfg",
                            },
                            BEE2_CLEAN: "skull_blue_ped",
                        },
                    },
                    { ID: "VER_RED", Styles: { BEE2_CLEAN: "skull_red_ped" } },
                ],
            },
        ])
        expect(pkg.skippedItems).toEqual([])
        expect(pkg.items[0].itemFolder).toBe("skull_blue_ped")
        expect(pkg.items[0].name).toBe("Skull Button")
    })

    test("follows style references and blocks to the folder", async () => {
        writeItem("shared", { Item: itemBlock("Shared", "a.vmf") })
        const pkg = await loadPackage([
            {
                ID: "ITEM_REF",
                Version: {
                    Styles: {
                        BEE2_BTS: "<BEE2_OVERGROWN>",
                        BEE2_OVERGROWN: { Base: "<BEE2_1950s>" },
                        BEE2_1950s: { Folder: "shared" },
                    },
                },
            },
        ])
        expect(pkg.items[0].itemFolder).toBe("shared")
    })

    test("leaves out items it can't read, says why, and loads the rest", async () => {
        writeItem("good", { Item: itemBlock("Good", "a.vmf") })
        writeItem("no_editor", { Item: { Type: "X", Exporting: {} } })
        const pkg = await loadPackage([
            { ID: "ITEM_GOOD", Version: { Styles: { BEE2_CLEAN: "good" } } },
            {
                ID: "ITEM_NO_EDITOR",
                Version: { Styles: { BEE2_CLEAN: "no_editor" } },
            },
            { ID: "ITEM_NO_STYLES", Version: { ID: "VER_DEFAULT" } },
        ])
        expect(pkg.items.map((item) => item.id)).toEqual(["ITEM_GOOD"])
        expect(pkg.skippedItems).toEqual([
            {
                id: "ITEM_NO_EDITOR",
                reason: "Item ITEM_NO_EDITOR: items/no_editor/editoritems has no Item > Editor block",
            },
            {
                id: "ITEM_NO_STYLES",
                reason: "Item ITEM_NO_STYLES: info.json names no folder for it (Version > Styles)",
            },
        ])
    })

    test("reads an editoritems with several Item blocks, and keeps them when saved", async () => {
        writeItem("multi", {
            Item: [
                itemBlock("Main Item", "main.vmf"),
                itemBlock("Helper", "helper.vmf"),
            ],
        })
        const pkg = await loadPackage([
            { ID: "ITEM_MULTI", Version: { Styles: { BEE2_CLEAN: "multi" } } },
        ])
        const [item] = pkg.items
        expect(item.name).toBe("Main Item")
        expect(item.instances[0].Name).toBe("main.vmf")

        // Editing goes to the first block; the second is kept
        const editoritems = item.getEditorItems()
        editoritems.Item.Editor.SubType.Name = "Renamed"
        item.saveEditorItems(editoritems)
        const saved = JSON.parse(
            fs.readFileSync(item.paths.editorItems, "utf8"),
        )
        expect(saved.Item).toHaveLength(2)
        expect(saved.Item[0].Editor.SubType.Name).toBe("Renamed")
        expect(saved.Item[1].Editor.SubType.Name).toBe("Helper")
    })
})
