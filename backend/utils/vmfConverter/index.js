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
    readVtfSize,
    encodePng,
} = require("./textures")
const {
    loadModel,
    buildModelGeometry,
    parseSmd,
    skinMapper,
} = require("./models")
const {
    dot,
    vectorKey,
    entityMatrix,
    transformPoint,
    transformDirection,
    normalize,
} = require("./math")

const HEADER =
    "# Converted by BeePEE (JavaScript port of VMF2OBJ by Dylancyclone)"

function parseVector(value) {
    const n = parseNumbers(value)
    return n.length >= 3 ? n.slice(0, 3) : [0, 0, 0]
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
    if (stats.toolFaces > 0) {
        reasons.push(
            `${stats.toolFaces} brush face(s) only use tool textures, which are skipped.`,
        )
    }
    if (stats.unresolvedFaces > 0) {
        reasons.push(
            `${stats.unresolvedFaces} brush face(s) use materials that couldn't be found.`,
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
     * @param {boolean} [options.skipTools] - Skip faces with tools/ materials
     * @param {boolean} [options.useLastAnimFrame] - Pose props with the last frame instead of the first
     * @param {boolean} [options.includeBumpMaps] - Also export $bumpmap textures (map_bump)
     * @param {boolean} [options.quiet] - Collect warnings without logging them
     * @param {number} [options.timeoutMs] - Abort when the whole session takes longer than this
     * @param {Object} [options.logger] - console-like logger
     */
    constructor(options = {}) {
        this.resourcePaths = options.resourcePaths || []
        this.crowbarPath = options.crowbarPath || null
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
            obj: [HEADER, "", `mtllib ${path.basename(mtlPath)}`],
            mtl: [HEADER, ""],
            v: 1,
            vt: 1,
            vn: 1,
            textures: new Map(),
            stats: {
                solids: 0,
                props: 0,
                faces: 0,
                materials: 0,
                brushes: vmf.solids.length,
                modelEntities: 0,
                toolFaces: 0,
                unresolvedFaces: 0,
                skippedModels: 0,
            },
        }

        for (const solid of vmf.solids) {
            await this.writeSolid(state, solid)
            await this.yieldIfBusy()
        }

        const props = vmf.entities.filter((entity) =>
            this.isModelEntity(entity),
        )
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

    isSkippedTool(side) {
        return this.skipTools && side.material.toLowerCase().includes("tools/")
    }

    /**
     * Entities whose model is drawn in game: prop_* (as VMF2OBJ, which warns
     * when the model is missing) plus anything else with a model, except
     * info_* entities and Hammer-only editor models (spawn points, helpers)
     */
    isModelEntity(entity) {
        const classname = entity.classname.toLowerCase()
        if (classname.includes("prop_")) return true
        const model = this.modelPathOf(entity)
        return (
            !!model &&
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
        const vertices = new VertexList()
        const materials = new Set()

        for (const side of solid.sides) {
            if (this.isSkippedTool(side)) continue
            materials.add(side.material.toLowerCase())
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

        // Brush entities can be tinted with their render color
        const entityTint = parseRenderColor(solid.owner?.get("rendercolor"))
        const materialNames = new Map()
        for (const material of materials) {
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
        state.obj.push("")

        const faces = []
        for (const side of solid.sides) {
            if (!side.dispinfo && isDisplacementSolid) continue
            if (this.isSkippedTool(side)) {
                state.stats.toolFaces++
                continue
            }
            const material = materialNames.get(side.material.toLowerCase())
            const texture = material && state.textures.get(material)
            if (!texture) {
                state.stats.unresolvedFaces++
                continue
            }
            if (!side.uAxis || !side.vAxis) {
                this.warn(
                    `Side ${side.id} in solid ${solid.id} has no texture axes`,
                )
                continue
            }

            const { width, height } = texture
            let uShift = side.uAxis.shift % width
            let vShift = side.vAxis.shift % height
            if (uShift < -width / 2) uShift += width
            if (vShift < -height / 2) vShift += height
            const textureCoords = (p) => [
                dot(p, side.uAxis.axis) / (width * side.uAxis.scale) +
                    uShift / width,
                dot(p, side.vAxis.axis) / (height * side.vAxis.scale) +
                    vShift / height,
            ]

            if (!side.dispinfo) {
                let text = ""
                side.points.forEach((p, i) => {
                    // Source's t runs down the image while OBJ's v runs up, so only v
                    // is flipped. (The Java version also negated u here, mirroring
                    // every brush texture; its displacement code already didn't.)
                    const [u, v] = textureCoords(p)
                    state.obj.push(`vt ${u} ${-v + height}`)
                    text += `${vertices.indexOf(p) + state.v}/${i + state.vt} `
                })
                faces.push({ text, material })
                state.vt += side.points.length
            } else if (side.grid) {
                const { rows, cols, point } = side.grid
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
                            const [u, v] = textureCoords(p)
                            state.obj.push(`vt ${u} ${-v + height}`)
                            text += `${vertices.indexOf(p) + state.v}/${state.vt} `
                            state.vt++
                        }
                        faces.push({ text, material })
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
     * @param {number[]|null} entityTint - Render color of the owning entity
     * @returns {Promise<string|null>} Material name for the faces, or null when
     *   the material can't be resolved (brush faces using it are dropped, as in VMF2OBJ)
     */
    async registerMaterial(state, name, candidates, entityTint = null) {
        const info = await this.resolveMaterial(candidates)
        if (info.error) {
            this.warnOnce(`material:${name}`, `${info.error}: ${name}`)
            return null
        }

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
        if (!texture.found) {
            this.warnOnce(
                `texture:${info.basetexture}`,
                `Missing texture: ${info.basetexture}`,
            )
            state.textures.set(materialName, { width: 1, height: 1 })
            return materialName
        }
        state.textures.set(materialName, {
            width: texture.width,
            height: texture.height,
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
        if (info.translucent || info.alphatest) state.mtl.push("illum 4")
        state.mtl.push("")
        state.stats.materials++
        return materialName
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
                return info.basetexture
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
                `Could not convert texture ${texture}: ${error.message}`,
            )
            try {
                return { found: true, ...readVtfSize(data) }
            } catch {
                return { found: true, width: 1, height: 1 }
            }
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
        return { found: true, width, height }
    }

    // -----------------------------------------------------------------------
    // Props
    // -----------------------------------------------------------------------

    modelPathOf(entity) {
        const model = entity.get("model")
        if (!model) return null
        return normalizeContentPath(model)
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
                    .map((entity) => this.modelPathOf(entity))
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
        const modelPath = this.modelPathOf(entity)
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
        const skin = skinMapper(
            model.qc,
            Number.parseInt(entity.get("skin") ?? "0", 10),
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
        for (const tri of triangles)
            for (const v of tri.verts) vertices.add(v.pos)

        const modelName = path.posix
            .basename(model.qc.modelName || modelPath)
            .replace(/\.[^.]*$/, "")
        state.obj.push("", "", `o ${modelName}`, "")
        for (const p of vertices.list)
            state.obj.push(`v ${p[0]} ${p[1]} ${p[2]}`)

        const cdmaterials = model.qc.cdmaterials.length
            ? model.qc.cdmaterials
            : [""]
        const entityTint = parseRenderColor(entity.get("rendercolor"))
        const materialNames = new Map()
        for (const material of new Set(triangles.map((tri) => tri.material))) {
            const name = await this.registerMaterial(
                state,
                material,
                cdmaterials.map(
                    (dir) => `materials/${dir ? `${dir}/` : ""}${material}.vmt`,
                ),
                entityTint,
            )
            // Prop faces are kept even without a material (as in VMF2OBJ)
            materialNames.set(material, name ?? material)
        }
        state.obj.push("")

        const faces = []
        for (const tri of triangles) {
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

module.exports = { VmfConverter, convertVmf, assertHasGeometry }
