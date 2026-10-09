const fs = require("fs")
const os = require("os")
const path = require("path")
const { fixupsIn, fixupsOfVmfs } = require("../utils/vmfFixups")

describe("the fixups instances use", () => {
    test("are the $names in a VMF, each once, as first written", () => {
        const vmf = [
            'entity { "classname" "func_instance_parms" "parm1" "$light_color color255 255 255 255" }',
            'entity { "classname" "light" "_light" "$Light_Color 200" }',
            'entity { "classname" "logic_relay" "OnTrigger" "door,Open,,$open_delay,-1" }',
            // Not fixups
            'entity { "classname" "info_target" "targetname" "cost$" "comment" "$5 and $" }',
        ].join("\n")
        expect(fixupsIn(vmf)).toEqual(["$light_color", "$open_delay"])
    })

    test("are listed with the VMFs they're in", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-fixups-"))
        try {
            const lamp = path.join(dir, "lamp.vmf")
            const off = path.join(dir, "lamp_off.vmf")
            fs.writeFileSync(
                lamp,
                '"rendercolor" "$item_color" "speed" "$speed"',
            )
            fs.writeFileSync(
                off,
                '"rendercolor" "$ITEM_COLOR" "angles" "$angle"',
            )
            expect(
                fixupsOfVmfs([lamp, off, lamp, path.join(dir, "gone.vmf")]),
            ).toEqual([
                { name: "$angle", files: ["lamp_off.vmf"] },
                { name: "$item_color", files: ["lamp.vmf", "lamp_off.vmf"] },
                { name: "$speed", files: ["lamp.vmf"] },
            ])
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })
})
