/**
 * info_overlay and infodecal support. Source projects an overlay along its
 * BasisNormal onto the brush faces listed in its "sides" and clips it to
 * them, and puts a static decal on every face whose plane is close to the
 * decal. Here both are baked into a copy of each such face's texture
 * instead, so they need no transparency, can't overhang their faces and
 * can't z-fight.
 */

const { parseNumbers } = require("./vmf")
const { add, sub, scale, dot, cross, normalize } = require("./math")

/** Largest side of a baked face texture, in pixels */
const MAX_BAKE_SIZE = 2048

/** Most baked pixels per face texel, used when overlays are sharper than the face */
const MAX_UPSCALE = 8

const EPSILON = 1e-6

const floorMod = (a, n) => ((a % n) + n) % n

/**
 * Read an info_overlay entity
 * @param {Object} entity - Parsed VMF entity
 * @param {number} index - Position among the VMF's overlays
 * @returns {Object|null} null when keyvalues are missing or degenerate
 */
function parseOverlay(entity, index) {
    const vector = (key) => {
        const n = parseNumbers(entity.get(key))
        return n.length >= 3 ? n.slice(0, 3) : null
    }
    const number = (key, fallback) => {
        const n = Number.parseFloat(entity.get(key))
        return Number.isFinite(n) ? n : fallback
    }

    const material = (entity.get("material") ?? "")
        .replace(/\\/g, "/")
        .trim()
        .toLowerCase()
    const origin = vector("basisorigin") ?? vector("origin")
    const basisU = vector("basisu")
    const basisV = vector("basisv")
    const normal = vector("basisnormal")
    const corners = [0, 1, 2, 3].map((i) =>
        parseNumbers(entity.get(`uv${i}`)).slice(0, 2),
    )
    if (
        !material ||
        !origin ||
        !basisU ||
        !basisV ||
        !normal ||
        corners.some((c) => c.length < 2)
    ) {
        return null
    }

    // Dual basis: a point's overlay coordinates (s, t) are its BasisU/BasisV
    // components once it is projected onto the overlay plane along the normal
    const determinant = dot(basisU, cross(basisV, normal))
    if (Math.abs(determinant) < EPSILON) return null

    const startU = number("startu", 0)
    const endU = number("endu", 1)
    const startV = number("startv", 0)
    const endV = number("endv", 1)
    return {
        index,
        id: entity.get("id") ?? String(index),
        material,
        sides: (entity.get("sides") ?? "").trim().split(/\s+/).filter(Boolean),
        // Source draws higher render orders (0-3) on top of lower ones
        renderOrder: Math.min(
            Math.max(Math.trunc(number("renderorder", 0)), 0),
            3,
        ),
        origin,
        normal: normalize(normal),
        dualU: scale(cross(basisV, normal), 1 / determinant),
        dualV: scale(cross(normal, basisU), 1 / determinant),
        corners,
        // Texture coordinates of uv0-uv3, as Source assigns them
        texCoords: [
            [startU, startV],
            [startU, endV],
            [endU, endV],
            [endU, startV],
        ],
    }
}

/** Static decals go on faces whose plane is closer than this (as in the engine) */
const DECAL_DISTANCE = 4

/**
 * Read an infodecal entity
 * @param {Object} entity - Parsed VMF entity
 * @param {number} index - Position among the VMF's decals
 * @returns {Object|null} null without a texture or origin
 */
function parseDecal(entity, index) {
    const material = (entity.get("texture") ?? "")
        .replace(/\\/g, "/")
        .trim()
        .toLowerCase()
    const origin = parseNumbers(entity.get("origin"))
    if (!material || origin.length < 3) return null
    return {
        index,
        id: entity.get("id") ?? String(index),
        material,
        origin: origin.slice(0, 3),
    }
}

/** The decals close enough to a face's plane to be put on it */
function decalsNearFace(decals, plane, normal) {
    return decals.filter(
        (decal) =>
            Math.abs(dot(sub(decal.origin, plane[0]), normal)) < DECAL_DISTANCE,
    )
}

/**
 * A decal on a face, in the form overlays use: centered on the decal's
 * origin in the face's plane, sized by its texture, and oriented like the
 * engine does it (R_DecalComputeBasis): on floors and ceilings S runs along
 * +X, on walls T runs down.
 * @param {number[]} normal - The face's outward unit normal
 * @param {number} width - Width in units (texture width × $decalscale)
 * @param {number} height - Height in units (texture height × $decalscale)
 */
function decalProjection(decal, normal, width, height) {
    let s
    let t
    if (Math.abs(normal[2]) > Math.SQRT1_2) {
        t = cross([1, 0, 0], normal)
        s = cross(normal, t)
    } else {
        s = cross(normal, [0, 0, -1])
        t = cross(s, normal)
    }
    const w = width / 2
    const h = height / 2
    return {
        source: decal,
        origin: decal.origin,
        normal,
        dualU: normalize(s),
        dualV: normalize(t),
        corners: [
            [-w, -h],
            [-w, h],
            [w, h],
            [w, -h],
        ],
        texCoords: [
            [0, 0],
            [0, 1],
            [1, 1],
            [1, 0],
        ],
    }
}

/**
 * How an overlay or decal material is drawn, from describeMaterial()
 * @returns {"modulate"|"additive"|"alphatest"|"translucent"|"opaque"}
 */
function blendMode(info) {
    if (info.modulate) return "modulate"
    if (info.additive) return "additive"
    if (info.alphatest) return "alphatest"
    if (info.translucent) return "translucent"
    return "opaque"
}

/**
 * Texture mapping of a brush side for a texture of the given size.
 * coords(point) gives [u, v] in texture repeats (v runs down the image, as in
 * Source); inverse describes point(u, v) = origin + u * perU + v * perV on
 * the side's plane (null when a texture axis is parallel to the normal).
 */
function textureMapping(side, width, height) {
    let uShift = side.uAxis.shift % width
    let vShift = side.vAxis.shift % height
    if (uShift < -width / 2) uShift += width
    if (vShift < -height / 2) vShift += height
    const coords = (p) => [
        dot(p, side.uAxis.axis) / (width * side.uAxis.scale) + uShift / width,
        dot(p, side.vAxis.axis) / (height * side.vAxis.scale) + vShift / height,
    ]

    // Solve u = au.p + cu, v = av.p + cv, n.p = d for p
    const au = scale(side.uAxis.axis, 1 / (width * side.uAxis.scale))
    const av = scale(side.vAxis.axis, 1 / (height * side.vAxis.scale))
    const [p0, p1, p2] = side.plane
    const n = cross(sub(p1, p0), sub(p2, p0))
    const avn = cross(av, n)
    const nau = cross(n, au)
    const determinant = dot(au, avn)
    const inverse =
        Math.abs(determinant) < 1e-12
            ? null
            : {
                  origin: scale(
                      add(
                          add(
                              scale(avn, -uShift / width),
                              scale(nau, -vShift / height),
                          ),
                          scale(cross(au, av), dot(n, p0)),
                      ),
                      1 / determinant,
                  ),
                  perU: scale(avn, 1 / determinant),
                  perV: scale(nau, 1 / determinant),
              }
    return { coords, inverse, normal: normalize(n) }
}

/**
 * Where an overlay lands on a face: the affine map from face texture
 * coordinates to overlay coordinates, the overlay's footprint in face texture
 * coordinates and how many overlay texels fall on one face texel.
 * @returns {Object|null} null when the face is edge-on to the overlay
 */
function placeLayer(layer, mapping, faceTexture) {
    const { overlay } = layer
    if (Math.abs(dot(mapping.normal, overlay.normal)) < 0.1) return null

    const { origin, perU, perV } = mapping.inverse
    const relative = sub(origin, overlay.origin)
    const s0 = dot(relative, overlay.dualU)
    const su = dot(perU, overlay.dualU)
    const sv = dot(perV, overlay.dualU)
    const t0 = dot(relative, overlay.dualV)
    const tu = dot(perU, overlay.dualV)
    const tv = dot(perV, overlay.dualV)
    const determinant = su * tv - sv * tu
    if (Math.abs(determinant) < 1e-12) return null

    const footprint = overlay.corners.map(([s, t]) => [
        ((s - s0) * tv - sv * (t - t0)) / determinant,
        (su * (t - t0) - tu * (s - s0)) / determinant,
    ])

    // Two triangles (0, 1, 2) and (0, 2, 3), like the quad is drawn
    const triangles = []
    for (const [a, b, c] of [
        [0, 1, 2],
        [0, 2, 3],
    ]) {
        const A = overlay.corners[a]
        const e1 = [overlay.corners[b][0] - A[0], overlay.corners[b][1] - A[1]]
        const e2 = [overlay.corners[c][0] - A[0], overlay.corners[c][1] - A[1]]
        const det = e1[0] * e2[1] - e1[1] * e2[0]
        if (Math.abs(det) < EPSILON) continue
        triangles.push({
            A,
            e1,
            e2,
            det,
            T: overlay.texCoords[a],
            dTb: [
                overlay.texCoords[b][0] - overlay.texCoords[a][0],
                overlay.texCoords[b][1] - overlay.texCoords[a][1],
            ],
            dTc: [
                overlay.texCoords[c][0] - overlay.texCoords[a][0],
                overlay.texCoords[c][1] - overlay.texCoords[a][1],
            ],
        })
    }
    if (!triangles.length) return null

    const span = (i) =>
        Math.max(...overlay.corners.map((c) => c[i])) -
        Math.min(...overlay.corners.map((c) => c[i]))
    const [startU, startV] = overlay.texCoords[0]
    const [endU, endV] = overlay.texCoords[2]
    const texelsPerS =
        span(0) > 0
            ? (layer.texture.width * Math.abs(endU - startU)) / span(0)
            : 0
    const texelsPerT =
        span(1) > 0
            ? (layer.texture.height * Math.abs(endV - startV)) / span(1)
            : 0
    const upscale = Math.max(
        (Math.abs(su) * texelsPerS + Math.abs(tu) * texelsPerT) /
            faceTexture.width,
        (Math.abs(sv) * texelsPerS + Math.abs(tv) * texelsPerT) /
            faceTexture.height,
    )

    return {
        ...layer,
        s0,
        su,
        sv,
        t0,
        tu,
        tv,
        triangles,
        uLow: Math.min(...footprint.map((p) => p[0])),
        uHigh: Math.max(...footprint.map((p) => p[0])),
        vLow: Math.min(...footprint.map((p) => p[1])),
        vHigh: Math.max(...footprint.map((p) => p[1])),
        upscale,
        painted: false,
    }
}

/** Overlay texture coordinates at overlay point (s, t), or null outside it */
function overlayTexCoord(triangles, s, t) {
    for (const tri of triangles) {
        const ds = s - tri.A[0]
        const dt = t - tri.A[1]
        const beta = (ds * tri.e2[1] - dt * tri.e2[0]) / tri.det
        const gamma = (tri.e1[0] * dt - tri.e1[1] * ds) / tri.det
        if (beta < -EPSILON || gamma < -EPSILON || beta + gamma > 1 + EPSILON)
            continue
        return [
            tri.T[0] + beta * tri.dTb[0] + gamma * tri.dTc[0],
            tri.T[1] + beta * tri.dTb[1] + gamma * tri.dTc[1],
        ]
    }
    return null
}

/**
 * Bilinear sample with clamped edges into `out` ([r, g, b, a], 0-255).
 * Premultiplied filtering keeps the color of fully transparent texels from
 * bleeding into the edges of translucent textures.
 */
function sampleTexture(texture, u, v, premultiplied, out) {
    const { width, height, rgba } = texture
    const x = Math.min(Math.max(u * width - 0.5, 0), width - 1)
    const y = Math.min(Math.max(v * height - 0.5, 0), height - 1)
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const x1 = Math.min(x0 + 1, width - 1)
    const y1 = Math.min(y0 + 1, height - 1)
    const fx = x - x0
    const fy = y - y0
    const texels = [
        [(y0 * width + x0) * 4, (1 - fx) * (1 - fy)],
        [(y0 * width + x1) * 4, fx * (1 - fy)],
        [(y1 * width + x0) * 4, (1 - fx) * fy],
        [(y1 * width + x1) * 4, fx * fy],
    ]
    let r = 0
    let g = 0
    let b = 0
    let a = 0
    for (const [o, w] of texels) {
        const weight = premultiplied ? w * rgba[o + 3] : w
        r += rgba[o] * weight
        g += rgba[o + 1] * weight
        b += rgba[o + 2] * weight
        a += rgba[o + 3] * w
    }
    const divisor = premultiplied ? a : 1
    if (divisor > 0) {
        out[0] = r / divisor
        out[1] = g / divisor
        out[2] = b / divisor
    } else {
        out[0] = out[1] = out[2] = 0
    }
    out[3] = a
}

/** Blend overlay sample `src` onto pixel `dst` ([r, g, b, a], 0-255) */
function blend(layer, src, dst) {
    const alpha = src[3] / 255
    switch (layer.blend) {
        case "modulate":
            // DecalModulate: 2 * src * dst, skipping fully transparent texels
            if (src[3] > 0) {
                for (let c = 0; c < 3; c++)
                    dst[c] = Math.min(255, (dst[c] * src[c] * 2) / 255)
            }
            break
        case "additive": {
            const f = (layer.translucent ? alpha : 1) * layer.alpha
            for (let c = 0; c < 3; c++)
                dst[c] = Math.min(255, dst[c] + src[c] * f)
            break
        }
        case "alphatest":
            if (alpha * layer.alpha >= layer.alphaTestReference) {
                dst[0] = src[0]
                dst[1] = src[1]
                dst[2] = src[2]
                dst[3] = 255
            }
            break
        default: {
            // Translucent overlays blend by their alpha; opaque ones cover the
            // face (only $alpha fades them)
            const f = (layer.blend === "translucent" ? alpha : 1) * layer.alpha
            for (let c = 0; c < 3; c++) dst[c] += (src[c] - dst[c]) * f
            dst[3] += (255 - dst[3]) * f
        }
    }
}

/**
 * Draw overlays onto a copy of a face's texture that covers the face's
 * texture coordinates.
 * @param {Object} face
 * @param {number[][]} face.points - Face polygon
 * @param {Object} face.mapping - textureMapping() of the face for its texture
 * @param {{width: number, height: number, rgba: Buffer}} face.texture - The face's (tinted) texture
 * @param {boolean} face.keepAlpha - Keep the texture's alpha (translucent faces)
 * @param {Array<{overlay: Object, texture: Object, blend: string, translucent: boolean, alpha: number, alphaTestReference: number}>} layers
 *   Overlays on this face in drawing order, with their (tinted) textures
 * @returns {{width: number, height: number, rgba: Buffer, bounds: {uMin: number, uMax: number, vMin: number, vMax: number}, painted: Object[]}|null}
 *   null when no overlay reaches the face. `painted` lists the overlays drawn.
 */
function bakeOverlays(face, layers) {
    const { mapping, texture } = face
    if (!mapping.inverse) return null

    // Texture coordinate bounds of the face, snapped to whole face texels so
    // the face texture is copied texel for texel
    const uvs = face.points.map(mapping.coords)
    const texelBounds = (axis, size) => {
        const values = uvs.map((uv) => uv[axis] * size)
        const low = Math.floor(Math.min(...values) + EPSILON)
        const high = Math.max(low + 1, Math.ceil(Math.max(...values) - EPSILON))
        return [low, high]
    }
    const [x0, x1] = texelBounds(0, texture.width)
    const [y0, y1] = texelBounds(1, texture.height)
    const bounds = {
        uMin: x0 / texture.width,
        uMax: x1 / texture.width,
        vMin: y0 / texture.height,
        vMax: y1 / texture.height,
    }

    const placed = layers
        .map((layer) => placeLayer(layer, mapping, texture))
        .filter(
            (p) =>
                p &&
                p.uHigh > bounds.uMin &&
                p.uLow < bounds.uMax &&
                p.vHigh > bounds.vMin &&
                p.vLow < bounds.vMax,
        )
    if (!placed.length) return null

    const texelsWide = x1 - x0
    const texelsHigh = y1 - y0
    let upscale = Math.min(
        MAX_UPSCALE,
        Math.max(
            1,
            Math.ceil(Math.max(...placed.map((p) => p.upscale)) - 0.01),
        ),
    )
    while (
        upscale > 1 &&
        Math.max(texelsWide, texelsHigh) * upscale > MAX_BAKE_SIZE
    ) {
        upscale--
    }
    let width = texelsWide * upscale
    let height = texelsHigh * upscale
    if (Math.max(width, height) > MAX_BAKE_SIZE) {
        const factor = MAX_BAKE_SIZE / Math.max(width, height)
        width = Math.max(1, Math.round(width * factor))
        height = Math.max(1, Math.round(height * factor))
    }

    const du = (bounds.uMax - bounds.uMin) / width
    const dv = (bounds.vMax - bounds.vMin) / height
    for (const p of placed) {
        p.x0 = Math.max(0, Math.floor((p.uLow - bounds.uMin) / du))
        p.x1 = Math.min(width, Math.ceil((p.uHigh - bounds.uMin) / du))
        p.y0 = Math.max(0, Math.floor((p.vLow - bounds.vMin) / dv))
        p.y1 = Math.min(height, Math.ceil((p.vHigh - bounds.vMin) / dv))
        p.premultiplied = p.blend !== "opaque" && p.blend !== "modulate"
    }

    const rgba = Buffer.alloc(width * height * 4)
    const src = [0, 0, 0, 0]
    const dst = [0, 0, 0, 0]
    for (let y = 0; y < height; y++) {
        const v = bounds.vMin + (y + 0.5) * dv
        const row =
            floorMod(Math.floor(v * texture.height), texture.height) *
            texture.width
        for (let x = 0; x < width; x++) {
            const u = bounds.uMin + (x + 0.5) * du
            const from =
                (row + floorMod(Math.floor(u * texture.width), texture.width)) *
                4
            dst[0] = texture.rgba[from]
            dst[1] = texture.rgba[from + 1]
            dst[2] = texture.rgba[from + 2]
            dst[3] = face.keepAlpha ? texture.rgba[from + 3] : 255

            for (const p of placed) {
                if (x < p.x0 || x >= p.x1 || y < p.y0 || y >= p.y1) continue
                const coord = overlayTexCoord(
                    p.triangles,
                    p.s0 + p.su * u + p.sv * v,
                    p.t0 + p.tu * u + p.tv * v,
                )
                if (!coord) continue
                p.painted = true
                sampleTexture(
                    p.texture,
                    coord[0],
                    coord[1],
                    p.premultiplied,
                    src,
                )
                blend(p, src, dst)
            }

            const to = (y * width + x) * 4
            for (let c = 0; c < 4; c++) rgba[to + c] = Math.round(dst[c])
        }
    }

    const painted = placed.filter((p) => p.painted).map((p) => p.overlay)
    if (!painted.length) return null
    return { width, height, rgba, bounds, painted }
}

module.exports = {
    parseOverlay,
    parseDecal,
    decalsNearFace,
    decalProjection,
    blendMode,
    textureMapping,
    bakeOverlays,
    MAX_BAKE_SIZE,
}
