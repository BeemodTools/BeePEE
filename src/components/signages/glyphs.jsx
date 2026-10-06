// Portal-ish solid glyph library shared by the designer palette and canvas.
// Each entry is an array of SVG path `d` strings drawn in a single fill
// color on a 24x24 viewBox.
import { useId } from "react"
import signBg from "../../assets/signage/sign_bg.png"

// The standard signage backplate - the designer canvas backdrop, and baked
// into every exported signage PNG.
export const SIGN_BG = signBg

// Arrows and primitives are drawn edge-to-edge on the 24x24 viewBox in
// halves/quarters, so a grid-snapped layer lands its shape exactly on
// grid lines (arrow heads span the full box, shafts are the center half).
export const GLYPHS = {
    arrowUp: { label: "Arrow Up", paths: ["M12 0l12 12h-6v12H6V12H0z"] },
    arrowDown: { label: "Arrow Down", paths: ["M12 24L0 12h6V0h12v12h6z"] },
    arrowLeft: { label: "Arrow Left", paths: ["M0 12L12 0v6h12v12H12v6z"] },
    arrowRight: { label: "Arrow Right", paths: ["M24 12L12 24v-6H0V6h12V0z"] },
    cube: {
        label: "Cube",
        paths: ["M12 0l12 6v12l-12 6-12-6V6z", "M0 6l12 6 12-6M12 12v12"],
    },
    heart: {
        label: "Heart",
        paths: [
            "M12 24C4 17 0 12.5 0 7.5 0 3.4 3 .5 6.75.5c2.1 0 4.1 1 5.25 2.7C13.15 1.5 15.15.5 17.25.5 21 .5 24 3.4 24 7.5c0 5-4 9.5-12 16.5z",
        ],
    },
    sphere: { label: "Sphere", paths: ["M12 0a12 12 0 100 24 12 12 0 000-24z"] },
    triangle: {
        label: "Hazard",
        paths: ["M12 0l12 24H0z", "M11 9h2v7h-2zM11 18h2v3h-2z"],
    },
    check: {
        label: "Check",
        paths: ["M8 24L0 16l3-3 5 5L21 0l3 3z"],
    },
    cross: {
        label: "Cross",
        paths: [
            "M24 3l-3-3-9 9-9-9-3 3 9 9-9 9 3 3 9-9 9 9 3-3-9-9z",
        ],
    },
    star: {
        label: "Star",
        paths: [
            "M12 0l3.7 7.5L24 8.7l-6 5.9 1.4 8.3L12 19l-7.4 3.9L6 14.6 0 8.7l8.3-1.2z",
        ],
    },
    dot: { label: "Dot", paths: ["M12 6a6 6 0 100 12 6 6 0 000-12z"] },
    fizzler: {
        label: "Fizzler",
        paths: ["M0 0h6v24H0zM9 0h6v24H9zM18 0h6v24h-6z"],
    },
    button: {
        label: "Button",
        paths: ["M12 0a8 8 0 018 8v4H4V8a8 8 0 018-8z", "M0 16h24v8H0z"],
    },
    laser: {
        label: "Laser",
        paths: ["M0 10.5h24v3H0z", "M12 6a6 6 0 100 12 6 6 0 000-12z"],
    },
    diamond: { label: "Diamond", paths: ["M12 0l8 12-8 12-8-12z"] },
    plus: { label: "Plus", paths: ["M8 0h8v8h8v8h-8v8H8v-8H0V8h8z"] },
    ring: {
        label: "Ring",
        paths: [
            "M12 0a12 12 0 100 24 12 12 0 000-24zm0 4a8 8 0 110 16 8 8 0 010-16z",
        ],
    },
}

// Basic geometric primitives - full-bleed on the viewBox (edges touch the
// layer bounds), so a grid-snapped layer puts the shape exactly on the grid.
export const PRIMS = {
    square: { label: "Square", paths: ["M0 0h24v24H0z"] },
    rect: { label: "Rectangle", paths: ["M0 6h24v12H0z"] },
    circle: { label: "Circle", paths: ["M12 0a12 12 0 100 24 12 12 0 000-24z"] },
    tri: { label: "Triangle", paths: ["M12 0l12 24H0z"] },
    roundsq: {
        label: "Rounded",
        paths: [
            "M6 0h12a6 6 0 016 6v12a6 6 0 01-6 6H6a6 6 0 01-6-6V6a6 6 0 016-6z",
        ],
    },
    bar: { label: "Bar", paths: ["M0 9h24v6H0z"] },
    pill: { label: "Pill", paths: ["M6 6h12a6 6 0 010 12H6a6 6 0 010-12z"] },
    diamondP: { label: "Diamond", paths: ["M12 0l12 12-12 12L0 12z"] },
    hexP: { label: "Hexagon", paths: ["M6 0h12l6 12-6 12H6L0 12z"] },
    ringP: {
        label: "Ring",
        paths: ["M12 0a12 12 0 100 24 12 12 0 000-24zm0 6a6 6 0 110 12 6 6 0 010-12z"],
    },
}

export const SHAPES = { ...GLYPHS, ...PRIMS }

// Builds a SHAPES entry for an SVG with its own coordinate space. The
// strokeScale keeps outline thickness feeling the same as on the built-in
// 24-unit shapes; fillRule preserves evenodd holes from exported SVGs.
// A picture (an uploaded PNG, as a data URL in `image`) has no paths: it's
// drawn as it is, filling its viewBox.
const makeShapeEntry = (label, paths, vbString, fillRule, image) => {
    const [x, y, w, h] = vbString.split(/[\s,]+/).map(Number)
    return {
        label,
        paths,
        vb: vbString,
        vbX: x || 0,
        vbY: y || 0,
        vbW: w || 24,
        vbH: h || 24,
        strokeScale: Math.max(w || 24, h || 24) / 24,
        fillRule,
        ...(image && { image }),
    }
}

// A picture glyph's markup: the image over its whole viewBox
const pictureSvg = (g) =>
    `<image href="${g.image}" x="${g.vbX}" y="${g.vbY}" width="${g.vbW}" height="${g.vbH}" preserveAspectRatio="none"/>`

// A glyph's paths array holds plain "d" strings (filled subpaths) or
// { d, sw } objects (stroke-only subpaths from imported SVGs - sw is the
// stroke width in the glyph's own viewBox units). Normalize for consumers.
export const pathEntries = (g) =>
    g.paths.map((p) => (typeof p === "string" ? { d: p, sw: 0 } : p))

// User-imported SVG glyphs (session-scoped).
export const CUSTOM = {}
let _cid = 0

export function registerCustomGlyph(label, paths, vbString, fillRule, image) {
    // Dedupe by geometry: uploading a file that's also in the SVG folder,
    // remounting the designer (edit reload, HMR), or re-opening a .bpsign
    // would otherwise register the same shape again under a fresh id and
    // the palette would show duplicates.
    const sig = JSON.stringify([paths, vbString, fillRule || null, image || null])
    for (const [id, entry] of Object.entries(CUSTOM)) {
        if (entry._sig === sig) return id
    }
    const id = `custom_${++_cid}`
    const entry = makeShapeEntry(label, paths, vbString, fillRule, image)
    entry._sig = sig
    CUSTOM[id] = entry
    SHAPES[id] = entry
    return id
}

// ---- .bpsign design (de)serialization -----------------------------------
// The editable design source. Session-imported custom glyphs embed their
// geometry so the file is self-contained and re-openable anywhere.
export function serializeDesign(layers) {
    return {
        version: 1,
        canvas: CANVAS_SIZE,
        layers: layers.map((l) => {
            const out = { ...l }
            const shape = SHAPES[l.glyph]
            if (l.glyph.startsWith("custom_") && shape) {
                out.shape = {
                    label: shape.label,
                    paths: shape.paths,
                    vb: shape.vb,
                    fillRule: shape.fillRule,
                    ...(shape.image && { image: shape.image }),
                }
            }
            return out
        }),
    }
}

// Rebuilds a layer array from a .bpsign design: re-registers embedded custom
// glyphs (deduped) and assigns fresh layer ids (distinct "IMP" prefix so
// they never collide with the designer's own "L" counter).
let _impId = 0
export function rehydrateDesign(design) {
    if (!design || !Array.isArray(design.layers)) return []
    const glyphMap = new Map() // old custom id -> newly registered id
    return design.layers.map((l) => {
        const { shape, id: _oldId, ...rest } = l
        let glyph = rest.glyph
        if (shape && typeof glyph === "string" && glyph.startsWith("custom_")) {
            if (!glyphMap.has(glyph)) {
                glyphMap.set(
                    glyph,
                    registerCustomGlyph(
                        shape.label,
                        shape.paths,
                        shape.vb,
                        shape.fillRule,
                        shape.image,
                    ),
                )
            }
            glyph = glyphMap.get(glyph)
        }
        return { ...rest, glyph, id: `IMP${++_impId}` }
    })
}

/**
 * A layer showing a picture (like a signage's uploaded PNG), fit to the
 * canvas: what the designer starts from for a signage with no design
 * @param {string} label
 * @param {string} dataUrl - The image
 * @param {number} width - Its size in pixels
 * @param {number} height
 */
export function pictureLayer(label, dataUrl, width, height) {
    const glyph = registerCustomGlyph(
        label,
        [],
        `0 0 ${width} ${height}`,
        undefined,
        dataUrl,
    )
    const scale = Math.min(CANVAS_SIZE / width, CANVAS_SIZE / height)
    const w = Math.round(width * scale)
    const h = Math.round(height * scale)
    return {
        id: `IMP${++_impId}`,
        glyph,
        x: Math.round((CANVAS_SIZE - w) / 2),
        y: Math.round((CANVAS_SIZE - h) / 2),
        w,
        h,
        color: "#000000",
        rot: 0,
        styleMode: "fill",
        outlineAlign: "center",
        outlineWidth: 3,
        outlineColor: "#ffffff",
        rounded: false,
    }
}

/** pictureLayer for an image data URL, at the image's own size */
export function loadPictureLayer(label, dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () =>
            resolve(
                pictureLayer(
                    label,
                    dataUrl,
                    img.naturalWidth || CANVAS_SIZE,
                    img.naturalHeight || CANVAS_SIZE,
                ),
            )
        img.onerror = () => reject(new Error("The picture couldn't be read"))
        img.src = dataUrl
    })
}

// Extracts geometry from an SVG file: <path>, <polygon>, <rect>, <circle>
// and <ellipse> become path data. Fill-only elements become filled subpaths;
// stroke-only elements (fill="none" + stroke, e.g. a drawn smile line)
// become { d, sw } stroke subpaths so they aren't wrongly filled solid.
// Per-element COLORS are still ignored - glyphs are single-color by design.
//
// opts.importHeuristics (used for user imports, not the built-in library):
// when the SVG has several filled elements, use the even-odd fill rule so
// nested shapes (eyes inside a face) punch holes instead of vanishing into
// the same-color fill.
export function parseSvgToGlyph(svgText, opts = {}) {
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml")
    const svg = doc.querySelector("svg")
    if (!svg) return null

    const num = (el, attr, fallback = 0) =>
        parseFloat(el.getAttribute(attr)) || fallback

    // Illustrator/Inkscape exports often carry presentation via CSS classes
    // in a <style> block (.cls-1 { fill: none; stroke: #000; ... }) instead
    // of attributes - collect those class rules so prop() can resolve them.
    // Without this, stroke-only art (e.g. motion lines) parses as zero-area
    // fills and renders invisible.
    const classRules = {}
    for (const styleEl of doc.querySelectorAll("style")) {
        const css = styleEl.textContent || ""
        for (const m of css.matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
            const props = classRules[m[1]] || (classRules[m[1]] = {})
            for (const decl of m[2].split(";")) {
                const i = decl.indexOf(":")
                if (i > 0) {
                    props[decl.slice(0, i).trim()] = decl
                        .slice(i + 1)
                        .trim()
                }
            }
        }
    }

    // Presentation lookup: inline style > attribute > class rule
    const prop = (el, name) => {
        const style = el.getAttribute("style") || ""
        const m = style.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`))
        if (m) return m[1].trim()
        const attr = el.getAttribute(name)
        if (attr != null) return attr
        for (const cls of (el.getAttribute("class") || "").split(/\s+/)) {
            const rule = classRules[cls]
            if (rule && rule[name] != null) return rule[name]
        }
        return null
    }
    const isFillNone = (el) => (prop(el, "fill") || "").trim() === "none"
    const hasStroke = (el) => {
        const s = (prop(el, "stroke") || "").trim()
        return s && s !== "none"
    }
    const strokeW = (el) => parseFloat(prop(el, "stroke-width")) || 1

    const paths = []
    let fillCount = 0
    const push = (el, d) => {
        if (isFillNone(el) && hasStroke(el)) {
            paths.push({ d, sw: strokeW(el) })
        } else if (!isFillNone(el)) {
            paths.push(d)
            fillCount++
        }
        // fill:none without a stroke draws nothing - skip it
    }
    for (const p of svg.querySelectorAll("path")) {
        const d = p.getAttribute("d")
        if (d) push(p, d)
    }
    for (const pg of svg.querySelectorAll("polygon")) {
        const pts = (pg.getAttribute("points") || "").trim()
        if (pts) push(pg, `M${pts}z`)
    }
    for (const r of svg.querySelectorAll("rect")) {
        const x = num(r, "x")
        const y = num(r, "y")
        const w = num(r, "width")
        const h = num(r, "height")
        if (w && h) push(r, `M${x} ${y}h${w}v${h}h${-w}z`)
    }
    for (const c of svg.querySelectorAll("circle")) {
        const cx = num(c, "cx")
        const cy = num(c, "cy")
        const r = num(c, "r")
        if (r)
            push(
                c,
                `M${cx} ${cy - r}a${r} ${r} 0 100 ${2 * r}a${r} ${r} 0 100 ${-2 * r}z`,
            )
    }
    for (const el of svg.querySelectorAll("ellipse")) {
        const cx = num(el, "cx")
        const cy = num(el, "cy")
        const rx = num(el, "rx")
        const ry = num(el, "ry")
        if (rx && ry)
            push(
                el,
                `M${cx} ${cy - ry}a${rx} ${ry} 0 100 ${2 * ry}a${rx} ${ry} 0 100 ${-2 * ry}z`,
            )
    }
    if (!paths.length) return null

    let vb = svg.getAttribute("viewBox")
    if (!vb) {
        const w = parseFloat(svg.getAttribute("width")) || 24
        const h = parseFloat(svg.getAttribute("height")) || 24
        vb = `0 0 ${w} ${h}`
    }

    // Imports: shrink the viewBox to the drawn content's measured bounds.
    // Documents often have big margins around the art (e.g. a 680×340 page
    // with a centered round face) - keeping the document box would stretch
    // the glyph to the wrong shape when it fills a layer.
    if (opts.importHeuristics && typeof document !== "undefined") {
        try {
            const NS = "http://www.w3.org/2000/svg"
            const meas = document.createElementNS(NS, "svg")
            meas.style.cssText =
                "position:absolute;left:-9999px;width:10px;height:10px"
            let maxSw = 0
            for (const p of paths) {
                const el = document.createElementNS(NS, "path")
                el.setAttribute("d", typeof p === "string" ? p : p.d)
                if (typeof p !== "string") maxSw = Math.max(maxSw, p.sw)
                meas.appendChild(el)
            }
            document.body.appendChild(meas)
            const bb = meas.getBBox()
            document.body.removeChild(meas)
            if (bb.width > 0 && bb.height > 0) {
                // getBBox ignores stroke extents - pad by the widest half-
                // stroke, plus a hair of breathing room
                const pad =
                    maxSw / 2 + Math.max(bb.width, bb.height) * 0.02
                vb = `${bb.x - pad} ${bb.y - pad} ${bb.width + 2 * pad} ${bb.height + 2 * pad}`
            }
        } catch {
            /* keep the document viewBox */
        }
    }
    // Exported SVGs often carve holes with the evenodd fill rule (attribute
    // or CSS class) - losing it would fill the holes solid
    const evenodd =
        /evenodd/i.test(svgText) || (!!opts.importHeuristics && fillCount > 1)
    return { paths, vb, evenodd }
}

// ---- Sign library: SVGs under assets/signage/signs/<category>/ ----
// Loaded through Vite's import.meta.glob as raw text; each subfolder
// becomes its own palette section. Outside Vite (e.g. the design-sync
// preview bundle) the glob API doesn't exist and the library stays empty.
let _signFiles = {}
try {
    _signFiles = import.meta.glob("../../assets/signage/signs/**/*.svg", {
        eager: true,
        query: "?raw",
        import: "default",
    })
} catch (err) {
    _signFiles = {}
}

export const SIGN_SECTIONS = []
for (const [file, text] of Object.entries(_signFiles)) {
    const rel = file.split(/signs\//)[1] || file
    const parts = rel.split("/")
    const category = parts.length > 1 ? parts[0] : "signs"
    const name = parts[parts.length - 1]
        .replace(/\.svg$/i, "")
        .replace(/^sign_/i, "")
    const parsed = parseSvgToGlyph(text)
    if (!parsed) continue
    const id = `sign_${category}_${name}`.replace(/[^a-zA-Z0-9_]/g, "_")
    SHAPES[id] = makeShapeEntry(
        name,
        parsed.paths,
        parsed.vb,
        parsed.evenodd ? "evenodd" : undefined,
    )
    let section = SIGN_SECTIONS.find((s) => s.id === `signs-${category}`)
    if (!section) {
        section = {
            id: `signs-${category}`,
            label: category.charAt(0).toUpperCase() + category.slice(1),
            icon: id, // fallback: first sign in the category
            ids: [],
        }
        SIGN_SECTIONS.push(section)
    }
    section.ids.push(id)
}
SIGN_SECTIONS.sort((a, b) => a.label.localeCompare(b.label))

// Hand-picked section header icons (sign ids) and display sizes -
// sign SVGs have internal margins, so some render a bit larger
const SECTION_META = {
    "signs-elements": { icon: "sign_elements_Cube", iconSize: 16 },
    "signs-hazards": { icon: "sign_hazards_Death", iconSize: 26 },
    "signs-misc": { icon: "sign_misc_Aperture", iconSize: 18 },
    "signs-people": { icon: "sign_people_Person_Stand", iconSize: 16 },
}
for (const s of SIGN_SECTIONS) {
    const meta = SECTION_META[s.id]
    if (meta && SHAPES[meta.icon]) {
        s.icon = meta.icon
        if (meta.iconSize) s.iconSize = meta.iconSize
    }
}

const shapeVb = (g) => g.vb || "0 0 24 24"

// ---- Text layers ---------------------------------------------------------
// A text layer is a layer whose glyph is the TEXT_GLYPH sentinel: instead of
// SHAPES paths it renders an SVG <text> element. Its own viewBox (textVb)
// and baseline are measured from the string + font at creation/edit time,
// so the text fills the layer bounds edge-to-edge like the path glyphs do.
export const TEXT_GLYPH = "__text"
export const isTextLayer = (l) => l.glyph === TEXT_GLYPH

export const TEXT_FONTS = [
    "Arial",
    "Verdana",
    "Georgia",
    "Times New Roman",
    "Courier New",
    "Impact",
    "Trebuchet MS",
    "Comic Sans MS",
]

// Layer viewBox: text layers carry their own, path glyphs use the shape's
export const layerVb = (l) =>
    isTextLayer(l)
        ? l.textVb || "0 0 100 40"
        : (SHAPES[l.glyph] || {}).vb || "0 0 24 24"

const escapeXml = (s) =>
    String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")

// Measure a string at 100px in the given font and return the tight-bounds
// viewBox + baseline for rendering it edge-to-edge in a layer.
export function measureTextGlyph(text, fontFamily = "Arial", bold, italic) {
    const ctx = document.createElement("canvas").getContext("2d")
    ctx.font = `${italic ? "italic " : ""}${bold ? "bold " : ""}100px ${fontFamily}`
    const m = ctx.measureText(text || " ")
    const asc = Math.ceil(m.actualBoundingBoxAscent ?? 80)
    const desc = Math.ceil(m.actualBoundingBoxDescent ?? 20)
    const left = Math.ceil(m.actualBoundingBoxLeft ?? 0)
    const w = Math.max(4, Math.ceil(m.width))
    const h = Math.max(4, asc + desc)
    return {
        vb: `${-left} ${-asc} ${w} ${h}`,
        aspect: h / w, // multiply a width by this to get the height
    }
}

// SVG markup for a text layer (fill / outline / both, honoring the shared
// styleMode + colors). Outlines are always centered strokes; in "both" mode
// the stroke is painted UNDER the fill so it surrounds the glyphs.
const textLayerSvg = (l) => {
    const [, , vw, vh] = (l.textVb || "0 0 100 40").split(/\s+/).map(Number)
    const sc = Math.max(vw || 100, vh || 40) / 24
    const font =
        ` font-family="${escapeXml(l.fontFamily || "Arial")}" font-size="100"` +
        (l.bold ? ' font-weight="bold"' : "") +
        (l.italic ? ' font-style="italic"' : "")
    const tEl = (fill, stroke, sw) =>
        `<text x="0" y="0"${font} fill="${fill}"${
            stroke
                ? ` stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"`
                : ""
        }>${escapeXml(l.text || "")}</text>`
    const mode = l.styleMode || (l.outline ? "outline" : "fill")
    const w = (l.outlineWidth || 3) * sc
    if (mode === "fill") return tEl(l.color)
    if (mode === "outline") return tEl("none", l.color, w)
    return (
        tEl("none", l.outlineColor || "#000000", w * 2) + tEl(l.color)
    )
}

export function ShapeSvg({ id, color, w, h }) {
    const uid = useId()
    const g = SHAPES[id]
    if (!g) return null
    return (
        <svg
            width={w}
            height={h ?? w}
            viewBox={shapeVb(g)}
            fill={color}
            preserveAspectRatio="none"
            style={{
                display: "block",
                width: w,
                height: h ?? w,
                flexShrink: 0,
            }}>
            {(() => {
                if (g.image) {
                    return (
                        <image
                            href={g.image}
                            x={g.vbX}
                            y={g.vbY}
                            width={g.vbW}
                            height={g.vbH}
                            preserveAspectRatio="none"
                        />
                    )
                }
                const entries = pathEntries(g)
                const fills = entries.filter((p) => !p.sw)
                const strokes = entries.filter((p) => p.sw > 0)
                // Single-color glyph: strokes lying on a fill engrave it
                // (see layerInnerSvg) - mirror that in the thumbnail
                const engrave = strokes.length > 0 && fills.length > 0
                const maskAttr = engrave ? { mask: `url(#${uid}-en)` } : {}
                // evenodd only carves holes within a single path element
                const fillEls =
                    g.fillRule === "evenodd" && fills.length ? (
                        <path
                            d={fills.map((p) => p.d).join(" ")}
                            fillRule="evenodd"
                            {...maskAttr}
                        />
                    ) : (
                        fills.map((p, i) => (
                            <path
                                key={`f${i}`}
                                d={p.d}
                                fillRule={g.fillRule}
                                {...maskAttr}
                            />
                        ))
                    )
                return (
                    <>
                        {engrave && (
                            <defs>
                                {/* Explicit region: the default (-10%..110%
                                    of the viewport) clips glyphs whose
                                    viewBox doesn't start near the origin */}
                                <mask
                                    id={`${uid}-en`}
                                    maskUnits="userSpaceOnUse"
                                    x={g.vbX - g.vbW}
                                    y={g.vbY - g.vbH}
                                    width={g.vbW * 3}
                                    height={g.vbH * 3}>
                                    <rect
                                        x={g.vbX - g.vbW}
                                        y={g.vbY - g.vbH}
                                        width={g.vbW * 3}
                                        height={g.vbH * 3}
                                        fill="#fff"
                                    />
                                    {strokes.map((p, i) => (
                                        <path
                                            key={i}
                                            d={p.d}
                                            fill="none"
                                            stroke="#000"
                                            strokeWidth={p.sw}
                                            strokeLinecap="round"
                                        />
                                    ))}
                                </mask>
                            </defs>
                        )}
                        {fillEls}
                        {!engrave &&
                            strokes.map((p, i) => (
                                <path
                                    key={`s${i}`}
                                    d={p.d}
                                    fill="none"
                                    stroke={color}
                                    strokeWidth={p.sw}
                                    strokeLinecap="round"
                                />
                            ))}
                    </>
                )
            })()}
        </svg>
    )
}

// Locked output resolution for designed signage icons (square)
export const CANVAS_SIZE = 512

// The special color "transparent" makes a part an eraser: it punches that
// part's shape out of every layer below it, revealing the plate. Fill and
// outline are independent - e.g. a painted fill can carry a transparent
// outer outline that erases a band around the shape without touching the
// fill itself.
export const isEraser = (l) => l.color === "transparent"

const layerParts = (l) => {
    const mode = l.styleMode || (l.outline ? "outline" : "fill")
    const hasFill = mode === "fill" || mode === "both"
    const hasOutline = mode === "outline" || mode === "both"
    const strokeColor =
        mode === "both" ? l.outlineColor || "#000000" : l.color
    return {
        mode,
        hasFill,
        hasOutline,
        strokeColor,
        fillTrans: hasFill && l.color === "transparent",
        outlineTrans: hasOutline && strokeColor === "transparent",
    }
}

// True when any part of the layer erases (canvas shows those parts as a
// checkerboard ghost)
export const hasEraserPart = (l) => {
    const p = layerParts(l)
    return p.fillTrans || p.outlineTrans
}

const clampOpacity = (v) => Math.max(0, Math.min(1, v))

// Renders a layer's inner SVG markup (shared by the designer canvas, the
// thumbnails, and the PNG rasterizer so all three agree pixel-for-pixel).
// Layer style props: styleMode ("fill"|"outline"|"both"), outlineAlign
// ("inner"|"center"|"outer"), outlineWidth (1-8, in 24-unit path space),
// outlineColor (used in "both" mode), rounded (bool).
// SVG can only stroke centered on the edge, so inner clips the stroke to the
// shape and outer masks the shape out of it (double width, half survives).
export function layerInnerSvg(l, uid, opts = {}) {
    // Text layers render an SVG <text> element instead of shape paths.
    // The same markup works inside eraser masks (black text hides).
    if (isTextLayer(l)) return textLayerSvg(l)
    const g = SHAPES[l.glyph]
    if (!g) return ""
    // A picture is drawn as it is, without a color or an outline
    if (g.image) return pictureSvg(g)
    const c = l.color
    const mode = l.styleMode || (l.outline ? "outline" : "fill")
    // High miter limit keeps sharp corners (triangles, stars) pointed
    // instead of abruptly bevelling them off mid-stroke
    const join = l.rounded
        ? ' stroke-linejoin="round" stroke-linecap="round"'
        : ' stroke-linejoin="miter" stroke-miterlimit="10"'

    // Custom SVGs have their own coordinate space - scale strokes to match
    const sc = g.strokeScale || 1
    const bx = g.vbX ?? 0
    const by = g.vbY ?? 0
    const bw = g.vbW ?? 24
    const bh = g.vbH ?? 24
    const fr = g.fillRule ? ` fill-rule="${g.fillRule}"` : ""

    const entries = pathEntries(g)
    // Fill subpaths and stroke subpaths ({d, sw} imports) render differently.
    // With the evenodd rule, ALL fill subpaths must merge into ONE compound
    // path - the rule only carves holes within a single path element.
    const fillDs = entries.filter((e) => !e.sw).map((e) => e.d)
    const strokeEs = entries.filter((e) => e.sw > 0)
    const fillPaths = (color, extra = "", perPath = "") =>
        g.fillRule === "evenodd"
            ? fillDs.length
                ? `<path d="${fillDs.join(" ")}" fill="${color}"${fr}${perPath}${extra}/>`
                : ""
            : fillDs
                  .map(
                      (d) =>
                          `<path d="${d}" fill="${color}"${fr}${perPath}${extra}/>`,
                  )
                  .join("")
    const strokePaths = (color, extra = "") =>
        strokeEs
            .map(
                ({ d, sw }) =>
                    `<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`,
            )
            .join("")
    // Whole shape in one solid color (used directly and inside masks)
    const solid = (color, extra = "") =>
        fillPaths(color, extra) + strokePaths(color, extra)

    const fillMarkup = () => {
        const roundedPer = l.rounded
            ? ` stroke="${c}" stroke-width="${3 * sc}"${join}`
            : ""
        // A glyph is single-color, so stroke subpaths lying ON a fill would
        // be invisible - engrave them instead (cut the stroke band out of
        // the fill), like line art on a stencil. Not inside eraser masks
        // (nested masks are unreliable in Chromium; there the solid shape
        // is the right cut anyway).
        const engrave = strokeEs.length && fillDs.length && !opts.maskContext
        if (!engrave) return fillPaths(c, "", roundedPer) + strokePaths(c)
        return (
            `<defs><mask id="${uid}-en" maskUnits="userSpaceOnUse" x="${bx - bw}" y="${by - bh}" width="${bw * 3}" height="${bh * 3}">` +
            `<rect x="${bx - bw}" y="${by - bh}" width="${bw * 3}" height="${bh * 3}" fill="#fff"/>` +
            strokePaths("#000") +
            `</mask></defs>` +
            fillPaths(c, ` mask="url(#${uid}-en)"`, roundedPer)
        )
    }

    const outlineMarkup = (strokeColor) => {
        const w = (l.outlineWidth || 3) * sc
        const align = l.outlineAlign || "center"
        const strokes = (width, extra = "") =>
            entries
                .map(
                    ({ d, sw }) =>
                        `<path d="${d}" fill="none" stroke="${strokeColor}" stroke-width="${sw > 0 ? Math.max(sw, width) : width}"${join}${extra}/>`,
                )
                .join("")

        if (align === "center") return strokes(w)
        if (align === "inner") {
            if (opts.maskContext) {
                // Inside an eraser mask, Chromium ignores masks/clips on the
                // cut elements themselves, so an exact inner band can't be
                // expressed here. This path is only reached when the fill is
                // ALSO being cut (see layersSvgMarkup, which handles the
                // outline-only inner cut with a repaint pass) - and the fill
                // cut already covers the entire inner band, so emit nothing.
                return ""
            }
            // Painted context: keep the half of a double-width stroke that
            // falls inside the shape (white shape = keep)
            const shape = solid("#fff")
            return (
                `<defs><mask id="${uid}-in" maskUnits="userSpaceOnUse" x="${bx - bw}" y="${by - bh}" width="${bw * 3}" height="${bh * 3}">${shape}</mask></defs>` +
                strokes(w * 2, ` mask="url(#${uid}-in)"`)
            )
        }
        // outer - mask the shape's interior out of a double-width stroke.
        // Explicit region: the default (-10%..110% of the shape's bbox)
        // clips thick strokes into a square
        const cutout = solid("#000")
        return (
            `<defs><mask id="${uid}-mk" maskUnits="userSpaceOnUse" x="${bx - bw}" y="${by - bh}" width="${bw * 3}" height="${bh * 3}"><rect x="${bx - bw}" y="${by - bh}" width="${bw * 3}" height="${bh * 3}" fill="#fff"/>${cutout}</mask></defs>` +
            strokes(w * 2, ` mask="url(#${uid}-mk)"`)
        )
    }

    if (mode === "fill") return fillMarkup()
    if (mode === "outline") return outlineMarkup(c)
    // both - fill first, then the outline (its own color) on top
    return fillMarkup() + outlineMarkup(l.outlineColor || "#000000")
}

// Composes a whole layer stack as SVG markup, applying eraser layers as
// masks over everything below them. Shared by the thumbnails and the PNG
// rasterizer (the interactive canvas renders layers individually for
// hit-testing, showing erasers as a checkerboard ghost instead).
// Hidden layers are skipped; flipH/flipV mirror the layer around its own
// center (composed after the rotation, matching the canvas CSS transform);
// opacity < 1 fades the layer (and proportionally weakens eraser cuts).
export function layersSvgMarkup(layers, uidPrefix) {
    const wrap = (l, inner) => {
        const cx = l.w / 2
        const cy = l.h / 2
        const flip =
            l.flipH || l.flipV
                ? ` translate(${cx} ${cy}) scale(${l.flipH ? -1 : 1} ${l.flipV ? -1 : 1}) translate(${-cx} ${-cy})`
                : ""
        const op =
            l.opacity != null && l.opacity < 1
                ? ` opacity="${clampOpacity(l.opacity)}"`
                : ""
        return (
            `<g${op} transform="translate(${l.x},${l.y}) rotate(${l.rot || 0} ${cx} ${cy})${flip}">` +
            `<svg x="0" y="0" width="${l.w}" height="${l.h}" viewBox="${layerVb(l)}" preserveAspectRatio="none" overflow="visible">${inner}</svg>` +
            `</g>`
        )
    }
    let acc = ""
    layers.forEach((l, i) => {
        if (l.hidden) return
        const uid = `${uidPrefix}-${l.id}-${i}`
        const p = layerParts(l)

        // Order: paint fill → apply eraser cuts → paint outline. So a
        // transparent inner/center outline carves the layer's own fill
        // (inset ring), while a painted outline is never carved by the
        // layer's own transparent fill.
        if (p.hasFill && !p.fillTrans) {
            acc += wrap(l, layerInnerSvg({ ...l, styleMode: "fill" }, `${uid}f`))
        }

        let cutSpec = null
        // Text outlines are always center-aligned, so the inner-cut repaint
        // pass (which needs shape paths) never applies to them
        const innerOnlyCut =
            !isTextLayer(l) &&
            p.outlineTrans &&
            !p.fillTrans &&
            (l.outlineAlign || "center") === "inner"
        if (p.fillTrans && p.outlineTrans) {
            cutSpec = { ...l, styleMode: "both", color: "#000", outlineColor: "#000" }
        } else if (p.fillTrans) {
            cutSpec = { ...l, styleMode: "fill", color: "#000" }
        } else if (innerOnlyCut) {
            // Chromium can't express an inner-only band inside a mask (see
            // layerInnerSvg). Erase the full double-width band instead, then
            // repaint the pre-cut stack over the outer half below.
            cutSpec = {
                ...l,
                styleMode: "outline",
                outlineAlign: "center",
                outlineWidth: (l.outlineWidth || 3) * 2,
                color: "#000",
            }
        } else if (p.outlineTrans) {
            cutSpec = { ...l, styleMode: "outline", color: "#000" }
        }
        if (cutSpec) {
            const before = acc
            // Black hides in a mask - the cut erases the stack so far
            const cut = wrap(
                l,
                layerInnerSvg(cutSpec, `${uid}e`, { maskContext: true }),
            )
            acc =
                `<defs><mask id="${uid}-er"><rect x="0" y="0" width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" fill="#fff"/>${cut}</mask></defs>` +
                `<g mask="url(#${uid}-er)">${acc}</g>`

            if (innerOnlyCut && before) {
                // Restore the outer half: repaint the pre-cut stack masked to
                // the band-outside-the-shape region (white band strokes with
                // the shape fill blacked out on top - a mask form Chromium
                // honors at the top level).
                const g2 = SHAPES[l.glyph]
                const sc = g2.strokeScale || 1
                const fr = g2.fillRule ? ` fill-rule="${g2.fillRule}"` : ""
                const join = l.rounded
                    ? ' stroke-linejoin="round" stroke-linecap="round"'
                    : ' stroke-linejoin="miter" stroke-miterlimit="10"'
                const w2 = (l.outlineWidth || 3) * 2 * sc
                const entries2 = pathEntries(g2)
                const fillDs2 = entries2.filter((e) => !e.sw).map((e) => e.d)
                const blackFill =
                    g2.fillRule === "evenodd"
                        ? fillDs2.length
                            ? `<path d="${fillDs2.join(" ")}" fill="#000"${fr}/>`
                            : ""
                        : fillDs2
                              .map((d) => `<path d="${d}" fill="#000"${fr}/>`)
                              .join("")
                const obContent =
                    `<rect x="0" y="0" width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" fill="#000"/>` +
                    wrap(
                        l,
                        entries2
                            .map(
                                ({ d, sw }) =>
                                    `<path d="${d}" fill="none" stroke="#fff" stroke-width="${sw > 0 ? Math.max(sw, w2) : w2}"${join}/>`,
                            )
                            .join("") +
                            blackFill +
                            entries2
                                .filter((e) => e.sw > 0)
                                .map(
                                    ({ d, sw }) =>
                                        `<path d="${d}" fill="none" stroke="#000" stroke-width="${sw}" stroke-linecap="round"/>`,
                                )
                                .join(""),
                    )
                acc +=
                    `<defs><mask id="${uid}-ob" maskUnits="userSpaceOnUse" x="${-CANVAS_SIZE}" y="${-CANVAS_SIZE}" width="${CANVAS_SIZE * 3}" height="${CANVAS_SIZE * 3}">${obContent}</mask></defs>` +
                    `<g mask="url(#${uid}-ob)">${before}</g>`
            }
        }

        if (p.hasOutline && !p.outlineTrans) {
            acc += wrap(
                l,
                layerInnerSvg(
                    { ...l, styleMode: "outline", color: p.strokeColor },
                    uid,
                ),
            )
        }
    })
    return acc
}

// Renders a layer stack as a small SVG thumbnail on the signage backplate
// (same composition as the exported PNG, so previews are exact).
export function LayersThumb({ layers, size }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox={`0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`}
            style={{ display: "block", borderRadius: 4 }}>
            <image
                href={signBg}
                x={0}
                y={0}
                width={CANVAS_SIZE}
                height={CANVAS_SIZE}
            />
            <g
                dangerouslySetInnerHTML={{
                    __html: layersSvgMarkup(layers, `t${size}`),
                }}
            />
        </svg>
    )
}

// Rasterize a layer stack to a size x size PNG data URL (the texture size
// setting; 512 by default) - the signage backplate first, then the layers
// (WYSIWYG with the designer canvas).
export function rasterizeLayers(layers, size = CANVAS_SIZE) {
    const inner = layersSvgMarkup(layers, "r")
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}">` +
        inner +
        `</svg>`

    const loadImg = (src) =>
        new Promise((resolve, reject) => {
            const img = new Image()
            img.onload = () => resolve(img)
            img.onerror = reject
            img.src = src
        })

    return Promise.all([
        loadImg(signBg),
        loadImg("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)),
    ]).then(([bg, fg]) => {
        const canvas = document.createElement("canvas")
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext("2d")
        ctx.drawImage(bg, 0, 0, size, size)
        ctx.drawImage(fg, 0, 0, size, size)
        return canvas.toDataURL("image/png")
    })
}

// Renders the in-game material texture for a signage design, in the exact
// format stock Portal 2 signage uses: a fully OPAQUE image (the standard
// white backplate with the artwork composited on top - same WYSIWYG result
// as the editor icon), where the ALPHA CHANNEL is the self-illum mask. Stock
// signage VMTs set $selfillum with no $selfillummask, which tells Source to
// glow wherever the base texture's alpha is bright - so the white plate
// lights up and the dark artwork stays unlit, like the built-in signs.
//
// opts.glowMode picks the alpha content:
//   "brightness" (default) - alpha = pixel luminance: white plate glows,
//       dark art doesn't (matches stock signage exactly)
//   "shape" - alpha = 255 everywhere: the whole sign glows uniformly
//   "off"   - hasGlow false; the VMT omits $selfillum entirely
//
// Returns { base, hasGlow }: base is the data-URL PNG, hasGlow tells the
// backend whether to write $selfillum.
export function rasterizeSignageTextures(layers, size = CANVAS_SIZE, opts = {}) {
    const glowMode = opts.glowMode || "brightness"
    const inner = layersSvgMarkup(layers, "m")
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}">` +
        inner +
        `</svg>`

    const loadImg = (src) =>
        new Promise((resolve, reject) => {
            const img = new Image()
            img.onload = () => resolve(img)
            img.onerror = reject
            img.src = src
        })

    return Promise.all([
        loadImg(signBg),
        loadImg("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)),
    ]).then(([bg, fg]) => {
        const canvas = document.createElement("canvas")
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext("2d")
        ctx.drawImage(bg, 0, 0, size, size)
        ctx.drawImage(fg, 0, 0, size, size)

        // The layers alone, to tell artwork pixels from bare plate
        const fgCanvas = document.createElement("canvas")
        fgCanvas.width = size
        fgCanvas.height = size
        const fgCtx = fgCanvas.getContext("2d")
        fgCtx.drawImage(fg, 0, 0, size, size)
        const cov = fgCtx.getImageData(0, 0, size, size).data

        // Build the glow mask as a SEPARATE grayscale image (the backend
        // joins it into the texture's alpha channel). It can't be baked in
        // here: canvas stores premultiplied pixels, so alpha 0 destroys the
        // RGB underneath - the frame would export as solid black.
        //
        // Mask values match the canonical BEE2 signage textures: the bare
        // plate glows at a flat ~37.5% (96) and artwork glows by its own
        // brightness (near-zero for black art). The metal FRAME gets a
        // faint glow so it doesn't read as a pitch-black band in dim rooms.
        const PLATE = 110
        const FRAME = 0
        const ART_FLOOR = 2.25
        // Width of the non-glowing frame ring, in 128-scale pixels
        // (sign_bg's metal border) - smaller = thinner dark edge
        const FRAME_WIDTH = 3
        const inset = Math.max(1, Math.round(size * (FRAME_WIDTH / 128)))
        const px = ctx.getImageData(0, 0, size, size)
        const d = px.data
        const maskCanvas = document.createElement("canvas")
        maskCanvas.width = size
        maskCanvas.height = size
        const mctx = maskCanvas.getContext("2d")
        const mpx = mctx.createImageData(size, size)
        const m = mpx.data
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const i = (y * size + x) * 4
                let a
                if (
                    x < inset ||
                    y < inset ||
                    x >= size - inset ||
                    y >= size - inset
                ) {
                    a = FRAME
                } else if (glowMode === "shape") {
                    a = PLATE
                } else if (cov[i + 3] > 8) {
                    // artwork: glow by its brightness (never fully dark)
                    const lum =
                        0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
                    a = Math.max(Math.round((lum * PLATE) / 255), ART_FLOOR)
                } else {
                    a = PLATE // bare plate
                }
                m[i] = m[i + 1] = m[i + 2] = a
                m[i + 3] = 255
            }
        }
        mctx.putImageData(mpx, 0, 0)
        return {
            base: canvas.toDataURL("image/png"),
            mask: maskCanvas.toDataURL("image/png"),
            hasGlow: glowMode !== "off",
        }
    })
}
