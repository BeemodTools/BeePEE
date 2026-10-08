/**
 * Cartoon texture style for generated editor models, aiming for the look of
 * the puzzle editor's own models: big flat areas of clean color, light
 * neutral greys and a few vivid accents (lights, rings, buttons), without
 * grime, scratches or small details. (Replaces the Python cartoon.exe.)
 *
 * Textures are shrunk to at most 256 px, flattened with a Kuwahara filter
 * (removes detail but keeps edges between regions), graded (darks lifted,
 * near-greys made neutral, real colors made livelier) and smoothed with a
 * surface blur (melts faint detail like logos into its surroundings, keeps
 * strong edges like lights). Everything wraps around the texture's edges, so
 * tiling textures stay seamless.
 */

/** Largest side of a cartoon texture: editor models don't need more */
const MAX_SIZE = 256

/** Kuwahara radius at MAX_SIZE; larger ones bleed colors between atlas regions */
const RADIUS = 3

/** Kuwahara passes: more passes flatten more */
const PASSES = 6

/** Surface blur radius at MAX_SIZE, and the color difference it stops at */
const BLUR_RADIUS = 6
const BLUR_THRESHOLD = 40

/** Surface blur passes */
const BLUR_PASSES = 2

/** Grading: how far darks are lifted (0-1), brightness curve (< 1 brightens) */
const LIFT = 0.14
const GAMMA = 0.8

/** Saturation for near-greys (made neutral) and for real colors (boosted) */
const GREY_SATURATION = 0.3
const COLOR_SATURATION = 1.35

/** Chroma (max - min channel) from which a pixel counts as colored, and fully */
const COLOR_FROM = 18
const COLOR_FULL = 60

const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b
const wrap = (a, n) => ((a % n) + n) % n
const nearestPowerOfTwo = (n) =>
    Math.min(MAX_SIZE, 2 ** Math.round(Math.log2(Math.max(1, n))))

/**
 * Size a texture gets: at most MAX_SIZE, in powers of two (texture
 * coordinates are relative, so stretching a texture to it is fine)
 */
function cartoonSize(width, height) {
    const scale = Math.min(1, MAX_SIZE / Math.max(width, height))
    return {
        width: nearestPowerOfTwo(width * scale),
        height: nearestPowerOfTwo(height * scale),
    }
}

/**
 * Shrink by area averaging along one axis (alpha-weighted, so transparent
 * pixels don't darken their neighbors). Every output pixel only averages
 * the input pixels it covers, so tiling textures stay seamless.
 * @param {Float64Array} src - Premultiplied RGB + alpha, 4 floats per pixel
 */
function shrinkAxis(src, width, height, size, horizontal) {
    const length = horizontal ? width : height
    const lines = horizontal ? height : width
    const out = new Float64Array(
        (horizontal ? size * height : width * size) * 4,
    )
    const step = length / size
    for (let line = 0; line < lines; line++) {
        for (let i = 0; i < size; i++) {
            const start = i * step
            const end = start + step
            const sum = [0, 0, 0, 0]
            for (let j = Math.floor(start); j < Math.ceil(end); j++) {
                const weight = Math.min(end, j + 1) - Math.max(start, j)
                const o = (horizontal ? line * width + j : j * width + line) * 4
                for (let c = 0; c < 4; c++) sum[c] += src[o + c] * weight
            }
            const o = (horizontal ? line * size + i : i * width + line) * 4
            for (let c = 0; c < 4; c++) out[o + c] = sum[c] / step
        }
    }
    return out
}

function shrink(rgba, width, height, target) {
    let pixels = new Float64Array(width * height * 4)
    for (let o = 0; o < pixels.length; o += 4) {
        const alpha = rgba[o + 3]
        for (let c = 0; c < 3; c++) pixels[o + c] = rgba[o + c] * alpha
        pixels[o + 3] = alpha
    }
    let w = width
    if (target.width !== width) {
        pixels = shrinkAxis(pixels, w, height, target.width, true)
        w = target.width
    }
    if (target.height !== height) {
        pixels = shrinkAxis(pixels, w, height, target.height, false)
    }
    const out = Buffer.alloc(target.width * target.height * 4)
    for (let o = 0; o < out.length; o += 4) {
        const alpha = pixels[o + 3]
        for (let c = 0; c < 3; c++) {
            out[o + c] = alpha > 0 ? pixels[o + c] / alpha + 0.5 : 0
        }
        out[o + 3] = alpha + 0.5
    }
    return out
}

/**
 * Kuwahara filter: every pixel takes the mean color of the least varied (in
 * brightness) of the four (r+1)x(r+1) squares it's a corner of. Sums come
 * from summed-area tables over the wrapped image, so the cost doesn't depend
 * on the radius.
 * @returns {Buffer} New pixels (alpha copied)
 */
function kuwahara(src, width, height, r) {
    const pw = width + 2 * r
    const ph = height + 2 * r
    const stride = pw + 1
    const size = stride * (ph + 1)
    const sumR = new Float64Array(size)
    const sumG = new Float64Array(size)
    const sumB = new Float64Array(size)
    const sumL = new Float64Array(size)
    const sumLL = new Float64Array(size)
    for (let y = 0; y < ph; y++) {
        const row = wrap(y - r, height) * width
        const above = y * stride + 1
        const here = above + stride
        let rowR = 0
        let rowG = 0
        let rowB = 0
        let rowL = 0
        let rowLL = 0
        for (let x = 0; x < pw; x++) {
            const o = (row + wrap(x - r, width)) * 4
            const red = src[o]
            const green = src[o + 1]
            const blue = src[o + 2]
            // Brightness in whole numbers (luma x 256), so the sums are exact
            const l = 77 * red + 150 * green + 29 * blue
            rowR += red
            rowG += green
            rowB += blue
            rowL += l
            rowLL += l * l
            sumR[here + x] = sumR[above + x] + rowR
            sumG[here + x] = sumG[above + x] + rowG
            sumB[here + x] = sumB[above + x] + rowB
            sumL[here + x] = sumL[above + x] + rowL
            sumLL[here + x] = sumLL[above + x] + rowLL
        }
    }

    const n = (r + 1) * (r + 1)
    const down = (r + 1) * stride
    const out = Buffer.from(src)
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            // The pixel is at (x + r, y + r) in the padded image; the squares'
            // top-left corners are (x, y), (x + r, y), (x, y + r), (x + r, y + r)
            let best = 0
            let bestVariance = Infinity
            for (let q = 0; q < 4; q++) {
                const a = (y + (q >> 1) * r) * stride + x + (q & 1) * r
                const b = a + r + 1
                const c = a + down
                const d = c + r + 1
                const l = sumL[d] - sumL[b] - sumL[c] + sumL[a]
                const variance =
                    sumLL[d] - sumLL[b] - sumLL[c] + sumLL[a] - (l * l) / n
                if (variance < bestVariance) {
                    bestVariance = variance
                    best = a
                }
            }
            const b = best + r + 1
            const c = best + down
            const d = c + r + 1
            const o = (y * width + x) * 4
            out[o] = (sumR[d] - sumR[b] - sumR[c] + sumR[best]) / n + 0.5
            out[o + 1] = (sumG[d] - sumG[b] - sumG[c] + sumG[best]) / n + 0.5
            out[o + 2] = (sumB[d] - sumB[b] - sumB[c] + sumB[best]) / n + 0.5
        }
    }
    return out
}

/**
 * Surface blur along one axis: every pixel becomes the average of its
 * neighbors on the row (or column), weighted by how close their color is
 * (nothing past BLUR_THRESHOLD in any channel)
 * @returns {Buffer} New pixels (alpha copied)
 */
function surfaceBlurAxis(src, width, height, radius, horizontal) {
    const length = horizontal ? width : height
    const lines = horizontal ? height : width
    // Pixel steps along a line and between lines
    const step = horizontal ? 1 : width
    const lineStep = horizontal ? width : 1
    const size = 2 * radius + 1
    // Wrapped positions of every pixel's neighbors along the line
    const neighbors = new Int32Array(length * size)
    for (let i = 0; i < length; i++) {
        for (let k = 0; k < size; k++) {
            neighbors[i * size + k] = wrap(i + k - radius, length) * step
        }
    }

    const out = Buffer.from(src)
    for (let line = 0; line < lines; line++) {
        const start = line * lineStep
        for (let i = 0; i < length; i++) {
            const o = (start + i * step) * 4
            const r0 = src[o]
            const g0 = src[o + 1]
            const b0 = src[o + 2]
            let sumR = 0
            let sumG = 0
            let sumB = 0
            let sumW = 0
            for (let k = i * size, end = k + size; k < end; k++) {
                const p = (start + neighbors[k]) * 4
                const red = src[p]
                const green = src[p + 1]
                const blue = src[p + 2]
                let difference = red > r0 ? red - r0 : r0 - red
                const dg = green > g0 ? green - g0 : g0 - green
                const db = blue > b0 ? blue - b0 : b0 - blue
                if (dg > difference) difference = dg
                if (db > difference) difference = db
                if (difference >= BLUR_THRESHOLD) continue
                const weight = 1 - difference / BLUR_THRESHOLD
                sumR += red * weight
                sumG += green * weight
                sumB += blue * weight
                sumW += weight
            }
            out[o] = sumR / sumW + 0.5
            out[o + 1] = sumG / sumW + 0.5
            out[o + 2] = sumB / sumW + 0.5
        }
    }
    return out
}

/**
 * Surface blur: every pixel becomes the average of its neighbors weighted by
 * how close their color is, so faint detail melts into its surroundings
 * while strong edges stay sharp. Done along rows, then columns.
 * @returns {Buffer} New pixels (alpha copied)
 */
function surfaceBlur(src, width, height, radius) {
    const rows = surfaceBlurAxis(src, width, height, radius, true)
    return surfaceBlurAxis(rows, width, height, radius, false)
}

/** Lift and brighten, make near-greys neutral and real colors livelier, in place */
function grade(pixels) {
    for (let o = 0; o < pixels.length; o += 4) {
        const red = pixels[o]
        const green = pixels[o + 1]
        const blue = pixels[o + 2]
        const l = luma(red, green, blue)
        const chroma = Math.max(red, green, blue) - Math.min(red, green, blue)
        const t = Math.min(
            1,
            Math.max(0, (chroma - COLOR_FROM) / (COLOR_FULL - COLOR_FROM)),
        )
        const saturation =
            GREY_SATURATION +
            (COLOR_SATURATION - GREY_SATURATION) * t * t * (3 - 2 * t)
        const lifted = 255 * (LIFT + (1 - LIFT) * Math.pow(l / 255, GAMMA))
        for (let c = 0; c < 3; c++) {
            const value = lifted + (pixels[o + c] - l) * saturation
            pixels[o + c] = value < 0 ? 0 : value > 255 ? 255 : value + 0.5
        }
    }
}

/**
 * Apply the cartoon style
 * @param {Buffer} rgba - Pixels, 4 bytes each
 * @param {number} width
 * @param {number} height
 * @returns {{width: number, height: number, rgba: Buffer}} The (usually
 *   smaller) cartoon texture; alpha is kept (averaged when shrunk)
 */
function cartoonify(rgba, width, height) {
    const size = cartoonSize(width, height)
    let pixels =
        size.width === width && size.height === height
            ? Buffer.from(rgba)
            : shrink(rgba, width, height, size)
    // The same flattening (relative to the texture) at any size
    const scaled = (value) =>
        Math.max(
            1,
            Math.round((value * Math.min(size.width, size.height)) / MAX_SIZE),
        )
    for (let pass = 0; pass < PASSES; pass++) {
        pixels = kuwahara(pixels, size.width, size.height, scaled(RADIUS))
    }
    // Grade first, so the blur works on the final colors
    grade(pixels)
    for (let pass = 0; pass < BLUR_PASSES; pass++) {
        pixels = surfaceBlur(
            pixels,
            size.width,
            size.height,
            scaled(BLUR_RADIUS),
        )
    }
    return { width: size.width, height: size.height, rgba: pixels }
}

module.exports = { cartoonify, cartoonSize }
