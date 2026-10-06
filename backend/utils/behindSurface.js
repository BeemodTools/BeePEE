/**
 * What an item's instance has behind the surface the item is placed on, the
 * Instances tab's leak warning.
 *
 * Instances are built as if the item sits on the floor: with the usual
 * editoritems Offset "64 64 64", the origin is the center of the item's voxel
 * and the surface is z = -64. On a wall or ceiling the instance is turned so
 * that's still the surface it's on. Behind it is the wall, unless the item
 * embeds into those voxels (EmbeddedVoxels: Pos "0 0 0" is the voxel just
 * behind the surface, "0 0 -1" the one behind that). An entity out there is in
 * the void behind the wall, which makes the map leak. A brush all out there is
 * only hidden in the wall; one that shows in the room is seen (some of Portal
 * 2's own items go a few units in).
 */

const fs = require("fs")
const { parseVmf } = require("./vmfConverter/vmf")
const { completeSolid } = require("./vmfConverter/brushes")

const VOXEL = 128

/** Less than this behind the surface is touching it, or rounding */
const TOLERANCE = 1

/**
 * Entities VBSP takes out when it loads the map, before it looks for leaks
 * (from every other entity's origin): instance helpers, ones it merges into
 * the world's brushes, and ones it turns into something else (overlays,
 * cubemaps, vis clusters). Any other entity counts, props too.
 */
const COMPILED_AWAY = new Set([
    "func_instance",
    "func_instance_parms",
    "func_instance_io_proxy",
    "func_detail",
    "func_viscluster",
    "info_overlay",
    "info_overlay_transition",
    "info_no_dynamic_shadow",
    "env_cubemap",
])

/**
 * Items whose instances are meant to be outside the map: the editor makes
 * room for the corridors and observation rooms itself
 */
const OUTSIDE_CLASSES = new Set([
    "itementrancedoor",
    "itemexitdoor",
    "itemcoopentrancedoor",
    "itemcoopexitdoor",
])
const OUTSIDE_TYPES = new Set([
    "item_observation_room",
    "item_secondary_observation_room",
])

/** How many entities a result lists (it still counts them all) */
const LISTED = 8

const numbers = (text) =>
    String(text ?? "")
        .trim()
        .split(/\s+/)
        .map(Number)

const asList = (value) => (value === undefined ? [] : [value].flat())

/**
 * Where an item's instances are measured from, from its editoritems' Item
 * block (getEditorItems().Item)
 * @returns {{surface: number, embedded: {min: number[], max: number[]}[]}|null}
 *   null for items whose instances are meant to be outside the map
 */
function itemFrame(item) {
    const itemClass = String(item?.ItemClass ?? "").toLowerCase()
    const type = String(item?.Type ?? "").toLowerCase()
    if (OUTSIDE_CLASSES.has(itemClass) || OUTSIDE_TYPES.has(type)) return null

    const exporting = item?.Exporting ?? {}
    // A repeated key comes as a list: the first is the one that counts
    let offset = numbers(asList(exporting.Offset)[0])
    if (offset.length < 3 || offset.some((n) => !Number.isFinite(n))) {
        offset = [64, 64, 64]
    }

    // An embedded voxel's Pos is one voxel down from the occupied voxels'
    // (where 0 0 0 is the item's own, in front of the surface)
    const box = (from, to) => ({
        min: [0, 1, 2].map((axis) => {
            const z = axis === 2 ? 1 : 0
            return (Math.min(from[axis], to[axis]) - z) * VOXEL - offset[axis]
        }),
        max: [0, 1, 2].map((axis) => {
            const z = axis === 2 ? 1 : 0
            return (
                (Math.max(from[axis], to[axis]) - z + 1) * VOXEL -
                offset[axis]
            )
        }),
    })
    const embedded = []
    const voxels = exporting.EmbeddedVoxels ?? {}
    for (const voxel of asList(voxels.Voxel)) {
        const pos = numbers(voxel?.Pos)
        if (pos.length >= 3 && pos.every(Number.isFinite)) {
            embedded.push(box(pos, pos))
        }
    }
    for (const volume of asList(voxels.Volume)) {
        const from = numbers(volume?.Pos1)
        const to = numbers(volume?.Pos2)
        if (
            from.length >= 3 &&
            to.length >= 3 &&
            [...from, ...to].every(Number.isFinite)
        ) {
            embedded.push(box(from, to))
        }
    }
    return { surface: 0 - offset[2], embedded }
}

const inEmbedded = (frame, point) =>
    frame.embedded.some(({ min, max }) =>
        point.every(
            (value, axis) =>
                value >= min[axis] - TOLERANCE &&
                value <= max[axis] + TOLERANCE,
        ),
    )

/**
 * The brushes and entities of a VMF that are behind the surface, outside the
 * voxels the item embeds into, deepest first
 * @param {string} text - The VMF
 * @param {{surface: number, embedded: Object[]}} frame - From itemFrame
 * @returns {{brushes: {solid: Object, depth: number}[], entities: {entity: Object, origin: number[], depth: number}[]}}
 *   depths in units behind the surface
 */
function partsBehind(text, frame) {
    const vmf = parseVmf(text)
    const limit = frame.surface - TOLERANCE
    const depthOf = (z) => Math.round(frame.surface - z)

    // A brush is in the wall when all of it is. One that shows in the room
    // (in front of the surface, or in the voxels the item embeds into) is
    // seen, even if it only just goes into the wall.
    const shows = (point) =>
        point[2] > frame.surface + TOLERANCE || inEmbedded(frame, point)
    const brushes = []
    for (const solid of vmf.solids) {
        completeSolid(solid)
        const points = solid.sides.flatMap((side) => side.points)
        if (points.length === 0 || points.some(shows)) continue
        const lowest = Math.min(...points.map((point) => point[2]))
        if (lowest < limit) brushes.push({ solid, depth: depthOf(lowest) })
    }

    // Brush entities have an origin too (where their brushes are), when
    // they have one at all
    const entities = []
    for (const entity of vmf.entities) {
        if (COMPILED_AWAY.has(entity.classname.toLowerCase())) continue
        const origin = numbers(entity.get("origin"))
        if (origin.length < 3 || origin.some((n) => !Number.isFinite(n))) {
            continue
        }
        if (origin[2] < limit && !inEmbedded(frame, origin)) {
            entities.push({ entity, origin, depth: depthOf(origin[2]) })
        }
    }

    brushes.sort((a, b) => b.depth - a.depth)
    entities.sort((a, b) => b.depth - a.depth)
    return { brushes, entities }
}

/**
 * What in a VMF is behind the surface, outside the voxels the item embeds
 * into
 * @param {string} text - The VMF
 * @param {{surface: number, embedded: Object[]}} frame - From itemFrame
 * @returns {{depth: number, entityCount: number, entities: {classname: string, name: string, depth: number}[], brushCount: number, brushDepth: number}|null}
 *   depths in units behind the surface; null when nothing is behind it
 */
function behindSurface(text, frame) {
    const { brushes, entities } = partsBehind(text, frame)
    if (brushes.length === 0 && entities.length === 0) return null
    const brushDepth = brushes.length > 0 ? brushes[0].depth : 0
    return {
        depth: Math.max(brushDepth, ...entities.map((e) => e.depth)),
        entityCount: entities.length,
        entities: entities.slice(0, LISTED).map(({ entity, depth }) => ({
            classname: entity.classname,
            name: entity.get("targetname") ?? "",
            depth,
        })),
        brushCount: brushes.length,
        brushDepth,
    }
}

/**
 * What a VMF file has behind the surface, to show it (the Instances tab's
 * 3D view of it): every brush there with its faces' corners, and every entity
 * there with its origin and model, in the instance's coordinates
 * @param {string} vmfPath
 * @param {Object} frame - From itemFrame
 * @returns {{surface: number, brushes: {depth: number, faces: number[][][]}[], entities: {classname: string, name: string, model: string, origin: number[], depth: number}[]}}
 */
function behindSurfaceParts(vmfPath, frame) {
    const { brushes, entities } = partsBehind(
        fs.readFileSync(vmfPath, "latin1"),
        frame,
    )
    return {
        surface: frame.surface,
        brushes: brushes.map(({ solid, depth }) => ({
            depth,
            faces: solid.sides
                .map((side) => side.points)
                .filter((points) => points.length >= 3),
        })),
        entities: entities.map(({ entity, origin, depth }) => ({
            classname: entity.classname,
            name: entity.get("targetname") ?? "",
            model: entity.get("model") ?? "",
            origin,
            depth,
        })),
    }
}

/** Results by VMF path, while the file and the item's frame stay the same */
const cache = new Map()

/**
 * behindSurface for a VMF file, or null when it can't be read
 * @param {string} vmfPath
 * @param {Object} frame - From itemFrame
 */
function instanceBehindSurface(vmfPath, frame) {
    let stat
    try {
        stat = fs.statSync(vmfPath)
    } catch {
        cache.delete(vmfPath)
        return null
    }
    const key = `${stat.mtimeMs}|${stat.size}|${JSON.stringify(frame)}`
    const cached = cache.get(vmfPath)
    if (cached?.key === key) return cached.result

    let result = null
    try {
        result = behindSurface(fs.readFileSync(vmfPath, "latin1"), frame)
    } catch (error) {
        console.warn(
            `Couldn't check what ${vmfPath} has behind its surface: ${error.message}`,
        )
    }
    cache.set(vmfPath, { key, result })
    return result
}

module.exports = {
    itemFrame,
    behindSurface,
    behindSurfaceParts,
    instanceBehindSurface,
}
