const fs = require("fs")
const path = require("path")
const { Item } = require("../models/items")

describe("VBSP Auto-Registration", () => {
    let testPackagePath
    let testItemPath
    let testItemId = "test_vbsp_item"

    beforeEach(() => {
        // Create test directory structure
        testPackagePath = path.join(__dirname, "temp_test_package")
        testItemPath = path.join(testPackagePath, "items", "testitem")

        // Clean up from previous tests
        if (fs.existsSync(testPackagePath)) {
            fs.rmSync(testPackagePath, { recursive: true, force: true })
        }

        // Create directory structure
        fs.mkdirSync(testPackagePath, { recursive: true })
        fs.mkdirSync(testItemPath, { recursive: true })
        fs.mkdirSync(path.join(testPackagePath, "resources"), {
            recursive: true,
        })
    })

    afterEach(() => {
        // Clean up test files
        if (fs.existsSync(testPackagePath)) {
            fs.rmSync(testPackagePath, { recursive: true, force: true })
        }
    })

    test("should auto-register VBSP instances in editoritems.json on import", () => {
        // Create test item JSON
        const itemJSON = {
            ID: testItemId,
            Version: {
                Styles: {
                    BEE2_CLEAN: "testitem",
                },
            },
        }

        // Create initial editoritems.json with no instances
        const initialEditorItems = {
            Item: {
                ItemClass: "ItemBase",
                Type: "TEST_VBSP",
                Editor: {
                    SubType: {
                        Name: "Test VBSP Item",
                        Model: {
                            ModelName: "test_model.3ds",
                        },
                        Palette: {
                            Tooltip: "TEST VBSP ITEM",
                            Image: "palette/test/test_item.png",
                            Position: "0 0 0",
                        },
                    },
                },
                // No Exporting.Instances section initially
            },
        }

        fs.writeFileSync(
            path.join(testItemPath, "editoritems.json"),
            JSON.stringify(initialEditorItems, null, 2),
        )

        // Create properties.json
        const properties = {
            Properties: {
                Name: "Test VBSP Item",
                Author: "Test Author",
                Description: "A test item with VBSP instances",
            },
        }

        fs.writeFileSync(
            path.join(testItemPath, "properties.json"),
            JSON.stringify(properties, null, 2),
        )

        // Create VBSP config with instances (as JSON since it gets converted)
        const vbspConfig = {
            Changeinstance: [
                "instances/test_instance1.vmf",
                "instances/test_instance2.vmf",
                "instances/test_instance3.vmf",
            ],
        }

        fs.writeFileSync(
            path.join(testItemPath, "vbsp_config.json"),
            JSON.stringify(vbspConfig, null, 2),
        )

        // Load the item, and register its VBSP instances as loading its
        // package does
        const item = new Item({ packagePath: testPackagePath, itemJSON })
        item.autoImportVBSPInstances()

        // Verify that editoritems.json was updated with VBSP instances
        const updatedEditorItems = JSON.parse(
            fs.readFileSync(
                path.join(testItemPath, "editoritems.json"),
                "utf-8",
            ),
        )

        expect(updatedEditorItems.Item.Exporting).toBeDefined()
        expect(updatedEditorItems.Item.Exporting.Instances).toBeDefined()

        const instances = updatedEditorItems.Item.Exporting.Instances
        const instanceNames = Object.values(instances).map((inst) => inst.Name)

        expect(instanceNames).toContain("instances/test_instance1.vmf")
        expect(instanceNames).toContain("instances/test_instance2.vmf")
        expect(instanceNames).toContain("instances/test_instance3.vmf")

        // Verify VMF stats are included
        Object.values(instances).forEach((instance) => {
            expect(instance).toHaveProperty("EntityCount")
            expect(instance).toHaveProperty("BrushCount")
            expect(instance).toHaveProperty("BrushSideCount")
        })
    })

    test("should skip already registered VBSP instances", () => {
        // Create test item JSON
        const itemJSON = {
            ID: testItemId,
            Version: {
                Styles: {
                    BEE2_CLEAN: "testitem",
                },
            },
        }

        // Create initial editoritems.json with one instance already registered
        const initialEditorItems = {
            Item: {
                ItemClass: "ItemBase",
                Type: "TEST_VBSP",
                Editor: {
                    SubType: {
                        Name: "Test VBSP Item",
                        Model: {
                            ModelName: "test_model.3ds",
                        },
                        Palette: {
                            Tooltip: "TEST VBSP ITEM",
                            Image: "palette/test/test_item.png",
                            Position: "0 0 0",
                        },
                    },
                },
                Exporting: {
                    Instances: {
                        0: {
                            Name: "instances/test_instance1.vmf",
                            EntityCount: 5,
                            BrushCount: 10,
                            BrushSideCount: 20,
                        },
                    },
                },
            },
        }

        fs.writeFileSync(
            path.join(testItemPath, "editoritems.json"),
            JSON.stringify(initialEditorItems, null, 2),
        )

        // Create properties.json
        const properties = {
            Properties: {
                Name: "Test VBSP Item",
                Author: "Test Author",
                Description: "A test item with VBSP instances",
            },
        }

        fs.writeFileSync(
            path.join(testItemPath, "properties.json"),
            JSON.stringify(properties, null, 2),
        )

        // Create VBSP config with the same instance plus a new one
        const vbspConfig = {
            Changeinstance: [
                "instances/test_instance1.vmf",
                "instances/test_instance2.vmf",
            ],
        }

        fs.writeFileSync(
            path.join(testItemPath, "vbsp_config.json"),
            JSON.stringify(vbspConfig, null, 2),
        )

        // Load the item, and register its VBSP instances as loading its
        // package does
        const item = new Item({ packagePath: testPackagePath, itemJSON })
        item.autoImportVBSPInstances()

        // Verify that editoritems.json was updated correctly
        const updatedEditorItems = JSON.parse(
            fs.readFileSync(
                path.join(testItemPath, "editoritems.json"),
                "utf-8",
            ),
        )

        const instances = updatedEditorItems.Item.Exporting.Instances
        const instanceNames = Object.values(instances).map((inst) => inst.Name)

        // Should have both instances
        expect(instanceNames).toContain("instances/test_instance1.vmf")
        expect(instanceNames).toContain("instances/test_instance2.vmf")

        // Should preserve existing VMF stats for the first instance
        const firstInstance = Object.values(instances).find(
            (inst) => inst.Name === "instances/test_instance1.vmf",
        )
        expect(firstInstance.EntityCount).toBe(5)
        expect(firstInstance.BrushCount).toBe(10)
        expect(firstInstance.BrushSideCount).toBe(20)

        // Should have default stats for the new instance
        const secondInstance = Object.values(instances).find(
            (inst) => inst.Name === "instances/test_instance2.vmf",
        )
        expect(secondInstance.EntityCount).toBe(0)
        expect(secondInstance.BrushCount).toBe(0)
        expect(secondInstance.BrushSideCount).toBe(0)
    })

    test("should handle VBSP config with no instances gracefully", () => {
        // Create test item JSON
        const itemJSON = {
            ID: testItemId,
            Version: {
                Styles: {
                    BEE2_CLEAN: "testitem",
                },
            },
        }

        // Create initial editoritems.json
        const initialEditorItems = {
            Item: {
                ItemClass: "ItemBase",
                Type: "TEST_VBSP",
                Editor: {
                    SubType: {
                        Name: "Test VBSP Item",
                        Model: {
                            ModelName: "test_model.3ds",
                        },
                        Palette: {
                            Tooltip: "TEST VBSP ITEM",
                            Image: "palette/test/test_item.png",
                            Position: "0 0 0",
                        },
                    },
                },
            },
        }

        fs.writeFileSync(
            path.join(testItemPath, "editoritems.json"),
            JSON.stringify(initialEditorItems, null, 2),
        )

        // Create properties.json
        const properties = {
            Properties: {
                Name: "Test VBSP Item",
                Author: "Test Author",
                Description: "A test item with VBSP instances",
            },
        }

        fs.writeFileSync(
            path.join(testItemPath, "properties.json"),
            JSON.stringify(properties, null, 2),
        )

        // Create empty VBSP config
        const vbspConfig = {}

        fs.writeFileSync(
            path.join(testItemPath, "vbsp_config.json"),
            JSON.stringify(vbspConfig, null, 2),
        )

        // Load the item and its VBSP instances (this should not crash)
        const item = new Item({ packagePath: testPackagePath, itemJSON })
        item.autoImportVBSPInstances()

        // Verify that editoritems.json was not modified
        const updatedEditorItems = JSON.parse(
            fs.readFileSync(
                path.join(testItemPath, "editoritems.json"),
                "utf-8",
            ),
        )

        expect(updatedEditorItems.Item.Exporting).toBeUndefined()
    })

    test("should handle case-insensitive duplicate detection", () => {
        // Create test item JSON
        const itemJSON = {
            ID: testItemId,
            Version: {
                Styles: {
                    BEE2_CLEAN: "testitem",
                },
            },
        }

        // Create initial editoritems.json with one instance already registered
        const initialEditorItems = {
            Item: {
                ItemClass: "ItemBase",
                Type: "TEST_VBSP",
                Editor: {
                    SubType: {
                        Name: "Test VBSP Item",
                        Model: {
                            ModelName: "test_model.3ds",
                        },
                        Palette: {
                            Tooltip: "TEST VBSP ITEM",
                            Image: "palette/test/test_item.png",
                            Position: "0 0 0",
                        },
                    },
                },
                Exporting: {
                    Instances: {
                        0: {
                            Name: "instances/BEE2/test/instance.vmf",
                            EntityCount: 5,
                            BrushCount: 10,
                            BrushSideCount: 20,
                        },
                    },
                },
            },
        }

        fs.writeFileSync(
            path.join(testItemPath, "editoritems.json"),
            JSON.stringify(initialEditorItems, null, 2),
        )

        // Create properties.json
        const properties = {
            Properties: {
                Name: "Test VBSP Item",
                Author: "Test Author",
                Description: "A test item with VBSP instances",
            },
        }

        fs.writeFileSync(
            path.join(testItemPath, "properties.json"),
            JSON.stringify(properties, null, 2),
        )

        // Create VBSP config with the same instance but different case
        const vbspConfig = {
            Changeinstance: [
                "instances/bee2/test/instance.vmf",
                "instances/BEE2/test/instance.vmf",
            ],
        }

        fs.writeFileSync(
            path.join(testItemPath, "vbsp_config.json"),
            JSON.stringify(vbspConfig, null, 2),
        )

        // Load the item, and register its VBSP instances as loading its
        // package does
        const item = new Item({ packagePath: testPackagePath, itemJSON })
        item.autoImportVBSPInstances()

        // Verify that editoritems.json was updated correctly
        const updatedEditorItems = JSON.parse(
            fs.readFileSync(
                path.join(testItemPath, "editoritems.json"),
                "utf-8",
            ),
        )

        const instances = updatedEditorItems.Item.Exporting.Instances
        const instanceNames = Object.values(instances).map((inst) => inst.Name)

        // Should only have one instance (the original one) since the second is a case-insensitive duplicate
        expect(instanceNames.length).toBe(1)
        expect(instanceNames).toContain("instances/BEE2/test/instance.vmf")

        // Should preserve existing VMF stats
        const firstInstance = Object.values(instances).find(
            (inst) => inst.Name === "instances/BEE2/test/instance.vmf",
        )
        expect(firstInstance.EntityCount).toBe(5)
        expect(firstInstance.BrushCount).toBe(10)
        expect(firstInstance.BrushSideCount).toBe(20)
    })
})
