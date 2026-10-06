jest.mock("electron", () => ({
    app: { isPackaged: false, getPath: () => require("os").tmpdir() },
    dialog: {},
    ipcMain: { handle() {}, on() {} },
    BrowserWindow: { getAllWindows: () => [] },
}))

// The package the "+" button adds items to
let mockPackageDir = null
jest.mock("../packageManager", () => ({
    packages: [],
    loadPackage: jest.fn(),
    Package: class {},
    getCurrentPackageDir: () => mockPackageDir,
}))
jest.mock("../items/itemEditor", () => ({
    createItemEditor() {},
    sendItemUpdateToEditor() {},
    createItemCreationWindow() {},
    getCreateItemWindow: () => null,
}))

const fs = require("fs")
const os = require("os")
const path = require("path")

/** BEE2's editoritems.txt docs: "Type: The ID for this item, which must be unique" */
const typeOf = (dir, folder) =>
    JSON.parse(
        fs.readFileSync(
            path.join(dir, "items", folder, "editoritems.json"),
            "utf8",
        ),
    ).Item.Type

describe("an item's type in its editoritems", () => {
    let dir

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-item-type-"))
    })

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true })
    })

    test("is its ID for an item made with the + button", async () => {
        fs.writeFileSync(
            path.join(dir, "info.json"),
            JSON.stringify({ ID: "TEST", Name: "Test" }),
        )
        mockPackageDir = dir
        const handlers = {}
        require("../handlers/itemHandlers").register(
            { handle: (name, handler) => (handlers[name] = handler), on() {} },
            { webContents: { send() {} } },
        )

        const result = await handlers["create-item-simple"](
            {},
            { name: "Exposed cube dropper", author: "Tester" },
        )
        expect(result.success).toBe(true)
        expect(result.itemId).toMatch(/^bpee_exposedcubedropper_[0-9A-F]{4}$/)
        expect(typeOf(dir, "exposedcubedropper")).toBe(result.itemId)
    })

    test("becomes its ID when its package loads, if BeePEE made it ITEM_CUBE", async () => {
        const items = [
            // Made by BeePEE before this fix
            { id: "bpee_trophy_03AF", folder: "trophy", type: "ITEM_CUBE" },
            // An item that is the game's cube keeps that
            { id: "ITEM_CUBE", folder: "cube", type: "ITEM_CUBE" },
            { id: "ITEM_LAMP", folder: "lamp", type: "ITEM_LAMP" },
        ]
        for (const { folder, type } of items) {
            const itemDir = path.join(dir, "items", folder)
            fs.mkdirSync(itemDir, { recursive: true })
            fs.writeFileSync(
                path.join(itemDir, "editoritems.json"),
                JSON.stringify({
                    Item: {
                        Type: type,
                        ItemClass: "ItemBase",
                        Editor: { SubType: { Name: folder } },
                        Exporting: { Instances: {} },
                    },
                }),
            )
            fs.writeFileSync(path.join(itemDir, "properties.json"), "{}")
        }
        fs.writeFileSync(
            path.join(dir, "info.json"),
            JSON.stringify({
                ID: "TEST",
                Name: "Test",
                Item: items.map(({ id, folder }) => ({
                    ID: id,
                    Version: { Styles: { BEE2_CLEAN: folder } },
                })),
            }),
        )

        const { Package } = require("../models/package")
        const pkg = new Package(path.join(dir, "info.json"))
        pkg.packageDir = dir
        await pkg.load()

        expect(typeOf(dir, "trophy")).toBe("bpee_trophy_03AF")
        expect(typeOf(dir, "cube")).toBe("ITEM_CUBE")
        expect(typeOf(dir, "lamp")).toBe("ITEM_LAMP")
    })
})
