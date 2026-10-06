const fs = require("fs")
const os = require("os")
const path = require("path")
const crypto = require("crypto")

// BeePEE's settings, in a folder of the test's own
let mockUserData
jest.mock("electron", () => ({
    app: { isPackaged: false, getPath: () => mockUserData },
}))

// The real .env stays unread: SALT is the test's
let mockSalt = null
jest.mock("dotenv", () => ({ config: () => ({}) }))
jest.mock("../utils/crashReportConfig", () => ({
    getSalt: () => mockSalt,
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
    const envSalt = process.env.SALT

    beforeEach(() => {
        mockUserData = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-machine-id-"))
        mockReadPcId = null
        mockSalt = "test-salt"
        delete process.env.SALT
    })

    afterEach(() => {
        setPlatform(platform)
        fs.rmSync(mockUserData, { recursive: true, force: true })
        if (envSalt === undefined) delete process.env.SALT
        else process.env.SALT = envSalt
    })

    test("is 16 hex characters, the same every time", () => {
        const id = freshMachineId()
        expect(id).toMatch(/^[0-9a-f]{16}$/)
        expect(freshMachineId()).toBe(id)
    })

    test("is a hash of Windows' MachineGuid with the SALT, not the MachineGuid", () => {
        setPlatform("win32")
        const guid = "0b6f3c2e-1a2b-4c3d-8e9f-001122334455"
        mockReadPcId = () =>
            `\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    ${guid}\r\n\r\n`
        const id = freshMachineId()
        expect(id).toBe(
            crypto
                .createHash("sha256")
                .update(`test-salt:${guid}`)
                .digest("hex")
                .slice(0, 16),
        )
        expect(guid).not.toContain(id)
        // Another SALT, another ID
        mockSalt = "another-salt"
        expect(freshMachineId()).not.toBe(id)
    })

    test("takes the SALT from the environment in a dev run (.env)", () => {
        mockSalt = null
        process.env.SALT = "dev-salt"
        expect(freshMachineId()).toMatch(/^[0-9a-f]{16}$/)
    })

    test("is none without a SALT", () => {
        mockSalt = null
        expect(freshMachineId()).toBeNull()
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
