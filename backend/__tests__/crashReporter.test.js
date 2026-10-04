jest.mock("electron", () => ({
    app: { isPackaged: false, getPath: () => require("os").tmpdir() },
}))
jest.mock("../packageManager", () => ({
    getCurrentPackageDir: jest.fn(),
    savePackageAsBpee: jest.fn(),
}))

const fs = require("fs")
const os = require("os")
const path = require("path")

describe("crash reports leave out the user's name", () => {
    let redactUserName
    let redactFolder
    const env = { ...process.env }

    beforeAll(() => {
        // A user whose folder name has a space
        jest.spyOn(os, "homedir").mockReturnValue("C:\\Users\\Jane Doe")
        jest.spyOn(os, "userInfo").mockReturnValue({ username: "jdoe" })
        process.env.USERPROFILE = "C:\\Users\\Jane Doe"
        process.env.USERNAME = "jdoe"
        ;({ redactUserName, redactFolder } = require("../utils/crashReporter"))
    })

    afterAll(() => {
        process.env = env
        jest.restoreAllMocks()
    })

    test("takes the user's folder out of Windows paths", () => {
        expect(
            redactUserName(
                "Loading package C:\\Users\\Jane Doe\\Desktop\\pack.bpee",
            ),
        ).toBe("Loading package C:\\Users\\<user>\\Desktop\\pack.bpee")
        expect(redactUserName("c:/users/jane doe/AppData/Roaming")).toBe(
            "c:/users/<user>/AppData/Roaming",
        )
    })

    test("also in JSON, where backslashes are doubled", () => {
        const json = JSON.stringify({
            stack: "Error: boom\n    at C:\\Users\\Jane Doe\\app\\main.js:1:2",
        })
        const redacted = redactUserName(json)
        expect(redacted).not.toMatch(/Jane/)
        expect(JSON.parse(redacted).stack).toBe(
            "Error: boom\n    at C:\\Users\\<user>\\app\\main.js:1:2",
        )
    })

    test("takes out other users' folders, short names and file URLs", () => {
        expect(redactUserName("C:\\Users\\JANEDO~1\\AppData\\Local\\Temp")).toBe(
            "C:\\Users\\<user>\\AppData\\Local\\Temp",
        )
        expect(redactUserName("C:\\Users\\Someone\\Documents")).toBe(
            "C:\\Users\\<user>\\Documents",
        )
        expect(redactUserName("file:///C:/Users/Jane%20Doe/x.png")).toBe(
            "file:///C:/Users/<user>/x.png",
        )
        expect(redactUserName("/home/jdoe/.config and /Users/jane/Library")).toBe(
            "/home/<user>/.config and /Users/<user>/Library",
        )
    })

    test("leaves the rest of the text as it is", () => {
        const text =
            "Users can pick D:\\SteamLibrary\\steamapps\\common\\Portal 2 (portal2/bee2)"
        expect(redactUserName(text)).toBe(text)
        expect(redactUserName("")).toBe("")
    })

    test("takes the user's name out of a package's text files only", () => {
        const folder = fs.mkdtempSync(path.join(os.tmpdir(), "redact-"))
        try {
            const stamp = path.join(folder, ".bpee", "item", "source.json")
            fs.mkdirSync(path.dirname(stamp), { recursive: true })
            fs.writeFileSync(
                stamp,
                JSON.stringify({ vmf: "C:\\Users\\Jane Doe\\pack\\item_0.vmf" }),
            )
            // Binary files (NUL bytes) aren't touched
            const binary = Buffer.concat([
                Buffer.from([0, 1, 2]),
                Buffer.from("C:\\Users\\Jane Doe\\x"),
            ])
            fs.writeFileSync(path.join(folder, "model.mdl"), binary)

            redactFolder(folder)

            expect(JSON.parse(fs.readFileSync(stamp, "utf8")).vmf).toBe(
                "C:\\Users\\<user>\\pack\\item_0.vmf",
            )
            expect(fs.readFileSync(path.join(folder, "model.mdl"))).toEqual(
                binary,
            )
        } finally {
            fs.rmSync(folder, { recursive: true, force: true })
        }
    })
})
