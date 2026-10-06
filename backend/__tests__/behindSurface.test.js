jest.mock("electron", () => ({
    app: { isPackaged: false, getPath: () => require("os").tmpdir() },
    dialog: {},
    ipcMain: { handle() {}, on() {} },
}))

const fs = require("fs")
const os = require("os")
const path = require("path")
const {
    itemFrame,
    behindSurface,
    instanceBehindSurface,
} = require("../utils/behindSurface")

/** An axis-aligned box brush, as Hammer writes it */
function boxSolid(id, min, max) {
    const [x0, y0, z0] = min
    const [x1, y1, z1] = max
    const side = (sideId, plane) => `
        side { "id" "${sideId}" "plane" "${plane}" "material" "tools/toolsnodraw"
            "uaxis" "[1 0 0 0] 0.25" "vaxis" "[0 -1 0 0] 0.25" }`
    return `
    solid { "id" "${id}"${side(1, `(${x0} ${y1} ${z1}) (${x1} ${y1} ${z1}) (${x1} ${y0} ${z1})`)}${side(2, `(${x0} ${y0} ${z0}) (${x1} ${y0} ${z0}) (${x1} ${y1} ${z0})`)}${side(3, `(${x0} ${y1} ${z1}) (${x0} ${y0} ${z1}) (${x0} ${y0} ${z0})`)}${side(4, `(${x1} ${y1} ${z0}) (${x1} ${y0} ${z0}) (${x1} ${y0} ${z1})`)}${side(5, `(${x1} ${y1} ${z1}) (${x0} ${y1} ${z1}) (${x0} ${y1} ${z0})`)}${side(6, `(${x1} ${y0} ${z0}) (${x0} ${y0} ${z0}) (${x0} ${y0} ${z1})`)}
    }`
}

const world = (...solids) =>
    `world { "id" "1" "classname" "worldspawn" ${solids.join("")} }\n`
const entity = (id, keyvalues, ...solids) =>
    `entity { "id" "${id}" ${Object.entries(keyvalues)
        .map(([key, value]) => `"${key}" "${value}"`)
        .join(" ")} ${solids.join("")} }\n`

const FLOOR_ITEM = itemFrame({ Type: "ITEM_TEST", Exporting: {} })

describe("what an instance has behind its item's surface", () => {
    test("the surface is z = -64 for the usual offset, 0 for 64 64 0", () => {
        expect(FLOOR_ITEM.surface).toBe(-64)
        expect(itemFrame({ Exporting: { Offset: "64 64 0" } }).surface).toBe(0)
        // A repeated key: the first one counts
        expect(
            itemFrame({ Exporting: { Offset: ["64 64 64", "0 0 0"] } }).surface,
        ).toBe(-64)
    })

    test("doors and observation rooms are meant to be outside the map", () => {
        expect(
            itemFrame({ ItemClass: "ItemEntranceDoor", Exporting: {} }),
        ).toBeNull()
        expect(
            itemFrame({ Type: "ITEM_OBSERVATION_ROOM", Exporting: {} }),
        ).toBeNull()
    })

    test("nothing on or in front of the surface counts", () => {
        const vmf =
            world(boxSolid(2, [-64, -64, -64], [64, 64, -48])) +
            entity(3, { classname: "prop_static", origin: "0 0 -64" }) +
            // Less than a unit: rounding
            entity(4, { classname: "light", origin: "0 0 -64.5" })
        expect(behindSurface(vmf, FLOOR_ITEM)).toBeNull()
    })

    test("lists the entities and brushes behind it, and how far", () => {
        const vmf =
            world(boxSolid(2, [-64, -64, -96], [64, 64, -64])) +
            entity(3, {
                classname: "light",
                targetname: "lamp",
                origin: "0 0 -200",
            }) +
            // Overlays become part of surfaces; func_detail of the world
            entity(4, { classname: "info_overlay", origin: "0 0 -300" }) +
            entity(
                5,
                { classname: "func_detail" },
                boxSolid(6, [0, 0, -100], [8, 8, -90]),
            ) +
            // Brush entities by their origin, and their brushes
            entity(
                7,
                { classname: "func_brush", origin: "4 4 -150" },
                boxSolid(8, [0, 0, -160], [8, 8, -140]),
            )
        expect(behindSurface(vmf, FLOOR_ITEM)).toEqual({
            depth: 136,
            entityCount: 2,
            entities: [
                { classname: "light", name: "lamp", depth: 136 },
                { classname: "func_brush", name: "", depth: 86 },
            ],
            brushCount: 3,
            brushDepth: 96,
        })
    })

    test("leaves out the voxels the item embeds into", () => {
        // Pos "0 0 0" is the voxel just behind the surface (z -192 to -64);
        // the volume is the column next to it, two voxels deep
        const frame = itemFrame({
            Exporting: {
                EmbeddedVoxels: {
                    Voxel: { Pos: "0 0 0" },
                    Volume: { Pos1: "1 0 -1", Pos2: "1 0 0" },
                },
            },
        })
        const vmf =
            entity(2, { classname: "light", origin: "0 0 -190" }) +
            entity(3, { classname: "light", origin: "128 0 -300" }) +
            world(boxSolid(4, [-64, -64, -192], [192, 64, -64])) +
            // Past the embedded voxel
            entity(5, { classname: "light", origin: "0 0 -200" })
        expect(behindSurface(vmf, frame)).toEqual({
            depth: 136,
            entityCount: 1,
            entities: [{ classname: "light", name: "", depth: 136 }],
            brushCount: 0,
            brushDepth: 0,
        })
    })

    test("is checked again when the VMF changes", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-behind-"))
        try {
            const file = path.join(dir, "item.vmf")
            fs.writeFileSync(
                file,
                entity(2, { classname: "light", origin: "0 0 -100" }),
            )
            const first = instanceBehindSurface(file, FLOOR_ITEM)
            expect(first.depth).toBe(36)
            expect(instanceBehindSurface(file, FLOOR_ITEM)).toBe(first)

            fs.writeFileSync(
                file,
                entity(2, { classname: "light", origin: "0 0 -1000" }),
            )
            expect(instanceBehindSurface(file, FLOOR_ITEM).depth).toBe(936)
            expect(
                instanceBehindSurface(path.join(dir, "gone.vmf"), FLOOR_ITEM),
            ).toBeNull()
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    test("is checked for each of an item's instances", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-behind-"))
        try {
            const itemDir = path.join(dir, "items", "lamp")
            fs.mkdirSync(itemDir, { recursive: true })
            fs.writeFileSync(
                path.join(itemDir, "editoritems.json"),
                JSON.stringify({
                    Item: {
                        Type: "ITEM_LAMP",
                        Editor: { SubType: { Name: "Lamp" } },
                        Exporting: {
                            Offset: "64 64 64",
                            Instances: {
                                0: { Name: "instances/BEE2/test/lamp.vmf" },
                                1: { Name: "instances/BEE2/test/base.vmf" },
                            },
                        },
                    },
                }),
            )
            fs.writeFileSync(
                path.join(itemDir, "properties.json"),
                JSON.stringify({ Properties: { Authors: "Tester" } }),
            )
            fs.writeFileSync(
                path.join(dir, "info.json"),
                JSON.stringify({
                    ID: "TEST",
                    Name: "Test",
                    Item: {
                        ID: "ITEM_LAMP",
                        Version: { Styles: { BEE2_CLEAN: "lamp" } },
                    },
                }),
            )
            const instances = path.join(dir, "resources", "instances", "test")
            fs.mkdirSync(instances, { recursive: true })
            fs.writeFileSync(
                path.join(instances, "lamp.vmf"),
                entity(2, { classname: "light", origin: "0 0 -400" }),
            )
            fs.writeFileSync(
                path.join(instances, "base.vmf"),
                world(boxSolid(2, [-64, -64, -64], [64, 64, -60])),
            )

            const { Package } = require("../models/package")
            const pkg = new Package(path.join(dir, "info.json"))
            pkg.packageDir = dir
            await pkg.load()
            const behind = pkg.items[0].getInstancesBehindSurface()
            expect(behind[0]).toMatchObject({ depth: 336, entityCount: 1 })
            expect(behind[1]).toBeNull()
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })
})
