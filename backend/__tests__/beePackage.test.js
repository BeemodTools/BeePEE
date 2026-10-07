jest.mock("electron", () => ({ dialog: {}, app: { isPackaged: false } }))
// Not the project's packages folder (the dev app's)
jest.mock("../utils/packagesDir", () => {
    const os = require("os")
    const path = require("path")
    const dir = require("fs").mkdtempSync(
        path.join(os.tmpdir(), "beepee-bee-package-"),
    )
    return { getPackagesDir: () => dir }
})
let mockPackageDir = null
jest.mock("../packageManager", () => ({
    packages: [],
    loadPackage: jest.fn(async () => ({ items: [], signages: [] })),
    getCurrentPackageDir: () => mockPackageDir,
    showPackageOpenError: jest.fn(async () => {}),
}))
jest.mock("../items/itemEditor", () => ({
    createPackageCreationWindow: jest.fn(),
    getCreatePackageWindow: () => null,
}))

const fs = require("fs")
const os = require("os")
const path = require("path")
const {
    beePmName,
    problemWith,
    readBeePackage,
    writeBeePackage,
    searchBeePm,
} = require("../utils/beePackage")
const { getPackagesDir } = require("../utils/packagesDir")
const { register } = require("../handlers/packageHandlers")

const valid = {
    name: "better-underground-assets",
    version: "1.0.0",
    compatibleWith: "",
    dependencies: {},
}

describe("bee-package.json", () => {
    let dir

    /** The package's bee-package.json, parsed */
    const written = () =>
        JSON.parse(fs.readFileSync(path.join(dir, "bee-package.json"), "utf8"))

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-bee-package-"))
    })

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true })
        delete global.fetch
    })

    test("BeePM names come from package names", () => {
        expect(beePmName("Better Underground Assets")).toBe(
            "better-underground-assets",
        )
        expect(beePmName("Areng's Items 2.0")).toBe("arengs-items-2.0")
        expect(beePmName("Ünïcode  Pack!")).toBe("unicode-pack")
        expect(beePmName("  --Cubes & Co.--  ")).toBe("cubes-co")
        expect(beePmName("a".repeat(80))).toBe("a".repeat(64))
        expect(beePmName("!!!")).toBe("")
    })

    test("only takes what BeePM takes", () => {
        expect(problemWith(valid)).toBeNull()
        expect(problemWith({ ...valid, name: "@areng/cubes" })).toBeNull()
        expect(problemWith({ ...valid, version: "2.1.0-beta.1" })).toBeNull()
        expect(
            problemWith({
                ...valid,
                dependencies: {
                    "@areng/cubes": "^1.0.0",
                    // Written the old way (@author/BEE2 ID), and BEE2's own
                    "@Areng14/ARENGS_PACKAGES": "*",
                    "@beemod/BEE2_CLEAN_STYLE": "",
                },
            }),
        ).toBeNull()

        expect(problemWith({ ...valid, name: "" })).toMatch(/name/)
        expect(problemWith({ ...valid, name: "my package" })).toMatch(/name/)
        expect(problemWith({ ...valid, name: "-cubes" })).toMatch(/name/)
        expect(problemWith({ ...valid, version: "v1.0.0" })).toMatch(/version/)
        expect(problemWith({ ...valid, version: "1.0" })).toMatch(/version/)
        // BeePM drops +build, so it won't take it
        expect(problemWith({ ...valid, version: "1.0.0+5" })).toMatch(/version/)
        expect(
            problemWith({ ...valid, dependencies: { cubes: "*" } }),
        ).toMatch(/cubes/)
        expect(
            problemWith({ ...valid, dependencies: { "@beemod/clean style": "*" } }),
        ).toMatch(/clean style/)
        expect(problemWith({ ...valid, dependencies: ["@areng/cubes"] })).toMatch(
            /list of names/,
        )
    })

    test("a package without one gets fields from its name", () => {
        expect(readBeePackage(dir, "Better Underground Assets")).toEqual({
            scope: null,
            name: "better-underground-assets",
            version: "1.0.0",
            compatibleWith: "",
            dependencies: {},
            exists: false,
        })
    })

    test("one older BeePEE wrote gets a BeePM name", () => {
        fs.writeFileSync(
            path.join(dir, "bee-package.json"),
            JSON.stringify({
                id: "BETTER_UNDERGROUND_A1B2",
                name: "Better Underground Assets",
                author: "Areng14",
                version: "1.2.0",
                compatibleWith: ">=2.4.41",
            }),
        )
        expect(readBeePackage(dir, "Something Else")).toEqual({
            scope: null,
            name: "better-underground-assets",
            version: "1.2.0",
            compatibleWith: ">=2.4.41",
            dependencies: {},
            exists: true,
        })

        // Saving drops what BeePM ignores (id) or checks against the
        // publisher (author, a GitHub name here)
        writeBeePackage(dir, readBeePackage(dir))
        expect(written()).toEqual({
            name: "better-underground-assets",
            version: "1.2.0",
            compatibleWith: ">=2.4.41",
        })
    })

    test("keeps its scope and the fields BeePEE doesn't set", () => {
        fs.writeFileSync(
            path.join(dir, "bee-package.json"),
            String.fromCharCode(0xfeff) +
                JSON.stringify({
                    name: "@Areng/Cubes",
                    version: "1.0.0",
                    display_name: "Cubes!",
                    description: "More cubes",
                    compatibleWith: ["2.4.45", "2.4.46.1"],
                    dependencies: { "@beemod/BEE2_CLEAN_STYLE": "*" },
                }),
        )
        const fields = readBeePackage(dir, "Cubes")
        expect(fields).toMatchObject({
            scope: "areng",
            name: "cubes",
            compatibleWith: "2.4.45 || 2.4.46.1",
            dependencies: { "@beemod/BEE2_CLEAN_STYLE": "*" },
        })

        writeBeePackage(dir, {
            ...fields,
            version: "1.1.0",
            compatibleWith: "",
            dependencies: {},
        })
        const text = fs.readFileSync(path.join(dir, "bee-package.json"), "utf8")
        expect(text).toMatch(/^\{\n {4}"name"/)
        expect(text.endsWith("}\n")).toBe(true)
        // No compatibleWith (any BEE2 version) and no dependencies
        expect(written()).toEqual({
            name: "@areng/cubes",
            version: "1.1.0",
            display_name: "Cubes!",
            description: "More cubes",
        })
    })

    test("isn't written with fields BeePM won't take", () => {
        expect(() =>
            writeBeePackage(dir, { ...valid, version: "one" }),
        ).toThrow(/version/)
        expect(fs.existsSync(path.join(dir, "bee-package.json"))).toBe(false)
    })

    test("finds packages in BeePM", async () => {
        global.fetch = jest.fn(async () => ({
            ok: true,
            json: async () => ({
                total: 2,
                packages: [
                    {
                        name: "@areng/better-underground-assets",
                        scope: "areng",
                        displayName: "Better Underground Assets",
                        beeId: "BETTER_UNDERGROUND",
                        latest: "1.0.1",
                    },
                    { name: "cubes", scope: "someone", latest: null },
                ],
            }),
        }))
        await expect(searchBeePm(" under ")).resolves.toEqual([
            {
                name: "@areng/better-underground-assets",
                displayName: "Better Underground Assets",
                latest: "1.0.1",
                beeId: "BETTER_UNDERGROUND",
            },
            {
                name: "@someone/cubes",
                displayName: "@someone/cubes",
                latest: null,
                beeId: null,
            },
        ])
        expect(global.fetch.mock.calls[0][0]).toMatch(
            /\/v1\/packages\?q=under&limit=20$/,
        )

        global.fetch = jest.fn(async () => ({ ok: false, status: 503 }))
        await expect(searchBeePm("")).rejects.toThrow(/503/)
    })
})

describe("a package's information", () => {
    const handlers = {}
    const sent = []
    const env = { ...process.env }
    let beePmHome

    /** Log in to BeePM on this "PC" as handle (the app's login file) */
    const logInToBeePm = (handle) => {
        fs.mkdirSync(path.join(beePmHome, "config"), { recursive: true })
        fs.writeFileSync(
            path.join(beePmHome, "config", "credentials-app.json"),
            JSON.stringify({
                registry: "https://beepm.beemodtools.org",
                user: { handle, displayName: "Areng", role: "user" },
                token: "c2VjcmV0",
                encrypted: true,
            }),
        )
    }

    /** A package's info.json, parsed */
    const infoOf = (packageId) =>
        JSON.parse(
            fs.readFileSync(
                path.join(getPackagesDir(), packageId, "info.json"),
                "utf8",
            ),
        )

    beforeAll(() => {
        register(
            {
                handle: (channel, handler) => (handlers[channel] = handler),
                on: () => {},
            },
            { webContents: { send: (...args) => sent.push(args) } },
        )
    })

    beforeEach(() => {
        // Never the real BeePM login on this PC
        beePmHome = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-beepm-home-"))
        process.env.BEEPM_HOME = beePmHome
    })

    afterEach(() => {
        fs.rmSync(beePmHome, { recursive: true, force: true })
        process.env = { ...env }
    })

    afterAll(() => {
        fs.rmSync(getPackagesDir(), { recursive: true, force: true })
    })

    test("a new one gets its author and bee-package.json", async () => {
        const result = await handlers["create-package"](null, {
            name: "Better Underground Assets",
            description: "Underground stuff",
            author: "  Areng ",
            beePackage: {
                name: "better-underground-assets",
                version: "1.0.0",
                compatibleWith: ">=2.4.46",
                dependencies: { "@areng/cubes": "^1.0.1" },
            },
        })
        expect(result).toEqual({ success: true, packageId: expect.any(String) })
        expect(infoOf(result.packageId).Author).toBe("Areng")

        const packageDir = path.join(getPackagesDir(), result.packageId)
        expect(
            JSON.parse(
                fs.readFileSync(path.join(packageDir, "bee-package.json"), "utf8"),
            ),
        ).toEqual({
            name: "better-underground-assets",
            version: "1.0.0",
            compatibleWith: ">=2.4.46",
            dependencies: { "@areng/cubes": "^1.0.1" },
        })
    })

    test("a new one's author is whoever's logged in to BeePM", async () => {
        logInToBeePm("areng")
        expect(await handlers["get-beepm-handle"]()).toEqual({ handle: "areng" })

        const result = await handlers["create-package"](null, {
            name: "Cubes",
            author: "Someone Else",
            beePackage: { ...valid, name: "cubes" },
        })
        expect(infoOf(result.packageId).Author).toBe("areng")
    })

    test("isn't made without an author, or with wrong BeePM fields", async () => {
        const before = fs.readdirSync(getPackagesDir())
        expect(await handlers["get-beepm-handle"]()).toEqual({ handle: null })
        expect(
            await handlers["create-package"](null, {
                name: "Nobody's",
                author: " ",
                beePackage: valid,
            }),
        ).toMatchObject({ success: false, error: "Author is required" })
        expect(
            await handlers["create-package"](null, {
                name: "Broken",
                author: "Areng",
                beePackage: { ...valid, name: "Not A Name" },
            }),
        ).toMatchObject({ success: false })
        expect(fs.readdirSync(getPackagesDir())).toEqual(before)
    })

    test("is changed in one place, except its author", async () => {
        const { packageId } = await handlers["create-package"](null, {
            name: "Better Underground Assets",
            author: "Areng",
            beePackage: { ...valid },
        })
        mockPackageDir = path.join(getPackagesDir(), packageId)

        const loaded = await handlers["get-package-info"]()
        expect(loaded).toMatchObject({
            success: true,
            info: {
                id: packageId,
                name: "Better Underground Assets",
                author: "Areng",
            },
            beePackage: { name: "better-underground-assets", version: "1.0.0" },
            beePackageExists: true,
        })

        expect(
            await handlers["update-package-info"](null, {
                name: "Better Underground Assets 2",
                description: "More",
                // Set when it was made
                author: "Someone Else",
                beePackage: { ...loaded.beePackage, version: "1.1.0" },
            }),
        ).toEqual({ success: true })
        expect(infoOf(packageId)).toMatchObject({
            Name: "Better Underground Assets 2",
            Desc: "More",
            Author: "Areng",
        })
        expect((await handlers["get-package-info"]()).beePackage.version).toBe(
            "1.1.0",
        )

        // Nothing's written when the BeePM fields are wrong
        expect(
            await handlers["update-package-info"](null, {
                name: "Renamed",
                beePackage: { ...loaded.beePackage, version: "1.0" },
            }),
        ).toEqual({ success: false, error: expect.stringMatching(/version/) })
        expect(infoOf(packageId).Name).toBe("Better Underground Assets 2")
    })
})

describe("the BeePM login on this PC", () => {
    const { beePmHandle, beePmHome } = require("../utils/beePmApp")
    let home

    const write = (file, text) => {
        fs.mkdirSync(path.join(home, "config"), { recursive: true })
        fs.writeFileSync(path.join(home, "config", file), text)
    }

    beforeEach(() => {
        home = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-beepm-login-"))
    })

    afterEach(() => {
        fs.rmSync(home, { recursive: true, force: true })
    })

    test("gives the handle from the app's login, else the CLI's", () => {
        const env = { BEEPM_HOME: home }
        expect(beePmHandle(env)).toBeNull()

        write(
            "credentials.json",
            JSON.stringify({ token: "bpm_x", user: { handle: "cli-user" } }),
        )
        expect(beePmHandle(env)).toBe("cli-user")

        write(
            "credentials-app.json",
            String.fromCharCode(0xfeff) +
                JSON.stringify({
                    token: "x",
                    encrypted: true,
                    user: { handle: "areng" },
                }),
        )
        expect(beePmHandle(env)).toBe("areng")
    })

    test("gives nothing for a login it can't read", () => {
        const env = { BEEPM_HOME: home }
        write("credentials-app.json", "{ not json")
        write(
            "credentials.json",
            JSON.stringify({ user: { handle: "Not A Handle" } }),
        )
        expect(beePmHandle(env)).toBeNull()
    })

    test("is in BeePM's folder in the roaming app data", () => {
        const roaming = path.join("C:", "Users", "x", "AppData", "Roaming")
        expect(beePmHome({ APPDATA: roaming })).toBe(path.join(roaming, "beepm"))
        expect(beePmHome({ BEEPM_HOME: home, APPDATA: roaming })).toBe(home)
    })
})
