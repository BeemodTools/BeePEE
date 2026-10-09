jest.mock("electron", () => ({
    app: { isPackaged: false, getPath: () => require("os").tmpdir() },
    dialog: {},
    ipcMain: { handle() {}, on() {} },
}))

const fs = require("fs")
const os = require("os")
const path = require("path")
const { Package } = require("../models/package")

describe("Connection Count", () => {
    let dir
    let itemDir

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-connections-"))
        itemDir = path.join(dir, "items", "door")
    })

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true })
    })

    /** A door with an input, as its package opens */
    async function loadDoor() {
        fs.mkdirSync(itemDir, { recursive: true })
        fs.writeFileSync(
            path.join(itemDir, "editoritems.json"),
            JSON.stringify({
                Item: {
                    Type: "ITEM_DOOR",
                    Editor: { SubType: { Name: "Door" } },
                    Properties: {
                        StartReversed: { DefaultValue: 0, Index: 2 },
                    },
                    Exporting: {
                        Instances: { 0: { Name: "instances/d.vmf" } },
                        Inputs: { BEE2: { Type: "AND" } },
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
                ID: "TEST",
                Name: "Test",
                Item: {
                    ID: "ITEM_DOOR",
                    Version: { Styles: { BEE2_CLEAN: "door" } },
                },
            }),
        )
        const pkg = new Package(path.join(dir, "info.json"))
        pkg.packageDir = dir
        await pkg.load()
        return pkg.items[0]
    }

    const properties = () =>
        JSON.parse(
            fs.readFileSync(path.join(itemDir, "editoritems.json"), "utf8"),
        ).Item.Properties

    test("an item with inputs gets, and saving its variables leaves as it is", async () => {
        const item = await loadDoor()
        // BeePEE adds it (BEE2 warns without it), first
        expect(properties()).toEqual({
            ConnectionCount: { DefaultValue: 0, Index: 1 },
            StartReversed: { DefaultValue: 0, Index: 2 },
        })

        // Sent with the variables (an editor from before 1.2.1 offered it):
        // not written at another index
        expect(
            item.saveVariables([
                ...item.getVariables(),
                {
                    presetKey: "ConnectionCount",
                    customValue: "0",
                    type: "number",
                },
            ]),
        ).toBe(true)
        expect(properties().ConnectionCount).toEqual({
            DefaultValue: 0,
            Index: 1,
        })

        // The next save numbers the variables from 2: none of them at its index
        expect(
            item.saveVariables([
                { presetKey: "TimerDelay", customValue: "3", type: "number" },
                ...item.getVariables(),
            ]),
        ).toBe(true)
        expect(properties()).toEqual({
            ConnectionCount: { DefaultValue: 0, Index: 1 },
            TimerDelay: { DefaultValue: 3, Index: 2 },
            StartReversed: { DefaultValue: 0, Index: 3 },
        })
    })
})
