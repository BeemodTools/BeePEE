jest.mock("electron", () => ({
    app: { isPackaged: false, getPath: () => require("os").tmpdir() },
    dialog: { showMessageBox: jest.fn(async () => ({ response: 0 })) },
    ipcMain: { handle() {}, on() {} },
}))
// Not the project's packages folder (the dev app's)
jest.mock("../utils/packagesDir", () => {
    const os = require("os")
    const path = require("path")
    const dir = require("fs").mkdtempSync(
        path.join(os.tmpdir(), "beepee-packages-"),
    )
    return { getPackagesDir: () => dir, ensurePackagesDir: () => {} }
})
jest.mock("../utils/crashReportConfig", () => ({
    getCrashReportEndpoint: () => "https://reports.example/report",
    getSalt: () => "test-salt",
}))
// The real .env stays unread
jest.mock("dotenv", () => ({ config: () => ({}) }))
jest.mock("../items/itemEditor", () => ({
    closeAllWindows: async () => {},
    createCrashReportWindow: jest.fn(),
}))

const fs = require("fs")
const os = require("os")
const path = require("path")
const { execFileSync } = require("child_process")
const { path7za } = require("7zip-bin")
const { dialog } = require("electron")
const { createCrashReportWindow } = require("../items/itemEditor")
const {
    loadPackage,
    importPackage,
    getFailedPackage,
    reportFailedPackage,
    showPackageOpenError,
    setMainWindow,
} = require("../packageManager")
const { submitCrashReport } = require("../utils/crashReporter")

describe("a package that fails to open", () => {
    let dir
    let events

    /** A package file made of `files` ({ name: text }) */
    const makePackage = (name, files) => {
        const folder = path.join(dir, `${name}-files`)
        for (const [file, text] of Object.entries(files)) {
            fs.mkdirSync(path.dirname(path.join(folder, file)), {
                recursive: true,
            })
            fs.writeFileSync(path.join(folder, file), text)
        }
        const archive = path.join(dir, name)
        execFileSync(path7za, ["a", "-tzip", archive, path.join(folder, "*")], {
            stdio: "ignore",
        })
        return archive
    }

    /** How it failed to open */
    const failure = async (open) => {
        try {
            await open()
        } catch (error) {
            return error
        }
        throw new Error("it opened")
    }

    /** What submitCrashReport sent */
    const sentReport = async (errorDetails) => {
        let body
        global.fetch = jest.fn(async (url, options) => {
            body = options.body
            return { ok: true }
        })
        const result = await submitCrashReport({
            userDescription: "It won't open",
            errorDetails,
            contact: "",
        })
        expect(result).toEqual({ success: true })
        return body
    }

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-failed-open-"))
        events = []
        setMainWindow({
            isDestroyed: () => false,
            webContents: { send: (channel, data) => events.push({ channel, data }) },
        })
        createCrashReportWindow.mockClear()
        dialog.showMessageBox.mockClear()
    })

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true })
        delete global.fetch
    })

    test("is remembered, and the loading popup can report it", async () => {
        const bpee = makePackage("broken.bpee", { "info.json": "{ not json" })
        const error = await failure(() => loadPackage(bpee))

        expect(error.failureId).toMatch(/^failure_\d+$/)
        expect(getFailedPackage(error.failureId)).toMatchObject({
            source: bpee,
            message: error.message,
        })
        const popup = events
            .filter(({ channel }) => channel === "package-loading-progress")
            .pop().data
        expect(popup).toMatchObject({
            progress: 100,
            error: error.message,
            failureId: error.failureId,
        })

        expect(reportFailedPackage(error.failureId)).toBe(true)
        expect(createCrashReportWindow).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "packageOpenFailed",
                failureId: error.failureId,
                package: "broken.bpee",
                message: error.message,
            }),
            { replace: true },
        )
        expect(reportFailedPackage("failure_unknown")).toBe(false)
    })

    test("is reported with that package, without personal details", async () => {
        const bpee = makePackage("broken.bpee", {
            "info.json": "{ not json",
            "notes.txt": "Made in C:\\Users\\Jane\\Desktop\\pack",
        })
        const error = await failure(() => loadPackage(bpee))

        const body = await sentReport({
            type: "packageOpenFailed",
            failureId: error.failureId,
            message: error.message,
        })
        expect(body.get("packageSkipped")).toBeNull()
        const sent = path.join(dir, "sent.bpee")
        fs.writeFileSync(
            sent,
            Buffer.from(await body.get("package").arrayBuffer()),
        )
        const out = path.join(dir, "sent")
        execFileSync(path7za, ["x", "-y", `-o${out}`, sent], { stdio: "ignore" })
        expect(fs.readFileSync(path.join(out, "info.json"), "utf8")).toBe(
            "{ not json",
        )
        expect(fs.readFileSync(path.join(out, "notes.txt"), "utf8")).toBe(
            "Made in C:\\Users\\<user>\\Desktop\\pack",
        )
    })

    test("that isn't an archive is reported without it, saying why", async () => {
        const file = path.join(dir, "broken.bee_pack")
        fs.writeFileSync(file, "not a zip")
        const error = await failure(() => importPackage(file))

        const body = await sentReport({
            type: "packageOpenFailed",
            failureId: error.failureId,
            message: error.message,
        })
        expect(body.get("package")).toBeNull()
        expect(body.get("packageSkipped")).toMatch(/Failed to create package ZIP/)
    })

    test("can be reported from its error box", async () => {
        const bpee = makePackage("broken.bpee", { "info.json": "{ not json" })
        const error = await failure(() => loadPackage(bpee))

        dialog.showMessageBox.mockResolvedValueOnce({ response: 1 })
        await showPackageOpenError(null, "Open Failed", error.message, error)
        expect(dialog.showMessageBox.mock.calls[0][0].buttons).toEqual([
            "OK",
            "Report",
        ])
        expect(createCrashReportWindow).toHaveBeenCalledTimes(1)

        // An error that isn't a package failing to open: OK only
        await showPackageOpenError(null, "Open Failed", "Disk full", new Error())
        expect(dialog.showMessageBox.mock.calls[1][0].buttons).toEqual(["OK"])
    })
})
