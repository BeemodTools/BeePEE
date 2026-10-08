const fs = require("fs")
const path = require("path")
const { Item } = require("../models/items")

jest.mock("fs")

describe("Item", () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    const mockPackagePath = "/test/package"
    const mockItemJSON = {
        ID: "TEST_ITEM",
        Version: {
            Styles: {
                BEE2_CLEAN: "test_folder",
            },
        },
    }

    const mockEditorItemsJSON = {
        Item: {
            Editor: {
                SubType: {
                    Name: "Test Item",
                    Palette: {
                        Image: "palette/test.png",
                    },
                },
            },
        },
    }

    const mockPropertiesJSON = {
        Properties: {
            Description: "Test description",
            Icon: {
                0: "test_icon.png",
            },
        },
    }

    // Mock file system
    beforeEach(() => {
        fs.existsSync.mockImplementation((filePath) => {
            if (filePath.includes("editoritems.json")) {
                return true
            }
            if (filePath.includes("properties.json")) {
                return true
            }
            return false
        })

        fs.readFileSync.mockImplementation((filePath) => {
            if (filePath.includes("editoritems.json")) {
                return JSON.stringify(mockEditorItemsJSON)
            }
            if (filePath.includes("properties.json")) {
                return JSON.stringify(mockPropertiesJSON)
            }
            throw new Error(`Unexpected file read: ${filePath}`)
        })
    })

    test("should create item with valid data", () => {
        const item = new Item({
            packagePath: mockPackagePath,
            itemJSON: mockItemJSON,
        })

        expect(item.id).toBe("TEST_ITEM")
        expect(item.name).toBe("Test Item")
        expect(item.paths.editorItems).toContain("editoritems.json")
        expect(item.paths.properties).toContain("properties.json")
        expect(item.details).toEqual(mockPropertiesJSON.Properties)
    })

    test("should handle folder in object format", () => {
        const itemJSON = {
            ID: "TEST_ITEM",
            Version: {
                Styles: {
                    BEE2_CLEAN: {
                        folder: "test_folder",
                    },
                },
            },
        }

        const item = new Item({
            packagePath: mockPackagePath,
            itemJSON,
        })

        expect(item.itemFolder).toBe("test_folder")
    })

    test("should throw error when no folder found", () => {
        const itemJSON = {
            ID: "TEST_ITEM",
            Version: {
                Styles: {},
            },
        }

        expect(() => {
            new Item({
                packagePath: mockPackagePath,
                itemJSON,
            })
        }).toThrow(
            "Item TEST_ITEM: info.json names no folder for it (Version > Styles)",
        )
    })

    test("should throw error when editoritems.json missing", () => {
        fs.existsSync.mockImplementation((filePath) => {
            return !filePath.includes("editoritems.json")
        })

        expect(() => {
            new Item({
                packagePath: mockPackagePath,
                itemJSON: mockItemJSON,
            })
        }).toThrow("Item TEST_ITEM: items/test_folder has no editoritems")
    })

    test("should throw error when properties.json missing", () => {
        fs.existsSync.mockImplementation((filePath) => {
            return !filePath.includes("properties.json")
        })

        expect(() => {
            new Item({
                packagePath: mockPackagePath,
                itemJSON: mockItemJSON,
            })
        }).toThrow("Item TEST_ITEM: items/test_folder has no properties")
    })

    test("should get raw editor items", () => {
        const item = new Item({
            packagePath: mockPackagePath,
            itemJSON: mockItemJSON,
        })

        const rawEditorItems = item.getEditorItems(true)
        expect(rawEditorItems).toBe(JSON.stringify(mockEditorItemsJSON))
    })

    test("should get parsed editor items", () => {
        const item = new Item({
            packagePath: mockPackagePath,
            itemJSON: mockItemJSON,
        })

        const parsedEditorItems = item.getEditorItems()
        expect(parsedEditorItems).toEqual(mockEditorItemsJSON)
    })

    test("should save editor items", () => {
        const item = new Item({
            packagePath: mockPackagePath,
            itemJSON: mockItemJSON,
        })

        const mockJSON = { Item: { test: "data" } }
        item.saveEditorItems(mockJSON)

        expect(fs.writeFileSync).toHaveBeenCalledWith(
            expect.stringContaining("editoritems.json"),
            JSON.stringify(mockJSON, null, 4),
            "utf8",
        )
    })

    test("should save properties", () => {
        const item = new Item({
            packagePath: mockPackagePath,
            itemJSON: mockItemJSON,
        })

        const mockPropertiesJSON = { Properties: { test: "data" } }
        item.saveProperties(mockPropertiesJSON)

        expect(fs.writeFileSync).toHaveBeenCalledWith(
            expect.stringContaining("properties.json"),
            JSON.stringify(mockPropertiesJSON, null, 4),
            "utf8",
        )
    })

    test("should check if item exists", () => {
        const item = new Item({
            packagePath: mockPackagePath,
            itemJSON: mockItemJSON,
        })

        expect(item.exists()).toBe(true)

        fs.existsSync.mockReturnValue(false)
        expect(item.exists()).toBe(false)
    })

    test("should serialize to JSON", () => {
        const item = new Item({
            packagePath: mockPackagePath,
            itemJSON: mockItemJSON,
        })

        const json = item.toJSON()
        expect(json).toEqual({
            id: item.id,
            name: item.name,
            details: item.details,
            icon: item.icon,
            paths: item.paths,
            itemFolder: item.itemFolder,
            fullItemPath: item.fullItemPath,
            packagePath: item.packagePath,
            instances: item.instances,
        })
    })
})
