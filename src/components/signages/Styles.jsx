import { useState, useEffect } from "react"
import {
    Typography,
    IconButton,
    Box,
    Tooltip,
    Button,
    Stack,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Autocomplete,
    TextField,
    Chip,
    Menu,
    MenuItem,
    ListItemIcon,
    ListItemText,
    Divider,
    FormControlLabel,
    Checkbox,
} from "@mui/material"
import { useTheme } from "@mui/material/styles"
import { ChoiceCard } from "./AddSignageDialog"
import {
    Delete,
    Add,
    Upload,
    Brush,
    Link as LinkIcon,
    LinkOff,
    MoreVert,
    ChevronRight,
} from "@mui/icons-material"

// Style IDs shipped with BEEmod (the part after the colon in its
// "GROUP:STYLE" ids). Custom IDs can be added through the + tile.
const STYLE_CATALOG = [
    ["BEE2_CLEAN", "Clean"],
    ["BEE2_CLEAN_ORIGINAL", "Clean Original"],
    ["BEE2_PORTAL_1", "Portal 1"],
    ["BEE2_BTS", "BTS"],
    ["BEE2_OVERGROWN", "Overgrown"],
    ["BEE2_1950S", "1950s"],
    ["BEE2_1960S", "1960s"],
    ["BEE2_1970S", "1970s"],
    ["BEE2_1980S", "1980s"],
]
// Friendly display name: catalog label when known, otherwise a prettified
// version of the ID ("BEE2_MY_STYLE" -> "My Style"). Tooltips keep the
// exact ID.
export const styleDisplayName = (id) => {
    const known = STYLE_CATALOG.find(([cid]) => cid === id)
    if (known) return known[1]
    return String(id)
        .replace(/^BEE2_/, "")
        .split("_")
        .filter(Boolean)
        .map((w) => w[0] + w.slice(1).toLowerCase())
        .join(" ")
}
const catalogLabel = styleDisplayName

// The designer composes on the CLEAN backplate, which also fits Clean
// Original and Portal 1 - other styles use uploaded images.
const DESIGNER_STYLES = ["BEE2_CLEAN", "BEE2_CLEAN_ORIGINAL", "BEE2_PORTAL_1"]
const designerSupports = (id) => DESIGNER_STYLES.includes(id)

// Follows inheritance strings ("BEE2_1980S": "BEE2_CLEAN") to the actual
// icon config; depth-capped against cycles.
const resolveStyleConfig = (styles, id, depth = 0) => {
    const cfg = styles?.[id]
    if (typeof cfg === "string" && depth < 5)
        return resolveStyleConfig(styles, cfg, depth + 1)
    return cfg && typeof cfg === "object" ? cfg : null
}

// True when making `styleId` inherit from `targetId` would create a cycle
const wouldCycle = (styles, styleId, targetId) => {
    let cur = targetId
    for (let i = 0; i < 6 && typeof cur === "string"; i++) {
        if (cur === styleId) return true
        cur = styles?.[cur]
    }
    return false
}

// One style tile in the grid
function StyleTile({
    styleId,
    styles,
    stagedIcon,
    onUpload,
    onDropFile,
    onInherit,
    onClear,
    onRemove,
    onEditDesign,
}) {
    // Clean is BEE2's fallback anchor - always the default, not removable
    const isDefault = styleId === "BEE2_CLEAN"
    const theme = useTheme()
    const gold = theme.palette.primary.main
    const cfg = styles[styleId]
    const exists = cfg !== undefined
    const isInherit = typeof cfg === "string"
    const effective = resolveStyleConfig(styles, styleId)
    const [preview, setPreview] = useState(null)
    const [menuAnchor, setMenuAnchor] = useState(null)
    const [choiceOpen, setChoiceOpen] = useState(false)
    const [rememberChoice, setRememberChoice] = useState(false)
    const [inheritAnchor, setInheritAnchor] = useState(null)
    const [dropHover, setDropHover] = useState(false)

    useEffect(() => {
        const icon = effective?.icon
        if (icon && (icon.includes("/") || icon.includes("\\"))) {
            window.package
                ?.loadFile(icon)
                .then(setPreview)
                .catch(() => setPreview(null))
        } else {
            setPreview(null)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cfg, styles])

    const shown = stagedIcon || preview
    const inheritTargets = Object.keys(styles).filter(
        (id) => id !== styleId && !wouldCycle(styles, styleId, id),
    )

    return (
        <Box
            onDragOver={(e) => {
                e.preventDefault()
                setDropHover(true)
            }}
            onDragLeave={() => setDropHover(false)}
            onDrop={(e) => {
                e.preventDefault()
                setDropHover(false)
                const file = e.dataTransfer.files?.[0]
                if (file) onDropFile(styleId, file)
            }}
            sx={{
                position: "relative",
                border: "2px dashed",
                borderColor: dropHover
                    ? "primary.main"
                    : isDefault
                      ? "primary.dark"
                      : exists
                        ? "divider"
                        : "action.disabledBackground",
                borderStyle: exists ? "solid" : "dashed",
                borderWidth: exists ? 1 : 2,
                borderRadius: 2,
                bgcolor: "background.paper",
                p: 1.5,
                pt: 2,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 0.75,
                minWidth: 0,
                transition: "border-color .12s, transform .12s",
                "&:hover": { borderColor: "text.secondary" },
            }}>
            {/* tile menu */}
            <IconButton
                size="small"
                onClick={(e) => setMenuAnchor(e.currentTarget)}
                sx={{ position: "absolute", top: 2, right: 2, p: 0.25 }}>
                <MoreVert sx={{ fontSize: 16 }} />
            </IconButton>

            {/* icon area - click = upload */}
            <Tooltip
                title={
                    stagedIcon
                        ? "New design pending - press Save to apply"
                        : isInherit
                          ? `Uses ${cfg}'s icon - click to give it its own`
                          : shown
                            ? "Click to change (or drop a PNG)"
                            : "Click to set an image (or drop a PNG)"
                }>
                <Box
                    onClick={async () => {
                        // Designer-capable styles honor the click preference
                        // (ask / upload / designer); others upload directly
                        if (!designerSupports(styleId) || !onEditDesign) {
                            onUpload(styleId)
                            return
                        }
                        let action = "ask"
                        try {
                            const r = await window.package?.getSetting?.(
                                "signageIconClickAction",
                            )
                            if (r?.success && r.value) action = r.value
                        } catch {
                            /* default to asking */
                        }
                        if (action === "upload") onUpload(styleId)
                        else if (action === "designer") onEditDesign(styleId)
                        else setChoiceOpen(true)
                    }}
                    sx={{
                        width: 96,
                        height: 96,
                        borderRadius: 1,
                        bgcolor: "background.default",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        overflow: "hidden",
                        cursor: "pointer",
                        "&:hover": { outline: "2px solid", outlineColor: "primary.main" },
                    }}>
                    {shown ? (
                        <img
                            src={shown}
                            alt=""
                            style={{ width: "100%", height: "100%", objectFit: "contain" }}
                        />
                    ) : (
                        <Add sx={{ fontSize: 28, color: "text.disabled" }} />
                    )}
                </Box>
            </Tooltip>

            <Tooltip title={styleId}>
                <Typography
                    variant="body2"
                    noWrap
                    sx={{ maxWidth: "100%", fontWeight: 600, mt: 0.25 }}>
                    {catalogLabel(styleId)}
                </Typography>
            </Tooltip>

            {/* state badge */}
            {stagedIcon ? (
                <Chip
                    label="pending save"
                    size="small"
                    color="primary"
                    variant="outlined"
                    sx={{ height: 20, fontSize: 11 }}
                />
            ) : isDefault ? (
                <Tooltip title="The default: styles without their own entry fall back to Clean's icon">
                    <Chip
                        label="default"
                        size="small"
                        color="primary"
                        variant="outlined"
                        sx={{ height: 20, fontSize: 11 }}
                    />
                </Tooltip>
            ) : isInherit ? (
                <Tooltip title={`Uses ${cfg}'s icon`}>
                    <Chip
                        icon={<LinkIcon sx={{ fontSize: 13 }} />}
                        label={`Uses ${catalogLabel(cfg)}`}
                        size="small"
                        variant="outlined"
                        sx={{ height: 20, fontSize: 11, maxWidth: "100%" }}
                    />
                </Tooltip>
            ) : (
                <Typography variant="caption" sx={{ color: "text.disabled" }}>
                    {shown ? "own image" : "not set"}
                </Typography>
            )}

            <Menu
                anchorEl={menuAnchor}
                open={!!menuAnchor}
                onClose={() => setMenuAnchor(null)}>
                <MenuItem
                    onClick={() => {
                        setMenuAnchor(null)
                        onUpload(styleId)
                    }}>
                    <ListItemIcon>
                        <Upload fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>Upload image…</ListItemText>
                </MenuItem>
                {designerSupports(styleId) && onEditDesign && (
                    <MenuItem
                        onClick={() => {
                            setMenuAnchor(null)
                            onEditDesign(styleId)
                        }}>
                        <ListItemIcon>
                            <Brush fontSize="small" />
                        </ListItemIcon>
                        <ListItemText>Edit in Designer</ListItemText>
                    </MenuItem>
                )}
                {/* the default (Clean) must keep its own icon - it's what
                    everything else falls back to */}
                {!isDefault && (
                    <MenuItem
                        disabled={!inheritTargets.length}
                        onClick={(e) => setInheritAnchor(e.currentTarget)}>
                        <ListItemIcon>
                            <LinkIcon fontSize="small" />
                        </ListItemIcon>
                        <ListItemText>Use another style's icon</ListItemText>
                        <ChevronRight fontSize="small" />
                    </MenuItem>
                )}
                {isInherit && (
                    <MenuItem
                        onClick={() => {
                            setMenuAnchor(null)
                            onClear(styleId)
                        }}>
                        <ListItemIcon>
                            <LinkOff fontSize="small" />
                        </ListItemIcon>
                        <ListItemText>Stop inheriting</ListItemText>
                    </MenuItem>
                )}
                {exists && !isDefault && [
                    <Divider key="d" />,
                    <MenuItem
                        key="rm"
                        onClick={() => {
                            setMenuAnchor(null)
                            onRemove(styleId)
                        }}>
                        <ListItemIcon>
                            <Delete fontSize="small" color="error" />
                        </ListItemIcon>
                        <ListItemText sx={{ color: "error.main" }}>
                            Remove from signage
                        </ListItemText>
                    </MenuItem>,
                ]}
            </Menu>
            <Menu
                anchorEl={inheritAnchor}
                open={!!inheritAnchor}
                onClose={() => setInheritAnchor(null)}
                anchorOrigin={{ vertical: "top", horizontal: "right" }}>
                {inheritTargets.map((id) => (
                    <Tooltip key={id} title={id} placement="left">
                        <MenuItem
                            onClick={() => {
                                setInheritAnchor(null)
                                setMenuAnchor(null)
                                onInherit(styleId, id)
                            }}>
                            {catalogLabel(id)}
                        </MenuItem>
                    </Tooltip>
                ))}
            </Menu>

            {/* Upload vs Designer - same picker as the Add Signage flow */}
            <Dialog
                open={choiceOpen}
                onClose={() => setChoiceOpen(false)}
                maxWidth="sm"
                fullWidth>
                <DialogTitle>Change signage icon</DialogTitle>
                <DialogContent>
                    <Box sx={{ display: "flex", gap: 1.75, pt: 0.5 }}>
                        <ChoiceCard
                            title="Select existing"
                            desc="Choose a PNG from your computer."
                            icon={<Upload sx={{ color: gold, fontSize: 24 }} />}
                            onClick={() => {
                                if (rememberChoice)
                                    window.package
                                        ?.setSetting?.(
                                            "signageIconClickAction",
                                            "upload",
                                        )
                                        .catch?.(() => {})
                                setChoiceOpen(false)
                                onUpload(styleId)
                            }}
                        />
                        <ChoiceCard
                            title="Edit in Designer"
                            desc="Open the drag-and-drop designer to edit this icon."
                            icon={<Brush sx={{ color: gold, fontSize: 24 }} />}
                            onClick={() => {
                                if (rememberChoice)
                                    window.package
                                        ?.setSetting?.(
                                            "signageIconClickAction",
                                            "designer",
                                        )
                                        .catch?.(() => {})
                                setChoiceOpen(false)
                                onEditDesign(styleId)
                            }}
                        />
                    </Box>
                    <FormControlLabel
                        sx={{ mt: 1.5 }}
                        control={
                            <Checkbox
                                size="small"
                                checked={rememberChoice}
                                onChange={(e) =>
                                    setRememberChoice(e.target.checked)
                                }
                            />
                        }
                        label={
                            <Typography variant="caption" color="text.secondary">
                                Remember my choice (change it later in
                                Settings &gt; Signage)
                            </Typography>
                        }
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setChoiceOpen(false)}>Cancel</Button>
                </DialogActions>
            </Dialog>
        </Box>
    )
}

// + tile dialog: pick a BEE2 style or type a custom ID
function CustomStyleDialog({ open, usedStyleIds, onAdd, onClose }) {
    const [input, setInput] = useState("")
    useEffect(() => {
        if (open) setInput("")
    }, [open])

    // Map the text back to a style ID: matches a catalog name or ID first
    // ("clean original" -> BEE2_CLEAN_ORIGINAL), also the old "Name (ID)"
    // label format, otherwise normalizes it as a custom ID.
    const trimmed = input.trim().replace(/^(.+?)\s*\((BEE2_[A-Z0-9_]+)\)$/i, "$2")
    const known = STYLE_CATALOG.find(
        ([id, label]) =>
            label.toLowerCase() === trimmed.toLowerCase() ||
            id.toLowerCase() === trimmed.toLowerCase(),
    )
    const normalized = known
        ? known[0]
        : trimmed
              .toUpperCase()
              .replace(/[^A-Z0-9_]+/g, "_")
              .replace(/^_+|_+$/g, "")
    const alreadyUsed = usedStyleIds.includes(normalized)

    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle>Add Style</DialogTitle>
            <DialogContent>
                <Stack spacing={1.5} sx={{ pt: 0.5 }}>
                    <Autocomplete
                        freeSolo
                        options={STYLE_CATALOG.map(([id]) => id).filter(
                            (id) => !usedStyleIds.includes(id),
                        )}
                        getOptionLabel={(id) => styleDisplayName(id)}
                        inputValue={input}
                        onInputChange={(e, value) => setInput(value)}
                        renderInput={(params) => (
                            <TextField
                                {...params}
                                label="Style"
                                size="small"
                                autoFocus
                                placeholder="Pick one, or type a custom ID"
                                helperText={
                                    alreadyUsed
                                        ? "That style is already on this signage"
                                        : normalized && !known
                                          ? `Will be added as ${normalized}`
                                          : " "
                                }
                                error={alreadyUsed}
                            />
                        )}
                    />
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button variant="outlined" onClick={onClose} sx={{ minWidth: 80 }}>
                    Cancel
                </Button>
                <Button
                    variant="contained"
                    disabled={!normalized || alreadyUsed}
                    onClick={() => onAdd(normalized)}
                    sx={{ minWidth: 80 }}>
                    Add
                </Button>
            </DialogActions>
        </Dialog>
    )
}

// Icons tab: a grid covering every BEE2 style (plus any custom ones on the
// signage). Empty tiles are set with one click or a PNG drop - no add-dialog
// dance. Designer work lives in the separate Designs tab.
function SignageStyles({
    formData,
    onUpdate,
    onEditDesign,
    stagedDesign,
    hasDesign,
    onDropDesign,
    onError,
}) {
    const styles = formData.styles || {}
    const [customDialogOpen, setCustomDialogOpen] = useState(false)

    // Repair IDs mangled by the old add dialog, where picking
    // "Portal 1 (BEE2_PORTAL_1)" saved as PORTAL_1_BEE2_PORTAL_1 - an ID
    // BEE2 would never match. Rename them to the embedded catalog ID.
    useEffect(() => {
        let changed = false
        const next = {}
        for (const [id, cfg] of Object.entries(styles)) {
            const m = /^(.+)_(BEE2_[A-Z0-9_]+)$/.exec(id)
            const target =
                m &&
                m[2] === `BEE2_${m[1]}` &&
                STYLE_CATALOG.some(([cid]) => cid === m[2])
                    ? m[2]
                    : null
            if (target && styles[target] === undefined) {
                next[target] = cfg
                changed = true
            } else {
                next[id] = cfg
            }
        }
        if (changed) onUpdate("styles", next)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [styles])

    const patchStyle = (styleId, patch) => {
        const current = styles[styleId]
        const currentStyle =
            current && typeof current === "object" ? current : {}
        onUpdate("styles", {
            ...styles,
            [styleId]: { ...currentStyle, ...patch },
        })
    }

    // A picture for a style whose icon was made in the designer replaces
    // that design (it goes when the signage is saved): ask first
    const replacesDesign = async (styleId) => {
        if (!hasDesign?.(styleId)) return true
        const answer = await window.electron.showMessageBox({
            type: "warning",
            buttons: ["Use the Picture", "Cancel"],
            defaultId: 1,
            cancelId: 1,
            title: "Replace the Design?",
            message: `The ${catalogLabel(styleId)} icon was made in the Signage Designer.`,
            detail: "Using a picture instead replaces its design when you save. The designer will start from the picture.",
        })
        if (answer?.response !== 0) return false
        onDropDesign?.(styleId)
        return true
    }

    const pickIcon = async (styleId, filePath) => {
        if (!(await replacesDesign(styleId))) return
        patchStyle(styleId, { icon: filePath, _stagedIconPath: filePath })
    }

    const handleUpload = async (styleId) => {
        try {
            // Resolves Electron's { canceled, filePaths }, not an array
            const result = await window.electron.showOpenDialog({
                title: "Select Signage Icon",
                filters: [{ name: "Images", extensions: ["png"] }],
                properties: ["openFile"],
            })
            if (!result.canceled && result.filePaths.length > 0) {
                await pickIcon(styleId, result.filePaths[0])
            }
        } catch (error) {
            console.error(`Failed to select icon for style ${styleId}:`, error)
            onError?.(`Failed to select the icon: ${error.message}`)
        }
    }

    const handleDropFile = (styleId, file) => {
        if (!/\.png$/i.test(file.name)) {
            console.warn(`Ignored dropped file "${file.name}": not a PNG`)
            onError?.(
                `"${file.name}" isn't a PNG. Signage icons must be PNG images.`,
            )
            return
        }
        // File.path was removed in Electron 32, the preload looks it up
        const filePath = window.electron?.getPathForFile?.(file)
        if (!filePath) {
            console.warn(`Ignored dropped file "${file.name}": no path on disk`)
            onError?.(
                `Couldn't find "${file.name}" on disk. Save it to your computer first, then drop it here.`,
            )
            return
        }
        pickIcon(styleId, filePath).catch((error) => {
            console.error(`Failed to set the icon of style ${styleId}:`, error)
            onError?.(`Failed to set the icon: ${error.message}`)
        })
    }

    const handleInherit = (styleId, targetId) => {
        onUpdate("styles", { ...styles, [styleId]: targetId })
    }

    const handleClear = (styleId) => {
        onUpdate("styles", { ...styles, [styleId]: { icon: "" } })
    }

    const handleRemove = (styleId) => {
        const { [styleId]: _removed, ...rest } = styles
        onUpdate("styles", rest)
    }

    // Only styles that exist on the signage (default: just Clean) -
    // catalog order first, then custom entries. Others are added explicitly
    // through the + tile.
    const tileIds = [
        ...STYLE_CATALOG.map(([id]) => id).filter(
            (id) => styles[id] !== undefined,
        ),
        ...Object.keys(styles).filter(
            (id) => !STYLE_CATALOG.some(([cid]) => cid === id),
        ),
    ]

    return (
        <Box>
            <Box
                sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    mb: 2,
                }}>
                <Typography variant="h6">Signage Icons</Typography>
            </Box>

            <Box
                sx={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                    gap: 2,
                }}>
                {tileIds.map((id) => (
                    <StyleTile
                        key={id}
                        styleId={id}
                        styles={styles}
                        stagedIcon={
                            stagedDesign &&
                            (stagedDesign.styleId || "BEE2_CLEAN") === id
                                ? stagedDesign.iconData
                                : null
                        }
                        onUpload={handleUpload}
                        onDropFile={handleDropFile}
                        onInherit={handleInherit}
                        onClear={handleClear}
                        onRemove={handleRemove}
                        onEditDesign={onEditDesign}
                    />
                ))}

                {/* + custom style tile */}
                <Box
                    onClick={() => setCustomDialogOpen(true)}
                    sx={{
                        border: "2px dashed",
                        borderColor: "action.disabledBackground",
                        borderRadius: 2,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 0.75,
                        p: 1.5,
                        minHeight: 176,
                        cursor: "pointer",
                        color: "text.disabled",
                        "&:hover": {
                            borderColor: "primary.main",
                            color: "primary.main",
                        },
                    }}>
                    <Add sx={{ fontSize: 24 }} />
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>
                        Add style
                    </Typography>
                </Box>
            </Box>

            <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mt: 2 }}>
                Clean is the default: styles you don't add fall back to its
                icon in BEE2. Click a tile to set its image, or drop a PNG
                onto it. The ⋮ menu links a style to another style's icon or
                opens the designer (Clean-plate styles).
            </Typography>

            <CustomStyleDialog
                open={customDialogOpen}
                usedStyleIds={Object.keys(styles)}
                onAdd={(id) => {
                    handleClear(id) // creates the entry
                    setCustomDialogOpen(false)
                }}
                onClose={() => setCustomDialogOpen(false)}
            />
        </Box>
    )
}

export default SignageStyles
