import { useState, useEffect } from "react"
import {
    Box,
    Tabs,
    Tab,
    Button,
    IconButton,
    Stack,
    Alert,
    CircularProgress,
    Tooltip,
    Badge,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
} from "@mui/material"
import {
    Info as InfoIcon,
    Palette as PaletteIcon,
    Save,
    Close,
    CheckCircle,
    Undo,
    Redo,
    Delete,
} from "@mui/icons-material"
import { useSignageContext } from "../contexts/SignageContext"
import SignageInfo from "./signages/Info"
import SignageStyles from "./signages/Styles"

// The icon file a style shows: its own, the one of the style it inherits
// from ("BEE2_1980S": "BEE2_CLEAN"), else Clean's. "" when it's no file
const shownIcon = (styles, styleId) => {
    let cfg = styles?.[styleId]
    for (let i = 0; i < 5 && typeof cfg === "string"; i++) cfg = styles?.[cfg]
    let icon = cfg && typeof cfg === "object" ? cfg.icon : ""
    if (!icon) {
        const clean = styles?.BEE2_CLEAN
        icon = clean && typeof clean === "object" ? clean.icon : ""
    }
    return icon && /[\\/]/.test(icon) ? icon : ""
}

function SignageEditor() {
    const { signage } = useSignageContext()
    const [tabValue, setTabValue] = useState(0)
    const [formData, setFormData] = useState({
        id: "",
        name: "",
        hidden: false,
        secondary: "",
        styles: {},
    })
    const [availableSignages, setAvailableSignages] = useState([])
    const [showIds, setShowIds] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const [saveError, setSaveError] = useState(null)
    const [showSaveSuccess, setShowSaveSuccess] = useState(false)
    const [hasChanges, setHasChanges] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [discardDialogOpen, setDiscardDialogOpen] = useState(false)
    const [skipDeleteConfirmations, setSkipDeleteConfirmations] =
        useState(false)
    // Form-level undo/redo (snapshots of formData)
    const [undoStack, setUndoStack] = useState([])
    const [redoStack, setRedoStack] = useState([])
    // The editable design source, present only for BeePEE-designed signage
    const [design, setDesign] = useState(null)
    // The styles whose icon has a design of its own (Clean's is `design`)
    const [designedStyles, setDesignedStyles] = useState(new Set())
    // A designer save waiting for THIS editor's Save button to commit it
    const [stagedDesign, setStagedDesign] = useState(null)

    useEffect(() => {
        window.package?.onSignageDesignStaged?.((payload) => {
            if (!payload) return
            setStagedDesign(payload)
            setSaveError(null)
        })
        return () => window.package?.onSignageDesignStaged?.(null)
    }, [])

    // Fetch available signages for dropdown
    useEffect(() => {
        const fetchSignages = async () => {
            try {
                const signages = await window.package.getCurrentSignages?.()
                if (signages) {
                    setAvailableSignages(signages)
                }
            } catch (error) {
                console.warn("Failed to fetch signages:", error)
            }
        }
        fetchSignages()

        // Load showItemIds setting (also controls signage ID visibility)
        const loadShowIdsSetting = async () => {
            try {
                const result = await window.package.getSetting("showItemIds")
                if (result.success && result.value !== undefined) {
                    setShowIds(result.value)
                }
            } catch (error) {
                console.warn("Failed to load showItemIds setting:", error)
            }
        }
        loadShowIdsSetting()

        // Same global setting the item editor honors
        window.package
            ?.getSetting("skipDeleteConfirmations")
            .then((result) => {
                if (result.success && result.value !== undefined) {
                    setSkipDeleteConfirmations(result.value)
                }
            })
            .catch(() => {})
    }, [])

    // "*" in the window title while there are unsaved changes (form edits
    // or a staged designer save)
    useEffect(() => {
        if (!signage) return
        const dirty = hasChanges || !!stagedDesign
        document.title = `${dirty ? "*" : ""}Edit Signage: ${signage.name || signage.id}`
    }, [signage, hasChanges, stagedDesign])

    // Initialize form from signage
    useEffect(() => {
        if (signage) {
            document.title = `Edit Signage: ${signage.name || signage.id}`
            setFormData({
                id: signage.id || "",
                name: signage.name || "",
                hidden: signage.hidden || false,
                secondary: signage.secondary || "",
                styles: signage.styles || {},
            })
            setHasChanges(false)

            // Check whether this signage was made with the BeePEE designer
            window.package
                ?.getSignageDesign?.(signage.id)
                .then((result) => {
                    setDesign(result?.success ? result.design : null)
                })
                .catch(() => setDesign(null))

            // And which of its styles have a design (picking a picture for
            // one replaces it)
            const styleIds = [
                ...new Set(["BEE2_CLEAN", ...Object.keys(signage.styles || {})]),
            ]
            Promise.all(
                styleIds.map(async (styleId) => {
                    const result = await window.package?.getSignageDesign?.(
                        signage.id,
                        styleId,
                    )
                    return result?.success && result.design ? styleId : null
                }),
            )
                .then((ids) => setDesignedStyles(new Set(ids.filter(Boolean))))
                .catch(() => setDesignedStyles(new Set()))
        }
    }, [signage])

    // Whether a style's icon is a design (saved, or staged by the designer)
    const hasDesign = (styleId) =>
        designedStyles.has(styleId) ||
        (!!stagedDesign &&
            (stagedDesign.styleId || "BEE2_CLEAN") === styleId)

    // A picture was picked for a style: a designer save staged for it is
    // dropped (the saved design goes when the signage is saved)
    const dropStagedDesign = (styleId) => {
        if (
            stagedDesign &&
            (stagedDesign.styleId || "BEE2_CLEAN") === styleId
        ) {
            setStagedDesign(null)
        }
    }

    // Open the designer for a specific style's icon: with its design, or for
    // a picture (an uploaded PNG, no design), with that picture to draw on.
    // Non-Clean styles with neither a design nor a picture of their own
    // start from the Clean design. The styleId rides along so saving writes
    // back to the right style instead of clobbering Clean.
    const handleEditDesign = async (styleId) => {
        const style = styleId || "BEE2_CLEAN"
        const own = formData.styles?.[style]
        const ownIcon = own && typeof own === "object" ? own.icon : ""
        let styleDesign = null
        // An uncommitted staged design for this style is the latest version
        if (
            stagedDesign &&
            (stagedDesign.styleId || "BEE2_CLEAN") === style
        ) {
            styleDesign = stagedDesign.design
        } else if (own?._stagedIconPath) {
            // A picture picked since the last save replaces its design
        } else if (style === "BEE2_CLEAN") {
            styleDesign = design
        } else {
            try {
                const result = await window.package.getSignageDesign(
                    signage.id,
                    style,
                )
                if (result?.success && result.design) {
                    styleDesign = result.design
                }
            } catch {
                /* fall back to the Clean design */
            }
            if (!styleDesign && !ownIcon) styleDesign = design
        }

        // No design: the picture the style shows
        let image = null
        if (!styleDesign) {
            const icon = shownIcon(formData.styles, style)
            if (icon) {
                try {
                    image = await window.package.loadFile(icon)
                } catch (error) {
                    console.warn(
                        `Couldn't load the ${style} icon of signage "${formData.name}" for the designer:`,
                        error,
                    )
                }
            }
        }

        window.package.openSignageDesigner({
            editId: signage.id,
            name: formData.name,
            design: styleDesign,
            image,
            styleId: style,
        })
    }

    // Add class to body to hide scrollbars (matching ItemEditor)
    useEffect(() => {
        document.body.classList.add("item-editor-active")
        return () => {
            document.body.classList.remove("item-editor-active")
        }
    }, [])

    const handleTabChange = (event, newValue) => {
        setTabValue(newValue)
    }

    const handleUpdate = (field, value) => {
        // Snapshot the pre-change form so this edit can be undone
        setUndoStack((prev) => [...prev, formData].slice(-50))
        setRedoStack([])
        setFormData((prev) => ({ ...prev, [field]: value }))
        setHasChanges(true)
        setSaveError(null)
    }

    const performUndo = () => {
        if (!undoStack.length) return
        setRedoStack((r) => [...r, formData])
        setFormData(undoStack[undoStack.length - 1])
        setUndoStack((u) => u.slice(0, -1))
        setHasChanges(true)
        setSaveError(null)
    }

    const performRedo = () => {
        if (!redoStack.length) return
        setUndoStack((u) => [...u, formData])
        setFormData(redoStack[redoStack.length - 1])
        setRedoStack((r) => r.slice(0, -1))
        setHasChanges(true)
        setSaveError(null)
    }

    const handleDelete = async () => {
        if (!signage) return
        setIsDeleting(true)
        setSaveError(null)
        try {
            const result = await window.package.deleteSignage(signage.id)
            if (result.success) {
                window.close()
            } else {
                setSaveError(result.error || "Failed to delete signage")
                setIsDeleting(false)
            }
        } catch (error) {
            console.error(`Failed to delete signage "${signage.name}":`, error)
            setSaveError(error.message || "Failed to delete signage")
            setIsDeleting(false)
        }
    }

    const handleSave = async () => {
        if (!signage) return

        setIsSaving(true)
        setSaveError(null)

        try {
            const result = await window.package.saveSignage({
                ...formData,
                originalId: signage.id,
            })

            if (!result.success) {
                setSaveError(result.error || "Failed to save signage")
                return
            }

            // Commit a staged designer save (icon, materials, .bpsign) -
            // done AFTER the form save so create-signage's per-style merge
            // isn't clobbered by save-signage rewriting Styles
            if (stagedDesign) {
                const staged = await window.package.createSignage({
                    ...stagedDesign,
                    editId: signage.id,
                })
                if (!staged.success) {
                    setSaveError(
                        staged.error || "Failed to apply the designed icon",
                    )
                    return
                }
                if (
                    !stagedDesign.styleId ||
                    stagedDesign.styleId === "BEE2_CLEAN"
                ) {
                    setDesign(stagedDesign.design)
                }
                setStagedDesign(null)
            }

            console.log(
                stagedDesign
                    ? `Saved signage "${formData.name}" with the designed icon`
                    : `Saved signage "${formData.name}"`,
            )
            setShowSaveSuccess(true)
            setHasChanges(false)
            setTimeout(() => setShowSaveSuccess(false), 2000)
        } catch (error) {
            console.error(`Failed to save signage "${formData.name}":`, error)
            setSaveError(error.message || "Failed to save signage")
        } finally {
            setIsSaving(false)
        }
    }

    const handleClose = () => {
        // Unsaved form edits or a staged designer save: confirm the discard
        if (hasChanges || stagedDesign) {
            setDiscardDialogOpen(true)
        } else {
            window.close()
        }
    }

    // Unsaved work: form edits or an uncommitted designer save
    const hasPending = hasChanges || !!stagedDesign

    if (!signage) {
        return (
            <Box
                sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100vh",
                }}>
                <CircularProgress />
            </Box>
        )
    }

    return (
        <Box
            sx={{
                height: "100vh",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
            }}>
            {/* Main Content Area with Vertical Sidebar */}
            <Box sx={{ display: "flex", flex: 1, overflow: "hidden" }}>
                {/* Vertical Sidebar */}
                <Tabs
                    value={tabValue}
                    onChange={handleTabChange}
                    orientation="vertical"
                    variant="scrollable"
                    scrollButtons={false}
                    sx={{
                        borderRight: 1,
                        borderColor: "divider",
                        minWidth: 56,
                        maxWidth: 56,
                        bgcolor: "background.paper",
                        "& .MuiTabs-indicator": {
                            left: 0,
                            width: 3,
                        },
                        "& .MuiTab-root": {
                            minWidth: 56,
                            width: 56,
                            minHeight: 48,
                            alignItems: "center",
                            justifyContent: "center",
                        },
                    }}>
                    <Tooltip
                        title="Info - Edit signage ID, name, and dual sign configuration"
                        placement="right">
                        <Tab
                            icon={
                                <Badge
                                    color="primary"
                                    variant="dot"
                                    invisible={!hasChanges}>
                                    <InfoIcon />
                                </Badge>
                            }
                        />
                    </Tooltip>
                    <Tooltip
                        title="Icons - Which image each BEE2 style shows"
                        placement="right">
                        <Tab
                            icon={
                                <Badge
                                    color="primary"
                                    variant="dot"
                                    invisible={!hasChanges}>
                                    <PaletteIcon />
                                </Badge>
                            }
                        />
                    </Tooltip>
                </Tabs>

                {/* Tab Content */}
                <Box sx={{ flex: 1, p: 2, overflow: "auto" }}>
                    <Box sx={{ display: tabValue === 0 ? "block" : "none" }}>
                        <SignageInfo
                            formData={formData}
                            onUpdate={handleUpdate}
                            availableSignages={availableSignages}
                            showId={showIds}
                        />
                    </Box>
                    <Box sx={{ display: tabValue === 1 ? "block" : "none" }}>
                        <SignageStyles
                            formData={formData}
                            onUpdate={handleUpdate}
                            onEditDesign={handleEditDesign}
                            stagedDesign={stagedDesign}
                            hasDesign={hasDesign}
                            onDropDesign={dropStagedDesign}
                            onError={setSaveError}
                        />
                    </Box>
                </Box>
            </Box>

            {/* Footer - mirrors the item editor: undo/redo, Save, Close, Delete */}
            <Box sx={{ p: 2, borderTop: 1, borderColor: "divider" }}>
                <Stack direction="row" spacing={1}>
                    <Tooltip
                        title={
                            undoStack.length
                                ? "Undo"
                                : "Nothing to undo"
                        }>
                        <span>
                            <IconButton
                                onClick={performUndo}
                                disabled={!undoStack.length}
                                size="small">
                                <Undo />
                            </IconButton>
                        </span>
                    </Tooltip>
                    <Tooltip
                        title={
                            redoStack.length ? "Redo" : "Nothing to redo"
                        }>
                        <span>
                            <IconButton
                                onClick={performRedo}
                                disabled={!redoStack.length}
                                size="small">
                                <Redo />
                            </IconButton>
                        </span>
                    </Tooltip>
                    <Tooltip
                        title={
                            hasPending
                                ? stagedDesign
                                    ? "Save changes (includes the new designed icon)"
                                    : "Save changes to signage"
                                : "No unsaved changes"
                        }>
                        <span style={{ flex: 1, display: "flex" }}>
                            <Button
                                variant="contained"
                                startIcon={
                                    isSaving ? (
                                        <CircularProgress size={20} color="inherit" />
                                    ) : showSaveSuccess ? (
                                        <CheckCircle />
                                    ) : (
                                        <Save />
                                    )
                                }
                                onClick={handleSave}
                                color={showSaveSuccess ? "success" : "primary"}
                                disabled={(!hasChanges && !stagedDesign) || isSaving}
                                sx={{ flex: 1 }}>
                                {isSaving
                                    ? "Saving..."
                                    : showSaveSuccess
                                      ? "Saved!"
                                      : "Save"}
                            </Button>
                        </span>
                    </Tooltip>
                    <Tooltip
                        title={
                            hasPending
                                ? "Close editor (unsaved changes will be lost)"
                                : "Close editor"
                        }>
                        <Button
                            variant="outlined"
                            startIcon={<Close />}
                            onClick={handleClose}
                            color={hasPending ? "error" : "primary"}
                            sx={{ flex: 1 }}>
                            {hasPending ? "Discard" : "Close"}
                        </Button>
                    </Tooltip>
                    <Box sx={{ flex: 1 }} />
                    <Tooltip
                        title={
                            skipDeleteConfirmations
                                ? "Delete this signage permanently (confirmation skipped)"
                                : "Delete this signage permanently"
                        }>
                        <span>
                            <Button
                                variant="outlined"
                                startIcon={<Delete />}
                                onClick={() =>
                                    skipDeleteConfirmations
                                        ? handleDelete()
                                        : setDeleteDialogOpen(true)
                                }
                                color="error"
                                disabled={isDeleting}>
                                Delete
                            </Button>
                        </span>
                    </Tooltip>
                </Stack>
                {saveError && (
                    <Alert severity="error" sx={{ mt: 2 }} onClose={() => setSaveError(null)}>
                        {saveError}
                    </Alert>
                )}
            </Box>

            {/* Discard confirmation */}
            <Dialog
                open={discardDialogOpen}
                onClose={() => setDiscardDialogOpen(false)}>
                <DialogTitle>Discard changes?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        {stagedDesign
                            ? "You have unsaved changes, including a designed icon waiting to be applied. Close and discard them?"
                            : "You have unsaved changes. Close and discard them?"}
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDiscardDialogOpen(false)}>
                        Keep editing
                    </Button>
                    <Button
                        color="error"
                        variant="contained"
                        onClick={() => window.close()}>
                        Discard
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Delete confirmation */}
            <Dialog
                open={deleteDialogOpen}
                onClose={() => setDeleteDialogOpen(false)}>
                <DialogTitle>Delete signage?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        This permanently removes “{formData.name || signage.id}”
                        from the package, including its generated icon, material,
                        and designer source. This cannot be undone.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteDialogOpen(false)}>
                        Cancel
                    </Button>
                    <Button
                        color="error"
                        variant="contained"
                        startIcon={
                            isDeleting ? (
                                <CircularProgress size={18} color="inherit" />
                            ) : (
                                <Delete />
                            )
                        }
                        disabled={isDeleting}
                        onClick={handleDelete}>
                        {isDeleting ? "Deleting..." : "Delete"}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    )
}

export default SignageEditor
