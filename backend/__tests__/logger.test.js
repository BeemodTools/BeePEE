jest.mock("electron", () => ({ app: { isPackaged: false } }))

const { logger, formatLine } = require("../utils/logger")

describe("logger sections", () => {
    let lines

    beforeEach(() => {
        lines = []
        logger.emit = (entry) => lines.push(entry.line)
    })

    const log = (level, ...args) => logger.output(level, args, null)
    const withoutTimes = () =>
        lines
            .flatMap((l) => l.split("\n"))
            .map((l) => l.replace(/\d+ ms|\d+\.\d s/, "<time>"))

    test("draws nested steps as a tree", async () => {
        await logger.section("Model generation for my_item", async () => {
            log("info", "Finding VMF files")
            await logger.section("Converting 2 instances to OBJ", async () => {
                log("info", "my_item_0: 2285 faces")
                log("warn", "Missing texture: %s", "metal/foo")
            })
            log("info", "Compiling MDL")
        })
        expect(withoutTimes()).toEqual([
            "Model generation for my_item",
            "├─ Finding VMF files",
            "├─ Converting 2 instances to OBJ",
            "│  ├─ my_item_0: 2285 faces",
            "│  ├─ Warning: Missing texture: metal/foo",
            "│  └─ [✓] Done in <time>",
            "│",
            "├─ Compiling MDL",
            "└─ [✓] Done in <time>",
            "",
        ])
    })

    test("ends failed steps with the reason and re-throws", async () => {
        await expect(
            logger.section("Compiling MDL", async () => {
                throw new Error("studiomdl exited with code 1")
            }),
        ).rejects.toThrow("studiomdl exited with code 1")
        expect(withoutTimes()).toEqual([
            "[✗] Compiling MDL failed after <time>: studiomdl exited with code 1",
        ])
    })

    test("keeps parallel buffered steps in one block each", async () => {
        const wait = () => new Promise((resolve) => setImmediate(resolve))
        await logger.section("Compiling 2 models", async () => {
            await Promise.all(
                ["a", "b"].map((name) =>
                    logger.section(
                        `Model ${name}`,
                        async () => {
                            log("info", `${name} step 1`)
                            await wait()
                            log("info", `${name} step 2`)
                        },
                        { buffered: true },
                    ),
                ),
            )
        })
        expect(withoutTimes()).toEqual([
            "Compiling 2 models",
            "├─ Model a",
            "│  ├─ a step 1",
            "│  ├─ a step 2",
            "│  └─ [✓] Done in <time>",
            "│",
            "├─ Model b",
            "│  ├─ b step 1",
            "│  ├─ b step 2",
            "│  └─ [✓] Done in <time>",
            "│",
            "└─ [✓] Done in <time>",
            "",
        ])
    })

    test("writes parallel steps in the order they started", async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        await logger.section("Compiling 2 models", async () => {
            await Promise.all(
                [
                    ["slow", 30],
                    ["fast", 1],
                ].map(([name, ms]) =>
                    logger.section(
                        `Model ${name}`,
                        async () => {
                            await wait(ms)
                            log("info", `${name} compiled`)
                        },
                        { buffered: true },
                    ),
                ),
            )
        })
        expect(withoutTimes()).toEqual([
            "Compiling 2 models",
            "├─ Model slow",
            "│  ├─ slow compiled",
            "│  └─ [✓] Done in <time>",
            "│",
            "├─ Model fast",
            "│  ├─ fast compiled",
            "│  └─ [✓] Done in <time>",
            "│",
            "└─ [✓] Done in <time>",
            "",
        ])
    })

    test("indents the rest of multi-line messages under their line", async () => {
        await logger.section("Step", async () => {
            log("error", "Could not read the VMF:", new Error("boom"))
            log("error", new Error("bang"))
        })
        expect(lines[1]).toMatch(
            /^├─ Error: Could not read the VMF: Error: boom\n│ {6}at /,
        )
        expect(lines[2]).toMatch(/^├─ Error: bang\n│ {6}at /)
    })

    test("leaves lines outside sections as they are", () => {
        expect(formatLine("info", ["Plain", 42])).toBe("Plain 42")
        expect(formatLine("warn", ["Careful"])).toBe("Warning: Careful")
        expect(formatLine("error", ["Error loading x"])).toBe("Error loading x")
    })

    test("ends steps that return { success: false } as failed", async () => {
        await logger.section("Converting", async () => ({
            success: false,
            error: "No valid VMF files found",
        }))
        expect(withoutTimes()).toEqual([
            "[✗] Converting failed after <time>: No valid VMF files found",
        ])
    })

    test("logs work that outlives its step after the step", async () => {
        let late
        await logger.section("Startup", async () => {
            late = new Promise((resolve) =>
                setTimeout(() => {
                    log("info", "Update check finished")
                    resolve()
                }, 5),
            )
        })
        await late
        expect(withoutTimes()).toEqual([
            "[✓] Startup in <time>",
            "Update check finished",
        ])
    })

    test("writes a step that logs nothing as one line", async () => {
        await logger.section("Loading package", async () => {
            await logger.section("Converting VDF files to JSON", async () => {})
            await logger.section("Checking signs", async () => ({
                success: false,
                error: "signs.json is missing",
            }))
            log("info", "Loaded 3 items")
        })
        expect(withoutTimes()).toEqual([
            "Loading package",
            "├─ [✓] Converting VDF files to JSON in <time>",
            "├─ [✗] Checking signs failed after <time>: signs.json is missing",
            "├─ Loaded 3 items",
            "└─ [✓] Done in <time>",
            "",
        ])
    })

    test("writes the titles of steps around a parallel step first", async () => {
        await logger.section("Compiling 2 models", async () => {
            await Promise.all(
                ["a", "b"].map((name) =>
                    logger.section(`Model ${name}`, async () => {}, {
                        buffered: true,
                    }),
                ),
            )
        })
        expect(withoutTimes()).toEqual([
            "Compiling 2 models",
            "├─ [✓] Model a in <time>",
            "├─ [✓] Model b in <time>",
            "└─ [✓] Done in <time>",
            "",
        ])
    })

    test("names a step again where its tree goes on after other lines", async () => {
        let finishUpdate
        const update = logger.section("Checking for updates", async () => {
            log("info", "Checking for update")
            await new Promise((resolve) => (finishUpdate = resolve))
            log("info", "No update")
        })
        await logger.section("Loading package", async () => {
            log("info", "Loaded 1 item")
        })
        log("info", "[Main window] Loaded item list")
        finishUpdate()
        await update
        expect(withoutTimes()).toEqual([
            "Checking for updates",
            "├─ Checking for update",
            "Loading package",
            "├─ Loaded 1 item",
            "└─ [✓] Done in <time>",
            "",
            "[Main window] Loaded item list",
            "Checking for updates (continued)",
            "├─ No update",
            "└─ [✓] Done in <time>",
            "",
        ])
    })

    test("names every step a continued line is in", async () => {
        let resume
        const making = logger.section("Making model", async () => {
            await logger.section("Compiling MDL", async () => {
                log("info", "studiomdl started")
                await new Promise((resolve) => (resume = resolve))
                log("info", "studiomdl finished")
            })
        })
        log("info", "[Item Editor] Saved item")
        resume()
        await making
        expect(withoutTimes()).toEqual([
            "Making model",
            "├─ Compiling MDL",
            "│  ├─ studiomdl started",
            "[Item Editor] Saved item",
            "Making model (continued)",
            "├─ Compiling MDL (continued)",
            "│  ├─ studiomdl finished",
            "│  └─ [✓] Done in <time>",
            "│",
            "└─ [✓] Done in <time>",
            "",
        ])
    })

    test("cuts very long messages short", () => {
        const line = formatLine("info", ["x".repeat(5000)])
        expect(line).toMatch(/^x{4000}\.\.\. \(1000 more characters\)$/)
    })
})

describe("logger file", () => {
    let written

    beforeEach(() => {
        written = []
        delete logger.emit
        logger.isInitialized = true
        logger.stream = { write: (text) => written.push(text) }
        logger.lastLine = null
        logger.repeats = 0
    })

    afterEach(() => {
        logger.isInitialized = false
        logger.stream = null
    })

    /** The file's lines, without the times */
    const fileLines = () =>
        written
            .join("")
            .split("\n")
            .slice(0, -1)
            .map((l) => l.replace(/^[\d:.]+ {2}| {14}/, ""))

    test("writes a line repeated many times once, with a count", async () => {
        await logger.section("Loading icons", async () => {
            for (let i = 0; i < 4; i++) {
                logger.output("warn", ["Icon not found"], null)
            }
            logger.output("info", ["Loaded 12 icons"], null)
        })
        expect(fileLines().map((l) => l.replace(/\d+ ms/, "<time>"))).toEqual([
            "Loading icons",
            "├─ Warning: Icon not found",
            "├─ (repeated 3 more times)",
            "├─ Loaded 12 icons",
            "└─ [✓] Done in <time>",
            "",
        ])
    })

    test("writes lines of parallel steps with the time they were logged", async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        await logger.section(
            "Model",
            async () => {
                logger.output("info", ["early"], null)
                await wait(60)
            },
            { buffered: true },
        )
        const toMs = (text) => {
            const [h, m, rest] = text.slice(0, 12).split(":")
            return (Number(h) * 60 + Number(m)) * 60000 + Number(rest) * 1000
        }
        const early = written.find((text) => text.includes("early"))
        const done = written.find((text) => text.includes("Done in"))
        expect(toMs(done) - toMs(early)).toBeGreaterThanOrEqual(50)
    })

    test("lines up the rest of a message under its first line", () => {
        logger.output("info", ["Resource paths:\n  1. a.vpk\n  2. b"], null)
        expect(written.join("")).toMatch(
            /^\d\d:\d\d:\d\d\.\d{3} {2}Resource paths:\n {16}1\. a\.vpk\n {16}2\. b\n$/,
        )
    })

    test("marks lines from windows with the window's name", () => {
        logger.fromWindow("Signage Designer", "info", 'Saved signage "Arrow"')
        expect(fileLines()).toEqual([
            '[Signage Designer] Saved signage "Arrow"',
        ])
    })
})
