const fs = require("fs")
const { Instance } = require("../items/Instance")

// Mock fs and vdf-parser
jest.mock("fs")
jest.mock("vdf-parser", () => ({
    parse: jest.fn(),
}))

const vdf = require("vdf-parser")

describe("Instance VMF Parsing", () => {
    const mockInstancePath = "/test/path/instance.vmf"

    beforeEach(() => {
        jest.clearAllMocks()
    })

    describe("VMF Content Cleaning", () => {
        test("should clean malformed empty quotes", () => {
            const instance = new Instance(mockInstancePath)

            const malformedContent = `
"world"
{
    "id" "1"
    "classname" "worldspawn"
    "" ""
    "entity"
    {
        "id" "2"
        "classname" "func_button"
        "targetname" "button_1"
        "" ""
    }
}
`

            const cleanedContent = instance.cleanVmfContent(malformedContent)

            // Should remove empty quote lines
            expect(cleanedContent).not.toContain('"" ""')
            expect(cleanedContent).toContain("func_button")
            expect(cleanedContent).toContain("button_1")
        })

        test("should handle various empty quote patterns", () => {
            const instance = new Instance(mockInstancePath)

            const malformedContent = `
"entity"
{
    "" ""
    "  " "  "
    '' ''
    "classname" "func_door"
}
`

            const cleanedContent = instance.cleanVmfContent(malformedContent)

            expect(cleanedContent).not.toContain('"" ""')
            expect(cleanedContent).not.toContain("'' ''")
            expect(cleanedContent).toContain("func_door")
        })

        test("should normalize line endings", () => {
            const instance = new Instance(mockInstancePath)

            const contentWithCRLF = "line1\r\nline2\r\nline3"
            const cleanedContent = instance.cleanVmfContent(contentWithCRLF)

            // Should convert CRLF to LF
            expect(cleanedContent).not.toContain("\r\n")
            expect(cleanedContent).toContain("\n")
        })

        test("should remove trailing commas", () => {
            const instance = new Instance(mockInstancePath)

            const contentWithCommas = `{
    "key1" "value1",
    "key2" "value2",
}`

            const cleanedContent = instance.cleanVmfContent(contentWithCommas)

            // Should remove trailing commas before closing braces
            expect(cleanedContent).toContain('"value1"}')
            expect(cleanedContent).toContain('"value2"}')
        })
    })

    describe("Entity Parsing", () => {
        test("should parse entities successfully with cleaned content", () => {
            const mockVmfContent = `
"world"
{
    "entity"
    {
        "classname" "func_button"
        "targetname" "button_1"
    }
    "entity"
    {
        "classname" "func_door"
        "targetname" "door_1"
    }
}
`

            const mockParsedData = {
                world: {
                    entity: [
                        {
                            classname: "func_button",
                            targetname: "button_1",
                        },
                        {
                            classname: "func_door",
                            targetname: "door_1",
                        },
                    ],
                },
            }

            fs.readFileSync.mockReturnValue(mockVmfContent)
            vdf.parse.mockReturnValue(mockParsedData)

            const instance = new Instance(mockInstancePath)
            const entities = instance.getAllEntities()

            expect(entities).toEqual({
                button_1: "func_button",
                door_1: "func_door",
            })
        })

        test("should handle malformed VMF content gracefully", () => {
            const malformedContent = `
"world"
{
    "" ""
    "entity"
    {
        "classname" "func_button"
        "targetname" "button_1"
        "" ""
    }
}
`

            const expectedParsedData = {
                world: {
                    entity: {
                        classname: "func_button",
                        targetname: "button_1",
                    },
                },
            }

            fs.readFileSync.mockReturnValue(malformedContent)
            vdf.parse.mockReturnValue(expectedParsedData)

            const instance = new Instance(mockInstancePath)
            const entities = instance.getAllEntities()

            // Should clean content before parsing
            expect(vdf.parse).toHaveBeenCalledWith(
                expect.not.stringContaining('"" ""'),
            )

            expect(entities).toEqual({
                button_1: "func_button",
            })
        })

        test("should return empty object on parsing errors", () => {
            const malformedContent = "invalid vmf content"

            fs.readFileSync.mockReturnValue(malformedContent)
            vdf.parse.mockImplementation(() => {
                throw new Error('VDF.parse: invalid syntax on line 270: "" ""')
            })

            const instance = new Instance(mockInstancePath)
            const entities = instance.getAllEntities()

            expect(entities).toEqual({})
        })

        test("should handle nested entity structures", () => {
            const mockVmfContent = `
"world"
{
    "entity"
    {
        "classname" "func_button"
        "targetname" "button_1"
    }
    "group"
    {
        "entity"
        {
            "classname" "func_door"
            "targetname" "door_1"
        }
    }
}
`

            const mockParsedData = {
                world: {
                    entity: {
                        classname: "func_button",
                        targetname: "button_1",
                    },
                    group: {
                        entity: {
                            classname: "func_door",
                            targetname: "door_1",
                        },
                    },
                },
            }

            fs.readFileSync.mockReturnValue(mockVmfContent)
            vdf.parse.mockReturnValue(mockParsedData)

            const instance = new Instance(mockInstancePath)
            const entities = instance.getAllEntities()

            expect(entities).toEqual({
                button_1: "func_button",
                door_1: "func_door",
            })
        })

        test("should handle entities without targetname", () => {
            const mockVmfContent = `
"world"
{
    "entity"
    {
        "classname" "worldspawn"
    }
    "entity"
    {
        "classname" "func_button"
        "targetname" "button_1"
    }
}
`

            const mockParsedData = {
                world: {
                    entity: [
                        {
                            classname: "worldspawn",
                        },
                        {
                            classname: "func_button",
                            targetname: "button_1",
                        },
                    ],
                },
            }

            fs.readFileSync.mockReturnValue(mockVmfContent)
            vdf.parse.mockReturnValue(mockParsedData)

            const instance = new Instance(mockInstancePath)
            const entities = instance.getAllEntities()

            // Should only include entities with both classname and targetname
            expect(entities).toEqual({
                button_1: "func_button",
            })
        })
    })

    describe("Error Handling", () => {
        test("should provide helpful error messages", () => {
            const consoleSpy = jest.spyOn(console, "error").mockImplementation()

            fs.readFileSync.mockReturnValue("invalid content")
            vdf.parse.mockImplementation(() => {
                throw new Error('VDF.parse: invalid syntax on line 270: "" ""')
            })

            const instance = new Instance(mockInstancePath)
            instance.getAllEntities()

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining(`Failed to parse VMF file`),
                expect.objectContaining({
                    message: expect.stringContaining(
                        "VDF.parse: invalid syntax",
                    ),
                }),
            )

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining(
                    "The VMF file may have malformed syntax",
                ),
            )

            consoleSpy.mockRestore()
        })

        test("should handle file read errors", () => {
            const consoleSpy = jest.spyOn(console, "error").mockImplementation()

            fs.readFileSync.mockImplementation(() => {
                throw new Error("File not found")
            })

            const instance = new Instance(mockInstancePath)
            const entities = instance.getAllEntities()

            expect(entities).toEqual({})
            expect(consoleSpy).toHaveBeenCalled()

            consoleSpy.mockRestore()
        })
    })
})
