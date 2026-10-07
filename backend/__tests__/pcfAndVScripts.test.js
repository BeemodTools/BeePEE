const { readPcf } = require("../utils/pcf")
const { vscriptReferences } = require("../utils/vscriptReferences")
const { buildPcf } = require("./helpers/buildPcf")

describe("particle files", () => {
    const systems = [
        {
            name: "PairShift_XH_54",
            material: "particle\\glow.vmt",
            models: ["pairshift\\xh_54.mdl", "models/pairshift/xh_43"],
        },
        { name: "plain", material: "effects/energyball" },
        { name: "no_material" },
    ]

    test("are read in the game's older encoding and the newer one", () => {
        for (const version of [2, 3, 4, 5]) {
            expect(readPcf(buildPcf(systems, { version }))).toEqual({
                systems: ["no_material", "pairshift_xh_54", "plain"],
                materials: [
                    "materials/effects/energyball.vmt",
                    "materials/particle/glow.vmt",
                ],
                models: [
                    "models/pairshift/xh_43.mdl",
                    "models/pairshift/xh_54.mdl",
                ],
            })
        }
    })

    test("that are cut short or aren't particle files don't read", () => {
        const pcf = buildPcf(systems)
        expect(() => readPcf(pcf.subarray(0, pcf.length - 10))).toThrow(
            /ends early/,
        )
        expect(() => readPcf(Buffer.from("IDST not a pcf"))).toThrow(
            /Not a binary DMX/,
        )
    })
})

describe("what a script uses", () => {
    test("leaves out comments, not strings that look like them", () => {
        const source = [
            '// IncludeScript("commented/line")',
            '# IncludeScript("commented/hash")',
            '/* IncludeScript("commented/block")',
            "   still a comment */",
            'local url = "http://example.com // not a comment"',
            'local text = "IncludeScript(\\"in/a/string\\") isn\'t code"',
            'local verbatim = @"a ""quoted"" // word"',
            'IncludeScript("pairshift/core", getroottable())',
        ].join("\n")
        expect(vscriptReferences(source).scripts).toEqual([
            "scripts/vscripts/pairshift/core.nut",
        ])
    })

    test("finds included and run scripts, particles, models, materials and sounds", () => {
        const source = [
            'DoIncludeScript("scripts/vscripts/lib/math.nut", this)',
            'EntFire("relay", "RunScriptFile", "lib\\\\other")',
            'DispatchParticleEffect("PairShift_Shot", origin, angles)',
            'self.PrecacheModel("models/props/box.mdl")',
            'ent.SetModel("pairshift/xh_54.mdl")',
            'overlay.__KeyValueFromString("material", "pairshift/xh_dots.vmt")',
            'self.EmitSound(")ambient/hum.wav")',
            'EmitSoundOn("Portal.button_down", self)',
        ].join("\n")
        expect(vscriptReferences(source)).toEqual({
            scripts: [
                "scripts/vscripts/lib/math.nut",
                "scripts/vscripts/lib/other.nut",
            ],
            particles: ["pairshift_shot"],
            models: ["models/pairshift/xh_54.mdl", "models/props/box.mdl"],
            materials: ["materials/pairshift/xh_dots.vmt"],
            sounds: ["sound/ambient/hum.wav"],
        })
    })
})
