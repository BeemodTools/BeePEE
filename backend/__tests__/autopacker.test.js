jest.mock("electron", () => ({ app: { isPackaged: false } }))

// A fake Portal 2 install, made in beforeAll
let mockRoot = null
jest.mock("../data", () => ({
    findPortal2Resources: async () => ({ root: mockRoot }),
}))

const fs = require("fs")
const os = require("os")
const path = require("path")
const { extractAssetsFromVMF } = require("../utils/vmfAssetExtractor")
const { autopackInstance, sortInstanceFiles } = require("../utils/autopacker")
const { buildMdl } = require("./helpers/buildMdl")

/** A VPK (version 1) with every file stored in the directory file */
function writeVpk(file, files) {
    const tree = new Map() // extension -> folder -> [name, data]
    for (const [contentPath, data] of Object.entries(files)) {
        const extension = path.posix.extname(contentPath).slice(1)
        // Files at the root are in the folder " ", like in the game's VPKs
        const folder = path.posix.dirname(contentPath).replace(/^\.$/, " ")
        const name = path.posix.basename(contentPath, `.${extension}`)
        if (!tree.has(extension)) tree.set(extension, new Map())
        const folders = tree.get(extension)
        if (!folders.has(folder)) folders.set(folder, [])
        folders.get(folder).push([name, Buffer.from(data)])
    }
    const parts = []
    const text = (value) => parts.push(Buffer.from(`${value}\0`, "latin1"))
    for (const [extension, folders] of tree) {
        text(extension)
        for (const [folder, entries] of folders) {
            text(folder)
            for (const [name, data] of entries) {
                text(name)
                const meta = Buffer.alloc(18)
                meta.writeUInt16LE(data.length, 4) // preload bytes
                meta.writeUInt16LE(0x7fff, 6) // in the directory file
                meta.writeUInt16LE(0xffff, 16)
                parts.push(meta, data)
            }
            text("")
        }
        text("")
    }
    text("")
    const treeData = Buffer.concat(parts)
    const header = Buffer.alloc(12)
    header.writeUInt32LE(0x55aa1234, 0)
    header.writeUInt32LE(1, 4)
    header.writeUInt32LE(treeData.length, 8)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, Buffer.concat([header, treeData]))
}

/** The day Steam installed the fake game */
const GAME_DAY = new Date(2020, 0, 15, 12)

function write(file, content = "x") {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
}

const VMF = `versioninfo
{
    "editorversion" "400"
}
world
{
    "id" "1"
    "classname" "worldspawn"
    solid
    {
        "id" "2"
        side
        {
            "id" "3"
            "plane" "(0 0 0) (1 0 0) (0 1 0)"
            "material" "METAL/BASE"
        }
        side
        {
            "id" "4"
            "plane" "(0 0 0) (0 1 0) (0 0 1)"
            "material" "CUSTOM/LOOSE"
        }
        side
        {
            "id" "5"
            "plane" "(0 0 0) (0 0 1) (1 0 0)"
            "material" "TOOLS/TOOLSNODRAW"
        }
    }
}
entity
{
    "id" "10"
    "classname" "prop_dynamic"
    "model" "models/props/thing.mdl"
    "skin" "1"
}
entity
{
    "id" "11"
    "classname" "prop_dynamic"
    "model" "$model"
}
entity
{
    "id" "12"
    "classname" "prop_dynamic"
    "model" "models/props/missing.mdl"
}
entity
{
    "id" "13"
    "classname" "info_overlay"
    "material" "props/thing"
}
entity
{
    "id" "14"
    "classname" "ambient_generic"
    "message" ")custom/beep.wav"
}
entity
{
    "id" "15"
    "classname" "ambient_generic"
    "message" "Custom.Alarm"
}
entity
{
    "id" "16"
    "classname" "ambient_generic"
    "message" "Portal.button_down"
}
entity
{
    "id" "17"
    "classname" "logic_script"
    "vscripts" "custom/logic"
    connections
    {
        "OnSpawn" "!self\x1bRunScriptFile\x1bcustom/other.nut\x1b0\x1b-1"
    }
}
entity
{
    "id" "18"
    "classname" "env_sprite"
    "model" "sprites/bee2glow.vmt"
}
entity
{
    "id" "19"
    "classname" "info_overlay"
    "material" "pkg/existing"
}
entity
{
    "id" "20"
    "classname" "game_text"
    "message" "Hello there"
}
entity
{
    "id" "21"
    "classname" "logic_script"
    "vscripts" "stock/elevator custom_in_game"
}
entity
{
    "id" "22"
    "classname" "ambient_generic"
    "message" "Stock.Hum"
}
entity
{
    "id" "23"
    "classname" "info_overlay"
    "material" "bee2gen/panel"
}
entity
{
    "id" "24"
    "classname" "info_overlay"
    "material" "bee2gen/loose"
}
entity
{
    "id" "25"
    "classname" "func_breakable"
    "material" "2"
}
entity
{
    "id" "26"
    "classname" "info_overlay"
    "material" "bee2/antigel/gen/white_wall"
}
entity
{
    "id" "27"
    "classname" "info_overlay"
    "material" "props/broken"
}
entity
{
    "id" "28"
    "classname" "info_overlay"
    "material" "dlc2/panel"
}
entity
{
    "id" "29"
    "classname" "info_overlay"
    "material" "vpkcustom/panel"
}
entity
{
    "id" "30"
    "classname" "prop_static"
    "model" "models/props/base_prop.mdl"
}
entity
{
    "id" "31"
    "classname" "info_overlay"
    "material" "metal/base2"
}
entity
{
    "id" "32"
    "classname" "prop_static"
    "model" "models/props/textured.mdl"
}
`

describe("autopacking", () => {
    let root
    let vmfPath
    let packageDir

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "beepee-autopack-test-"))
        mockRoot = root
        const game = path.join(root, "portal2")
        write(
            path.join(game, "gameinfo.txt"),
            `"GameInfo"
            {
                game "Portal 2"
                FileSystem
                {
                    SteamAppId 620
                    SearchPaths
                    {
                        Game |gameinfo_path|.
                        Game |gameinfo_path|../bee2
                        Game custom
                    }
                }
            }`,
        )
        // The game's own files
        writeVpk(path.join(game, "pak01_dir.vpk"), {
            "materials/metal/base.vmt":
                '"LightmappedGeneric" { "$basetexture" "metal/base" }',
            "materials/metal/base.vtf": "vtf",
            // The game's material, its texture missing: not the instance's problem
            "materials/metal/base2.vmt":
                '"LightmappedGeneric" { "$basetexture" "metal/gone" }',
            "scripts/game_sounds_base.txt":
                '"Portal.button_down" { "wave" "buttons/down.wav" }',
            "sound/buttons/down.wav": "wav",
            "sound/stock/hum.wav": "wav",
            "models/props/base_prop.mdl": "IDST",
            "models/props/base_prop.vvd": "vvd",
            "models/props/base_prop.dx90.vtx": "vtx",
        })
        // A copy of a game file, loose: still the game's
        write(
            path.join(game, "materials/metal/base.vmt"),
            '"LightmappedGeneric" { "$basetexture" "metal/base" }',
        )
        // Scripts the game ships loose, dated like the game's files
        write(path.join(game, "scripts/vscripts/stock/elevator.nut"))
        write(
            path.join(game, "scripts/game_sounds_stock.txt"),
            '"Stock.Hum" { "wave" "stock/hum.wav" }',
        )
        write(path.join(root, "platform/scripts/platform.txt"))
        // A script added to the game's folder later: custom
        write(path.join(game, "scripts/vscripts/custom_in_game.nut"))
        for (const file of [
            "portal2/pak01_dir.vpk",
            "portal2/scripts/vscripts/stock/elevator.nut",
            "portal2/scripts/game_sounds_stock.txt",
            "platform/scripts/platform.txt",
        ]) {
            fs.utimesSync(path.join(root, file), GAME_DAY, GAME_DAY)
        }
        // The DLC folder BEE2 puts its generated VPK in
        fs.mkdirSync(path.join(root, "portal2_dlc1"))
        // Only the game has files in the official DLC folders, whatever their date
        write(
            path.join(root, "portal2_dlc2/materials/dlc2/panel.vmt"),
            '"LightmappedGeneric" {}',
        )
        writeVpk(path.join(root, "portal2_dlc3/pak01_dir.vpk"), {
            "bee2_vpk_autogen_marker.txt": "",
            "materials/bee2gen/panel.vmt": '"LightmappedGeneric" {}',
        })
        write(
            path.join(root, "portal2_dlc3/materials/bee2gen/loose.vmt"),
            '"LightmappedGeneric" {}',
        )
        // Someone else's VPK: custom, its files are extracted
        writeVpk(path.join(root, "portal2_dlc4/pak01_dir.vpk"), {
            "materials/vpkcustom/panel.vmt": '"UnlitGeneric" {}',
        })
        // Custom files loose in Portal 2/portal2, with a texture named
        // differently than its material
        write(
            path.join(game, "materials/custom/loose.vmt"),
            '"LightmappedGeneric" { "$basetexture" "custom/loose_color" }',
        )
        write(path.join(game, "materials/custom/loose_color.vtf"))
        // Custom content in a gameinfo.txt folder
        const custom = path.join(root, "custom")
        write(
            path.join(custom, "materials/props/thing.vmt"),
            '"VertexLitGeneric" { "$basetexture" "props/thing_diffuse" }',
        )
        write(path.join(custom, "materials/props/thing_diffuse.vtf"))
        // A custom material whose texture is missing
        write(
            path.join(custom, "materials/props/broken.vmt"),
            '"LightmappedGeneric" { "$basetexture" "props/nonexistent" }',
        )
        for (const extension of [".mdl", ".vvd", ".phy", ".ani", ".dx90.vtx"]) {
            write(path.join(custom, `models/props/thing${extension}`))
        }
        write(path.join(custom, "sound/custom/beep.wav"))
        write(path.join(custom, "sound/custom/alarm1.wav"))
        write(path.join(custom, "sound/custom/alarm2.wav"))
        write(
            path.join(custom, "scripts/game_sounds_custom.txt"),
            `"Custom.Alarm"
            {
                "channel" "CHAN_STATIC"
                "rndwave"
                {
                    "wave" "custom/alarm1.wav"
                    "wave" ")custom/alarm2.wav"
                }
            }`,
        )
        write(path.join(custom, "scripts/vscripts/custom/logic.nut"))
        write(path.join(custom, "scripts/vscripts/custom/other.nut"))
        // A custom model whose material isn't anywhere
        write(
            path.join(custom, "models/props/textured.mdl"),
            buildMdl("textured_skin", "models/props/"),
        )
        // A stray file of the game's model next to custom content
        write(path.join(custom, "models/props/base_prop.dx80.vtx"))
        // BEE2's own content
        write(
            path.join(root, "bee2/materials/sprites/bee2glow.vmt"),
            '"Sprite" { "$basetexture" "sprites/bee2glow" }',
        )
        write(path.join(root, "bee2/materials/sprites/bee2glow.vtf"))
        // The package the instance is added to
        packageDir = path.join(root, "package")
        write(
            path.join(packageDir, "resources/materials/pkg/existing.vmt"),
            '"LightmappedGeneric" { "$basetexture" "pkg/existing" }',
        )
        write(path.join(packageDir, "resources/materials/pkg/existing.vtf"))
        vmfPath = path.join(root, "instance.vmf")
        write(vmfPath, VMF)
    })

    afterAll(() => {
        fs.rmSync(root, { recursive: true, force: true })
    })

    test("finds the models, materials, sounds and scripts a VMF uses", () => {
        expect(extractAssetsFromVMF(vmfPath)).toEqual({
            MODEL: [
                "models/props/base_prop.mdl",
                "models/props/missing.mdl",
                "models/props/textured.mdl",
                "models/props/thing.mdl",
            ],
            MATERIAL: [
                "bee2/antigel/gen/white_wall",
                "bee2gen/loose",
                "bee2gen/panel",
                "custom/loose",
                "dlc2/panel",
                "metal/base",
                "metal/base2",
                "pkg/existing",
                "props/broken",
                "props/thing",
                "sprites/bee2glow",
                "vpkcustom/panel",
            ],
            SOUND: ["custom/beep.wav"],
            SOUNDSCRIPT: ["custom.alarm", "portal.button_down", "stock.hum"],
            SCRIPT: [
                "vscripts/custom/logic.nut",
                "vscripts/custom/other.nut",
                "vscripts/custom_in_game.nut",
                "vscripts/stock/elevator.nut",
            ],
        })
    })

    test("sorts the files by where they come from", async () => {
        const files = await sortInstanceFiles(vmfPath, root, packageDir)
        expect(files.custom.map(({ file }) => file)).toEqual(
            [
                "materials/custom/loose.vmt",
                "materials/custom/loose_color.vtf",
                "materials/props/broken.vmt",
                "materials/props/thing.vmt",
                "materials/props/thing_diffuse.vtf",
                "models/props/textured.mdl",
                "models/props/thing.ani",
                "models/props/thing.dx90.vtx",
                "models/props/thing.mdl",
                "models/props/thing.phy",
                "models/props/thing.vvd",
                "scripts/game_sounds_custom.txt",
                "scripts/vscripts/custom/logic.nut",
                "scripts/vscripts/custom/other.nut",
                "scripts/vscripts/custom_in_game.nut",
                "sound/custom/alarm1.wav",
                "sound/custom/alarm2.wav",
                "sound/custom/beep.wav",
                "materials/vpkcustom/panel.vmt",
            ].sort(),
        )
        expect(files.baseGame).toEqual([
            "materials/dlc2/panel.vmt",
            "materials/metal/base.vmt",
            "materials/metal/base.vtf",
            "materials/metal/base2.vmt",
            "models/props/base_prop.dx80.vtx",
            "models/props/base_prop.dx90.vtx",
            "models/props/base_prop.mdl",
            "models/props/base_prop.vvd",
            "scripts/vscripts/stock/elevator.nut",
        ])
        expect(files.bee2).toEqual([
            "materials/bee2/antigel/gen/white_wall.vmt",
            "materials/bee2gen/loose.vmt",
            "materials/bee2gen/panel.vmt",
            "materials/sprites/bee2glow.vmt",
            "materials/sprites/bee2glow.vtf",
        ])
        expect(files.inPackage).toEqual([
            "materials/pkg/existing.vmt",
            "materials/pkg/existing.vtf",
        ])
        // Missing: what the instance names, and what its custom content needs
        expect(files.missing).toEqual([
            "materials/models/props/textured_skin.vmt",
            "materials/props/nonexistent.vtf",
            "models/props/missing.mdl",
        ])
        expect(files.neededBy).toEqual({
            "materials/models/props/textured_skin.vmt":
                "models/props/textured.mdl",
            "materials/props/nonexistent.vtf": "materials/props/broken.vmt",
        })
        expect(files.missingDependencies).toEqual(["materials/metal/gone.vtf"])
    })

    test("copies the custom files into the package", async () => {
        const result = await autopackInstance(vmfPath, packageDir, "Thing")
        expect(result.success).toBe(true)
        expect(result.missingFiles).toEqual([
            "materials/models/props/textured_skin.vmt",
            "materials/props/nonexistent.vtf",
            "models/props/missing.mdl",
        ])
        expect(result.packedAssets).toBe(19)
        // Extracted from the VPK
        expect(
            fs.readFileSync(
                path.join(
                    packageDir,
                    "resources/materials/vpkcustom/panel.vmt",
                ),
                "utf8",
            ),
        ).toBe('"UnlitGeneric" {}')
        const resources = path.join(packageDir, "resources")
        for (const file of [
            "materials/custom/loose_color.vtf",
            "models/props/thing.ani",
            "sound/custom/alarm2.wav",
            "scripts/game_sounds_custom.txt",
            "scripts/vscripts/custom/other.nut",
        ]) {
            expect(fs.existsSync(path.join(resources, file))).toBe(true)
        }
        for (const file of [
            "materials/metal/base.vmt",
            "materials/sprites/bee2glow.vmt",
            "materials/bee2gen/panel.vmt",
            "scripts/vscripts/stock/elevator.nut",
            "scripts/game_sounds_stock.txt",
            "sound/buttons/down.wav",
            "sound/stock/hum.wav",
        ]) {
            expect(fs.existsSync(path.join(resources, file))).toBe(false)
        }

        // A second time, everything is there already
        const again = await autopackInstance(vmfPath, packageDir, "Thing")
        expect(again.success).toBe(true)
        expect(again.packedFiles).toEqual([])
    })
})

describe("models only shown in Hammer", () => {
    test("leaves out cubes' and turrets' Hammer models, keeps custom ones", () => {
        const dir = fs.mkdtempSync(
            path.join(os.tmpdir(), "beepee-hammer-models-"),
        )
        try {
            const vmfPath = path.join(dir, "cubes.vmf")
            fs.writeFileSync(
                vmfPath,
                [
                    // Picks its model by its cube type (0): the model is stale
                    `entity { "id" "1" "classname" "prop_weighted_cube" "model" "models/props/cubes/standard_cube_rusty.mdl" "skintype" "0" "newskins" "2" }`,
                    `entity { "id" "2" "classname" "prop_weighted_cube" "CubeType" "6" "model" "models/custom/my_cube.mdl" }`,
                    `entity { "id" "3" "classname" "prop_weighted_cube" "comp_custom_model_type" "1" "model" "models/custom/script_cube.mdl" }`,
                    `entity { "id" "4" "classname" "npc_portal_turret_floor" "ModelIndex" "0" "model" "models/custom/unused_turret.mdl" }`,
                    `entity { "id" "5" "classname" "npc_portal_turret_floor" "ModelIndex" "1" "model" "models/custom/my_turret.mdl" }`,
                    `entity { "id" "6" "classname" "prop_dynamic" "model" "models/custom/prop.mdl" }`,
                ].join("\n"),
            )
            expect(extractAssetsFromVMF(vmfPath).MODEL).toEqual([
                "models/custom/my_cube.mdl",
                "models/custom/my_turret.mdl",
                "models/custom/prop.mdl",
                "models/custom/script_cube.mdl",
            ])
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })
})
