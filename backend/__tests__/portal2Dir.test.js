jest.mock("electron", () => ({ app: { isPackaged: false } }))

const fs = require("fs")
const os = require("os")
const path = require("path")
const { withRealCase } = require("../data")

describe("the Portal 2 folder's path", () => {
    let dir

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-case-"))
    })

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true })
    })

    test("is written as the disk has it, not as Steam's registry does", () => {
        const real = path.join(fs.realpathSync.native(dir), "Steam", "Portal 2")
        fs.mkdirSync(real, { recursive: true })
        // Windows paths ignore case: the lowercase one is the same folder
        if (process.platform === "win32") {
            expect(withRealCase(real.toLowerCase())).toBe(real)
        }
        expect(withRealCase(real)).toBe(real)
    })

    test("has a capital drive letter even when it isn't there", () => {
        if (process.platform !== "win32") return
        expect(withRealCase("c:\\no such folder\\Portal 2")).toBe(
            "C:\\no such folder\\Portal 2",
        )
    })
})
