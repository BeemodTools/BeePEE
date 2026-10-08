/**
 * Displacement blend materials (WorldVertexTransition). The engine blends
 * $basetexture and $basetexture2 by each displacement vertex's alpha; here
 * the blend is baked into a texture for the displacement. The texture covers
 * the displacement's vertex grid, so each grid vertex gets texture
 * coordinates (column, row) / (size - 1) on it.
 */

const { MAX_BAKE_SIZE } = require("./overlays")

/** Most baked pixels per $basetexture texel, used when $basetexture2 is sharper */
const MAX_UPSCALE = 4

const floorMod = (a, n) => ((a % n) + n) % n
const clamp01 = (x) => Math.min(Math.max(x, 0), 1)

/** HLSL smoothstep */
function smoothstep(low, high, x) {
    if (high <= low) return x < low ? 0 : 1
    const t = clamp01((x - low) / (high - low))
    return t * t * (3 - 2 * t)
}

/** Bilinear sample of a repeating texture into `out` ([r, g, b, a], 0-255) */
function sampleWrapped(texture, u, v, out) {
    const { width, height, rgba } = texture
    const x = u * width - 0.5
    const y = v * height - 0.5
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const fx = x - x0
    const fy = y - y0
    const xa = floorMod(x0, width)
    const xb = floorMod(x0 + 1, width)
    const ya = floorMod(y0, height) * width
    const yb = floorMod(y0 + 1, height) * width
    const a = (ya + xa) * 4
    const b = (ya + xb) * 4
    const c = (yb + xa) * 4
    const d = (yb + xb) * 4
    for (let i = 0; i < 4; i++) {
        out[i] =
            (rgba[a + i] * (1 - fx) + rgba[b + i] * fx) * (1 - fy) +
            (rgba[c + i] * (1 - fx) + rgba[d + i] * fx) * fy
    }
}

/** Distance in texels between two texture coordinates (in repeats) */
const texelDistance = (texture, a, b) =>
    Math.hypot((b[0] - a[0]) * texture.width, (b[1] - a[1]) * texture.height)

/**
 * Bake the blend of a displacement's two textures.
 * @param {Object} grid
 * @param {number} grid.rows
 * @param {number} grid.cols
 * @param {(row: number, col: number) => number[]} grid.uv - Texture coordinates of a vertex, in repeats (v runs down)
 * @param {(row: number, col: number) => number} grid.alpha - Blend of a vertex: 0 = $basetexture, 1 = $basetexture2
 * @param {{width: number, height: number, rgba: Buffer}} base - $basetexture
 * @param {{width: number, height: number, rgba: Buffer}} base2 - $basetexture2
 * @param {{width: number, height: number, rgba: Buffer}|null} modulate - $blendmodulatetexture
 * @param {boolean} keepAlpha - Keep (blended) alpha, for translucent materials
 * @returns {{width: number, height: number, rgba: Buffer}}
 */
function bakeBlend(grid, base, base2, modulate, keepAlpha) {
    const { rows, cols } = grid
    const last = [rows - 1, cols - 1]

    // As many pixels as $basetexture has texels along the grid's edges
    const across = Math.max(
        texelDistance(base, grid.uv(0, 0), grid.uv(0, last[1])),
        texelDistance(base, grid.uv(last[0], 0), grid.uv(last[0], last[1])),
    )
    const down = Math.max(
        texelDistance(base, grid.uv(0, 0), grid.uv(last[0], 0)),
        texelDistance(base, grid.uv(0, last[1]), grid.uv(last[0], last[1])),
    )
    let upscale = Math.min(
        MAX_UPSCALE,
        Math.max(
            1,
            Math.ceil(
                Math.max(base2.width / base.width, base2.height / base.height) -
                    0.01,
            ),
        ),
    )
    let width = Math.max(1, Math.ceil(across * upscale - 0.01))
    let height = Math.max(1, Math.ceil(down * upscale - 0.01))
    if (Math.max(width, height) > MAX_BAKE_SIZE) {
        const factor = MAX_BAKE_SIZE / Math.max(width, height)
        width = Math.max(1, Math.round(width * factor))
        height = Math.max(1, Math.round(height * factor))
    }

    const uvs = []
    const alphas = []
    for (let i = 0; i < rows; i++) {
        uvs.push([])
        alphas.push([])
        for (let j = 0; j < cols; j++) {
            uvs[i].push(grid.uv(i, j))
            alphas[i].push(clamp01(grid.alpha(i, j)))
        }
    }

    const rgba = Buffer.alloc(width * height * 4)
    const color = [0, 0, 0, 0]
    const color2 = [0, 0, 0, 0]
    const mask = [0, 0, 0, 0]
    for (let y = 0; y < height; y++) {
        // Where this pixel's center is on the grid (the image spans the grid)
        const row = ((y + 0.5) / height) * last[0]
        const i = Math.min(Math.floor(row), last[0] - 1)
        const fi = row - i
        for (let x = 0; x < width; x++) {
            const col = ((x + 0.5) / width) * last[1]
            const j = Math.min(Math.floor(col), last[1] - 1)
            const fj = col - j

            // Bilinear in the grid cell, like the cell's texture coordinates
            const w00 = (1 - fi) * (1 - fj)
            const w01 = (1 - fi) * fj
            const w10 = fi * (1 - fj)
            const w11 = fi * fj
            const u =
                uvs[i][j][0] * w00 +
                uvs[i][j + 1][0] * w01 +
                uvs[i + 1][j][0] * w10 +
                uvs[i + 1][j + 1][0] * w11
            const v =
                uvs[i][j][1] * w00 +
                uvs[i][j + 1][1] * w01 +
                uvs[i + 1][j][1] * w10 +
                uvs[i + 1][j + 1][1] * w11
            let blend =
                alphas[i][j] * w00 +
                alphas[i][j + 1] * w01 +
                alphas[i + 1][j] * w10 +
                alphas[i + 1][j + 1] * w11

            if (modulate) {
                // WorldVertexTransition: green centers the blend, red softens it
                sampleWrapped(modulate, u, v, mask)
                const center = mask[1] / 255
                const softness = mask[0] / 255
                blend = smoothstep(
                    clamp01(center - softness),
                    clamp01(center + softness),
                    blend,
                )
            }

            sampleWrapped(base, u, v, color)
            sampleWrapped(base2, u, v, color2)
            const o = (y * width + x) * 4
            for (let c = 0; c < 3; c++) {
                rgba[o + c] = Math.round(
                    color[c] + (color2[c] - color[c]) * blend,
                )
            }
            rgba[o + 3] = keepAlpha
                ? Math.round(color[3] + (color2[3] - color[3]) * blend)
                : 255
        }
    }
    return { width, height, rgba }
}

module.exports = { bakeBlend, smoothstep }
