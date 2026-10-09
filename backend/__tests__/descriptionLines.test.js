jest.mock("electron", () => ({
    app: { isPackaged: false, getPath: () => require("os").tmpdir() },
    dialog: {},
    ipcMain: { handle() {}, on() {} },
}))

const { descriptionValue } = require("../saveItem")

describe("a description's lines", () => {
    test("show in BEE2 as they're typed: each on its own line, empty lines a gap", () => {
        expect(
            descriptionValue(
                [
                    "An item to control the player's portals.",
                    "**ONLY THE FIRST TWO COLOR SLOTS ARE USED**",
                    "",
                    "DEFAULT COLORS:",
                    "Portal 1: #0272d2 (blue)",
                    "Portal 2: #fc8300 (orange)",
                    "",
                    "Powered by PairShift.",
                ].join("\n"),
            ),
        ).toEqual({
            desc_0: "An item to control the player's portals.  ",
            desc_1: "**ONLY THE FIRST TWO COLOR SLOTS ARE USED**",
            desc_2: "",
            desc_3: "DEFAULT COLORS:  ",
            desc_4: "Portal 1: #0272d2 (blue)  ",
            desc_5: "Portal 2: #fc8300 (orange)",
            desc_6: "",
            desc_7: "Powered by PairShift.",
        })
    })

    test("keep the line breaks they have, so saving again changes nothing", () => {
        const once = descriptionValue("One\r\nTwo  \nThree\\\nFour")
        expect(once).toEqual({
            desc_0: "One  ",
            desc_1: "Two  ",
            desc_2: "Three\\",
            desc_3: "Four",
        })
        expect(descriptionValue(Object.values(once).join("\n"))).toEqual(once)
    })

    test("of one line, stay as they are", () => {
        expect(descriptionValue("Just one")).toBe("Just one")
        expect(descriptionValue(undefined)).toBeUndefined()
    })
})
