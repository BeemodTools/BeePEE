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
    TextField,
    IconButton,
    DialogContentText,
    Tooltip,
    Chip,
    Tabs,
    Tab,
    Alert,
    AlertTitle,
    Accordion,
    AccordionSummary,
    AccordionDetails,
    MenuItem,
    FormControlLabel,
    Checkbox,
    Divider,
    Card,
    CardContent,
    CircularProgress,
} from "@mui/material"
import {
    Edit,
    Delete,
    Add,
    Input as InputIcon,
    Output as OutputIcon,
    ExpandMore,
    EditNote,
    GroupWork,
    Build,
    Warning,
} from "@mui/icons-material"
import { useState, useEffect } from "react"

const INPUT_TYPES = [
    { value: "AND", label: "Simple Input" },
    { value: "DUAL", label: "Dual Input (A/B)" },
    { value: "AND", label: "AND Logic" },
    { value: "OR", label: "OR Logic" },
]

function InputOutputConfigDialog({
    open,
    onClose,
    onSave,
    config,
    title,
    isEdit = false,
    itemId,
    item,
}) {
    const [formData, setFormData] = useState({
        Type: "AND",
        Enable_cmd: "",
        Disable_cmd: "",
        // Dual input fields
        Sec_Enable_cmd: "",
        Sec_Disable_cmd: "",
        // Output fields
        Out_Activate: "",
        Out_Deactivate: "",
        ...config,
    })
    const [error, setError] = useState("")
    const [entities, setEntities] = useState({})
    const [fgdData, setFgdData] = useState({})
    const [loading, setLoading] = useState(false)
    const [portal2Status, setPortal2Status] = useState(null)
    const [useFallbackMode, setUseFallbackMode] = useState(false)

    // State for building commands with dropdowns
    const [enableEntity, setEnableEntity] = useState("")
    const [enableInput, setEnableInput] = useState("")
    const [enableParam, setEnableParam] = useState("")
    const [enableDelay, setEnableDelay] = useState("0")
    const [enableMaxFires, setEnableMaxFires] = useState("-1")

    const [disableEntity, setDisableEntity] = useState("")
    const [disableInput, setDisableInput] = useState("")
    const [disableParam, setDisableParam] = useState("")
    const [disableDelay, setDisableDelay] = useState("0")
    const [disableMaxFires, setDisableMaxFires] = useState("-1")

    // Secondary input states
    const [secEnableEntity, setSecEnableEntity] = useState("")
    const [secEnableInput, setSecEnableInput] = useState("")
    const [secEnableParam, setSecEnableParam] = useState("")
    const [secEnableDelay, setSecEnableDelay] = useState("0")
    const [secEnableMaxFires, setSecEnableMaxFires] = useState("-1")

    const [secDisableEntity, setSecDisableEntity] = useState("")
    const [secDisableInput, setSecDisableInput] = useState("")
    const [secDisableParam, setSecDisableParam] = useState("")
    const [secDisableDelay, setSecDisableDelay] = useState("0")
    const [secDisableMaxFires, setSecDisableMaxFires] = useState("-1")

    // Output states
    // Note: outputs have no delay/max-fires - the editoritems output format
    // is just "instance:entity;output", those settings only exist on inputs
    const [activateEntity, setActivateEntity] = useState("")
    const [activateOutput, setActivateOutput] = useState("")
    const [activateParam, setActivateParam] = useState("")

    const [deactivateEntity, setDeactivateEntity] = useState("")
    const [deactivateOutput, setDeactivateOutput] = useState("")
    const [deactivateParam, setDeactivateParam] = useState("")

    useEffect(() => {
        if (open && itemId) {
            loadEntityData()
            setFormData({
                Type: "AND",
                Enable_cmd: "",
                Disable_cmd: "",
                // Dual input fields
                Sec_Enable_cmd: "",
                Sec_Disable_cmd: "",
                // Output fields
                Out_Activate: "",
                Out_Deactivate: "",
                ...config,
            })
            // Don't parse existing commands here - wait for FGD data to load
            setError("")
        }
    }, [open, config, itemId, JSON.stringify(item?.instances)])

    // Clear entity selections when instances change (to handle deleted instances)
    useEffect(() => {
        if (open && itemId && item?.instances) {
            // Clear all entity selections when instances change
            setEnableEntity("")
            setEnableInput("")
            setEnableParam("")
            setDisableEntity("")
            setDisableInput("")
            setDisableParam("")
            setSecEnableEntity("")
            setSecEnableInput("")
            setSecEnableParam("")
            setSecDisableEntity("")
            setSecDisableInput("")
            setSecDisableParam("")
            setActivateEntity("")
            setActivateOutput("")
            setActivateParam("")
            setDeactivateEntity("")
            setDeactivateOutput("")
            setDeactivateParam("")
        }
    }, [JSON.stringify(item?.instances), open, itemId])

    const loadEntityData = async () => {
        setLoading(true)
        try {
            // Check Portal 2 status first
            const p2Status = await window.package?.getPortal2Status?.()
            setPortal2Status(p2Status)

            const [entitiesResult, fgdResult] = await Promise.all([
                window.package.getItemEntities(itemId),
                window.package.getFgdData(),
            ])

            if (entitiesResult.success) {
                setEntities(entitiesResult.entities)
            } else {
                console.error(
                    `Failed to load the instance entities of item "${item?.name}":`,
                    entitiesResult.error,
                )
            }

            if (fgdResult.success && Object.keys(fgdResult.entities || {}).length > 0) {
                setFgdData(fgdResult.entities)
                setUseFallbackMode(false)
            } else {
                console.warn(
                    "FGD data is not available, using fallback text mode for I/O commands",
                )
                setFgdData({})
                setUseFallbackMode(true)
            }

            // Parse existing commands will be handled by the useEffect below
        } catch (error) {
            console.error(
                `Failed to load entity data for item "${item?.name}":`,
                error,
            )
            setUseFallbackMode(true)
        } finally {
            setLoading(false)
        }
    }

    // Parse existing commands once the entity data is loaded. Also without
    // FGD data (Portal 2 not found): skipping them then showed every field
    // empty and the delay as 0, and editing one wiped the saved command
    useEffect(() => {
        if (open && Object.keys(entities).length > 0 && config) {
            parseExistingCommands()
        }
    }, [entities, fgdData, open, config])

    const parseExistingCommands = () => {
        // Without FGD data input/output names are typed in, so keep any name
        const noFgd = Object.keys(fgdData).length === 0
        // Parse existing command strings back into dropdown selections
        if (config.Enable_cmd) {
            const parts = config.Enable_cmd.split(",")
            if (parts.length >= 2) {
                // Only set entity if it exists in entities
                if (entities[parts[0]]) {
                    setEnableEntity(parts[0])
                    // Only set input if it exists for this entity
                    const availableInputs = getAvailableInputsForEntity(
                        parts[0],
                    )
                    if (
                        noFgd ||
                        availableInputs.some((input) => input.name === parts[1])
                    ) {
                        setEnableInput(parts[1])
                    }
                }
                if (parts.length >= 3) setEnableParam(parts[2] || "")
                if (parts.length >= 4) setEnableDelay(parts[3] || "0")
                if (parts.length >= 5) setEnableMaxFires(parts[4] || "-1")
            }
        }
        if (config.Disable_cmd) {
            const parts = config.Disable_cmd.split(",")
            if (parts.length >= 2) {
                // Only set entity if it exists in entities
                if (entities[parts[0]]) {
                    setDisableEntity(parts[0])
                    // Only set input if it exists for this entity
                    const availableInputs = getAvailableInputsForEntity(
                        parts[0],
                    )
                    if (
                        noFgd ||
                        availableInputs.some((input) => input.name === parts[1])
                    ) {
                        setDisableInput(parts[1])
                    }
                }
                if (parts.length >= 3) setDisableParam(parts[2] || "")
                if (parts.length >= 4) setDisableDelay(parts[3] || "0")
                if (parts.length >= 5) setDisableMaxFires(parts[4] || "-1")
            }
        }
        if (config.Sec_Enable_cmd) {
            const parts = config.Sec_Enable_cmd.split(",")
            if (parts.length >= 2) {
                // Only set entity if it exists in entities
                if (entities[parts[0]]) {
                    setSecEnableEntity(parts[0])
                    // Only set input if it exists for this entity
                    const availableInputs = getAvailableInputsForEntity(
                        parts[0],
                    )
                    if (
                        noFgd ||
                        availableInputs.some((input) => input.name === parts[1])
                    ) {
                        setSecEnableInput(parts[1])
                    }
                }
                if (parts.length >= 3) setSecEnableParam(parts[2] || "")
                if (parts.length >= 4) setSecEnableDelay(parts[3] || "0")
                if (parts.length >= 5) setSecEnableMaxFires(parts[4] || "-1")
            }
        }
        if (config.Sec_Disable_cmd) {
            const parts = config.Sec_Disable_cmd.split(",")
            if (parts.length >= 2) {
                // Only set entity if it exists in entities
                if (entities[parts[0]]) {
                    setSecDisableEntity(parts[0])
                    // Only set input if it exists for this entity
                    const availableInputs = getAvailableInputsForEntity(
                        parts[0],
                    )
                    if (
                        noFgd ||
                        availableInputs.some((input) => input.name === parts[1])
                    ) {
                        setSecDisableInput(parts[1])
                    }
                }
                if (parts.length >= 3) setSecDisableParam(parts[2] || "")
                if (parts.length >= 4) setSecDisableDelay(parts[3] || "0")
                if (parts.length >= 5) setSecDisableMaxFires(parts[4] || "-1")
            }
        }
        if (config.out_activate) {
            // For outputs, parse instance:entity;output format
            if (config.out_activate.startsWith("instance:")) {
                const instancePart = config.out_activate.substring(9) // Remove 'instance:'
                const parts = instancePart.split(";")
                if (parts.length >= 2) {
                    // Only set entity if it exists in entities
                    if (entities[parts[0]]) {
                        setActivateEntity(parts[0])
                        // Only set output if it exists for this entity
                        const availableOutputs = getAvailableOutputsForEntity(
                            parts[0],
                        )
                        if (
                            noFgd ||
                            availableOutputs.some(
                                (output) => output.name === parts[1],
                            )
                        ) {
                            setActivateOutput(parts[1])
                        }
                    }
                }
            }
        }
        if (config.out_deactivate) {
            // For outputs, parse instance:entity;output format
            if (config.out_deactivate.startsWith("instance:")) {
                const instancePart = config.out_deactivate.substring(9) // Remove 'instance:'
                const parts = instancePart.split(";")
                if (parts.length >= 2) {
                    // Only set entity if it exists in entities
                    if (entities[parts[0]]) {
                        setDeactivateEntity(parts[0])
                        // Only set output if it exists for this entity
                        const availableOutputs = getAvailableOutputsForEntity(
                            parts[0],
                        )
                        if (
                            noFgd ||
                            availableOutputs.some(
                                (output) => output.name === parts[1],
                            )
                        ) {
                            setDeactivateOutput(parts[1])
                        }
                    }
                }
            }
        }
    }

    const buildCommand = (
        entity,
        inputOutput,
        param = "",
        delay = "0",
        maxFires = "-1",
    ) => {
        if (!entity || !inputOutput) return ""
        return `${entity},${inputOutput},${param},${delay},${maxFires}`
    }

    const buildOutputCommand = (entity, outputName, param = "") => {
        if (!entity || !outputName) return ""
        // For outputs, we might need parameters in the future, but for now keep the instance format
        return `instance:${entity};${outputName}`
    }

    // Update form data when selections change
    useEffect(() => {
        setFormData((prev) => ({
            ...prev,
            Enable_cmd: buildCommand(
                enableEntity,
                enableInput,
                enableParam,
                enableDelay,
                enableMaxFires,
            ),
            Disable_cmd: buildCommand(
                disableEntity,
                disableInput,
                disableParam,
                disableDelay,
                disableMaxFires,
            ),
            Sec_Enable_cmd: buildCommand(
                secEnableEntity,
                secEnableInput,
                secEnableParam,
                secEnableDelay,
                secEnableMaxFires,
            ),
            Sec_Disable_cmd: buildCommand(
                secDisableEntity,
                secDisableInput,
                secDisableParam,
                secDisableDelay,
                secDisableMaxFires,
            ),
            out_activate: buildOutputCommand(
                activateEntity,
                activateOutput,
                activateParam,
            ),
            out_deactivate: buildOutputCommand(
                deactivateEntity,
                deactivateOutput,
                deactivateParam,
            ),
        }))
    }, [
        enableEntity,
        enableInput,
        enableParam,
        enableDelay,
        enableMaxFires,
        disableEntity,
        disableInput,
        disableParam,
        disableDelay,
        disableMaxFires,
        secEnableEntity,
        secEnableInput,
        secEnableParam,
        secEnableDelay,
        secEnableMaxFires,
        secDisableEntity,
        secDisableInput,
        secDisableParam,
        secDisableDelay,
        secDisableMaxFires,
        activateEntity,
        activateOutput,
        activateParam,
        deactivateEntity,
        deactivateOutput,
        deactivateParam,
    ])

    const handleSave = () => {
        // Filter out empty fields
        const cleanedData = Object.fromEntries(
            Object.entries(formData).filter(
                ([key, value]) => value.trim() !== "",
            ),
        )

        if (Object.keys(cleanedData).length === 0) {
            setError("At least one field must be filled")
            return
        }

        onSave(cleanedData)
        onClose()
    }

    const updateFormData = (field, value) => {
        setFormData((prev) => ({ ...prev, [field]: value }))
    }

    const isInput = title.includes("Input")
    const isDualInput = formData.Type === "DUAL"

    // Count entity name occurrences to detect duplicates
    const entityNameCounts = {}
    Object.keys(entities).forEach((entityName) => {
        const baseName = entityName.replace(/_\d+$/, "") // Remove trailing numbers
        entityNameCounts[baseName] = (entityNameCounts[baseName] || 0) + 1
    })

    const entityOptions = Object.keys(entities).map((entityName) => {
        const baseName = entityName.replace(/_\d+$/, "")
        const hasDuplicates = entityNameCounts[baseName] > 1

        return {
            value: entityName,
            label: `${entityName} (${entities[entityName]})`,
            hasDuplicates,
        }
    })

    const getAvailableInputsForEntity = (entityName) => {
        const entityClass = entities[entityName]
        const fgdEntity = fgdData[entityClass]
        return fgdEntity?.inputs || []
    }

    const getAvailableOutputsForEntity = (entityName) => {
        const entityClass = entities[entityName]
        const fgdEntity = fgdData[entityClass]
        return fgdEntity?.outputs || []
    }

    // Helper functions to check if an input/output needs parameters
    const inputNeedsParam = (entityName, inputName) => {
        const inputs = getAvailableInputsForEntity(entityName)
        const input = inputs.find((inp) => inp.name === inputName)
        return input?.needsParam || false
    }

    const outputNeedsParam = (entityName, outputName) => {
        const outputs = getAvailableOutputsForEntity(entityName)
        const output = outputs.find((out) => out.name === outputName)
        return output?.needsParam || false
    }

    // Validation functions
    const isValidInputConfig = () => {
        if (!isInput) return true // Not validating output here

        // Must have enable entity and input
        if (!enableEntity || !enableInput) return false

        // If input needs parameter, parameter must be provided
        if (inputNeedsParam(enableEntity, enableInput) && !enableParam.trim())
            return false

        // For dual inputs, must have disable entity and input
        if (isDualInput) {
            if (!disableEntity || !disableInput) return false
            if (
                inputNeedsParam(disableEntity, disableInput) &&
                !disableParam.trim()
            )
                return false
        }

        return true
    }

    const isValidOutputConfig = () => {
        if (isInput) return true // Not validating input here

        // Must have activate entity and output
        if (!activateEntity || !activateOutput) return false

        // If output needs parameter, parameter must be provided
        if (
            outputNeedsParam(activateEntity, activateOutput) &&
            !activateParam.trim()
        )
            return false

        // If there's a secondary enable config, it must be complete
        if (secEnableEntity || secEnableInput) {
            if (!secEnableEntity || !secEnableInput) return false
            if (
                inputNeedsParam(secEnableEntity, secEnableInput) &&
                !secEnableParam.trim()
            )
                return false
        }

        // If there's a secondary disable config, it must be complete
        if (secDisableEntity || secDisableInput) {
            if (!secDisableEntity || !secDisableInput) return false
            if (
                inputNeedsParam(secDisableEntity, secDisableInput) &&
                !secDisableParam.trim()
            )
                return false
        }

        // If there's a deactivate config, it must be complete
        if (deactivateEntity || deactivateOutput) {
            if (!deactivateEntity || !deactivateOutput) return false
            if (
                outputNeedsParam(deactivateEntity, deactivateOutput) &&
                !deactivateParam.trim()
            )
                return false
        }

        return true
    }

    const isConfigValid = isInput ? isValidInputConfig() : isValidOutputConfig()

    // Get specific validation error message
    const getValidationError = () => {
        if (isInput) {
            if (!enableEntity) return "Please select an enable entity"
            if (!enableInput) return "Please select an enable input"
            if (
                inputNeedsParam(enableEntity, enableInput) &&
                !enableParam.trim()
            ) {
                return "This input requires a parameter"
            }
            if (isDualInput) {
                if (!disableEntity) return "Please select a disable entity"
                if (!disableInput) return "Please select a disable input"
                if (
                    inputNeedsParam(disableEntity, disableInput) &&
                    !disableParam.trim()
                ) {
                    return "This disable input requires a parameter"
                }
            }
        } else {
            if (!activateEntity) return "Please select an activate entity"
            if (!activateOutput) return "Please select an activate output"
            if (
                outputNeedsParam(activateEntity, activateOutput) &&
                !activateParam.trim()
            ) {
                return "This output requires a parameter"
            }
            if (secEnableEntity && !secEnableInput)
                return "Please select a secondary enable input"
            if (!secEnableEntity && secEnableInput)
                return "Please select a secondary enable entity"
            if (
                secEnableEntity &&
                secEnableInput &&
                inputNeedsParam(secEnableEntity, secEnableInput) &&
                !secEnableParam.trim()
            ) {
                return "This secondary enable input requires a parameter"
            }
            if (secDisableEntity && !secDisableInput)
                return "Please select a secondary disable input"
            if (!secDisableEntity && secDisableInput)
                return "Please select a secondary disable entity"
            if (
                secDisableEntity &&
                secDisableInput &&
                inputNeedsParam(secDisableEntity, secDisableInput) &&
                !secDisableParam.trim()
            ) {
                return "This secondary disable input requires a parameter"
            }
            if (deactivateEntity && !deactivateOutput)
                return "Please select a deactivate output"
            if (!deactivateEntity && deactivateOutput)
                return "Please select a deactivate entity"
            if (
                deactivateEntity &&
                deactivateOutput &&
                outputNeedsParam(deactivateEntity, deactivateOutput) &&
                !deactivateParam.trim()
            ) {
                return "This deactivate output requires a parameter"
            }
        }
        return ""
    }

    if (loading) {
        return (
            <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
                <DialogContent sx={{ textAlign: "center", py: 4 }}>
                    <Typography>Loading entity data...</Typography>
                </DialogContent>
            </Dialog>
        )
    }

    // Hybrid mode: We always use the rich UI now, even without Portal 2
    // The difference is that without FGD data, input/output fields become text inputs
    const hasFgdData = !useFallbackMode

    return (
        <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
            <DialogTitle>{title}</DialogTitle>
            <DialogContent sx={{ overflowX: "hidden" }}>
                <Stack spacing={3} sx={{ mt: 1 }}>
                    {!hasFgdData && (
                        <Alert severity="info">
                            Portal 2 FGD not detected. Entity selector is available, but input/output names must be entered manually.
                        </Alert>
                    )}

                    {isInput && (
                        <>
                            <TextField
                                select
                                label="Input Type"
                                value={formData.Type}
                                onChange={(e) =>
                                    updateFormData("Type", e.target.value)
                                }
                                fullWidth
                                helperText="Choose the type of input behavior"
                                sx={{ mb: 2 }}>
                                {INPUT_TYPES.map((option) => (
                                    <MenuItem
                                        key={option.value}
                                        value={option.value}>
                                        {option.label}
                                    </MenuItem>
                                ))}
                            </TextField>

                            <Box>
                                <Typography
                                    variant="subtitle2"
                                    gutterBottom
                                    color="text.secondary">
                                    Primary Input Commands
                                </Typography>
                                <Stack spacing={2}>
                                    {/* Enable Command Card */}
                                    <Card
                                        variant="outlined"
                                        sx={{ overflow: "hidden" }}>
                                        <CardContent sx={{ p: 2 }}>
                                            <Typography
                                                variant="caption"
                                                color="text.secondary"
                                                sx={{
                                                    mb: 1,
                                                    display: "block",
                                                }}>
                                                Enable Command
                                            </Typography>
                                            <Box
                                                sx={{
                                                    overflowX: "auto",
                                                    width: "100%",
                                                    minHeight: "80px",
                                                    py: 1,
                                                    "&::-webkit-scrollbar": {
                                                        height: 8,
                                                    },
                                                    "&::-webkit-scrollbar-track":
                                                        {
                                                            backgroundColor:
                                                                "rgba(0,0,0,0.1)",
                                                            borderRadius: 4,
                                                        },
                                                    "&::-webkit-scrollbar-thumb":
                                                        {
                                                            backgroundColor:
                                                                "rgba(0,0,0,0.3)",
                                                            borderRadius: 4,
                                                        },
                                                }}>
                                                <Box
                                                    sx={{
                                                        display: "grid",
                                                        gridTemplateColumns:
                                                            "200px 180px 150px 100px 100px",
                                                        gap: 2,
                                                        alignItems: "center",
                                                        minWidth: "max-content",
                                                        width: "max-content",
                                                        height: "100%",
                                                    }}>
                                                    <TextField
                                                        select
                                                        label="Enable Entity"
                                                        value={enableEntity}
                                                        onChange={(e) =>
                                                            setEnableEntity(
                                                                e.target.value,
                                                            )
                                                        }
                                                        size="small"
                                                        sx={{
                                                            minWidth: "200px",
                                                            height: "56px",
                                                        }}>
                                                        {entityOptions.length ===
                                                        0 ? (
                                                            <MenuItem disabled>
                                                                No entities
                                                                found in
                                                                instances
                                                            </MenuItem>
                                                        ) : (
                                                            entityOptions.map(
                                                                (option) => (
                                                                    <MenuItem
                                                                        key={
                                                                            option.value
                                                                        }
                                                                        value={
                                                                            option.value
                                                                        }>
                                                                        <Box
                                                                            sx={{
                                                                                display:
                                                                                    "flex",
                                                                                alignItems:
                                                                                    "center",
                                                                                justifyContent:
                                                                                    "space-between",
                                                                                width: "100%",
                                                                            }}>
                                                                            <span
                                                                                style={{
                                                                                    fontWeight:
                                                                                        option.hasDuplicates
                                                                                            ? "bold"
                                                                                            : "normal",
                                                                                }}>
                                                                                {
                                                                                    option.label
                                                                                }
                                                                            </span>
                                                                            {option.hasDuplicates && (
                                                                                <GroupWork
                                                                                    sx={{
                                                                                        fontSize: 16,
                                                                                        opacity: 0.6,
                                                                                        color: "primary.main",
                                                                                    }}
                                                                                />
                                                                            )}
                                                                        </Box>
                                                                    </MenuItem>
                                                                ),
                                                            )
                                                        )}
                                                    </TextField>

                                                    {hasFgdData ? (
                                                        <TextField
                                                            select
                                                            label="Enable Input"
                                                            value={enableInput}
                                                            onChange={(e) =>
                                                                setEnableInput(
                                                                    e.target.value,
                                                                )
                                                            }
                                                            disabled={!enableEntity}
                                                            size="small"
                                                            sx={{
                                                                minWidth: "180px",
                                                                height: "56px",
                                                            }}>
                                                            {getAvailableInputsForEntity(
                                                                enableEntity,
                                                            ).map((input) => (
                                                                <MenuItem
                                                                    key={input.name}
                                                                    value={
                                                                        input.name
                                                                    }>
                                                                    <Box
                                                                        sx={{
                                                                            display:
                                                                                "flex",
                                                                            alignItems:
                                                                                "center",
                                                                            justifyContent:
                                                                                "space-between",
                                                                            width: "100%",
                                                                        }}>
                                                                        {input.name}
                                                                        {input.needsParam && (
                                                                            <EditNote
                                                                                sx={{
                                                                                    fontSize: 16,
                                                                                    opacity: 0.6,
                                                                                    color: "text.secondary",
                                                                                }}
                                                                            />
                                                                        )}
                                                                    </Box>
                                                                </MenuItem>
                                                            ))}
                                                        </TextField>
                                                    ) : (
                                                        <TextField
                                                            label="Enable Input"
                                                            value={enableInput}
                                                            onChange={(e) =>
                                                                setEnableInput(
                                                                    e.target.value,
                                                                )
                                                            }
                                                            disabled={!enableEntity}
                                                            placeholder="InputName"
                                                            size="small"
                                                            sx={{
                                                                minWidth: "180px",
                                                                height: "56px",
                                                            }}
                                                        />
                                                    )}

                                                    <Tooltip title="Additional parameter value to pass to the input (if required)">
                                                        <TextField
                                                            label="Parameter"
                                                            value={enableParam}
                                                            onChange={(e) =>
                                                                setEnableParam(
                                                                    e.target
                                                                        .value,
                                                                )
                                                            }
                                                            placeholder={
                                                                hasFgdData && inputNeedsParam(
                                                                    enableEntity,
                                                                    enableInput,
                                                                )
                                                                    ? "param"
                                                                    : hasFgdData ? "not required" : "optional"
                                                            }
                                                            disabled={
                                                                hasFgdData && !inputNeedsParam(
                                                                    enableEntity,
                                                                    enableInput,
                                                                )
                                                            }
                                                            size="small"
                                                            sx={{
                                                                minWidth:
                                                                    "150px",
                                                                height: "56px",
                                                            }}
                                                        />
                                                    </Tooltip>

                                                    <TextField
                                                        label="Delay (s)"
                                                        value={enableDelay}
                                                        onChange={(e) =>
                                                            setEnableDelay(
                                                                e.target.value,
                                                            )
                                                        }
                                                        type="number"
                                                        slotProps={{
                                                            htmlInput: {
                                                                step: 1,
                                                                min: 0,
                                                            },
                                                        }}
                                                        size="small"
                                                        sx={{
                                                            minWidth: "100px",
                                                            height: "56px",
                                                        }}
                                                    />

                                                    <Tooltip title="Maximum number of times this input can fire (-1 for unlimited)">
                                                        <TextField
                                                            label="Max Fires"
                                                            value={
                                                                enableMaxFires
                                                            }
                                                            onChange={(e) =>
                                                                setEnableMaxFires(
                                                                    e.target
                                                                        .value,
                                                                )
                                                            }
                                                            placeholder="-1"
                                                            size="small"
                                                            sx={{
                                                                minWidth:
                                                                    "100px",
                                                                height: "56px",
                                                            }}
                                                        />
                                                    </Tooltip>
                                                </Box>
                                            </Box>
                                        </CardContent>
                                    </Card>

                                    {/* Disable Command Card */}
                                    <Card
                                        variant="outlined"
                                        sx={{ overflow: "hidden" }}>
                                        <CardContent sx={{ p: 2 }}>
                                            <Typography
                                                variant="caption"
                                                color="text.secondary"
                                                sx={{
                                                    mb: 1,
                                                    display: "block",
                                                }}>
                                                Disable Command
                                            </Typography>
                                            <Box
                                                sx={{
                                                    overflowX: "auto",
                                                    width: "100%",
                                                    minHeight: "80px",
                                                    py: 1,
                                                    "&::-webkit-scrollbar": {
                                                        height: 8,
                                                    },
                                                    "&::-webkit-scrollbar-track":
                                                        {
                                                            backgroundColor:
                                                                "rgba(0,0,0,0.1)",
                                                            borderRadius: 4,
                                                        },
                                                    "&::-webkit-scrollbar-thumb":
                                                        {
                                                            backgroundColor:
                                                                "rgba(0,0,0,0.3)",
                                                            borderRadius: 4,
                                                        },
                                                }}>
                                                <Box
                                                    sx={{
                                                        display: "grid",
                                                        gridTemplateColumns:
                                                            "200px 180px 150px 100px 100px",
                                                        gap: 2,
                                                        alignItems: "center",
                                                        minWidth: "max-content",
                                                        width: "max-content",
                                                        height: "100%",
                                                    }}>
                                                    <TextField
                                                        select
                                                        label="Disable Entity"
                                                        value={disableEntity}
                                                        onChange={(e) =>
                                                            setDisableEntity(
                                                                e.target.value,
                                                            )
                                                        }
                                                        size="small"
                                                        sx={{
                                                            minWidth: "200px",
                                                            height: "56px",
                                                        }}>
                                                        {entityOptions.length ===
                                                        0 ? (
                                                            <MenuItem disabled>
                                                                No entities
                                                                found in
                                                                instances
                                                            </MenuItem>
                                                        ) : (
                                                            entityOptions.map(
                                                                (option) => (
                                                                    <MenuItem
                                                                        key={
                                                                            option.value
                                                                        }
                                                                        value={
                                                                            option.value
                                                                        }>
                                                                        <Box
                                                                            sx={{
                                                                                display:
                                                                                    "flex",
                                                                                alignItems:
                                                                                    "center",
                                                                                justifyContent:
                                                                                    "space-between",
                                                                                width: "100%",
                                                                            }}>
                                                                            <span
                                                                                style={{
                                                                                    fontWeight:
                                                                                        option.hasDuplicates
                                                                                            ? "bold"
                                                                                            : "normal",
                                                                                }}>
                                                                                {
                                                                                    option.label
                                                                                }
                                                                            </span>
                                                                            {option.hasDuplicates && (
                                                                                <GroupWork
                                                                                    sx={{
                                                                                        fontSize: 16,
                                                                                        opacity: 0.6,
                                                                                        color: "primary.main",
                                                                                    }}
                                                                                />
                                                                            )}
                                                                        </Box>
                                                                    </MenuItem>
                                                                ),
                                                            )
                                                        )}
                                                    </TextField>

                                                    {hasFgdData ? (
                                                        <TextField
                                                            select
                                                            label="Disable Input"
                                                            value={disableInput}
                                                            onChange={(e) =>
                                                                setDisableInput(
                                                                    e.target.value,
                                                                )
                                                            }
                                                            disabled={
                                                                !disableEntity
                                                            }
                                                            size="small"
                                                            sx={{
                                                                minWidth: "180px",
                                                                height: "56px",
                                                            }}>
                                                            {getAvailableInputsForEntity(
                                                                disableEntity,
                                                            ).map((input) => (
                                                                <MenuItem
                                                                    key={input.name}
                                                                    value={
                                                                        input.name
                                                                    }>
                                                                    <Box
                                                                        sx={{
                                                                            display:
                                                                                "flex",
                                                                            alignItems:
                                                                                "center",
                                                                            justifyContent:
                                                                                "space-between",
                                                                            width: "100%",
                                                                        }}>
                                                                        {input.name}
                                                                        {input.needsParam && (
                                                                            <EditNote
                                                                                sx={{
                                                                                    fontSize: 16,
                                                                                    opacity: 0.6,
                                                                                    color: "text.secondary",
                                                                                }}
                                                                            />
                                                                        )}
                                                                    </Box>
                                                                </MenuItem>
                                                            ))}
                                                        </TextField>
                                                    ) : (
                                                        <TextField
                                                            label="Disable Input"
                                                            value={disableInput}
                                                            onChange={(e) =>
                                                                setDisableInput(
                                                                    e.target.value,
                                                                )
                                                            }
                                                            disabled={!disableEntity}
                                                            placeholder="InputName"
                                                            size="small"
                                                            sx={{
                                                                minWidth: "180px",
                                                                height: "56px",
                                                            }}
                                                        />
                                                    )}

                                                    <Tooltip title="Additional parameter value to pass to the input (if required)">
                                                        <TextField
                                                            label="Parameter"
                                                            value={disableParam}
                                                            onChange={(e) =>
                                                                setDisableParam(
                                                                    e.target
                                                                        .value,
                                                                )
                                                            }
                                                            placeholder={
                                                                hasFgdData && inputNeedsParam(
                                                                    disableEntity,
                                                                    disableInput,
                                                                )
                                                                    ? "param"
                                                                    : hasFgdData ? "not required" : "optional"
                                                            }
                                                            disabled={
                                                                hasFgdData && !inputNeedsParam(
                                                                    disableEntity,
                                                                    disableInput,
                                                                )
                                                            }
                                                            size="small"
                                                            sx={{
                                                                minWidth:
                                                                    "150px",
                                                                height: "56px",
                                                            }}
                                                        />
                                                    </Tooltip>

                                                    <TextField
                                                        label="Delay (s)"
                                                        value={disableDelay}
                                                        onChange={(e) =>
                                                            setDisableDelay(
                                                                e.target.value,
                                                            )
                                                        }
                                                        type="number"
                                                        slotProps={{
                                                            htmlInput: {
                                                                step: 1,
                                                                min: 0,
                                                            },
                                                        }}
                                                        size="small"
                                                        sx={{
                                                            minWidth: "100px",
                                                            height: "56px",
                                                        }}
                                                    />

                                                    <Tooltip title="Maximum number of times this input can fire (-1 for unlimited)">
                                                        <TextField
                                                            label="Max Fires"
                                                            value={
                                                                disableMaxFires
                                                            }
                                                            onChange={(e) =>
                                                                setDisableMaxFires(
                                                                    e.target
                                                                        .value,
                                                                )
                                                            }
                                                            placeholder="-1"
                                                            size="small"
                                                            sx={{
                                                                minWidth:
                                                                    "100px",
                                                                height: "56px",
                                                            }}
                                                        />
                                                    </Tooltip>
                                                </Box>
                                            </Box>
                                        </CardContent>
                                    </Card>

                                    {/* Show the built commands as preview */}
                                    {(formData.Enable_cmd ||
                                        formData.Disable_cmd) && (
                                        <Box
                                            sx={{
                                                mt: 2,
                                                p: 2,
                                                bgcolor: "action.hover",
                                                borderRadius: 1,
                                            }}>
                                            <Typography
                                                variant="caption"
                                                color="text.secondary">
                                                Generated Commands:
                                            </Typography>
                                            {formData.Enable_cmd && (
                                                <Typography
                                                    variant="body2"
                                                    sx={{
                                                        fontFamily: "monospace",
                                                        fontSize: "0.75rem",
                                                    }}>
                                                    Enable:{" "}
                                                    {formData.Enable_cmd}
                                                </Typography>
                                            )}
                                            {formData.Disable_cmd && (
                                                <Typography
                                                    variant="body2"
                                                    sx={{
                                                        fontFamily: "monospace",
                                                        fontSize: "0.75rem",
                                                    }}>
                                                    Disable:{" "}
                                                    {formData.Disable_cmd}
                                                </Typography>
                                            )}
                                        </Box>
                                    )}
                                </Stack>
                            </Box>

                            {isDualInput && (
                                <Box>
                                    <Typography
                                        variant="subtitle2"
                                        gutterBottom
                                        color="text.secondary">
                                        Secondary Input Commands (Channel B)
                                    </Typography>
                                    <Stack spacing={2}>
                                        {/* Secondary Enable Command Card */}
                                        <Card
                                            variant="outlined"
                                            sx={{ overflow: "hidden" }}>
                                            <CardContent sx={{ p: 2 }}>
                                                <Typography
                                                    variant="caption"
                                                    color="text.secondary"
                                                    sx={{
                                                        mb: 1,
                                                        display: "block",
                                                    }}>
                                                    Enable Command (Channel B)
                                                </Typography>
                                                <Box
                                                    sx={{
                                                        overflowX: "auto",
                                                        width: "100%",
                                                        minHeight: "80px",
                                                        py: 1,
                                                        "&::-webkit-scrollbar":
                                                            {
                                                                height: 8,
                                                            },
                                                        "&::-webkit-scrollbar-track":
                                                            {
                                                                backgroundColor:
                                                                    "rgba(0,0,0,0.1)",
                                                                borderRadius: 4,
                                                            },
                                                        "&::-webkit-scrollbar-thumb":
                                                            {
                                                                backgroundColor:
                                                                    "rgba(0,0,0,0.3)",
                                                                borderRadius: 4,
                                                            },
                                                    }}>
                                                    <Box
                                                        sx={{
                                                            display: "grid",
                                                            gridTemplateColumns:
                                                                "200px 180px 150px 100px 100px",
                                                            gap: 2,
                                                            alignItems:
                                                                "center",
                                                            minWidth:
                                                                "max-content",
                                                            width: "max-content",
                                                            height: "100%",
                                                        }}>
                                                        <TextField
                                                            select
                                                            label="Enable Entity (B)"
                                                            value={
                                                                secEnableEntity
                                                            }
                                                            onChange={(e) =>
                                                                setSecEnableEntity(
                                                                    e.target
                                                                        .value,
                                                                )
                                                            }
                                                            size="small"
                                                            sx={{
                                                                minWidth:
                                                                    "200px",
                                                                height: "56px",
                                                            }}>
                                                            {entityOptions.length ===
                                                            0 ? (
                                                                <MenuItem
                                                                    disabled>
                                                                    No entities
                                                                    found in
                                                                    instances
                                                                </MenuItem>
                                                            ) : (
                                                                entityOptions.map(
                                                                    (
                                                                        option,
                                                                    ) => (
                                                                        <MenuItem
                                                                            key={
                                                                                option.value
                                                                            }
                                                                            value={
                                                                                option.value
                                                                            }>
                                                                            <Box
                                                                                sx={{
                                                                                    display:
                                                                                        "flex",
                                                                                    alignItems:
                                                                                        "center",
                                                                                    justifyContent:
                                                                                        "space-between",
                                                                                    width: "100%",
                                                                                }}>
                                                                                <span
                                                                                    style={{
                                                                                        fontWeight:
                                                                                            option.hasDuplicates
                                                                                                ? "bold"
                                                                                                : "normal",
                                                                                    }}>
                                                                                    {
                                                                                        option.label
                                                                                    }
                                                                                </span>
                                                                                {option.hasDuplicates && (
                                                                                    <GroupWork
                                                                                        sx={{
                                                                                            fontSize: 16,
                                                                                            opacity: 0.6,
                                                                                            color: "primary.main",
                                                                                        }}
                                                                                    />
                                                                                )}
                                                                            </Box>
                                                                        </MenuItem>
                                                                    ),
                                                                )
                                                            )}
                                                        </TextField>

                                                        {hasFgdData ? (
                                                            <TextField
                                                                select
                                                                label="Enable Input (B)"
                                                                value={
                                                                    secEnableInput
                                                                }
                                                                onChange={(e) =>
                                                                    setSecEnableInput(
                                                                        e.target
                                                                            .value,
                                                                    )
                                                                }
                                                                disabled={
                                                                    !secEnableEntity
                                                                }
                                                                size="small"
                                                                sx={{
                                                                    minWidth:
                                                                        "180px",
                                                                    height: "56px",
                                                                }}>
                                                                {getAvailableInputsForEntity(
                                                                    secEnableEntity,
                                                                ).map((input) => (
                                                                    <MenuItem
                                                                        key={
                                                                            input.name
                                                                        }
                                                                        value={
                                                                            input.name
                                                                        }>
                                                                        <Box
                                                                            sx={{
                                                                                display:
                                                                                    "flex",
                                                                                alignItems:
                                                                                    "center",
                                                                                justifyContent:
                                                                                    "space-between",
                                                                                width: "100%",
                                                                            }}>
                                                                            {
                                                                                input.name
                                                                            }
                                                                            {input.needsParam && (
                                                                                <EditNote
                                                                                    sx={{
                                                                                        fontSize: 16,
                                                                                        opacity: 0.6,
                                                                                        color: "text.secondary",
                                                                                    }}
                                                                                />
                                                                            )}
                                                                        </Box>
                                                                    </MenuItem>
                                                                ))}
                                                            </TextField>
                                                        ) : (
                                                            <TextField
                                                                label="Enable Input (B)"
                                                                value={secEnableInput}
                                                                onChange={(e) =>
                                                                    setSecEnableInput(
                                                                        e.target.value,
                                                                    )
                                                                }
                                                                disabled={!secEnableEntity}
                                                                placeholder="InputName"
                                                                size="small"
                                                                sx={{
                                                                    minWidth: "180px",
                                                                    height: "56px",
                                                                }}
                                                            />
                                                        )}

                                                        <Tooltip title="Additional parameter value to pass to the input (if required)">
                                                            <TextField
                                                                label="Parameter"
                                                                value={
                                                                    secEnableParam
                                                                }
                                                                onChange={(e) =>
                                                                    setSecEnableParam(
                                                                        e.target
                                                                            .value,
                                                                    )
                                                                }
                                                                placeholder={
                                                                    hasFgdData && inputNeedsParam(
                                                                        secEnableEntity,
                                                                        secEnableInput,
                                                                    )
                                                                        ? "param"
                                                                        : hasFgdData ? "not required" : "optional"
                                                                }
                                                                disabled={
                                                                    hasFgdData && !inputNeedsParam(
                                                                        secEnableEntity,
                                                                        secEnableInput,
                                                                    )
                                                                }
                                                                size="small"
                                                                sx={{
                                                                    minWidth:
                                                                        "150px",
                                                                    height: "56px",
                                                                }}
                                                            />
                                                        </Tooltip>

                                                        <TextField
                                                            label="Delay (s)"
                                                            value={
                                                                secEnableDelay
                                                            }
                                                            onChange={(e) =>
                                                                setSecEnableDelay(
                                                                    e.target
                                                                        .value,
                                                                )
                                                            }
                                                            type="number"
                                                            slotProps={{
                                                                htmlInput: {
                                                                    step: 1,
                                                                    min: 0,
                                                                },
                                                            }}
                                                            size="small"
                                                            sx={{
                                                                minWidth:
                                                                    "100px",
                                                                height: "56px",
                                                            }}
                                                        />

                                                        <Tooltip title="Maximum number of times this input can fire (-1 for unlimited)">
                                                            <TextField
                                                                label="Max Fires"
                                                                value={
                                                                    secEnableMaxFires
                                                                }
                                                                onChange={(e) =>
                                                                    setSecEnableMaxFires(
                                                                        e.target
                                                                            .value,
                                                                    )
                                                                }
                                                                placeholder="-1"
                                                                size="small"
                                                                sx={{
                                                                    minWidth:
                                                                        "100px",
                                                                    height: "56px",
                                                                }}
                                                            />
                                                        </Tooltip>
                                                    </Box>
                                                </Box>
                                            </CardContent>
                                        </Card>

                                        {/* Secondary Disable Command Card */}
                                        <Card
                                            variant="outlined"
                                            sx={{ overflow: "hidden" }}>
                                            <CardContent sx={{ p: 2 }}>
                                                <Typography
                                                    variant="caption"
                                                    color="text.secondary"
                                                    sx={{
                                                        mb: 1,
                                                        display: "block",
                                                    }}>
                                                    Disable Command (Channel B)
                                                </Typography>
                                                <Box
                                                    sx={{
                                                        overflowX: "auto",
                                                        width: "100%",
                                                        minHeight: "80px",
                                                        py: 1,
                                                        "&::-webkit-scrollbar":
                                                            {
                                                                height: 8,
                                                            },
                                                        "&::-webkit-scrollbar-track":
                                                            {
                                                                backgroundColor:
                                                                    "rgba(0,0,0,0.1)",
                                                                borderRadius: 4,
                                                            },
                                                        "&::-webkit-scrollbar-thumb":
                                                            {
                                                                backgroundColor:
                                                                    "rgba(0,0,0,0.3)",
                                                                borderRadius: 4,
                                                            },
                                                    }}>
                                                    <Box
                                                        sx={{
                                                            display: "grid",
                                                            gridTemplateColumns:
                                                                "200px 180px 150px 100px 100px",
                                                            gap: 2,
                                                            alignItems:
                                                                "center",
                                                            minWidth:
                                                                "max-content",
                                                            width: "max-content",
                                                            height: "100%",
                                                        }}>
                                                        <TextField
                                                            select
                                                            label="Disable Entity (B)"
                                                            value={
                                                                secDisableEntity
                                                            }
                                                            onChange={(e) =>
                                                                setSecDisableEntity(
                                                                    e.target
                                                                        .value,
                                                                )
                                                            }
                                                            size="small"
                                                            sx={{
                                                                minWidth:
                                                                    "200px",
                                                                height: "56px",
                                                            }}>
                                                            {entityOptions.length ===
                                                            0 ? (
                                                                <MenuItem
                                                                    disabled>
                                                                    No entities
                                                                    found in
                                                                    instances
                                                                </MenuItem>
                                                            ) : (
                                                                entityOptions.map(
                                                                    (
                                                                        option,
                                                                    ) => (
                                                                        <MenuItem
                                                                            key={
                                                                                option.value
                                                                            }
                                                                            value={
                                                                                option.value
                                                                            }>
                                                                            <Box
                                                                                sx={{
                                                                                    display:
                                                                                        "flex",
                                                                                    alignItems:
                                                                                        "center",
                                                                                    justifyContent:
                                                                                        "space-between",
                                                                                    width: "100%",
                                                                                }}>
                                                                                <span
                                                                                    style={{
                                                                                        fontWeight:
                                                                                            option.hasDuplicates
                                                                                                ? "bold"
                                                                                                : "normal",
                                                                                    }}>
                                                                                    {
                                                                                        option.label
                                                                                    }
                                                                                </span>
                                                                                {option.hasDuplicates && (
                                                                                    <GroupWork
                                                                                        sx={{
                                                                                            fontSize: 16,
                                                                                            opacity: 0.6,
                                                                                            color: "primary.main",
                                                                                        }}
                                                                                    />
                                                                                )}
                                                                            </Box>
                                                                        </MenuItem>
                                                                    ),
                                                                )
                                                            )}
                                                        </TextField>

                                                        {hasFgdData ? (
                                                            <TextField
                                                                select
                                                                label="Disable Input (B)"
                                                                value={
                                                                    secDisableInput
                                                                }
                                                                onChange={(e) =>
                                                                    setSecDisableInput(
                                                                        e.target
                                                                            .value,
                                                                    )
                                                                }
                                                                disabled={
                                                                    !secDisableEntity
                                                                }
                                                                size="small"
                                                                sx={{
                                                                    minWidth:
                                                                        "180px",
                                                                    height: "56px",
                                                                }}>
                                                                {getAvailableInputsForEntity(
                                                                    secDisableEntity,
                                                                ).map((input) => (
                                                                    <MenuItem
                                                                        key={
                                                                            input.name
                                                                        }
                                                                        value={
                                                                            input.name
                                                                        }>
                                                                        <Box
                                                                            sx={{
                                                                                display:
                                                                                    "flex",
                                                                                alignItems:
                                                                                    "center",
                                                                                justifyContent:
                                                                                    "space-between",
                                                                                width: "100%",
                                                                            }}>
                                                                            {
                                                                                input.name
                                                                            }
                                                                            {input.needsParam && (
                                                                                <EditNote
                                                                                    sx={{
                                                                                        fontSize: 16,
                                                                                        opacity: 0.6,
                                                                                        color: "text.secondary",
                                                                                    }}
                                                                                />
                                                                            )}
                                                                        </Box>
                                                                    </MenuItem>
                                                                ))}
                                                            </TextField>
                                                        ) : (
                                                            <TextField
                                                                label="Disable Input (B)"
                                                                value={secDisableInput}
                                                                onChange={(e) =>
                                                                    setSecDisableInput(
                                                                        e.target.value,
                                                                    )
                                                                }
                                                                disabled={!secDisableEntity}
                                                                placeholder="InputName"
                                                                size="small"
                                                                sx={{
                                                                    minWidth: "180px",
                                                                    height: "56px",
                                                                }}
                                                            />
                                                        )}

                                                        <Tooltip title="Additional parameter value to pass to the input (if required)">
                                                            <TextField
                                                                label="Parameter"
                                                                value={
                                                                    secDisableParam
                                                                }
                                                                onChange={(e) =>
                                                                    setSecDisableParam(
                                                                        e.target
                                                                            .value,
                                                                    )
                                                                }
                                                                placeholder={
                                                                    hasFgdData && inputNeedsParam(
                                                                        secDisableEntity,
                                                                        secDisableInput,
                                                                    )
                                                                        ? "param"
                                                                        : hasFgdData ? "not required" : "optional"
                                                                }
                                                                disabled={
                                                                    hasFgdData && !inputNeedsParam(
                                                                        secDisableEntity,
                                                                        secDisableInput,
                                                                    )
                                                                }
                                                                size="small"
                                                                sx={{
                                                                    minWidth:
                                                                        "150px",
                                                                    height: "56px",
                                                                }}
                                                            />
                                                        </Tooltip>

                                                        <TextField
                                                            label="Delay (s)"
                                                            value={
                                                                secDisableDelay
                                                            }
                                                            onChange={(e) =>
                                                                setSecDisableDelay(
                                                                    e.target
                                                                        .value,
                                                                )
                                                            }
                                                            type="number"
                                                            slotProps={{
                                                                htmlInput: {
                                                                    step: 1,
                                                                    min: 0,
                                                                },
                                                            }}
                                                            size="small"
                                                            sx={{
                                                                minWidth:
                                                                    "100px",
                                                                height: "56px",
                                                            }}
                                                        />

                                                        <Tooltip title="Maximum number of times this input can fire (-1 for unlimited)">
                                                            <TextField
                                                                label="Max Fires"
                                                                value={
                                                                    secDisableMaxFires
                                                                }
                                                                onChange={(e) =>
                                                                    setSecDisableMaxFires(
                                                                        e.target
                                                                            .value,
                                                                    )
                                                                }
                                                                placeholder="-1"
                                                                size="small"
                                                                sx={{
                                                                    minWidth:
                                                                        "100px",
                                                                    height: "56px",
                                                                }}
                                                            />
                                                        </Tooltip>
                                                    </Box>
                                                </Box>
                                            </CardContent>
                                        </Card>

                                        {/* Show secondary commands preview */}
                                        {(formData.Sec_Enable_cmd ||
                                            formData.Sec_Disable_cmd) && (
                                            <Box
                                                sx={{
                                                    mt: 2,
                                                    p: 2,
                                                    bgcolor: "action.hover",
                                                    borderRadius: 1,
                                                }}>
                                                <Typography
                                                    variant="caption"
                                                    color="text.secondary">
                                                    Generated Secondary
                                                    Commands:
                                                </Typography>
                                                {formData.Sec_Enable_cmd && (
                                                    <Typography
                                                        variant="body2"
                                                        sx={{
                                                            fontFamily:
                                                                "monospace",
                                                            fontSize: "0.75rem",
                                                        }}>
                                                        Enable (B):{" "}
                                                        {
                                                            formData.Sec_Enable_cmd
                                                        }
                                                    </Typography>
                                                )}
                                                {formData.Sec_Disable_cmd && (
                                                    <Typography
                                                        variant="body2"
                                                        sx={{
                                                            fontFamily:
                                                                "monospace",
                                                            fontSize: "0.75rem",
                                                        }}>
                                                        Disable (B):{" "}
                                                        {
                                                            formData.Sec_Disable_cmd
                                                        }
                                                    </Typography>
                                                )}
                                            </Box>
                                        )}
                                    </Stack>
                                </Box>
                            )}
                        </>
                    )}

                    {!isInput && (
                        <Box>
                            <Typography
                                variant="subtitle2"
                                gutterBottom
                                color="text.secondary">
                                Output Commands
                            </Typography>
                            <Stack spacing={2}>
                                {/* Activate Command Card */}
                                <Card
                                    variant="outlined"
                                    sx={{ overflow: "hidden" }}>
                                    <CardContent sx={{ p: 2 }}>
                                        <Typography
                                            variant="caption"
                                            color="text.secondary"
                                            sx={{ mb: 1, display: "block" }}>
                                            Activate Command
                                        </Typography>
                                        <Box
                                            sx={{
                                                overflowX: "auto",
                                                width: "100%",
                                                minHeight: "80px",
                                                py: 1,
                                                "&::-webkit-scrollbar": {
                                                    height: 8,
                                                },
                                                "&::-webkit-scrollbar-track": {
                                                    backgroundColor:
                                                        "rgba(0,0,0,0.1)",
                                                    borderRadius: 4,
                                                },
                                                "&::-webkit-scrollbar-thumb": {
                                                    backgroundColor:
                                                        "rgba(0,0,0,0.3)",
                                                    borderRadius: 4,
                                                },
                                            }}>
                                            <Box
                                                sx={{
                                                    display: "grid",
                                                    gridTemplateColumns:
                                                        "200px 180px 150px",
                                                    gap: 2,
                                                    alignItems: "center",
                                                    minWidth: "max-content",
                                                    width: "max-content",
                                                    height: "100%",
                                                }}>
                                                <TextField
                                                    select
                                                    label="Activate Entity"
                                                    value={activateEntity}
                                                    onChange={(e) =>
                                                        setActivateEntity(
                                                            e.target.value,
                                                        )
                                                    }
                                                    size="small"
                                                    sx={{
                                                        minWidth: "200px",
                                                        height: "56px",
                                                    }}>
                                                    {entityOptions.length ===
                                                    0 ? (
                                                        <MenuItem disabled>
                                                            No entities found in
                                                            instances
                                                        </MenuItem>
                                                    ) : (
                                                        entityOptions.map(
                                                            (option) => (
                                                                <MenuItem
                                                                    key={
                                                                        option.value
                                                                    }
                                                                    value={
                                                                        option.value
                                                                    }>
                                                                    <Box
                                                                        sx={{
                                                                            display:
                                                                                "flex",
                                                                            alignItems:
                                                                                "center",
                                                                            justifyContent:
                                                                                "space-between",
                                                                            width: "100%",
                                                                        }}>
                                                                        <span
                                                                            style={{
                                                                                fontWeight:
                                                                                    option.hasDuplicates
                                                                                        ? "bold"
                                                                                        : "normal",
                                                                            }}>
                                                                            {
                                                                                option.label
                                                                            }
                                                                        </span>
                                                                        {option.hasDuplicates && (
                                                                            <GroupWork
                                                                                sx={{
                                                                                    fontSize: 16,
                                                                                    opacity: 0.6,
                                                                                    color: "primary.main",
                                                                                }}
                                                                            />
                                                                        )}
                                                                    </Box>
                                                                </MenuItem>
                                                            ),
                                                        )
                                                    )}
                                                </TextField>

                                                {hasFgdData ? (
                                                    <TextField
                                                        select
                                                        label="Activate Output"
                                                        value={activateOutput}
                                                        onChange={(e) =>
                                                            setActivateOutput(
                                                                e.target.value,
                                                            )
                                                        }
                                                        disabled={!activateEntity}
                                                        size="small"
                                                        sx={{
                                                            minWidth: "180px",
                                                            height: "56px",
                                                        }}>
                                                        {getAvailableOutputsForEntity(
                                                            activateEntity,
                                                        ).map((output) => (
                                                            <MenuItem
                                                                key={output.name}
                                                                value={output.name}>
                                                                <Box
                                                                    sx={{
                                                                        display:
                                                                            "flex",
                                                                        alignItems:
                                                                            "center",
                                                                        justifyContent:
                                                                            "space-between",
                                                                        width: "100%",
                                                                    }}>
                                                                    {output.name}
                                                                    {output.needsParam && (
                                                                        <EditNote
                                                                            sx={{
                                                                                fontSize: 16,
                                                                                opacity: 0.6,
                                                                                color: "text.secondary",
                                                                            }}
                                                                        />
                                                                    )}
                                                                </Box>
                                                            </MenuItem>
                                                        ))}
                                                    </TextField>
                                                ) : (
                                                    <TextField
                                                        label="Activate Output"
                                                        value={activateOutput}
                                                        onChange={(e) =>
                                                            setActivateOutput(
                                                                e.target.value,
                                                            )
                                                        }
                                                        disabled={!activateEntity}
                                                        placeholder="OutputName"
                                                        size="small"
                                                        sx={{
                                                            minWidth: "180px",
                                                            height: "56px",
                                                        }}
                                                    />
                                                )}

                                                <Tooltip title="Additional parameter value to pass with the output (if required)">
                                                    <TextField
                                                        label="Parameter"
                                                        value={activateParam}
                                                        onChange={(e) =>
                                                            setActivateParam(
                                                                e.target.value,
                                                            )
                                                        }
                                                        placeholder={
                                                            hasFgdData && outputNeedsParam(
                                                                activateEntity,
                                                                activateOutput,
                                                            )
                                                                ? "param"
                                                                : hasFgdData ? "not required" : "optional"
                                                        }
                                                        disabled={
                                                            hasFgdData && !outputNeedsParam(
                                                                activateEntity,
                                                                activateOutput,
                                                            )
                                                        }
                                                        size="small"
                                                        sx={{
                                                            minWidth: "150px",
                                                            height: "56px",
                                                        }}
                                                    />
                                                </Tooltip>

                                            </Box>
                                        </Box>
                                    </CardContent>
                                </Card>

                                {/* Deactivate Command Card */}
                                <Card
                                    variant="outlined"
                                    sx={{ overflow: "hidden" }}>
                                    <CardContent sx={{ p: 2 }}>
                                        <Typography
                                            variant="caption"
                                            color="text.secondary"
                                            sx={{ mb: 1, display: "block" }}>
                                            Deactivate Command
                                        </Typography>
                                        <Box
                                            sx={{
                                                overflowX: "auto",
                                                width: "100%",
                                                minHeight: "80px",
                                                py: 1,
                                                "&::-webkit-scrollbar": {
                                                    height: 8,
                                                },
                                                "&::-webkit-scrollbar-track": {
                                                    backgroundColor:
                                                        "rgba(0,0,0,0.1)",
                                                    borderRadius: 4,
                                                },
                                                "&::-webkit-scrollbar-thumb": {
                                                    backgroundColor:
                                                        "rgba(0,0,0,0.3)",
                                                    borderRadius: 4,
                                                },
                                            }}>
                                            <Box
                                                sx={{
                                                    display: "grid",
                                                    gridTemplateColumns:
                                                        "200px 180px 150px",
                                                    gap: 2,
                                                    alignItems: "center",
                                                    minWidth: "max-content",
                                                    width: "max-content",
                                                    height: "100%",
                                                }}>
                                                <TextField
                                                    select
                                                    label="Deactivate Entity"
                                                    value={deactivateEntity}
                                                    onChange={(e) =>
                                                        setDeactivateEntity(
                                                            e.target.value,
                                                        )
                                                    }
                                                    size="small"
                                                    sx={{
                                                        minWidth: "200px",
                                                        height: "56px",
                                                    }}>
                                                    {entityOptions.length ===
                                                    0 ? (
                                                        <MenuItem disabled>
                                                            No entities found in
                                                            instances
                                                        </MenuItem>
                                                    ) : (
                                                        entityOptions.map(
                                                            (option) => (
                                                                <MenuItem
                                                                    key={
                                                                        option.value
                                                                    }
                                                                    value={
                                                                        option.value
                                                                    }>
                                                                    <Box
                                                                        sx={{
                                                                            display:
                                                                                "flex",
                                                                            alignItems:
                                                                                "center",
                                                                            justifyContent:
                                                                                "space-between",
                                                                            width: "100%",
                                                                        }}>
                                                                        <span
                                                                            style={{
                                                                                fontWeight:
                                                                                    option.hasDuplicates
                                                                                        ? "bold"
                                                                                        : "normal",
                                                                            }}>
                                                                            {
                                                                                option.label
                                                                            }
                                                                        </span>
                                                                        {option.hasDuplicates && (
                                                                            <GroupWork
                                                                                sx={{
                                                                                    fontSize: 16,
                                                                                    opacity: 0.6,
                                                                                    color: "primary.main",
                                                                                }}
                                                                            />
                                                                        )}
                                                                    </Box>
                                                                </MenuItem>
                                                            ),
                                                        )
                                                    )}
                                                </TextField>

                                                {hasFgdData ? (
                                                    <TextField
                                                        select
                                                        label="Deactivate Output"
                                                        value={deactivateOutput}
                                                        onChange={(e) =>
                                                            setDeactivateOutput(
                                                                e.target.value,
                                                            )
                                                        }
                                                        disabled={!deactivateEntity}
                                                        size="small"
                                                        sx={{
                                                            minWidth: "180px",
                                                            height: "56px",
                                                        }}>
                                                        {getAvailableOutputsForEntity(
                                                            deactivateEntity,
                                                        ).map((output) => (
                                                            <MenuItem
                                                                key={output.name}
                                                                value={output.name}>
                                                                <Box
                                                                    sx={{
                                                                        display:
                                                                            "flex",
                                                                        alignItems:
                                                                            "center",
                                                                        justifyContent:
                                                                            "space-between",
                                                                        width: "100%",
                                                                    }}>
                                                                    {output.name}
                                                                    {output.needsParam && (
                                                                        <EditNote
                                                                            sx={{
                                                                                fontSize: 16,
                                                                                opacity: 0.6,
                                                                                color: "text.secondary",
                                                                            }}
                                                                        />
                                                                    )}
                                                                </Box>
                                                            </MenuItem>
                                                        ))}
                                                    </TextField>
                                                ) : (
                                                    <TextField
                                                        label="Deactivate Output"
                                                        value={deactivateOutput}
                                                        onChange={(e) =>
                                                            setDeactivateOutput(
                                                                e.target.value,
                                                            )
                                                        }
                                                        disabled={!deactivateEntity}
                                                        placeholder="OutputName"
                                                        size="small"
                                                        sx={{
                                                            minWidth: "180px",
                                                            height: "56px",
                                                        }}
                                                    />
                                                )}

                                                <Tooltip title="Additional parameter value to pass with the output (if required)">
                                                    <TextField
                                                        label="Parameter"
                                                        value={deactivateParam}
                                                        onChange={(e) =>
                                                            setDeactivateParam(
                                                                e.target.value,
                                                            )
                                                        }
                                                        placeholder={
                                                            hasFgdData && outputNeedsParam(
                                                                deactivateEntity,
                                                                deactivateOutput,
                                                            )
                                                                ? "param"
                                                                : hasFgdData ? "not required" : "optional"
                                                        }
                                                        disabled={
                                                            hasFgdData && !outputNeedsParam(
                                                                deactivateEntity,
                                                                deactivateOutput,
                                                            )
                                                        }
                                                        size="small"
                                                        sx={{
                                                            minWidth: "150px",
                                                            height: "56px",
                                                        }}
                                                    />
                                                </Tooltip>

                                            </Box>
                                        </Box>
                                    </CardContent>
                                </Card>

                                {/* Show output commands preview */}
                                {(formData.out_activate ||
                                    formData.out_deactivate) && (
                                    <Box
                                        sx={{
                                            mt: 2,
                                            p: 2,
                                            bgcolor: "action.hover",
                                            borderRadius: 1,
                                        }}>
                                        <Typography
                                            variant="caption"
                                            color="text.secondary">
                                            Generated Output Commands:
                                        </Typography>
                                        {formData.out_activate && (
                                            <Typography
                                                variant="body2"
                                                sx={{
                                                    fontFamily: "monospace",
                                                    fontSize: "0.75rem",
                                                }}>
                                                Activate:{" "}
                                                {formData.out_activate}
                                            </Typography>
                                        )}
                                        {formData.out_deactivate && (
                                            <Typography
                                                variant="body2"
                                                sx={{
                                                    fontFamily: "monospace",
                                                    fontSize: "0.75rem",
                                                }}>
                                                Deactivate:{" "}
                                                {formData.out_deactivate}
                                            </Typography>
                                        )}
                                    </Box>
                                )}
                            </Stack>
                        </Box>
                    )}
                </Stack>

                {error && (
                    <Alert severity="error" sx={{ mt: 2 }}>
                        {error}
                    </Alert>
                )}
            </DialogContent>
            <DialogActions sx={{ py: 3, px: 3 }}>
                <Button onClick={onClose}>Cancel</Button>
                <Tooltip title={!isConfigValid ? getValidationError() : ""}>
                    <span>
                        <Button
                            onClick={handleSave}
                            variant="contained"
                            disabled={!isConfigValid}>
                            {isEdit ? "Update" : "Add"}
                        </Button>
                    </span>
                </Tooltip>
            </DialogActions>
        </Dialog>
    )
}

function Inputs({ item, formData, onUpdateInputs, onUpdateOutputs }) {
    const [inputs, setInputs] = useState({})
    const [outputs, setOutputs] = useState({})
    const [tabValue, setTabValue] = useState(0)
    const [editDialogOpen, setEditDialogOpen] = useState(false)
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [editingConfig, setEditingConfig] = useState({
        name: "",
        config: {},
        type: "",
    })
    const [deleteItem, setDeleteItem] = useState({ name: "", type: "" })
    const [error, setError] = useState("")
    const [validationIssues, setValidationIssues] = useState({
        unnamedEntities: [],
        invalidNames: [],
    })
    const [fixingNames, setFixingNames] = useState(false)
    const [loadingValidation, setLoadingValidation] = useState(false)

    // Use formData instead of loading from backend
    useEffect(() => {
        if (formData) {
            setInputs(formData.inputs || {})
            setOutputs(formData.outputs || {})
        }
    }, [formData])

    // Load validation issues when component mounts or item changes
    useEffect(() => {
        if (item?.id) {
            loadValidationIssues()
        }
    }, [item?.id, JSON.stringify(item?.instances)])

    const loadValidationIssues = async () => {
        setLoadingValidation(true)
        try {
            const result = await window.package.getItemEntities(item.id)
            if (result.success && result.validationIssues) {
                setValidationIssues(result.validationIssues)
            }
        } catch (error) {
            console.error(
                `Failed to load entity validation issues for item "${item?.name}":`,
                error,
            )
        } finally {
            setLoadingValidation(false)
        }
    }

    const handleFixEntityNames = async () => {
        setFixingNames(true)
        try {
            const result = await window.package.fixEntityNames(item.id)
            if (result.success) {
                // Reload validation issues to refresh
                await loadValidationIssues()
            } else {
                setError(`Failed to fix entity names: ${result.error}`)
            }
        } catch (error) {
            setError(`Failed to fix entity names: ${error.message}`)
        } finally {
            setFixingNames(false)
        }
    }

    const handleAddConfig = (configData) => {
        try {
            const isInput = tabValue === 0
            // Both inputs and outputs use "BEE2" as the key name
            const defaultName = "BEE2"

            // Generate a unique name if default already exists
            let uniqueName = defaultName
            let counter = 1
            const existingData = isInput ? inputs : outputs
            while (existingData[uniqueName]) {
                uniqueName = `${defaultName}${counter}`
                counter++
            }

            if (isInput) {
                const updatedInputs = {
                    ...inputs,
                    [uniqueName]: configData,
                }
                setInputs(updatedInputs)
                onUpdateInputs(updatedInputs)
            } else {
                const updatedOutputs = {
                    ...outputs,
                    [uniqueName]: configData,
                }
                setOutputs(updatedOutputs)
                onUpdateOutputs(updatedOutputs)
            }

            setEditDialogOpen(false)
            setError("")
        } catch (error) {
            setError(error.message)
        }
    }

    const handleEditConfig = (configData) => {
        try {
            if (editingConfig.type === "input") {
                const updatedInputs = {
                    ...inputs,
                    [editingConfig.name]: configData,
                }
                setInputs(updatedInputs)
                onUpdateInputs(updatedInputs)
            } else {
                const updatedOutputs = {
                    ...outputs,
                    [editingConfig.name]: configData,
                }
                setOutputs(updatedOutputs)
                onUpdateOutputs(updatedOutputs)
            }

            setEditDialogOpen(false)
            setEditingConfig({ name: "", config: {}, type: "" })
        } catch (error) {
            console.error(
                `Failed to update ${editingConfig.type} "${editingConfig.name}" of item "${item?.name}":`,
                error,
            )
        }
    }

    const handleDeleteConfig = () => {
        try {
            if (deleteItem.type === "input") {
                const updatedInputs = { ...inputs }
                delete updatedInputs[deleteItem.name]
                setInputs(updatedInputs)
                onUpdateInputs(updatedInputs)
            } else {
                const updatedOutputs = { ...outputs }
                delete updatedOutputs[deleteItem.name]
                setOutputs(updatedOutputs)
                onUpdateOutputs(updatedOutputs)
            }

            setDeleteDialogOpen(false)
            setDeleteItem({ name: "", type: "" })
        } catch (error) {
            console.error(
                `Failed to delete ${deleteItem.type} "${deleteItem.name}" of item "${item?.name}":`,
                error,
            )
        }
    }

    const openEditDialog = (name, config, type) => {
        setEditingConfig({ name, config, type })
        setEditDialogOpen(true)
    }

    const openDeleteDialog = (name, type) => {
        setDeleteItem({ name, type })
        setDeleteDialogOpen(true)
    }

    // Check if we already have input/output
    const hasInput = Object.keys(inputs).length > 0
    const hasOutput = Object.keys(outputs).length > 0

    const renderConfigCard = (name, config, type) => (
        <Paper key={`${type}-${name}`} variant="outlined" sx={{ p: 2 }}>
            <Box
                sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    mb: 1,
                }}>
                <Typography
                    variant="h6"
                    sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    {type === "input" ? (
                        <InputIcon fontSize="small" />
                    ) : (
                        <OutputIcon fontSize="small" />
                    )}
                    {type === "input" ? "INPUT" : "OUTPUT"}
                </Typography>
                <Box>
                    <Tooltip
                        title={`Edit the ${type} configuration - modify commands and settings`}>
                        <IconButton
                            size="small"
                            onClick={() => openEditDialog(name, config, type)}>
                            <Edit fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip
                        title={`Delete this ${type} configuration permanently`}>
                        <IconButton
                            size="small"
                            color="error"
                            onClick={() => openDeleteDialog(name, type)}>
                            <Delete fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Box>
            </Box>

            <Accordion>
                <Tooltip title="Click to view all the detailed configuration properties and their values">
                    <AccordionSummary expandIcon={<ExpandMore />}>
                        <Typography variant="body2" color="text.secondary">
                            View Configuration ({Object.keys(config).length}{" "}
                            properties)
                        </Typography>
                    </AccordionSummary>
                </Tooltip>
                <AccordionDetails>
                    <Stack spacing={1}>
                        {Object.entries(config).map(([key, value]) => (
                            <Box key={key} sx={{ display: "flex", gap: 1 }}>
                                <Chip
                                    label={key}
                                    size="small"
                                    variant="outlined"
                                />
                                <Typography
                                    variant="body2"
                                    sx={{ fontFamily: "monospace" }}>
                                    {value}
                                </Typography>
                            </Box>
                        ))}
                    </Stack>
                </AccordionDetails>
            </Accordion>
        </Paper>
    )

    return (
        <Box>
            <Box
                sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    mb: 2,
                }}>
                <Typography variant="h6">Inputs & Outputs</Typography>
                <Tooltip
                    title={
                        tabValue === 0
                            ? hasInput
                                ? "This item already has an input configured. Items can only have one input."
                                : "Add an input configuration to allow this item to receive signals from other items."
                            : hasOutput
                              ? "This item already has an output configured. Items can only have one output."
                              : "Add an output configuration to allow this item to send signals to other items."
                    }>
                    <span>
                        <Button
                            variant="contained"
                            startIcon={<Add />}
                            disabled={tabValue === 0 ? hasInput : hasOutput}
                            onClick={() => {
                                // Skip naming, go straight to config since items can only have one input/output
                                const configName =
                                    tabValue === 0 ? "Input" : "Output"
                                setEditingConfig({
                                    name: configName,
                                    config: {},
                                    type: tabValue === 0 ? "input" : "output",
                                })
                                setEditDialogOpen(true)
                            }}>
                            {tabValue === 0
                                ? hasInput
                                    ? "Input Already Exists"
                                    : "Add Input"
                                : hasOutput
                                  ? "Output Already Exists"
                                  : "Add Output"}
                        </Button>
                    </span>
                </Tooltip>
            </Box>

            <Tabs
                value={tabValue}
                onChange={(e, newValue) => setTabValue(newValue)}
                sx={{ mb: 2 }}>
                <Tooltip title="Configure how this item receives signals from other items in the puzzle">
                    <Tab label="Input" />
                </Tooltip>
                <Tooltip title="Configure how this item sends signals to other items in the puzzle">
                    <Tab label="Output" />
                </Tooltip>
            </Tabs>

            {/* Validation warnings for entity issues */}
            {(validationIssues.unnamedEntities.length > 0 || validationIssues.invalidNames.length > 0) && (
                <Stack spacing={2} sx={{ mb: 2 }}>
                    {validationIssues.unnamedEntities.length > 0 && (
                        <Alert severity="warning" icon={<Warning />}>
                            <AlertTitle>Unnamed Entities Detected</AlertTitle>
                            <Typography variant="body2" sx={{ mb: 1 }}>
                                {validationIssues.unnamedEntities.length} entit{validationIssues.unnamedEntities.length === 1 ? 'y' : 'ies'} in your instance{validationIssues.unnamedEntities.length > 1 ? 's' : ''} do not have a targetname.
                                These entities cannot be used for inputs/outputs.
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ fontFamily: "monospace", fontSize: "0.75rem" }}>
                                {validationIssues.unnamedEntities.map((e, i) => (
                                    <span key={i}>
                                        {e.classname} (instance {e.instanceIndex})
                                        {i < validationIssues.unnamedEntities.length - 1 ? ', ' : ''}
                                    </span>
                                ))}
                            </Typography>
                            <Typography variant="body2" sx={{ mt: 1 }}>
                                Open your instance VMF in Hammer and add a targetname to these entities.
                            </Typography>
                        </Alert>
                    )}

                    {validationIssues.invalidNames.length > 0 && (
                        <Alert
                            severity="error"
                            icon={<Warning />}
                            action={
                                <Button
                                    color="inherit"
                                    size="small"
                                    startIcon={fixingNames ? <CircularProgress size={16} color="inherit" /> : <Build />}
                                    onClick={handleFixEntityNames}
                                    disabled={fixingNames}
                                >
                                    {fixingNames ? "Fixing..." : "Fix All"}
                                </Button>
                            }
                        >
                            <AlertTitle>Invalid Entity Names</AlertTitle>
                            <Typography variant="body2" sx={{ mb: 1 }}>
                                {validationIssues.invalidNames.length} entit{validationIssues.invalidNames.length === 1 ? 'y' : 'ies'} ha{validationIssues.invalidNames.length === 1 ? 's' : 've'} spaces in their targetname, which is invalid.
                            </Typography>
                            <Box sx={{ fontFamily: "monospace", fontSize: "0.75rem" }}>
                                {validationIssues.invalidNames.map((e, i) => (
                                    <Typography key={i} variant="body2" sx={{ fontFamily: "monospace", fontSize: "0.75rem" }}>
                                        "{e.name}" → "{e.fixedName}"
                                    </Typography>
                                ))}
                            </Box>
                            <Typography variant="body2" sx={{ mt: 1 }}>
                                Click "Fix All" to automatically replace spaces with underscores in the VMF files.
                            </Typography>
                        </Alert>
                    )}
                </Stack>
            )}

            <Box sx={{ display: tabValue === 0 ? "block" : "none" }}>
                <Stack spacing={2}>
                    {Object.keys(inputs).length === 0 ? (
                        <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{ textAlign: "center", py: 4 }}>
                            No input configured. Click "Add Input" to configure
                            the item's input.
                        </Typography>
                    ) : (
                        Object.entries(inputs).map(([name, config]) =>
                            renderConfigCard(name, config, "input"),
                        )
                    )}
                </Stack>
            </Box>

            <Box sx={{ display: tabValue === 1 ? "block" : "none" }}>
                <Stack spacing={2}>
                    {Object.keys(outputs).length === 0 ? (
                        <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{ textAlign: "center", py: 4 }}>
                            No output configured. Click "Add Output" to
                            configure the item's output.
                        </Typography>
                    ) : (
                        Object.entries(outputs).map(([name, config]) =>
                            renderConfigCard(name, config, "output"),
                        )
                    )}
                </Stack>
            </Box>

            {/* Edit/Add Config Dialog */}
            <InputOutputConfigDialog
                open={editDialogOpen}
                onClose={() => setEditDialogOpen(false)}
                onSave={
                    editingConfig.config &&
                    Object.keys(editingConfig.config).length > 0
                        ? handleEditConfig
                        : handleAddConfig
                }
                config={editingConfig.config}
                title={
                    editingConfig.config &&
                    Object.keys(editingConfig.config).length > 0
                        ? `Edit ${editingConfig.type === "input" ? "Input" : "Output"}: ${editingConfig.name}`
                        : `Add ${editingConfig.type === "input" ? "Input" : "Output"}`
                }
                isEdit={
                    editingConfig.config &&
                    Object.keys(editingConfig.config).length > 0
                }
                itemId={item.id}
                item={item}
            />

            {/* Delete Confirmation Dialog */}
            <Dialog
                open={deleteDialogOpen}
                onClose={() => setDeleteDialogOpen(false)}>
                <DialogTitle>
                    Delete {deleteItem.type === "input" ? "Input" : "Output"}?
                </DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        Are you sure you want to delete the item's{" "}
                        {deleteItem.type}? This cannot be undone.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteDialogOpen(false)}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleDeleteConfig}
                        color="error"
                        variant="contained">
                        Delete
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    )
}

export default Inputs
