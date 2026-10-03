jest.mock("electron", () => ({ app: { isPackaged: false } }))

// The open package's items
let mockItems = []
jest.mock("../packageManager", () => ({
    packages: [
        {
            get items() {
                return mockItems
            },
        },
    ],
}))

// A model with one texture, instead of converting a VMF
jest.mock("../utils/vmf2obj", () => ({
    convertVmfToObj: jest.fn(async (vmfPath, { outputDir }) => {
        const fs = require("fs")
        const path = require("path")
        fs.mkdirSync(path.join(outputDir, "materials/metal"), {
            recursive: true,
        })
        fs.writeFileSync(
            path.join(outputDir, "materials/metal/wall.png"),
            Buffer.from("png"),
        )
        const objPath = path.join(outputDir, "item_0.obj")
        const mtlPath = path.join(outputDir, "item_0.mtl")
        fs.writeFileSync(objPath, "mtllib item_0.mtl\nv 0 0 0\n")
        fs.writeFileSync(
            mtlPath,
            "newmtl metal/wall\nmap_Kd materials/metal/wall.png\n# beepee:alphatest\n",
        )
        return { objPath, mtlPath }
    }),
}))

const fs = require("fs")
const os = require("os")
const path = require("path")
const { register } = require("../handlers/iconHandlers")

describe("icon maker handlers", () => {
    const handlers = {}
    let packagePath

    beforeAll(() => {
        register({
            handle: (channel, handler) => (handlers[channel] = handler),
        })
    })

    beforeEach(() => {
        packagePath = fs.mkdtempSync(
            path.join(os.tmpdir(), "beepee-icon-test-"),
        )
        mockItems = [
            {
                id: "my_item",
                name: "My Item",
                packagePath,
                instances: { 0: { Name: "instances/my_item/item_0.vmf" } },
            },
        ]
    })

    afterEach(() => {
        fs.rmSync(packagePath, { recursive: true, force: true })
    })

    test("generates the model with its textures as data URLs", async () => {
        const result = await handlers["icon-maker-generate-model"](null, {
            itemId: "my_item",
            instanceKey: "0",
        })
        expect(result.success).toBe(true)
        expect(result.obj).toContain("mtllib item_0.mtl")
        expect(result.mtl).toContain("# beepee:alphatest")
        expect(result.textures).toEqual({
            "materials/metal/wall.png": `data:image/png;base64,${Buffer.from("png").toString("base64")}`,
        })
    })

    test("says why a model can't be made", async () => {
        expect(
            await handlers["icon-maker-generate-model"](null, {
                itemId: "nope",
                instanceKey: "0",
            }),
        ).toEqual({ success: false, error: "Item not found" })
        expect(
            await handlers["icon-maker-generate-model"](null, {
                itemId: "my_item",
                instanceKey: "7",
            }),
        ).toEqual({ success: false, error: "Instance not found" })
    })

    test("saves the icon, replacing the one made before", async () => {
        const png = Buffer.from("icon").toString("base64")
        const first = await handlers["icon-maker-save-icon"](null, {
            itemId: "my_item",
            png,
        })
        await new Promise((resolve) => setTimeout(resolve, 5))
        const second = await handlers["icon-maker-save-icon"](null, {
            itemId: "my_item",
            png,
        })
        expect(second.success).toBe(true)
        expect(second.fileName).toMatch(/^icon_\d+\.png$/)
        expect(fs.readFileSync(second.filePath, "utf8")).toBe("icon")
        expect(fs.existsSync(first.filePath)).toBe(false)
        expect(path.dirname(second.filePath)).toBe(
            path.join(packagePath, ".bpee", "my_item", "icon"),
        )
    })
})
