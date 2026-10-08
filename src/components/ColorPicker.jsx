import { useEffect, useRef, useState } from "react"
import {
    Box,
    Popover,
    Slider,
    TextField,
    Tooltip,
    Typography,
} from "@mui/material"

const clamp = (n, min, max) => Math.min(max, Math.max(min, n))

/**
 * "#ff8000" as [255, 128, 0] ("#ff8000ff" too: the alpha is left out; black
 * when it's neither)
 */
function hexToRgb(hex) {
    const match =
        /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})(?:[0-9a-f]{2})?$/i.exec(
            String(hex ?? "").trim(),
        )
    return match
        ? match.slice(1, 4).map((part) => parseInt(part, 16))
        : [0, 0, 0]
}

const rgbToHex = (rgb) =>
    `#${rgb.map((n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0")).join("")}`

/** Hue (0 to 360), saturation and brightness (0 to 1) as [r, g, b] */
function hsvToRgb({ h, s, v }) {
    const channel = (n) => {
        const k = (n + h / 60) % 6
        return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255
    }
    return [channel(5), channel(3), channel(1)]
}

/** [r, g, b] as hue (0 to 360), saturation and brightness (0 to 1) */
function rgbToHsv([r, g, b]) {
    const [red, green, blue] = [r / 255, g / 255, b / 255]
    const max = Math.max(red, green, blue)
    const range = max - Math.min(red, green, blue)
    let h = 0
    if (range) {
        if (max === red) h = ((green - blue) / range) % 6
        else if (max === green) h = (blue - red) / range + 2
        else h = (red - green) / range + 4
        h = (h * 60 + 360) % 360
    }
    return { h, s: max ? range / max : 0, v: max }
}

const HUES =
    "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)"

/** The fields' height, and the preview's size (as tall as the hex field) */
const FIELD_HEIGHT = 40

/** A small number field for one of R, G and B */
function ChannelField({ label, value, onChange }) {
    return (
        <TextField
            size="small"
            label={label}
            type="number"
            value={value}
            onChange={(e) => {
                const n = Number(e.target.value)
                if (e.target.value !== "" && Number.isFinite(n)) {
                    onChange(clamp(Math.round(n), 0, 255))
                }
            }}
            inputProps={{ min: 0, max: 255, step: 1 }}
            sx={{
                flex: 1,
                "& .MuiInputBase-root": { height: FIELD_HEIGHT },
                "& .MuiInputBase-input": {
                    fontSize: "0.8rem",
                    px: 1.25,
                    // No spinner arrows: they take the room of the number
                    MozAppearance: "textfield",
                    "&::-webkit-outer-spin-button, &::-webkit-inner-spin-button":
                        { WebkitAppearance: "none", margin: 0 },
                },
            }}
        />
    )
}

/**
 * BeePEE's color picker: a saturation and brightness square, a hue slider,
 * hex and R, G, B fields, and presets
 * @param {{value: string, onChange: (hex: string) => void, presets?: string[]}} props
 *   value and onChange's color are "#rrggbb"
 */
export default function ColorPicker({ value, onChange, presets = [] }) {
    const hex = rgbToHex(hexToRgb(value))
    const rgb = hexToRgb(hex)
    // Kept apart from the color: a gray or black color has no hue, and the
    // slider shouldn't jump
    const [hsv, setHsv] = useState(() => rgbToHsv(rgb))
    const [hexDraft, setHexDraft] = useState(hex)
    const areaRef = useRef(null)

    // A color from outside (another swatch, a preset, a field)
    useEffect(() => {
        if (rgbToHex(hsvToRgb(hsv)) !== hex) setHsv(rgbToHsv(hexToRgb(hex)))
        setHexDraft(hex)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hex])

    const pickHsv = (next) => {
        setHsv(next)
        onChange(rgbToHex(hsvToRgb(next)))
    }
    const pickRgb = (next) => onChange(rgbToHex(next))

    /** Saturation and brightness from where the pointer is in the square */
    const pickAt = (event) => {
        const rect = areaRef.current.getBoundingClientRect()
        pickHsv({
            ...hsv,
            s: clamp((event.clientX - rect.left) / rect.width, 0, 1),
            v: 1 - clamp((event.clientY - rect.top) / rect.height, 0, 1),
        })
    }

    const hueHex = rgbToHex(hsvToRgb({ h: hsv.h, s: 1, v: 1 }))

    return (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            <Box
                ref={areaRef}
                role="slider"
                tabIndex={0}
                aria-label="Saturation and brightness"
                aria-valuetext={`Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
                onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId)
                    pickAt(e)
                }}
                onPointerMove={(e) => {
                    if (e.buttons & 1) pickAt(e)
                }}
                onKeyDown={(e) => {
                    const step = e.shiftKey ? 0.1 : 0.01
                    const moves = {
                        ArrowLeft: { s: hsv.s - step },
                        ArrowRight: { s: hsv.s + step },
                        ArrowUp: { v: hsv.v + step },
                        ArrowDown: { v: hsv.v - step },
                    }
                    const move = moves[e.key]
                    if (!move) return
                    e.preventDefault()
                    pickHsv({
                        ...hsv,
                        s: clamp(move.s ?? hsv.s, 0, 1),
                        v: clamp(move.v ?? hsv.v, 0, 1),
                    })
                }}
                sx={{
                    position: "relative",
                    height: 120,
                    borderRadius: 1,
                    cursor: "crosshair",
                    touchAction: "none",
                    outline: "none",
                    background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), ${hueHex}`,
                    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
                    "&:focus-visible": {
                        boxShadow: (theme) =>
                            `0 0 0 2px ${theme.palette.primary.main}`,
                    },
                }}>
                <Box
                    sx={{
                        position: "absolute",
                        left: `${hsv.s * 100}%`,
                        top: `${(1 - hsv.v) * 100}%`,
                        width: 14,
                        height: 14,
                        borderRadius: "50%",
                        border: "2px solid #fff",
                        boxShadow: "0 0 0 1px rgba(0,0,0,0.6)",
                        backgroundColor: hex,
                        transform: "translate(-50%, -50%)",
                        pointerEvents: "none",
                    }}
                />
            </Box>

            <Slider
                aria-label="Hue"
                value={hsv.h}
                min={0}
                max={360}
                onChange={(_, h) => pickHsv({ ...hsv, h })}
                sx={{
                    height: 10,
                    py: "6px !important",
                    "& .MuiSlider-rail": { opacity: 1, background: HUES },
                    "& .MuiSlider-track": { display: "none" },
                    "& .MuiSlider-thumb": {
                        width: 16,
                        height: 16,
                        backgroundColor: hueHex,
                        border: "2px solid #fff",
                        boxShadow: "0 0 0 1px rgba(0,0,0,0.6)",
                    },
                }}
            />

            <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                <TextField
                    size="small"
                    label="Hex"
                    value={hexDraft}
                    onChange={(e) => {
                        setHexDraft(e.target.value)
                        if (/^#?[0-9a-f]{6}$/i.test(e.target.value.trim())) {
                            pickRgb(hexToRgb(e.target.value))
                        }
                    }}
                    onBlur={() => setHexDraft(hex)}
                    sx={{
                        flex: 1,
                        "& .MuiInputBase-root": { height: FIELD_HEIGHT },
                        "& .MuiInputBase-input": {
                            fontSize: "0.8rem",
                            fontFamily: "monospace",
                            px: 1.25,
                        },
                    }}
                />
                <Box
                    sx={{
                        width: FIELD_HEIGHT,
                        height: FIELD_HEIGHT,
                        boxSizing: "border-box",
                        flexShrink: 0,
                        borderRadius: 1,
                        border: "1px solid #555",
                        backgroundColor: hex,
                    }}
                />
            </Box>
            <Box sx={{ display: "flex", gap: 1 }}>
                {["R", "G", "B"].map((label, i) => (
                    <ChannelField
                        key={label}
                        label={label}
                        value={rgb[i]}
                        onChange={(n) =>
                            pickRgb(rgb.map((old, j) => (j === i ? n : old)))
                        }
                    />
                ))}
            </Box>

            {presets.length > 0 && (
                <Box>
                    <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block", mb: 0.5 }}>
                        Presets
                    </Typography>
                    <Box
                        sx={{
                            display: "grid",
                            gridTemplateColumns: "repeat(14, 1fr)",
                            gap: "4px",
                        }}>
                        {presets.map((preset) => (
                            <Tooltip key={preset} title={preset}>
                                <Box
                                    role="button"
                                    tabIndex={0}
                                    aria-label={`Preset ${preset}`}
                                    onClick={() => pickRgb(hexToRgb(preset))}
                                    onKeyDown={(e) => {
                                        if (
                                            e.key === "Enter" ||
                                            e.key === " "
                                        ) {
                                            e.preventDefault()
                                            pickRgb(hexToRgb(preset))
                                        }
                                    }}
                                    sx={{
                                        aspectRatio: "1",
                                        borderRadius: "4px",
                                        cursor: "pointer",
                                        backgroundColor: preset,
                                        border: "1px solid",
                                        borderColor:
                                            rgbToHex(hexToRgb(preset)) === hex
                                                ? "primary.main"
                                                : "#555",
                                        "&:hover, &:focus-visible": {
                                            borderColor: "primary.main",
                                            outline: "none",
                                        },
                                    }}
                                />
                            </Tooltip>
                        ))}
                    </Box>
                </Box>
            )}
        </Box>
    )
}

/**
 * BeePEE's color picker in a popover under anchorEl, while it's set. What's
 * behind it isn't dimmed (the theme's backdrop), so the color being picked
 * shows where it's used.
 */
export function ColorPickerPopover({
    anchorEl,
    onClose,
    value,
    onChange,
    presets,
}) {
    return (
        <Popover
            open={Boolean(anchorEl)}
            anchorEl={anchorEl}
            onClose={onClose}
            anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
            transformOrigin={{ vertical: "top", horizontal: "left" }}
            slotProps={{
                backdrop: {
                    sx: {
                        backgroundColor: "transparent",
                        backdropFilter: "none",
                    },
                },
                paper: {
                    sx: {
                        mt: 1,
                        p: 2,
                        width: 268,
                        bgcolor: "background.paper",
                        backgroundImage: "none",
                        border: "1px solid #3a3a3a",
                    },
                },
            }}>
            <ColorPicker value={value} onChange={onChange} presets={presets} />
        </Popover>
    )
}

/**
 * A swatch (sx: how it looks) that opens BeePEE's color picker
 * @param {{title: string, value: string, onChange: (hex: string) => void, presets?: string[], sx?: object, children?: import("react").ReactNode}} props
 */
export function ColorPickerButton({
    title,
    value,
    onChange,
    presets,
    sx,
    children,
}) {
    const [anchorEl, setAnchorEl] = useState(null)
    return (
        <>
            {/* Not over the picker while it's open */}
            <Tooltip title={anchorEl ? "" : title}>
                <Box
                    role="button"
                    tabIndex={0}
                    aria-label={title}
                    onClick={(e) => setAnchorEl(e.currentTarget)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            setAnchorEl(e.currentTarget)
                        }
                    }}
                    sx={{ cursor: "pointer", flexShrink: 0, ...sx }}>
                    {children}
                </Box>
            </Tooltip>
            <ColorPickerPopover
                anchorEl={anchorEl}
                onClose={() => setAnchorEl(null)}
                value={value}
                onChange={onChange}
                presets={presets}
            />
        </>
    )
}
