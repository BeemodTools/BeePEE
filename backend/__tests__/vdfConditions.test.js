jest.mock("electron", () => ({
    app: { isPackaged: false, getPath: () => require("os").tmpdir() },
    dialog: {},
    ipcMain: { handle() {}, on() {} },
}))

const fs = require("fs")
const os = require("os")
const path = require("path")
const { processVdfFiles, convertJsonToVdf } = require("../packageManager")

describe("condition flags in VDF files", () => {
    let dir

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-vdf-flags-"))
    })

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true })
    })

    /** Convert an info.txt to JSON as an import does */
    const importInfo = (text) => {
        fs.writeFileSync(path.join(dir, "info.txt"), text)
        processVdfFiles(dir)
        return JSON.parse(fs.readFileSync(path.join(dir, "info.json"), "utf8"))
    }

    const INFO = [
        '"ID" "TEST"',
        '"Widget"',
        "\t{",
        '\t"Tooltip" "Make pellets pass through gratings."',
        '\t"Tooltip" "让高能球穿过格栅。" [lang_zh]',
        "\t}",
        '"Description"',
        "\t{",
        '\t"" "English line"',
        '\t"" "中文" [lang_zh]',
        "\t}",
        '"Block" [!lang_zh] // only when not Chinese',
        "\t{",
        '\t"Key" "Value"',
        "\t}",
    ].join("\r\n")

    test("are read (BEE2's translated tooltips used to fail the import)", () => {
        const info = importInfo(INFO)
        expect(info.Widget.Tooltip).toBe("Make pellets pass through gratings.")
        expect(info.Widget["Tooltip [lang_zh]"]).toBe("让高能球穿过格栅。")
        expect(info["Block [!lang_zh]"]).toEqual({ Key: "Value" })
    })

    test("are written back after their values when exported", () => {
        const vdf = convertJsonToVdf(importInfo(INFO))
        expect(vdf).toContain('\t"Tooltip" "让高能球穿过格栅。" [lang_zh]\n')
        expect(vdf).toContain('\t"" "中文" [lang_zh]\n')
        expect(vdf).toContain('"Block" [!lang_zh]\n{\n')
        expect(vdf).toContain(
            '\t"Tooltip" "Make pellets pass through gratings."\n',
        )
    })
})
