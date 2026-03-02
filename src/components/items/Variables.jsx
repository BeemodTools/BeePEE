import { useState, useEffect } from "react"
import {
    Box,
    Typography,
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    List,
    ListItem,
    ListItemText,
    ListItemButton,
    Card,
    CardContent,
    TextField,
    IconButton,
    Chip,
    Stack,
    Divider,
    Tooltip,
    Paper,
    Checkbox,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
} from "@mui/material"
import { Add, DragIndicator, Delete, Info, Code } from "@mui/icons-material"
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
} from "@dnd-kit/core"
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"

// Custom modifier to restrict drag movement to parent bounds
const restrictToParentBounds = ({
    transform,
    containerNodeRect,
    draggingNodeRect,
}) => {
    if (!containerNodeRect || !draggingNodeRect) {
        return transform
    }

    const maxX = containerNodeRect.width - draggingNodeRect.width

    return {
        ...transform,
        x: Math.min(transform.x, maxX),
    }
}

// Sortable Variable Item Component
function SortableVariableItem({ variable, onUpdateValue, onDelete }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: variable.id })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.8 : 1,
    }

    return (
        <Paper
            ref={setNodeRef}
            style={style}
            variant="outlined"
            sx={{
                backgroundColor: "background.paper",
                borderColor: "divider",
                borderWidth: 1,
                cursor: isDragging ? "grabbing" : "auto",
            }}>
            <Box sx={{ p: 2 }}>
                <Box
                    sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                    }}>
                    {/* Drag Handle */}
                    <div
                        {...attributes}
                        {...listeners}
                        style={{ display: "flex", alignItems: "center" }}>
                        <DragIndicator
                            fontSize="small"
                            sx={{ color: "grey.500", cursor: "grab" }}
                        />
                    </div>

                    {/* Variable Type Icon */}
                    <Tooltip title="VBSP Variable">
                        <Code fontSize="small" />
                    </Tooltip>

                    {/* Variable Name + Default Value - LEFT ALIGNED */}
                    <Box
                        sx={{
                            minWidth: "200px",
                            flex: 1,
                            display: "flex",
                            alignItems: "center",
                            gap: 2,
                        }}>
                        <Typography
                            variant="body2"
                            sx={{
                                fontWeight: "medium",
                                color: "text.primary",
                                fontSize: "0.875rem",
                                minWidth: "100px",
                            }}>
                            {variable.displayName}
                        </Typography>

                        <Box
                            sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 1,
                            }}>
                            <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{
                                    fontSize: "0.7rem",
                                    whiteSpace: "nowrap",
                                }}>
                                Default value:
                            </Typography>
                            {variable.type === "boolean" ? (
                                <Checkbox
                                    checked={variable.customValue === "1"}
                                    onChange={(e) =>
                                        onUpdateValue(
                                            variable.id,
                                            e.target.checked ? "1" : "0",
                                        )
                                    }
                                    size="small"
                                    sx={{ p: 0.5 }}
                                />
                            ) : variable.type === "enum" ? (
                                <FormControl
                                    size="small"
                                    sx={{ minWidth: 120 }}>
                                    <Select
                                        value={variable.customValue}
                                        onChange={(e) =>
                                            onUpdateValue(
                                                variable.id,
                                                e.target.value,
                                            )
                                        }
                                        sx={{
                                            height: 28,
                                            fontSize: "0.75rem",
                                            "& .MuiOutlinedInput-notchedOutline":
                                                {
                                                    borderColor: "transparent",
                                                },
                                            "&:hover .MuiOutlinedInput-notchedOutline":
                                                {
                                                    borderColor: "divider",
                                                },
                                            "&.Mui-focused .MuiOutlinedInput-notchedOutline":
                                                {
                                                    borderColor: "primary.main",
                                                },
                                        }}>
                                        {Object.entries(
                                            variable.enumValues || {},
                                        ).map(([value, label]) => (
                                            <MenuItem
                                                key={value}
                                                value={value}
                                                sx={{ fontSize: "0.75rem" }}>
                                                {label}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                            ) : (
                                <TextField
                                    size="small"
                                    type={
                                        variable.type === "number"
                                            ? "number"
                                            : "text"
                                    }
                                    value={variable.customValue}
                                    onChange={(e) =>
                                        onUpdateValue(
                                            variable.id,
                                            e.target.value,
                                        )
                                    }
                                    placeholder="Set default value"
                                    inputProps={{
                                        min:
                                            variable.type === "number"
                                                ? 0
                                                : undefined,
                                        step:
                                            variable.type === "number"
                                                ? 1
                                                : undefined,
                                    }}
                                    sx={{
                                        "& .MuiInputBase-input": {
                                            fontSize: "0.75rem",
                                            fontWeight: "medium",
                                            color: "text.primary",
                                        },
                                        "& .MuiOutlinedInput-root": {
                                            height: 28,
                                            "& fieldset": {
                                                borderColor: "transparent",
                                            },
                                            "&:hover fieldset": {
                                                borderColor: "divider",
                                            },
                                            "&.Mui-focused fieldset": {
                                                borderColor: "primary.main",
                                            },
                                        },
                                    }}
                                />
                            )}
                        </Box>
                    </Box>

                    {/* Fixup Name - RIGHT ALIGNED */}
                    <Box sx={{ minWidth: "120px", textAlign: "right" }}>
                        <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{
                                fontFamily: "monospace",
                                fontSize: "0.75rem",
                            }}>
                            {variable.fixupName}
                        </Typography>
                    </Box>

                    {/* Action Buttons */}
                    <Box sx={{ display: "flex", gap: 1 }}>
                        <Tooltip title="Delete this variable">
                            <IconButton
                                size="small"
                                color="error"
                                onClick={() => onDelete(variable.id)}>
                                <Delete fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    </Box>
                </Box>
            </Box>
        </Paper>
    )
}

// Enum definitions for specific types
const CUBE_TYPES = {
    0: "Standard",
    1: "Companion",
    2: "Reflective",
    3: "Sphere",
    4: "Franken",
}

// Preset variable definitions
const VARIABLE_PRESETS = {
    ConnectionCount: {
        displayName: "Connection Count",
        fixupName: "$connectioncount",
        description: "Number of items connected to this item's input. Use in Conditions to detect if item has connections (like stairs/panels).",
        defaultValue: "0",
        type: "number",
    },
    StartEnabled: {
        displayName: "Start Enabled",
        fixupName: "$start_enabled",
        description: "2 Conditions",
        defaultValue: "1",
        type: "boolean",
    },
    StartActive: {
        displayName: "Start Active",
        fixupName: "$start_active",
        description: "2 Conditions",
        defaultValue: "1",
        type: "boolean",
    },
    StartDeployed: {
        displayName: "Start Deployed",
        fixupName: "$start_deployed",
        description: "2 Conditions",
        defaultValue: "1",
        type: "boolean",
    },
    StartOpen: {
        displayName: "Start Open",
        fixupName: "$start_open",
        description: "2 Conditions",
        defaultValue: "0",
        type: "boolean",
    },
    StartLocked: {
        displayName: "Start Locked",
        fixupName: "$start_locked",
        description: "2 Conditions",
        defaultValue: "0",
        type: "boolean",
    },
    StartReversed: {
        displayName: "Start Reversed",
        fixupName: "$start_reversed",
        description: "2 Conditions",
        defaultValue: "0",
        type: "boolean",
    },
    AutoDrop: {
        displayName: "Auto Drop",
        fixupName: "$disable_autodrop",
        description: "2 Conditions",
        defaultValue: "0",
        type: "boolean",
    },
    AutoRespawn: {
        displayName: "Auto Respawn",
        fixupName: "$disable_autorespawn",
        description: "2 Conditions",
        defaultValue: "0",
        type: "boolean",
    },
    CubeType: {
        displayName: "Cube Type",
        fixupName: "$cube_type",
        description: "5 Conditions",
        defaultValue: "0",
        type: "enum",
        enumValues: CUBE_TYPES,
    },
    TimerDelay: {
        displayName: "Timer Delay",
        fixupName: "$timer_delay",
        description: "30 Conditions",
        defaultValue: "0",
        type: "number",
    },
}

function Variables({ item, formData, onUpdateVariables }) {
    const [addDialogOpen, setAddDialogOpen] = useState(false)
    const [variables, setVariables] = useState(() => {
        // Ensure initial state is always an array
        const initialVariables = formData.variables
        console.log(
            "Variables component: Initial formData.variables =",
            initialVariables,
            "type:",
            typeof initialVariables,
            "isArray:",
            Array.isArray(initialVariables),
        )
        return Array.isArray(initialVariables) ? initialVariables : []
    })

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        }),
    )

    // Sync local state with formData when it changes
    useEffect(() => {
        // Ensure variables is always an array
        const variablesData = formData.variables
        console.log(
            "Variables component: formData.variables =",
            variablesData,
            "type:",
            typeof variablesData,
            "isArray:",
            Array.isArray(variablesData),
        )
        if (Array.isArray(variablesData)) {
            setVariables(variablesData)
        } else {
            setVariables([])
        }
    }, [formData.variables])

    const handleAddVariable = (presetKey) => {
        // Check if this variable type is already added
        const existingVariable = variables.find(
            (v) => v.presetKey === presetKey,
        )
        if (existingVariable) {
            console.warn(`Variable ${presetKey} is already added`)
            return
        }

        const preset = VARIABLE_PRESETS[presetKey]
        const newVariable = {
            id: `${presetKey}_${Date.now()}`,
            presetKey,
            displayName: preset.displayName,
            fixupName: preset.fixupName,
            description: preset.description,
            defaultValue: preset.defaultValue,
            type: preset.type,
            enumValues: preset.enumValues,
            customValue: preset.defaultValue,
        }

        const updatedVariables = [...variables, newVariable]
        setVariables(updatedVariables)
        onUpdateVariables(updatedVariables)
        setAddDialogOpen(false)
    }

    const handleDeleteVariable = (variableId) => {
        const updatedVariables = variables.filter((v) => v.id !== variableId)
        setVariables(updatedVariables)
        onUpdateVariables(updatedVariables)
    }

    const handleUpdateVariableValue = (variableId, newValue) => {
        let processedValue = newValue
        const variable = variables.find((v) => v.id === variableId)

        // Apply timer logic for TimerDelay
        if (variable && variable.presetKey === "TimerDelay") {
            const numValue = Number(newValue)
            if (!isNaN(numValue)) {
                if (numValue === 0) {
                    processedValue = "0"
                } else if (numValue >= 1 && numValue <= 30) {
                    processedValue = String(numValue)
                } else {
                    processedValue = "0"
                }
            }
        }

        const updatedVariables = variables.map((v) =>
            v.id === variableId ? { ...v, customValue: processedValue } : v,
        )
        setVariables(updatedVariables)
        onUpdateVariables(updatedVariables)
    }

    const handleDragEnd = (event) => {
        const { active, over } = event

        if (active.id !== over?.id) {
            const oldIndex = variables.findIndex(
                (item) => item.id === active.id,
            )
            const newIndex = variables.findIndex((item) => item.id === over.id)

            const reorderedVariables = arrayMove(variables, oldIndex, newIndex)
            setVariables(reorderedVariables)
            onUpdateVariables(reorderedVariables)
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
                <Typography variant="h6">
                    Variables ({Array.isArray(variables) ? variables.length : 0}
                    )
                </Typography>
                <Box sx={{ display: "flex", gap: 1 }}>
                    <Tooltip title="Add a variable from the preset list">
                        <Button
                            variant="contained"
                            startIcon={<Add />}
                            onClick={() => setAddDialogOpen(true)}>
                            Add Variable
                        </Button>
                    </Tooltip>
                </Box>
            </Box>

            {!Array.isArray(variables) || variables.length === 0 ? (
                <Box
                    sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 2,
                        p: 4,
                        textAlign: "center",
                    }}>
                    <Code
                        sx={{
                            fontSize: 48,
                            color: "text.secondary",
                            opacity: 0.5,
                        }}
                    />
                    <Typography variant="h6" color="text.secondary">
                        No Variables Yet
                    </Typography>
                    <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mb: 2 }}>
                        Add your first variable using the button above
                    </Typography>
                    <Button
                        variant="contained"
                        startIcon={<Add />}
                        onClick={() => setAddDialogOpen(true)}>
                        Add First Variable
                    </Button>
                </Box>
            ) : (
                <Stack spacing={2}>
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                        modifiers={[restrictToParentBounds]}>
                        <SortableContext
                            items={
                                Array.isArray(variables)
                                    ? variables.map((v) => v.id)
                                    : []
                            }
                            strategy={verticalListSortingStrategy}>
                            {Array.isArray(variables)
                                ? variables.map((variable) => (
                                      <SortableVariableItem
                                          key={variable.id}
                                          variable={variable}
                                          onUpdateValue={
                                              handleUpdateVariableValue
                                          }
                                          onDelete={handleDeleteVariable}
                                      />
                                  ))
                                : null}
                        </SortableContext>
                    </DndContext>
                </Stack>
            )}

            {/* Add Variable Dialog */}
            <Dialog
                open={addDialogOpen}
                onClose={() => setAddDialogOpen(false)}
                maxWidth="md"
                fullWidth>
                <DialogTitle>Add Variable</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" color="text.secondary" mb={2}>
                        Select a variable from the preset list to add to your
                        item configuration.
                    </Typography>
                    {Object.entries(VARIABLE_PRESETS).filter(
                        ([key, preset]) =>
                            !variables.find((v) => v.presetKey === key),
                    ).length === 0 ? (
                        <Box sx={{ textAlign: "center", py: 4 }}>
                            <Typography variant="h6" color="text.secondary">
                                All Variables Added
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                You have already added all available variables
                                to this item.
                            </Typography>
                        </Box>
                    ) : (
                        <List>
                            {Object.entries(VARIABLE_PRESETS)
                                .filter(([key, preset]) => {
                                    // Only show variables that haven't been added yet
                                    return !variables.find(
                                        (v) => v.presetKey === key,
                                    )
                                })
                                .map(([key, preset]) => (
                                    <ListItem key={key} disablePadding>
                                        <ListItemButton
                                            onClick={() =>
                                                handleAddVariable(key)
                                            }>
                                            <ListItemText
                                                primary={
                                                    <Stack
                                                        direction="row"
                                                        alignItems="center"
                                                        spacing={1}>
                                                        <Typography variant="subtitle1">
                                                            {preset.displayName}
                                                        </Typography>
                                                        <Chip
                                                            icon={<Code />}
                                                            label={
                                                                preset.fixupName
                                                            }
                                                            size="small"
                                                            variant="outlined"
                                                        />
                                                    </Stack>
                                                }
                                                secondary={
                                                    <Box>
                                                        <Typography
                                                            variant="body2"
                                                            color="text.secondary">
                                                            {preset.description}
                                                        </Typography>
                                                        <Typography
                                                            variant="caption"
                                                            color="text.secondary">
                                                            Default value:{" "}
                                                            {
                                                                preset.defaultValue
                                                            }{" "}
                                                            • Type:{" "}
                                                            {preset.type}
                                                        </Typography>
                                                    </Box>
                                                }
                                            />
                                        </ListItemButton>
                                    </ListItem>
                                ))}
                        </List>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setAddDialogOpen(false)}>
                        Cancel
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    )
}

export default Variables
