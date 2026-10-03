jest.mock("electron", () => ({
    app: { isPackaged: false },
    dialog: { showErrorBox: jest.fn(), showMessageBox: jest.fn() },
}))
jest.mock("../packageManager", () => ({ packages: [] }))
jest.mock("../utils/vmf2obj", () => ({
    convertVmfToObj: jest.fn(),
    convertVmfsToObj: jest.fn(),
}))
jest.mock("../items/Instance", () => ({ Instance: {} }))
jest.mock("../handlers/instanceHandlers", () => ({ fixInstancePath: jest.fn() }))
jest.mock("../items/itemEditor", () => ({
    closeAllModelPreviewWindows: jest.fn(async () => {}),
}))
jest.mock("../handlers/iconHandlers", () => ({
    findItem: jest.fn(),
    instanceModel: jest.fn(),
}))
jest.mock("../utils/mdlConverter", () => ({ convertAndInstallMDL: jest.fn() }))

const { register } = require("../handlers/conversionHandlers")
const { closeAllModelPreviewWindows } = require("../items/itemEditor")
const { findItem, instanceModel } = require("../handlers/iconHandlers")
const { convertAndInstallMDL } = require("../utils/mdlConverter")

describe("making the item's model from the icon maker's model", () => {
    const handlers = {}
    const folder = "/package/.bpee/my_item/icon/models/0"
    const objPath = `${folder}/item_0.obj`
    const mtlPath = `${folder}/item_0.mtl`
    let item

    const make = (instanceKey = "0") =>
        handlers["make-model-from-icon-model"](null, {
            itemId: "My_Item",
            instanceKey,
        })

    beforeAll(() => {
        register({ handle: (channel, handler) => (handlers[channel] = handler) })
    })

    beforeEach(() => {
        item = {
            id: "My_Item",
            name: "My Item",
            packagePath: "/package",
            getEditorItems: () => ({
                Item: {
                    Editor: {
                        SubType: { Name: "My Item", Model: { ModelName: "cube.3ds" } },
                    },
                },
            }),
        }
        findItem.mockReturnValue(item)
        instanceModel.mockResolvedValue({ folder, objPath, mtlPath, made: false })
        convertAndInstallMDL.mockResolvedValue({
            success: true,
            relativeModelPath: "bpee/my_item/my_item.mdl",
        })
    })

    test("compiles the kept model and stages it as the item's model", async () => {
        const result = await make()
        expect(result).toMatchObject({ success: true, objPath, mtlPath })
        expect(result.mdlResult.stagedEditorItems.Item.Editor.SubType).toEqual([
            { Name: "My Item", Model: { ModelName: "bpee/my_item/my_item.mdl" } },
        ])
        expect(findItem).toHaveBeenCalledWith("My_Item")
        expect(instanceModel).toHaveBeenCalledWith(item, "0")
        expect(convertAndInstallMDL).toHaveBeenCalledWith(
            objPath,
            "/package",
            "my_item",
            { scale: 1 },
        )
        // The previews are closed before the model's files are used
        expect(closeAllModelPreviewWindows.mock.invocationCallOrder[0]).toBeLessThan(
            instanceModel.mock.invocationCallOrder[0],
        )
    })

    test("says why the model couldn't be made", async () => {
        convertAndInstallMDL.mockRejectedValue(
            new Error("STUDIOMDL compilation failed"),
        )
        expect(await make()).toMatchObject({
            success: false,
            error: "STUDIOMDL compilation failed",
            objPath,
            mtlPath,
        })

        instanceModel.mockRejectedValue(new Error("Instance not found"))
        expect(await make("7")).toEqual({
            success: false,
            error: "Instance not found",
        })

        findItem.mockImplementation(() => {
            throw new Error("Item not found")
        })
        expect(await make()).toEqual({ success: false, error: "Item not found" })
    })
})
