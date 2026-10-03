import {
    Stack,
    TextField,
    Box,
    Typography,
    Button,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    CircularProgress,
    Alert,
    Tooltip,
    Autocomplete,
    Collapse,
    Divider,
    Checkbox,
    FormControlLabel,
} from "@mui/material"
import {
    Preview,
    Warning,
} from "@mui/icons-material"
import { useState, useEffect } from "react"

// Predefined model options
const predefinedModels = [
    { category: "Generic", label: "Turret", value: "sentry.3ds" },
    { category: "Generic", label: "Light Strip", value: "light_strip.3ds" },
    { category: "Cubes", label: "Cube (Normal)", value: "cube.3ds" },
    { category: "Cubes", label: "Cube (Companion)", value: "cubecompanion.3ds" },
    { category: "Cubes", label: "Cube (Redirection)", value: "cubelaser.3ds" },
    { category: "Cubes", label: "Cube (Edgeless)", value: "cubesphere.3ds" },
    { category: "Buttons", label: "Floor Button (Weighted)", value: "buttonweight.3ds" },
    { category: "Buttons", label: "Floor Button (Cube)", value: "buttoncube.3ds" },
    { category: "Buttons", label: "Floor Button (Sphere)", value: "buttonball.3ds" },
    { category: "Other", label: "Generate", value: "Generate" },
]

function Other({ item, formData, onUpdate, onUpdateOther, onModelGenerationStart, onModelGenerationComplete }) {
    const [selectedInstanceKey, setSelectedInstanceKey] = useState("")
    const [isConverting, setIsConverting] = useState(false)
    const [conversionProgress, setConversionProgress] = useState("")
    const [vbspVariables, setVbspVariables] = useState([])
    const [portal2Status, setPortal2Status] = useState(null)
    const [objFileExists, setObjFileExists] = useState(false)
    const [skipCartoonify, setSkipCartoonify] = useState(false)

    // Check Portal 2 installation status on mount
    useEffect(() => {
        const checkPortal2 = async () => {
            try {
                const status = await window.package?.getPortal2Status?.()
                setPortal2Status(status)
            } catch (error) {
                console.error("Failed to check Portal 2 status:", error)
                setPortal2Status({
                    isInstalled: false,
                    features: {
                        modelGeneration: false,
                        autopacking: false,
                        fgdData: false,
                        hammerEditor: false,
                    },
                })
            }
        }
        checkPortal2()
    }, [])

    // Helper function to convert "TIMER DELAY" to "Timer Delay"
    const formatVariableName = (name) => {
        return name
            .split(/[\s_]+/)
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(" ")
    }

    // Extract all variables used by the item
    useEffect(() => {
        const variables = []

        // Check if item has any instances - only add "First Instance" if there are instances
        const hasInstances =
            formData?.instances &&
            Object.keys(formData.instances).length > 0

        if (hasInstances) {
            variables.push("First Instance")
        }

        // Add all item variables
        if (Array.isArray(formData?.variables)) {
            // Variables are an array of objects with displayName and fixupName
            formData.variables.forEach((varObj) => {
                if (varObj && varObj.displayName) {
                    // Format the display name nicely (Timer Delay instead of TIMER DELAY)
                    const displayName = formatVariableName(varObj.displayName)
                    if (!variables.includes(displayName)) {
                        variables.push(displayName)
                    }
                }
            })
        }

        setVbspVariables(variables)
    }, [formData?.variables, formData?.instances])

    // Keep selected variable in sync when variables change
    useEffect(() => {
        if (vbspVariables.length === 0) {
            setSelectedInstanceKey("")
            return
        }
        setSelectedInstanceKey((prev) => {
            // Check if previous selection still exists in variables list
            const stillExists = vbspVariables.includes(prev)
            // Default to "First Instance" if previous selection doesn't exist
            return stillExists ? prev : "First Instance"
        })
    }, [vbspVariables])

    // Listen for conversion progress updates from backend
    useEffect(() => {
        const handleProgress = (event, progressData) => {
            const { stage, message, detail } = progressData

            // Update progress message based on stage
            const stageMessages = {
                vmf2obj: "🔄 Converting to OBJ...",
                mdl: "🔨 Converting to MDL...",
            }

            setConversionProgress(
                stageMessages[stage] || message || "Converting...",
            )
        }

        // Register listener
        window.api?.on?.("conversion-progress", handleProgress)

        // Cleanup
        return () => {
            window.api?.off?.("conversion-progress", handleProgress)
        }
    }, [])

    // Check if OBJ files exist for preview using listModelSegments
    useEffect(() => {
        const checkObjExists = async () => {
            if (!item?.id) {
                setObjFileExists(false)
                return
            }

            try {
                // Use listModelSegments to check if any OBJ files exist
                const result = await window.package?.listModelSegments?.(item.id)
                setObjFileExists(result?.success && result.segments?.length > 0)
            } catch (error) {
                console.error(
                    `Failed to list model segments for item ${item.id}:`,
                    error,
                )
                setObjFileExists(false)
            }
        }

        checkObjExists()
    }, [item?.id, isConverting, formData?.modelName])

    // Get the expected OBJ file path for the model
    // Models are stored persistently in .bpee/{itemName}/models/
    const getObjPath = () => {
        if (!item?.id || !item?.packagePath) return null

        const itemName = item.id.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase()
        const modelsDir = `${item.packagePath}/.bpee/${itemName}/models`

        // Return directory path - backend will find OBJ files
        return modelsDir
    }

    // Get the expected MTL file path for the model
    const getMtlPath = () => {
        const objPath = getObjPath()
        if (!objPath) return null
        return objPath.replace(/\.obj$/i, ".mtl")
    }

    // Get display name for the current selection
    const getInstanceDisplayName = () => {
        if (!selectedInstanceKey) return null
        return selectedInstanceKey // Just return the variable name (e.g., "TIMER DELAY", "DEFAULT")
    }

    const handleMakeModel = async () => {
        if (!selectedInstanceKey || isConverting) return

        setIsConverting(true)
        setConversionProgress("🚀 Starting conversion...")

        // Notify parent that generation is starting
        onModelGenerationStart?.()

        try {
            // selectedInstanceKey now contains the selected variable name (e.g., "TIMER DELAY", "DEFAULT")
            // Backend will handle mapping variable to appropriate instance

            // Ask backend to resolve the VMF path and convert
            const result = await window.package.convertInstanceToObj(
                item.id,
                selectedInstanceKey, // This is now a variable name, not an instance key
                { textureStyle: skipCartoonify ? "raw" : "cartoon", isVariable: true },
            )
            if (result?.success) {
                // Extract staged editoritems from result
                const stagedEditorItems = result.mdlResult?.stagedEditorItems || result.stagedEditorItems

                // Notify parent that generation is complete with staged data
                onModelGenerationComplete?.(stagedEditorItems)

                // Check MDL conversion result
                if (result.mdlResult?.success) {
                    console.log(
                        `Generated model "${result.mdlResult.relativeModelPath}" for item "${item.name}"`,
                    )
                    await window.electron.showMessageBox({
                        type: 'info',
                        title: 'Model Generated Successfully',
                        message: 'Model generated successfully!',
                        detail: `OBJ: ${result.objPath}\nMDL: ${result.mdlResult.relativeModelPath}\n\nChanges will be applied when you click Save in the editor.`,
                        buttons: ['OK']
                    })
                } else if (result.mdlResult?.error) {
                    console.warn(
                        `Generated the OBJ for item "${item.name}" but failed to convert it to MDL:`,
                        result.mdlResult.error,
                    )
                    await window.electron.showMessageBox({
                        type: 'warning',
                        title: 'Partial Success',
                        message: 'OBJ model created successfully, but MDL conversion failed',
                        detail: `${result.mdlResult.error}\n\nYou can still preview the OBJ model.`,
                        buttons: ['OK']
                    })
                } else {
                    console.log(
                        `Generated the OBJ for item "${item.name}", MDL conversion was skipped`,
                    )
                }
            } else {
                console.error(
                    `Failed to generate a model for item "${item.name}":`,
                    result?.error,
                )
                // Notify parent that generation is complete (no staged data)
                onModelGenerationComplete?.(null)
            }
        } catch (error) {
            console.error(
                `Failed to generate a model for item "${item?.name}":`,
                error,
            )
            // Notify parent that generation is complete (no staged data)
            onModelGenerationComplete?.(null)
        } finally {
            setIsConverting(false)
            setConversionProgress("")
        }
    }

    const handlePreview = async () => {
        if (!selectedInstanceKey || !item?.id) return

        // Get list of available model segments
        const segmentsResult = await window.package?.listModelSegments?.(item.id)

        if (!segmentsResult?.success || !segmentsResult.segments?.length) {
            await window.electron.showMessageBox({
                type: 'warning',
                title: 'No Models Found',
                message: 'No model files found. Please click "Make Model" first to generate the 3D model.',
                buttons: ['OK']
            })
            return
        }

        const segments = segmentsResult.segments
        const firstSegment = segments[0]
        const title = `${getInstanceDisplayName() || "Instance"} - ${item?.name || "Model"}`

        try {
            // Pass first segment's path and all segments for dropdown switching
            await window.package?.showModelPreview?.(
                firstSegment.path,
                firstSegment.mtlPath,
                title,
                segments
            )
        } catch (e) {
            console.error(
                `Failed to open the model preview for item "${item?.name}":`,
                e,
            )
        }
    }

    return (
        <Box>
            <Box
                sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    mb: 2,
                }}>
                <Typography variant="h6">Other</Typography>
            </Box>

            <Stack spacing={2} sx={{ height: "100%" }}>
                {/* Warning for missing editor model - show if no model selected and no custom model generated */}
                {!item?.metadata?.hasCustomModel && !formData.modelName && (
                    <Alert severity="warning" icon={<Warning />}>
                        Editor model is required - select a model or generate one below
                    </Alert>
                )}

                {/* Model Chooser */}
                <Box>
                    <Typography variant="subtitle1" sx={{ mb: 1 }}>
                        Model Chooser
                    </Typography>
                    <Autocomplete
                        freeSolo
                        options={(() => {
                            // Build options list: predefined models + generated models (if any)
                            const options = [...predefinedModels]
                            
                            // If modelName starts with "bpee/" but no OBJ exists, add it to "Generated Models"
                            if (formData.modelName && 
                                typeof formData.modelName === 'string' && 
                                formData.modelName.startsWith('bpee/') && 
                                !objFileExists) {
                                // Extract a display name from the model path
                                const modelPath = formData.modelName
                                const fileName = modelPath.split('/').pop() || modelPath
                                const displayName = fileName.replace(/\.mdl$/i, '')
                                
                                // Add to Generated Models category if not already in options
                                const alreadyExists = options.some(opt => opt.value === modelPath)
                                if (!alreadyExists) {
                                    options.push({
                                        category: "Generated Models",
                                        label: displayName,
                                        value: modelPath
                                    })
                                }
                            }
                            
                            return options
                        })()}
                        groupBy={(option) => option.category}
                        getOptionLabel={(option) => {
                            // Handle both string (custom) and object (predefined) values
                            if (typeof option === "string") return option
                            return option.value
                        }}
                        renderOption={(props, option) => (
                            <li {...props}>
                                <Box>
                                    <Typography variant="body2">
                                        {option.label}
                                    </Typography>
                                    <Typography
                                        variant="caption"
                                        color="text.secondary">
                                        {option.value}
                                    </Typography>
                                </Box>
                            </li>
                        )}
                        value={
                            (() => {
                                // If modelName starts with "bpee/" and OBJ exists, show "Custom"
                                // If modelName starts with "bpee/" and NO OBJ exists, show raw path
                                if (formData.modelName && formData.modelName.startsWith('bpee/')) {
                                    return objFileExists ? "Generate" : formData.modelName
                                }
                                return formData.modelName || ""
                            })()
                        }
                        onChange={(event, newValue) => {
                            // Handle both object (selected from list) and string (typed in)
                            const modelValue =
                                typeof newValue === "string"
                                    ? newValue
                                    : newValue?.value || ""
                            onUpdate("modelName", modelValue, "other")
                        }}
                        renderInput={(params) => (
                            <TextField
                                {...params}
                                label="Model Name"
                                placeholder="Select or enter model..."
                                helperText="Choose a predefined model or enter a custom path"
                            />
                        )}
                    />
                </Box>

                {/* Model Generator - shown when "Custom" is selected OR custom bpee/ model exists with OBJ files */}
                <Collapse in={formData.modelName === "Generate" || (formData.modelName && formData.modelName.startsWith('bpee/') && objFileExists)} timeout={300}>
                    <Divider sx={{ my: 1 }} />

                    <Box>
                        <Typography variant="subtitle1" sx={{ mb: 1 }}>
                            Model Generator
                        </Typography>
                        {!portal2Status?.features?.modelGeneration && (
                            <Alert severity="warning" sx={{ mb: 2 }}>
                                Portal 2 not detected. Model generation requires Portal 2
                                to be installed for STUDIOMDL compilation.
                            </Alert>
                        )}
                        {vbspVariables.length === 0 && (
                            <Alert severity="info" sx={{ mb: 2 }}>
                                Add at least one instance to enable model generation.
                            </Alert>
                        )}
                        <Box>
                            <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ mb: 2, display: "block" }}>
                                Generates models based on your conditions config. Example:{" "}
                                <Box component="span" sx={{ fontWeight: 500 }}>
                                    Start Enabled
                                </Box>{" "}
                                creates on/off state models.
                            </Typography>
                            <FormControl
                                size="small"
                                fullWidth
                                disabled={
                                    !portal2Status?.features?.modelGeneration ||
                                    vbspVariables.length === 0
                                }>
                                <InputLabel id="variable-select-label">
                                    Generation Type
                                </InputLabel>
                                <Select
                                    labelId="variable-select-label"
                                    label="Generation Type"
                                    value={selectedInstanceKey}
                                    onChange={(e) =>
                                        setSelectedInstanceKey(e.target.value)
                                    }
                                    fullWidth>
                                    {vbspVariables.length === 0 ? (
                                        <MenuItem value="" disabled>
                                            No variables available
                                        </MenuItem>
                                    ) : (
                                        vbspVariables.map((varName) => (
                                            <MenuItem key={varName} value={varName}>
                                                {varName}
                                            </MenuItem>
                                        ))
                                    )}
                                </Select>
                            </FormControl>
                        </Box>
                        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} alignItems="center" justifyContent="space-between">
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={skipCartoonify}
                                        onChange={(e) => setSkipCartoonify(e.target.checked)}
                                        size="small"
                                        sx={{ py: 0, pl: 0.5 }}
                                    />
                                }
                                label={
                                    <Typography variant="body2" color="text.secondary">
                                        Use original textures
                                    </Typography>
                                }
                                sx={{ m: 0, ml: -0.5 }}
                            />
                            {/* If custom bpee/ model exists with OBJ files, Preview becomes primary (large) button */}
                            {formData.modelName && formData.modelName.startsWith('bpee/') && objFileExists ? (
                                <Stack direction="row" spacing={1}>
                                    <Tooltip
                                        title={
                                            vbspVariables.length === 0
                                                ? "Add at least one instance"
                                                : !portal2Status?.features?.modelGeneration
                                                  ? "Portal 2 required"
                                                  : !objFileExists
                                                    ? "Generate model first"
                                                    : ""
                                        }>
                                        <span>
                                            <Button
                                                variant="contained"
                                                onClick={handlePreview}
                                                disabled={
                                                    !selectedInstanceKey ||
                                                    !portal2Status?.features?.modelGeneration ||
                                                    vbspVariables.length === 0 ||
                                                    !objFileExists
                                                }
                                                startIcon={<Preview />}>
                                                Preview
                                            </Button>
                                        </span>
                                    </Tooltip>
                                    <Tooltip
                                        title={
                                            vbspVariables.length === 0
                                                ? "Add at least one instance"
                                                : !portal2Status?.features?.modelGeneration
                                                  ? "Portal 2 required"
                                                  : ""
                                        }>
                                        <span>
                                            <Button
                                                variant="outlined"
                                                onClick={handleMakeModel}
                                                disabled={
                                                    !selectedInstanceKey ||
                                                    isConverting ||
                                                    !portal2Status?.features?.modelGeneration ||
                                                    vbspVariables.length === 0
                                                }
                                                sx={{ flexShrink: 0 }}>
                                                {isConverting ? "Generating..." : "Regenerate"}
                                            </Button>
                                        </span>
                                    </Tooltip>
                                </Stack>
                            ) : (
                                <Stack direction="row" spacing={1}>
                                    <Tooltip
                                        title={
                                            vbspVariables.length === 0
                                                ? "Add at least one instance"
                                                : !portal2Status?.features?.modelGeneration
                                                  ? "Portal 2 required"
                                                  : !objFileExists
                                                    ? "Generate model first"
                                                    : ""
                                        }>
                                        <span>
                                            <Button
                                                variant="outlined"
                                                onClick={handlePreview}
                                                disabled={
                                                    !selectedInstanceKey ||
                                                    !portal2Status?.features?.modelGeneration ||
                                                    vbspVariables.length === 0 ||
                                                    !objFileExists
                                                }
                                                startIcon={<Preview />}>
                                                Preview
                                            </Button>
                                        </span>
                                    </Tooltip>
                                    <Tooltip
                                        title={
                                            vbspVariables.length === 0
                                                ? "Add at least one instance"
                                                : !portal2Status?.features?.modelGeneration
                                                  ? "Portal 2 required"
                                                  : ""
                                        }>
                                        <span>
                                            <Button
                                                variant="contained"
                                                onClick={handleMakeModel}
                                                disabled={
                                                    !selectedInstanceKey ||
                                                    isConverting ||
                                                    !portal2Status?.features?.modelGeneration ||
                                                    vbspVariables.length === 0
                                                }
                                                startIcon={
                                                    isConverting ? (
                                                        <CircularProgress
                                                            size={20}
                                                            color="inherit"
                                                        />
                                                    ) : null
                                                }>
                                                {isConverting ? "Generating..." : "Make Model"}
                                            </Button>
                                        </span>
                                    </Tooltip>
                                </Stack>
                            )}
                        </Stack>
                    </Box>
                    <Alert severity="warning" sx={{ mb: 2 , mt: 1}}>
                        Always view the model after generation.
                        Model generation from VMFs are not always accurate.
                    </Alert>
                </Collapse>
            </Stack>
        </Box>
    )
}

export default Other
