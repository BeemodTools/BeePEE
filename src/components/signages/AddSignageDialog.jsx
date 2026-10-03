import { useState, useEffect, useRef } from "react"
import {
    Dialog,
    TextField,
    Button,
    Stack,
    Box,
    Typography,
    Alert,
    CircularProgress,
    IconButton,
    Checkbox,
    FormControlLabel,
} from "@mui/material"
import { useTheme } from "@mui/material/styles"
import { ArrowBack, Upload, Brush } from "@mui/icons-material"

const stripExt = (n) =>
    n
        .replace(/\.[^.]+$/, "")
        .replace(/[_-]+/g, " ")
        .trim()

export function ChoiceCard({ title, desc, icon, onClick }) {
    return (
        <Box
            onClick={onClick}
            sx={{
                flex: 1,
                p: "22px 18px",
                borderRadius: 2,
                cursor: "pointer",
                bgcolor: "#232628",
                border: 1,
                borderColor: "divider",
                display: "flex",
                flexDirection: "column",
                gap: 1.25,
                transition: "border-color .12s, transform .12s",
                "&:hover": {
                    borderColor: "primary.main",
                    transform: "translateY(-2px)",
                },
            }}>
            <Box
                sx={{
                    width: 44,
                    height: 44,
                    borderRadius: "9px",
                    bgcolor: "background.default",
                    border: 1,
                    borderColor: "divider",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                }}>
                {icon}
            </Box>
            <Typography fontWeight={700} sx={{ fontSize: 15.5 }}>
                {title}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.5 }}>
                {desc}
            </Typography>
        </Box>
    )
}

// The Add Signage flow: choice step (pick a PNG, or open the Signage
// Designer in its own window), then a confirm step with preview + name for
// the picked-file path. Self-contained header/content/footer.
export function AddSignageFlow({ onClose, onCreated }) {
    const theme = useTheme()
    const gold = theme.palette.primary.main

    // ready = { source: "file", name, fileName, iconPath, preview }
    const [ready, setReady] = useState(null)
    const [isCreating, setIsCreating] = useState(false)
    const [error, setError] = useState(null)
    const [remember, setRemember] = useState(false)
    const autoFired = useRef(false)

    // A remembered choice (signageAddAction setting) skips the question:
    // "designer" opens the designer immediately, "upload" jumps straight to
    // the file picker (the confirm/name step still happens here after).
    useEffect(() => {
        if (autoFired.current) return
        autoFired.current = true
        window.package
            ?.getSetting?.("signageAddAction")
            .then((r) => {
                const action = r?.success ? r.value : null
                if (action === "designer") {
                    window.package.openSignageDesigner()
                    onClose?.()
                } else if (action === "upload") {
                    handlePickFile()
                }
            })
            .catch(() => {})
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const rememberChoice = (action) => {
        if (remember) {
            window.package
                ?.setSetting?.("signageAddAction", action)
                .catch?.(() => {})
        }
    }

    const handlePickFile = async () => {
        setError(null)
        try {
            // Resolves Electron's { canceled, filePaths }, not an array
            const result = await window.electron.showOpenDialog({
                title: "Select Signage Picture",
                filters: [{ name: "Images", extensions: ["png"] }],
                properties: ["openFile"],
            })
            if (!result.canceled && result.filePaths.length > 0) {
                const filePath = result.filePaths[0]
                const fileName = filePath.split(/[\\/]/).pop()
                const preview = await window.package
                    ?.loadFile(filePath)
                    .catch(() => null)
                setReady({
                    source: "file",
                    name: stripExt(fileName) || "New Signage",
                    fileName,
                    iconPath: filePath,
                    preview,
                })
            }
        } catch (err) {
            console.error("Failed to select signage picture:", err)
            setError(`Failed to select the picture: ${err.message}`)
        }
    }

    const handleCreate = async () => {
        setIsCreating(true)
        setError(null)
        try {
            const result = await window.package.createSignage({
                name: ready.name.trim(),
                iconPath: ready.iconPath,
            })
            if (result.success) {
                onCreated?.(result.signageId)
                onClose?.()
            } else {
                setError(result.error || "Failed to create signage")
            }
        } catch (err) {
            console.error(`Failed to create signage "${ready?.name}":`, err)
            setError(err.message || "Failed to create signage")
        } finally {
            setIsCreating(false)
        }
    }

    const sanitizedId = ready
        ? ready.name.trim().replace(/[^a-zA-Z0-9]/g, "").toUpperCase() || "NAME"
        : ""

    return (
        <Box
            sx={{
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                bgcolor: "background.paper",
            }}>
            {/* Header */}
            <Box
                sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    px: 2,
                    py: 1.5,
                    borderBottom: 1,
                    borderColor: "divider",
                }}>
                {ready && (
                    <IconButton
                        size="small"
                        onClick={() => setReady(null)}
                        title="Back"
                        sx={{ ml: -0.5 }}>
                        <ArrowBack fontSize="small" />
                    </IconButton>
                )}
                <Typography variant="h6" fontWeight={600}>
                    {ready ? "Confirm Signage" : "Add Signage"}
                </Typography>
            </Box>

            {/* Content */}
            <Box sx={{ overflow: "auto", p: 2 }}>
                {ready ? (
                    <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start" }}>
                        <Box
                            sx={{
                                width: 96,
                                height: 96,
                                borderRadius: 1,
                                background: "#0f1011",
                                border: 1,
                                borderColor: "divider",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                overflow: "hidden",
                                flexShrink: 0,
                            }}>
                            {ready.preview && (
                                <img
                                    src={ready.preview}
                                    alt=""
                                    style={{
                                        width: "100%",
                                        height: "100%",
                                        objectFit: "contain",
                                    }}
                                />
                            )}
                        </Box>
                        <Stack spacing={1.25} sx={{ flex: 1 }}>
                            <Typography variant="caption" color="text.secondary">
                                Selected file · {ready.fileName}
                            </Typography>
                            <TextField
                                label="Name"
                                value={ready.name}
                                autoFocus
                                size="small"
                                fullWidth
                                onChange={(e) =>
                                    setReady({ ...ready, name: e.target.value })
                                }
                            />
                            <Typography
                                variant="caption"
                                color="text.disabled"
                                sx={{ fontFamily: "ui-monospace, Consolas, monospace" }}>
                                ID: SIGN_BPEE_{sanitizedId}_####
                            </Typography>
                        </Stack>
                    </Box>
                ) : (
                    <>
                        <Box sx={{ display: "flex", gap: 1.75 }}>
                            <ChoiceCard
                                title="Select existing"
                                desc="Choose a PNG from your computer."
                                icon={<Upload sx={{ color: gold, fontSize: 24 }} />}
                                onClick={() => {
                                    rememberChoice("upload")
                                    handlePickFile()
                                }}
                            />
                            <ChoiceCard
                                title="Create your own"
                                desc="Open the drag-and-drop designer to compose a new icon."
                                icon={<Brush sx={{ color: gold, fontSize: 24 }} />}
                                onClick={() => {
                                    rememberChoice("designer")
                                    window.package.openSignageDesigner()
                                    onClose?.()
                                }}
                            />
                        </Box>
                        <FormControlLabel
                            sx={{ mt: 1.5 }}
                            control={
                                <Checkbox
                                    size="small"
                                    checked={remember}
                                    onChange={(e) =>
                                        setRemember(e.target.checked)
                                    }
                                />
                            }
                            label={
                                <Typography
                                    variant="caption"
                                    color="text.secondary">
                                    Remember my choice (change it later in
                                    Settings &gt; Signage)
                                </Typography>
                            }
                        />
                    </>
                )}
                {error && (
                    <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>
                        {error}
                    </Alert>
                )}
            </Box>

            {/* Footer */}
            <Box
                sx={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 1.25,
                    px: 2,
                    py: 1.5,
                    borderTop: 1,
                    borderColor: "divider",
                }}>
                <Button
                    variant="outlined"
                    onClick={onClose}
                    disabled={isCreating}
                    sx={{ minWidth: 80 }}>
                    Cancel
                </Button>
                <Button
                    variant="contained"
                    disabled={!ready || !ready.name.trim() || isCreating}
                    onClick={handleCreate}
                    startIcon={
                        isCreating ? (
                            <CircularProgress size={16} color="inherit" />
                        ) : null
                    }
                    sx={{ minWidth: 80 }}>
                    {isCreating ? "Adding..." : "Add"}
                </Button>
            </Box>

        </Box>
    )
}

// Dialog wrapper - used by the design system previews and anywhere the
// flow should appear as an in-window modal rather than its own window.
function AddSignageDialog({ open, onClose, onCreated }) {
    // Remount the flow (resetting its state) each time the dialog opens
    const [seq, setSeq] = useState(0)
    useEffect(() => {
        if (open) setSeq((s) => s + 1)
    }, [open])

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <AddSignageFlow key={seq} onClose={onClose} onCreated={onCreated} />
        </Dialog>
    )
}

export default AddSignageDialog
