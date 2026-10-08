jest.mock("electron", () => ({ app: {}, shell: {} }))

const fs = require("fs")
const os = require("os")
const path = require("path")
const {
    iniValue,
    bee2PackagesDir,
    bee2ExportFolder,
} = require("../utils/bee2Packages")

describe("where Launch BEEMod after export puts a package", () => {
    let appData
    let env
    const beemodPath = path.join(os.tmpdir(), "BEE2")

    /** BEE2's config.cfg with this [Directories] section */
    const bee2Config = (lines) => {
        const file = path.join(appData, "BEEMOD2", "config", "config.cfg")
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, ["[Directories]", ...lines, ""].join("\r\n"))
    }

    beforeEach(() => {
        appData = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-appdata-"))
        env = { APPDATA: appData }
    })

    afterEach(() => {
        fs.rmSync(appData, { recursive: true, force: true })
    })

    test("reads config.cfg the way BEE2 writes it", () => {
        const text = [
            "[General]",
            "package = not this one",
            "[Directories]",
            "package = D:\\BEE2\\packages",
            "backup_loc=backups/",
            "",
        ].join("\r\n")
        expect(iniValue(text, "directories", "PACKAGE")).toBe(
            "D:\\BEE2\\packages",
        )
        expect(iniValue(text, "Directories", "backup_loc")).toBe("backups/")
        expect(iniValue("[Directories]\npackage: ../packages/", "Directories", "package")).toBe(
            "../packages/",
        )
        expect(iniValue(text, "Directories", "missing")).toBeNull()
    })

    test("is a BeePEE folder in the packages folder BEE2 loads", () => {
        // BEE2's own: relative to its folder
        bee2Config(["package = packages/"])
        expect(bee2ExportFolder(beemodPath, env)).toBe(
            path.join(beemodPath, "packages", "BeePEE"),
        )

        const elsewhere = path.join(appData, "my packages")
        bee2Config([`package = ${elsewhere}`])
        expect(bee2ExportFolder(beemodPath, env)).toBe(
            path.join(elsewhere, "BeePEE"),
        )

        bee2Config(["package=../packages/"])
        expect(bee2PackagesDir(beemodPath, env)).toBe(
            path.join(beemodPath, "../packages/"),
        )

        // No config.cfg: BEE2's own packages folder
        fs.rmSync(path.join(appData, "BEEMOD2"), { recursive: true })
        expect(bee2ExportFolder(beemodPath, env)).toBe(
            path.join(beemodPath, "packages", "BeePEE"),
        )
    })
})
