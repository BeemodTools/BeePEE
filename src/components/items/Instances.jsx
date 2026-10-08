import {
    Box,
    Typography,
    Stack,
    Paper,
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    IconButton,
    DialogContentText,
    Tooltip,
    Collapse,
    Chip,
    Divider,
    TextField,
    Alert,
    CircularProgress,
    List,
    ListItem,
    ListItemIcon,
    ListItemText,
    Snackbar,
} from "@mui/material"
import EditIcon from "@mui/icons-material/Edit"
import DeleteIcon from "@mui/icons-material/Delete"
import AddIcon from "@mui/icons-material/Add"
import SwapHorizIcon from "@mui/icons-material/SwapHoriz"
import CodeIcon from "@mui/icons-material/Code"
import SubjectIcon from "@mui/icons-material/Subject"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import InfoIcon from "@mui/icons-material/Info"
import LabelIcon from "@mui/icons-material/Label"
import WarningIcon from "@mui/icons-material/Warning"
import ImageIcon from "@mui/icons-material/Image"
import ViewInArIcon from "@mui/icons-material/ViewInAr"
import MusicNoteIcon from "@mui/icons-material/MusicNote"
import DescriptionIcon from "@mui/icons-material/Description"
import RefreshIcon from "@mui/icons-material/Refresh"
import { useEffect, useState } from "react"
import ViewInAr from "@mui/icons-material/ViewInAr"

const units = (depth) => `${depth} unit${depth === 1 ? "" : "s"}`

/**
 * What an instance has behind the surface the item is placed on (from the
 * backend's behindSurface.js): a warning for entities, which can leak the
 * map, a note for brushes alone, which are only hidden in the wall
 */
function BehindSurfaceIcon({ behind, onOpen }) {
    // Opening its 3D view (which can make the instance's model first)
    const [opening, setOpening] = useState(false)
    if (!behind) return null
    const leaks = behind.entityCount > 0
    const open = async () => {
        setOpening(true)
        try {
            await onOpen()
        } finally {
            setOpening(false)
        }
    }
    const more = behind.entityCount - behind.entities.length
    const brushes = `${behind.brushCount} brush${behind.brushCount === 1 ? "" : "es"}`
    return (
        <Tooltip
            title={
                <Box>
                    <Box sx={{ fontWeight: "bold", mb: 0.5 }}>
                        {leaks
                            ? `Goes ${units(behind.depth)} behind the surface it's placed on`
                            : `${brushes} up to ${units(behind.brushDepth)} behind the surface it's placed on`}
                    </Box>
                    {behind.entities.map((entity, i) => (
                        <Box key={i}>
                            {entity.classname}
                            {entity.name ? ` "${entity.name}"` : ""}:{" "}
                            {units(entity.depth)}
                        </Box>
                    ))}
                    {more > 0 && (
                        <Box>
                            and {more} more {more === 1 ? "entity" : "entities"}
                        </Box>
                    )}
                    {leaks && behind.brushCount > 0 && (
                        <Box>
                            {brushes}: up to {units(behind.brushDepth)}
                        </Box>
                    )}
                    <Box sx={{ mt: 0.5, opacity: 0.8 }}>
                        {leaks
                            ? "An entity behind the wall can end up in the void, which makes the map leak."
                            : "Brushes in the wall are hidden, and don't make the map leak."}
                    </Box>
                    <Box sx={{ mt: 0.5, fontWeight: "bold" }}>
                        Click to open it in the Leak Finder
                    </Box>
                </Box>
            }>
            <span>
                <IconButton
                    size="small"
                    onClick={open}
                    disabled={opening}
                    sx={{ p: 0.25 }}>
                    {opening ? (
                        <CircularProgress size={18} />
                    ) : leaks ? (
                        <WarningIcon fontSize="small" color="warning" />
                    ) : (
                        <InfoIcon fontSize="small" color="info" />
                    )}
                </IconButton>
            </span>
        </Tooltip>
    )
}

function Instances({
    item,
    formData,
    onUpdateInstances,
    editingNames,
    setEditingNames,
}) {
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [instanceToDelete, setInstanceToDelete] = useState(null)
    const [isRemovingMissing, setIsRemovingMissing] = useState(false)
    const [expandedStats, setExpandedStats] = useState(new Set())
    const [isCheckingAssets, setIsCheckingAssets] = useState(false)
    // Files instances use that don't exist or aren't mounted properly
    const [externalAssetsDialog, setExternalAssetsDialog] = useState({
        open: false,
        files: [], // Array of { fileName, missingAssets }
        pendingFiles: [], // Files to add after user acknowledges warning
        mode: "add", // "add": Add Anyway / Cancel, "replace": already replaced, OK
    })
    // Instances being autopacked again, and how the last one went
    const [autopacking, setAutopacking] = useState(new Set())
    const [autopackNotice, setAutopackNotice] = useState({
        open: false,
        severity: "success",
        text: "",
    })

    // What each saved instance has behind the item's surface, by index
    // (instances not saved yet carry theirs). Checked again when the window
    // comes back, like after editing an instance in Hammer.
    const [behindSurface, setBehindSurface] = useState({})
    const instanceFiles = JSON.stringify(
        Object.entries(item?.instances ?? {}).map(([index, instance]) => [
            index,
            instance.Name,
        ]),
    )
    useEffect(() => {
        if (!item?.id) return
        let current = true
        const check = async () => {
            try {
                const result = await window.package.getInstancesBehindSurface(
                    item.id,
                )
                if (current && result?.success) {
                    setBehindSurface(result.behindSurface)
                }
            } catch (error) {
                console.warn(
                    `Couldn't check what the instances of item "${item.name}" have behind its surface:`,
                    error,
                )
            }
        }
        check()
        window.addEventListener("focus", check)
        return () => {
            current = false
            window.removeEventListener("focus", check)
        }
    }, [item?.id, instanceFiles])

    // Convert formData instances to array format for rendering
    const instances = formData?.instances
        ? Object.entries(formData.instances)
              .filter(([index, instance]) => !instance._toRemove) // Hide instances marked for removal
              .map(([index, instance]) => ({
                  ...instance,
                  index,
              }))
        : []

    const toggleStatsExpansion = (instanceIndex) => {
        setExpandedStats((prev) => {
            const newSet = new Set(prev)
            if (newSet.has(instanceIndex)) {
                newSet.delete(instanceIndex)
            } else {
                newSet.add(instanceIndex)
            }
            return newSet
        })
    }

    const handleEditInstance = async (packagePath, instancePath) => {
        try {
            await window.package.editInstance({
                packagePath,
                instanceName: instancePath,
                itemId: item.id,
            })
        } catch (error) {
            console.error(
                `Failed to open instance "${instancePath}" in Hammer:`,
                error,
            )
        }
    }

    const handleAddInstanceWithFileDialog = async () => {
        try {
            const result = await window.package.selectInstanceFile(item.id)
            if (result.success && result.files && result.files.length > 0) {
                // Check each file for files it uses that aren't on this
                // machine (custom ones are packed when the item is saved)
                setIsCheckingAssets(true)
                const filesWithMissingAssets = []
                const successfulFiles = result.files.filter(f => f.success)

                for (const fileResult of successfulFiles) {
                    try {
                        const assetCheck = await window.package.checkVmfExternalAssets(fileResult.filePath)
                        const missingAssets = assetCheck.assets?.missing ?? []
                        if (assetCheck.success && missingAssets.length > 0) {
                            filesWithMissingAssets.push({
                                fileName: fileResult.fileName,
                                missingAssets,
                            })
                        }
                    } catch (err) {
                        console.warn(`Failed to check assets for ${fileResult.fileName}:`, err)
                    }
                }
                setIsCheckingAssets(false)

                if (filesWithMissingAssets.length > 0) {
                    setExternalAssetsDialog({
                        open: true,
                        files: filesWithMissingAssets,
                        pendingFiles: successfulFiles,
                        mode: "add",
                    })
                } else {
                    addPendingInstances(successfulFiles)
                }
            } else if (!result.canceled) {
                console.error(
                    `Failed to select instance files for item "${item.name}":`,
                    result.error,
                )
            }
        } catch (error) {
            console.error(
                `Failed to select instance files for item "${item?.name}":`,
                error,
            )
            setIsCheckingAssets(false)
        }
    }

    // Helper function to add pending instances
    const addPendingInstances = async (files) => {
        let updatedInstances = { ...formData.instances }

        for (const fileResult of files) {
            if (fileResult.success) {
                const newIndex = `pending_${Date.now()}_${Math.random()
                    .toString(36)
                    .substr(2, 9)}`

                // What it has behind the item's surface, for its warning
                let behindSurface = null
                try {
                    const check =
                        await window.package.checkInstanceBehindSurface(
                            item.id,
                            fileResult.filePath,
                        )
                    if (check?.success) behindSurface = check.behindSurface
                } catch (error) {
                    console.warn(
                        `Couldn't check what ${fileResult.fileName} has behind its surface:`,
                        error,
                    )
                }

                const newInstance = {
                    Name: fileResult.instanceName,
                    _pending: true,
                    _filePath: fileResult.filePath,
                    behindSurface,
                }

                updatedInstances[newIndex] = newInstance

                await new Promise((resolve) => setTimeout(resolve, 10))
            }
        }

        onUpdateInstances(updatedInstances)
        console.log(
            `Added ${files.length} instance(s) to item "${item?.name}", pending save`,
        )
    }

    // Handle user acknowledging the missing files warning
    const handleExternalAssetsAcknowledge = () => {
        if (externalAssetsDialog.mode === "add") {
            addPendingInstances(externalAssetsDialog.pendingFiles)
        }
        setExternalAssetsDialog({ open: false, files: [], pendingFiles: [], mode: "add" })
    }

    // Handle user canceling due to missing files
    const handleExternalAssetsCancel = () => {
        setExternalAssetsDialog({ open: false, files: [], pendingFiles: [], mode: "add" })
    }

    // Asset type from its path, for the icons
    const assetType = (assetPath) => {
        if (assetPath.startsWith("models/")) return "MODEL"
        if (assetPath.startsWith("sound/")) return "SOUND"
        if (assetPath.startsWith("scripts/")) return "SCRIPT"
        return "MATERIAL"
    }

    // Get icon for asset type
    const getAssetIcon = (type) => {
        switch (type) {
            case "MODEL": return <ViewInArIcon fontSize="small" />
            case "MATERIAL": return <ImageIcon fontSize="small" />
            case "SOUND": return <MusicNoteIcon fontSize="small" />
            case "SCRIPT": return <DescriptionIcon fontSize="small" />
            default: return <DescriptionIcon fontSize="small" />
        }
    }

    // Show the files an instance uses that aren't on this machine (after
    // it was replaced or autopacked again: nothing to cancel)
    const showMissingFiles = (fileName, missingFiles, neededBy) => {
        setExternalAssetsDialog({
            open: true,
            files: [
                {
                    fileName,
                    missingAssets: missingFiles.map((path) => ({
                        type: assetType(path),
                        path,
                        neededBy: neededBy?.[path] ?? null,
                    })),
                },
            ],
            pendingFiles: [],
            mode: "replace",
        })
    }

    // Open the 3D view of what an instance has behind the item's surface (its
    // warning, clicked): a saved instance's, or the VMF of one added since
    const openBehindSurface = async (instance, isPending) => {
        const fileName = String(instance.Name ?? "").split(/[\\/]/).pop()
        try {
            const result = await window.package.showBehindSurface(item.id, {
                ...(isPending
                    ? { vmfPath: instance._filePath }
                    : { instanceKey: instance.index }),
                title: `Leak Finder - ${fileName} (${item.name})`,
            })
            if (!result?.success) {
                throw new Error(result?.error || "No reason given")
            }
        } catch (error) {
            console.error(
                `Couldn't show what ${fileName} has behind the surface:`,
                error,
            )
            setAutopackNotice({
                open: true,
                severity: "error",
                text: `Couldn't show what ${fileName} has behind the surface: ${error.message}`,
            })
        }
    }

    // Autopack an instance again: pack the custom files it uses that aren't
    // in the package yet (new ones after editing it in Hammer, or ones that
    // weren't found or mounted before)
    const handleAutopackAgain = async (instanceIndex) => {
        setAutopacking((prev) => new Set(prev).add(instanceIndex))
        const notify = (severity, text) =>
            setAutopackNotice({ open: true, severity, text })
        try {
            const result = await window.package.autopackInstanceAgain(
                item.id,
                instanceIndex,
            )
            if (result.skipped) {
                notify("warning", "Portal 2 wasn't found, so nothing was packed")
            } else if (!result.success) {
                notify("error", `Autopacking failed: ${result.error}`)
            } else if (result.packed > 0) {
                const files = result.packed === 1 ? "file" : "files"
                notify("success", `Packed ${result.packed} new ${files}`)
            } else {
                notify(
                    "info",
                    result.custom > 0
                        ? "Nothing new to pack: its custom files are in the package"
                        : "Nothing to pack: it only uses the game's files",
                )
            }
            if (result.missingFiles?.length > 0) {
                showMissingFiles(
                    result.fileName,
                    result.missingFiles,
                    result.neededBy,
                )
            }
        } catch (error) {
            console.error(
                `Failed to autopack instance ${instanceIndex} of item "${item?.name}" again:`,
                error,
            )
            notify("error", `Autopacking failed: ${error.message}`)
        } finally {
            setAutopacking((prev) => {
                const next = new Set(prev)
                next.delete(instanceIndex)
                return next
            })
        }
    }

    const handleReplaceInstance = async (instanceIndex) => {
        try {
            const result = await window.package.replaceInstanceFileDialog(
                item.id,
                instanceIndex,
            )
            if (result.success) {
                // Update the local formData to match the backend change
                const existingInstance = formData.instances[instanceIndex]
                const updatedInstance = {
                    ...existingInstance,
                    Name: result.instanceName || existingInstance.Name,
                }

                const updatedInstances = {
                    ...formData.instances,
                    [instanceIndex]: updatedInstance,
                }

                onUpdateInstances(updatedInstances)
                console.log(
                    `Replaced instance "${updatedInstance.Name}" in item "${item.name}"`,
                )

                // The replacement uses files that aren't on this machine
                if (result.missingFiles?.length > 0) {
                    showMissingFiles(
                        result.fileName,
                        result.missingFiles,
                        result.neededBy,
                    )
                }
            } else if (!result.canceled) {
                console.error(
                    `Failed to replace instance ${instanceIndex} of item "${item.name}":`,
                    result.error,
                )
            }
        } catch (error) {
            console.error(
                `Failed to replace instance ${instanceIndex} of item "${item?.name}":`,
                error,
            )
        }
    }

    const handleRemoveInstance = () => {
        if (instanceToDelete === null) return
        try {
            const updatedInstances = { ...formData.instances }
            const instanceData = updatedInstances[instanceToDelete]

            if (instanceData && instanceData._pending) {
                // If it's a pending instance (not yet saved), just remove it completely
                delete updatedInstances[instanceToDelete]
                console.log(
                    `Removed pending instance "${instanceData.Name}" from item "${item?.name}"`,
                )
            } else {
                // Mark existing instance for removal
                updatedInstances[instanceToDelete] = {
                    ...instanceData,
                    _toRemove: true,
                }
                console.log(
                    `Marked instance "${instanceData?.Name}" of item "${item?.name}" for removal on save`,
                )
            }

            onUpdateInstances(updatedInstances)
            setDeleteDialogOpen(false)
            setInstanceToDelete(null)
        } catch (error) {
            console.error(
                `Failed to mark instance ${instanceToDelete} of item "${item?.name}" for removal:`,
                error,
            )
        }
    }

    const handleRemoveAllMissingInstances = () => {
        const missingInstances = instances.filter((instance) => {
            const metadata = instance._metadata || {
                exists: true,
                source: "editor",
            }
            return !metadata.exists && metadata.source !== "vbsp"
        })
        if (missingInstances.length === 0) return

        setIsRemovingMissing(true)

        try {
            const updatedInstances = { ...formData.instances }

            missingInstances.forEach((instance) => {
                const instanceData = updatedInstances[instance.index]
                if (instanceData && instanceData._pending) {
                    // If it's a pending instance (not yet saved), just remove it completely
                    delete updatedInstances[instance.index]
                } else {
                    // Mark existing instance for removal
                    updatedInstances[instance.index] = {
                        ...instanceData,
                        _toRemove: true,
                    }
                }
            })

            onUpdateInstances(updatedInstances)
            console.log(
                `Marked ${missingInstances.length} missing instance(s) of item "${item?.name}" for removal on save`,
            )
        } catch (error) {
            console.error(
                `Failed to mark the missing instances of item "${item?.name}" for removal:`,
                error,
            )
        } finally {
            setIsRemovingMissing(false)
        }
    }

    return (
        <Box
            sx={{
                overflow: "hidden",
                "&::-webkit-scrollbar": {
                    display: "none",
                },
                msOverflowStyle: "none",
                scrollbarWidth: "none",
            }}>
            <Box
                sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    mb: 2,
                }}>
                <Typography variant="h6">
                    Instance Files ({instances.length})
                </Typography>
                <Box sx={{ display: "flex", gap: 1 }}>
                    <Tooltip title="Select one or more VMF files to add as new instances">
                        <Button
                            variant="contained"
                            startIcon={<AddIcon />}
                            onClick={handleAddInstanceWithFileDialog}>
                            Add VMF Instance(s)
                        </Button>
                    </Tooltip>
                    {instances.some((instance) => {
                        const metadata = instance._metadata || {
                            exists: true,
                            source: "editor",
                        }
                        return !metadata.exists && metadata.source !== "vbsp"
                    }) &&
                        !isRemovingMissing && (
                            <Tooltip title="Remove all instances with missing files (excluding VBSP instances)">
                                <Button
                                    variant="outlined"
                                    color="error"
                                    startIcon={<DeleteIcon />}
                                    onClick={handleRemoveAllMissingInstances}
                                    size="small">
                                    Remove Missing
                                </Button>
                            </Tooltip>
                        )}
                </Box>
            </Box>

            {instances.length === 0 && (
                <Alert severity="warning" icon={<WarningIcon />} sx={{ mb: 2 }}>
                    At least one instance is required
                </Alert>
            )}

            {instances.length > 0 ? (
                <Stack spacing={2}>
                    {instances.map((instance, arrayIndex) => {
                        // Get metadata from the instance or fallback to defaults
                        const metadata = instance._metadata || {
                            exists: true,
                            source: "editor",
                        }
                        const isVBSP = metadata.source === "vbsp"
                        const instanceExists = metadata.exists
                        const isDisabled = !instanceExists
                        const isPending = instance._pending === true
                        // Use the array index for sequential numbering instead of trying to parse from filename
                        const instanceNumber = arrayIndex

                        const hasStats =
                            instanceExists &&
                            !isVBSP &&
                            (instance.EntityCount > 0 ||
                                instance.BrushCount > 0 ||
                                instance.BrushSideCount > 0)
                        const isStatsExpanded = expandedStats.has(
                            instance.index,
                        )

                        return (
                            <Paper
                                // Not the VMF's path: two instances can use
                                // the same one
                                key={instance.index}
                                variant="outlined"
                                sx={{
                                    backgroundColor: isDisabled
                                        ? "rgba(0, 0, 0, 0.3)"
                                        : "background.paper",
                                    borderColor: isDisabled
                                        ? "error.main"
                                        : "divider",
                                    borderWidth: isDisabled ? 1 : 1,
                                    opacity: isDisabled ? 0.8 : 1,
                                }}>
                                <Box sx={{ p: 2 }}>
                                    <Box
                                        sx={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 1,
                                            width: "100%",
                                            minWidth: 0,
                                        }}>
                                        {/* Instance Type Icon */}
                                        <Tooltip
                                            title={
                                                isDisabled
                                                    ? "Missing File"
                                                    : isVBSP
                                                      ? "VBSP Instance"
                                                      : "Editor Instance"
                                            }>
                                            {isVBSP ? (
                                                <CodeIcon fontSize="small" />
                                            ) : (
                                                <SubjectIcon fontSize="small" />
                                            )}
                                        </Tooltip>

                                        {/* Instance Name - Always Editable */}
                                        <Box
                                            sx={{
                                                minWidth: "120px",
                                                maxWidth: "250px",
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 0.5,
                                            }}>
                                            <TextField
                                                size="small"
                                                value={
                                                    editingNames[
                                                        instance.index
                                                    ] !== undefined
                                                        ? editingNames[
                                                              instance.index
                                                          ]
                                                        : instance.displayName ||
                                                          `Instance ${instanceNumber}`
                                                }
                                                onChange={(e) => {
                                                    // Just update the local state, don't save to meta.json yet
                                                    const newName =
                                                        e.target.value
                                                    setEditingNames((prev) => ({
                                                        ...prev,
                                                        [instance.index]:
                                                            newName,
                                                    }))
                                                }}
                                                placeholder={`Instance ${instanceNumber}`}
                                                sx={{
                                                    minWidth: "100px",
                                                    maxWidth: "230px",
                                                    "& .MuiInputBase-input": {
                                                        fontSize: "0.875rem",
                                                        fontWeight: "medium",
                                                        color: "text.primary",
                                                    },
                                                    "& .MuiOutlinedInput-root":
                                                        {
                                                            "& fieldset": {
                                                                borderColor:
                                                                    "transparent",
                                                            },
                                                            "&:hover fieldset":
                                                                {
                                                                    borderColor:
                                                                        "divider",
                                                                },
                                                            "&.Mui-focused fieldset":
                                                                {
                                                                    borderColor:
                                                                        "primary.main",
                                                                },
                                                        },
                                                }}
                                            />
                                        </Box>

                                        <BehindSurfaceIcon
                                            behind={
                                                isPending
                                                    ? instance.behindSurface
                                                    : behindSurface[
                                                          instance.index
                                                      ]
                                            }
                                            onOpen={() =>
                                                openBehindSurface(
                                                    instance,
                                                    isPending,
                                                )
                                            }
                                        />

                                        {/* Instance Path */}
                                        <Typography
                                            variant="body2"
                                            color="text.secondary"
                                            sx={{
                                                fontFamily: "monospace",
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                                whiteSpace: "nowrap",
                                                flex: 1,
                                                minWidth: 0,
                                                maxWidth: "100%",
                                                fontSize: "0.75rem",
                                            }}>
                                            {instance.Name ||
                                                "(unnamed instance)"}
                                        </Typography>

                                        <Box
                                            sx={{
                                                display: "flex",
                                                gap: 1,
                                                flexShrink: 0,
                                            }}>
                                            {hasStats && (
                                                <Tooltip
                                                    title={
                                                        isStatsExpanded
                                                            ? "Hide VMF stats"
                                                            : "Show VMF stats"
                                                    }>
                                                    <IconButton
                                                        size="small"
                                                        onClick={() =>
                                                            toggleStatsExpansion(
                                                                instance.index,
                                                            )
                                                        }
                                                        color="info">
                                                        {isStatsExpanded ? (
                                                            <ExpandLessIcon fontSize="small" />
                                                        ) : (
                                                            <ExpandMoreIcon fontSize="small" />
                                                        )}
                                                    </IconButton>
                                                </Tooltip>
                                            )}

                                            <Tooltip
                                                title={
                                                    isDisabled
                                                        ? "Cannot edit - file is missing"
                                                        : "Edit this instance file in Hammer"
                                                }>
                                                <span>
                                                    {" "}
                                                    {/* Wrapper needed for disabled IconButton */}
                                                    <IconButton
                                                        size="small"
                                                        onClick={() =>
                                                            handleEditInstance(
                                                                item.packagePath,
                                                                instance.Name,
                                                            )
                                                        }
                                                        disabled={isDisabled}>
                                                        <EditIcon fontSize="small" />
                                                    </IconButton>
                                                </span>
                                            </Tooltip>

                                            {/* Pending instances are autopacked when the item is saved */}
                                            {!isPending && (
                                                <Tooltip
                                                    title={
                                                        isDisabled
                                                            ? "Cannot autopack - file is missing"
                                                            : "Autopack again: pack the custom files this instance uses that aren't in the package yet"
                                                    }>
                                                    <span>
                                                        <IconButton
                                                            size="small"
                                                            onClick={() =>
                                                                handleAutopackAgain(
                                                                    instance.index,
                                                                )
                                                            }
                                                            disabled={
                                                                isDisabled ||
                                                                autopacking.has(
                                                                    instance.index,
                                                                )
                                                            }>
                                                            {autopacking.has(
                                                                instance.index,
                                                            ) ? (
                                                                <CircularProgress
                                                                    size={16}
                                                                />
                                                            ) : (
                                                                <RefreshIcon fontSize="small" />
                                                            )}
                                                        </IconButton>
                                                    </span>
                                                </Tooltip>
                                            )}

                                            {!isVBSP && (
                                                <Tooltip
                                                    title={
                                                        isDisabled
                                                            ? "Replace missing file with a VMF file"
                                                            : "Replace this instance file with a different VMF file"
                                                    }>
                                                    <IconButton
                                                        size="small"
                                                        onClick={() =>
                                                            handleReplaceInstance(
                                                                instance.index,
                                                            )
                                                        }
                                                        color={
                                                            isDisabled
                                                                ? "primary"
                                                                : "warning"
                                                        }>
                                                        <SwapHorizIcon fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                            )}

                                            {!isVBSP && (
                                                <Tooltip title="Delete this instance permanently">
                                                    <IconButton
                                                        size="small"
                                                        color="error"
                                                        onClick={() => {
                                                            setInstanceToDelete(
                                                                instance.index,
                                                            )
                                                            setDeleteDialogOpen(
                                                                true,
                                                            )
                                                        }}>
                                                        <DeleteIcon fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                            )}
                                        </Box>
                                    </Box>
                                </Box>

                                {/* Expandable Stats Section */}
                                {hasStats && (
                                    <Collapse in={isStatsExpanded}>
                                        <Divider />
                                        <Box sx={{ p: 2, pt: 1.5 }}>
                                            <Typography
                                                variant="subtitle2"
                                                sx={{
                                                    mb: 1,
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: 1,
                                                }}>
                                                <InfoIcon fontSize="small" />
                                                VMF Statistics
                                            </Typography>
                                            <Box
                                                sx={{
                                                    display: "flex",
                                                    gap: 1,
                                                    flexWrap: "wrap",
                                                }}>
                                                <Chip
                                                    label={`${instance.EntityCount || 0} Entities`}
                                                    size="small"
                                                    variant="outlined"
                                                    color="primary"
                                                />
                                                <Chip
                                                    label={`${instance.BrushCount || 0} Brushes`}
                                                    size="small"
                                                    variant="outlined"
                                                    color="secondary"
                                                />
                                                <Chip
                                                    label={`${instance.BrushSideCount || 0} Brush Sides`}
                                                    size="small"
                                                    variant="outlined"
                                                    color="success"
                                                />
                                            </Box>
                                        </Box>
                                    </Collapse>
                                )}
                            </Paper>
                        )
                    })}
                </Stack>
            ) : (
                <Box
                    sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 2,
                        p: 4,
                        textAlign: "center",
                    }}>
                    <ViewInAr
                        sx={{
                            fontSize: 48,
                            color: "text.secondary",
                            opacity: 0.5,
                        }}
                    />
                    <Typography variant="h6" color="text.secondary">
                        No Instances Yet
                    </Typography>
                    <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mb: 2 }}>
                        Add your first instance to this item using the button
                        above
                    </Typography>
                    <Button
                        variant="contained"
                        startIcon={<AddIcon />}
                        onClick={handleAddInstanceWithFileDialog}>
                        Add First VMF Instance
                    </Button>
                </Box>
            )}

            {/* Delete Confirmation Dialog */}
            <Dialog
                open={deleteDialogOpen}
                onClose={() => setDeleteDialogOpen(false)}
                PaperProps={{
                    sx: {
                        bgcolor: "#1e1e1e",
                        color: "white",
                        minWidth: "300px",
                    },
                }}>
                <DialogTitle>Delete Instance?</DialogTitle>
                <DialogContent>
                    <DialogContentText sx={{ color: "rgba(255,255,255,0.8)" }}>
                        Are you sure you want to delete this instance? This
                        action cannot be undone.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={() => setDeleteDialogOpen(false)}
                        sx={{ color: "rgba(255,255,255,0.6)" }}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleRemoveInstance}
                        color="error"
                        variant="contained">
                        Delete
                    </Button>
                </DialogActions>
            </Dialog>

            {/* External Assets Warning Dialog */}
            <Dialog
                open={externalAssetsDialog.open}
                onClose={handleExternalAssetsCancel}
                maxWidth="md"
                fullWidth
                PaperProps={{
                    sx: {
                        bgcolor: "#1e1e1e",
                        color: "white",
                    },
                }}>
                <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <WarningIcon color="warning" />
                    Missing Files
                </DialogTitle>
                <DialogContent>
                    <Alert severity="warning" sx={{ mb: 2 }}>
                        These files don't exist or aren't mounted properly, so they'll be missing in game.
                        If you have them, check that their folder is in Portal 2's search paths (gameinfo.txt),
                        or that their VPK is mounted.
                    </Alert>

                    {externalAssetsDialog.files.map((file, fileIndex) => (
                        <Box key={fileIndex} sx={{ mb: 2 }}>
                            <Typography variant="subtitle1" sx={{ fontWeight: "bold", mb: 1 }}>
                                {file.fileName}
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                                {file.missingAssets.length} missing file(s)
                            </Typography>
                            <List dense sx={{ bgcolor: "rgba(0,0,0,0.2)", borderRadius: 1, maxHeight: 200, overflow: "auto" }}>
                                {file.missingAssets.slice(0, 20).map((asset, assetIndex) => (
                                    <ListItem key={assetIndex}>
                                        <ListItemIcon sx={{ minWidth: 36 }}>
                                            {getAssetIcon(asset.type)}
                                        </ListItemIcon>
                                        <ListItemText
                                            primary={asset.path}
                                            secondary={asset.neededBy ? `Used by ${asset.neededBy}` : asset.type}
                                            primaryTypographyProps={{
                                                variant: "body2",
                                                sx: { fontFamily: "monospace", fontSize: "0.75rem" }
                                            }}
                                            secondaryTypographyProps={{ variant: "caption" }}
                                        />
                                    </ListItem>
                                ))}
                                {file.missingAssets.length > 20 && (
                                    <ListItem>
                                        <ListItemText
                                            primary={`... and ${file.missingAssets.length - 20} more`}
                                            primaryTypographyProps={{
                                                variant: "body2",
                                                color: "text.secondary",
                                                sx: { fontStyle: "italic" }
                                            }}
                                        />
                                    </ListItem>
                                )}
                            </List>
                        </Box>
                    ))}
                </DialogContent>
                <DialogActions>
                    {externalAssetsDialog.mode === "add" && (
                        <Button
                            onClick={handleExternalAssetsCancel}
                            sx={{ color: "rgba(255,255,255,0.6)" }}>
                            Cancel
                        </Button>
                    )}
                    <Button
                        onClick={handleExternalAssetsAcknowledge}
                        variant="contained"
                        color="warning">
                        {externalAssetsDialog.mode === "add" ? "Add Anyway" : "OK"}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Checking Assets Loading Overlay */}
            <Dialog
                open={isCheckingAssets}
                PaperProps={{
                    sx: {
                        bgcolor: "#1e1e1e",
                        color: "white",
                        p: 3,
                    },
                }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <CircularProgress size={24} />
                    <Typography>Checking for external assets...</Typography>
                </Box>
            </Dialog>

            {/* How autopacking an instance again went, or why a 3D view of
                what's behind the surface couldn't open */}
            <Snackbar
                open={autopackNotice.open}
                autoHideDuration={5000}
                onClose={() =>
                    setAutopackNotice((notice) => ({ ...notice, open: false }))
                }
                anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
                <Alert
                    severity={autopackNotice.severity}
                    variant="filled"
                    onClose={() =>
                        setAutopackNotice((notice) => ({ ...notice, open: false }))
                    }>
                    {autopackNotice.text}
                </Alert>
            </Snackbar>
        </Box>
    )
}

export default Instances
