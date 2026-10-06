const fs = require("fs")
const os = require("os")
const path = require("path")
const crypto = require("crypto")

// BeePEE's settings, in a folder of the test's own
let mockUserData
jest.mock("electron", () => ({
    app: { getPath: () => mockUserData },
}))

// What reading the PC's ID gives: the real one, or a mocked one
let mockReadPcId = null
jest.mock("child_process", () => {
    const actual = jest.requireActual("child_process")
    return {
        ...actual,
        execFileSync: (...args) =>
            mockReadPcId ? mockReadPcId(...args) : actual.execFileSync(...args),
    }
})

const platform = process.platform
const setPlatform = (value) =>
    Object.defineProperty(process, "platform", { value, configurable: true })

/** getMachineId from a fresh copy of the module, as when BeePEE starts */
const freshMachineId = () => {
    let id
    jest.isolateModules(() => {
        id = require("../utils/machineId").getMachineId()
    })
    return id
}

describe("BeePEE's ID for the PC", () => {
    beforeEach(() => {
        mockUserData = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-machine-id-"))
        mockReadPcId = null
    })

    afterEach(() => {
        setPlatform(platform)
        fs.rmSync(mockUserData, { recursive: true, force: true })
    })

    test("is 16 hex characters, the same every time", () => {
        const id = freshMachineId()
        expect(id).toMatch(/^[0-9a-f]{16}$/)
        expect(freshMachineId()).toBe(id)
    })

    test("is a hash of Windows' MachineGuid, not the MachineGuid", () => {
        setPlatform("win32")
        const guid = "0b6f3c2e-1a2b-4c3d-8e9f-001122334455"
        mockReadPcId = () =>
            `\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    ${guid}\r\n\r\n`
        const id = freshMachineId()
        expect(id).toBe(
            crypto
                .createHash("sha256")
                .update(`beepee-machine-id:${guid}`)
                .digest("hex")
                .slice(0, 16),
        )
        expect(guid).not.toContain(id)
    })

    test("is made from a random seed kept in the settings when the PC's ID can't be read", () => {
        setPlatform("win32")
        mockReadPcId = () => {
            throw new Error("reg.exe isn't there")
        }
        const id = freshMachineId()
        expect(id).toMatch(/^[0-9a-f]{16}$/)
        const settings = JSON.parse(
            fs.readFileSync(path.join(mockUserData, "settings.json"), "utf8"),
        )
        expect(settings.machineIdSeed).toEqual(expect.any(String))
        // The same after BeePEE starts again
        expect(freshMachineId()).toBe(id)
    })
})
