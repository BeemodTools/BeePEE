import { useState, useEffect } from "react"
import {
    Box,
    Stack,
    Typography,
    ButtonBase,
    TextField,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    Slider,
    Button,
    Tooltip,
    InputAdornment,
} from "@mui/material"
import { Check, FolderOpen } from "@mui/icons-material"
import { ColorPickerPopover } from "../ColorPicker"

// All signage preferences with their defaults. The form lives in the main
// Settings window (Signage tab); the designer's File > Preferences opens
// that same window.
export const SIGNAGE_PREF_DEFAULTS = {
    // Designer defaults
    signageDefaultColor: "#000000",
    signageDefaultSnap: true,
    signageDefaultGridN: 8,
    signageDefaultShapeSize: 128,
    signageDefaultOutlineOn: false,
    signageDefaultOutlineWidth: 3,
    signageDefaultOutlineAlign: "center",
    signageShowBackplate: true,
    // Glow & materials
    signageGlowMode: "brightness", // brightness | shape | off
    // The 50% stock plate mask is baked into the texture alpha, so 100%
    // here = stock signage brightness (tint written only when lower)
    signageGlowIntensity: 100,
    // Size in px of a designed signage: its in-game texture (the VTF), its
    // icon and exported PNGs. Stock signs are 128; higher is crisper up
    // close but a bigger file.
    signageTextureSize: 512,
    // Workflow
    signageIconClickAction: "ask", // ask | upload | designer
    signageAddAction: "ask", // ask | upload | designer (Add Signage dialog)
    signageConfirmDiscard: true,
    signageRememberExportDir: true,
    // Palette & library
    signageSvgFolder: "",
    signageOpenSections: "none", // none | all
    // Naming
    signageIdPrefix: "SIGN_BPEE",
    signageAutoName: true,
}

export const SIGNAGE_PREF_KEYS = Object.keys(SIGNAGE_PREF_DEFAULTS)

// Load all signage prefs (merged over defaults) from the settings store.
export async function loadSignagePrefs() {
    try {
        const result = await window.package?.getSettings?.()
        const all = result?.success ? result.settings || {} : {}
        const prefs = { ...SIGNAGE_PREF_DEFAULTS }
        for (const key of SIGNAGE_PREF_KEYS) {
            if (all[key] !== undefined && all[key] !== null) {
                prefs[key] = all[key]
            }
        }
        // Not a signage pref (never saved by the dialog) - carried along so
        // the form can gate developer-only fields
        prefs.devMode = !!all.devMode
        return prefs
    } catch {
        return { ...SIGNAGE_PREF_DEFAULTS }
    }
}

// Checkbox-card row, styled to match the main Settings window's toggles.
function PrefToggle({ name, description, checked, onChange }) {
    return (
        <ButtonBase
            onClick={() => onChange(!checked)}
            sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-start",
                textAlign: "left",
                p: 1.5,
                borderRadius: 1,
                border: 1,
                borderColor: checked ? "primary.main" : "divider",
                transition: "all 0.15s ease",
                width: "100%",
                "&:hover": {
                    bgcolor: "action.hover",
                    borderColor: checked ? "primary.main" : "text.secondary",
                },
            }}>
            <Box
                sx={{
                    width: 20,
                    height: 20,
                    borderRadius: 0.5,
                    border: 2,
                    borderColor: checked ? "primary.main" : "text.disabled",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    mr: 1.5,
                    flexShrink: 0,
                }}>
                {checked && <Check sx={{ fontSize: 16, color: "primary.main" }} />}
            </Box>
            <Box>
                <Typography variant="body2" fontWeight={600}>
                    {name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                    {description}
                </Typography>
            </Box>
        </ButtonBase>
    )
}

function Section({ title, children }) {
    return (
        <Box>
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1.5 }}>
                {title}
            </Typography>
            <Stack spacing={1.5}>{children}</Stack>
        </Box>
    )
}

// The full preferences form. Controlled: values is a map containing (at
// least) the SIGNAGE_PREF_KEYS, onChange(key, value) records an edit.
export function SignagePreferencesForm({ values, onChange }) {
    // null-safe: unset settings arrive as null, not just undefined
    const v = (key) => values[key] ?? SIGNAGE_PREF_DEFAULTS[key]

    // Uniform control height matching the checkbox cards (p:1.5 + two text
    // lines ≈ 66px) so text fields, selects, and toggles all read as rows.
    const fieldSx = { "& .MuiInputBase-root": { height: 66 } }

    // Where the default shape color's picker opens (its field), while open
    const [colorAnchor, setColorAnchor] = useState(null)

    // The backend resolves (and creates) a default folder under the app's
    // user-data dir when none is set - show that path instead of a blank.
    const [defaultSvgFolder, setDefaultSvgFolder] = useState("")
    useEffect(() => {
        window.package
            ?.getSignageSvgFolder?.()
            .then((r) => {
                if (r?.success && r.path) setDefaultSvgFolder(r.path)
            })
            .catch(() => {})
    }, [])

    const handleBrowseSvgFolder = async () => {
        const result = await window.package?.browseSignageSvgFolder?.()
        if (result?.success && result.path) {
            onChange("signageSvgFolder", result.path)
        }
    }

    const handleOpenSvgFolder = () => {
        window.package?.openSignageSvgFolder?.().catch?.(() => {})
    }

    return (
        <Stack spacing={4}>
            <Section title="Designer defaults">
                <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.25 }}>
                    <TextField
                        label="Default shape color"
                        size="small"
                        value={v("signageDefaultColor")}
                        onClick={(e) => setColorAnchor(e.currentTarget)}
                        slotProps={{
                            input: {
                                readOnly: true,
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <Box
                                            sx={{
                                                width: 28,
                                                height: 28,
                                                borderRadius: "5px",
                                                boxSizing: "border-box",
                                                border: "1px solid #555",
                                                backgroundColor: v(
                                                    "signageDefaultColor",
                                                ),
                                            }}
                                        />
                                    </InputAdornment>
                                ),
                            },
                        }}
                        sx={{
                            ...fieldSx,
                            "& .MuiInputBase-root, & input": {
                                cursor: "pointer",
                            },
                            "& input": { fontFamily: "monospace" },
                        }}
                        fullWidth
                    />
                    <ColorPickerPopover
                        anchorEl={colorAnchor}
                        onClose={() => setColorAnchor(null)}
                        value={v("signageDefaultColor")}
                        onChange={(hex) => onChange("signageDefaultColor", hex)}
                        presets={[
                            "#000000",
                            "#ffffff",
                            "#d2b019",
                            "#4caf50",
                            "#e05c4a",
                            "#4a90d9",
                        ]}
                    />
                    <TextField
                        label="Default shape size (px)"
                        type="number"
                        size="small"
                        value={v("signageDefaultShapeSize")}
                        inputProps={{ min: 24, max: 512 }}
                        onChange={(e) =>
                            onChange(
                                "signageDefaultShapeSize",
                                Math.max(24, Math.min(512, +e.target.value || 128)),
                            )
                        }
                        sx={fieldSx}
                        fullWidth
                    />
                </Box>
                <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.25 }}>
                    <FormControl size="small" fullWidth sx={fieldSx}>
                        <InputLabel>Default grid</InputLabel>
                        <Select
                            value={v("signageDefaultGridN")}
                            label="Default grid"
                            onChange={(e) =>
                                onChange("signageDefaultGridN", e.target.value)
                            }>
                            {[2, 4, 8, 16, 32, 64].map((n) => (
                                <MenuItem key={n} value={n}>
                                    {n}×{n}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <FormControl size="small" fullWidth sx={fieldSx}>
                        <InputLabel>Default outline align</InputLabel>
                        <Select
                            value={v("signageDefaultOutlineAlign")}
                            label="Default outline align"
                            onChange={(e) =>
                                onChange("signageDefaultOutlineAlign", e.target.value)
                            }>
                            <MenuItem value="inner">Inner</MenuItem>
                            <MenuItem value="center">Center</MenuItem>
                            <MenuItem value="outer">Outer</MenuItem>
                        </Select>
                    </FormControl>
                </Box>
                <PrefToggle
                    name="Snap to grid by default"
                    description="New designer sessions start with grid snapping enabled"
                    checked={v("signageDefaultSnap")}
                    onChange={(val) => onChange("signageDefaultSnap", val)}
                />
                <PrefToggle
                    name="Outline new shapes"
                    description={`New shapes get an outline (width ${v("signageDefaultOutlineWidth")}) in addition to their fill`}
                    checked={v("signageDefaultOutlineOn")}
                    onChange={(val) => onChange("signageDefaultOutlineOn", val)}
                />
                <PrefToggle
                    name="Show sign backplate"
                    description="Display the standard sign background behind the canvas while designing"
                    checked={v("signageShowBackplate")}
                    onChange={(val) => onChange("signageShowBackplate", val)}
                />
            </Section>

            <Section title="Glow & in-game materials">
                <FormControl size="small" fullWidth sx={fieldSx}>
                    <InputLabel>Glow mode</InputLabel>
                    <Select
                        value={v("signageGlowMode")}
                        label="Glow mode"
                        onChange={(e) => onChange("signageGlowMode", e.target.value)}>
                        <MenuItem value="brightness">
                            By brightness: bright parts glow, dark parts don't
                        </MenuItem>
                        <MenuItem value="shape">
                            Whole shape: everything drawn glows
                        </MenuItem>
                        <MenuItem value="off">Off: no glow</MenuItem>
                    </Select>
                </FormControl>
                <Box sx={{ px: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                        Glow intensity · {v("signageGlowIntensity")}% (100%
                        matches the stock signs)
                    </Typography>
                    <Slider
                        size="small"
                        value={v("signageGlowIntensity")}
                        min={10}
                        max={100}
                        step={5}
                        disabled={v("signageGlowMode") === "off"}
                        onChange={(e, val) =>
                            onChange("signageGlowIntensity", val)
                        }
                    />
                </Box>
                <Box sx={{ px: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                        Texture resolution · {v("signageTextureSize")} px (stock
                        signs are 128. Higher looks crisper up close but takes up more space)
                    </Typography>
                    <Slider
                        size="small"
                        value={v("signageTextureSize")}
                        min={64}
                        max={512}
                        step={null}
                        marks={[64, 128, 256, 512].map((n) => ({
                            value: n,
                            label: `${n}`,
                        }))}
                        onChange={(e, val) => onChange("signageTextureSize", val)}
                    />
                </Box>
            </Section>

            <Section title="Workflow">
                <FormControl size="small" fullWidth sx={fieldSx}>
                    <InputLabel>Clicking a signage icon</InputLabel>
                    <Select
                        value={v("signageIconClickAction")}
                        label="Clicking a signage icon"
                        onChange={(e) =>
                            onChange("signageIconClickAction", e.target.value)
                        }>
                        <MenuItem value="ask">Ask each time</MenuItem>
                        <MenuItem value="upload">Always upload an image</MenuItem>
                        <MenuItem value="designer">Always open the designer</MenuItem>
                    </Select>
                </FormControl>
                <FormControl size="small" fullWidth sx={fieldSx}>
                    <InputLabel>Adding a new signage</InputLabel>
                    <Select
                        value={v("signageAddAction")}
                        label="Adding a new signage"
                        onChange={(e) =>
                            onChange("signageAddAction", e.target.value)
                        }>
                        <MenuItem value="ask">Ask each time</MenuItem>
                        <MenuItem value="upload">Always upload an image</MenuItem>
                        <MenuItem value="designer">Always open the designer</MenuItem>
                    </Select>
                </FormControl>
                <PrefToggle
                    name="Confirm before discarding a design"
                    description="Ask before closing the designer with unsaved changes"
                    checked={v("signageConfirmDiscard")}
                    onChange={(val) => onChange("signageConfirmDiscard", val)}
                />
                <PrefToggle
                    name="Remember last export folder"
                    description="Export PNG / .bpsign dialogs start in the folder you last exported to"
                    checked={v("signageRememberExportDir")}
                    onChange={(val) => onChange("signageRememberExportDir", val)}
                />
            </Section>

            <Section title="Palette & library">
                <Box sx={{ display: "flex", gap: 1 }}>
                    {/* Read-only: clicking picks a folder, the button opens it */}
                    <TextField
                        label="Custom SVG folder"
                        size="small"
                        value={v("signageSvgFolder") || defaultSvgFolder}
                        placeholder="Click to choose a folder"
                        onClick={handleBrowseSvgFolder}
                        helperText="SVGs in this folder show up in the designer palette"
                        InputProps={{ readOnly: true }}
                        sx={{
                            ...fieldSx,
                            "& .MuiInputBase-input": {
                                cursor: "pointer",
                                py: 0,
                                height: "100%",
                                boxSizing: "border-box",
                                display: "flex",
                                alignItems: "center",
                            },
                            "& .MuiInputBase-root": {
                                height: 66,
                                cursor: "pointer",
                            },
                        }}
                        fullWidth
                    />
                    <Tooltip title="Open this folder in Explorer">
                        <Button
                            variant="outlined"
                            size="small"
                            onClick={handleOpenSvgFolder}
                            sx={{ minWidth: 80, height: 66, alignSelf: "flex-start" }}>
                            <FolderOpen sx={{ fontSize: 18 }} />
                        </Button>
                    </Tooltip>
                </Box>
                <FormControl size="small" fullWidth sx={fieldSx}>
                    <InputLabel>Palette sections on open</InputLabel>
                    <Select
                        value={v("signageOpenSections")}
                        label="Palette sections on open"
                        onChange={(e) =>
                            onChange("signageOpenSections", e.target.value)
                        }>
                        <MenuItem value="none">All collapsed</MenuItem>
                        <MenuItem value="all">All expanded</MenuItem>
                    </Select>
                </FormControl>
            </Section>

            <Section title="Naming">
                {/* Changing the ID scheme is a developer-mode affair */}
                {!!values.devMode && (
                    <TextField
                        label="Signage ID prefix"
                        size="small"
                        sx={fieldSx}
                        value={v("signageIdPrefix")}
                        helperText={`New IDs look like ${(v("signageIdPrefix") || "SIGN_BPEE").toUpperCase()}_NAME_1A2B`}
                        onChange={(e) => onChange("signageIdPrefix", e.target.value)}
                        fullWidth
                    />
                )}
                <PrefToggle
                    name="Suggest a name from the design"
                    description="Pre-fill the name of a new signage from its biggest shape"
                    checked={v("signageAutoName")}
                    onChange={(val) => onChange("signageAutoName", val)}
                />
            </Section>
        </Stack>
    )
}

