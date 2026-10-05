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

    const loadPackage = async (items, more = {}) => {
        fs.writeFileSync(
            path.join(dir, "info.json"),
            JSON.stringify({ ID: "TEST", Name: "Test", Item: items, ...more }),
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
        writeItem("no_name", { Item: { Type: "X", Editor: { SubType: {} } } })
        const pkg = await loadPackage([
            { ID: "ITEM_GOOD", Version: { Styles: { BEE2_CLEAN: "good" } } },
            {
                ID: "ITEM_NO_NAME",
                Version: { Styles: { BEE2_CLEAN: "no_name" } },
            },
            { ID: "ITEM_NO_STYLES", Version: { ID: "VER_DEFAULT" } },
        ])
        expect(pkg.items.map((item) => item.id)).toEqual(["ITEM_GOOD"])
        expect(pkg.skippedItems).toEqual([
            {
                id: "ITEM_NO_NAME",
                reason: "Item ITEM_NO_NAME: items/no_name/editoritems has no Editor > SubType > Name",
            },
            {
                id: "ITEM_NO_STYLES",
                reason: "Item ITEM_NO_STYLES: info.json names no folder for it (Version > Styles)",
            },
        ])
    })

    test("loads items BEE2 uses itself (no Editor block, no properties)", async () => {
        // Like core's ITEM_INDICATOR_TOGGLE: never in the palette
        const itemDir = path.join(dir, "items", "indicator_toggle")
        fs.mkdirSync(itemDir, { recursive: true })
        fs.writeFileSync(
            path.join(itemDir, "editoritems.json"),
            JSON.stringify({
                Item: {
                    Type: "ITEM_INDICATOR_TOGGLE",
                    Exporting: {
                        Instances: { 0: { Name: "instances/toggle.vmf" } },
                    },
                },
            }),
        )
        const pkg = await loadPackage([
            {
                ID: "ITEM_INDICATOR_TOGGLE",
                Unstyled: "1",
                Version: { Styles: { UNSTYLED: "indicator_toggle" } },
            },
        ])
        expect(pkg.skippedItems).toEqual([])
        const [item] = pkg.items
        expect(item.name).toBe("Indicator Toggle")
        expect(item.hasEditor).toBe(false)
        expect(item.instances[0].Name).toBe("instances/toggle.vmf")
        expect(() => item.toJSONWithExistence()).not.toThrow()
    })

    test("reads BEE2's short instance form, and leaves out VBSP values that aren't files", async () => {
        writeItem("light_tile", {
            Item: {
                Editor: { SubType: { Name: "Light Tile" } },
                Exporting: {
                    Instances: {
                        0: "instances/BEE2/clean/items/light_tile/cool_white.vmf",
                        bee2_common:
                            "instances/BEE2/clean/items/light_tile/common.vmf",
                    },
                },
            },
        })
        fs.writeFileSync(
            path.join(dir, "items", "light_tile", "vbsp_config.json"),
            JSON.stringify({
                Conditions: {
                    Condition: {
                        Result: {
                            Changeinstance: ["<ITEM_LIGHT:bee2_common>", ""],
                        },
                    },
                },
            }),
        )
        const pkg = await loadPackage([
            {
                ID: "ITEM_LIGHT",
                Version: { Styles: { BEE2_CLEAN: "light_tile" } },
            },
        ])
        const [item] = pkg.items
        expect(item.instances[0].Name).toBe(
            "instances/BEE2/clean/items/light_tile/cool_white.vmf",
        )
        expect(item.instances.bee2_common.Name).toBe(
            "instances/BEE2/clean/items/light_tile/common.vmf",
        )
        // Neither value is a file: nothing came from the VBSP config
        expect(
            Object.values(item.instances).filter((i) => i.source === "vbsp"),
        ).toEqual([])
    })

    test("finds signage icons made of image layers", async () => {
        const background = path.join(
            dir,
            "resources",
            "BEE2",
            "signage",
            "back.png",
        )
        fs.mkdirSync(path.dirname(background), { recursive: true })
        fs.writeFileSync(background, "png")
        const pkg = await loadPackage([], {
            Signage: {
                ID: "SIGN_TEST",
                Name: "Test",
                Styles: {
                    BEE2_CLEAN: { icon: "signage/back.png" },
                    BEE2_1970s: {
                        // Two "img" lines: the first layer isn't in this package
                        icon: {
                            img: [
                                "BEE2_SIGNAGE:items/70s/missing.png",
                                "TEST:signage/back.png",
                            ],
                        },
                    },
                },
            },
        })
        const [signage] = pkg.signages
        expect(signage.styles.BEE2_CLEAN.icon).toBe(background)
        expect(signage.styles.BEE2_1970s.icon).toBe(background)
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
