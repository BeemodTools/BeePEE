jest.mock("electron", () => ({
    app: { isPackaged: false, getPath: () => require("os").tmpdir() },
    dialog: {},
    ipcMain: { handle() {}, on() {} },
    BrowserWindow: { getAllWindows: () => [] },
}))

const { withMadeModels } = require("../handlers/modelHandlers")

const copy = (value) => JSON.parse(JSON.stringify(value))

describe("applying the models Make Model made", () => {
    test("keeps what was saved since, and takes the SubTypes it made", () => {
        // As Make Model staged it: the file then, with a model per cube type
        const made = {
            Item: {
                Type: "ITEM_TROPHY",
                Editor: {
                    SubTypeProperty: "CubeType",
                    SubType: [
                        {
                            Name: "Trophy",
                            Model: { ModelName: "bpee/trophy_0.mdl" },
                            Palette: { Image: "old.png" },
                        },
                        { Name: "Trophy", Model: { ModelName: "bpee/trophy_1.mdl" } },
                    ],
                    MovementHandle: "HANDLE_4_DIRECTIONS",
                },
                Properties: { CubeType: { DefaultValue: 0, Index: 2 } },
                Exporting: { Instances: { 0: { Name: "instances/trophy.vmf" } } },
            },
        }
        // The file when the made models are applied (last in the save):
        // renamed, a variable and an instance added, and the SubTypes made
        // one by saving the variables
        const now = {
            Item: {
                Type: "ITEM_TROPHY",
                Editor: {
                    SubType: {
                        Name: "Big Trophy",
                        Model: { ModelName: "bpee/trophy_0.mdl" },
                        Palette: { Image: "new.png" },
                    },
                    MovementHandle: "HANDLE_NONE",
                },
                Properties: {
                    CubeType: { DefaultValue: 0, Index: 2 },
                    StartEnabled: { DefaultValue: 1, Index: 3 },
                },
                Exporting: {
                    Instances: {
                        0: { Name: "instances/trophy.vmf" },
                        1: { Name: "instances/base.vmf" },
                    },
                },
            },
        }

        const result = withMadeModels(copy(now), made)
        expect(result.Item.Properties).toEqual(now.Item.Properties)
        expect(result.Item.Exporting).toEqual(now.Item.Exporting)
        expect(result.Item.Editor).toEqual({
            SubTypeProperty: "CubeType",
            SubType: [
                {
                    Name: "Big Trophy",
                    Model: { ModelName: "bpee/trophy_0.mdl" },
                    Palette: { Image: "new.png" },
                },
                { Name: "Big Trophy", Model: { ModelName: "bpee/trophy_1.mdl" } },
            ],
            MovementHandle: "HANDLE_NONE",
        })
        // The property that picks the SubType comes first, as BeePEE writes it
        expect(Object.keys(result.Item.Editor)).toEqual([
            "SubTypeProperty",
            "SubType",
            "MovementHandle",
        ])
    })

    test("a model for the first instance only changes the model", () => {
        const made = {
            Item: {
                Editor: {
                    SubType: [
                        { Name: "Trophy", Model: { ModelName: "bpee/trophy.mdl" } },
                    ],
                },
            },
        }
        const now = {
            Item: {
                Editor: {
                    SubType: { Name: "Trophy", Model: { ModelName: "old.mdl" } },
                },
                Properties: { StartEnabled: { DefaultValue: 1, Index: 2 } },
            },
        }
        const result = withMadeModels(copy(now), made)
        expect(result.Item.Editor).toEqual({
            SubType: [{ Name: "Trophy", Model: { ModelName: "bpee/trophy.mdl" } }],
        })
        expect(result.Item.Properties).toEqual(now.Item.Properties)
    })
})
