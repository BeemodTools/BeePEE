import { useState, useRef, useEffect, useCallback } from "react"
import {
    Box,
    Typography,
    TextField,
    Button,
    IconButton,
    Slider,
    Tooltip,
    Stack,
    Divider,
    ToggleButton,
    ToggleButtonGroup,
    Checkbox,
    FormControlLabel,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
    Menu,
    MenuItem,
} from "@mui/material"
import { useTheme } from "@mui/material/styles"
import {
    ChevronLeft,
    ChevronRight,
    ExpandMore,
    Save as SaveIcon,
    Close,
    Visibility,
    VisibilityOff,
    Flip,
    Link as LinkIcon,
    LinkOff,
    Title as TitleIcon,
} from "@mui/icons-material"
import {
    GLYPHS,
    PRIMS,
    SHAPES,
    ShapeSvg,
    CANVAS_SIZE,
    SIGN_BG,
    layerInnerSvg,
    hasEraserPart,
    registerCustomGlyph,
    parseSvgToGlyph,
    SIGN_SECTIONS,
    serializeDesign,
    rehydrateDesign,
    rasterizeLayers,
    TEXT_GLYPH,
    TEXT_FONTS,
    isTextLayer,
    layerVb,
    measureTextGlyph,
} from "./glyphs"
import {
    loadSignagePrefs,
    SIGNAGE_PREF_DEFAULTS,
} from "./SignagePreferences"

// On the interactive canvas, transparent (eraser) parts render as a
// checkerboard ghost while painted parts keep their color (true erasing
// needs the whole stack composited - see the preview thumbs and the
// exported PNG for the real result).
const eraserGhostSvg = (l, uid) => {
    const pat = `url(#${uid}-ck)`
    return (
        `<defs><pattern id="${uid}-ck" width="6" height="6" patternUnits="userSpaceOnUse">` +
        `<rect width="6" height="6" fill="#c4c4c4"/>` +
        `<rect width="3" height="3" fill="#f0f0f0"/>` +
        `<rect x="3" y="3" width="3" height="3" fill="#f0f0f0"/>` +
        `</pattern></defs>` +
        layerInnerSvg(
            {
                ...l,
                color: l.color === "transparent" ? pat : l.color,
                outlineColor:
                    l.outlineColor === "transparent" ? pat : l.outlineColor,
            },
            uid,
        )
    )
}

// Palette sections - extensible: add a new entry to show another category.
const PALETTE_SECTIONS = [
    { id: "glyphs", label: "Glyphs", icon: "star", ids: Object.keys(GLYPHS) },
    { id: "prims", label: "Primitives", icon: "square", ids: Object.keys(PRIMS) },
]
const DISPLAY = 360 // on-screen canvas size
const GRID_STEPS = [0, 2, 4, 8, 16, 32, 64] // powers of 2; 0 = None (snap off)
const CUSTOM_PRESET = ["#4caf50", "#e05c4a", "#4a90d9"] // extra presets after B/W + gold
const MAX_LAYER = 2048 // layers may extend well past the 512 canvas

// A per-module-load random token keeps new-layer ids unique even if this file
// is hot-reloaded (HMR) while React preserves layers created before the reload.
// Without it, a reset counter re-mints an id an existing layer already holds,
// and two layers sharing an id become "linked" - selected and moved together,
// impossible to separate.
const _sess = Math.random().toString(36).slice(2, 8)
let _lid = 0
const nextId = () => `L${_sess}_${++_lid}`
let _gid = 0
const nextGroupId = () => `G${_sess}_${++_gid}`
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

// Stable accent color per group id for the layers panel link badges
const GROUP_COLORS = ["#e05c4a", "#4a90d9", "#4caf50", "#b46be0", "#e0a13c", "#3cc9c9"]
const groupColor = (gid) => {
    let h = 0
    for (let i = 0; i < gid.length; i++) h = (h * 31 + gid.charCodeAt(i)) >>> 0
    return GROUP_COLORS[h % GROUP_COLORS.length]
}

// Black or white, whichever contrasts with the given fill color - so a
// freshly enabled outline is never invisible (e.g. black-on-black)
const contrastFor = (hex) => {
    if (!hex || hex[0] !== "#" || hex.length < 7) return "#ffffff"
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5
        ? "#000000"
        : "#ffffff"
}

// align tool icon (18x18): a gold guide edge + bars aligned to it
function AlignIcon({ type, gold, bar }) {
    const rc = (x, y, w, ht, fill, key) => (
        <rect key={key} x={x} y={y} width={w} height={ht} rx={0.6} fill={fill} />
    )
    let els
    if (type === "left")
        els = [rc(2, 2.5, 2, 13, gold, "g"), rc(5.5, 4.5, 9, 3.4, bar, "a"), rc(5.5, 9.6, 6, 3.4, bar, "b")]
    else if (type === "ch")
        els = [rc(8.6, 2.5, 1.6, 13, gold, "g"), rc(2.5, 4.5, 13, 3.4, bar, "a"), rc(5, 9.6, 8, 3.4, bar, "b")]
    else if (type === "right")
        els = [rc(14, 2.5, 2, 13, gold, "g"), rc(3.5, 4.5, 9, 3.4, bar, "a"), rc(6.5, 9.6, 6, 3.4, bar, "b")]
    else if (type === "top")
        els = [rc(2.5, 2, 13, 2, gold, "g"), rc(4.5, 5.5, 3.4, 9, bar, "a"), rc(9.6, 5.5, 3.4, 6, bar, "b")]
    else if (type === "mv")
        els = [rc(2.5, 8.6, 13, 1.6, gold, "g"), rc(4.5, 2.5, 3.4, 13, bar, "a"), rc(9.6, 5, 3.4, 8, bar, "b")]
    else
        els = [rc(2.5, 14, 13, 2, gold, "g"), rc(4.5, 3.5, 3.4, 9, bar, "a"), rc(9.6, 6.5, 3.4, 6, bar, "b")]
    return (
        <svg width={18} height={18} viewBox="0 0 18 18" style={{ display: "block" }}>
            {els}
        </svg>
    )
}

// Numeric field that lets you type a full value before it's clamped. The
// parent clamps/snaps in onChange, so committing per keystroke makes a digit
// like "1" jump to the min (24) before you can finish typing "1024". Instead
// we hold an uncommitted draft string while focused and only commit - firing
// onChange - on blur or Enter. Escape cancels back to the current value.
function NumField({ label, value, min, max, onChange }) {
    const [draft, setDraft] = useState(null)
    const commit = () => {
        setDraft((d) => {
            if (d !== null && d.trim() !== "" && Number.isFinite(+d)) {
                onChange(+d)
            }
            return null
        })
    }
    return (
        <TextField
            label={label}
            type="number"
            size="small"
            value={draft !== null ? draft : value}
            inputProps={{ min, max }}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
                // MUI forwards onKeyDown to the root, so e.currentTarget is the
                // wrapper div (blur() there is a no-op). Commit directly and
                // blur the actual input (e.target) to leave the field.
                if (e.key === "Enter") {
                    e.preventDefault()
                    commit()
                    e.target.blur()
                } else if (e.key === "Escape") {
                    e.preventDefault()
                    setDraft(null)
                    e.target.blur()
                }
            }}
            fullWidth
        />
    )
}

function SignageDesigner({
    onCancel,
    onSave,
    isSaving = false,
    initialLayers = [],
    saveLabel = "Save Signage",
    name = "",
}) {
    const theme = useTheme()
    const gold = theme.palette.primary.main

    const [layers, setLayers] = useState(() =>
        initialLayers.map((l) => ({ ...l })),
    )
    const [selIds, setSelIds] = useState([])
    const [marquee, setMarquee] = useState(null) // {x0,y0,x1,y1} in canvas units
    const [histVersion, setHistVersion] = useState(0) // bumps to refresh undo/redo buttons
    const [dropHint, setDropHint] = useState(false)
    const [snap, setSnap] = useState(true)
    const [gridN, setGridN] = useState(8)
    const [snapMenu, setSnapMenu] = useState(false)
    // All palette sections start collapsed
    const [openSections, setOpenSections] = useState({})
    const [paletteOpen, setPaletteOpen] = useState(true)
    const [outlineOpen, setOutlineOpen] = useState(false)
    const [paletteW, setPaletteW] = useState(176)
    const [propsW, setPropsW] = useState(210)
    const [layersH, setLayersH] = useState(240) // layers pane height (dock bottom)
    const [customIds, setCustomIds] = useState([])
    const [zoom, setZoom] = useState(1) // canvas magnification, 0.5–4
    const svgInputRef = useRef(null)
    const canvasRef = useRef(null)
    const scrollWrapRef = useRef(null) // scrollable viewport around the canvas
    const op = useRef(null) // active transform: { type, ... }
    const clipboard = useRef(null) // copied layers (Ctrl+C / Ctrl+V)
    const sideDrag = useRef(null) // sidebar resize: { side, startX, startW }
    // Layers panel: row being dragged, drop indicator, inline rename
    const layerDrag = useRef(null)
    const [dropMark, setDropMark] = useState(null) // { id, before }
    const [renameId, setRenameId] = useState(null)
    const [renameDraft, setRenameDraft] = useState("")
    // Right-click layer menu: { mouseX, mouseY, layerId }
    const [ctxMenu, setCtxMenu] = useState(null)
    // Text layer being edited in place on the canvas (double-click)
    const [editingTextId, setEditingTextId] = useState(null)

    // ---- Preferences -------------------------------------------------
    const [prefs, setPrefs] = useState(SIGNAGE_PREF_DEFAULTS)
    const prefsRef = useRef(prefs)
    prefsRef.current = prefs
    const [recentGlyphs, setRecentGlyphs] = useState([])
    const [confirmCloseOpen, setConfirmCloseOpen] = useState(false)

    // Load prefs on mount and apply the session defaults they control
    useEffect(() => {
        let alive = true
        loadSignagePrefs().then(async (p) => {
            if (!alive) return
            setPrefs(p)
            setSnap(!!p.signageDefaultSnap)
            setGridN(p.signageDefaultGridN || 8)
            if (p.signageOpenSections === "all") {
                const all = { custom: true, recent: true }
                for (const s of [...SIGN_SECTIONS, ...PALETTE_SECTIONS])
                    all[s.id] = true
                setOpenSections(all)
            }
            try {
                const r = await window.package?.getSetting?.(
                    "signageRecentGlyphsList",
                )
                if (alive && r?.success && Array.isArray(r.value)) {
                    setRecentGlyphs(r.value)
                }
            } catch {
                /* recent list is best-effort */
            }
            // Auto-import SVGs from the configured folder into the palette
            try {
                const res = await window.package?.listSignageSvgFolder?.()
                if (alive && res?.success && res.files?.length) {
                    const ids = []
                    for (const f of res.files) {
                        try {
                            const parsed = parseSvgToGlyph(f.content, { importHeuristics: true })
                            if (parsed) {
                                ids.push(
                                    registerCustomGlyph(
                                        f.name,
                                        parsed.paths,
                                        parsed.vb,
                                        parsed.evenodd ? "evenodd" : undefined,
                                    ),
                                )
                            }
                        } catch {
                            /* skip unparseable SVGs */
                        }
                    }
                    if (ids.length) {
                        setCustomIds((prev) => [...new Set([...prev, ...ids])])
                    }
                }
            } catch {
                /* folder scan is best-effort */
            }
        })
        return () => {
            alive = false
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Preferences are edited in the separate settings window - re-read them
    // when this window regains focus so saves there apply here. Session
    // defaults (snap, grid) are deliberately left alone mid-session.
    useEffect(() => {
        const refresh = () => loadSignagePrefs().then(setPrefs)
        window.addEventListener("focus", refresh)
        return () => window.removeEventListener("focus", refresh)
    }, [])

    // ---- Zoom -------------------------------------------------------
    const zoomBy = useCallback((factor) => {
        setZoom((z) => clamp(Math.round(z * factor * 100) / 100, 0.5, 4))
    }, [])
    const zoomReset = useCallback(() => setZoom(1), [])

    // Ctrl+scroll zooms. Native listener: React's onWheel is passive, so
    // preventDefault (needed to stop page scroll) wouldn't work there.
    useEffect(() => {
        const el = scrollWrapRef.current
        if (!el) return
        const onWheel = (e) => {
            if (!e.ctrlKey) return
            e.preventDefault()
            zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2)
        }
        el.addEventListener("wheel", onWheel, { passive: false })
        return () => el.removeEventListener("wheel", onWheel)
    }, [zoomBy])

    // Close, guarded by the confirm-discard preference when there are
    // unsaved edits (any history entries = the design was touched).
    const requestClose = () => {
        if (
            prefsRef.current.signageConfirmDiscard &&
            undoStack.current.length > 0
        ) {
            setConfirmCloseOpen(true)
        } else {
            onCancel()
        }
    }

    // ---- Undo / redo -------------------------------------------------
    const layersRef = useRef(layers)
    layersRef.current = layers
    const undoStack = useRef([])

    // "*" in the window title while the design has unsaved edits. The base
    // title is owned by the page (it changes per loaded design), so only
    // the prefix is toggled here.
    useEffect(() => {
        const base = document.title.replace(/^\*/, "")
        document.title = (undoStack.current.length > 0 ? "*" : "") + base
    }, [layers])
    const redoStack = useRef([])
    const lastPush = useRef({ tag: null, time: 0 })

    // Snapshot the current layers before a mutation. Continuous inputs
    // (sliders, arrow nudges) pass a coalesce tag so a burst of changes
    // becomes a single undo step.
    const pushHistory = (coalesceTag) => {
        const now = Date.now()
        if (
            coalesceTag &&
            lastPush.current.tag === coalesceTag &&
            now - lastPush.current.time < 800
        ) {
            lastPush.current.time = now
            return
        }
        lastPush.current = { tag: coalesceTag || null, time: now }
        undoStack.current.push(layersRef.current)
        if (undoStack.current.length > 100) undoStack.current.shift()
        redoStack.current = []
        setHistVersion((v) => v + 1)
    }

    const undo = () => {
        if (!undoStack.current.length) return
        redoStack.current.push(layersRef.current)
        const prev = undoStack.current.pop()
        lastPush.current = { tag: null, time: 0 }
        setLayers(prev)
        setSelIds((ids) => ids.filter((id) => prev.some((l) => l.id === id)))
        setHistVersion((v) => v + 1)
    }

    const redo = () => {
        if (!redoStack.current.length) return
        undoStack.current.push(layersRef.current)
        const next = redoStack.current.pop()
        lastPush.current = { tag: null, time: 0 }
        setLayers(next)
        setSelIds((ids) => ids.filter((id) => next.some((l) => l.id === id)))
        setHistVersion((v) => v + 1)
    }

    // Sidebar stretch handles
    useEffect(() => {
        const move = (e) => {
            const d = sideDrag.current
            if (!d) return
            e.preventDefault()
            if (d.side === "layers") {
                // Horizontal splitter between the edit pane and layers pane
                const dy = e.clientY - d.startY
                setLayersH(clamp(d.startH - dy, 90, 560))
                return
            }
            const dx = e.clientX - d.startX
            if (d.side === "left") setPaletteW(clamp(d.startW + dx, 120, 340))
            else setPropsW(clamp(d.startW - dx, 170, 380))
        }
        const up = () => {
            sideDrag.current = null
        }
        window.addEventListener("mousemove", move)
        window.addEventListener("mouseup", up)
        return () => {
            window.removeEventListener("mousemove", move)
            window.removeEventListener("mouseup", up)
        }
    }, [])

    const cell = gridN > 0 ? CANVAS_SIZE / gridN : 0
    const selSet = new Set(selIds)
    // Single-selection layer - the full transform panel needs exactly one
    const selLayer =
        selIds.length === 1
            ? layers.find((l) => l.id === selIds[0]) || null
            : null

    const snapLayer = useCallback(
        (l, doSnap) => {
            if (!doSnap || !cell) return l
            const cx = Math.round((l.x + l.w / 2) / cell) * cell
            const cy = Math.round((l.y + l.h / 2) / cell) * cell
            return { ...l, x: cx - l.w / 2, y: cy - l.h / 2 }
        },
        [cell],
    )

    // Applies to every selected layer (property edits work on multi-select)
    const updateSel = (fn) => {
        pushHistory("prop")
        setLayers((ls) => ls.map((l) => (selSet.has(l.id) ? fn(l) : l)))
    }

    const addLayer = useCallback(
        (glyph, x, y) => {
            const p = prefsRef.current
            const id = nextId()
            let size = p.signageDefaultShapeSize || 128
            if (snap && cell) {
                size = Math.max(cell, Math.round(size / cell) * cell)
            }
            // Non-square glyphs (imported SVGs) keep their aspect: the
            // longer side gets the default size
            const shape = SHAPES[glyph]
            const aspect =
                shape && shape.vbW && shape.vbH ? shape.vbH / shape.vbW : 1
            let w = size
            let h = size
            if (aspect > 1) w = Math.max(24, Math.round(size / aspect))
            else if (aspect < 1) h = Math.max(24, Math.round(size * aspect))
            if (snap && cell) {
                w = Math.max(cell, Math.round(w / cell) * cell)
                h = Math.max(cell, Math.round(h / cell) * cell)
            }
            const color = p.signageDefaultColor || "#000000"
            let l = {
                id,
                glyph,
                x: x - w / 2,
                y: y - h / 2,
                w,
                h,
                color,
                rot: 0,
                styleMode: p.signageDefaultOutlineOn ? "both" : "fill",
                outlineAlign: p.signageDefaultOutlineAlign || "center",
                outlineWidth: p.signageDefaultOutlineWidth || 3,
                outlineColor: contrastFor(color),
                rounded: false,
            }
            l = snapLayer(l, snap)
            pushHistory()
            setLayers((ls) => [...ls, l])
            setSelIds([id])
            // Track recently-used glyphs (deduped, most recent first)
            setRecentGlyphs((prev) => {
                const next = [glyph, ...prev.filter((g) => g !== glyph)].slice(
                    0,
                    12,
                )
                window.package
                    ?.setSetting?.("signageRecentGlyphsList", next)
                    .catch?.(() => {})
                return next
            })
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [cell, snap, snapLayer],
    )

    // Drop a new text layer in the canvas center, sized like a default
    // shape (height from prefs, width from the measured text aspect)
    const addTextLayer = useCallback(() => {
        const p = prefsRef.current
        const id = nextId()
        const text = "TEXT"
        const fontFamily = "Arial"
        const m = measureTextGlyph(text, fontFamily, false, false)
        const h = Math.max(24, Math.round(p.signageDefaultShapeSize || 128) / 2)
        const w = clamp(Math.round(h / m.aspect), 24, CANVAS_SIZE)
        const color = p.signageDefaultColor || "#000000"
        let l = {
            id,
            glyph: TEXT_GLYPH,
            text,
            fontFamily,
            bold: false,
            italic: false,
            textVb: m.vb,
            x: CANVAS_SIZE / 2 - w / 2,
            y: CANVAS_SIZE / 2 - h / 2,
            w,
            h,
            color,
            rot: 0,
            styleMode: "fill",
            outlineAlign: "center",
            outlineWidth: p.signageDefaultOutlineWidth || 3,
            outlineColor: contrastFor(color),
            rounded: false,
        }
        l = snapLayer(l, snap)
        pushHistory()
        setLayers((ls) => [...ls, l])
        setSelIds([id])
        // A fresh text layer goes straight into in-place editing
        setEditingTextId(id)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [snap, snapLayer])

    // Re-measure a text layer after content/font changes; the height is
    // kept and the width follows the new text's aspect ratio
    const remeasureText = (l, patch) => {
        const next = { ...l, ...patch }
        const m = measureTextGlyph(
            next.text,
            next.fontFamily,
            next.bold,
            next.italic,
        )
        return {
            ...next,
            textVb: m.vb,
            w: clamp(Math.round(next.h / m.aspect), 4, MAX_LAYER),
        }
    }

    // Sidebar font/style edits apply to the whole selection
    const updateTextLayer = (patch) => {
        updateSel((l) => (isTextLayer(l) ? remeasureText(l, patch) : l))
    }

    // In-place editor edits exactly one layer (coalesced into one undo step)
    const updateTextById = (id, patch) => {
        pushHistory("text-edit")
        setLayers((ls) =>
            ls.map((l) =>
                l.id === id && isTextLayer(l) ? remeasureText(l, patch) : l,
            ),
        )
    }

    const toCanvas = (e) => {
        const r = canvasRef.current.getBoundingClientRect()
        const scale = CANVAS_SIZE / r.width
        return { x: (e.clientX - r.left) * scale, y: (e.clientY - r.top) * scale }
    }

    const onCanvasDrop = (e) => {
        e.preventDefault()
        // The column/viewport drop handlers would also fire via bubbling and
        // add a second copy
        e.stopPropagation()
        setDropHint(false)
        const glyph = e.dataTransfer.getData("glyph")
        if (!glyph) return
        const p = toCanvas(e)
        addLayer(glyph, p.x, p.y)
    }

    // Default export filename from the sign's name (filename-safe), or a
    // generic fallback for an as-yet-unnamed new design.
    const exportBaseName = (ext) => {
        const base = name.trim().replace(/[\\/:*?"<>|]+/g, "").trim()
        return `${base || "signage"}.${ext}`
    }

    const exportPng = async () => {
        if (!layers.length) return
        try {
            const dataUrl = await rasterizeLayers(layers)
            const result = await window.package?.saveFileDialog({
                defaultName: exportBaseName("png"),
                filters: [{ name: "PNG Image", extensions: ["png"] }],
                base64: dataUrl.split(",")[1],
            })
            if (result?.success) {
                console.log(
                    `Exported signage design as PNG to ${result.filePath}`,
                )
            }
        } catch (err) {
            console.error("Failed to export signage design as PNG:", err)
        }
    }

    const exportBpsign = async () => {
        if (!layers.length) return
        try {
            const result = await window.package?.saveFileDialog({
                defaultName: exportBaseName("bpsign"),
                filters: [{ name: "BeePEE Signage", extensions: ["bpsign"] }],
                text: JSON.stringify(serializeDesign(layers), null, 2),
            })
            if (result?.success) {
                console.log(
                    `Exported signage design as .bpsign to ${result.filePath}`,
                )
            }
        } catch (err) {
            console.error("Failed to export signage design as .bpsign:", err)
        }
    }

    // Load a .bpsign from disk, replacing the canvas (undoable)
    const loadBpsign = async () => {
        try {
            const result = await window.package?.loadBpsignDialog?.()
            if (!result || !result.success) return
            const loaded = rehydrateDesign(result.design)
            pushHistory()
            setLayers(loaded)
            setSelIds([])
            console.log(`Loaded .bpsign design with ${loaded.length} layers`)
        } catch (err) {
            console.error("Failed to load .bpsign design:", err)
        }
    }

    // Bounding box of the multi-selection (canvas units) - carries the
    // group transform handles
    const groupBox =
        selIds.length > 1
            ? (() => {
                  const sel = layers.filter((l) => selSet.has(l.id))
                  if (!sel.length) return null
                  const x0 = Math.min(...sel.map((l) => l.x))
                  const y0 = Math.min(...sel.map((l) => l.y))
                  const x1 = Math.max(...sel.map((l) => l.x + l.w))
                  const y1 = Math.max(...sel.map((l) => l.y + l.h))
                  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
              })()
            : null

    const selSnapshot = () =>
        layers
            .filter((l) => selSet.has(l.id))
            .map((l) => ({
                id: l.id,
                x: l.x,
                y: l.y,
                w: l.w,
                h: l.h,
                rot: l.rot || 0,
            }))

    // Expand a set of layer ids so every member of any touched group is
    // included - clicking one grouped layer selects the whole group.
    const expandWithGroups = (ids, ls = layersRef.current) => {
        const groups = new Set()
        for (const l of ls) {
            if (l.group && ids.includes(l.id)) groups.add(l.group)
        }
        if (!groups.size) return ids
        const out = new Set(ids)
        for (const l of ls) {
            if (l.group && groups.has(l.group)) out.add(l.id)
        }
        return [...out]
    }

    // Duplicated/pasted grouped layers become their own group, not extra
    // members of the original one
    const remapGroups = (arr) => {
        const map = new Map()
        return arr.map((l) => {
            if (!l.group) return l
            if (!map.has(l.group)) map.set(l.group, nextGroupId())
            return { ...l, group: map.get(l.group) }
        })
    }

    // Patch one layer by id (layers panel: visibility, rename, ...)
    const setLayerProps = (id, patch, coalesceTag) => {
        pushHistory(coalesceTag)
        setLayers((ls) =>
            ls.map((l) => (l.id === id ? { ...l, ...patch } : l)),
        )
    }

    const groupSel = () => {
        if (selIds.length < 2) return
        pushHistory()
        const gid = nextGroupId()
        setLayers((ls) =>
            ls.map((l) => (selSet.has(l.id) ? { ...l, group: gid } : l)),
        )
    }

    const ungroupSel = () => {
        if (!selIds.length) return
        pushHistory()
        setLayers((ls) =>
            ls.map((l) => (selSet.has(l.id) ? { ...l, group: null } : l)),
        )
    }

    // Mirror the selection across its bounding box; a single layer flips in
    // place. Layers render rotate-then-flip, so a global mirror maps
    // rotate(θ)∘flip to rotate(−θ)∘flip' - negate the rotation and toggle
    // the flip flag, then mirror the position across the box center.
    const flipSel = (axis) => {
        if (!selIds.length) return
        pushHistory()
        const sel = layers.filter((l) => selSet.has(l.id))
        const x0 = Math.min(...sel.map((l) => l.x))
        const x1 = Math.max(...sel.map((l) => l.x + l.w))
        const y0 = Math.min(...sel.map((l) => l.y))
        const y1 = Math.max(...sel.map((l) => l.y + l.h))
        setLayers((ls) =>
            ls.map((l) => {
                if (!selSet.has(l.id)) return l
                const rot = (360 - (l.rot || 0)) % 360
                return axis === "h"
                    ? { ...l, x: x0 + x1 - (l.x + l.w), flipH: !l.flipH, rot }
                    : { ...l, y: y0 + y1 - (l.y + l.h), flipV: !l.flipV, rot }
            }),
        )
    }

    // Right-click on a layer (canvas or panel row): ensure it's selected,
    // then open the context menu at the cursor. Selection-wide actions
    // (front/back, flip, duplicate, delete) apply to the whole selection.
    const openLayerMenu = (e, l) => {
        e.preventDefault()
        e.stopPropagation()
        if (!selSet.has(l.id)) setSelIds(expandWithGroups([l.id], layers))
        setCtxMenu({
            mouseX: e.clientX + 2,
            mouseY: e.clientY - 6,
            layerId: l.id,
        })
    }

    const startGroupResize = (e, handle) => {
        e.stopPropagation()
        e.preventDefault()
        pushHistory()
        op.current = {
            type: "gresize",
            handle,
            box0: groupBox,
            layers0: selSnapshot(),
            ax: handle.indexOf("l") >= 0 ? groupBox.x + groupBox.w : groupBox.x,
            ay: handle.indexOf("t") >= 0 ? groupBox.y + groupBox.h : groupBox.y,
        }
    }

    const startGroupRotate = (e) => {
        e.stopPropagation()
        e.preventDefault()
        pushHistory()
        const cx = groupBox.x + groupBox.w / 2
        const cy = groupBox.y + groupBox.h / 2
        const p = toCanvas(e)
        op.current = {
            type: "grotate",
            cx,
            cy,
            startAng: (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI,
            layers0: selSnapshot(),
        }
    }

    const startMove = (e, l) => {
        e.stopPropagation()
        // Without this, dragging starts a native text selection and the
        // browser paints a blue highlight over layers (especially text)
        e.preventDefault()
        // Ctrl toggles membership, Shift adds, plain click selects (keeps
        // an existing multi-selection when grabbing a selected layer)
        let ids
        if (e.ctrlKey || e.metaKey) {
            ids = selSet.has(l.id)
                ? selIds.filter((id) => id !== l.id)
                : [...selIds, l.id]
            setSelIds(ids)
            if (!ids.includes(l.id)) return // toggled off - no drag
        } else if (e.shiftKey) {
            ids = selSet.has(l.id)
                ? selIds
                : expandWithGroups([...selIds, l.id], layers)
            setSelIds(ids)
        } else {
            ids = selSet.has(l.id) ? selIds : expandWithGroups([l.id], layers)
            setSelIds(ids)
        }
        pushHistory()
        const p = toCanvas(e)
        op.current = {
            type: "move",
            targets: layers
                .filter((x) => ids.includes(x.id))
                .map((x) => ({ id: x.id, dx: p.x - x.x, dy: p.y - x.y })),
            anchorId: l.id,
        }
    }
    const startResize = (e, l, handle) => {
        e.stopPropagation()
        e.preventDefault()
        setSelIds([l.id])
        pushHistory()
        // Resize a (possibly rotated) box by pinning the opposite corner/edge
        // in canvas space. sx/sy pick which side is the anchor; the anchor's
        // world position is captured once so the math is stable across frames.
        const rot = ((l.rot || 0) * Math.PI) / 180
        const cos = Math.cos(rot)
        const sin = Math.sin(rot)
        const sx = handle.indexOf("l") >= 0 ? 1 : handle.indexOf("r") >= 0 ? -1 : 0
        const sy = handle.indexOf("t") >= 0 ? 1 : handle.indexOf("b") >= 0 ? -1 : 0
        const cx = l.x + l.w / 2
        const cy = l.y + l.h / 2
        const ox = (sx * l.w) / 2
        const oy = (sy * l.h) / 2
        op.current = {
            type: "resize",
            id: l.id,
            handle,
            sx,
            sy,
            cos,
            sin,
            w0: l.w,
            h0: l.h,
            // Anchor point (opposite side), fixed in canvas coordinates
            ax: cx + ox * cos - oy * sin,
            ay: cy + ox * sin + oy * cos,
        }
    }
    const startRotate = (e, l) => {
        e.stopPropagation()
        e.preventDefault()
        setSelIds([l.id])
        pushHistory()
        op.current = { type: "rotate", id: l.id }
    }

    useEffect(() => {
        const move = (e) => {
            const o = op.current
            if (!o) return
            if (e.buttons === 0) {
                // The mouse was released outside the window (mouseup never
                // fired) - abort the gesture instead of leaving it armed,
                // otherwise the next unrelated click finalizes a giant
                // stale marquee and multi-selects everything under it
                op.current = null
                setMarquee(null)
                lastPush.current = { tag: null, time: 0 }
                return
            }
            const p = toCanvas(e)
            if (o.type === "marquee") {
                setMarquee({ x0: o.x0, y0: o.y0, x1: p.x, y1: p.y })
                return
            }
            if (o.type === "gresize") {
                const hd = o.handle
                const horiz = hd.indexOf("l") >= 0 || hd.indexOf("r") >= 0
                const vert = hd.indexOf("t") >= 0 || hd.indexOf("b") >= 0
                let nw = o.box0.w
                let nh = o.box0.h
                if (horiz) {
                    let w = Math.max(Math.abs(p.x - o.ax), 24)
                    if (snap && cell)
                        w = Math.max(Math.round(w / cell) * cell, cell)
                    nw = w
                }
                if (vert) {
                    let hh = Math.max(Math.abs(p.y - o.ay), 24)
                    if (snap && cell)
                        hh = Math.max(Math.round(hh / cell) * cell, cell)
                    nh = hh
                }
                if (e.shiftKey) {
                    const size =
                        horiz && vert ? Math.max(nw, nh) : horiz ? nw : nh
                    nw = size
                    nh = size
                }
                const nx =
                    hd.indexOf("l") >= 0
                        ? o.ax - nw
                        : hd.indexOf("r") >= 0
                          ? o.ax
                          : o.box0.x + (o.box0.w - nw) / 2
                const ny =
                    hd.indexOf("t") >= 0
                        ? o.ay - nh
                        : hd.indexOf("b") >= 0
                          ? o.ay
                          : o.box0.y + (o.box0.h - nh) / 2
                const sx = nw / o.box0.w
                const sy = nh / o.box0.h
                const map = new Map(o.layers0.map((t) => [t.id, t]))
                setLayers((ls) =>
                    ls.map((l) => {
                        const t = map.get(l.id)
                        if (!t) return l
                        return {
                            ...l,
                            x: nx + (t.x - o.box0.x) * sx,
                            y: ny + (t.y - o.box0.y) * sy,
                            w: t.w * sx,
                            h: t.h * sy,
                        }
                    }),
                )
                return
            }
            if (o.type === "grotate") {
                let delta =
                    (Math.atan2(p.y - o.cy, p.x - o.cx) * 180) / Math.PI -
                    o.startAng
                if (snap) delta = Math.round(delta / 15) * 15
                const rad = (delta * Math.PI) / 180
                const cos = Math.cos(rad)
                const sin = Math.sin(rad)
                const map = new Map(o.layers0.map((t) => [t.id, t]))
                setLayers((ls) =>
                    ls.map((l) => {
                        const t = map.get(l.id)
                        if (!t) return l
                        const cx0 = t.x + t.w / 2
                        const cy0 = t.y + t.h / 2
                        const dx = cx0 - o.cx
                        const dy = cy0 - o.cy
                        const ncx = o.cx + dx * cos - dy * sin
                        const ncy = o.cy + dx * sin + dy * cos
                        return {
                            ...l,
                            x: ncx - t.w / 2,
                            y: ncy - t.h / 2,
                            rot:
                                ((Math.round(t.rot + delta) % 360) + 360) % 360,
                        }
                    }),
                )
                return
            }
            if (o.type === "move") {
                // Move the whole selection; the grabbed layer snaps and the
                // rest follow by the same offset so spacing is preserved
                setLayers((ls) => {
                    const anchor = o.targets.find((t) => t.id === o.anchorId)
                    let adjX = 0
                    let adjY = 0
                    if (snap && cell && anchor) {
                        const base = ls.find((x) => x.id === anchor.id)
                        if (base) {
                            const raw = {
                                ...base,
                                x: p.x - anchor.dx,
                                y: p.y - anchor.dy,
                            }
                            const snapped = snapLayer(raw, true)
                            adjX = snapped.x - raw.x
                            adjY = snapped.y - raw.y
                        }
                    }
                    const map = new Map(o.targets.map((t) => [t.id, t]))
                    return ls.map((l) => {
                        const t = map.get(l.id)
                        return t
                            ? { ...l, x: p.x - t.dx + adjX, y: p.y - t.dy + adjY }
                            : l
                    })
                })
                return
            }
            setLayers((ls) =>
                ls.map((l) => {
                    if (l.id !== o.id) return l
                    if (o.type === "rotate") {
                        const cx = l.x + l.w / 2
                        const cy = l.y + l.h / 2
                        let ang =
                            (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90
                        if (snap) ang = Math.round(ang / 15) * 15
                        return { ...l, rot: ((Math.round(ang) % 360) + 360) % 360 }
                    }
                    if (o.type === "resize") {
                        const { sx, sy, cos, sin } = o
                        // Pointer relative to the fixed anchor, rotated back
                        // into the box's local (unrotated) frame - R(-θ).
                        const rx = p.x - o.ax
                        const ry = p.y - o.ay
                        const lx = rx * cos + ry * sin
                        const ly = -rx * sin + ry * cos
                        let nw = sx !== 0 ? clamp(Math.abs(lx), 24, MAX_LAYER) : o.w0
                        let nh = sy !== 0 ? clamp(Math.abs(ly), 24, MAX_LAYER) : o.h0
                        if (snap && cell) {
                            if (sx !== 0)
                                nw = clamp(Math.round(nw / cell) * cell, cell, MAX_LAYER)
                            if (sy !== 0)
                                nh = clamp(Math.round(nh / cell) * cell, cell, MAX_LAYER)
                        }
                        // Shift locks the layer to a square
                        if (e.shiftKey) {
                            const size =
                                sx !== 0 && sy !== 0
                                    ? Math.max(nw, nh)
                                    : sx !== 0
                                      ? nw
                                      : nh
                            nw = size
                            nh = size
                        }
                        // Recover the center so the anchor stays pinned:
                        // C = A − R(θ)·(sx·nw/2, sy·nh/2)
                        const ox = (sx * nw) / 2
                        const oy = (sy * nh) / 2
                        const cx = o.ax - (ox * cos - oy * sin)
                        const cy = o.ay - (ox * sin + oy * cos)
                        return {
                            ...l,
                            x: cx - nw / 2,
                            y: cy - nh / 2,
                            w: nw,
                            h: nh,
                        }
                    }
                    return l
                }),
            )
        }
        const up = (e) => {
            const o = op.current
            if (o?.type === "marquee") {
                // Select every layer whose bounds intersect the marquee
                const p = toCanvas(e)
                const rx0 = Math.min(o.x0, p.x)
                const ry0 = Math.min(o.y0, p.y)
                const rx1 = Math.max(o.x0, p.x)
                const ry1 = Math.max(o.y0, p.y)
                const dragged =
                    Math.abs(p.x - o.x0) > 4 || Math.abs(p.y - o.y0) > 4
                const hits = dragged
                    ? layersRef.current
                          .filter(
                              (l) =>
                                  !l.hidden &&
                                  l.x < rx1 &&
                                  l.x + l.w > rx0 &&
                                  l.y < ry1 &&
                                  l.y + l.h > ry0,
                          )
                          .map((l) => l.id)
                    : []
                setSelIds(expandWithGroups([...new Set([...o.base, ...hits])]))
                setMarquee(null)
            }
            op.current = null
            // A finished gesture ends any history coalescing window
            lastPush.current = { tag: null, time: 0 }
        }
        const abort = () => {
            op.current = null
            setMarquee(null)
            lastPush.current = { tag: null, time: 0 }
        }
        window.addEventListener("mousemove", move)
        window.addEventListener("mouseup", up)
        window.addEventListener("blur", abort)
        return () => {
            window.removeEventListener("mousemove", move)
            window.removeEventListener("mouseup", up)
            window.removeEventListener("blur", abort)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [snap, snapLayer, cell])

    useEffect(() => {
        const onKey = (e) => {
            const tag = (e.target.tagName || "").toLowerCase()
            if (tag === "input" || tag === "textarea") return
            const ctrl = e.ctrlKey || e.metaKey
            const key = e.key.toLowerCase()

            // History and selection shortcuts work without a selection
            if (ctrl && key === "z" && !e.shiftKey) {
                e.preventDefault()
                undo()
                return
            }
            if (ctrl && (key === "y" || (key === "z" && e.shiftKey))) {
                e.preventDefault()
                redo()
                return
            }
            if (ctrl && key === "a") {
                e.preventDefault()
                selectAll()
                return
            }
            if (ctrl && (key === "=" || key === "+")) {
                e.preventDefault()
                zoomBy(1.2)
                return
            }
            if (ctrl && key === "-") {
                e.preventDefault()
                zoomBy(1 / 1.2)
                return
            }
            if (ctrl && key === "0") {
                e.preventDefault()
                zoomReset()
                return
            }
            if (e.key === "Escape") {
                setSelIds([])
                return
            }
            if (ctrl && key === "v") {
                e.preventDefault()
                pasteClipboard()
                return
            }
            if (ctrl && key === "t") {
                e.preventDefault()
                addTextLayer()
                return
            }

            if (!selIds.length) return
            if (ctrl && key === "c") {
                e.preventDefault()
                copySel()
            } else if (ctrl && key === "x") {
                e.preventDefault()
                cutSel()
            } else if (ctrl && key === "d") {
                e.preventDefault()
                dupSel()
            } else if (ctrl && key === "g") {
                e.preventDefault()
                if (e.shiftKey) ungroupSel()
                else groupSel()
            } else if (e.key === "Delete" || e.key === "Backspace") {
                e.preventDefault()
                removeSel()
            } else if (e.key.startsWith("Arrow")) {
                e.preventDefault()
                const d = snap && cell ? cell : e.shiftKey ? 10 : 2
                const dd = {
                    ArrowUp: [0, -d],
                    ArrowDown: [0, d],
                    ArrowLeft: [-d, 0],
                    ArrowRight: [d, 0],
                }[e.key]
                pushHistory("nudge")
                setLayers((ls) =>
                    ls.map((l) =>
                        selSet.has(l.id)
                            ? { ...l, x: l.x + dd[0], y: l.y + dd[1] }
                            : l,
                    ),
                )
            }
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selIds, snap, cell, layers])

    const removeSel = () => {
        if (!selIds.length) return
        pushHistory()
        setLayers((ls) => ls.filter((l) => !selSet.has(l.id)))
        setSelIds([])
    }
    const dupSel = () => {
        if (!selIds.length) return
        pushHistory()
        const off = cell || 20
        const dupes = remapGroups(
            layers
                .filter((l) => selSet.has(l.id))
                .map((l) => ({
                    ...snapLayer({ ...l, x: l.x + off, y: l.y + off }, snap),
                    id: nextId(),
                })),
        )
        setLayers((ls) => [...ls, ...dupes])
        setSelIds(dupes.map((l) => l.id))
    }
    const copySel = () => {
        if (!selIds.length) return
        clipboard.current = layers
            .filter((l) => selSet.has(l.id))
            .map((l) => ({ ...l }))
    }
    const cutSel = () => {
        if (!selIds.length) return
        copySel()
        removeSel()
    }
    const pasteClipboard = () => {
        const src = clipboard.current
        if (!src || !src.length) return
        pushHistory()
        const off = cell || 20
        const pasted = remapGroups(
            src.map((c) => ({
                ...snapLayer({ ...c, x: c.x + off, y: c.y + off }, snap),
                id: nextId(),
            })),
        )
        setLayers((ls) => [...ls, ...pasted])
        setSelIds(pasted.map((l) => l.id))
    }
    const selectAll = () => setSelIds(layers.map((l) => l.id))
    // Move srcId next to dstId in the stack. The panel lists topmost first
    // (reversed array), so dropping ABOVE a row means AFTER it in the array.
    const reorderLayer = (srcId, dstId, before) => {
        if (!srcId || srcId === dstId) return
        pushHistory()
        setLayers((ls) => {
            const src = ls.find((l) => l.id === srcId)
            if (!src) return ls
            const without = ls.filter((l) => l.id !== srcId)
            let idx = without.findIndex((l) => l.id === dstId)
            if (idx < 0) return ls
            if (before) idx += 1
            without.splice(idx, 0, src)
            return without
        })
    }
    const raise = (dir) => {
        if (!selIds.length) return
        pushHistory()
        setLayers((ls) => {
            const picked = ls.filter((l) => selSet.has(l.id))
            const rest = ls.filter((l) => !selSet.has(l.id))
            return dir > 0 ? [...rest, ...picked] : [...picked, ...rest]
        })
    }
    const align = (kind) =>
        updateSel((l) => {
            const map = {
                left: { x: 0 },
                ch: { x: (CANVAS_SIZE - l.w) / 2 },
                right: { x: CANVAS_SIZE - l.w },
                top: { y: 0 },
                mv: { y: (CANVAS_SIZE - l.h) / 2 },
                bottom: { y: CANVAS_SIZE - l.h },
            }
            return snapLayer({ ...l, ...map[kind] }, snap)
        })

    const canSave = layers.length > 0 && !isSaving
    const disp = DISPLAY * zoom // zoomed on-screen canvas size
    const s = disp / CANVAS_SIZE

    // Background (outside-canvas) interactions, shared by the canvas column
    // and the zoom viewport: drag starts a marquee (a plain click, movement
    // ≤ 4px, just deselects) and a dropped glyph lands dead center. Guarded
    // so only the element's own backdrop reacts, not its children.
    const bgProps = {
        onMouseDown: (e) => {
            if (e.target !== e.currentTarget || e.button !== 0) return
            setSnapMenu(false)
            const additive = e.shiftKey || e.ctrlKey || e.metaKey
            if (!additive) setSelIds([])
            const p = toCanvas(e)
            op.current = {
                type: "marquee",
                x0: p.x,
                y0: p.y,
                base: additive ? selIds : [],
            }
        },
        // Accept drags ANYWHERE over the area (no target guard): a fast flick
        // fires few dragover events, and if the last one landed on a
        // non-accepting child (toolbar, caption) the browser cancels the whole
        // drop. Placement is decided at drop time instead: on the canvas → at
        // the pointer, anywhere else → centered.
        onDragOver: (e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = "copy"
            setDropHint(true)
        },
        onDragLeave: (e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setDropHint(false)
        },
        onDrop: (e) => {
            e.preventDefault()
            // Column and viewport are nested; only the innermost handles it
            e.stopPropagation()
            setDropHint(false)
            const glyph = e.dataTransfer.getData("glyph")
            if (!glyph) return
            const p = toCanvas(e)
            const inCanvas =
                p.x >= 0 &&
                p.x <= CANVAS_SIZE &&
                p.y >= 0 &&
                p.y <= CANVAS_SIZE
            addLayer(
                glyph,
                inCanvas ? p.x : CANVAS_SIZE / 2,
                inCanvas ? p.y : CANVAS_SIZE / 2,
            )
        },
    }
    const gridIdx = snap ? Math.max(0, GRID_STEPS.indexOf(gridN)) : 0

    // Native window menu (File / Edit) dispatches actions here via IPC.
    // A ref keeps the mapping fresh without re-registering the listener.
    const menuActions = useRef({})
    menuActions.current = {
        load: loadBpsign,
        exportPng,
        exportBpsign,
        save: () => canSave && onSave({ layers }),
        close: requestClose,
        zoomIn: () => zoomBy(1.2),
        zoomOut: () => zoomBy(1 / 1.2),
        zoomReset,
        undo,
        redo,
        cut: cutSel,
        copy: copySel,
        paste: pasteClipboard,
        duplicate: dupSel,
        delete: removeSel,
        selectAll,
        group: groupSel,
        ungroup: ungroupSel,
        flipH: () => flipSel("h"),
        flipV: () => flipSel("v"),
        addText: addTextLayer,
    }
    useEffect(() => {
        window.package?.onSignageDesignerMenu?.((action) => {
            menuActions.current[action]?.()
        })
        return () => window.package?.onSignageDesignerMenu?.(null)
    }, [])

    const hasSel = selIds.length > 0
    const alignBtn = (kind, title) => (
        <Tooltip key={kind} title={title}>
            {/* span wrapper so the tooltip works while the button is disabled */}
            <Box component="span" sx={{ display: "flex" }}>
                <Box
                    component="button"
                    disabled={!hasSel}
                    onClick={() => hasSel && align(kind)}
                    sx={{
                        width: 32,
                        height: 28,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "transparent",
                        border: "none",
                        borderRight: 1,
                        borderColor: "divider",
                        cursor: hasSel ? "pointer" : "not-allowed",
                        opacity: hasSel ? 1 : 0.35,
                        p: 0,
                    }}>
                    <AlignIcon
                        type={kind}
                        gold={gold}
                        bar={theme.palette.text.primary}
                    />
                </Box>
            </Box>
        </Tooltip>
    )

    const flipBtn = (axis, title) => (
        <Tooltip key={axis} title={title}>
            {/* span wrapper so the tooltip works while the button is disabled */}
            <Box component="span" sx={{ display: "flex" }}>
                <Box
                    component="button"
                    disabled={!hasSel}
                    onClick={() => hasSel && flipSel(axis)}
                    sx={{
                        width: 32,
                        height: 28,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "transparent",
                        border: "none",
                        borderRight: 1,
                        borderColor: "divider",
                        cursor: hasSel ? "pointer" : "not-allowed",
                        opacity: hasSel ? 1 : 0.35,
                        p: 0,
                        color: "text.primary",
                    }}>
                    <Flip
                        sx={{
                            fontSize: 17,
                            transform:
                                axis === "v" ? "rotate(90deg)" : "none",
                        }}
                    />
                </Box>
            </Box>
        </Tooltip>
    )

    const paletteCell = (id) => (
        <Box
            key={id}
            draggable
            title={SHAPES[id].label}
            onDragStart={(e) => {
                e.dataTransfer.setData("glyph", id)
                e.dataTransfer.effectAllowed = "copy"
            }}
            onDoubleClick={() => addLayer(id, CANVAS_SIZE / 2, CANVAS_SIZE / 2)}
            sx={{
                aspectRatio: "1",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                bgcolor: "background.paper",
                border: 1,
                borderColor: "divider",
                borderRadius: 1,
                cursor: "grab",
            }}>
            <ShapeSvg id={id} color={theme.palette.text.primary} w={24} />
        </Box>
    )

    return (
        <Box
            sx={{
                height: "100vh",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
            }}>
            {/* Main Content Area */}
            <Box sx={{ flex: 1, display: "flex", minHeight: 0 }}>
                {/* Palette - vertical scroll with collapsible sections */}
                {paletteOpen ? (
                    <Box
                        sx={{
                            width: paletteW,
                            flexShrink: 0,
                            borderRight: 1,
                            borderColor: "divider",
                            bgcolor: "background.paper",
                            display: "flex",
                            flexDirection: "column",
                            minHeight: 0,
                        }}>
                        <Box
                            sx={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                pl: 1.5,
                                pr: 0.5,
                                py: 0.75,
                                borderBottom: 1,
                                borderColor: "divider",
                            }}>
                            <Typography variant="subtitle2" fontWeight={600}>
                                Palette
                            </Typography>
                            <Tooltip title="Collapse palette">
                                <IconButton size="small" onClick={() => setPaletteOpen(false)}>
                                    <ChevronLeft fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        </Box>
                        <Box sx={{ flex: 1, overflowY: "auto" }}>
                            {[
                                ...(recentGlyphs.some((g) => SHAPES[g])
                                    ? [
                                          {
                                              id: "recent",
                                              label: "Recent",
                                              icon: "star",
                                              ids: recentGlyphs.filter(
                                                  (g) => SHAPES[g],
                                              ),
                                          },
                                      ]
                                    : []),
                                ...SIGN_SECTIONS,
                                ...PALETTE_SECTIONS,
                                {
                                    id: "custom",
                                    label: "Custom",
                                    icon: "plus",
                                    ids: customIds,
                                },
                            ].map((section, i) => {
                                const open = openSections[section.id]
                                return (
                                    <Box key={section.id}>
                                        {i > 0 && <Divider />}
                                        <Box
                                            component="button"
                                            onClick={() =>
                                                setOpenSections((prev) => ({
                                                    ...prev,
                                                    [section.id]: !prev[section.id],
                                                }))
                                            }
                                            sx={{
                                                width: "100%",
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 0.75,
                                                px: 1.5,
                                                py: 1,
                                                background: "transparent",
                                                border: "none",
                                                cursor: "pointer",
                                                color: "text.secondary",
                                                fontFamily: "inherit",
                                                "&:hover": { bgcolor: "action.hover" },
                                            }}>
                                            <Box
                                                sx={{
                                                    width: 24,
                                                    height: 24,
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    flexShrink: 0,
                                                }}>
                                                <ShapeSvg
                                                    id={section.icon}
                                                    color={
                                                        open
                                                            ? gold
                                                            : "currentColor"
                                                    }
                                                    w={section.iconSize || 13}
                                                />
                                            </Box>
                                            <Typography
                                                variant="subtitle2"
                                                fontWeight={600}
                                                sx={{ flex: 1, textAlign: "left" }}>
                                                {section.label}
                                            </Typography>
                                            {section.id === "custom" && (
                                                <Tooltip title="Import an SVG file as a glyph">
                                                    {/* span, not button - the header itself is a <button> */}
                                                    <Box
                                                        component="span"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            svgInputRef.current?.click()
                                                        }}
                                                        sx={{
                                                            width: 22,
                                                            height: 22,
                                                            display: "flex",
                                                            alignItems: "center",
                                                            justifyContent: "center",
                                                            borderRadius: 0.75,
                                                            border: 1,
                                                            borderColor: "divider",
                                                            flexShrink: 0,
                                                            "&:hover": {
                                                                borderColor: "primary.main",
                                                                color: "primary.main",
                                                            },
                                                        }}>
                                                        <ShapeSvg
                                                            id="plus"
                                                            color="currentColor"
                                                            w={11}
                                                        />
                                                    </Box>
                                                </Tooltip>
                                            )}
                                            <ExpandMore
                                                sx={{
                                                    fontSize: 18,
                                                    transition: "transform .15s",
                                                    transform: open
                                                        ? "none"
                                                        : "rotate(-90deg)",
                                                }}
                                            />
                                        </Box>
                                        {open && (
                                            <Box
                                                sx={{
                                                    display: "grid",
                                                    gridTemplateColumns: "1fr 1fr",
                                                    gap: 1,
                                                    px: 1.5,
                                                    pb: 1.5,
                                                }}>
                                                {section.ids.map(paletteCell)}
                                            </Box>
                                        )}
                                    </Box>
                                )
                            })}
                            <Divider />
                            <Typography
                                variant="caption"
                                color="text.disabled"
                                sx={{ display: "block", p: 1.5, lineHeight: 1.5 }}>
                                Drag onto canvas, or double-click to drop in center.
                            </Typography>
                        </Box>
                    </Box>
                ) : (
                    <Box
                        sx={{
                            width: 40,
                            borderRight: 1,
                            borderColor: "divider",
                            bgcolor: "background.paper",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            py: 1.25,
                        }}>
                        <Tooltip title="Expand palette">
                            <IconButton size="small" onClick={() => setPaletteOpen(true)}>
                                <ChevronRight fontSize="small" />
                            </IconButton>
                        </Tooltip>
                        <Typography
                            variant="caption"
                            color="text.disabled"
                            sx={{
                                writingMode: "vertical-rl",
                                mt: 1.5,
                                fontWeight: 700,
                                letterSpacing: 1.5,
                                textTransform: "uppercase",
                                fontSize: 10.5,
                            }}>
                            Palette
                        </Typography>
                    </Box>
                )}

                {/* Palette stretch grip */}
                {paletteOpen && (
                    <Box
                        onMouseDown={(e) => {
                            e.preventDefault()
                            sideDrag.current = {
                                side: "left",
                                startX: e.clientX,
                                startW: paletteW,
                            }
                        }}
                        sx={{
                            width: "5px",
                            ml: "-3px",
                            flexShrink: 0,
                            cursor: "col-resize",
                            zIndex: 2,
                            "&:hover": { bgcolor: "primary.main", opacity: 0.4 },
                        }}
                    />
                )}

                {/* Canvas column - bgProps: drag-marquee / click-deselect /
                    drop-to-center on its backdrop */}
                <Box
                    {...bgProps}
                    sx={{
                        position: "relative",
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        p: 2,
                        bgcolor: "background.default",
                        minWidth: 0,
                        // Marquee/layer drags must never start a native text
                        // selection (blue highlight over layers and captions)
                        userSelect: "none",
                    }}>
                    {/* Toolbar */}
                    <Box
                        sx={{
                            alignSelf: "stretch",
                            display: "flex",
                            alignItems: "center",
                            gap: 1.25,
                            mb: 2,
                        }}>
                        <Box
                            sx={{
                                fontSize: 11.5,
                                fontWeight: 700,
                                letterSpacing: 0.4,
                                px: 1,
                                py: 0.6,
                                border: 1,
                                borderColor: "divider",
                                borderRadius: 1,
                                bgcolor: "background.paper",
                                whiteSpace: "nowrap",
                            }}>
                            512 × 512
                        </Box>
                        <Box
                            sx={{
                                display: "flex",
                                alignItems: "center",
                                border: 1,
                                borderColor: "#555",
                                borderRadius: 1,
                                overflow: "hidden",
                            }}>
                            {alignBtn("left", "Align left")}
                            {alignBtn("ch", "Center horizontally")}
                            {alignBtn("right", "Align right")}
                            <Box sx={{ width: "1px", alignSelf: "stretch", bgcolor: "#555" }} />
                            {alignBtn("top", "Align top")}
                            {alignBtn("mv", "Center vertically")}
                            {alignBtn("bottom", "Align bottom")}
                        </Box>
                        <Box
                            sx={{
                                display: "flex",
                                alignItems: "center",
                                border: 1,
                                borderColor: "#555",
                                borderRadius: 1,
                                overflow: "hidden",
                            }}>
                            {flipBtn("h", "Flip horizontally")}
                            {flipBtn("v", "Flip vertically")}
                        </Box>
                        <Tooltip title="Add text">
                            <Box
                                component="button"
                                onClick={addTextLayer}
                                sx={{
                                    width: 32,
                                    height: 30,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    background: "transparent",
                                    border: 1,
                                    borderColor: "#555",
                                    borderRadius: 1,
                                    cursor: "pointer",
                                    color: "text.primary",
                                    p: 0,
                                    "&:hover": { bgcolor: "action.hover" },
                                }}>
                                <TitleIcon sx={{ fontSize: 18 }} />
                            </Box>
                        </Tooltip>
                        <Box sx={{ flex: 1 }} />
                        {/* Zoom controls - Ctrl+scroll on the canvas also zooms */}
                        <Box
                            sx={{
                                display: "flex",
                                alignItems: "center",
                                border: 1,
                                borderColor: "#555",
                                borderRadius: 1,
                                overflow: "hidden",
                            }}>
                            <Tooltip title="Zoom out (Ctrl+-)">
                                <Box
                                    component="button"
                                    onClick={() => zoomBy(1 / 1.2)}
                                    sx={{
                                        border: "none",
                                        background: "transparent",
                                        color: "text.secondary",
                                        cursor: "pointer",
                                        px: 1,
                                        py: 0.5,
                                        fontSize: 14,
                                        fontFamily: "inherit",
                                        "&:hover": { bgcolor: "action.hover" },
                                    }}>
                                    −
                                </Box>
                            </Tooltip>
                            <Tooltip title="Reset zoom (Ctrl+0)">
                                <Box
                                    component="button"
                                    onClick={zoomReset}
                                    sx={{
                                        border: "none",
                                        borderLeft: 1,
                                        borderRight: 1,
                                        borderColor: "#555",
                                        background: "transparent",
                                        color: zoom !== 1 ? gold : "text.secondary",
                                        cursor: "pointer",
                                        px: 1,
                                        py: 0.5,
                                        fontSize: 11.5,
                                        fontWeight: 700,
                                        minWidth: 46,
                                        fontFamily: "inherit",
                                        "&:hover": { bgcolor: "action.hover" },
                                    }}>
                                    {Math.round(zoom * 100)}%
                                </Box>
                            </Tooltip>
                            <Tooltip title="Zoom in (Ctrl+=)">
                                <Box
                                    component="button"
                                    onClick={() => zoomBy(1.2)}
                                    sx={{
                                        border: "none",
                                        background: "transparent",
                                        color: "text.secondary",
                                        cursor: "pointer",
                                        px: 1,
                                        py: 0.5,
                                        fontSize: 14,
                                        fontFamily: "inherit",
                                        "&:hover": { bgcolor: "action.hover" },
                                    }}>
                                    +
                                </Box>
                            </Tooltip>
                        </Box>
                        {/* Snap split-button - main toggles, arrow opens density */}
                        <Box sx={{ position: "relative", display: "flex" }}>
                            <Button
                                size="small"
                                variant={snap ? "contained" : "outlined"}
                                onClick={() => setSnap((v) => !v)}
                                sx={{
                                    whiteSpace: "nowrap",
                                    px: 1.5,
                                    borderTopRightRadius: 0,
                                    borderBottomRightRadius: 0,
                                }}>
                                Snap {snap ? `· ${gridN}×${gridN}` : "· off"}
                            </Button>
                            <Button
                                size="small"
                                variant={snap ? "contained" : "outlined"}
                                onClick={() => setSnapMenu((v) => !v)}
                                title="Grid density"
                                sx={{
                                    minWidth: 26,
                                    px: 0.5,
                                    borderTopLeftRadius: 0,
                                    borderBottomLeftRadius: 0,
                                    borderLeft: snap
                                        ? "1px solid rgba(0,0,0,0.25)"
                                        : undefined,
                                    ml: snap ? 0 : "-1px",
                                }}>
                                <Box component="span" sx={{ fontSize: 10 }}>
                                    {snapMenu ? "▴" : "▾"}
                                </Box>
                            </Button>
                            {snapMenu && (
                                <Box
                                    sx={{
                                        position: "absolute",
                                        top: "calc(100% + 6px)",
                                        right: 0,
                                        width: 220,
                                        bgcolor: "background.paper",
                                        border: 1,
                                        borderColor: "#555",
                                        borderRadius: 2,
                                        boxShadow: "0 12px 30px rgba(0,0,0,0.5)",
                                        p: 1.75,
                                        zIndex: 5,
                                    }}>
                                    <Box
                                        sx={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            mb: 1,
                                        }}>
                                        <Typography variant="caption" color="text.secondary">
                                            Grid density
                                        </Typography>
                                        <Typography variant="caption" fontWeight={600}>
                                            {gridIdx === 0 ? "None (off)" : `${gridN} × ${gridN}`}
                                        </Typography>
                                    </Box>
                                    <Slider
                                        size="small"
                                        min={0}
                                        max={GRID_STEPS.length - 1}
                                        step={1}
                                        value={gridIdx}
                                        onChange={(e, v) => {
                                            if (v === 0) setSnap(false)
                                            else {
                                                setSnap(true)
                                                setGridN(GRID_STEPS[v])
                                            }
                                        }}
                                    />
                                    <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                                        <Typography variant="caption" color="text.disabled">
                                            No grid
                                        </Typography>
                                        <Typography variant="caption" color="text.disabled">
                                            Fine
                                        </Typography>
                                    </Box>
                                </Box>
                            )}
                        </Box>
                    </Box>

                    {/* Zoom viewport - scrolls when the zoomed canvas outgrows
                        it; margin:auto centers a smaller canvas. Ctrl+scroll
                        zooms (native listener on scrollWrapRef). */}
                    <Box
                        ref={scrollWrapRef}
                        {...bgProps}
                        sx={{
                            position: "relative",
                            alignSelf: "stretch",
                            flex: 1,
                            minHeight: 0,
                            overflow: "auto",
                            display: "flex",
                        }}>
                    {/* Canvas */}
                    <Box
                        ref={canvasRef}
                        onMouseDown={(e) => {
                            if (e.button !== 0) return
                            setSnapMenu(false)
                            const additive = e.shiftKey || e.ctrlKey || e.metaKey
                            if (!additive) setSelIds([])
                            const p = toCanvas(e)
                            op.current = {
                                type: "marquee",
                                x0: p.x,
                                y0: p.y,
                                base: additive ? selIds : [],
                            }
                        }}
                        onDragOver={(e) => {
                            e.preventDefault()
                            setDropHint(true)
                        }}
                        onDragLeave={() => setDropHint(false)}
                        onDrop={onCanvasDrop}
                        sx={{
                            width: disp,
                            height: disp,
                            position: "relative",
                            borderRadius: 2,
                            background: "#ffffff",
                            backgroundImage: (() => {
                                const grid = `linear-gradient(rgba(0,0,0,0.09) 1px,transparent 1px),linear-gradient(90deg,rgba(0,0,0,0.09) 1px,transparent 1px)`
                                const plate = prefs.signageShowBackplate
                                    ? `url(${SIGN_BG})`
                                    : null
                                const parts = []
                                if (snap) parts.push(grid)
                                if (plate) parts.push(plate)
                                return parts.join(",") || "none"
                            })(),
                            backgroundSize: (() => {
                                const g = `${disp / (gridN || 8)}px ${disp / (gridN || 8)}px`
                                const parts = []
                                if (snap) parts.push(g, g)
                                if (prefs.signageShowBackplate)
                                    parts.push("100% 100%")
                                return parts.join(",") || "auto"
                            })(),
                            border: dropHint ? `2px solid ${gold}` : "2px dashed #555",
                            boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.12)",
                            overflow: "hidden",
                            flexShrink: 0,
                            m: "auto",
                        }}>
                        {layers.length === 0 && !dropHint && (
                            <Box
                                sx={{
                                    position: "absolute",
                                    inset: 0,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    color: "rgba(0,0,0,0.4)",
                                    fontSize: 13,
                                    pointerEvents: "none",
                                    textAlign: "center",
                                    p: 3,
                                }}>
                                Drop glyphs here to compose your signage icon
                            </Box>
                        )}
                        {layers.map((l) => {
                            if (l.hidden) return null
                            const active = selSet.has(l.id)
                            const showHandles = active && selIds.length === 1
                            const handle = (hd, cursor, pos) => (
                                <Box
                                    key={hd}
                                    onMouseDown={(e) => startResize(e, l, hd)}
                                    sx={{
                                        position: "absolute",
                                        width: 10,
                                        height: 10,
                                        bgcolor: "primary.main",
                                        border: "1.5px solid #1d1e1f",
                                        borderRadius: "2px",
                                        cursor,
                                        ...pos,
                                    }}
                                />
                            )
                            return (
                                <Box
                                    key={l.id}
                                    onMouseDown={(e) => startMove(e, l)}
                                    onContextMenu={(e) => openLayerMenu(e, l)}
                                    onDoubleClick={(e) => {
                                        if (!isTextLayer(l)) return
                                        e.stopPropagation()
                                        setEditingTextId(l.id)
                                    }}
                                    sx={{
                                        position: "absolute",
                                        left: l.x * s,
                                        top: l.y * s,
                                        width: l.w * s,
                                        height: l.h * s,
                                        transform: `rotate(${l.rot || 0}deg)`,
                                        cursor: "move",
                                    }}>
                                    {/* Flip only the artwork - the selection
                                        outline and resize handles stay in
                                        data space so drag math is unaffected */}
                                    <svg
                                        width={l.w * s}
                                        height={l.h * s}
                                        viewBox={layerVb(l)}
                                        preserveAspectRatio="none"
                                        overflow="visible"
                                        style={{
                                            display: "block",
                                            width: l.w * s,
                                            height: l.h * s,
                                            opacity:
                                                editingTextId === l.id
                                                    ? 0.15
                                                    : (l.opacity ?? 1),
                                            transform: `scale(${l.flipH ? -1 : 1}, ${l.flipV ? -1 : 1})`,
                                            transformOrigin: "center center",
                                        }}
                                        dangerouslySetInnerHTML={{
                                            __html: hasEraserPart(l)
                                                ? eraserGhostSvg(l, `cv-${l.id}`)
                                                : layerInnerSvg(l, `cv-${l.id}`),
                                        }}
                                    />
                                    {/* In-place text editor - lives inside
                                        the rotated layer box so it tracks
                                        the object; the svg dims behind it */}
                                    {editingTextId === l.id &&
                                        isTextLayer(l) &&
                                        (() => {
                                            const vh =
                                                Number(
                                                    (l.textVb || "0 0 100 40")
                                                        .split(/\s+/)[3],
                                                ) || 100
                                            const fontPx = Math.max(
                                                8,
                                                (100 * (l.h * s)) / vh,
                                            )
                                            return (
                                                <input
                                                    autoFocus
                                                    value={l.text || ""}
                                                    onFocus={(e) =>
                                                        e.target.select()
                                                    }
                                                    onChange={(e) =>
                                                        updateTextById(l.id, {
                                                            text: e.target
                                                                .value,
                                                        })
                                                    }
                                                    onBlur={() =>
                                                        setEditingTextId(null)
                                                    }
                                                    onKeyDown={(e) => {
                                                        e.stopPropagation()
                                                        if (
                                                            e.key ===
                                                                "Enter" ||
                                                            e.key === "Escape"
                                                        ) {
                                                            setEditingTextId(
                                                                null,
                                                            )
                                                        }
                                                    }}
                                                    onMouseDown={(e) =>
                                                        e.stopPropagation()
                                                    }
                                                    onDoubleClick={(e) =>
                                                        e.stopPropagation()
                                                    }
                                                    style={{
                                                        position: "absolute",
                                                        inset: 0,
                                                        width: "100%",
                                                        height: "100%",
                                                        boxSizing:
                                                            "border-box",
                                                        background:
                                                            "transparent",
                                                        border: "none",
                                                        outline: "none",
                                                        textAlign: "center",
                                                        padding: 0,
                                                        fontFamily:
                                                            l.fontFamily ||
                                                            "Arial",
                                                        fontWeight: l.bold
                                                            ? 700
                                                            : 400,
                                                        fontStyle: l.italic
                                                            ? "italic"
                                                            : "normal",
                                                        fontSize: fontPx,
                                                        lineHeight: 1,
                                                        color:
                                                            l.color ===
                                                            "transparent"
                                                                ? "#666666"
                                                                : l.color,
                                                        caretColor: "#d2b019",
                                                    }}
                                                />
                                            )
                                        })()}
                                    {active && (
                                        <Box
                                            sx={{
                                                position: "absolute",
                                                inset: -2,
                                                outline: `1.5px solid ${gold}`,
                                                borderRadius: "3px",
                                                pointerEvents: "none",
                                            }}
                                        />
                                    )}
                                    {showHandles && (
                                        <>
                                            {handle("tl", "nwse-resize", { left: -5, top: -5 })}
                                            {handle("tr", "nesw-resize", { right: -5, top: -5 })}
                                            {handle("bl", "nesw-resize", { left: -5, bottom: -5 })}
                                            {handle("br", "nwse-resize", { right: -5, bottom: -5 })}
                                            {handle("t", "ns-resize", { left: "50%", top: -5, ml: "-5px" })}
                                            {handle("b", "ns-resize", { left: "50%", bottom: -5, ml: "-5px" })}
                                            {handle("l", "ew-resize", { top: "50%", left: -5, mt: "-5px" })}
                                            {handle("r", "ew-resize", { top: "50%", right: -5, mt: "-5px" })}
                                            <Box
                                                sx={{
                                                    position: "absolute",
                                                    left: "50%",
                                                    top: -24,
                                                    width: "1.5px",
                                                    height: 18,
                                                    bgcolor: "primary.main",
                                                    transform: "translateX(-50%)",
                                                    pointerEvents: "none",
                                                }}
                                            />
                                            <Tooltip title="Rotate">
                                                <Box
                                                    onMouseDown={(e) => startRotate(e, l)}
                                                    sx={{
                                                        position: "absolute",
                                                        left: "50%",
                                                        top: -34,
                                                        width: 12,
                                                        height: 12,
                                                        ml: "-6px",
                                                        borderRadius: "50%",
                                                        bgcolor: "primary.main",
                                                        border: "1.5px solid #1d1e1f",
                                                        cursor: "grab",
                                                    }}
                                                />
                                            </Tooltip>
                                        </>
                                    )}
                                </Box>
                            )
                        })}
                        {/* Group transform handles for multi-selection */}
                        {groupBox &&
                            (() => {
                                const gx = groupBox.x * s
                                const gy = groupBox.y * s
                                const gw = groupBox.w * s
                                const gh = groupBox.h * s
                                const ghandle = (hd, cursor, pos) => (
                                    <Box
                                        key={hd}
                                        onMouseDown={(e) =>
                                            startGroupResize(e, hd)
                                        }
                                        sx={{
                                            position: "absolute",
                                            width: 10,
                                            height: 10,
                                            bgcolor: "primary.main",
                                            border: "1.5px solid #1d1e1f",
                                            borderRadius: "2px",
                                            cursor,
                                            zIndex: 4,
                                            ...pos,
                                        }}
                                    />
                                )
                                return (
                                    <>
                                        <Box
                                            sx={{
                                                position: "absolute",
                                                left: gx - 2,
                                                top: gy - 2,
                                                width: gw + 4,
                                                height: gh + 4,
                                                outline: `1.5px dashed ${gold}`,
                                                borderRadius: "3px",
                                                pointerEvents: "none",
                                                zIndex: 4,
                                            }}
                                        />
                                        {ghandle("tl", "nwse-resize", { left: gx - 5, top: gy - 5 })}
                                        {ghandle("tr", "nesw-resize", { left: gx + gw - 5, top: gy - 5 })}
                                        {ghandle("bl", "nesw-resize", { left: gx - 5, top: gy + gh - 5 })}
                                        {ghandle("br", "nwse-resize", { left: gx + gw - 5, top: gy + gh - 5 })}
                                        {ghandle("t", "ns-resize", { left: gx + gw / 2 - 5, top: gy - 5 })}
                                        {ghandle("b", "ns-resize", { left: gx + gw / 2 - 5, top: gy + gh - 5 })}
                                        {ghandle("l", "ew-resize", { left: gx - 5, top: gy + gh / 2 - 5 })}
                                        {ghandle("r", "ew-resize", { left: gx + gw - 5, top: gy + gh / 2 - 5 })}
                                        <Box
                                            sx={{
                                                position: "absolute",
                                                left: gx + gw / 2,
                                                top: gy - 24,
                                                width: "1.5px",
                                                height: 18,
                                                bgcolor: "primary.main",
                                                transform: "translateX(-50%)",
                                                pointerEvents: "none",
                                                zIndex: 4,
                                            }}
                                        />
                                        <Tooltip title="Rotate group">
                                            <Box
                                                onMouseDown={startGroupRotate}
                                                sx={{
                                                    position: "absolute",
                                                    left: gx + gw / 2 - 6,
                                                    top: gy - 34,
                                                    width: 12,
                                                    height: 12,
                                                    borderRadius: "50%",
                                                    bgcolor: "primary.main",
                                                    border: "1.5px solid #1d1e1f",
                                                    cursor: "grab",
                                                    zIndex: 4,
                                                }}
                                            />
                                        </Tooltip>
                                    </>
                                )
                            })()}
                    </Box>

                    {/* Marquee - drawn at viewport level (not clipped by the
                        canvas) so it stays visible when dragging over the bg,
                        and it scrolls with the zoomed canvas. The visual rect
                        is clamped to the existing scroll extents: an absolute
                        child poking past them would GROW the scrollable area
                        and flash scrollbars during a fast drag. (Selection
                        math uses the unclamped canvas coords regardless.) */}
                    {marquee &&
                        canvasRef.current &&
                        (() => {
                            const wrap = scrollWrapRef.current
                            const maxX = wrap ? wrap.scrollWidth : Infinity
                            const maxY = wrap ? wrap.scrollHeight : Infinity
                            const ox = canvasRef.current.offsetLeft
                            const oy = canvasRef.current.offsetTop
                            const L = clamp(
                                ox + Math.min(marquee.x0, marquee.x1) * s,
                                0,
                                maxX,
                            )
                            const T = clamp(
                                oy + Math.min(marquee.y0, marquee.y1) * s,
                                0,
                                maxY,
                            )
                            const R = clamp(
                                ox + Math.max(marquee.x0, marquee.x1) * s,
                                0,
                                maxX,
                            )
                            const B = clamp(
                                oy + Math.max(marquee.y0, marquee.y1) * s,
                                0,
                                maxY,
                            )
                            return (
                                <Box
                                    sx={{
                                        position: "absolute",
                                        left: L,
                                        top: T,
                                        width: R - L,
                                        height: B - T,
                                        border: `1px dashed ${gold}`,
                                        bgcolor: "rgba(210,176,25,0.08)",
                                        pointerEvents: "none",
                                        zIndex: 5,
                                    }}
                                />
                            )
                        })()}
                    </Box>
                    <Typography variant="caption" color="text.disabled" sx={{ mt: 1.5 }}>
                        {layers.length} layer{layers.length === 1 ? "" : "s"}
                        {selIds.length > 1 ? ` · ${selIds.length} selected` : ""} ·{" "}
                        {snap ? `snapping to ${gridN}×${gridN} grid` : "free placement"}
                        {zoom !== 1 ? ` · ${Math.round(zoom * 100)}%` : ""}
                    </Typography>
                </Box>

                {/* Properties stretch grip */}
                <Box
                    onMouseDown={(e) => {
                        e.preventDefault()
                        sideDrag.current = {
                            side: "right",
                            startX: e.clientX,
                            startW: propsW,
                        }
                    }}
                    sx={{
                        width: "5px",
                        mr: "-3px",
                        flexShrink: 0,
                        cursor: "col-resize",
                        zIndex: 2,
                        "&:hover": { bgcolor: "primary.main", opacity: 0.4 },
                    }}
                />

                {/* Right dock: edit controls on top, layers pane pinned at
                    the bottom, separated by a draggable splitter */}
                <Box
                    sx={{
                        width: propsW,
                        flexShrink: 0,
                        borderLeft: 1,
                        borderColor: "divider",
                        display: "flex",
                        flexDirection: "column",
                        minHeight: 0,
                    }}>
                    {/* Edit pane (properties + preview) */}
                    <Box
                        sx={{
                            flex: 1,
                            minHeight: 0,
                            p: 2,
                            overflowY: "auto",
                            display: "flex",
                            flexDirection: "column",
                            gap: 2,
                        }}>
                    {selLayer ? (
                        <Stack spacing={1.75}>
                            <Typography variant="subtitle2" fontWeight={600}>
                                Transform ·{" "}
                                {selLayer.name ||
                                    (isTextLayer(selLayer)
                                        ? "Text"
                                        : SHAPES[selLayer.glyph]?.label ||
                                          selLayer.glyph)}
                            </Typography>
                            {isTextLayer(selLayer) && (
                                <>
                                    <Typography
                                        variant="caption"
                                        color="text.disabled">
                                        Double-click the text on the canvas to
                                        edit it.
                                    </Typography>
                                    <TextField
                                        select
                                        label="Font"
                                        size="small"
                                        fullWidth
                                        value={selLayer.fontFamily || "Arial"}
                                        onChange={(e) =>
                                            updateTextLayer({
                                                fontFamily: e.target.value,
                                            })
                                        }>
                                        {TEXT_FONTS.map((f) => (
                                            <MenuItem
                                                key={f}
                                                value={f}
                                                sx={{ fontFamily: f }}>
                                                {f}
                                            </MenuItem>
                                        ))}
                                    </TextField>
                                    <Box sx={{ display: "flex", gap: 0.5 }}>
                                        <FormControlLabel
                                            sx={{ ml: -0.75, mr: 1 }}
                                            control={
                                                <Checkbox
                                                    size="small"
                                                    checked={!!selLayer.bold}
                                                    onChange={(e) =>
                                                        updateTextLayer({
                                                            bold: e.target
                                                                .checked,
                                                        })
                                                    }
                                                />
                                            }
                                            label={
                                                <Typography
                                                    variant="caption"
                                                    fontWeight={700}>
                                                    Bold
                                                </Typography>
                                            }
                                        />
                                        <FormControlLabel
                                            sx={{ mr: 0 }}
                                            control={
                                                <Checkbox
                                                    size="small"
                                                    checked={!!selLayer.italic}
                                                    onChange={(e) =>
                                                        updateTextLayer({
                                                            italic:
                                                                e.target
                                                                    .checked,
                                                        })
                                                    }
                                                />
                                            }
                                            label={
                                                <Typography
                                                    variant="caption"
                                                    fontStyle="italic">
                                                    Italic
                                                </Typography>
                                            }
                                        />
                                    </Box>
                                </>
                            )}
                            <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.25 }}>
                                <NumField
                                    label="Width"
                                    value={Math.round(selLayer.w)}
                                    min={24}
                                    max={MAX_LAYER}
                                    onChange={(v) =>
                                        updateSel((l) =>
                                            snapLayer({ ...l, w: clamp(v, 24, MAX_LAYER) }, snap),
                                        )
                                    }
                                />
                                <NumField
                                    label="Height"
                                    value={Math.round(selLayer.h)}
                                    min={24}
                                    max={MAX_LAYER}
                                    onChange={(v) =>
                                        updateSel((l) =>
                                            snapLayer({ ...l, h: clamp(v, 24, MAX_LAYER) }, snap),
                                        )
                                    }
                                />
                            </Box>
                            <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.25, alignItems: "center" }}>
                                <NumField
                                    label="Rotate°"
                                    value={Math.round(selLayer.rot || 0)}
                                    min={0}
                                    max={359}
                                    onChange={(v) =>
                                        updateSel((l) => ({
                                            ...l,
                                            rot: ((v % 360) + 360) % 360,
                                        }))
                                    }
                                />
                                <Button
                                    variant="outlined"
                                    onClick={() =>
                                        updateSel((l) => snapLayer({ ...l, h: l.w }, snap))
                                    }
                                    sx={{ fontSize: 11.5, px: 0.5, height: 40 }}>
                                    Make square
                                </Button>
                            </Box>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, px: 0.5 }}>
                                <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    sx={{ whiteSpace: "nowrap" }}>
                                    Opacity
                                </Typography>
                                <Slider
                                    size="small"
                                    min={5}
                                    max={100}
                                    value={Math.round((selLayer.opacity ?? 1) * 100)}
                                    onChange={(e, v) =>
                                        updateSel((l) => ({ ...l, opacity: v / 100 }))
                                    }
                                    sx={{ flex: 1 }}
                                />
                                <Typography
                                    variant="caption"
                                    sx={{ minWidth: 32, textAlign: "right" }}>
                                    {Math.round((selLayer.opacity ?? 1) * 100)}%
                                </Typography>
                            </Box>
                            {(() => {
                                const mode =
                                    selLayer.styleMode ||
                                    (selLayer.outline ? "outline" : "fill")
                                const fillOn = mode === "fill" || mode === "both"
                                const outlineOn =
                                    mode === "outline" || mode === "both"
                                const setStyle = (fill, outline) => {
                                    // a layer must render something - turning
                                    // the last one off flips to the other
                                    if (!fill && !outline) {
                                        fill = !fillOn
                                        outline = !outlineOn
                                    }
                                    updateSel((l) => {
                                        const styleMode =
                                            fill && outline
                                                ? "both"
                                                : outline
                                                  ? "outline"
                                                  : "fill"
                                        const next = { ...l, styleMode }
                                        // Outline over a same-colored fill is
                                        // invisible - auto-pick a contrasting
                                        // color unless the user set one
                                        if (styleMode === "both") {
                                            const oc = l.outlineColor
                                            if (
                                                !oc ||
                                                oc.toLowerCase() ===
                                                    (l.color || "").toLowerCase()
                                            ) {
                                                next.outlineColor = contrastFor(
                                                    l.color,
                                                )
                                            }
                                        }
                                        return next
                                    })
                                }
                                // Snap outline thickness to grid units: one
                                // grid cell in this layer's path space is
                                // 24*cell/w, halved for center strokes
                                const rawStep =
                                    snap && cell && selLayer.w
                                        ? (24 * cell) / selLayer.w / 2
                                        : 0.5
                                const thickStep = clamp(
                                    Math.round(rawStep * 4) / 4,
                                    0.5,
                                    4,
                                )
                                return (
                                    <Box>
                                        <Typography
                                            variant="caption"
                                            color="text.secondary"
                                            sx={{ display: "block", mb: 0.25 }}>
                                            Style
                                        </Typography>
                                        <FormControlLabel
                                            sx={{ ml: -0.75, mr: 0, display: "flex" }}
                                            control={
                                                <Checkbox
                                                    size="small"
                                                    checked={fillOn}
                                                    onChange={(e) =>
                                                        setStyle(
                                                            e.target.checked,
                                                            outlineOn,
                                                        )
                                                    }
                                                />
                                            }
                                            label={
                                                <Typography variant="caption">
                                                    Fill
                                                </Typography>
                                            }
                                        />
                                        <Box
                                            component="button"
                                            type="button"
                                            onClick={() =>
                                                setOutlineOpen((v) => !v)
                                            }
                                            sx={{
                                                width: "100%",
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 0.75,
                                                mt: 0.25,
                                                px: 0.5,
                                                py: 0.75,
                                                background: "transparent",
                                                border: "none",
                                                cursor: "pointer",
                                                color: "text.secondary",
                                                fontFamily: "inherit",
                                                borderRadius: 1,
                                                "&:hover": {
                                                    bgcolor: "action.hover",
                                                },
                                            }}>
                                            <Typography
                                                variant="subtitle2"
                                                fontWeight={600}
                                                sx={{
                                                    flex: 1,
                                                    textAlign: "left",
                                                    color: outlineOn
                                                        ? "primary.main"
                                                        : "inherit",
                                                }}>
                                                Outline{outlineOn ? " · on" : ""}
                                            </Typography>
                                            <ExpandMore
                                                sx={{
                                                    fontSize: 18,
                                                    transition:
                                                        "transform .15s",
                                                    transform: outlineOpen
                                                        ? "none"
                                                        : "rotate(-90deg)",
                                                }}
                                            />
                                        </Box>
                                        {outlineOpen && (
                                            <Box sx={{ px: 0.5, pt: 0.25 }}>
                                                <Box sx={{ position: "relative" }}>
                                                <Box
                                                    sx={{
                                                        opacity: outlineOn
                                                            ? 1
                                                            : 0.45,
                                                        pointerEvents: outlineOn
                                                            ? "auto"
                                                            : "none",
                                                    }}>
                                        {/* Text outlines are always centered strokes */}
                                        {!isTextLayer(selLayer) && (
                                            <ToggleButtonGroup
                                                size="small"
                                                exclusive
                                                fullWidth
                                                sx={{ mt: 0.5 }}
                                                value={selLayer.outlineAlign || "center"}
                                                onChange={(e, v) =>
                                                    v &&
                                                    updateSel((l) => ({
                                                        ...l,
                                                        outlineAlign: v,
                                                    }))
                                                }>
                                                <ToggleButton value="inner" sx={{ fontSize: 10.5 }}>
                                                    Inner
                                                </ToggleButton>
                                                <ToggleButton value="center" sx={{ fontSize: 10.5 }}>
                                                    Center
                                                </ToggleButton>
                                                <ToggleButton value="outer" sx={{ fontSize: 10.5 }}>
                                                    Outer
                                                </ToggleButton>
                                            </ToggleButtonGroup>
                                        )}
                                        <Box
                                            sx={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 1.25,
                                                mt: 0.5,
                                                px: 0.5,
                                            }}>
                                            <Typography
                                                variant="caption"
                                                color="text.secondary"
                                                sx={{ whiteSpace: "nowrap" }}>
                                                Thickness
                                            </Typography>
                                            <Slider
                                                size="small"
                                                min={thickStep}
                                                max={8}
                                                step={thickStep}
                                                value={selLayer.outlineWidth || 3}
                                                onChange={(e, v) =>
                                                    updateSel((l) => ({
                                                        ...l,
                                                        outlineWidth:
                                                            Math.round(
                                                                v / thickStep,
                                                            ) * thickStep,
                                                    }))
                                                }
                                                sx={{ flex: 1 }}
                                            />
                                        </Box>
                                        {fillOn && (
                                            <Box sx={{ mt: 0.75 }}>
                                                <Typography
                                                    variant="caption"
                                                    color="text.secondary"
                                                    sx={{ display: "block", mb: 0.75 }}>
                                                    Outline color
                                                </Typography>
                                                <Box
                                                    sx={{
                                                        display: "flex",
                                                        flexWrap: "wrap",
                                                        gap: 1,
                                                        alignItems: "center",
                                                    }}>
                                                    {["#000000", "#ffffff", gold, ...CUSTOM_PRESET].map((c) => {
                                                        const on =
                                                            (selLayer.outlineColor || "#000000").toLowerCase() ===
                                                            c.toLowerCase()
                                                        return (
                                                            <Box
                                                                key={c}
                                                                title={c}
                                                                onClick={() =>
                                                                    updateSel((l) => ({
                                                                        ...l,
                                                                        outlineColor: c,
                                                                    }))
                                                                }
                                                                sx={{
                                                                    width: 24,
                                                                    height: 24,
                                                                    borderRadius: "5px",
                                                                    background: c,
                                                                    cursor: "pointer",
                                                                    border: on
                                                                        ? `2px solid ${gold}`
                                                                        : "1px solid #555",
                                                                    boxSizing: "border-box",
                                                                }}
                                                            />
                                                        )
                                                    })}
                                                    <Tooltip title="Transparent: the outline erases the layers below">
                                                        <Box
                                                            onClick={() =>
                                                                updateSel((l) => ({
                                                                    ...l,
                                                                    outlineColor:
                                                                        "transparent",
                                                                }))
                                                            }
                                                            sx={{
                                                                width: 24,
                                                                height: 24,
                                                                borderRadius: "5px",
                                                                cursor: "pointer",
                                                                boxSizing: "border-box",
                                                                border:
                                                                    selLayer.outlineColor ===
                                                                    "transparent"
                                                                        ? `2px solid ${gold}`
                                                                        : "1px solid #555",
                                                                backgroundImage:
                                                                    "linear-gradient(45deg,#c4c4c4 25%,transparent 25%,transparent 75%,#c4c4c4 75%),linear-gradient(45deg,#c4c4c4 25%,#f0f0f0 25%,#f0f0f0 75%,#c4c4c4 75%)",
                                                                backgroundSize: "8px 8px",
                                                                backgroundPosition: "0 0, 4px 4px",
                                                            }}
                                                        />
                                                    </Tooltip>
                                                    <Box
                                                        component="label"
                                                        title="Custom outline color"
                                                        sx={{
                                                            position: "relative",
                                                            width: 24,
                                                            height: 24,
                                                            borderRadius: "5px",
                                                            cursor: "pointer",
                                                            overflow: "hidden",
                                                            boxSizing: "border-box",
                                                            border: "1px solid #555",
                                                            background:
                                                                "conic-gradient(from 0deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
                                                        }}>
                                                        <input
                                                            type="color"
                                                            value={
                                                                selLayer.outlineColor &&
                                                                selLayer.outlineColor[0] === "#" &&
                                                                selLayer.outlineColor.length === 7
                                                                    ? selLayer.outlineColor
                                                                    : "#000000"
                                                            }
                                                            onChange={(e) => {
                                                                const v = e.target.value
                                                                updateSel((l) => ({
                                                                    ...l,
                                                                    outlineColor: v,
                                                                }))
                                                            }}
                                                            style={{
                                                                position: "absolute",
                                                                inset: 0,
                                                                opacity: 0,
                                                                cursor: "pointer",
                                                                border: "none",
                                                                padding: 0,
                                                            }}
                                                        />
                                                    </Box>
                                                </Box>
                                            </Box>
                                        )}
                                                </Box>
                                                {!outlineOn && (
                                                    <Tooltip title="Click to enable the outline">
                                                        <Box
                                                            onClick={() =>
                                                                setStyle(
                                                                    fillOn,
                                                                    true,
                                                                )
                                                            }
                                                            sx={{
                                                                position:
                                                                    "absolute",
                                                                inset: 0,
                                                                cursor: "pointer",
                                                                zIndex: 1,
                                                            }}
                                                        />
                                                    </Tooltip>
                                                )}
                                                </Box>
                                                <FormControlLabel
                                                    sx={{ mt: 0.25, ml: -0.75, display: "flex" }}
                                                    control={
                                                        <Checkbox
                                                            size="small"
                                                            checked={outlineOn}
                                                            onChange={(e) =>
                                                                setStyle(
                                                                    fillOn,
                                                                    e.target
                                                                        .checked,
                                                                )
                                                            }
                                                        />
                                                    }
                                                    label={
                                                        <Typography variant="caption">
                                                            Enable outline
                                                        </Typography>
                                                    }
                                                />
                                            </Box>
                                        )}
                                        <FormControlLabel
                                            sx={{ mt: 0.25, ml: -0.75 }}
                                            control={
                                                <Checkbox
                                                    size="small"
                                                    checked={!!selLayer.rounded}
                                                    onChange={(e) =>
                                                        updateSel((l) => ({
                                                            ...l,
                                                            rounded:
                                                                e.target.checked,
                                                        }))
                                                    }
                                                />
                                            }
                                            label={
                                                <Typography variant="caption">
                                                    Rounded corners
                                                </Typography>
                                            }
                                        />
                                    </Box>
                                )
                            })()}
                            <Box>
                                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.75 }}>
                                    Color
                                </Typography>
                                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center" }}>
                                    {["#000000", "#ffffff", gold, ...CUSTOM_PRESET].map((c) => {
                                        const on =
                                            (selLayer.color || "").toLowerCase() === c.toLowerCase()
                                        return (
                                            <Box
                                                key={c}
                                                title={c}
                                                onClick={() =>
                                                    updateSel((l) => ({ ...l, color: c }))
                                                }
                                                sx={{
                                                    width: 24,
                                                    height: 24,
                                                    borderRadius: "5px",
                                                    background: c,
                                                    cursor: "pointer",
                                                    border: on
                                                        ? `2px solid ${gold}`
                                                        : "1px solid #555",
                                                    boxSizing: "border-box",
                                                }}
                                            />
                                        )
                                    })}
                                    <Tooltip title="Transparent: erases the layers below">
                                        <Box
                                            onClick={() =>
                                                updateSel((l) => ({
                                                    ...l,
                                                    color: "transparent",
                                                }))
                                            }
                                            sx={{
                                                width: 24,
                                                height: 24,
                                                borderRadius: "5px",
                                                cursor: "pointer",
                                                boxSizing: "border-box",
                                                border: selLayer.color === "transparent"
                                                    ? `2px solid ${gold}`
                                                    : "1px solid #555",
                                                backgroundImage:
                                                    "linear-gradient(45deg,#c4c4c4 25%,transparent 25%,transparent 75%,#c4c4c4 75%),linear-gradient(45deg,#c4c4c4 25%,#f0f0f0 25%,#f0f0f0 75%,#c4c4c4 75%)",
                                                backgroundSize: "8px 8px",
                                                backgroundPosition: "0 0, 4px 4px",
                                            }}
                                        />
                                    </Tooltip>
                                    {(() => {
                                        const presets = ["#000000", "#ffffff", gold, ...CUSTOM_PRESET].map(
                                            (x) => x.toLowerCase(),
                                        )
                                        const isCustom =
                                            selLayer.color &&
                                            selLayer.color !== "transparent" &&
                                            presets.indexOf(selLayer.color.toLowerCase()) < 0
                                        return (
                                            <Box
                                                component="label"
                                                title="Custom color"
                                                sx={{
                                                    position: "relative",
                                                    width: 24,
                                                    height: 24,
                                                    borderRadius: "5px",
                                                    cursor: "pointer",
                                                    overflow: "hidden",
                                                    boxSizing: "border-box",
                                                    border: isCustom
                                                        ? `2px solid ${gold}`
                                                        : "1px solid #555",
                                                    background: isCustom
                                                        ? selLayer.color
                                                        : "conic-gradient(from 0deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
                                                }}>
                                                <input
                                                    type="color"
                                                    value={
                                                        selLayer.color &&
                                                        selLayer.color[0] === "#" &&
                                                        selLayer.color.length === 7
                                                            ? selLayer.color
                                                            : "#d2b019"
                                                    }
                                                    onChange={(e) => {
                                                        const v = e.target.value
                                                        updateSel((l) => ({ ...l, color: v }))
                                                    }}
                                                    style={{
                                                        position: "absolute",
                                                        inset: 0,
                                                        opacity: 0,
                                                        cursor: "pointer",
                                                        border: "none",
                                                        padding: 0,
                                                    }}
                                                />
                                            </Box>
                                        )
                                    })()}
                                </Box>
                            </Box>
                        </Stack>
                    ) : selIds.length > 1 ? (
                        <Stack spacing={1.75}>
                            <Typography variant="subtitle2" fontWeight={600}>
                                {selIds.length} layers selected
                            </Typography>
                            {(() => {
                                const sel = layers.filter((l) =>
                                    selSet.has(l.id),
                                )
                                const anyGrouped = sel.some((l) => l.group)
                                return (
                                    <Box
                                        sx={{
                                            display: "grid",
                                            gridTemplateColumns: "1fr 1fr",
                                            gap: 1,
                                        }}>
                                        <Button
                                            variant="outlined"
                                            size="small"
                                            startIcon={
                                                <LinkIcon sx={{ fontSize: 15 }} />
                                            }
                                            onClick={groupSel}
                                            sx={{ fontSize: 11.5, px: 0.5 }}>
                                            Group
                                        </Button>
                                        <Button
                                            variant="outlined"
                                            size="small"
                                            disabled={!anyGrouped}
                                            startIcon={
                                                <LinkOff sx={{ fontSize: 15 }} />
                                            }
                                            onClick={ungroupSel}
                                            sx={{ fontSize: 11.5, px: 0.5 }}>
                                            Ungroup
                                        </Button>
                                    </Box>
                                )
                            })()}
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, px: 0.5 }}>
                                <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    sx={{ whiteSpace: "nowrap" }}>
                                    Opacity
                                </Typography>
                                <Slider
                                    size="small"
                                    min={5}
                                    max={100}
                                    value={Math.round(
                                        (layers.find((l) => selSet.has(l.id))
                                            ?.opacity ?? 1) * 100,
                                    )}
                                    onChange={(e, v) =>
                                        updateSel((l) => ({ ...l, opacity: v / 100 }))
                                    }
                                    sx={{ flex: 1 }}
                                />
                            </Box>
                            <Box>
                                <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    sx={{ display: "block", mb: 0.75 }}>
                                    Color
                                </Typography>
                                <Box
                                    sx={{
                                        display: "flex",
                                        flexWrap: "wrap",
                                        gap: 1,
                                        alignItems: "center",
                                    }}>
                                    {["#000000", "#ffffff", gold, ...CUSTOM_PRESET].map(
                                        (c) => (
                                            <Box
                                                key={c}
                                                title={c}
                                                onClick={() =>
                                                    updateSel((l) => ({
                                                        ...l,
                                                        color: c,
                                                    }))
                                                }
                                                sx={{
                                                    width: 24,
                                                    height: 24,
                                                    borderRadius: "5px",
                                                    background: c,
                                                    cursor: "pointer",
                                                    border: "1px solid #555",
                                                    boxSizing: "border-box",
                                                }}
                                            />
                                        ),
                                    )}
                                </Box>
                            </Box>
                            <Typography
                                variant="caption"
                                color="text.disabled"
                                sx={{ lineHeight: 1.6 }}>
                                Drag any selected layer to move the group.
                                Select a single layer to edit its transform
                                and style.
                            </Typography>
                        </Stack>
                    ) : (
                        <Typography variant="caption" color="text.disabled" sx={{ lineHeight: 1.6 }}>
                            No layer selected. Drag a glyph from the palette,
                            then use the handles to move, resize and rotate
                            it. Drag on empty canvas to select multiple -
                            Ctrl-click toggles, Shift-click adds.
                        </Typography>
                    )}
                    </Box>

                    {/* Splitter - drag to resize the layers pane */}
                    <Box
                        onMouseDown={(e) => {
                            e.preventDefault()
                            sideDrag.current = {
                                side: "layers",
                                startY: e.clientY,
                                startH: layersH,
                            }
                        }}
                        sx={{
                            height: "5px",
                            mt: "-3px",
                            flexShrink: 0,
                            cursor: "row-resize",
                            zIndex: 2,
                            "&:hover": { bgcolor: "primary.main", opacity: 0.4 },
                        }}
                    />

                    {/* Layers pane - topmost layer first, Photoshop style */}
                    <Box
                        sx={{
                            height: layersH,
                            flexShrink: 0,
                            borderTop: 1,
                            borderColor: "divider",
                            bgcolor: "background.paper",
                            display: "flex",
                            flexDirection: "column",
                            px: 2,
                            pt: 1,
                            pb: 1.25,
                            minHeight: 0,
                        }}>
                        <Typography
                            variant="subtitle2"
                            fontWeight={600}
                            sx={{ mb: 0.75 }}>
                            Layers
                            {layers.length > 0 && (
                                <Typography
                                    component="span"
                                    variant="caption"
                                    color="text.disabled"
                                    sx={{ ml: 0.75 }}>
                                    {layers.length}
                                </Typography>
                            )}
                        </Typography>
                        <Box
                            sx={{
                                flex: 1,
                                minHeight: 0,
                                overflowY: "auto",
                                border: 1,
                                borderColor: "divider",
                                borderRadius: 1,
                                bgcolor: "background.default",
                            }}
                            onDragOver={(e) => {
                                // Allow dropping in the empty area below the
                                // rows (sends the layer to the back)
                                if (layerDrag.current) e.preventDefault()
                            }}
                            onDrop={(e) => {
                                if (!layerDrag.current) return
                                e.preventDefault()
                                const last = layers[0]
                                if (last)
                                    reorderLayer(
                                        layerDrag.current,
                                        last.id,
                                        false,
                                    )
                                layerDrag.current = null
                                setDropMark(null)
                            }}>
                            {layers.length === 0 && (
                                <Typography
                                    variant="caption"
                                    color="text.disabled"
                                    sx={{ display: "block", p: 1.25 }}>
                                    No layers yet.
                                </Typography>
                            )}
                            {[...layers].reverse().map((l) => {
                                const active = selSet.has(l.id)
                                const label =
                                    l.name ||
                                    (isTextLayer(l)
                                        ? `"${l.text || "Text"}"`
                                        : SHAPES[l.glyph]?.label || l.glyph)
                                return (
                                    <Box
                                        key={l.id}
                                        draggable={renameId !== l.id}
                                        onDragStart={(e) => {
                                            layerDrag.current = l.id
                                            e.dataTransfer.effectAllowed =
                                                "move"
                                        }}
                                        onDragEnd={() => {
                                            layerDrag.current = null
                                            setDropMark(null)
                                        }}
                                        onDragOver={(e) => {
                                            if (!layerDrag.current) return
                                            e.preventDefault()
                                            e.stopPropagation()
                                            const r =
                                                e.currentTarget.getBoundingClientRect()
                                            setDropMark({
                                                id: l.id,
                                                before:
                                                    e.clientY <
                                                    r.top + r.height / 2,
                                            })
                                        }}
                                        onDrop={(e) => {
                                            if (!layerDrag.current) return
                                            e.preventDefault()
                                            e.stopPropagation()
                                            reorderLayer(
                                                layerDrag.current,
                                                l.id,
                                                e.clientY <
                                                    e.currentTarget.getBoundingClientRect()
                                                        .top +
                                                        e.currentTarget.getBoundingClientRect()
                                                            .height /
                                                            2,
                                            )
                                            layerDrag.current = null
                                            setDropMark(null)
                                        }}
                                        onMouseDown={(e) => {
                                            if (renameId === l.id) return
                                            if (e.ctrlKey || e.metaKey) {
                                                setSelIds((ids) =>
                                                    ids.includes(l.id)
                                                        ? ids.filter(
                                                              (x) => x !== l.id,
                                                          )
                                                        : [...ids, l.id],
                                                )
                                            } else if (e.shiftKey) {
                                                setSelIds((ids) =>
                                                    expandWithGroups(
                                                        [
                                                            ...new Set([
                                                                ...ids,
                                                                l.id,
                                                            ]),
                                                        ],
                                                        layers,
                                                    ),
                                                )
                                            } else {
                                                setSelIds(
                                                    expandWithGroups(
                                                        [l.id],
                                                        layers,
                                                    ),
                                                )
                                            }
                                        }}
                                        onDoubleClick={() => {
                                            setRenameId(l.id)
                                            setRenameDraft(label)
                                        }}
                                        onContextMenu={(e) =>
                                            openLayerMenu(e, l)
                                        }
                                        sx={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 0.75,
                                            px: 0.75,
                                            py: 0.5,
                                            cursor: "pointer",
                                            userSelect: "none",
                                            bgcolor: active
                                                ? "action.selected"
                                                : "transparent",
                                            opacity: l.hidden ? 0.45 : 1,
                                            borderTop:
                                                dropMark?.id === l.id &&
                                                dropMark.before
                                                    ? `2px solid ${gold}`
                                                    : "2px solid transparent",
                                            borderBottom:
                                                dropMark?.id === l.id &&
                                                !dropMark.before
                                                    ? `2px solid ${gold}`
                                                    : "2px solid transparent",
                                            "&:hover": {
                                                bgcolor: active
                                                    ? "action.selected"
                                                    : "action.hover",
                                            },
                                        }}>
                                        <Tooltip
                                            title={
                                                l.hidden
                                                    ? "Show layer"
                                                    : "Hide layer"
                                            }>
                                            <IconButton
                                                size="small"
                                                sx={{ p: 0.25 }}
                                                onMouseDown={(e) =>
                                                    e.stopPropagation()
                                                }
                                                onClick={() =>
                                                    setLayerProps(l.id, {
                                                        hidden: !l.hidden,
                                                    })
                                                }>
                                                {l.hidden ? (
                                                    <VisibilityOff
                                                        sx={{ fontSize: 15 }}
                                                    />
                                                ) : (
                                                    <Visibility
                                                        sx={{ fontSize: 15 }}
                                                    />
                                                )}
                                            </IconButton>
                                        </Tooltip>
                                        <Box
                                            sx={{
                                                width: 22,
                                                height: 22,
                                                flexShrink: 0,
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                bgcolor: "background.default",
                                                border: 1,
                                                borderColor: "divider",
                                                borderRadius: 0.5,
                                                transform: `scale(${l.flipH ? -1 : 1}, ${l.flipV ? -1 : 1})`,
                                            }}>
                                            {isTextLayer(l) ? (
                                                <TitleIcon
                                                    sx={{
                                                        fontSize: 15,
                                                        color:
                                                            l.color ===
                                                            "transparent"
                                                                ? "#999999"
                                                                : l.color,
                                                    }}
                                                />
                                            ) : (
                                                <ShapeSvg
                                                    id={l.glyph}
                                                    color={
                                                        l.color ===
                                                        "transparent"
                                                            ? "#999999"
                                                            : l.color
                                                    }
                                                    w={14}
                                                />
                                            )}
                                        </Box>
                                        {renameId === l.id ? (
                                            <TextField
                                                size="small"
                                                variant="standard"
                                                autoFocus
                                                value={renameDraft}
                                                onChange={(e) =>
                                                    setRenameDraft(
                                                        e.target.value,
                                                    )
                                                }
                                                onBlur={() => {
                                                    const v =
                                                        renameDraft.trim()
                                                    if (v && v !== label) {
                                                        setLayerProps(l.id, {
                                                            name: v,
                                                        })
                                                    }
                                                    setRenameId(null)
                                                }}
                                                onKeyDown={(e) => {
                                                    e.stopPropagation()
                                                    if (e.key === "Enter")
                                                        e.target.blur()
                                                    if (e.key === "Escape")
                                                        setRenameId(null)
                                                }}
                                                sx={{ flex: 1 }}
                                                inputProps={{
                                                    style: { fontSize: 12 },
                                                }}
                                            />
                                        ) : (
                                            <Typography
                                                variant="caption"
                                                noWrap
                                                sx={{ flex: 1, minWidth: 0 }}>
                                                {label}
                                            </Typography>
                                        )}
                                        {(l.opacity ?? 1) < 1 && (
                                            <Typography
                                                variant="caption"
                                                color="text.disabled"
                                                sx={{
                                                    fontSize: 10,
                                                    flexShrink: 0,
                                                }}>
                                                {Math.round(
                                                    (l.opacity ?? 1) * 100,
                                                )}
                                                %
                                            </Typography>
                                        )}
                                        {l.group && (
                                            <Tooltip title="Grouped - click selects the whole group (Ctrl+Shift+G to ungroup)">
                                                <LinkIcon
                                                    sx={{
                                                        fontSize: 13,
                                                        flexShrink: 0,
                                                        color: groupColor(
                                                            l.group,
                                                        ),
                                                    }}
                                                />
                                            </Tooltip>
                                        )}
                                    </Box>
                                )
                            })}
                        </Box>
                        <Typography
                            variant="caption"
                            color="text.disabled"
                            noWrap
                            sx={{ mt: 0.5, flexShrink: 0 }}>
                            Drag to reorder
                        </Typography>
                    </Box>
                </Box>
            </Box>

            {/* Hidden SVG import input */}
            <input
                ref={svgInputRef}
                type="file"
                accept=".svg,image/svg+xml"
                style={{ display: "none" }}
                onChange={async (e) => {
                    const file = e.target.files && e.target.files[0]
                    e.target.value = ""
                    if (!file) return
                    try {
                        const parsed = parseSvgToGlyph(await file.text(), { importHeuristics: true })
                        if (!parsed) {
                            console.warn(
                                "Skipped SVG import, no usable paths found:",
                                file.name,
                            )
                            return
                        }
                        const label = file.name.replace(/\.svg$/i, "")
                        const id = registerCustomGlyph(
                            label,
                            parsed.paths,
                            parsed.vb,
                            parsed.evenodd ? "evenodd" : undefined,
                        )
                        setCustomIds((ids) => [...new Set([...ids, id])])
                        setOpenSections((s) => ({ ...s, custom: true }))
                        console.log(
                            `Imported SVG "${file.name}" as a custom shape`,
                        )
                    } catch (err) {
                        console.error(
                            `Failed to import SVG "${file.name}":`,
                            err,
                        )
                    }
                }}
            />

            {/* Footer */}
            <Box sx={{ p: 2, borderTop: 1, borderColor: "divider" }}>
                <Stack direction="row" spacing={1}>
                    <Button
                        variant="contained"
                        startIcon={<SaveIcon />}
                        disabled={!canSave}
                        onClick={() => onSave({ layers })}
                        sx={{ flex: 1 }}>
                        {isSaving ? "Saving..." : saveLabel}
                    </Button>
                    <Button
                        variant="outlined"
                        startIcon={<Close />}
                        onClick={requestClose}
                        sx={{ flex: 1 }}>
                        Cancel
                    </Button>
                </Stack>
            </Box>

            {/* Layer context menu (right-click a canvas layer or panel row) */}
            {(() => {
                const ctxLayer = ctxMenu
                    ? layers.find((l) => l.id === ctxMenu.layerId)
                    : null
                const act = (fn) => () => {
                    setCtxMenu(null)
                    fn()
                }
                const anyGrouped = layers.some(
                    (l) => selSet.has(l.id) && l.group,
                )
                return (
                    <Menu
                        open={!!ctxMenu && !!ctxLayer}
                        onClose={() => setCtxMenu(null)}
                        anchorReference="anchorPosition"
                        anchorPosition={
                            ctxMenu
                                ? { top: ctxMenu.mouseY, left: ctxMenu.mouseX }
                                : undefined
                        }
                        slotProps={{
                            list: { dense: true },
                            paper: { sx: { minWidth: 220 } },
                        }}>
                        <MenuItem onClick={act(() => raise(1))}>
                            Bring to Front
                        </MenuItem>
                        <MenuItem onClick={act(() => raise(-1))}>
                            Send to Back
                        </MenuItem>
                        <Divider />
                        <MenuItem onClick={act(() => flipSel("h"))}>
                            Flip Horizontal
                        </MenuItem>
                        <MenuItem onClick={act(() => flipSel("v"))}>
                            Flip Vertical
                        </MenuItem>
                        <Divider />
                        <MenuItem
                            disabled={selIds.length < 2}
                            onClick={act(groupSel)}>
                            Group
                        </MenuItem>
                        <MenuItem
                            disabled={!anyGrouped}
                            onClick={act(ungroupSel)}>
                            Ungroup
                        </MenuItem>
                        <Divider />
                        <MenuItem
                            onClick={act(() => {
                                if (!ctxLayer) return
                                setRenameId(ctxLayer.id)
                                setRenameDraft(
                                    ctxLayer.name ||
                                        (isTextLayer(ctxLayer)
                                            ? ctxLayer.text || "Text"
                                            : SHAPES[ctxLayer.glyph]?.label ||
                                              ctxLayer.glyph),
                                )
                            })}>
                            Rename
                        </MenuItem>
                        <MenuItem
                            onClick={act(() => {
                                if (!ctxLayer) return
                                setLayerProps(ctxLayer.id, {
                                    hidden: !ctxLayer.hidden,
                                })
                            })}>
                            {ctxLayer?.hidden ? "Show" : "Hide"}
                        </MenuItem>
                        <Divider />
                        <MenuItem onClick={act(dupSel)}>Duplicate</MenuItem>
                        <MenuItem
                            onClick={act(removeSel)}
                            sx={{ color: "error.main" }}>
                            Delete
                        </MenuItem>
                    </Menu>
                )
            })()}

            {/* Confirm discarding unsaved edits */}
            <Dialog
                open={confirmCloseOpen}
                onClose={() => setConfirmCloseOpen(false)}>
                <DialogTitle>Discard design?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        You have unsaved changes. Close the designer and
                        discard them?
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmCloseOpen(false)}>
                        Keep editing
                    </Button>
                    <Button
                        color="error"
                        variant="contained"
                        onClick={() => {
                            setConfirmCloseOpen(false)
                            onCancel()
                        }}>
                        Discard
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    )
}

export default SignageDesigner
