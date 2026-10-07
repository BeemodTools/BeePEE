// File > Export to BeePM: exports the package and hands it to BeePM with a
// beepm://publish link, or offers BeePM's GitHub when BeePM isn't installed
const mockOpenExternal = jest.fn(async () => {})
const mockShowMessageBox = jest.fn(async () => ({ response: 0 }))
const mockShowErrorBox = jest.fn()
const mockExport = jest.fn(async () => {})
const mockBackup = jest.fn(async () => {})
// What Windows says opens beepm:// links ("" when nothing does)
let mockBeePmHandler = ""
let mockUserData = null
let mockPackageDir = null

jest.mock("electron", () => ({
    Menu: {
        buildFromTemplate: (template) => ({ template }),
        setApplicationMenu: () => {},
        getApplicationMenu: () => null,
    },
    shell: {
        openExternal: (...args) => mockOpenExternal(...args),
        showItemInFolder: () => {},
    },
    app: {
        isPackaged: false,
        getPath: () => mockUserData,
        getApplicationNameForProtocol: (url) =>
            url === "beepm://" ? mockBeePmHandler : "",
    },
    dialog: {
        showMessageBox: (...args) => mockShowMessageBox(...args),
        showErrorBox: (...args) => mockShowErrorBox(...args),
    },
    BrowserWindow: { getAllWindows: () => [] },
}))
jest.mock("../packageManager", () => ({
    loadPackage: jest.fn(),
    importPackage: jest.fn(),
    savePackageAsBpee: (...args) => mockBackup(...args),
    exportPackageAsBeePack: (...args) => mockExport(...args),
    clearPackagesDirectory: jest.fn(),
    closePackage: jest.fn(),
    getCurrentPackageDir: () => mockPackageDir,
    getCurrentPackageSourcePath: () => null,
    getLastSavedBpeePath: () => null,
    setLastSavedBpeePath: () => {},
    showPackageOpenError: jest.fn(),
}))
jest.mock("../items/itemEditor", () => ({
    createPackageCreationWindow: jest.fn(),
    createPackageInformationWindow: jest.fn(),
    createChangelogWindow: jest.fn(),
    createCrashReportWindow: jest.fn(),
    createBeePackageWindow: jest.fn(),
    createSettingsWindow: jest.fn(),
}))
jest.mock("../utils/packagesDir", () => ({ ensurePackagesDir: () => {} }))
let mockBackupSetting = false
jest.mock("../utils/settings", () => ({
    getSetting: (key, fallback) =>
        key === "autoBackupBeforeExport" ? mockBackupSetting : fallback,
}))

const fs = require("fs")
const os = require("os")
const path = require("path")
const { createMainMenu } = require("../menu")
const { BEEPM_DOWNLOAD_URL } = require("../utils/beePmApp")

describe("Export to BeePM", () => {
    let dir
    let fileMenu

    /** Click File > Export to BeePM... */
    const exportToBeePm = () =>
        fileMenu.find((item) => item.id === "export-beepm").click()

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-export-beepm-"))
        mockUserData = path.join(dir, "userData")
        mockPackageDir = path.join(dir, "packages", "BETTER_UNDERGROUND_A1B2")
        fs.mkdirSync(mockPackageDir, { recursive: true })
        fs.writeFileSync(
            path.join(mockPackageDir, "info.json"),
            JSON.stringify({ ID: "BETTER_UNDERGROUND_A1B2", Name: "Better Underground Assets" }),
        )
        mockBeePmHandler = "BeePM"
        mockBackupSetting = false
        for (const mock of [mockOpenExternal, mockShowMessageBox, mockShowErrorBox, mockExport, mockBackup]) {
            mock.mockClear()
        }
        fileMenu = createMainMenu({
            webContents: { send: () => {} },
            isDestroyed: () => false,
        }).template.find((menu) => menu.label === "File").submenu
    })

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true })
    })

    test("is in File, after Export Package", () => {
        const labels = fileMenu.map((item) => item.label)
        expect(labels.indexOf("Export to BeePM...")).toBe(
            labels.indexOf("Export Package...") + 1,
        )
    })

    test("exports the package and opens it in BeePM's Publish", async () => {
        await exportToBeePm()

        const filePath = path.join(
            mockUserData,
            "beepm",
            "Better Underground Assets.bee_pack",
        )
        expect(mockExport).toHaveBeenCalledWith(mockPackageDir, filePath)
        expect(mockOpenExternal).toHaveBeenCalledTimes(1)

        // Read the way BeePM reads it: an absolute path to one .bee_pack
        const link = new URL(mockOpenExternal.mock.calls[0][0])
        expect(link.protocol).toBe("beepm:")
        expect(link.hostname).toBe("publish")
        const file = link.searchParams.get("file")
        expect(file).toBe(filePath)
        expect(path.isAbsolute(file) && /\.bee_pack$/i.test(file)).toBe(true)
        expect(mockShowMessageBox).not.toHaveBeenCalled()
    })

    test("backs the package up first when that's on", async () => {
        mockBackupSetting = true
        await exportToBeePm()
        expect(mockBackup).toHaveBeenCalledWith(
            mockPackageDir,
            expect.stringMatching(/Better Underground Assets-.*\.bpee$/),
        )
        expect(mockBackup.mock.invocationCallOrder[0]).toBeLessThan(
            mockExport.mock.invocationCallOrder[0],
        )
    })

    test("doesn't open BeePM when the export fails", async () => {
        mockExport.mockRejectedValueOnce(new Error("7zip failed"))
        await exportToBeePm()
        expect(mockOpenExternal).not.toHaveBeenCalled()
    })

    test("says where the package is when BeePM won't open", async () => {
        mockOpenExternal.mockRejectedValueOnce(new Error("No app"))
        await exportToBeePm()
        expect(mockShowErrorBox).toHaveBeenCalledWith(
            "Failed to Open BeePM",
            expect.stringContaining("Better Underground Assets.bee_pack"),
        )
    })

    test("without BeePM, offers its GitHub instead of exporting", async () => {
        mockBeePmHandler = ""
        await exportToBeePm()

        expect(mockShowMessageBox.mock.calls[0][1]).toMatchObject({
            message: "BeePM isn't installed.",
            buttons: ["Open GitHub", "Cancel"],
        })
        expect(mockOpenExternal).toHaveBeenCalledWith(BEEPM_DOWNLOAD_URL)
        expect(BEEPM_DOWNLOAD_URL).toBe(
            "https://github.com/BeemodTools/BeePM/releases/latest",
        )
        expect(mockExport).not.toHaveBeenCalled()

        // Cancel: nothing opens
        mockOpenExternal.mockClear()
        mockShowMessageBox.mockResolvedValueOnce({ response: 1 })
        await exportToBeePm()
        expect(mockOpenExternal).not.toHaveBeenCalled()
        expect(mockExport).not.toHaveBeenCalled()
    })
})
