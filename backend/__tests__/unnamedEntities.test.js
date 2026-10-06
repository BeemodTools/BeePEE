const fs = require("fs")
const os = require("os")
const path = require("path")
const { parseFGD } = require("../data")
const { Instance } = require("../items/Instance")

const quiet = { log() {}, warn() {}, error() {} }

// The FGD the way HammerAddons' is built: names and I/O from base classes
const FGD = `
@BaseClass = Targetname
[
	targetname(target_source) : "Name" : : "The name that other entities refer to this entity by."
]

@BaseClass base(Targetname) = BaseEntityPoint
[
	input Kill(void) : "Removes this entity from the world."
	output OnUser1(void) : "Fired in response to FireUser1 input."
]

@PointClass base(BaseEntityPoint) = logic_relay : "Fires outputs when triggered."
[
	input Trigger(void) : "Trigger the relay."
]

@PointClass base(BaseEntityPoint) = info_overlay : "An overlay."
[
]

@PointClass = prop_static : "A prop that doesn't move and doesn't animate."
[
	model(studio) : "World Model" : : "The model."
]

@SolidClass base(BaseEntityPoint) = worldspawn : "This is the world entity."
[
]
`

const VMF = `
world
{
	"id" "1"
	"classname" "worldspawn"
}
entity
{
	"id" "2"
	"classname" "prop_static"
	"origin" "0 0 0"
}
entity
{
	"id" "3"
	"classname" "logic_relay"
	"origin" "0 0 0"
}
entity
{
	"id" "4"
	"classname" "logic_relay"
	"targetname" "relay"
	"origin" "0 0 0"
}
entity
{
	"id" "5"
	"classname" "info_overlay"
	"origin" "0 0 0"
}
`

describe("unnamed entities in an instance", () => {
    let dir
    let fgd
    let instance

    beforeAll(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-unnamed-"))
        fs.writeFileSync(path.join(dir, "test.fgd"), FGD)
        fgd = await parseFGD(path.join(dir, "test.fgd"), quiet)
        fs.writeFileSync(path.join(dir, "test.vmf"), VMF)
        instance = new Instance({ path: path.join(dir, "test.vmf") })
    })

    afterAll(() => {
        fs.rmSync(dir, { recursive: true, force: true })
    })

    test("the FGD says which classes take a name, also through base classes", () => {
        expect(fgd.logic_relay.nameable).toBe(true)
        expect(fgd.logic_relay.inputs.map((i) => i.name)).toEqual([
            "Kill",
            "Trigger",
        ])
        expect(fgd.prop_static.nameable).toBe(false)
    })

    test("are listed only when they could have inputs or outputs with a name", () => {
        // Not the world, a static prop (no name, no I/O) or an overlay
        const issues = instance.getEntityValidationIssues(fgd)
        expect(issues.unnamedEntities).toEqual([
            { classname: "logic_relay", id: 3 },
        ])
    })

    test("without the FGD, leave out the classes that can't be named", () => {
        const issues = instance.getEntityValidationIssues(null)
        expect(issues.unnamedEntities).toEqual([
            { classname: "logic_relay", id: 3 },
        ])
    })
})
