jest.mock("electron", () => ({
    app: { isPackaged: false, getPath: () => require("os").tmpdir() },
    dialog: {},
    ipcMain: { handle() {}, on() {} },
}))

const fs = require("fs")
const os = require("os")
const path = require("path")
const { execFileSync } = require("child_process")
const { path7za } = require("7zip-bin")
const { exportPackageAsBeePack } = require("../packageManager")

describe("an exported package", () => {
    let dir

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-export-"))
    })

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true })
    })

    test("leaves out Hammer's backups of the VMFs saved in it", async () => {
        const packageDir = path.join(dir, "package")
        const instances = path.join(packageDir, "resources", "instances", "x")
        fs.mkdirSync(instances, { recursive: true })
        fs.writeFileSync(path.join(packageDir, "info.json"), '{ "ID": "X" }')
        fs.writeFileSync(path.join(instances, "a.vmf"), "world {}")
        fs.writeFileSync(path.join(instances, "a.vmx"), "world {}")
        fs.writeFileSync(path.join(instances, "B.VMX"), "world {}")

        const output = path.join(dir, "x.bee_pack")
        await exportPackageAsBeePack(packageDir, output)

        const listing = execFileSync(path7za, ["l", "-ba", output], {
            encoding: "utf8",
        })
        expect(listing).toMatch(/a\.vmf/)
        expect(listing).not.toMatch(/\.vmx/i)
    })
})
