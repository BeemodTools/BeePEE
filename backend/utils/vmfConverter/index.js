/**
 * VMF -> OBJ/MTL converter.
 *
 * JavaScript port of VMF2OBJ by Dylancyclone (MIT License, see
 * LICENSE-VMF2OBJ.txt). Differences from the Java version:
 *  - prop rotations use Source's real angle order (the Java fork rotated
 *    every prop 90 degrees off; the original was wrong for pitch/roll)
 *  - non-static props are posed with their DefaultAnim / first sequence
 *  - prop normals are rotated with the prop
 *  - vertices are de-duplicated exactly (the Java hash merged distinct points)
 *  - brush textures are no longer mirrored horizontally
 *  - VMTs are parsed as KeyValues, so materials with shader fallback blocks
 *    and "patch" materials resolve (the Java regex parser dropped those faces)
 *  - textures are decoded in-process and written as PNG (no VTFCmd/Java)
 *  - entity "rendercolor" and material $color/$color2 tints are baked into
 *    tinted texture copies
 *  - any entity with a model is converted, not only prop_* entities
 *  - info_overlay and infodecal entities are baked into the textures of
 *    their faces, and displacement blend materials into a texture for each
 *    displacement
 */

const fs = require("fs")
const os = require("os")
const path = require("path")
const { parseVmf, parseNumbers } = require("./vmf")
const { completeSolid, displacementGrid } = require("./brushes")
const {
    buildResourceIndex,
    normalizeContentPath,
    safeJoin,
} = require("./resources")
const {
    parseVmt,
    describeMaterial,
    combineTints,
    applyTint,
    decodeVtf,
    encodePng,
} = require("./textures")
const {
    loadModel,
    buildModelGeometry,
    parseSmd,
    skinMapper,
} = require("./models")
const {
    parseOverlay,
    parseDecal,
    decalsNearFace,
    decalProjection,
    blendMode,
    textureMapping,
    bakeOverlays,
} = require("./overlays")
const { bakeBlend } = require("./blends")
const {
    scale,
    vectorKey,
    entityMatrix,
    transformPoint,
    transformDirection,
    normalize,
} = require("./math")

const HEADER =
    "# Converted by BeePEE (JavaScript port of VMF2OBJ by Dylancyclone)"

/**
 * Portal 2 entities whose model is set in game code, so the VMF has no
 * "model" keyvalue (from the FGD studio() helpers and the game's defaults;
 * all of these are in Portal 2's VPKs). A "model" keyvalue still wins.
 */
const BUILT_IN_MODELS = {
    npc_security_camera: "models/props/security_camera.mdl",
    npc_portal_turret_floor: "models/npcs/turret/turret.mdl",
    weapon_portalgun: "models/weapons/w_portalgun.mdl",
    prop_rocket_tripwire: "models/props/tripwire_turret.mdl",
    prop_wall_projector: "models/props/wall_emitter.mdl",
    prop_tractor_beam: "models/props/tractor_beam_emitter.mdl",
    prop_button: "models/props/switch001.mdl",
    prop_floor_button: "models/props/portal_button.mdl",
    prop_floor_cube_button: "models/props/box_socket.mdl",
    prop_floor_ball_button: "models/props/ball_button.mdl",
    prop_under_floor_button:
        "models/props_underground/underground_floor_button.mdl",
    prop_testchamber_door: "models/props/portal_door_combined.mdl",
    prop_laser_catcher: "models/props/laser_catcher.mdl",
    prop_monster_box: "models/npcs/monsters/monster_a_box.mdl",
    prop_linked_portal_door: "models/props/portal_door.mdl",
}

/**
 * npc_portal_turret_floor's model by its "ModelIndex" (1, "Custom Model",
 * is its "model" keyvalue)
 */
const TURRET_MODELS = {
    0: "models/npcs/turret/turret.mdl",
    2: "models/npcs/turret/turret_boxed.mdl",
    3: "models/npcs/turret/turret_backwards.mdl",
    4: "models/npcs/turret/turret_skeleton.mdl",
}

/**
 * prop_weighted_cube's model (and skin) by its "CubeType". Storage and
 * reflection cubes have a rusted skin, for "SkinType" 1.
 */
const CUBE_TYPES = [
    { path: "models/props/metal_box.mdl", skin: 0, rustedSkin: 3 }, // storage cube
    { path: "models/props/metal_box.mdl", skin: 1 }, // companion cube
    { path: "models/props/reflection_cube.mdl", skin: 0, rustedSkin: 1 },
    { path: "models/props_gameplay/mp_ball.mdl", skin: 0 }, // edgeless safety cube
    { path: "models/props_underground/underground_weighted_cube.mdl", skin: 0 },
]

/**
 * prop_paint_bomb is a blob of gel the game draws itself: its "model"
 * keyvalue only quiets a warning, and its "skin" only shows the gel in
 * Hammer. It's drawn as a ball in its gel's color, by its "PaintType".
 */
const GEL_COLORS = [
    [0, 165, 255], // 0: repulsion
    [130, 50, 200], // 1: reflection / adhesion
    [255, 106, 0], // 2: propulsion
    [225, 225, 225], // 3: conversion
    [140, 175, 205], // 4: cleansing
]
const GEL_RADIUS = 24

/**
 * The triangles of a ball of radius 1, outside faces counter-clockwise
 * (like the props): each corner's position (also its normal) and UV
 */
function ballTriangles(segments, rings) {
    const corner = (ring, segment) => {
        const across = (ring / rings) * Math.PI
        const around = (segment / segments) * 2 * Math.PI
        return {
            pos: [
                Math.sin(across) * Math.cos(around),
                Math.sin(across) * Math.sin(around),
                Math.cos(across),
            ],
            uv: [segment / segments, 1 - ring / rings],
        }
    }
    const triangles = []
    for (let ring = 0; ring < rings; ring++) {
        for (let segment = 0; segment < segments; segment++) {
            const a = corner(ring, segment)
            const b = corner(ring + 1, segment)
            const c = corner(ring + 1, segment + 1)
            const d = corner(ring, segment + 1)
            // None at the poles, where two corners are the same
            if (ring > 0) triangles.push([a, b, d])
            if (ring < rings - 1) triangles.push([d, b, c])
        }
    }
    return triangles
}

const GEL_BALL = ballTriangles(24, 12)

/** Stand-in for missing textures: Source's purple/black checkerboard */
const PLACEHOLDER_TEXTURE = "bpee_missing_texture"
const PLACEHOLDER_SIZE = 128

/** Folder (under materials/) for face textures with overlays/decals baked in */
const OVERLAY_FOLDER = "bpee_overlays"

/** Folder (under materials/) for baked displacement blends */
const BLEND_FOLDER = "bpee_blends"

function placeholderPixels() {
    const pixels = Buffer.alloc(PLACEHOLDER_SIZE * PLACEHOLDER_SIZE * 4)
    const half = PLACEHOLDER_SIZE / 2
    for (let y = 0; y < PLACEHOLDER_SIZE; y++) {
        for (let x = 0; x < PLACEHOLDER_SIZE; x++) {
            const o = (y * PLACEHOLDER_SIZE + x) * 4
            const purple = x < half === y < half
            pixels[o] = purple ? 255 : 0
            pixels[o + 1] = 0
            pixels[o + 2] = purple ? 255 : 0
            pixels[o + 3] = 255
        }
    }
    return pixels
}

/** The placeholder as a decoded texture */
function placeholderTexture() {
    return {
        width: PLACEHOLDER_SIZE,
        height: PLACEHOLDER_SIZE,
        rgba: placeholderPixels(),
    }
}

/**
 * What registerMaterial gives for a material that can't be seen: its faces
 * are left out
 */
const INVISIBLE = Symbol("invisible material")

/** Folder (under materials/) for the see-through textures of glass */
const GLASS_FOLDER = "bpee_glass"
const GLASS_SIZE = 16

/** Folder (under materials/) for textures of one color (gel blobs) */
const COLOR_FOLDER = "bpee_colors"
const COLOR_SIZE = 8

/** How opaque glass (the Refract shader) is drawn */
const GLASS_ALPHA = 0.35

/**
 * Glass's color: its tint ($refracttint, 0-1 RGB) a little darker and
 * bluer, so clear glass still shows, and see-through
 * @returns {number[]} RGBA, 0-255
 */
function glassColor(tint) {
    const rgb = [0.78, 0.88, 0.93].map((shade, i) =>
        Math.round(255 * Math.min(Math.max(tint[i] * shade, 0), 1)),
    )
    return [...rgb, Math.round(255 * GLASS_ALPHA)]
}

/** A glass texture: one color (glassColor) all over */
function glassTexture(color) {
    const rgba = Buffer.alloc(GLASS_SIZE * GLASS_SIZE * 4)
    for (let i = 0; i < GLASS_SIZE * GLASS_SIZE; i++) rgba.set(color, i * 4)
    return { width: GLASS_SIZE, height: GLASS_SIZE, rgba }
}

function parseVector(value) {
    const n = parseNumbers(value)
    return n.length >= 3 ? n.slice(0, 3) : [0, 0, 0]
}

/**
 * Whether an entity can't be seen when the map starts, so its model or
 * brushes aren't drawn: "Don't render" (rendermode 10), faded out completely
 * (renderamt 0, with a render mode that uses it), or a prop_dynamic or
 * func_brush that starts disabled. Items keep things like a breakable
 * glass's cracked panes this way until they're shown.
 */
function hiddenAtStart(entity) {
    if (!entity) return false
    const mode = Number.parseInt(entity.get("rendermode") ?? "0", 10)
    if (mode === 10) return true
    const amount = Number.parseInt(entity.get("renderamt") ?? "255", 10)
    if (mode !== 0 && amount === 0) return true
    return (
        /^(prop_dynamic|func_brush$)/i.test(entity.classname) &&
        entity.get("startdisabled") === "1"
    )
}

/** An entity's "rendercolor" ("R G B", 0-255) as a tint; null when white */
function parseRenderColor(value) {
    const n = parseNumbers(value)
    return n.length >= 3
        ? combineTints(n.slice(0, 3).map((c) => c / 255))
        : null
}

/** File-name safe key for a tint, e.g. "ff8000" ("ff8000m" when alpha-masked) */
function tintKey(tint, masked) {
    const hex = tint
        .map((v) =>
            Math.round(Math.max(0, v) * 255)
                .toString(16)
                .padStart(2, "0"),
        )
        .join("")
    return masked ? `${hex}m` : hex
}

/**
 * A model without any faces means the conversion found nothing usable; never
 * hand it on as a finished model. Removes the empty outputs and throws.
 * @param {{objPath: string, mtlPath: string, warnings: string[], stats: Object}} result
 * @param {string} vmfPath - Source VMF (for the message)
 */
function assertHasGeometry(result, vmfPath) {
    const { stats } = result
    if (stats.faces > 0) return

    for (const file of [result.objPath, result.mtlPath]) {
        fs.rmSync(file, { force: true })
    }

    const reasons = []
    if (stats.brushes === 0 && stats.modelEntities === 0) {
        reasons.push("The instance has no brushes and no models to convert.")
    }
    if (stats.invisibleFaces > 0) {
        reasons.push(
            `${stats.invisibleFaces} face(s) are see-through everywhere (invisible), which are skipped.`,
        )
    }
    if (stats.toolFaces > 0) {
        reasons.push(
            `${stats.toolFaces} brush face(s) only use tool or dev textures, which are skipped.`,
        )
    }
    if (stats.skippedModels > 0) {
        reasons.push(`${stats.skippedModels} model(s) couldn't be loaded.`)
    }
    const warnings = result.warnings.slice(0, 8).map((w) => `• ${w}`)
    const error = new Error(
        [
            `No geometry was generated from ${path.basename(vmfPath)}, so no model was made.`,
            ...reasons,
            ...(warnings.length ? ["", "Details:", ...warnings] : []),
        ].join("\n"),
    )
    error.userFacing = true
    throw error
}

class VertexList {
    constructor() {
        this.list = []
        this.indices = new Map()
    }

    add(point) {
        const key = vectorKey(point)
        if (!this.indices.has(key)) {
            this.indices.set(key, this.list.length)
            this.list.push(point)
        }
    }

    indexOf(point) {
        return this.indices.get(vectorKey(point))
    }
}

class VmfConverter {
    /**
     * @param {Object} options
     * @param {string[]} options.resourcePaths - VPK files and content folders, highest priority first
     * @param {string} [options.crowbarPath] - CrowbarCommandLineDecomp.exe (needed for props)
     * @param {boolean} [options.skipTools] - Skip faces with tools/ and dev/
     *   materials
     * @param {boolean} [options.useLastAnimFrame] - Pose props with the last frame instead of the first
     * @param {boolean} [options.includeBumpMaps] - Also export $bumpmap textures (map_bump)
     * @param {boolean} [options.quiet] - Collect warnings without logging them
     * @param {number} [options.timeoutMs] - Abort when the whole session takes longer than this
     * @param {Object} [options.logger] - console-like logger
     */
    constructor(options = {}) {
        this.resourcePaths = options.resourcePaths || []
        // Absolute, since Crowbar runs from the temp folder
        this.crowbarPath = options.crowbarPath
            ? path.resolve(options.crowbarPath)
            : null
        this.skipTools = !!options.skipTools
        this.useLastAnimFrame = !!options.useLastAnimFrame
        this.includeBumpMaps = options.includeBumpMaps !== false
        this.quiet = !!options.quiet
        this.timeoutMs = options.timeoutMs ?? null
        this.logger = options.logger || console
        this.modelConcurrency = options.modelConcurrency ?? 4

        this.warnings = []
        this.warned = new Set()
        this.materials = new Map()
        this.textures = new Map()
        this.models = new Map()
        this.geometry = new Map()
        this.animations = new Map()
        this.resources = null
        this.tempDir = null
        this.deadline = null
        this.lastYield = Date.now()
    }

    async init() {
        this.deadline = this.timeoutMs ? Date.now() + this.timeoutMs : null
        this.resources = await buildResourceIndex(
            this.resourcePaths,
            (message) => this.warn(message),
        )
        this.tempDir = await fs.promises.mkdtemp(
            path.join(os.tmpdir(), "beepee-vmf2obj-"),
        )
        return this
    }

    async dispose() {
        if (this.tempDir) {
            await fs.promises
                .rm(this.tempDir, {
                    recursive: true,
                    force: true,
                    maxRetries: 3,
                })
                .catch(() => {})
            this.tempDir = null
        }
    }

    warn(message) {
        this.warnings.push(message)
        if (!this.quiet) this.logger.warn(`[VMF2OBJ] ${message}`)
    }

    warnOnce(key, message) {
        if (this.warned.has(key)) return
        this.warned.add(key)
        this.warn(message)
    }

    /** Keep the (Electron main) event loop responsive and enforce the timeout */
    async yieldIfBusy() {
        const now = Date.now()
        if (this.deadline && now > this.deadline) {
            throw new Error(
                `VMF conversion timed out after ${this.timeoutMs}ms`,
            )
        }
        if (now - this.lastYield >= 15) {
            await new Promise((resolve) => setImmediate(resolve))
            this.lastYield = Date.now()
        }
    }

    /**
     * Convert one VMF file
     * @param {string} vmfPath
     * @param {string} outputBase - Output path without extension (".obj"/".mtl" are added)
     * @returns {Promise<{objPath: string, mtlPath: string, warnings: string[], stats: Object}>}
     */
    async convert(vmfPath, outputBase) {
        const firstWarning = this.warnings.length
        const vmf = parseVmf(await fs.promises.readFile(vmfPath, "utf8"))
        const objPath = `${outputBase}.obj`
        const mtlPath = `${outputBase}.mtl`
        const state = {
            outDir: path.dirname(outputBase),
            // Names baked textures, which must not clash between the
            // instances of one item
            outputKey: path
                .basename(outputBase)
                .toLowerCase()
                .replace(/[^a-z0-9_]+/g, "_"),
            obj: [HEADER, "", `mtllib ${path.basename(mtlPath)}`],
            mtl: [HEADER, ""],
            v: 1,
            vt: 1,
            vn: 1,
            textures: new Map(),
            // Decoded textures for baking (this conversion only)
            pixels: new Map(),
            overlaysBySide: new Map(),
            decals: [],
            // Overlays and decals drawn on at least one face
            painted: new Set(),
            stats: {
                solids: 0,
                props: 0,
                faces: 0,
                materials: 0,
                brushes: vmf.solids.length,
                modelEntities: 0,
                toolFaces: 0,
                skippedModels: 0,
                // Entities not drawn because they can't be seen at the start
                hiddenEntities: 0,
                // Faces whose material can't be seen (see INVISIBLE)
                invisibleFaces: 0,
                placeholderMaterials: 0,
                overlays: 0,
                decals: 0,
                blends: 0,
            },
        }

        const overlays = this.collectOverlays(state, vmf)
        state.decals = this.collectDecals(vmf)
        const hidden = new Set()
        for (const solid of vmf.solids) {
            if (hiddenAtStart(solid.owner)) {
                hidden.add(solid.owner)
                continue
            }
            await this.writeSolid(state, solid)
            await this.yieldIfBusy()
        }
        state.stats.overlays = this.reportLeftOut(state, overlays, "overlay")
        state.stats.decals = this.reportLeftOut(state, state.decals, "decal")

        const props = vmf.entities.filter((entity) => {
            if (!this.isModelEntity(entity)) return false
            if (!hiddenAtStart(entity)) return true
            hidden.add(entity)
            return false
        })
        state.stats.hiddenEntities = hidden.size
        state.stats.modelEntities = props.length
        await this.preloadModels(props)
        for (const entity of props) {
            await this.writeProp(state, entity)
            await this.yieldIfBusy()
        }

        await fs.promises.mkdir(state.outDir, { recursive: true })
        await fs.promises.writeFile(objPath, state.obj.join("\n") + "\n")
        await fs.promises.writeFile(mtlPath, state.mtl.join("\n") + "\n")
        return {
            objPath,
            mtlPath,
            warnings: this.warnings.slice(firstWarning),
            stats: state.stats,
        }
    }

    // -----------------------------------------------------------------------
    // Brushes
    // -----------------------------------------------------------------------

    /**
     * Faces left out of the model: tool textures (nodraw, clip, triggers,
     * ...) and dev textures (stand-ins and measuring textures for building
     * maps), which aren't meant to be seen
     */
    isSkippedTool(side) {
        if (!this.skipTools) return false
        const material = side.material.toLowerCase()
        return material.includes("tools/") || material.startsWith("dev/")
    }

    /**
     * Entities whose model is drawn in game: anything with a model (its
     * "model" keyvalue or a built-in one), except info_* entities and
     * Hammer-only editor models (spawn points, helpers). Regular props with
     * no model are included too, so the conversion warns about them.
     */
    isModelEntity(entity) {
        const classname = entity.classname.toLowerCase()
        const info = this.modelOf(entity)
        if (info?.gel !== undefined) return true
        const model = info?.path
        if (!model)
            return /^prop_(static|dynamic|physics|detail)/.test(classname)
        return (
            model.endsWith(".mdl") &&
            !classname.startsWith("info_") &&
            !model.startsWith("models/editor/")
        )
    }

    async writeSolid(state, solid) {
        for (const id of completeSolid(solid)) {
            this.warn(`Malformed side ${id} in solid ${solid.id}`)
        }

        const isDisplacementSolid = solid.sides.some((side) => side.dispinfo)

        // Brush entities can be tinted with their render color
        const entityTint = parseRenderColor(solid.owner?.get("rendercolor"))
        const materialNames = new Map()
        for (const side of solid.sides) {
            if (this.isSkippedTool(side)) continue
            const material = side.material.toLowerCase()
            if (materialNames.has(material)) continue
            materialNames.set(
                material,
                await this.registerMaterial(
                    state,
                    material,
                    [`materials/${material}.vmt`],
                    entityTint,
                ),
            )
        }
        const invisible = (side) =>
            materialNames.get(side.material.toLowerCase()) === INVISIBLE

        const vertices = new VertexList()
        for (const side of solid.sides) {
            if (this.isSkippedTool(side) || invisible(side)) continue
            if (!side.dispinfo) {
                if (isDisplacementSolid) continue
                for (const point of side.points) vertices.add(point)
            } else if (side.points.length === 4) {
                side.grid = displacementGrid(side)
                for (let i = 0; i < side.grid.rows; i++) {
                    for (let j = 0; j < side.grid.cols; j++) {
                        vertices.add(side.grid.point(i, j))
                    }
                }
            } else {
                this.warn(
                    `Displacement side ${side.id} in solid ${solid.id} is not four-sided`,
                )
            }
        }

        state.obj.push("", "", `o ${solid.id}`, "")
        for (const p of vertices.list)
            state.obj.push(`v ${p[0]} ${p[1]} ${p[2]}`)

        state.obj.push("")

        const faces = []
        for (const side of solid.sides) {
            if (!side.dispinfo && isDisplacementSolid) continue
            if (this.isSkippedTool(side)) {
                state.stats.toolFaces++
                continue
            }
            if (invisible(side)) {
                state.stats.invisibleFaces++
                continue
            }
            const material = materialNames.get(side.material.toLowerCase())
            const texture = material && state.textures.get(material)
            if (!texture) {
                continue
            }
            if (!side.uAxis || !side.vAxis) {
                this.warn(
                    `Side ${side.id} in solid ${solid.id} has no texture axes`,
                )
                continue
            }

            const { width, height } = texture
            const mapping = textureMapping(side, width, height)
            const textureCoords = mapping.coords

            if (!side.dispinfo) {
                // Overlays and decals on this face are drawn into its own
                // texture copy
                const baked = await this.bakeSideOverlays(
                    state,
                    side,
                    texture,
                    mapping,
                )
                let text = ""
                side.points.forEach((p, i) => {
                    // Source's t runs down the image while OBJ's v runs up, so only v
                    // is flipped. (The Java version also negated u here, mirroring
                    // every brush texture; its displacement code already didn't.)
                    const [u, v] = textureCoords(p)
                    state.obj.push(
                        baked
                            ? `vt ${baked.u(u)} ${baked.v(v)}`
                            : `vt ${u} ${-v + height}`,
                    )
                    text += `${vertices.indexOf(p) + state.v}/${i + state.vt} `
                })
                faces.push({ text, material: baked?.material ?? material })
                state.vt += side.points.length
            } else if (side.grid) {
                const { rows, cols, point } = side.grid
                // Blend materials get a texture with the blend baked in,
                // spanning the vertex grid
                const blend = await this.bakeDisplacementBlend(
                    state,
                    side,
                    texture,
                    textureCoords,
                )
                for (let i = 0; i < rows - 1; i++) {
                    for (let j = 0; j < cols - 1; j++) {
                        let text = ""
                        for (const [di, dj] of [
                            [0, 0],
                            [1, 0],
                            [1, 1],
                            [0, 1],
                        ]) {
                            const p = point(i + di, j + dj)
                            if (blend) {
                                state.obj.push(
                                    `vt ${(j + dj) / (cols - 1)} ${1 - (i + di) / (rows - 1)}`,
                                )
                            } else {
                                const [u, v] = textureCoords(p)
                                state.obj.push(`vt ${u} ${-v + height}`)
                            }
                            text += `${vertices.indexOf(p) + state.v}/${state.vt} `
                            state.vt++
                        }
                        faces.push({ text, material: blend ?? material })
                    }
                }
            }
        }

        state.obj.push("")
        state.v += vertices.list.length
        this.writeFaces(state, faces)
        state.stats.solids++
    }

    writeFaces(state, faces) {
        let lastMaterial = null
        for (const face of faces) {
            if (face.material !== lastMaterial)
                state.obj.push(`usemtl ${face.material}`)
            lastMaterial = face.material
            state.obj.push(`f ${face.text}`)
        }
        state.stats.faces += faces.length
    }

    // -----------------------------------------------------------------------
    // Materials & textures
    // -----------------------------------------------------------------------

    /**
     * Make a material usable by faces in this OBJ: resolve its VMT, export the
     * base texture and add an MTL entry. Tinted uses (material $color/$color2
     * and the entity's render color) get their own "<name>_tint_<rgb>" material
     * and texture copy, since the MDL step only keeps the texture image.
     * Materials or textures that can't be found or read use the purple/black
     * placeholder texture instead.
     * @param {number[]|null} entityTint - Render color of the owning entity
     * @returns {Promise<string>} Material name for the faces
     */
    async registerMaterial(state, name, candidates, entityTint = null) {
        const info = await this.resolveMaterial(candidates)
        if (info.error) {
            this.warnOnce(
                `material:${name}`,
                `${info.error}: ${name} (using a placeholder texture)`,
            )
            return this.registerPlaceholder(state, name)
        }
        if (info.glass) {
            return this.registerGlass(
                state,
                name,
                combineTints(info.glass, entityTint) ?? [1, 1, 1],
            )
        }

        // Faded out completely ($alpha 0)
        if (info.alpha === 0 && !info.modulate) return INVISIBLE

        const tint = combineTints(info.tint, entityTint)
        const suffix = tint ? `_tint_${tintKey(tint, info.tintMask)}` : ""
        const materialName = `${name}${suffix}`
        if (state.textures.has(materialName)) return materialName

        const textureName = `${info.basetexture}${suffix}`
        const texture = await this.exportTexture(
            state.outDir,
            info.basetexture,
            {
                outputName: textureName,
                withAlpha: info.translucent || info.alphatest,
                tint,
                tintMask: info.tintMask,
            },
        )
        // See-through everywhere, like BEE2's invisible collision material
        if (texture.invisible && (info.translucent || info.alphatest)) {
            return INVISIBLE
        }
        if (!texture.written) {
            if (!texture.found) {
                this.warnOnce(
                    `texture:${info.basetexture}`,
                    `Missing texture: ${info.basetexture} (using a placeholder texture)`,
                )
            }
            return this.registerPlaceholder(state, materialName)
        }
        state.textures.set(materialName, {
            width: texture.width,
            height: texture.height,
            // How to get the pixels again, for baking
            texture: info.basetexture,
            texture2: info.basetexture2,
            blendModulate: info.blendModulate,
            tint,
            tintMask: info.tintMask,
            alphaMode: info.translucent
                ? "translucent"
                : info.alphatest
                  ? "alphatest"
                  : null,
        })

        let bumpmap = null
        if (this.includeBumpMaps && info.bumpmap) {
            bumpmap = info.bumpmap
            await this.exportTexture(state.outDir, info.bumpmap, {
                outputName: info.bumpmap,
                withAlpha: false,
            })
        }

        state.mtl.push(
            "",
            `newmtl ${materialName}`,
            "Ka 1.000 1.000 1.000",
            "Kd 1.000 1.000 1.000",
            "Ks 0.000 0.000 0.000",
            `map_Ka materials/${textureName}.png`,
            `map_Kd materials/${textureName}.png`,
        )
        if (bumpmap) state.mtl.push(`map_bump materials/${bumpmap}.png`)
        if (info.translucent || info.alphatest) {
            // The marker tells BeePEE's VMT generation how to use the alpha
            state.mtl.push(
                "illum 4",
                `# beepee:${info.translucent ? "translucent" : "alphatest"}`,
            )
        }
        state.mtl.push("")
        state.stats.materials++
        return materialName
    }

    /**
     * A material with a texture of one color (things drawn without a
     * model, like gel blobs)
     * @param {number[]} color - 0-255 RGB
     */
    async registerColor(state, materialName, color) {
        if (state.textures.has(materialName)) return materialName
        const textureName = `${COLOR_FOLDER}/${materialName}`
        const key = `${state.outDir}|${textureName}`
        if (!this.textures.has(key)) {
            this.textures.set(
                key,
                (async () => {
                    const target = path.join(
                        state.outDir,
                        "materials",
                        `${textureName}.png`,
                    )
                    await fs.promises.mkdir(path.dirname(target), {
                        recursive: true,
                    })
                    const rgba = Buffer.alloc(COLOR_SIZE * COLOR_SIZE * 4)
                    for (let o = 0; o < rgba.length; o += 4) {
                        rgba.set([...color, 255], o)
                    }
                    await fs.promises.writeFile(
                        target,
                        encodePng(COLOR_SIZE, COLOR_SIZE, rgba, false),
                    )
                })(),
            )
        }
        await this.textures.get(key)

        state.textures.set(materialName, {
            width: COLOR_SIZE,
            height: COLOR_SIZE,
            alphaMode: null,
        })
        state.mtl.push(
            "",
            `newmtl ${materialName}`,
            "Ka 1.000 1.000 1.000",
            "Kd 1.000 1.000 1.000",
            "Ks 0.000 0.000 0.000",
            `map_Ka materials/${textureName}.png`,
            `map_Kd materials/${textureName}.png`,
            "",
        )
        state.stats.materials++
        return materialName
    }

    /** Give a material the purple/black placeholder texture */
    async registerPlaceholder(state, materialName) {
        if (state.textures.has(materialName)) return materialName
        await this.exportPlaceholder(state.outDir)
        state.textures.set(materialName, {
            width: PLACEHOLDER_SIZE,
            height: PLACEHOLDER_SIZE,
            placeholder: true,
            alphaMode: null,
        })
        state.mtl.push(
            "",
            `newmtl ${materialName}`,
            "Ka 1.000 1.000 1.000",
            "Kd 1.000 1.000 1.000",
            "Ks 0.000 0.000 0.000",
            `map_Ka materials/${PLACEHOLDER_TEXTURE}.png`,
            `map_Kd materials/${PLACEHOLDER_TEXTURE}.png`,
            "",
        )
        state.stats.materials++
        state.stats.placeholderMaterials++
        return materialName
    }

    /**
     * Give glass (the Refract shader, which has no base texture) a
     * see-through texture in its tint
     * @param {number[]} tint - 0-1 RGB
     */
    async registerGlass(state, name, tint) {
        const color = glassColor(tint)
        const hex = color
            .slice(0, 3)
            .map((value) => value.toString(16).padStart(2, "0"))
            .join("")
        const materialName = `${name}_glass_${hex}`
        if (state.textures.has(materialName)) return materialName

        const textureName = `${GLASS_FOLDER}/glass_${hex}`
        const key = `${state.outDir}|${textureName}`
        if (!this.textures.has(key)) {
            this.textures.set(
                key,
                (async () => {
                    const target = path.join(
                        state.outDir,
                        "materials",
                        `${textureName}.png`,
                    )
                    await fs.promises.mkdir(path.dirname(target), {
                        recursive: true,
                    })
                    const { rgba } = glassTexture(color)
                    await fs.promises.writeFile(
                        target,
                        encodePng(GLASS_SIZE, GLASS_SIZE, rgba, true),
                    )
                })(),
            )
        }
        await this.textures.get(key)

        state.textures.set(materialName, {
            width: GLASS_SIZE,
            height: GLASS_SIZE,
            glass: color,
            alphaMode: "translucent",
        })
        state.mtl.push(
            "",
            `newmtl ${materialName}`,
            "Ka 1.000 1.000 1.000",
            "Kd 1.000 1.000 1.000",
            "Ks 0.000 0.000 0.000",
            `map_Ka materials/${textureName}.png`,
            `map_Kd materials/${textureName}.png`,
            // The marker tells BeePEE's VMT generation how to use the alpha
            "illum 4",
            "# beepee:translucent",
            "",
        )
        state.stats.materials++
        return materialName
    }

    exportPlaceholder(outDir) {
        const key = `${outDir}|${PLACEHOLDER_TEXTURE}`
        if (!this.textures.has(key)) {
            this.textures.set(
                key,
                (async () => {
                    const target = path.join(
                        outDir,
                        "materials",
                        `${PLACEHOLDER_TEXTURE}.png`,
                    )
                    await fs.promises.mkdir(path.dirname(target), {
                        recursive: true,
                    })
                    await fs.promises.writeFile(
                        target,
                        encodePng(
                            PLACEHOLDER_SIZE,
                            PLACEHOLDER_SIZE,
                            placeholderPixels(),
                            false,
                        ),
                    )
                })(),
            )
        }
        return this.textures.get(key)
    }

    resolveMaterial(candidates) {
        const key = candidates.map(normalizeContentPath).join("|")
        if (!this.materials.has(key)) {
            this.materials.set(key, this.loadMaterial(candidates))
        }
        return this.materials.get(key)
    }

    async loadMaterial(candidates) {
        for (const candidate of candidates) {
            const contentPath = normalizeContentPath(candidate)
            if (!this.resources.has(contentPath)) continue
            try {
                const vmt = await this.readVmt(contentPath, 0)
                const info = describeMaterial(vmt.shader, vmt.params)
                return info.basetexture || info.glass
                    ? info
                    : { error: "Material has no texture" }
            } catch {
                return { error: "Failed to parse material" }
            }
        }
        return { error: "Missing material" }
    }

    /** Read a VMT, resolving "patch" materials through their include */
    async readVmt(contentPath, depth) {
        const vmt = parseVmt(
            (await this.resources.read(contentPath)).toString("utf8"),
        )
        if (vmt.shader !== "patch") return vmt

        let base = { shader: "patch", params: new Map() }
        if (vmt.include && depth < 4) {
            let include = normalizeContentPath(vmt.include)
            if (!include.endsWith(".vmt")) include += ".vmt"
            if (!include.startsWith("materials/"))
                include = `materials/${include}`
            if (this.resources.has(include))
                base = await this.readVmt(include, depth + 1)
        }
        const params = new Map(base.params)
        for (const [key, value] of vmt.params) params.set(key, value)
        return { shader: base.shader, params }
    }

    /**
     * Write materials/<outputName>.png for a VTF (once per output folder)
     * @param {{outputName: string, withAlpha: boolean, tint?: number[]|null, tintMask?: boolean}} options
     */
    exportTexture(outDir, texture, options) {
        const key = `${outDir}|${options.outputName}`
        if (!this.textures.has(key)) {
            this.textures.set(key, this.writeTexture(outDir, texture, options))
        }
        return this.textures.get(key)
    }

    /**
     * @returns {Promise<{found: boolean, written?: boolean, width?: number, height?: number, invisible?: boolean}>}
     *   invisible: written with alpha, which is 0 everywhere
     */
    async writeTexture(outDir, texture, options) {
        const data = await this.resources.read(`materials/${texture}.vtf`)
        if (!data) return { found: false }
        await this.yieldIfBusy()

        let image
        try {
            image = decodeVtf(data)
        } catch (error) {
            this.warnOnce(
                `decode:${texture}`,
                `Could not convert texture ${texture}: ${error.message} (using a placeholder texture)`,
            )
            return { found: true, written: false }
        }

        const { width, height, rgba } = image
        const pixels = options.tint
            ? applyTint(rgba, options.tint, options.tintMask)
            : rgba
        const target = safeJoin(
            path.join(outDir, "materials"),
            `${options.outputName}.png`,
        )
        await fs.promises.mkdir(path.dirname(target), { recursive: true })
        await fs.promises.writeFile(
            target,
            encodePng(width, height, pixels, options.withAlpha),
        )
        let invisible = options.withAlpha
        for (let i = 3; invisible && i < pixels.length; i += 4) {
            if (pixels[i] !== 0) invisible = false
        }
        return { found: true, written: true, width, height, invisible }
    }

    // -----------------------------------------------------------------------
    // Props
    // -----------------------------------------------------------------------

    /**
     * The model an entity draws: its "model" keyvalue, else a built-in one
     * @returns {{path: string|null, skin: number|null, gel?: number}|null}
     *   skin is the default skin for built-in models (the entity's "skin"
     *   keyvalue still wins); gel is a gel blob's paint type (no model)
     */
    modelOf(entity) {
        const classname = entity.classname.toLowerCase()
        if (classname === "prop_paint_bomb") {
            // A blob of gel the game draws itself (see GEL_COLORS)
            const type = Number.parseInt(entity.get("painttype") ?? "0", 10)
            return { path: null, skin: null, gel: GEL_COLORS[type] ? type : 0 }
        }
        if (classname === "npc_portal_turret_floor") {
            // "ModelIndex" picks the model (normal, box, backwards, skeleton
            // or the "model" keyvalue) and "SkinNumber" the skin, like the
            // game does
            const index = Number.parseInt(entity.get("modelindex") ?? "0", 10)
            const custom = index === 1 ? entity.get("model") : null
            return {
                path: custom
                    ? normalizeContentPath(custom)
                    : (TURRET_MODELS[index] ?? TURRET_MODELS[0]),
                skin: Number.parseInt(entity.get("skinnumber") ?? "0", 10) || 0,
            }
        }
        if (classname === "prop_weighted_cube") {
            // The cube type picks the model and the skin type the rusted
            // skin, like the game does. The "model" keyvalue is only shown in
            // Hammer, unless the cube has a custom model (cube type 6, or a
            // HammerAddons custom model type).
            const type = Number.parseInt(entity.get("cubetype") ?? "0", 10)
            const customType = Number.parseInt(
                entity.get("comp_custom_model_type") ?? "0",
                10,
            )
            const custom = entity.get("model")
            if ((type === 6 || customType > 0) && custom) {
                return { path: normalizeContentPath(custom), skin: null }
            }
            const cube = CUBE_TYPES[type] ?? CUBE_TYPES[0]
            // Older maps ("newskins" 0) set the skin themselves
            if (entity.get("newskins") === "0") {
                return { path: cube.path, skin: null }
            }
            const rusted =
                entity.get("skintype") === "1" && cube.rustedSkin !== undefined
            return { path: cube.path, skin: rusted ? cube.rustedSkin : cube.skin }
        }
        const model = entity.get("model")
        if (model) return { path: normalizeContentPath(model), skin: null }
        const builtIn = BUILT_IN_MODELS[classname]
        return builtIn ? { path: builtIn, skin: null } : null
    }

    getModel(modelPath) {
        if (!this.models.has(modelPath)) {
            const context = {
                resources: this.resources,
                tempDir: this.tempDir,
                crowbarPath: this.crowbarPath,
            }
            this.models.set(
                modelPath,
                loadModel(context, modelPath).catch((error) => ({ error })),
            )
        }
        return this.models.get(modelPath)
    }

    /** Decompile all prop models up front, a few at a time */
    async preloadModels(props) {
        const paths = [
            ...new Set(
                props
                    .map((entity) => this.modelOf(entity)?.path)
                    .filter((p) => p && p.endsWith(".mdl")),
            ),
        ]
        let next = 0
        const worker = async () => {
            while (next < paths.length) await this.getModel(paths[next++])
        }
        await Promise.all(
            Array.from(
                { length: Math.min(this.modelConcurrency, paths.length) },
                worker,
            ),
        )
    }

    readAnimation(file) {
        if (!this.animations.has(file)) {
            this.animations.set(
                file,
                fs.promises
                    .readFile(file, "utf8")
                    .then((text) => parseSmd(text, { triangles: false })),
            )
        }
        return this.animations.get(file)
    }

    getGeometry(modelPath, model, pose, sequence) {
        const key = `${modelPath}|${pose}|${(sequence || "").toLowerCase()}`
        if (!this.geometry.has(key)) {
            this.geometry.set(
                key,
                buildModelGeometry(model, {
                    pose,
                    sequence,
                    lastFrame: this.useLastAnimFrame,
                    readAnimation: (file) => this.readAnimation(file),
                }),
            )
        }
        return this.geometry.get(key)
    }

    async writeProp(state, entity) {
        const modelInfo = this.modelOf(entity)
        if (modelInfo?.gel !== undefined) {
            await this.writeGelBlob(state, entity, modelInfo.gel)
            return
        }
        const modelPath = modelInfo?.path
        if (!modelPath) {
            this.warn(`Prop has no model? ${entity.classname}`)
            state.stats.skippedModels++
            return
        }
        if (!modelPath.endsWith(".mdl")) {
            this.warnOnce(
                `model:${modelPath}`,
                `Not a model, skipping: ${modelPath}`,
            )
            state.stats.skippedModels++
            return
        }
        const model = await this.getModel(modelPath)
        if (model.error) {
            this.warnOnce(
                `model:${modelPath}`,
                `Skipping ${modelPath}: ${model.error.message}`,
            )
            state.stats.skippedModels++
            return
        }
        if (model.missing.length) {
            this.warnOnce(
                `bodies:${modelPath}`,
                `Missing SMD for ${modelPath}, skipped: ${model.missing.join(", ")}`,
            )
        }

        // Static props render in their reference pose; others show a sequence
        const pose = !/^prop_(static|detail)/i.test(entity.classname)
        const sequence = pose ? entity.get("defaultanim") || null : null
        const geometry = await this.getGeometry(
            modelPath,
            model,
            pose,
            sequence,
        )
        if (geometry.warning) {
            this.warnOnce(
                `anim:${modelPath}|${sequence}`,
                `${modelPath}: ${geometry.warning}`,
            )
        }

        let scale = Number.parseFloat(
            entity.get("uniformscale") ?? entity.get("modelscale"),
        )
        if (!Number.isFinite(scale)) scale = 1
        const matrix = entityMatrix(
            parseVector(entity.get("angles")),
            parseVector(entity.get("origin")),
        )
        // Cubes pick their skin from the cube type, like the game does
        const skin = skinMapper(
            model.qc,
            modelInfo.skin ?? Number.parseInt(entity.get("skin") ?? "0", 10),
        )

        const vertices = new VertexList()
        const triangles = geometry.triangles.map((tri) => ({
            material: skin(tri.material),
            verts: tri.verts.map((v) => {
                const normal = normalize(transformDirection(matrix, v.normal))
                return {
                    pos: transformPoint(matrix, [
                        v.pos[0] * scale,
                        v.pos[1] * scale,
                        v.pos[2] * scale,
                    ]),
                    normal: normal.some(Number.isNaN) ? [0, 0, 1] : normal,
                    uv: v.uv,
                }
            }),
        }))
        const cdmaterials = model.qc.cdmaterials.length
            ? model.qc.cdmaterials
            : [""]
        const candidates = (material) =>
            cdmaterials.map(
                (dir) => `materials/${dir ? `${dir}/` : ""}${material}.vmt`,
            )
        const materials = [...new Set(triangles.map((tri) => tri.material))]

        // The render color tints the model as the game does: materials with
        // a tint mask ($blendtintbybasealpha) inside their mask, the others
        // whole (like the tint strips of BEE2's color cubes, or a model with
        // no mask at all)
        const entityTint = parseRenderColor(entity.get("rendercolor"))

        const materialNames = new Map()
        for (const material of materials) {
            const name = await this.registerMaterial(
                state,
                material,
                candidates(material),
                entityTint,
            )
            // Prop faces are kept even without a material (as in VMF2OBJ)
            materialNames.set(material, name ?? material)
        }

        // Triangles whose material can't be seen are left out
        const shownTriangles = triangles.filter((tri) => {
            if (materialNames.get(tri.material) !== INVISIBLE) return true
            state.stats.invisibleFaces++
            return false
        })
        for (const tri of shownTriangles)
            for (const v of tri.verts) vertices.add(v.pos)

        const modelName = path.posix
            .basename(model.qc.modelName || modelPath)
            .replace(/\.[^.]*$/, "")
        state.obj.push("", "", `o ${modelName}`, "")
        for (const p of vertices.list)
            state.obj.push(`v ${p[0]} ${p[1]} ${p[2]}`)

        state.obj.push("")

        const faces = []
        for (const tri of shownTriangles) {
            let text = ""
            tri.verts.forEach((v, i) => {
                state.obj.push(`vt ${v.uv[0]} ${v.uv[1]}`)
                state.obj.push(
                    `vn ${v.normal[0]} ${v.normal[1]} ${v.normal[2]}`,
                )
                text += `${vertices.indexOf(v.pos) + state.v}/${i + state.vt}/${i + state.vn} `
            })
            faces.push({ text, material: materialNames.get(tri.material) })
            state.vt += tri.verts.length
            state.vn += tri.verts.length
        }

        state.obj.push("")
        state.v += vertices.list.length
        this.writeFaces(state, faces)
        state.stats.props++
    }

    /** Draw a prop_paint_bomb: a ball in its gel's color (GEL_COLORS) */
    async writeGelBlob(state, entity, type) {
        const material = await this.registerColor(
            state,
            `bpee_gel_${type}`,
            GEL_COLORS[type],
        )
        const origin = parseVector(entity.get("origin"))
        const triangles = GEL_BALL.map((corners) =>
            corners.map(({ pos, uv }) => ({
                pos: pos.map((value, i) => origin[i] + value * GEL_RADIUS),
                normal: pos,
                uv,
            })),
        )
        const vertices = new VertexList()
        for (const tri of triangles) for (const v of tri) vertices.add(v.pos)

        state.obj.push("", "", `o gel_blob_${type}`, "")
        for (const p of vertices.list)
            state.obj.push(`v ${p[0]} ${p[1]} ${p[2]}`)
        state.obj.push("")

        const faces = []
        for (const tri of triangles) {
            let text = ""
            tri.forEach((v, i) => {
                state.obj.push(`vt ${v.uv[0]} ${v.uv[1]}`)
                state.obj.push(
                    `vn ${v.normal[0]} ${v.normal[1]} ${v.normal[2]}`,
                )
                text += `${vertices.indexOf(v.pos) + state.v}/${i + state.vt}/${i + state.vn} `
            })
            faces.push({ text, material })
            state.vt += tri.length
            state.vn += tri.length
        }

        state.obj.push("")
        state.v += vertices.list.length
        this.writeFaces(state, faces)
        state.stats.props++
    }

    // -----------------------------------------------------------------------
    // Overlays, decals and displacement blends (baked into textures)
    // -----------------------------------------------------------------------

    /**
     * Parse the VMF's info_overlay entities and index them by the brush
     * sides they're on, in drawing order (render order, then VMF order)
     * @returns {Object[]} The parsed overlays
     */
    collectOverlays(state, vmf) {
        const overlays = []
        for (const entity of vmf.entities) {
            if (entity.classname.toLowerCase() !== "info_overlay") continue
            const overlay = parseOverlay(entity, overlays.length)
            if (!overlay) {
                this.warn(
                    `Skipping overlay ${entity.get("id") ?? "?"}: incomplete keyvalues`,
                )
                continue
            }
            overlays.push(overlay)
        }
        const ordered = [...overlays].sort(
            (a, b) => a.renderOrder - b.renderOrder || a.index - b.index,
        )
        for (const overlay of ordered) {
            for (const side of overlay.sides) {
                if (!state.overlaysBySide.has(side)) {
                    state.overlaysBySide.set(side, [])
                }
                state.overlaysBySide.get(side).push(overlay)
            }
        }
        return overlays
    }

    /**
     * Parse the VMF's infodecal entities (drawn after overlays, in VMF order)
     * @returns {Object[]}
     */
    collectDecals(vmf) {
        const decals = []
        for (const entity of vmf.entities) {
            if (entity.classname.toLowerCase() !== "infodecal") continue
            const decal = parseDecal(entity, decals.length)
            if (!decal) {
                this.warn(
                    `Skipping decal ${entity.get("id") ?? "?"}: no texture or origin`,
                )
                continue
            }
            decals.push(decal)
        }
        return decals
    }

    /**
     * Warn about overlays or decals that ended up on no face: overlays without
     * "sides" or with sides that aren't in this VMF, decals further than 4
     * units from every face, and anything only on displacements or skipped
     * tool faces. VBSP and the engine leave those out too.
     * @param {"overlay"|"decal"} kind
     * @returns {number} How many were drawn
     */
    reportLeftOut(state, items, kind) {
        const [one, many, where] =
            kind === "overlay"
                ? ["An overlay", "overlays", "on any visible brush face"]
                : ["A decal", "decals", "close to any visible brush face"]
        const leftOut = new Map()
        for (const item of items) {
            // Decals without a usable material were already warned about
            if (state.painted.has(item) || item.missing) continue
            leftOut.set(item.material, (leftOut.get(item.material) ?? 0) + 1)
        }
        for (const [material, count] of leftOut) {
            this.warn(
                count === 1
                    ? `${one} (${material}) is not ${where} in this instance, so it was left out`
                    : `${count} ${many} (${material}) are not ${where} in this instance, so they were left out`,
            )
        }
        return items.filter((item) => state.painted.has(item)).length
    }

    /**
     * An overlay or decal material, ready to draw: its (tinted) texture and
     * how it blends. Without a usable texture, overlays use the placeholder
     * texture, while decals (which are sized by their texture) get null.
     */
    async decorationMaterial(state, material, placeholderIfMissing) {
        const info = await this.resolveMaterial([`materials/${material}.vmt`])
        const fallback = placeholderIfMissing
            ? " (using a placeholder texture)"
            : " (decal left out)"
        let texture = null
        if (info.error) {
            this.warnOnce(
                `material:${material}`,
                `${info.error}: ${material}${fallback}`,
            )
        } else {
            texture = await this.texturePixels(
                state,
                info.basetexture,
                info.tint,
                info.tintMask,
            )
            if (!texture) {
                this.warnOnce(
                    `texture:${info.basetexture}`,
                    `Missing texture: ${info.basetexture}${fallback}`,
                )
            }
        }
        if (texture) {
            return {
                texture,
                blend: blendMode(info),
                translucent: info.translucent,
                alpha: info.alpha,
                alphaTestReference: info.alphaTestReference,
                decalScale: info.decalScale,
            }
        }
        if (!placeholderIfMissing) return null
        return {
            texture: placeholderTexture(),
            blend: "opaque",
            translucent: false,
            alpha: 1,
            alphaTestReference: 0.5,
            decalScale: 1,
        }
    }

    /**
     * Draw the overlays and decals on a brush face into a copy of the face's
     * texture (see overlays.js). The copy gets its own material, and the
     * face's texture coordinates are mapped onto it.
     * @param {Object} texture - The face material's state.textures entry
     * @param {Object} mapping - textureMapping() of the face for that texture
     * @returns {Promise<{material: string, u: (u: number) => number, v: (v: number) => number}|null>}
     *   null when nothing is drawn on the face
     */
    async bakeSideOverlays(state, side, texture, mapping) {
        const overlays = state.overlaysBySide.get(String(side.id)) ?? []
        // The face's outward normal (its plane points wind the other way)
        const normal = scale(mapping.normal, -1)
        const decals = decalsNearFace(state.decals, side.plane, normal)
        if (!overlays.length && !decals.length) return null

        const base = texture.placeholder
            ? placeholderTexture()
            : texture.glass
              ? glassTexture(texture.glass)
              : await this.texturePixels(
                  state,
                  texture.texture,
                  texture.tint,
                  texture.tintMask,
              )
        if (!base) return null

        const layers = []
        for (const overlay of overlays) {
            layers.push({
                overlay,
                ...(await this.decorationMaterial(
                    state,
                    overlay.material,
                    true,
                )),
            })
        }
        for (const decal of decals) {
            const material = await this.decorationMaterial(
                state,
                decal.material,
                false,
            )
            if (!material) {
                decal.missing = true
                continue
            }
            // Decals are as big as their texture (times $decalscale)
            const { width, height } = material.texture
            layers.push({
                overlay: decalProjection(
                    decal,
                    normal,
                    width * material.decalScale,
                    height * material.decalScale,
                ),
                ...material,
            })
        }

        const baked = bakeOverlays(
            {
                points: side.points,
                mapping,
                texture: base,
                keepAlpha: !!texture.alphaMode,
            },
            layers,
        )
        if (!baked) return null
        for (const drawn of baked.painted)
            state.painted.add(drawn.source ?? drawn)

        const material = await this.writeBakedTexture(
            state,
            OVERLAY_FOLDER,
            `bpee_overlay_${state.outputKey}_${side.id}`,
            baked,
            texture.alphaMode,
        )
        const { uMin, uMax, vMin, vMax } = baked.bounds
        return {
            material,
            u: (u) => (u - uMin) / (uMax - uMin),
            // Source's t runs down the image while OBJ's v runs up
            v: (v) => 1 - (v - vMin) / (vMax - vMin),
        }
    }

    /**
     * Bake a displacement's blend material ($basetexture2, blended in by the
     * vertex alphas) into a texture for the displacement (see blends.js)
     * @param {Object} texture - The material's state.textures entry
     * @returns {Promise<string|null>} The baked material; null when the
     *   material doesn't blend or the displacement only shows $basetexture
     */
    async bakeDisplacementBlend(state, side, texture, textureCoords) {
        const { alphas } = side.dispinfo
        if (
            !texture.texture2 ||
            !alphas.some((row) => row.some((alpha) => alpha > 0))
        ) {
            return null
        }

        const base = await this.texturePixels(
            state,
            texture.texture,
            texture.tint,
            texture.tintMask,
        )
        const base2 = await this.texturePixels(
            state,
            texture.texture2,
            texture.tint,
            texture.tintMask,
        )
        if (!base2) {
            this.warnOnce(
                `texture:${texture.texture2}`,
                `Missing texture: ${texture.texture2} (displacements show only their first texture)`,
            )
        }
        if (!base || !base2) return null
        const modulate = texture.blendModulate
            ? await this.texturePixels(state, texture.blendModulate)
            : null

        const { rows, cols, point } = side.grid
        const image = bakeBlend(
            {
                rows,
                cols,
                uv: (i, j) => textureCoords(point(i, j)),
                alpha: (i, j) => (alphas[i]?.[j] ?? 0) / 255,
            },
            base,
            base2,
            modulate,
            !!texture.alphaMode,
        )
        state.stats.blends++
        return this.writeBakedTexture(
            state,
            BLEND_FOLDER,
            `bpee_blend_${state.outputKey}_${side.id}`,
            image,
            texture.alphaMode,
        )
    }

    /**
     * Write a baked texture to materials/<folder>/ and give it a material of
     * its own (named like the texture, which must be unique in an item)
     * @returns {Promise<string>} The material name
     */
    async writeBakedTexture(state, folder, baseName, image, alphaMode) {
        let name = baseName
        for (let n = 2; state.textures.has(name); n++) name = `${baseName}_${n}`
        const target = safeJoin(
            path.join(state.outDir, "materials"),
            `${folder}/${name}.png`,
        )
        await fs.promises.mkdir(path.dirname(target), { recursive: true })
        await fs.promises.writeFile(
            target,
            encodePng(image.width, image.height, image.rgba, !!alphaMode),
        )

        state.textures.set(name, {
            width: image.width,
            height: image.height,
            alphaMode,
        })
        state.mtl.push(
            "",
            `newmtl ${name}`,
            "Ka 1.000 1.000 1.000",
            "Kd 1.000 1.000 1.000",
            "Ks 0.000 0.000 0.000",
            `map_Ka materials/${folder}/${name}.png`,
            `map_Kd materials/${folder}/${name}.png`,
        )
        if (alphaMode) state.mtl.push("illum 4", `# beepee:${alphaMode}`)
        state.mtl.push("")
        state.stats.materials++
        return name
    }

    /**
     * Decoded (and tinted) pixels of a VTF, decoded once per conversion
     * @returns {Promise<{width: number, height: number, rgba: Buffer}|null>}
     */
    texturePixels(state, texture, tint, tintMask) {
        const key = tint ? `${texture}|${tintKey(tint, tintMask)}` : texture
        if (!state.pixels.has(key)) {
            state.pixels.set(
                key,
                (async () => {
                    const data = await this.resources.read(
                        `materials/${texture}.vtf`,
                    )
                    if (!data) return null
                    try {
                        const { width, height, rgba } = decodeVtf(data)
                        return {
                            width,
                            height,
                            rgba: tint ? applyTint(rgba, tint, tintMask) : rgba,
                        }
                    } catch {
                        return null
                    }
                })(),
            )
        }
        return state.pixels.get(key)
    }
}

/**
 * Convert a single VMF (creates and disposes its own converter session)
 * @param {string} vmfPath
 * @param {string} outputBase - Output path without extension
 * @param {Object} options - See VmfConverter
 */
async function convertVmf(vmfPath, outputBase, options = {}) {
    const converter = await new VmfConverter(options).init()
    try {
        return await converter.convert(vmfPath, outputBase)
    } finally {
        await converter.dispose()
    }
}

/**
 * Whether a parsed VMF (parseVmf) has anything to draw: brushes or model
 * entities that can be seen at the start. Their textures aren't checked, so
 * only tool-textured brushes still count.
 */
function hasDrawableContent(vmf) {
    if (vmf.solids.some((solid) => !hiddenAtStart(solid.owner))) return true
    // isModelEntity and modelOf don't use a session (no init needed)
    const converter = Object.create(VmfConverter.prototype)
    return vmf.entities.some(
        (entity) => converter.isModelEntity(entity) && !hiddenAtStart(entity),
    )
}

module.exports = {
    VmfConverter,
    convertVmf,
    assertHasGeometry,
    hasDrawableContent,
}
