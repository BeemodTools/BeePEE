const { cartoonify, cartoonSize } = require("../utils/cartoonFilter")

/** Deterministic noisy pixels around a base color */
function noisy(width, height, base, spread, seed = 1) {
    const pixels = Buffer.alloc(width * height * 4)
    let state = seed
    const random = () => {
        state = (state * 1103515245 + 12345) % 2147483648
        return state / 2147483648
    }
    for (let i = 0; i < width * height; i++) {
        for (let c = 0; c < 3; c++) {
            const value = base[c] + (random() - 0.5) * spread
            pixels[i * 4 + c] = Math.max(0, Math.min(255, Math.round(value)))
        }
        pixels[i * 4 + 3] = (i * 7) % 256
    }
    return pixels
}

/** Solid color pixels */
const solid = (width, height, rgba) =>
    Buffer.concat(Array(width * height).fill(Buffer.from(rgba)))

/** Move a texture by (dx, dy), wrapping around */
function shift(pixels, width, height, dx, dy) {
    const out = Buffer.alloc(pixels.length)
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const from = (y * width + x) * 4
            const to = (((y + dy) % height) * width + ((x + dx) % width)) * 4
            pixels.copy(out, to, from, from + 4)
        }
    }
    return out
}

const channel = (pixels, c) => [...pixels.filter((_, i) => i % 4 === c)]
const variance = (values) => {
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    return values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
}
const pixel = (image, x, y) => {
    const o = (y * image.width + x) * 4
    return [...image.rgba.subarray(o, o + 4)]
}

describe("cartoonify", () => {
    test("shrinks textures to at most 256 px, in powers of two", () => {
        expect(cartoonSize(1024, 512)).toEqual({ width: 256, height: 128 })
        expect(cartoonSize(496, 497)).toEqual({ width: 256, height: 256 })
        expect(cartoonSize(100, 30)).toEqual({ width: 128, height: 32 })
        expect(cartoonSize(1904, 1216)).toEqual({ width: 256, height: 128 })
        expect(cartoonSize(128, 128)).toEqual({ width: 128, height: 128 })

        // Left half red, right half blue: areas average cleanly
        const pixels = Buffer.alloc(512 * 512 * 4)
        for (let i = 0; i < 512 * 512; i++) {
            pixels.set(
                i % 512 < 256 ? [200, 0, 0, 255] : [0, 0, 200, 255],
                i * 4,
            )
        }
        const image = cartoonify(pixels, 512, 512)
        expect([image.width, image.height]).toEqual([256, 256])
        const [red, , blueInRed] = pixel(image, 64, 100)
        const [redInBlue, , blue] = pixel(image, 200, 100)
        expect(red - blueInRed).toBeGreaterThan(150)
        expect(blue - redInBlue).toBeGreaterThan(150)
    })

    test("keeps the alpha channel", () => {
        const pixels = noisy(32, 16, [120, 90, 60], 80)
        const image = cartoonify(pixels, 32, 16)
        expect(channel(image.rgba, 3)).toEqual(channel(pixels, 3))
    })

    test("wraps around the edges, so tiling textures stay seamless", () => {
        const pixels = noisy(64, 32, [128, 128, 128], 200)
        const shifted = shift(pixels, 64, 32, 17, 5)
        expect(cartoonify(shifted, 64, 32).rgba).toEqual(
            shift(cartoonify(pixels, 64, 32).rgba, 64, 32, 17, 5),
        )
    })

    test("flattens noise into even areas", () => {
        const pixels = noisy(64, 64, [128, 128, 128], 60)
        const image = cartoonify(pixels, 64, 64)
        expect(variance(channel(image.rgba, 0))).toBeLessThan(
            variance(channel(pixels, 0)) / 10,
        )
    })

    test("makes near-greys neutral and keeps accent colors vivid", () => {
        // A slightly blue white (like many Portal 2 textures) and a light cyan
        const grey = cartoonify(solid(8, 8, [200, 204, 214, 255]), 8, 8)
        const [r, , b] = pixel(grey, 0, 0)
        expect(b - r).toBeLessThan(6)

        const cyan = cartoonify(solid(8, 8, [40, 190, 230, 255]), 8, 8)
        const color = pixel(cyan, 0, 0)
        expect(
            Math.max(...color.slice(0, 3)) - Math.min(...color.slice(0, 3)),
        ).toBeGreaterThan(190)
    })
})
