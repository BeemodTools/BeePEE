import { useEffect, useState } from "react"
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    Button,
    Stack,
    Box,
    Typography,
    Alert,
    CircularProgress,
} from "@mui/material"
import SignageDesigner from "../components/signages/SignageDesigner"
import {
    LayersThumb,
    SHAPES,
    rasterizeLayers,
    rasterizeSignageTextures,
    serializeDesign,
    rehydrateDesign,
} from "../components/signages/glyphs"
import { loadSignagePrefs } from "../components/signages/SignagePreferences"
import { styleDisplayName } from "../components/signages/Styles"

// Dedicated window for the Signage Designer (?route=signage-designer).
// Opens blank for a new signage, or loaded with an existing design when
// launched via "Edit in Designer" (load-signage-design event). The name is
// asked only on save; Create/Save rasterizes to a 512x512 PNG and creates
// or updates the signage - on success the backend closes this window.
function SignageDesignerPage() {
    const [pendingLayers, setPendingLayers] = useState(null)
    const [name, setName] = useState("")
    const [isCreating, setIsCreating] = useState(false)
    const [error, setError] = useState(null)

    // Edit mode (set when a design is loaded in)
    const [editId, setEditId] = useState(null)
    const [editStyle, setEditStyle] = useState(null) // style whose icon is edited
    const [initialLayers, setInitialLayers] = useState([])
    const [designKey, setDesignKey] = useState(0) // bump to remount designer

    useEffect(() => {
        document.title = "BeePEE - Signage Designer"

        window.package?.onLoadSignageDesign?.((payload) => {
            if (!payload) return
            try {
                // No stored design (e.g. a fresh non-Clean style) starts blank
                const layers = payload.design
                    ? rehydrateDesign(payload.design)
                    : []
                setInitialLayers(layers)
                setEditId(payload.editId || null)
                setEditStyle(payload.styleId || null)
                setName(payload.name || "")
                setDesignKey((k) => k + 1)
                if (payload.editId) {
                    const styleTag =
                        payload.styleId && payload.styleId !== "BEE2_CLEAN"
                            ? ` (${styleDisplayName(payload.styleId)})`
                            : ""
                    document.title = `Edit Signage: ${payload.name || payload.editId}${styleTag}`
                }
                console.log(
                    `Loaded design for signage "${payload.name || payload.editId}" (${payload.styleId || "BEE2_CLEAN"}, ${layers.length} layers)`,
                )
            } catch (err) {
                console.error(
                    `Failed to load design for signage "${payload.name || payload.editId}":`,
                    err,
                )
            }
        })
        return () => window.package?.onLoadSignageDesign?.(null)
    }, [])

    const handleSave = async ({ layers }) => {
        setError(null)
        // Editing an existing signage - the name is already known, so save
        // straight away instead of redundantly re-prompting for it.
        if (editId && name.trim()) {
            handleCreate(layers)
            return
        }
        // New signage: optionally suggest a name from the biggest shape
        if (!name.trim()) {
            try {
                const prefs = await loadSignagePrefs()
                if (prefs.signageAutoName && layers.length) {
                    const biggest = layers.reduce((a, b) =>
                        b.w * b.h > a.w * a.h ? b : a,
                    )
                    const label = SHAPES[biggest.glyph]?.label
                    if (label) setName(label)
                }
            } catch {
                /* name suggestion is best-effort */
            }
        }
        setPendingLayers(layers)
    }

    const handleCreate = async (layersArg) => {
        const layers = layersArg || pendingLayers
        if (!layers) return
        setIsCreating(true)
        setError(null)
        try {
            const prefs = await loadSignagePrefs()
            const iconData = await rasterizeLayers(layers)
            const tex = await rasterizeSignageTextures(
                layers,
                prefs.signageTextureSize || 512,
                { glowMode: prefs.signageGlowMode },
            )
            const materialData = tex.base
            const maskData = tex.mask
            const hasGlow = tex.hasGlow
            const payload = {
                name: name.trim(),
                iconData,
                materialData,
                maskData,
                materialOptions: {
                    glowIntensity: prefs.signageGlowIntensity,
                    glow: hasGlow,
                },
                design: serializeDesign(layers),
                editId: editId || undefined,
                styleId: (editId && editStyle) || undefined,
            }
            console.log(
                editId
                    ? `Sending design for signage "${payload.name}" to its editor (${payload.styleId || "BEE2_CLEAN"}, ${layers.length} layers)`
                    : `Creating signage "${payload.name}" from the designer (${layers.length} layers)`,
            )
            // Edits are STAGED into the signage editor window - its Save
            // button performs the real commit. Only brand-new signage is
            // created directly (there's no editor to stage into yet).
            const result = editId
                ? await window.package.stageSignageDesign(payload)
                : await window.package.createSignage(payload)
            if (!result.success) {
                setError(result.error || "Failed to save signage")
                // Surface the error dialog if we skipped it (edit mode)
                setPendingLayers(layers)
            }
            // On success the backend closes this window
        } catch (err) {
            console.error(
                `Failed to save signage design "${name.trim()}":`,
                err,
            )
            setError(err.message || "Failed to save signage")
            setPendingLayers(layers)
        } finally {
            setIsCreating(false)
        }
    }

    const sanitizedId =
        name.trim().replace(/[^a-zA-Z0-9]/g, "").toUpperCase() || "NAME"

    return (
        <>
            <SignageDesigner
                key={designKey}
                initialLayers={initialLayers}
                saveLabel={editId ? "Save Changes" : "Save Signage"}
                name={name}
                onCancel={() => window.close()}
                onSave={handleSave}
                isSaving={isCreating || !!pendingLayers}
            />

            {/* Name prompt - asked when the design is saved */}
            <Dialog
                open={!!pendingLayers}
                onClose={() => !isCreating && setPendingLayers(null)}
                maxWidth="xs"
                fullWidth>
                <DialogTitle>
                    {editId ? "Save Signage" : "Name Your Signage"}
                </DialogTitle>
                <DialogContent>
                    <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start", pt: 0.5 }}>
                        <Box
                            sx={{
                                p: 0.75,
                                bgcolor: "background.default",
                                border: 1,
                                borderColor: "divider",
                                borderRadius: 1,
                                flexShrink: 0,
                            }}>
                            <LayersThumb
                                layers={pendingLayers || []}
                                size={88}
                            />
                        </Box>
                        <Stack spacing={1.25} sx={{ flex: 1 }}>
                            <TextField
                                label="Name"
                                value={name}
                                autoFocus
                                size="small"
                                fullWidth
                                placeholder="e.g. Reflection Cube"
                                onChange={(e) => setName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && name.trim() && !isCreating) {
                                        handleCreate()
                                    }
                                }}
                            />
                            <Typography
                                variant="caption"
                                color="text.disabled"
                                sx={{ fontFamily: "ui-monospace, Consolas, monospace" }}>
                                {editId ? `ID: ${editId}` : `ID: SIGN_BPEE_${sanitizedId}_####`}
                            </Typography>
                        </Stack>
                    </Box>
                    {error && (
                        <Alert
                            severity="error"
                            sx={{ mt: 2 }}
                            onClose={() => setError(null)}>
                            {error}
                        </Alert>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button
                        variant="outlined"
                        onClick={() => setPendingLayers(null)}
                        disabled={isCreating}
                        sx={{ minWidth: 80 }}>
                        Back
                    </Button>
                    <Button
                        variant="contained"
                        disabled={!name.trim() || isCreating}
                        onClick={() => handleCreate()}
                        startIcon={
                            isCreating ? (
                                <CircularProgress size={16} color="inherit" />
                            ) : null
                        }
                        sx={{ minWidth: 80 }}>
                        {isCreating
                            ? "Saving..."
                            : editId
                              ? "Save"
                              : "Create"}
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    )
}

export default SignageDesignerPage
