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
import { useState, useEffect, useCallback, useRef } from "react"

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

/**
 * Model Chooser option for a model the icon maker made (Info tab > Make
 * Icon). Its value isn't a model name, so it can't be taken for a typed one.
 */
function iconModelOption({ instanceKey, name }, canMakeModels) {
    return {
        category: "Made in the icon maker",
        label: `Instance ${instanceKey}: ${name}`,
        value: `icon-maker:${instanceKey}`,
        caption: canMakeModels
            ? "Use as the editor model"
            : "Needs Portal 2 to make the model",
        instanceKey,
    }
}

function Other({ item, formData, onUpdate, onUpdateOther, onModelGenerationStart, onModelGenerationComplete, onBeforeMakeModel }) {
    const [selectedInstanceKey, setSelectedInstanceKey] = useState("")
    const [isConverting, setIsConverting] = useState(false)
    const [conversionProgress, setConversionProgress] = useState("")
    const [vbspVariables, setVbspVariables] = useState([])
    const [portal2Status, setPortal2Status] = useState(null)
    const [objFileExists, setObjFileExists] = useState(false)
    const [skipCartoonify, setSkipCartoonify] = useState(false)
    // The models the icon maker has made for the item: [{ instanceKey, name }]
    const [iconModels, setIconModels] = useState([])
    const iconModelsRequest = useRef(0)
    // The instance whose icon maker model is being made the item's model
    const [iconModelKey, setIconModelKey] = useState(null)
    // The model made from an icon maker model last: not the Model
    // Generator's, even when that has made models too
    const [iconModelPath, setIconModelPath] = useState(null)
    // A message under the Model Chooser or in the Model Generator:
    // { place: "chooser" | "generator", severity, text }
    const [notice, setNotice] = useState(null)
    // The Model Chooser's text
    const [modelInput, setModelInput] = useState("")

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

    // The models the icon maker has made, for the Model Chooser (listed again
    // when it opens: the icon maker may have made more since)
    const refreshIconModels = useCallback(async () => {
        if (!item?.id || !window.package?.listIconModels) return
        // Only the latest answer is used
        const request = ++iconModelsRequest.current
        try {
            const result = await window.package.listIconModels(item.id)
            if (request !== iconModelsRequest.current) return
            if (!result?.success) {
                throw new Error(result?.error || "No reason given")
            }
            setIconModels(result.models ?? [])
        } catch (error) {
            if (request !== iconModelsRequest.current) return
            console.warn(
                `Failed to list the icon maker's models of item "${item.name}":`,
                error,
            )
            setIconModels([])
        }
    }, [item])

    useEffect(() => {
        refreshIconModels()
    }, [refreshIconModels])

    // "Save the item to apply it" is done with once the item is saved (or
    // reloaded)
    useEffect(() => {
        setNotice(null)
    }, [item])

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

    // Open the model preview window (segments: models to switch between)
    const openModelPreview = async (objPath, mtlPath, title, segments = null) => {
        try {
            await window.package?.showModelPreview?.(
                objPath,
                mtlPath,
                title,
                segments,
            )
        } catch (error) {
            console.error(
                `Failed to open the model preview for item "${item?.name}":`,
                error,
            )
        }
    }

    // Preview the Model Generator's models: the first, and the others to
    // switch to. False when it hasn't made any.
    const previewGeneratorModels = async (title) => {
        let segments = []
        try {
            const result = await window.package?.listModelSegments?.(item.id)
            if (result?.success) segments = result.segments ?? []
        } catch (error) {
            console.error(
                `Failed to list model segments for item ${item?.id}:`,
                error,
            )
        }
        if (segments.length === 0) return false
        await openModelPreview(
            segments[0].path,
            segments[0].mtlPath,
            title,
            segments,
        )
        return true
    }

    const handleMakeModel = async () => {
        if (!selectedInstanceKey || isConverting) return

        // Models are made from the saved instances: the editor saves the
        // item first when its instances changed (asking), or stops
        if (onBeforeMakeModel && !(await onBeforeMakeModel())) return

        setIsConverting(true)
        setConversionProgress("🚀 Starting conversion...")
        setNotice(null)

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
                // The item's model is the Model Generator's now
                if (stagedEditorItems) setIconModelPath(null)

                // Check MDL conversion result
                if (result.mdlResult?.success) {
                    console.log(
                        `Generated model "${result.mdlResult.relativeModelPath}" for item "${item.name}"`,
                    )
                    setNotice({
                        place: "generator",
                        severity: "success",
                        text: "Model generated. Save the item to apply it.",
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
                    // One model per variant (the log says how many)
                    console.log(`Generated the models of item "${item.name}"`)
                    setNotice({
                        place: "generator",
                        severity: "success",
                        text: "Models generated. Save the item to apply them.",
                    })
                }

                // Show what was made (the OBJ also when the MDL failed)
                const title = `${getInstanceDisplayName() || "Instance"} - ${item.name}`
                if (result.objPath) {
                    await openModelPreview(result.objPath, result.mtlPath, title)
                } else if (!(await previewGeneratorModels(title))) {
                    console.warn(
                        `Item "${item.name}" has no generated model to preview`,
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

        const title = `${getInstanceDisplayName() || "Instance"} - ${item?.name || "Model"}`
        if (!(await previewGeneratorModels(title))) {
            await window.electron.showMessageBox({
                type: 'warning',
                title: 'No Models Found',
                message: 'No model files found. Please click "Make Model" first to generate the 3D model.',
                buttons: ['OK']
            })
        }
    }

    // Make the item's model from a model the icon maker made (no VMF to
    // convert again), then open its preview
    const handleUseIconModel = async ({ instanceKey, label }) => {
        if (!item?.id || isConverting) return

        setIsConverting(true)
        setIconModelKey(instanceKey)
        setNotice(null)
        onModelGenerationStart?.()

        try {
            const result = await window.package.makeModelFromIconModel(
                item.id,
                instanceKey,
            )
            if (!result?.success) {
                throw new Error(result?.error || "No reason given")
            }
            const { stagedEditorItems, relativeModelPath } = result.mdlResult
            console.log(
                `Made model "${relativeModelPath}" for item "${item.name}" from the icon maker's model of instance ${instanceKey}`,
            )
            onModelGenerationComplete?.(stagedEditorItems)

            // The chooser shows the new model (not as the Model Generator's)
            setIconModelPath(relativeModelPath)
            onUpdate("modelName", relativeModelPath, "other")
            setNotice({
                place: "chooser",
                severity: "success",
                text: `Made the model from the icon maker's model of instance ${instanceKey}. Save the item to apply it.`,
            })

            await openModelPreview(
                result.objPath,
                result.mtlPath,
                `${label} - ${item.name}`,
            )
        } catch (error) {
            console.error(
                `Failed to make the model of item "${item.name}" from the icon maker's model of instance ${instanceKey}:`,
                error,
            )
            setNotice({
                place: "chooser",
                severity: "error",
                text: `Couldn't make the model from the icon maker's model of instance ${instanceKey}: ${error.message}`,
            })
            onModelGenerationComplete?.(null)
        } finally {
            setIsConverting(false)
            setIconModelKey(null)
        }
    }

    // A model the Model Generator made: the chooser shows it as "Generate",
    // with the generator to preview or remake it
    const isGeneratorModel =
        typeof formData.modelName === "string" &&
        formData.modelName.startsWith("bpee/") &&
        objFileExists &&
        formData.modelName !== iconModelPath
    const chooserValue = isGeneratorModel ? "Generate" : formData.modelName || ""

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
                        disabled={isConverting}
                        options={(() => {
                            // Build options list: predefined models + the icon maker's models + generated models (if any)
                            const options = [...predefinedModels]

                            const canMakeModels = !!portal2Status?.features?.modelGeneration
                            for (const model of iconModels) {
                                options.push(iconModelOption(model, canMakeModels))
                            }
                            
                            // If modelName starts with "bpee/" but isn't the Model Generator's, add it to "Generated Models"
                            if (formData.modelName && 
                                typeof formData.modelName === 'string' && 
                                formData.modelName.startsWith('bpee/') && 
                                !isGeneratorModel) {
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
                            // The icon maker's models go by name (their value isn't a model name)
                            if (option.instanceKey !== undefined) return option.label
                            return option.value
                        }}
                        // Making a model from the icon maker's needs studiomdl
                        getOptionDisabled={(option) =>
                            option.instanceKey !== undefined &&
                            !portal2Status?.features?.modelGeneration
                        }
                        renderOption={({ key, ...props }, option) => (
                            <li key={key} {...props}>
                                <Box>
                                    <Typography variant="body2">
                                        {option.label}
                                    </Typography>
                                    <Typography
                                        variant="caption"
                                        color="text.secondary">
                                        {option.caption ?? option.value}
                                    </Typography>
                                </Box>
                            </li>
                        )}
                        // The Model Generator's model shows as "Generate", others by name
                        value={chooserValue}
                        inputValue={modelInput}
                        onInputChange={(event, text) => setModelInput(text)}
                        // The icon maker may have made models since
                        onOpen={refreshIconModels}
                        onChange={(event, newValue) => {
                            setNotice(null)

                            // An icon maker model: the model name is set once
                            // the model is made from it
                            if (typeof newValue === "object" && newValue?.instanceKey !== undefined) {
                                setModelInput(chooserValue)
                                handleUseIconModel(newValue)
                                return
                            }

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
                    {iconModelKey !== null && (
                        <Alert
                            severity="info"
                            icon={<CircularProgress size={20} color="inherit" />}
                            sx={{ mt: 1 }}>
                            Making the model from the icon maker's model of
                            instance {iconModelKey}...
                        </Alert>
                    )}
                    {notice?.place === "chooser" && (
                        <Alert
                            severity={notice.severity}
                            onClose={() => setNotice(null)}
                            sx={{ mt: 1 }}>
                            {notice.text}
                        </Alert>
                    )}
                </Box>

                {/* Model Generator - shown when "Generate" is selected OR the Model Generator's bpee/ model exists with OBJ files */}
                <Collapse in={formData.modelName === "Generate" || isGeneratorModel} timeout={300}>
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
                            {/* If the Model Generator's bpee/ model exists with OBJ files, Preview becomes primary (large) button */}
                            {isGeneratorModel ? (
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
                        {notice?.place === "generator" && (
                            <Alert
                                severity={notice.severity}
                                onClose={() => setNotice(null)}
                                sx={{ mt: 1.5 }}>
                                {notice.text}
                            </Alert>
                        )}
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
