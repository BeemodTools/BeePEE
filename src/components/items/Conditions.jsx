import { useState, useEffect } from "react"
import {
    Box,
    Typography,
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    DialogContentText,
    List,
    ListItem,
    ListItemText,
    ListItemButton,
    TextField,
    IconButton,
    Chip,
    Stack,
    Tooltip,
    Paper,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    Alert,
    Avatar,
    Grid,
    Accordion,
    AccordionSummary,
    AccordionDetails,
} from "@mui/material"
import {
    Add,
    DragIndicator,
    Delete,
    Info,
    CheckCircle,
    Error,
    Warning,
    Category,
    Functions,
    AccountTree,
    SwapHoriz,
    AddCircleOutline,
    PlayArrow,
    Code,
    OpenWith,
    SwapVert,
    BugReport,
    Hive,
    HelpOutline,
    FileCopy,
    Cancel,
    ExpandMore,
    Api,
} from "@mui/icons-material"
import {
    DndContext,
    closestCenter,
    pointerWithin,
    rectIntersection,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragOverlay,
    useDroppable,
} from "@dnd-kit/core"
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"

// Block Validation Functions
const validateBlock = (
    block,
    allBlocks = [],
    availableVariables = [],
    formData = {},
) => {
    const errors = []

    switch (block.type) {
        case "if":
            return validateIfBlock(block, availableVariables, formData)
        case "ifElse":
            return validateIfElseBlock(block, availableVariables, formData)
        case "switchCase":
            return validateSwitchBlock(block, availableVariables, formData)
        case "case":
            return validateCaseBlock(
                block,
                allBlocks,
                availableVariables,
                formData,
            )
        case "changeInstance":
            return validateChangeInstanceBlock(block, formData)
        case "randomSelection":
            return validateRandomSelectionBlock(block, formData)
        case "addOverlay":
            return validateAddOverlayBlock(block, formData)
        case "addGlobalEnt":
            return validateAddGlobalEntBlock(block, formData)
        case "offsetInstance":
            return validateOffsetInstanceBlock(block)
        case "debug":
            return validateDebugBlock(block, availableVariables)
        case "setInstVar":
            return validateSetInstVarBlock(block)
        default:
            return []
    }
}

const validateIfBlock = (block, availableVariables = [], formData = {}) => {
    const errors = []

    if (!block.variable || block.variable.trim() === "") {
        errors.push({
            type: "error",
            message: "IF condition must have a variable selected",
            field: "variable",
        })
        return errors // If no variable, can't validate other fields properly
    }

    // Find variable data to understand expected defaults
    const selectedVariable = availableVariables.find(
        (v) => v.fixupName === block.variable,
    )
    const fullVariableData =
        availableVariables.find((v) => v.fixupName === block.variable) ||
        formData.variables?.find((v) => v.fixupName === block.variable)

    // Get effective values (including UI defaults)
    const effectiveOperator = block.operator || "==" // UI default
    const effectiveValue = getEffectiveValue(block, fullVariableData)

    // Validate operator - account for defaults and variable type compatibility
    if (effectiveOperator) {
        const validOperators = getValidOperatorsForVariable(fullVariableData)
        if (!validOperators.includes(effectiveOperator)) {
            errors.push({
                type: "warning",
                message: `Operator "${effectiveOperator}" may not be valid for this variable type`,
                field: "operator",
            })
        }
    }

    // Validate value - account for UI defaults and type requirements
    if (effectiveValue === null || effectiveValue === undefined) {
        errors.push({
            type: "error",
            message: "IF condition must have a value specified",
            field: "value",
        })
    } else if (fullVariableData) {
        // Type-specific value validation
        if (
            fullVariableData.type === "boolean" &&
            effectiveValue !== "0" &&
            effectiveValue !== "1"
        ) {
            errors.push({
                type: "warning",
                message: `Boolean variable should have value "0" (False) or "1" (True), not "${effectiveValue}"`,
                field: "value",
            })
        } else if (
            fullVariableData.type === "enum" &&
            fullVariableData.enumValues
        ) {
            const validEnumValues = Object.keys(fullVariableData.enumValues)
            if (!validEnumValues.includes(effectiveValue.toString())) {
                errors.push({
                    type: "warning",
                    message: `Value "${effectiveValue}" is not a valid option for this enum variable`,
                    field: "value",
                })
            }
        } else if (fullVariableData.type === "number") {
            const numValue = parseFloat(effectiveValue)
            if (isNaN(numValue)) {
                errors.push({
                    type: "warning",
                    message: `Value "${effectiveValue}" should be a number for numeric variables`,
                    field: "value",
                })
            }
        }
    }

    if (!block.thenBlocks || block.thenBlocks.length === 0) {
        errors.push({
            type: "warning",
            message:
                "IF block has no actions defined - it will not do anything",
            field: "thenBlocks",
        })
    }

    return errors
}

const validateIfElseBlock = (block, availableVariables = [], formData = {}) => {
    const errors = []

    if (!block.variable || block.variable.trim() === "") {
        errors.push({
            type: "error",
            message: "If-Else condition must have a variable selected",
            field: "variable",
        })
        return errors // If no variable, can't validate other fields properly
    }

    // Find variable data to understand expected defaults
    const selectedVariable = availableVariables.find(
        (v) => v.fixupName === block.variable,
    )
    const fullVariableData =
        availableVariables.find((v) => v.fixupName === block.variable) ||
        formData.variables?.find((v) => v.fixupName === block.variable)

    // Get effective values (including UI defaults)
    const effectiveOperator = block.operator || "==" // UI default
    const effectiveValue = getEffectiveValue(block, fullVariableData)

    // Validate operator - account for defaults and variable type compatibility
    if (effectiveOperator) {
        const validOperators = getValidOperatorsForVariable(fullVariableData)
        if (!validOperators.includes(effectiveOperator)) {
            errors.push({
                type: "warning",
                message: `Operator "${effectiveOperator}" may not be valid for this variable type`,
                field: "operator",
            })
        }
    }

    // Validate value - account for UI defaults and type requirements
    if (effectiveValue === null || effectiveValue === undefined) {
        errors.push({
            type: "error",
            message: "If-Else condition must have a value specified",
            field: "value",
        })
    } else if (fullVariableData) {
        // Type-specific value validation
        if (
            fullVariableData.type === "boolean" &&
            effectiveValue !== "0" &&
            effectiveValue !== "1"
        ) {
            errors.push({
                type: "warning",
                message: `Boolean variable should have value "0" (False) or "1" (True), not "${effectiveValue}"`,
                field: "value",
            })
        } else if (
            fullVariableData.type === "enum" &&
            fullVariableData.enumValues
        ) {
            const validEnumValues = Object.keys(fullVariableData.enumValues)
            if (!validEnumValues.includes(effectiveValue.toString())) {
                errors.push({
                    type: "warning",
                    message: `Value "${effectiveValue}" is not a valid option for this enum variable`,
                    field: "value",
                })
            }
        } else if (fullVariableData.type === "number") {
            const numValue = parseFloat(effectiveValue)
            if (isNaN(numValue)) {
                errors.push({
                    type: "warning",
                    message: `Value "${effectiveValue}" should be a number for numeric variables`,
                    field: "value",
                })
            }
        }
    }

    // Validate THEN blocks
    if (!block.thenBlocks || block.thenBlocks.length === 0) {
        errors.push({
            type: "warning",
            message: "If-Else block has no THEN actions defined",
            field: "thenBlocks",
        })
    }

    // Validate ELSE blocks
    if (!block.elseBlocks || block.elseBlocks.length === 0) {
        errors.push({
            type: "warning",
            message: "If-Else block has no ELSE actions defined",
            field: "elseBlocks",
        })
    }

    return errors
}

const validateIfHasBlock = (block) => {
    const errors = []

    if (!block.hasValue || block.hasValue.trim() === "") {
        errors.push({
            type: "error",
            message:
                "If Global condition must have a global variable value specified (e.g., CLEAN, CAVE_JOHNSON)",
            field: "hasValue",
        })
    }

    if (!block.thenBlocks || block.thenBlocks.length === 0) {
        errors.push({
            type: "warning",
            message:
                "If Global block has no actions defined - it will not do anything",
            field: "thenBlocks",
        })
    }

    return errors
}

const validateIfHasElseBlock = (block) => {
    const errors = []

    if (!block.hasValue || block.hasValue.trim() === "") {
        errors.push({
            type: "error",
            message:
                "If Global Else condition must have a global variable value specified (e.g., CLEAN, CAVE_JOHNSON)",
            field: "hasValue",
        })
    }

    if (!block.thenBlocks || block.thenBlocks.length === 0) {
        errors.push({
            type: "warning",
            message: "If Global Else block has no THEN actions defined",
            field: "thenBlocks",
        })
    }

    if (!block.elseBlocks || block.elseBlocks.length === 0) {
        errors.push({
            type: "warning",
            message: "If Global Else block has no ELSE actions defined",
            field: "elseBlocks",
        })
    }

    return errors
}

const validateSwitchGlobalBlock = (block) => {
    const errors = []

    if (!block.cases || block.cases.length === 0) {
        errors.push({
            type: "error",
            message: "Switch Global block must have at least one case",
            field: "cases",
        })
    } else {
        // Check for duplicate case values
        const caseValues = block.cases
            .map((c) => c.value)
            .filter(
                (v) =>
                    v !== undefined && v !== null && v.toString().trim() !== "",
            )
        const duplicates = caseValues.filter(
            (value, index) => caseValues.indexOf(value) !== index,
        )
        if (duplicates.length > 0) {
            errors.push({
                type: "warning",
                message: `Duplicate case values found: ${[...new Set(duplicates)].join(", ")}`,
                field: "cases",
            })
        }
    }

    return errors
}

// Helper function to get the effective value (including UI defaults)
const getEffectiveValue = (block, fullVariableData) => {
    // If block has explicit value, use it
    if (
        block.value !== undefined &&
        block.value !== null &&
        block.value.toString().trim() !== ""
    ) {
        return block.value
    }

    // Apply UI defaults based on variable type (matching component behavior)
    if (fullVariableData?.type === "boolean") {
        return "1" // Default to True
    } else if (
        fullVariableData?.type === "enum" &&
        fullVariableData?.enumValues
    ) {
        const enumKeys = Object.keys(fullVariableData.enumValues)
        return enumKeys.length > 0 ? enumKeys[0] : null // Default to first enum value
    }

    // For other types or when no variable selected, no default
    return null
}

// Helper function to get the effective case value (including UI defaults for case blocks)
const getEffectiveCaseValue = (block, fullVariableData) => {
    // If block has explicit value, use it
    if (
        block.value !== undefined &&
        block.value !== null &&
        block.value.toString().trim() !== ""
    ) {
        return block.value
    }

    // Apply UI defaults based on parent switch variable type (matching case component behavior)
    if (fullVariableData?.type === "boolean") {
        return "1" // Default to True (matching the case component default)
    } else if (
        fullVariableData?.type === "enum" &&
        fullVariableData?.enumValues
    ) {
        const enumKeys = Object.keys(fullVariableData.enumValues)
        return enumKeys.length > 0 ? enumKeys[0] : null // Default to first enum value
    }

    // For other types or when no parent switch variable selected, no default
    return null
}

// Helper function to get valid operators for a variable type
const getValidOperatorsForVariable = (variableData) => {
    if (!variableData) {
        return ["==", "!="] // Default operators when no variable type is known
    }

    if (variableData.type === "boolean" || variableData.type === "enum") {
        return ["==", "!="]
    }

    if (variableData.type === "number") {
        return ["==", "!=", ">", "<", ">=", "<="]
    }

    return ["==", "!="] // Default fallback
}

const validateSwitchBlock = (block, availableVariables = [], formData = {}) => {
    const errors = []

    if (!block.variable || block.variable.trim() === "") {
        errors.push({
            type: "error",
            message: "Switch block must have a variable selected",
            field: "variable",
        })
        return errors // If no variable, can't validate cases properly
    }

    // Find variable data to understand expected case values
    const fullVariableData =
        availableVariables.find((v) => v.fixupName === block.variable) ||
        formData.variables?.find((v) => v.fixupName === block.variable)

    if (!block.cases || block.cases.length === 0) {
        errors.push({
            type: "error",
            message: "Switch block must have at least one case",
            field: "cases",
        })
    } else {
        // Check for duplicate case values
        const caseValues = block.cases
            .map((c) => c.value)
            .filter(
                (v) =>
                    v !== undefined && v !== null && v.toString().trim() !== "",
            )
        const duplicates = caseValues.filter(
            (value, index) => caseValues.indexOf(value) !== index,
        )
        if (duplicates.length > 0) {
            errors.push({
                type: "warning",
                message: `Duplicate case values found: ${[...new Set(duplicates)].join(", ")}`,
                field: "cases",
            })
        }

        // For enum variables, warn if cases don't match enum values
        if (fullVariableData?.type === "enum" && fullVariableData?.enumValues) {
            const validEnumValues = Object.keys(fullVariableData.enumValues)
            const invalidCaseValues = caseValues.filter(
                (value) => !validEnumValues.includes(value),
            )
            if (invalidCaseValues.length > 0) {
                errors.push({
                    type: "warning",
                    message: `Case values don't match enum options: ${invalidCaseValues.join(", ")}`,
                    field: "cases",
                })
            }
        }

        // For boolean variables, warn about invalid case values
        if (fullVariableData?.type === "boolean") {
            const invalidBooleanValues = caseValues.filter(
                (value) => value !== "0" && value !== "1",
            )
            if (invalidBooleanValues.length > 0) {
                errors.push({
                    type: "warning",
                    message: `Boolean variable should only have case values "0" (False) or "1" (True), found: ${invalidBooleanValues.join(", ")}`,
                    field: "cases",
                })
            }
        }
    }

    return errors
}

const validateCaseBlock = (
    block,
    allBlocks = [],
    availableVariables = [],
    formData = {},
) => {
    const errors = []

    // Find the parent switch to understand expected value types
    const findParentSwitch = (caseBlockId, blockList) => {
        const searchInBlock = (blocks) => {
            for (const searchBlock of blocks) {
                if (searchBlock.type === "switchCase" && searchBlock.cases) {
                    const hasCase = searchBlock.cases.some(
                        (caseBlock) => caseBlock.id === caseBlockId,
                    )
                    if (hasCase) {
                        return searchBlock
                    }
                }

                // Check child containers recursively
                if (BLOCK_DEFINITIONS[searchBlock.type]?.canContainChildren) {
                    const childContainers =
                        BLOCK_DEFINITIONS[searchBlock.type].childContainers ||
                        []
                    for (const container of childContainers) {
                        if (
                            searchBlock[container] &&
                            Array.isArray(searchBlock[container])
                        ) {
                            const found = searchInBlock(searchBlock[container])
                            if (found) return found
                        }
                    }
                }
            }
            return null
        }

        return searchInBlock(blockList)
    }

    const parentSwitch = findParentSwitch(block.id, allBlocks)
    const switchVariable = parentSwitch?.variable
    const fullVariableData =
        availableVariables.find((v) => v.fixupName === switchVariable) ||
        formData.variables?.find((v) => v.fixupName === switchVariable)

    // Get effective case value (including UI defaults)
    const effectiveCaseValue = getEffectiveCaseValue(block, fullVariableData)

    if (effectiveCaseValue === null || effectiveCaseValue === undefined) {
        // Truly empty case value - can be intentional (default case)
        errors.push({
            type: "warning",
            message: "Case has no value - this will act as a default case",
            field: "value",
        })
    } else if (fullVariableData) {
        // Validate that case value is appropriate for the variable type
        if (
            fullVariableData.type === "boolean" &&
            effectiveCaseValue !== "0" &&
            effectiveCaseValue !== "1"
        ) {
            errors.push({
                type: "warning",
                message: `Boolean case should be "0" (False) or "1" (True), not "${effectiveCaseValue}"`,
                field: "value",
            })
        } else if (
            fullVariableData.type === "enum" &&
            fullVariableData.enumValues
        ) {
            const validEnumValues = Object.keys(fullVariableData.enumValues)
            if (!validEnumValues.includes(effectiveCaseValue.toString())) {
                errors.push({
                    type: "warning",
                    message: `Case value "${effectiveCaseValue}" is not a valid option for this enum variable`,
                    field: "value",
                })
            }
        } else if (fullVariableData.type === "number") {
            const numValue = parseFloat(effectiveCaseValue)
            if (isNaN(numValue)) {
                errors.push({
                    type: "warning",
                    message: `Case value "${effectiveCaseValue}" should be a number for numeric variables`,
                    field: "value",
                })
            }
        }
    }

    if (!block.thenBlocks || block.thenBlocks.length === 0) {
        errors.push({
            type: "warning",
            message: "Case has no actions defined - it will not do anything",
            field: "thenBlocks",
        })
    }

    return errors
}

const validateChangeInstanceBlock = (block, formData = {}) => {
    const errors = []

    if (!block.instanceName || block.instanceName.trim() === "") {
        errors.push({
            type: "error",
            message: "Change Instance block must have an instance selected",
            field: "instanceName",
        })
    } else if (formData.instances) {
        // Check if the instance actually exists
        const instanceExists = Object.values(formData.instances).some(
            (instance) =>
                !instance._toRemove && instance.Name === block.instanceName,
        )
        if (!instanceExists) {
            errors.push({
                type: "warning",
                message:
                    "Selected instance does not exist in the current package",
                field: "instanceName",
            })
        }
    }

    return errors
}

const validateRandomSelectionBlock = (block, formData = {}) => {
    const errors = []

    if (
        !block.options ||
        !Array.isArray(block.options) ||
        block.options.length === 0
    ) {
        errors.push({
            type: "error",
            message: "Random Selection block must have at least one option",
            field: "options",
        })
    } else if (block.options.length < 2) {
        errors.push({
            type: "warning",
            message:
                "Random Selection should have at least 2 options to be useful",
            field: "options",
        })
    }

    // Validate each option if they're instance paths
    if (block.options && formData.instances) {
        block.options.forEach((option, index) => {
            if (typeof option === "string" && option.trim() !== "") {
                const instanceExists = Object.values(formData.instances).some(
                    (instance) =>
                        !instance._toRemove && instance.Name === option,
                )
                if (!instanceExists) {
                    errors.push({
                        type: "info",
                        message: `Option ${index + 1}: Instance "${option}" may not exist in the package`,
                        field: `options[${index}]`,
                    })
                }
            }
        })
    }

    return errors
}

const validateAddOverlayBlock = (block, formData = {}) => {
    const errors = []

    if (!block.overlayName || block.overlayName.trim() === "") {
        errors.push({
            type: "error",
            message: "Add Overlay block must have an overlay selected",
            field: "overlayName",
        })
    } else if (formData.instances) {
        // Check if the overlay instance exists
        const instanceExists = Object.values(formData.instances).some(
            (instance) =>
                !instance._toRemove && instance.Name === block.overlayName,
        )
        if (!instanceExists) {
            errors.push({
                type: "warning",
                message:
                    "Selected overlay instance does not exist in the current package",
                field: "overlayName",
            })
        }
    }

    return errors
}

const validateAddGlobalEntBlock = (block, formData = {}) => {
    const errors = []

    if (!block.instanceName || block.instanceName.trim() === "") {
        errors.push({
            type: "error",
            message: "Add Global Instance block must have an instance selected",
            field: "instanceName",
        })
    } else if (formData.instances) {
        // Check if the instance actually exists
        const instanceExists = Object.values(formData.instances).some(
            (instance) =>
                !instance._toRemove && instance.Name === block.instanceName,
        )
        if (!instanceExists) {
            errors.push({
                type: "warning",
                message:
                    "Selected instance does not exist in the current package",
                field: "instanceName",
            })
        }
    }

    return errors
}

const validateOffsetInstanceBlock = (block) => {
    const errors = []

    // Get effective offset value (component defaults to "0 0 0")
    const offsetValue = block.offset || "0 0 0"

    if (!offsetValue || offsetValue.toString().trim() === "") {
        errors.push({
            type: "error",
            message: "Offset Instance block must have an offset value",
            field: "offset",
        })
    } else {
        // Validate X Y Z coordinate format (e.g., "0 0 0", "10 -5 3.5")
        const parts = offsetValue.toString().trim().split(/\s+/)

        if (parts.length !== 3) {
            errors.push({
                type: "warning",
                message:
                    'Offset should have 3 coordinates (X Y Z), e.g., "0 0 0"',
                field: "offset",
            })
        } else {
            // Validate each coordinate is a valid number
            const invalidCoords = []
            parts.forEach((part, index) => {
                const coord = parseFloat(part)
                if (isNaN(coord)) {
                    invalidCoords.push(["X", "Y", "Z"][index])
                }
            })

            if (invalidCoords.length > 0) {
                errors.push({
                    type: "error",
                    message: `Invalid coordinate values for ${invalidCoords.join(", ")}. Each coordinate must be a number.`,
                    field: "offset",
                })
            }
        }
    }

    return errors
}

const validateDebugBlock = (block, availableVariables = []) => {
    const errors = []

    if (!block.message || block.message.trim() === "") {
        errors.push({
            type: "warning",
            message:
                "Debug block has no message - consider adding one for better debugging",
            field: "message",
        })
    }

    return errors
}

const validateSetInstVarBlock = (block) => {
    const errors = []

    if (!block.variable || block.variable.trim() === "") {
        errors.push({
            type: "error",
            message: "Change Fixup must have a variable entered",
            field: "variable",
        })
    }

    if (!block.newValue || block.newValue.trim() === "") {
        errors.push({
            type: "warning",
            message: "Change Fixup has no new value set",
            field: "newValue",
        })
    }

    return errors
}

// Get all validation errors for a list of blocks recursively
const getAllBlockErrors = (
    blocks = [],
    allBlocks = [],
    availableVariables = [],
    formData = {},
) => {
    let allErrors = []

    blocks.forEach((block) => {
        const blockErrors = validateBlock(
            block,
            allBlocks,
            availableVariables,
            formData,
        )
        if (blockErrors.length > 0) {
            allErrors.push({
                blockId: block.id,
                blockType: block.type,
                blockName: block.displayName || block.type,
                errors: blockErrors,
            })
        }

        // Check child blocks recursively
        if (BLOCK_DEFINITIONS[block.type]?.canContainChildren) {
            const childContainers =
                BLOCK_DEFINITIONS[block.type].childContainers || []
            childContainers.forEach((container) => {
                if (block[container] && Array.isArray(block[container])) {
                    const childErrors = getAllBlockErrors(
                        block[container],
                        allBlocks,
                        availableVariables,
                        formData,
                    )
                    allErrors = allErrors.concat(childErrors)
                }
            })
        }
    })

    return allErrors
}

// Error Badge Component
function ErrorBadge({ errors = [], size = "small" }) {
    if (errors.length === 0) return null

    const errorCount = errors.filter((e) => e.type === "error").length
    const warningCount = errors.filter((e) => e.type === "warning").length

    if (errorCount === 0 && warningCount === 0) return null

    const primaryError = errorCount > 0 ? "error" : "warning"
    const primaryCount = errorCount > 0 ? errorCount : warningCount

    return (
        <Tooltip
            title={
                <Box>
                    {errorCount > 0 && (
                        <Typography variant="body2" color="error.main">
                            {errorCount} Error{errorCount !== 1 ? "s" : ""}
                        </Typography>
                    )}
                    {warningCount > 0 && (
                        <Typography variant="body2" color="warning.main">
                            {warningCount} Warning
                            {warningCount !== 1 ? "s" : ""}
                        </Typography>
                    )}
                    <Box sx={{ mt: 1 }}>
                        {errors.slice(0, 3).map((error, index) => (
                            <Typography
                                key={index}
                                variant="caption"
                                display="block">
                                • {error.message}
                            </Typography>
                        ))}
                        {errors.length > 3 && (
                            <Typography
                                variant="caption"
                                color="text.secondary">
                                ... and {errors.length - 3} more
                            </Typography>
                        )}
                    </Box>
                </Box>
            }
            arrow>
            <Chip
                icon={
                    primaryError === "error" ? (
                        <Error fontSize="small" />
                    ) : (
                        <Warning fontSize="small" />
                    )
                }
                label={primaryCount}
                size="small"
                color={primaryError}
                variant="filled"
                sx={{
                    height: 28, // Slightly smaller to match other small elements
                    fontSize: "0.7rem",
                    fontWeight: "bold",
                    minWidth: 32, // More compact width
                    "& .MuiChip-icon": {
                        fontSize: "14px", // Smaller icon
                        marginLeft: "4px",
                        marginRight: "-2px",
                    },
                    "& .MuiChip-label": {
                        px: 0.5, // Tighter padding for compact appearance
                    },
                }}
            />
        </Tooltip>
    )
}

// Droppable Zone Component for nested blocks
function DroppableZone({
    id,
    children,
    isEmpty = false,
    label = "Drop blocks here",
}) {
    const { isOver, setNodeRef } = useDroppable({
        id: id,
    })

    console.log(`DroppableZone ${id}:`, { isOver, isEmpty })

    return (
        <Box
            ref={setNodeRef}
            sx={{
                minHeight: isEmpty ? 120 : "auto",
                border: isEmpty
                    ? "2px dashed"
                    : isOver
                      ? "2px dashed"
                      : "1px solid rgba(255, 255, 255, 0.08)", // Subtle border for non-empty zones
                borderColor: isEmpty
                    ? isOver
                        ? "#d2b019ff"
                        : "#555"
                    : isOver
                      ? "#d2b019ff"
                      : "rgba(255, 255, 255, 0.08)",
                borderRadius: 3,
                p: isEmpty ? 4 : 3, // More generous padding for better visual separation
                backgroundColor: isEmpty
                    ? isOver
                        ? "rgba(210, 176, 25, 0.1)"
                        : "rgba(42, 45, 48, 0.3)"
                    : isOver
                      ? "rgba(210, 176, 25, 0.05)"
                      : "rgba(255, 255, 255, 0.02)", // Very subtle background for non-empty
                transition: "all 0.2s ease-out",
                transform: isOver ? "scale(1.03)" : "scale(1)", // Slightly more pronounced for better feedback
                boxShadow: isOver
                    ? "0 4px 15px rgba(210, 176, 25, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
                    : isEmpty
                      ? "inset 0 1px 0 rgba(255, 255, 255, 0.05)"
                      : "inset 0 1px 0 rgba(255, 255, 255, 0.02)",
                "&:hover": {
                    borderColor: isEmpty
                        ? "#d2b019ff"
                        : "rgba(210, 176, 25, 0.3)",
                    backgroundColor: isEmpty
                        ? "rgba(210, 176, 25, 0.08)"
                        : "rgba(210, 176, 25, 0.02)",
                },
                // Removed circle outline - was too distracting
            }}>
            {isEmpty ? (
                <Box sx={{ textAlign: "center" }}>
                    <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ mb: 1, display: "block" }}>
                        {label}
                    </Typography>
                    <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ fontSize: "0.7rem", opacity: 0.7 }}>
                        Click "Add Block" to create new logic blocks
                    </Typography>
                </Box>
            ) : (
                <Box sx={{ "& > *": { mb: 1 }, "& > *:last-child": { mb: 0 } }}>
                    {children}
                </Box>
            )}
        </Box>
    )
}

// Individual Block Components
function IfBlock({ block, onUpdateProperty, availableVariables, formData }) {
    return (
        <Box sx={{ p: 2 }}>
            {/* IF Condition Configuration */}
            <Box sx={{ mb: 2 }}>
                <Typography
                    variant="subtitle2"
                    color="text.secondary"
                    gutterBottom>
                    IF Condition
                </Typography>
                <Box sx={{ mt: 2 }}>
                    <Grid container spacing={2} alignItems="center">
                        <Grid xs={4}>
                            <FormControl fullWidth size="small">
                                <InputLabel>Variable</InputLabel>
                                <Select
                                    value={block.variable || ""}
                                    onChange={(e) =>
                                        onUpdateProperty(
                                            "variable",
                                            e.target.value,
                                        )
                                    }
                                    label="Variable"
                                    sx={{
                                        "& .MuiOutlinedInput-root": {
                                            height: 40,
                                            minHeight: 40,
                                            maxHeight: 40,
                                        },
                                        "& .MuiSelect-select": {
                                            height: "20px !important",
                                            lineHeight: "20px !important",
                                            paddingTop: "10px !important",
                                            paddingBottom: "10px !important",
                                            minWidth: "120px",
                                            display: "flex",
                                            alignItems: "center",
                                        },
                                    }}>
                                    {availableVariables.map((variable) => (
                                        <MenuItem
                                            key={variable.fixupName}
                                            value={variable.fixupName}>
                                            <Box
                                                sx={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: 1,
                                                    py: 0.5,
                                                }}>
                                                {variable.isSystemVariable ? (
                                                    <Hive
                                                        fontSize="small"
                                                        sx={{
                                                            color: "#FFC107",
                                                        }}
                                                    />
                                                ) : (
                                                    <Code fontSize="small" />
                                                )}
                                                {variable.displayName}
                                            </Box>
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid xs={4}>
                            <FormControl fullWidth size="small">
                                <InputLabel>Operator</InputLabel>
                                <Select
                                    value={block.operator || "=="}
                                    onChange={(e) =>
                                        onUpdateProperty(
                                            "operator",
                                            e.target.value,
                                        )
                                    }
                                    label="Operator"
                                    sx={{
                                        "& .MuiOutlinedInput-root": {
                                            height: 40,
                                            minHeight: 40,
                                            maxHeight: 40,
                                        },
                                        "& .MuiSelect-select": {
                                            height: "20px !important",
                                            lineHeight: "20px !important",
                                            paddingTop: "10px !important",
                                            paddingBottom: "10px !important",
                                            minWidth: "80px",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                        },
                                    }}>
                                    {(() => {
                                        const selectedVariable =
                                            availableVariables.find(
                                                (v) =>
                                                    v.fixupName ===
                                                    block.variable,
                                            )
                                        const fullVariableData =
                                            availableVariables.find(
                                                (v) =>
                                                    v.fixupName ===
                                                    block.variable,
                                            ) ||
                                            formData.variables?.find(
                                                (v) =>
                                                    v.fixupName ===
                                                    block.variable,
                                            )

                                        // For boolean and enum types, only show == and !=
                                        if (
                                            fullVariableData?.type ===
                                                "boolean" ||
                                            fullVariableData?.type === "enum"
                                        ) {
                                            return [
                                                <MenuItem key="eq" value="==">
                                                    =
                                                </MenuItem>,
                                                <MenuItem key="ne" value="!=">
                                                    !=
                                                </MenuItem>,
                                            ]
                                        }

                                        // For number types, show all operators
                                        if (
                                            fullVariableData?.type === "number"
                                        ) {
                                            return [
                                                <MenuItem key="eq" value="==">
                                                    =
                                                </MenuItem>,
                                                <MenuItem key="ne" value="!=">
                                                    !=
                                                </MenuItem>,
                                                <MenuItem key="gt" value=">">
                                                    &gt;
                                                </MenuItem>,
                                                <MenuItem key="lt" value="<">
                                                    &lt;
                                                </MenuItem>,
                                                <MenuItem key="gte" value=">=">
                                                    &gt;=
                                                </MenuItem>,
                                                <MenuItem key="lte" value="<=">
                                                    &lt;=
                                                </MenuItem>,
                                            ]
                                        }

                                        // Default fallback - show basic operators when no variable is selected
                                        return [
                                            <MenuItem key="eq" value="==">
                                                =
                                            </MenuItem>,
                                            <MenuItem key="ne" value="!=">
                                                !=
                                            </MenuItem>,
                                        ]
                                    })()}
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid xs={4}>
                            {/* Dynamic value field based on variable type */}
                            {(() => {
                                const selectedVariable =
                                    availableVariables.find(
                                        (v) => v.fixupName === block.variable,
                                    )
                                if (!selectedVariable) {
                                    return (
                                        <TextField
                                            fullWidth
                                            size="small"
                                            label="Value"
                                            value={block.value || ""}
                                            onChange={(e) =>
                                                onUpdateProperty(
                                                    "value",
                                                    e.target.value,
                                                )
                                            }
                                            sx={{
                                                "& .MuiOutlinedInput-root": {
                                                    height: 40,
                                                    minHeight: 40,
                                                    maxHeight: 40,
                                                },
                                                "& .MuiInputBase-input": {
                                                    height: "20px !important",
                                                    lineHeight:
                                                        "20px !important",
                                                    paddingTop:
                                                        "10px !important",
                                                    paddingBottom:
                                                        "10px !important",
                                                    minWidth: "100px",
                                                    display: "flex",
                                                    alignItems: "center",
                                                },
                                            }}
                                        />
                                    )
                                }

                                // Find the full variable data from formData to get type and enum values
                                const fullVariableData =
                                    availableVariables.find(
                                        (v) => v.fixupName === block.variable,
                                    ) ||
                                    formData.variables?.find(
                                        (v) => v.fixupName === block.variable,
                                    )

                                if (fullVariableData?.type === "boolean") {
                                    return (
                                        <FormControl fullWidth size="small">
                                            <InputLabel>Value</InputLabel>
                                            <Select
                                                value={block.value || "1"}
                                                onChange={(e) =>
                                                    onUpdateProperty(
                                                        "value",
                                                        e.target.value,
                                                    )
                                                }
                                                label="Value"
                                                sx={{
                                                    "& .MuiOutlinedInput-root":
                                                        {
                                                            height: 40,
                                                            minHeight: 40,
                                                            maxHeight: 40,
                                                        },
                                                    "& .MuiSelect-select": {
                                                        height: "20px !important",
                                                        lineHeight:
                                                            "20px !important",
                                                        paddingTop:
                                                            "10px !important",
                                                        paddingBottom:
                                                            "10px !important",
                                                        minWidth: "100px",
                                                        display: "flex",
                                                        alignItems: "center",
                                                    },
                                                }}>
                                                <MenuItem value="1">
                                                    True
                                                </MenuItem>
                                                <MenuItem value="0">
                                                    False
                                                </MenuItem>
                                            </Select>
                                        </FormControl>
                                    )
                                } else if (
                                    fullVariableData?.type === "enum" &&
                                    fullVariableData?.enumValues
                                ) {
                                    return (
                                        <FormControl fullWidth size="small">
                                            <InputLabel>Value</InputLabel>
                                            <Select
                                                value={
                                                    block.value ||
                                                    Object.keys(
                                                        fullVariableData.enumValues,
                                                    )[0]
                                                }
                                                onChange={(e) =>
                                                    onUpdateProperty(
                                                        "value",
                                                        e.target.value,
                                                    )
                                                }
                                                label="Value"
                                                sx={{
                                                    "& .MuiOutlinedInput-root":
                                                        {
                                                            height: 40,
                                                            minHeight: 40,
                                                            maxHeight: 40,
                                                        },
                                                    "& .MuiSelect-select": {
                                                        height: "20px !important",
                                                        lineHeight:
                                                            "20px !important",
                                                        paddingTop:
                                                            "10px !important",
                                                        paddingBottom:
                                                            "10px !important",
                                                        minWidth: "120px",
                                                        display: "flex",
                                                        alignItems: "center",
                                                    },
                                                }}>
                                                {Object.entries(
                                                    fullVariableData.enumValues,
                                                ).map(([value, label]) => (
                                                    <MenuItem
                                                        key={value}
                                                        value={value}>
                                                        {label}
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                        </FormControl>
                                    )
                                } else {
                                    return (
                                        <TextField
                                            fullWidth
                                            size="small"
                                            label="Value"
                                            type={
                                                fullVariableData?.type ===
                                                "number"
                                                    ? "number"
                                                    : "text"
                                            }
                                            value={block.value || ""}
                                            onChange={(e) => {
                                                let value = e.target.value
                                                if (
                                                    block.variable ===
                                                        "$timer_delay" &&
                                                    value !== ""
                                                ) {
                                                    const numValue =
                                                        Number(value)
                                                    if (
                                                        !isNaN(numValue) &&
                                                        numValue < 3 &&
                                                        numValue !== -1
                                                    ) {
                                                        value = -1
                                                    }
                                                }
                                                onUpdateProperty("value", value)
                                            }}
                                            inputProps={{
                                                min:
                                                    fullVariableData?.type ===
                                                    "number"
                                                        ? 0
                                                        : undefined,
                                                step:
                                                    fullVariableData?.type ===
                                                    "number"
                                                        ? 1
                                                        : undefined,
                                            }}
                                            sx={{
                                                "& .MuiOutlinedInput-root": {
                                                    height: 40,
                                                    minHeight: 40,
                                                    maxHeight: 40,
                                                },
                                                "& .MuiInputBase-input": {
                                                    height: "20px !important",
                                                    lineHeight:
                                                        "20px !important",
                                                    paddingTop:
                                                        "10px !important",
                                                    paddingBottom:
                                                        "10px !important",
                                                    minWidth: "100px",
                                                    display: "flex",
                                                    alignItems: "center",
                                                },
                                            }}
                                        />
                                    )
                                }
                            })()}
                        </Grid>
                    </Grid>
                </Box>
            </Box>
        </Box>
    )
}

function ChangeInstanceBlock({
    block,
    onUpdateProperty,
    availableInstances,
    editingNames,
}) {
    return (
        <Box sx={{ p: 2 }}>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Change Instance To
            </Typography>
            <Box sx={{ mt: 2 }}>
                <FormControl fullWidth size="small">
                    <InputLabel>Instance</InputLabel>
                    <Select
                        value={block.instanceName || ""}
                        onChange={(e) =>
                            onUpdateProperty("instanceName", e.target.value)
                        }
                        label="Instance"
                        sx={{
                            "& .MuiOutlinedInput-root": {
                                height: 40,
                                minHeight: 40,
                                maxHeight: 40,
                            },
                            "& .MuiSelect-select": {
                                height: "20px !important",
                                lineHeight: "20px !important",
                                paddingTop: "10px !important",
                                paddingBottom: "10px !important",
                                minWidth: "150px",
                                display: "flex",
                                alignItems: "center",
                            },
                        }}>
                        {availableInstances.map((instance, index) => (
                            <MenuItem key={index} value={instance.Name}>
                                <Box
                                    sx={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 1,
                                        py: 0.5,
                                    }}>
                                    <Category fontSize="small" />
                                    <Typography variant="body2">
                                        {editingNames[instance.index] !==
                                        undefined
                                            ? editingNames[instance.index]
                                            : instance.displayName ||
                                              `Instance ${index}`}
                                    </Typography>
                                </Box>
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
            </Box>
        </Box>
    )
}

function AddOverlayBlock({
    block,
    onUpdateProperty,
    availableInstances,
    editingNames,
}) {
    return (
        <Box sx={{ p: 2 }}>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Add Overlay Instance
            </Typography>
            <Box sx={{ mt: 2 }}>
                <FormControl fullWidth size="small">
                    <InputLabel>Overlay Instance</InputLabel>
                    <Select
                        value={block.overlayName || ""}
                        onChange={(e) =>
                            onUpdateProperty("overlayName", e.target.value)
                        }
                        label="Overlay Instance"
                        sx={{
                            "& .MuiOutlinedInput-root": {
                                height: 40,
                                minHeight: 40,
                                maxHeight: 40,
                            },
                            "& .MuiSelect-select": {
                                height: "20px !important",
                                lineHeight: "20px !important",
                                paddingTop: "10px !important",
                                paddingBottom: "10px !important",
                                minWidth: "150px",
                                display: "flex",
                                alignItems: "center",
                            },
                        }}>
                        {availableInstances.map((instance, index) => (
                            <MenuItem key={index} value={instance.Name}>
                                <Box
                                    sx={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 1,
                                        py: 0.5,
                                    }}>
                                    <AddCircleOutline fontSize="small" />
                                    <Typography variant="body2">
                                        {editingNames[instance.index] !==
                                        undefined
                                            ? editingNames[instance.index]
                                            : instance.displayName ||
                                              `Instance ${index}`}
                                    </Typography>
                                </Box>
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
            </Box>
        </Box>
    )
}

function AddGlobalInstanceBlock({
    block,
    onUpdateProperty,
    availableInstances,
    editingNames,
}) {
    return (
        <Box sx={{ p: 2 }}>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Add Global Instance
            </Typography>
            <Box sx={{ mt: 2 }}>
                <FormControl fullWidth size="small">
                    <InputLabel>Instance</InputLabel>
                    <Select
                        value={block.instanceName || ""}
                        onChange={(e) =>
                            onUpdateProperty("instanceName", e.target.value)
                        }
                        label="Instance"
                        sx={{
                            "& .MuiOutlinedInput-root": {
                                height: 40,
                                minHeight: 40,
                                maxHeight: 40,
                            },
                            "& .MuiSelect-select": {
                                height: "20px !important",
                                lineHeight: "20px !important",
                                paddingTop: "10px !important",
                                paddingBottom: "10px !important",
                                minWidth: "150px",
                                display: "flex",
                                alignItems: "center",
                            },
                        }}>
                        {availableInstances.map((instance, index) => (
                            <MenuItem key={index} value={instance.Name}>
                                <Box
                                    sx={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 1,
                                        py: 0.5,
                                    }}>
                                    <Add fontSize="small" />
                                    <Typography variant="body2">
                                        {editingNames[instance.index] !==
                                        undefined
                                            ? editingNames[instance.index]
                                            : instance.displayName ||
                                              `Instance ${index}`}
                                    </Typography>
                                </Box>
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
            </Box>
        </Box>
    )
}

function IfHasBlock({ block, onUpdateProperty }) {
    return (
        <Box sx={{ p: 2 }}>
            <Box sx={{ mb: 2 }}>
                <Typography
                    variant="subtitle2"
                    color="text.secondary"
                    gutterBottom>
                    If Global Block
                </Typography>
                <Box sx={{ mt: 2 }}>
                    <TextField
                        fullWidth
                        size="small"
                        label="Global Variable Value"
                        placeholder="e.g., CLEAN, RETRO, CAVE_JOHNSON"
                        value={block.hasValue || ""}
                        onChange={(e) =>
                            onUpdateProperty("hasValue", e.target.value)
                        }
                        sx={{
                            "& .MuiOutlinedInput-root": {
                                height: 40,
                                minHeight: 40,
                                maxHeight: 40,
                            },
                        }}
                    />
                </Box>
            </Box>
        </Box>
    )
}

function IfHasElseBlock({ block, onUpdateProperty }) {
    return (
        <Box sx={{ p: 2 }}>
            <Box sx={{ mb: 2 }}>
                <Typography
                    variant="subtitle2"
                    color="text.secondary"
                    gutterBottom>
                    If Global Else Block
                </Typography>
                <Box sx={{ mt: 2 }}>
                    <TextField
                        fullWidth
                        size="small"
                        label="Global Variable Value"
                        placeholder="e.g., CLEAN, RETRO, CAVE_JOHNSON"
                        value={block.hasValue || ""}
                        onChange={(e) =>
                            onUpdateProperty("hasValue", e.target.value)
                        }
                        sx={{
                            "& .MuiOutlinedInput-root": {
                                height: 40,
                                minHeight: 40,
                                maxHeight: 40,
                            },
                        }}
                    />
                </Box>
            </Box>
        </Box>
    )
}

function OffsetInstanceBlock({ block, onUpdateProperty }) {
    return (
        <Box sx={{ p: 2 }}>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Offset Instance Position
            </Typography>
            <Box
                sx={{
                    mt: 2,
                    display: "flex",
                    alignItems: "center",
                    gap: 2,
                    flexWrap: "wrap",
                }}>
                {/* X Input */}
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Typography
                        variant="body2"
                        sx={{ fontWeight: 500, minWidth: "12px" }}>
                        X
                    </Typography>
                    <TextField
                        size="small"
                        type="number"
                        placeholder="0"
                        value={(() => {
                            const offset = block.offset || "0 0 0"
                            const parts = offset.split(" ")
                            return parts[0] || "0"
                        })()}
                        onChange={(e) => {
                            const offset = block.offset || "0 0 0"
                            const parts = offset.split(" ")
                            const newOffset = `${e.target.value} ${parts[1] || "0"} ${parts[2] || "0"}`
                            onUpdateProperty("offset", newOffset)
                        }}
                        sx={{
                            width: 80,
                            "& .MuiOutlinedInput-root": {
                                height: 32,
                                minHeight: 32,
                                maxHeight: 32,
                            },
                            "& .MuiInputBase-input": {
                                textAlign: "center",
                                fontSize: "0.875rem",
                                padding: "6px 8px",
                            },
                        }}
                    />
                </Box>

                {/* Y Input */}
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Typography
                        variant="body2"
                        sx={{ fontWeight: 500, minWidth: "12px" }}>
                        Y
                    </Typography>
                    <TextField
                        size="small"
                        type="number"
                        placeholder="0"
                        value={(() => {
                            const offset = block.offset || "0 0 0"
                            const parts = offset.split(" ")
                            return parts[1] || "0"
                        })()}
                        onChange={(e) => {
                            const offset = block.offset || "0 0 0"
                            const parts = offset.split(" ")
                            const newOffset = `${parts[0] || "0"} ${e.target.value} ${parts[2] || "0"}`
                            onUpdateProperty("offset", newOffset)
                        }}
                        sx={{
                            width: 80,
                            "& .MuiOutlinedInput-root": {
                                height: 32,
                                minHeight: 32,
                                maxHeight: 32,
                            },
                            "& .MuiInputBase-input": {
                                textAlign: "center",
                                fontSize: "0.875rem",
                                padding: "6px 8px",
                            },
                        }}
                    />
                </Box>

                {/* Z Input */}
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Typography
                        variant="body2"
                        sx={{ fontWeight: 500, minWidth: "12px" }}>
                        Z
                    </Typography>
                    <TextField
                        size="small"
                        type="number"
                        placeholder="0"
                        value={(() => {
                            const offset = block.offset || "0 0 0"
                            const parts = offset.split(" ")
                            return parts[2] || "0"
                        })()}
                        onChange={(e) => {
                            const offset = block.offset || "0 0 0"
                            const parts = offset.split(" ")
                            const newOffset = `${parts[0] || "0"} ${parts[1] || "0"} ${e.target.value}`
                            onUpdateProperty("offset", newOffset)
                        }}
                        sx={{
                            width: 80,
                            "& .MuiOutlinedInput-root": {
                                height: 32,
                                minHeight: 32,
                                maxHeight: 32,
                            },
                            "& .MuiInputBase-input": {
                                textAlign: "center",
                                fontSize: "0.875rem",
                                padding: "6px 8px",
                            },
                        }}
                    />
                </Box>
            </Box>

            {/* Axis Descriptions */}
            <Box sx={{ mt: 1, display: "flex", gap: 2, flexWrap: "wrap" }}>
                <Typography variant="caption" color="text.secondary">
                    X: Forward/Back
                </Typography>
                <Typography variant="caption" color="text.secondary">
                    Y: Left/Right
                </Typography>
                <Typography variant="caption" color="text.secondary">
                    Z: Up/Down
                </Typography>
            </Box>
        </Box>
    )
}

function DebugBlock({ block, onUpdateProperty, availableVariables }) {
    const [message, setMessage] = useState(block.message || "")

    const handleMessageChange = (newMessage) => {
        setMessage(newMessage)
        onUpdateProperty("message", newMessage)
    }

    // Function to replace variables in the message
    const replaceVariables = (text) => {
        if (!text) return text

        // Find all variable references like $variable_name
        return text.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (match, varName) => {
            const variable = availableVariables.find(
                (v) => v.fixupName === `$${varName}` || v.name === varName,
            )
            if (variable) {
                return `<span style="color: #4CAF50; font-weight: bold;">${match}</span>`
            }
            return `<span style="color: #f44336; font-weight: bold;">${match}</span>`
        })
    }

    const processedMessage = replaceVariables(message)

    return (
        <Box sx={{ p: 2 }}>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Debug Output
            </Typography>

            <TextField
                fullWidth
                multiline
                rows={1}
                placeholder="Enter debug message... Use $variable_name to reference variables"
                value={message}
                onChange={(e) => handleMessageChange(e.target.value)}
                sx={{ mb: 2 }}
            />

            {message && (
                <Box sx={{ mt: 2 }}>
                    <Typography
                        variant="caption"
                        color="text.secondary"
                        gutterBottom>
                        Preview:
                    </Typography>
                    <Box
                        sx={{
                            p: 1,
                            backgroundColor: "#1a1a1a",
                            borderRadius: 1,
                            border: "1px solid #333",
                        }}
                        dangerouslySetInnerHTML={{ __html: processedMessage }}
                    />
                </Box>
            )}

            <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mt: 1 }}>
                Available variables:{" "}
                {availableVariables.map((v) => v.fixupName).join(", ")}
            </Typography>
        </Box>
    )
}

function SetInstVarBlock({ block, onUpdateProperty }) {
    return (
        <Box sx={{ p: 2 }}>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Change Fixup Variable
            </Typography>

            <Stack spacing={2}>
                <TextField
                    fullWidth
                    size="small"
                    label="Variable"
                    placeholder="$variable_name"
                    value={block.variable || ""}
                    onChange={(e) =>
                        onUpdateProperty("variable", e.target.value)
                    }
                />

                <TextField
                    fullWidth
                    size="small"
                    label="New Value"
                    placeholder="Enter new value"
                    value={block.newValue || ""}
                    onChange={(e) =>
                        onUpdateProperty("newValue", e.target.value)
                    }
                />
            </Stack>

            <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mt: 2 }}>
                Sets the instance variable to a new value when this condition runs
            </Typography>
        </Box>
    )
}

// Sortable Block Component - Generic for all block types
function SortableBlock({
    block,
    onUpdateBlock,
    onDeleteBlock,
    onAddChildBlock,
    availableInstances,
    availableVariables,
    formData,
    editingNames = {},
    depth = 0,
    blocks = [],
    onDuplicateBlock,
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: block.id })

    // Get validation errors for this block
    const blockErrors = validateBlock(
        block,
        blocks,
        availableVariables,
        formData,
    )
    const hasErrors = blockErrors.length > 0
    const hasErrorType = blockErrors.some((e) => e.type === "error")

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.8 : 1,
    }

    const handleUpdateProperty = (property, value) => {
        onUpdateBlock(block.id, { ...block, [property]: value })
    }

    const handleAddChild = (containerKey) => {
        onAddChildBlock(block.id, containerKey)
    }

    // Helper function to find parent switch block
    const findParentSwitch = (caseBlockId, allBlocks) => {
        const searchInBlock = (blockList) => {
            for (const block of blockList) {
                if (block.type === "switchCase" && block.cases) {
                    const hasCase = block.cases.some(
                        (caseBlock) => caseBlock.id === caseBlockId,
                    )
                    if (hasCase) {
                        return block
                    }
                }

                // Check child containers
                if (BLOCK_DEFINITIONS[block.type]?.canContainChildren) {
                    const childContainers =
                        BLOCK_DEFINITIONS[block.type].childContainers || []
                    for (const container of childContainers) {
                        if (
                            block[container] &&
                            Array.isArray(block[container])
                        ) {
                            const found = searchInBlock(block[container])
                            if (found) return found
                        }
                    }
                }
            }
            return null
        }

        return searchInBlock(allBlocks)
    }

    const getBlockIcon = (blockType) => {
        switch (blockType) {
            case "if":
                return <AccountTree fontSize="small" />
            case "switchCase":
                return <Category fontSize="small" />
            case "case":
                return <Code fontSize="small" />
            case "changeInstance":
                return <SwapHoriz fontSize="small" />
            case "randomSelection":
                return <Hive fontSize="small" />
            case "addOverlay":
                return <AddCircleOutline fontSize="small" />
            case "addGlobalEnt":
                return <Add fontSize="small" />
            case "ifElse":
                return <AccountTree fontSize="small" />
            case "offsetInstance":
                return <Category fontSize="small" />
            case "mapInstVar":
                return <Functions fontSize="small" />
            case "debug":
                return <Category fontSize="small" />
            case "setInstVar":
                return <SwapVert fontSize="small" />
            default:
                return <Category fontSize="small" />
        }
    }

    const getBlockColor = (blockType) => {
        // Logic blocks use orange color family
        const logicColors = {
            if: "#FF9800", // Orange - If condition
            ifElse: "#FF9800", // Orange - If-Else condition
            switchCase: "#FF9800", // Orange - Switch logic
            case: "#E65100", // Darker orange - Case in Switch
        }

        // Action/Result blocks use purple color family
        const actionColors = {
            changeInstance: "#9C27B0", // Purple - Change action
            addOverlay: "#9C27B0", // Purple - Add action
            addGlobalEnt: "#9C27B0", // Purple - Add global entity action
            mapInstVar: "#9C27B0", // Purple - Map action
            offsetInstance: "#9C27B0", // Purple - Offset action
            debug: "#9C27B0", // Purple - Debug action
            setInstVar: "#9C27B0", // Purple - Change fixup action
        }

        return (
            logicColors[blockType] ||
            actionColors[blockType] ||
            "#555"
        )
    }

    const renderBlockContent = () => {
        const handleUpdateProperty = (property, value) => {
            onUpdateBlock(block.id, { ...block, [property]: value })
        }

        switch (block.type) {
            case "if":
                return (
                    <>
                        <IfBlock
                            block={block}
                            onUpdateProperty={handleUpdateProperty}
                            availableVariables={availableVariables}
                            formData={formData}
                        />
                        {/* THEN Section */}
                        <Box sx={{ p: 2, pt: 0 }}>
                            <Typography
                                variant="subtitle2"
                                color="text.secondary"
                                gutterBottom
                                sx={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 1,
                                }}>
                                <CheckCircle fontSize="small" />
                                Actions ({block.thenBlocks?.length || 0})
                                <Chip
                                    label="Multiple actions allowed"
                                    size="small"
                                    variant="outlined"
                                    sx={{
                                        ml: 1,
                                        fontSize: "0.7rem",
                                        backgroundColor:
                                            "rgba(210, 176, 25, 0.1)",
                                        borderColor: "#d2b019ff",
                                        color: "#d2b019ff",
                                    }}
                                />
                            </Typography>
                            <DroppableZone
                                id={`${block.id}-then`}
                                isEmpty={
                                    !block.thenBlocks ||
                                    block.thenBlocks.length === 0
                                }
                                label="Drop action blocks here (you can add multiple)">
                                {block.thenBlocks &&
                                    block.thenBlocks.map((childBlock) => (
                                        <SortableBlock
                                            key={childBlock.id}
                                            block={childBlock}
                                            onUpdateBlock={onUpdateBlock}
                                            onDeleteBlock={onDeleteBlock}
                                            onAddChildBlock={onAddChildBlock}
                                            availableInstances={
                                                availableInstances
                                            }
                                            availableVariables={
                                                availableVariables
                                            }
                                            formData={formData}
                                            editingNames={editingNames}
                                            blocks={blocks}
                                            depth={depth + 1}
                                            onDuplicateBlock={onDuplicateBlock}
                                        />
                                    ))}
                            </DroppableZone>
                        </Box>
                    </>
                )

            case "changeInstance":
                return (
                    <ChangeInstanceBlock
                        block={block}
                        onUpdateProperty={handleUpdateProperty}
                        availableInstances={availableInstances}
                        editingNames={editingNames}
                    />
                )

            case "randomSelection":
                return (
                    <Box>
                        <Typography
                            variant="body2"
                            sx={{ mb: 1, color: "#888" }}>
                            Randomly selects one of the following:
                        </Typography>
                        <List dense sx={{ pl: 2 }}>
                            {block.options &&
                                block.options.map((option, index) => (
                                    <ListItem key={index} sx={{ py: 0.5 }}>
                                        <ListItemText
                                            primary={`${index + 1}. ${option}`}
                                            primaryTypographyProps={{
                                                sx: {
                                                    fontSize: "0.85rem",
                                                    fontFamily: "monospace",
                                                },
                                            }}
                                        />
                                    </ListItem>
                                ))}
                        </List>
                    </Box>
                )

            case "addOverlay":
                return (
                    <AddOverlayBlock
                        block={block}
                        onUpdateProperty={handleUpdateProperty}
                        availableInstances={availableInstances}
                        editingNames={editingNames}
                    />
                )

            case "addGlobalEnt":
                return (
                    <AddGlobalInstanceBlock
                        block={block}
                        onUpdateProperty={handleUpdateProperty}
                        availableInstances={availableInstances}
                        editingNames={editingNames}
                    />
                )

            case "offsetInstance":
                return (
                    <OffsetInstanceBlock
                        block={block}
                        onUpdateProperty={handleUpdateProperty}
                    />
                )

            case "debug":
                return (
                    <DebugBlock
                        block={block}
                        onUpdateProperty={handleUpdateProperty}
                        availableVariables={availableVariables}
                    />
                )

            case "setInstVar":
                return (
                    <SetInstVarBlock
                        block={block}
                        onUpdateProperty={handleUpdateProperty}
                    />
                )

            case "case":
                return (
                    <Box sx={{ p: 2 }}>
                        <Box
                            sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 1,
                                mb: 2,
                            }}>
                            <Typography
                                variant="subtitle2"
                                color="text.secondary"
                                gutterBottom>
                                Case: {block.value || "Default"}
                            </Typography>
                        </Box>

                        {/* Case Value - gets the variable type from parent switch */}
                        <Box sx={{ mt: 2 }}>
                            <Grid container spacing={2}>
                                <Grid xs={12}>
                                    {/* Dynamic value field based on parent switch variable type */}
                                    {(() => {
                                        // Find the parent switch block to get the variable type
                                        const parentSwitch = findParentSwitch(
                                            block.id,
                                            blocks,
                                        )
                                        const switchVariable =
                                            parentSwitch?.variable
                                        const fullVariableData =
                                            availableVariables.find(
                                                (v) =>
                                                    v.fixupName ===
                                                    switchVariable,
                                            ) ||
                                            formData.variables?.find(
                                                (v) =>
                                                    v.fixupName ===
                                                    switchVariable,
                                            )

                                        if (!switchVariable) {
                                            return (
                                                <TextField
                                                    fullWidth
                                                    size="small"
                                                    label="Case Value"
                                                    value={block.value || ""}
                                                    onChange={(e) =>
                                                        handleUpdateProperty(
                                                            "value",
                                                            e.target.value,
                                                        )
                                                    }
                                                    placeholder="Select variable in parent switch first"
                                                    sx={{
                                                        "& .MuiOutlinedInput-root":
                                                            {
                                                                minWidth:
                                                                    "200px",
                                                            },
                                                    }}
                                                />
                                            )
                                        }

                                        if (
                                            fullVariableData?.type === "boolean"
                                        ) {
                                            return (
                                                <FormControl
                                                    fullWidth
                                                    size="small">
                                                    <InputLabel>
                                                        Case Value
                                                    </InputLabel>
                                                    <Select
                                                        value={
                                                            block.value || "1"
                                                        }
                                                        onChange={(e) =>
                                                            handleUpdateProperty(
                                                                "value",
                                                                e.target.value,
                                                            )
                                                        }
                                                        label="Case Value"
                                                        sx={{
                                                            "& .MuiOutlinedInput-root":
                                                                {
                                                                    minWidth:
                                                                        "200px",
                                                                },
                                                        }}>
                                                        <MenuItem value="1">
                                                            True
                                                        </MenuItem>
                                                        <MenuItem value="0">
                                                            False
                                                        </MenuItem>
                                                    </Select>
                                                </FormControl>
                                            )
                                        } else if (
                                            fullVariableData?.type === "enum" &&
                                            fullVariableData?.enumValues
                                        ) {
                                            return (
                                                <FormControl
                                                    fullWidth
                                                    size="small">
                                                    <InputLabel>
                                                        Case Value
                                                    </InputLabel>
                                                    <Select
                                                        value={
                                                            block.value ||
                                                            Object.keys(
                                                                fullVariableData.enumValues,
                                                            )[0]
                                                        }
                                                        onChange={(e) =>
                                                            handleUpdateProperty(
                                                                "value",
                                                                e.target.value,
                                                            )
                                                        }
                                                        label="Case Value"
                                                        sx={{
                                                            "& .MuiOutlinedInput-root":
                                                                {
                                                                    minWidth:
                                                                        "200px",
                                                                },
                                                        }}>
                                                        {Object.entries(
                                                            fullVariableData.enumValues,
                                                        ).map(
                                                            ([
                                                                value,
                                                                label,
                                                            ]) => (
                                                                <MenuItem
                                                                    key={value}
                                                                    value={
                                                                        value
                                                                    }>
                                                                    {label}
                                                                </MenuItem>
                                                            ),
                                                        )}
                                                    </Select>
                                                </FormControl>
                                            )
                                        } else {
                                            return (
                                                <TextField
                                                    fullWidth
                                                    size="small"
                                                    label="Case Value"
                                                    type={
                                                        fullVariableData?.type ===
                                                        "number"
                                                            ? "number"
                                                            : "text"
                                                    }
                                                    value={block.value || ""}
                                                    onChange={(e) =>
                                                        handleUpdateProperty(
                                                            "value",
                                                            e.target.value,
                                                        )
                                                    }
                                                    inputProps={{
                                                        min:
                                                            fullVariableData?.type ===
                                                            "number"
                                                                ? 0
                                                                : undefined,
                                                        step:
                                                            fullVariableData?.type ===
                                                            "number"
                                                                ? 1
                                                                : undefined,
                                                    }}
                                                    sx={{
                                                        "& .MuiOutlinedInput-root":
                                                            {
                                                                minWidth:
                                                                    "200px",
                                                            },
                                                    }}
                                                />
                                            )
                                        }
                                    })()}
                                </Grid>
                            </Grid>
                        </Box>

                        <Box sx={{ mt: 2 }}>
                            <DroppableZone
                                id={`${block.id}-then`}
                                isEmpty={
                                    !block.thenBlocks ||
                                    block.thenBlocks.length === 0
                                }
                                label="Drop action blocks here (you can add multiple)">
                                {block.thenBlocks &&
                                    block.thenBlocks.map((childBlock) => (
                                        <SortableBlock
                                            key={childBlock.id}
                                            block={childBlock}
                                            onUpdateBlock={onUpdateBlock}
                                            onDeleteBlock={onDeleteBlock}
                                            onAddChildBlock={onAddChildBlock}
                                            availableInstances={
                                                availableInstances
                                            }
                                            availableVariables={
                                                availableVariables
                                            }
                                            formData={formData}
                                            editingNames={editingNames}
                                            blocks={blocks}
                                            depth={depth + 1}
                                            onDuplicateBlock={onDuplicateBlock}
                                        />
                                    ))}
                            </DroppableZone>
                        </Box>
                    </Box>
                )

            case "switchCase":
                return (
                    <Box sx={{ p: 2 }}>
                        <Box
                            sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 1,
                                mb: 2,
                            }}>
                            <Typography
                                variant="subtitle1"
                                sx={{ fontWeight: 600 }}>
                                SWITCH
                            </Typography>
                            <Chip
                                label={`${block.cases?.length || 0} cases`}
                                size="small"
                                color="primary"
                                sx={{
                                    backgroundColor: "#d2b019ff",
                                    color: "#000",
                                }}
                            />
                        </Box>

                        {/* Switch Method */}
                        <Box sx={{ mb: 2 }}>
                            <Typography
                                variant="subtitle2"
                                color="text.secondary"
                                gutterBottom
                                sx={{ mb: 1.5 }}>
                                Switch Method
                            </Typography>
                            <FormControl fullWidth size="small">
                                <InputLabel>Method</InputLabel>
                                <Select
                                    value={block.method || "first"}
                                    onChange={(e) =>
                                        handleUpdateProperty(
                                            "method",
                                            e.target.value,
                                        )
                                    }
                                    label="Method">
                                    <MenuItem value="first">first</MenuItem>
                                    <MenuItem value="last">last</MenuItem>
                                    <MenuItem value="random">random</MenuItem>
                                    <MenuItem value="all">all</MenuItem>
                                </Select>
                            </FormControl>
                        </Box>

                        {/* Switch Variable Selection */}
                        <Box sx={{ mb: 2 }}>
                            <Typography
                                variant="subtitle2"
                                color="text.secondary"
                                gutterBottom>
                                Switch Variable
                            </Typography>
                            <FormControl fullWidth size="small">
                                <InputLabel>Variable</InputLabel>
                                <Select
                                    value={block.variable || ""}
                                    onChange={(e) =>
                                        handleUpdateProperty(
                                            "variable",
                                            e.target.value,
                                        )
                                    }
                                    label="Variable">
                                    {availableVariables.map(
                                        (variable, index) => (
                                            <MenuItem
                                                key={index}
                                                value={variable.fixupName}>
                                                <Box
                                                    sx={{
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: 1,
                                                        py: 0.5,
                                                    }}>
                                                    {variable.isSystemVariable ? (
                                                        <Hive
                                                            fontSize="small"
                                                            sx={{
                                                                color: "#FFC107",
                                                            }}
                                                        />
                                                    ) : (
                                                        <Functions fontSize="small" />
                                                    )}
                                                    <Typography variant="body2">
                                                        {variable.displayName}
                                                    </Typography>
                                                </Box>
                                            </MenuItem>
                                        ),
                                    )}
                                </Select>
                            </FormControl>
                        </Box>

                        <Box sx={{ mt: 2 }}>
                            <DroppableZone
                                id={`${block.id}-cases`}
                                isEmpty={
                                    !block.cases || block.cases.length === 0
                                }
                                label="Drop case blocks here (you can add multiple)">
                                {block.cases &&
                                    block.cases.map((caseBlock) => (
                                        <SortableBlock
                                            key={caseBlock.id}
                                            block={caseBlock}
                                            onUpdateBlock={onUpdateBlock}
                                            onDeleteBlock={onDeleteBlock}
                                            onAddChildBlock={onAddChildBlock}
                                            availableInstances={
                                                availableInstances
                                            }
                                            availableVariables={
                                                availableVariables
                                            }
                                            formData={formData}
                                            editingNames={editingNames}
                                            blocks={blocks}
                                            depth={depth + 1}
                                            onDuplicateBlock={onDuplicateBlock}
                                        />
                                    ))}
                            </DroppableZone>
                        </Box>
                    </Box>
                )

            case "ifElse":
                return (
                    <Box sx={{ p: 2 }}>
                        <Typography
                            variant="subtitle2"
                            color="text.secondary"
                            gutterBottom>
                            If-Else Condition
                        </Typography>

                        {/* If-Else Condition Configuration - Same as IF Block */}
                        <Box sx={{ mt: 2, mb: 3 }}>
                            <Grid container spacing={2} alignItems="center">
                                <Grid xs={4}>
                                    <FormControl fullWidth size="small">
                                        <InputLabel>Variable</InputLabel>
                                        <Select
                                            value={block.variable || ""}
                                            onChange={(e) =>
                                                handleUpdateProperty(
                                                    "variable",
                                                    e.target.value,
                                                )
                                            }
                                            label="Variable"
                                            sx={{
                                                "& .MuiOutlinedInput-root": {
                                                    height: 40,
                                                    minHeight: 40,
                                                    maxHeight: 40,
                                                },
                                                "& .MuiSelect-select": {
                                                    height: "20px !important",
                                                    lineHeight:
                                                        "20px !important",
                                                    paddingTop:
                                                        "10px !important",
                                                    paddingBottom:
                                                        "10px !important",
                                                    minWidth: "120px",
                                                    display: "flex",
                                                    alignItems: "center",
                                                },
                                            }}>
                                            {availableVariables.map(
                                                (variable) => (
                                                    <MenuItem
                                                        key={variable.fixupName}
                                                        value={
                                                            variable.fixupName
                                                        }>
                                                        <Box
                                                            sx={{
                                                                display: "flex",
                                                                alignItems:
                                                                    "center",
                                                                gap: 1,
                                                                py: 0.5,
                                                            }}>
                                                            {variable.isSystemVariable ? (
                                                                <Hive
                                                                    fontSize="small"
                                                                    sx={{
                                                                        color: "#FFC107",
                                                                    }}
                                                                />
                                                            ) : (
                                                                <Code fontSize="small" />
                                                            )}
                                                            {
                                                                variable.displayName
                                                            }
                                                        </Box>
                                                    </MenuItem>
                                                ),
                                            )}
                                        </Select>
                                    </FormControl>
                                </Grid>
                                <Grid xs={4}>
                                    <FormControl fullWidth size="small">
                                        <InputLabel>Operator</InputLabel>
                                        <Select
                                            value={block.operator || "=="}
                                            onChange={(e) =>
                                                handleUpdateProperty(
                                                    "operator",
                                                    e.target.value,
                                                )
                                            }
                                            label="Operator"
                                            sx={{
                                                "& .MuiOutlinedInput-root": {
                                                    height: 40,
                                                    minHeight: 40,
                                                    maxHeight: 40,
                                                },
                                                "& .MuiSelect-select": {
                                                    height: "20px !important",
                                                    lineHeight:
                                                        "20px !important",
                                                    paddingTop:
                                                        "10px !important",
                                                    paddingBottom:
                                                        "10px !important",
                                                    minWidth: "80px",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                },
                                            }}>
                                            {(() => {
                                                const selectedVariable =
                                                    availableVariables.find(
                                                        (v) =>
                                                            v.fixupName ===
                                                            block.variable,
                                                    )
                                                const fullVariableData =
                                                    availableVariables.find(
                                                        (v) =>
                                                            v.fixupName ===
                                                            block.variable,
                                                    ) ||
                                                    formData.variables?.find(
                                                        (v) =>
                                                            v.fixupName ===
                                                            block.variable,
                                                    )

                                                // For boolean and enum types, only show == and !=
                                                if (
                                                    fullVariableData?.type ===
                                                        "boolean" ||
                                                    fullVariableData?.type ===
                                                        "enum"
                                                ) {
                                                    return [
                                                        <MenuItem
                                                            key="eq"
                                                            value="==">
                                                            =
                                                        </MenuItem>,
                                                        <MenuItem
                                                            key="ne"
                                                            value="!=">
                                                            !=
                                                        </MenuItem>,
                                                    ]
                                                }

                                                // For number types, show all operators
                                                if (
                                                    fullVariableData?.type ===
                                                    "number"
                                                ) {
                                                    return [
                                                        <MenuItem
                                                            key="eq"
                                                            value="==">
                                                            =
                                                        </MenuItem>,
                                                        <MenuItem
                                                            key="ne"
                                                            value="!=">
                                                            !=
                                                        </MenuItem>,
                                                        <MenuItem
                                                            key="gt"
                                                            value=">">
                                                            &gt;
                                                        </MenuItem>,
                                                        <MenuItem
                                                            key="lt"
                                                            value="<">
                                                            &lt;
                                                        </MenuItem>,
                                                        <MenuItem
                                                            key="gte"
                                                            value=">=">
                                                            &gt;=
                                                        </MenuItem>,
                                                        <MenuItem
                                                            key="lte"
                                                            value="<=">
                                                            &lt;=
                                                        </MenuItem>,
                                                    ]
                                                }

                                                // Default fallback - show basic operators when no variable is selected
                                                return [
                                                    <MenuItem
                                                        key="eq"
                                                        value="==">
                                                        =
                                                    </MenuItem>,
                                                    <MenuItem
                                                        key="ne"
                                                        value="!=">
                                                        !=
                                                    </MenuItem>,
                                                ]
                                            })()}
                                        </Select>
                                    </FormControl>
                                </Grid>
                                <Grid xs={4}>
                                    {/* Dynamic value field based on variable type */}
                                    {(() => {
                                        const selectedVariable =
                                            availableVariables.find(
                                                (v) =>
                                                    v.fixupName ===
                                                    block.variable,
                                            )
                                        if (!selectedVariable) {
                                            return (
                                                <TextField
                                                    fullWidth
                                                    size="small"
                                                    label="Value"
                                                    value={block.value || ""}
                                                    onChange={(e) =>
                                                        handleUpdateProperty(
                                                            "value",
                                                            e.target.value,
                                                        )
                                                    }
                                                    sx={{
                                                        "& .MuiOutlinedInput-root":
                                                            {
                                                                height: 40,
                                                                minHeight: 40,
                                                                maxHeight: 40,
                                                            },
                                                        "& .MuiInputBase-input":
                                                            {
                                                                height: "20px !important",
                                                                lineHeight:
                                                                    "20px !important",
                                                                paddingTop:
                                                                    "10px !important",
                                                                paddingBottom:
                                                                    "10px !important",
                                                                minWidth:
                                                                    "100px",
                                                                display: "flex",
                                                                alignItems:
                                                                    "center",
                                                            },
                                                    }}
                                                />
                                            )
                                        }

                                        // Find the full variable data from formData to get type and enum values
                                        const fullVariableData =
                                            availableVariables.find(
                                                (v) =>
                                                    v.fixupName ===
                                                    block.variable,
                                            ) ||
                                            formData.variables?.find(
                                                (v) =>
                                                    v.fixupName ===
                                                    block.variable,
                                            )

                                        if (
                                            fullVariableData?.type === "boolean"
                                        ) {
                                            return (
                                                <FormControl
                                                    fullWidth
                                                    size="small">
                                                    <InputLabel>
                                                        Value
                                                    </InputLabel>
                                                    <Select
                                                        value={
                                                            block.value || "1"
                                                        }
                                                        onChange={(e) =>
                                                            handleUpdateProperty(
                                                                "value",
                                                                e.target.value,
                                                            )
                                                        }
                                                        label="Value"
                                                        sx={{
                                                            "& .MuiOutlinedInput-root":
                                                                {
                                                                    height: 40,
                                                                    minHeight: 40,
                                                                    maxHeight: 40,
                                                                },
                                                            "& .MuiSelect-select":
                                                                {
                                                                    height: "20px !important",
                                                                    lineHeight:
                                                                        "20px !important",
                                                                    paddingTop:
                                                                        "10px !important",
                                                                    paddingBottom:
                                                                        "10px !important",
                                                                    minWidth:
                                                                        "100px",
                                                                    display:
                                                                        "flex",
                                                                    alignItems:
                                                                        "center",
                                                                },
                                                        }}>
                                                        <MenuItem value="1">
                                                            True
                                                        </MenuItem>
                                                        <MenuItem value="0">
                                                            False
                                                        </MenuItem>
                                                    </Select>
                                                </FormControl>
                                            )
                                        } else if (
                                            fullVariableData?.type === "enum" &&
                                            fullVariableData?.enumValues
                                        ) {
                                            return (
                                                <FormControl
                                                    fullWidth
                                                    size="small">
                                                    <InputLabel>
                                                        Value
                                                    </InputLabel>
                                                    <Select
                                                        value={
                                                            block.value ||
                                                            Object.keys(
                                                                fullVariableData.enumValues,
                                                            )[0]
                                                        }
                                                        onChange={(e) =>
                                                            handleUpdateProperty(
                                                                "value",
                                                                e.target.value,
                                                            )
                                                        }
                                                        label="Value"
                                                        sx={{
                                                            "& .MuiOutlinedInput-root":
                                                                {
                                                                    height: 40,
                                                                    minHeight: 40,
                                                                    maxHeight: 40,
                                                                },
                                                            "& .MuiSelect-select":
                                                                {
                                                                    height: "20px !important",
                                                                    lineHeight:
                                                                        "20px !important",
                                                                    paddingTop:
                                                                        "10px !important",
                                                                    paddingBottom:
                                                                        "10px !important",
                                                                    minWidth:
                                                                        "100px",
                                                                    display:
                                                                        "flex",
                                                                    alignItems:
                                                                        "center",
                                                                },
                                                        }}>
                                                        {Object.entries(
                                                            fullVariableData.enumValues,
                                                        ).map(
                                                            ([key, value]) => (
                                                                <MenuItem
                                                                    key={key}
                                                                    value={key}>
                                                                    <Box
                                                                        sx={{
                                                                            display:
                                                                                "flex",
                                                                            alignItems:
                                                                                "center",
                                                                            gap: 1,
                                                                            py: 0.5,
                                                                        }}>
                                                                        <Typography
                                                                            variant="body2"
                                                                            sx={{
                                                                                fontWeight: 500,
                                                                            }}>
                                                                            {
                                                                                key
                                                                            }
                                                                        </Typography>
                                                                        <Typography
                                                                            variant="caption"
                                                                            color="text.secondary">
                                                                            (
                                                                            {
                                                                                value
                                                                            }
                                                                            )
                                                                        </Typography>
                                                                    </Box>
                                                                </MenuItem>
                                                            ),
                                                        )}
                                                    </Select>
                                                </FormControl>
                                            )
                                        } else {
                                            return (
                                                <TextField
                                                    fullWidth
                                                    size="small"
                                                    label="Value"
                                                    type={
                                                        fullVariableData?.type ===
                                                        "number"
                                                            ? "number"
                                                            : "text"
                                                    }
                                                    value={block.value || ""}
                                                    onChange={(e) =>
                                                        handleUpdateProperty(
                                                            "value",
                                                            e.target.value,
                                                        )
                                                    }
                                                    sx={{
                                                        "& .MuiOutlinedInput-root":
                                                            {
                                                                height: 40,
                                                                minHeight: 40,
                                                                maxHeight: 40,
                                                            },
                                                        "& .MuiInputBase-input":
                                                            {
                                                                height: "20px !important",
                                                                lineHeight:
                                                                    "20px !important",
                                                                paddingTop:
                                                                    "10px !important",
                                                                paddingBottom:
                                                                    "10px !important",
                                                                minWidth:
                                                                    "100px",
                                                                display: "flex",
                                                                alignItems:
                                                                    "center",
                                                            },
                                                    }}
                                                />
                                            )
                                        }
                                    })()}
                                </Grid>
                            </Grid>
                        </Box>

                        {/* Then Blocks */}
                        <Box sx={{ mt: 2 }}>
                            <Typography
                                variant="body2"
                                sx={{ fontWeight: 600, mb: 1 }}>
                                Then:
                            </Typography>
                            <DroppableZone
                                id={`${block.id}-then`}
                                isEmpty={
                                    !block.thenBlocks ||
                                    block.thenBlocks.length === 0
                                }
                                label="Drop blocks here for THEN">
                                {block.thenBlocks &&
                                    block.thenBlocks.map((thenBlock) => (
                                        <SortableBlock
                                            key={thenBlock.id}
                                            block={thenBlock}
                                            onUpdateBlock={onUpdateBlock}
                                            onDeleteBlock={onDeleteBlock}
                                            onAddChildBlock={onAddChildBlock}
                                            availableInstances={
                                                availableInstances
                                            }
                                            availableVariables={
                                                availableVariables
                                            }
                                            formData={formData}
                                            editingNames={editingNames}
                                            blocks={blocks}
                                            depth={depth + 1}
                                            onDuplicateBlock={onDuplicateBlock}
                                        />
                                    ))}
                            </DroppableZone>
                        </Box>

                        {/* Else Blocks */}
                        <Box sx={{ mt: 2 }}>
                            <Typography
                                variant="body2"
                                sx={{ fontWeight: 600, mb: 1 }}>
                                Else:
                            </Typography>
                            <DroppableZone
                                id={`${block.id}-else`}
                                isEmpty={
                                    !block.elseBlocks ||
                                    block.elseBlocks.length === 0
                                }
                                label="Drop blocks here for ELSE">
                                {block.elseBlocks &&
                                    block.elseBlocks.map((elseBlock) => (
                                        <SortableBlock
                                            key={elseBlock.id}
                                            block={elseBlock}
                                            onUpdateBlock={onUpdateBlock}
                                            onDeleteBlock={onDeleteBlock}
                                            onAddChildBlock={onAddChildBlock}
                                            availableInstances={
                                                availableInstances
                                            }
                                            availableVariables={
                                                availableVariables
                                            }
                                            formData={formData}
                                            editingNames={editingNames}
                                            blocks={blocks}
                                            depth={depth + 1}
                                            onDuplicateBlock={onDuplicateBlock}
                                        />
                                    ))}
                            </DroppableZone>
                        </Box>
                    </Box>
                )

            default:
                return (
                    <Box sx={{ p: 2 }}>
                        <Typography variant="body2" color="text.secondary">
                            Unknown block type: {block.type}
                        </Typography>
                    </Box>
                )
        }
    }

    // Get background color based on nesting depth and block type
    const getNestedBackgroundColor = () => {
        if (hasErrors) {
            return hasErrorType ? "#2d1b1b" : "#2d2a1b"
        }

        // Different background shades for nesting levels
        const baseColors = {
            0: "#2a2d30", // Top level - darkest
            1: "#2e3136", // First nested - slightly lighter
            2: "#32353a", // Second nested - even lighter
            3: "#36393e", // Third nested - lightest
        }

        return baseColors[Math.min(depth, 3)] || baseColors[3]
    }

    const getHoverBackgroundColor = () => {
        if (hasErrors) {
            return hasErrorType ? "#3d2b2b" : "#3d3a2b"
        }

        const hoverColors = {
            0: "#323639",
            1: "#363a3f",
            2: "#3a3e43",
            3: "#3e4247",
        }

        return hoverColors[Math.min(depth, 3)] || hoverColors[3]
    }

    return (
        <Box
            sx={{
                // Add visual connection lines for nested blocks
                ...(depth > 0 && {
                    position: "relative",
                    "&::before": {
                        content: '""',
                        position: "absolute",
                        left: -4,
                        top: 0,
                        width: 2,
                        height: "100%",
                        backgroundColor: "rgba(255, 255, 255, 0.1)",
                        borderRadius: 1,
                    },
                }),
            }}>
            <Paper
                ref={setNodeRef}
                style={style}
                elevation={isDragging ? 6 : depth === 0 ? 2 : 1}
                sx={{
                    backgroundColor: getNestedBackgroundColor(),
                    borderLeft: hasErrors
                        ? `4px solid ${hasErrorType ? "#f44336" : "#ff9800"}`
                        : `4px solid ${getBlockColor(block.type)}`,
                    borderRadius: 2,
                    cursor: isDragging ? "grabbing" : "auto",
                    mb: depth === 0 ? 3 : 2, // More spacing between blocks
                    ml: depth * 3, // Increased indentation for better visual hierarchy
                    mr: depth > 0 ? 2 : 0, // Add right margin for nested blocks
                    transition: "all 0.2s ease-in-out",
                    "&:hover": {
                        elevation: depth === 0 ? 4 : 2,
                        borderLeftWidth: 6,
                        backgroundColor: getHoverBackgroundColor(),
                        transform: "translateX(2px)", // Subtle shift on hover
                    },
                    position: "relative",
                    overflow: "hidden",
                    // Add subtle inner shadow for depth
                    ...(depth > 0 && {
                        boxShadow: "inset 0 1px 2px rgba(0, 0, 0, 0.2)",
                    }),
                    // Enhanced error styling
                    ...(hasErrors && {
                        boxShadow: `
                         ${depth > 0 ? "inset 0 1px 2px rgba(0, 0, 0, 0.2)," : ""}
                         0 0 0 1px ${hasErrorType ? "rgba(244, 67, 54, 0.4)" : "rgba(255, 152, 0, 0.4)"},
                         0 2px 8px ${hasErrorType ? "rgba(244, 67, 54, 0.2)" : "rgba(255, 152, 0, 0.2)"}
                     `,
                    }),
                }}>
                {/* Depth indicator for nested blocks */}
                {depth > 0 && (
                    <Box
                        sx={{
                            position: "absolute",
                            top: 4,
                            left: 8,
                            display: "flex",
                            alignItems: "center",
                            gap: 0.5,
                            zIndex: 5,
                            opacity: 0.6,
                        }}>
                        {Array.from({ length: depth }, (_, i) => (
                            <Box
                                key={i}
                                sx={{
                                    width: 6,
                                    height: 6,
                                    borderRadius: "50%",
                                    backgroundColor: "rgba(255, 255, 255, 0.3)",
                                }}
                            />
                        ))}
                        <Typography
                            variant="caption"
                            sx={{
                                fontSize: "0.6rem",
                                color: "rgba(255, 255, 255, 0.4)",
                                fontWeight: 500,
                            }}>
                            Level {depth}
                        </Typography>
                    </Box>
                )}

                {/* Block controls */}
                <Box
                    sx={{
                        position: "absolute",
                        top: 8,
                        right: 8,
                        display: "flex",
                        gap: 1,
                        zIndex: 10,
                    }}>
                    {/* Error Badge */}
                    {hasErrors && (
                        <ErrorBadge errors={blockErrors} size="small" />
                    )}

                    <Box
                        {...attributes}
                        {...listeners}
                        sx={{
                            cursor: isDragging ? "grabbing" : "grab",
                            display: "flex",
                            alignItems: "center",
                            color: "#888",
                            backgroundColor: "#3a3a3a",
                            borderRadius: 1,
                            p: 0.5,
                            "&:hover": {
                                backgroundColor: "#555",
                            },
                        }}>
                        <DragIndicator fontSize="small" />
                    </Box>

                    <Tooltip title="Duplicate this block">
                        <IconButton
                            size="small"
                            sx={{
                                backgroundColor: "#3a3a3a",
                                color: "#4CAF50",
                                "&:hover": {
                                    backgroundColor: "#4CAF50",
                                    color: "#fff",
                                },
                            }}
                            onClick={() => onDuplicateBlock(block.id)}>
                            <FileCopy fontSize="small" />
                        </IconButton>
                    </Tooltip>

                    <Tooltip
                        title={
                            BLOCK_DEFINITIONS[block.type]?.description ||
                            "No description available"
                        }>
                        <IconButton
                            size="small"
                            sx={{
                                backgroundColor: "#3a3a3a",
                                color: "#2196F3",
                                "&:hover": {
                                    backgroundColor: "#2196F3",
                                    color: "#fff",
                                },
                            }}>
                            <HelpOutline fontSize="small" />
                        </IconButton>
                    </Tooltip>

                    <Tooltip title="Delete this block">
                        <IconButton
                            size="small"
                            color="error"
                            sx={{
                                backgroundColor: "#3a3a3a",
                                "&:hover": {
                                    backgroundColor: "#d32f2f",
                                    color: "#fff",
                                },
                            }}
                            onClick={() => onDeleteBlock(block.id)}>
                            <Delete fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Box>

                {/* Content */}
                {renderBlockContent()}
            </Paper>
        </Box>
    )
}

// Block definitions for the modular system
const BLOCK_DEFINITIONS = {
    if: {
        displayName: "If Block",
        description:
            "Execute actions when a variable meets a specific condition (e.g., if myVariable == 1, then do something)",
        category: "Logic",
        canContainChildren: true,
        childContainers: ["thenBlocks"],
    },
    ifElse: {
        displayName: "If Else Block",
        description:
            "Execute different actions based on whether a condition is true or false (if-then-else logic)",
        category: "Logic",
        canContainChildren: true,
        childContainers: ["thenBlocks", "elseBlocks"],
    },
    switchCase: {
        displayName: "Switch Case",
        description:
            "Compare a variable against multiple values and execute different actions for each match",
        category: "Logic",
        canContainChildren: true,
        childContainers: ["cases"],
    },
    case: {
        displayName: "Case",
        description:
            "Define a specific value to match in a switch statement and the actions to execute when matched",
        category: "Logic",
        canContainChildren: true,
        childContainers: ["thenBlocks"],
    },
    changeInstance: {
        displayName: "Change Instance",
        description:
            "Replace the current map instance with a different VMF file (e.g., change door.vmf to large_door.vmf)",
        category: "Actions",
        canContainChildren: false,
    },
    addOverlay: {
        displayName: "Add Overlay",
        description:
            "Add an additional instance file on top of the current one (e.g., add another thing ontop of it)",
        category: "Actions",
        canContainChildren: false,
    },
    addGlobalEnt: {
        displayName: "Add Global Instance",
        description:
            "Add a global instance to the map that affects the entire level (e.g., add global lighting or scripts)",
        category: "Actions",
        canContainChildren: false,
    },
    mapInstVar: {
        displayName: "Map Instance Variable",
        description:
            "Transform one variable into another with custom value mappings (e.g., convert number to text)",
        category: "Variables",
        canContainChildren: false,
        childContainers: [],
    },
    offsetInstance: {
        displayName: "Offset Instance",
        description:
            "Move the instance position by X Y Z coordinates (e.g., shift 64 units up: 0 0 64)",
        category: "Actions",
        canContainChildren: false,
        childContainers: [],
    },
    debug: {
        displayName: "Debug Output",
        description:
            "Print debug messages to console with variable values for troubleshooting your conditions",
        category: "Actions",
        canContainChildren: false,
        childContainers: [],
    },
    setInstVar: {
        displayName: "Change Fixup",
        description:
            "Set an instance variable to a new value (e.g., change $start_enabled to 1)",
        category: "Actions",
        canContainChildren: false,
        childContainers: [],
    },
}

function Conditions({
    item,
    formData,
    onUpdateConditions,
    onImportConditions,
    editingNames = {},
}) {
    const [addDialogOpen, setAddDialogOpen] = useState(false)
    const [blocks, setBlocks] = useState([])
    const [selectedCategory, setSelectedCategory] = useState("Logic")
    const [activeId, setActiveId] = useState(null)

    // Prefab state
    const [prefabDialogOpen, setPrefabDialogOpen] = useState(false)
    const [prefabs, setPrefabs] = useState(null)
    const [selectedPrefabCategory, setSelectedPrefabCategory] = useState(0)
    const [loadingPrefabs, setLoadingPrefabs] = useState(false)

    // Generate unique ID for blocks
    const generateUniqueId = () => {
        return Date.now().toString(36) + Math.random().toString(36).substr(2)
    }

    // Load prefabs when dialog opens
    const loadPrefabs = async () => {
        if (prefabs) return // Already loaded
        setLoadingPrefabs(true)
        try {
            const result = await window.package.getVbspPrefabs()
            if (result.success) {
                setPrefabs(result.prefabs)
            } else {
                console.error("Failed to load prefabs:", result.error)
            }
        } catch (error) {
            console.error("Error loading prefabs:", error)
        }
        setLoadingPrefabs(false)
    }

    // Helper function to recursively clone prefab block with new IDs
    const clonePrefabBlock = (block) => {
        const newBlock = {
            ...block,
            id: `${block.type}_${generateUniqueId()}`,
        }

        // Clone cases array for switchCase
        if (block.cases && Array.isArray(block.cases)) {
            newBlock.cases = block.cases.map((caseBlock) =>
                clonePrefabBlock(caseBlock),
            )
        }

        // Clone thenBlocks
        if (block.thenBlocks && Array.isArray(block.thenBlocks)) {
            newBlock.thenBlocks = block.thenBlocks.map((childBlock) =>
                clonePrefabBlock(childBlock),
            )
        }

        // Clone elseBlocks
        if (block.elseBlocks && Array.isArray(block.elseBlocks)) {
            newBlock.elseBlocks = block.elseBlocks.map((childBlock) =>
                clonePrefabBlock(childBlock),
            )
        }

        return newBlock
    }

    // Apply a prefab - add its blocks to the current blocks
    const applyPrefab = (prefab) => {
        if (!prefab.blocks || prefab.blocks.length === 0) return

        // Clone each block with new IDs
        const newBlocks = prefab.blocks.map((block) => clonePrefabBlock(block))

        // Add the new blocks to the existing blocks
        const updatedBlocks = [...blocks, ...newBlocks]
        setBlocks(updatedBlocks)
        onUpdateConditions({ blocks: updatedBlocks })
        setPrefabDialogOpen(false)
    }

    // Deep clone a block with new IDs
    const cloneBlockWithNewIds = (block) => {
        const newBlock = {
            ...block,
            id: generateUniqueId(),
        }

        // Clone child containers
        if (BLOCK_DEFINITIONS[block.type]?.canContainChildren) {
            const childContainers =
                BLOCK_DEFINITIONS[block.type].childContainers || []
            for (const container of childContainers) {
                if (block[container] && Array.isArray(block[container])) {
                    newBlock[container] = block[container].map((childBlock) =>
                        cloneBlockWithNewIds(childBlock),
                    )
                }
            }
        }

        return newBlock
    }

    // Helper function to find a block recursively
    const findBlockRecursive = (blockList, blockId) => {
        for (const block of blockList) {
            if (block.id === blockId) {
                return block
            }

            // Check child containers
            if (BLOCK_DEFINITIONS[block.type]?.canContainChildren) {
                const childContainers =
                    BLOCK_DEFINITIONS[block.type].childContainers || []
                for (const container of childContainers) {
                    if (block[container] && Array.isArray(block[container])) {
                        const found = findBlockRecursive(
                            block[container],
                            blockId,
                        )
                        if (found) return found
                    }
                }
            }
        }
        return null
    }

    // Helper function to delete a block recursively
    const deleteBlockRecursive = (blockList, blockId) => {
        return blockList.filter((block) => {
            if (block.id === blockId) return false

            // Also check child containers
            if (BLOCK_DEFINITIONS[block.type]?.canContainChildren) {
                const childContainers =
                    BLOCK_DEFINITIONS[block.type].childContainers || []
                for (const container of childContainers) {
                    if (block[container]) {
                        block[container] = deleteBlockRecursive(
                            block[container],
                            blockId,
                        )
                    }
                }
            }
            return true
        })
    }

    // Duplicate block
    const handleDuplicateBlock = (blockId) => {
        const blockToDuplicate = findBlockRecursive(blocks, blockId)
        if (!blockToDuplicate) return

        const clonedBlock = cloneBlockWithNewIds(blockToDuplicate)

        // Add the duplicated block right after the original block
        const addDuplicateToSameLevel = (blockList) => {
            const newBlockList = []
            for (let i = 0; i < blockList.length; i++) {
                const block = blockList[i]
                newBlockList.push(block)

                // If this is the block we want to duplicate, add the clone after it
                if (block.id === blockId) {
                    newBlockList.push(clonedBlock)
                } else if (BLOCK_DEFINITIONS[block.type]?.canContainChildren) {
                    // Check child containers recursively
                    const childContainers =
                        BLOCK_DEFINITIONS[block.type].childContainers || []
                    for (const container of childContainers) {
                        if (
                            block[container] &&
                            Array.isArray(block[container])
                        ) {
                            const foundInChildren = findBlockRecursive(
                                block[container],
                                blockId,
                            )
                            if (foundInChildren) {
                                block[container] = addDuplicateToSameLevel(
                                    block[container],
                                )
                            }
                        }
                    }
                }
            }
            return newBlockList
        }

        const updatedBlocks = addDuplicateToSameLevel(blocks)
        setBlocks(updatedBlocks)
        console.log(
            "🔧 Conditions JSON:",
            JSON.stringify(updatedBlocks, null, 2),
        )
        onUpdateConditions(updatedBlocks)
    }

    // Convert blocks to VBSP format
    const convertBlocksToVbsp = (blockList) => {
        const vbspConditions = {
            Conditions: {},
        }

        // Helper function to process child blocks
        const processChildBlocks = (childBlocks, containerName) => {
            if (!childBlocks || childBlocks.length === 0) return []

            return childBlocks.map((childBlock) => {
                const childVbsp = convertBlockToVbsp(childBlock)
                return childVbsp
            })
        }

        // Convert a single block to VBSP format
        const convertBlockToVbsp = (block) => {
            switch (block.type) {
                case "if":
                    return {
                        Switch: {
                            Variable: block.variable || "",
                            Operator: block.operator || "==",
                            Value: block.value || "",
                            Result: processChildBlocks(
                                block.thenBlocks,
                                "thenBlocks",
                            ),
                        },
                    }

                case "ifElse":
                    return {
                        Switch: {
                            Variable: block.variable || "",
                            Operator: block.operator || "==",
                            Value: block.value || "",
                            Result: processChildBlocks(
                                block.thenBlocks,
                                "thenBlocks",
                            ),
                            Else: processChildBlocks(
                                block.elseBlocks,
                                "elseBlocks",
                            ),
                        },
                    }

                case "ifHas":
                    return {
                        IfHas: {
                            Value: block.value || "",
                            Result: processChildBlocks(
                                block.thenBlocks,
                                "thenBlocks",
                            ),
                        },
                    }

                case "ifHasElse":
                    return {
                        IfHas: {
                            Value: block.value || "",
                            Result: processChildBlocks(
                                block.thenBlocks,
                                "thenBlocks",
                            ),
                            Else: processChildBlocks(
                                block.elseBlocks,
                                "elseBlocks",
                            ),
                        },
                    }

                case "switchCase":
                    return {
                        Switch: {
                            Variable: block.variable || "",
                            Cases: processChildBlocks(block.cases, "cases"),
                        },
                    }

                case "switchGlobal":
                    return {
                        SwitchGlobal: {
                            Cases: processChildBlocks(block.cases, "cases"),
                        },
                    }

                case "case":
                    return {
                        Case: {
                            Value:
                                block.value !== undefined &&
                                block.value !== null
                                    ? block.value
                                    : "",
                            Result: processChildBlocks(
                                block.thenBlocks,
                                "thenBlocks",
                            ),
                        },
                    }

                case "changeInstance":
                    return {
                        ChangeInstance: {
                            Instance: block.instance || "",
                            NewInstance: block.newInstance || "",
                        },
                    }

                case "addOverlay":
                    return {
                        AddOverlay: {
                            Instance: block.instance || "",
                        },
                    }

                case "addGlobalEnt":
                    return {
                        AddGlobalEnt: {
                            Instance: block.instance || "",
                        },
                    }

                case "offsetInstance":
                    return {
                        OffsetInstance: {
                            Instance: block.instance || "",
                            Offset: block.offset || "0 0 0",
                        },
                    }

                case "mapInstVar":
                    return {
                        MapInstVar: {
                            SourceVariable: block.sourceVariable || "",
                            TargetVariable: block.targetVariable || "",
                            Mappings: block.mappings || {},
                        },
                    }

                case "debug":
                    return {
                        Debug: {
                            Message: block.message || "",
                        },
                    }

                case "setInstVar":
                    // Format: "setInstVar" "$variable new_value"
                    return {
                        setInstVar: `${block.variable || ""} ${block.newValue || ""}`,
                    }

                default:
                    return {
                        Unknown: {
                            Type: block.type,
                            Data: block,
                        },
                    }
            }
        }

        // Process each top-level block
        blockList.forEach((block, index) => {
            const vbspBlock = convertBlockToVbsp(block)
            const blockKey = `Condition_${index + 1}`
            vbspConditions.Conditions[blockKey] = vbspBlock
        })

        return vbspConditions
    }

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (event) => {
            // Only handle shortcuts when not typing in an input
            if (
                event.target.tagName === "INPUT" ||
                event.target.tagName === "TEXTAREA"
            ) {
                return
            }

            if (event.ctrlKey || event.metaKey) {
                switch (event.key) {
                    case "d":
                        // Duplicate - for now, duplicate the first block as an example
                        // In a real implementation, you'd track which block is selected
                        if (blocks.length > 0) {
                            event.preventDefault()
                            handleDuplicateBlock(blocks[0].id)
                        }
                        break
                }
            }
        }

        document.addEventListener("keydown", handleKeyDown)
        return () => document.removeEventListener("keydown", handleKeyDown)
    }, [blocks, handleDuplicateBlock])

    const sensors = useSensors(
        useSensor(PointerSensor, {
            // Reduce activation delay for more responsive dragging
            activationConstraint: {
                distance: 8, // Only start dragging after moving 8px
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        }),
    )

    // Get available instances from formData
    const availableInstances = formData?.instances
        ? Object.entries(formData.instances)
              .filter(([index, instance]) => !instance._toRemove)
              .map(([index, instance]) => ({
                  ...instance,
                  index,
              }))
        : []

    // BEE2 system variables - these are built-in and always available
    const bee2SystemVariables = [
        {
            displayName: "Connection Count",
            fixupName: "$connectioncount",
            type: "number",
            description: "Number of items connected to this item's input. Use to detect if item has connections (0 = no connections).",
            isSystemVariable: true,
        },
        {
            displayName: "Rotation",
            fixupName: "$rotation",
            type: "number",
            description: "Rotation of the item in degrees",
            isSystemVariable: true,
        },
        {
            displayName: "Angle",
            fixupName: "$angle",
            type: "number",
            description: "Simplified rotation angle",
            isSystemVariable: true,
        },
        {
            displayName: "Is Coop",
            fixupName: "$is_coop",
            type: "boolean",
            description: "True in cooperative maps",
            isSystemVariable: true,
        },
        {
            displayName: "Is Preview",
            fixupName: "$is_preview",
            type: "boolean",
            description: "True if preview mode is active (only when testing)",
            isSystemVariable: true,
        },
        {
            displayName: "Portal Gun On/Off",
            fixupName: "$portalgun_onoff",
            type: "boolean",
            description: "Tells compiler to add portalgun manager script",
            isSystemVariable: true,
        },
        {
            displayName: "Needs Portal Manager",
            fixupName: "$needs_portalman",
            type: "boolean",
            description: "Forces portal manager logic (even in coop)",
            isSystemVariable: true,
        },
        {
            displayName: "Dual Portal",
            fixupName: "$dual_portal",
            type: "boolean",
            description: "True if the player gets both portals",
            isSystemVariable: true,
        },
        {
            displayName: "Color",
            fixupName: "$color",
            type: "enum",
            enumValues: {
                white: "White",
                black: "Black",
            },
            description: "Current color theme (white or black)",
            isSystemVariable: true,
        },
    ]

    // Get available variables from formData (user-added variables only)
    const userVariables = formData.variables
        ? Array.isArray(formData.variables)
            ? formData.variables.map((variable) => ({
                  displayName: variable.displayName || variable.fixupName,
                  fixupName: variable.fixupName,
                  type: variable.type,
                  enumValues: variable.enumValues,
                  description: variable.description,
                  isSystemVariable: false,
              }))
            : // If it's an object, convert to array
              Object.values(formData.variables).map((variable) => ({
                  displayName: variable.displayName || variable.fixupName,
                  fixupName: variable.fixupName,
                  type: variable.type,
                  enumValues: variable.enumValues,
                  description: variable.description,
                  isSystemVariable: false,
              }))
        : []

    // Combine user variables with BEE2 system variables (BEE2 variables come last)
    const availableVariables = [...userVariables, ...bee2SystemVariables]

    useEffect(() => {
        console.log("Conditions useEffect triggered:", {
            hasBlocks: !!(formData.blocks && Array.isArray(formData.blocks)),
            blocksLength: formData.blocks?.length || 0,
            hasConditions: !!(
                formData.conditions &&
                Object.keys(formData.conditions).length > 0
            ),
            conditionsKeys: Object.keys(formData.conditions || {}),
            vbspConditionsImported:
                formData.conditions?._vbsp_conditions_imported,
        })

        // Initialize blocks from formData if available
        if (formData.blocks && Array.isArray(formData.blocks)) {
            console.log("Setting blocks from formData.blocks:", formData.blocks)
            setBlocks(formData.blocks)
        } else if (
            formData.conditions &&
            Object.keys(formData.conditions).length > 0
        ) {
            // Check for _vbsp_conditions_imported flag to prevent re-importing on every load
            const vbspAlreadyImported =
                formData.conditions._vbsp_conditions_imported === true

            if (vbspAlreadyImported) {
                console.log(
                    "VBSP conditions already imported previously - skipping conversion to prevent unsaved changes",
                )
                // Do NOT convert or set blocks - they should already be in formData.blocks
                // If we reach here, it means blocks were imported but not saved to meta.json properly
                return
            }

            console.log(
                "Converting VBSP conditions to blocks (first time):",
                formData.conditions,
            )

            const result = convertVbspToBlocks(formData.conditions)
            if (result.success) {
                console.log(
                    "Conversion successful, setting blocks:",
                    result.blocks,
                )
                setBlocks(result.blocks)
                // Auto-import and save to meta.json on first conversion
                onImportConditions(result.blocks)
            } else {
                console.error("Conversion failed:", result.error)
            }
        } else {
            console.log("No blocks or conditions to load")
        }
    }, [formData.blocks, formData.conditions])

    const handleAddBlock = (blockType) => {
        const blockDef = BLOCK_DEFINITIONS[blockType]
        const newBlock = {
            id: `block_${Date.now()}`,
            type: blockType,
            displayName: blockDef.displayName,
            // Initialize child containers if the block can contain children
            ...(blockDef.canContainChildren && blockDef.childContainers
                ? blockDef.childContainers.reduce((acc, container) => {
                      acc[container] = []
                      return acc
                  }, {})
                : {}),
        }

        const updatedBlocks = [...blocks, newBlock]
        setBlocks(updatedBlocks)
        console.log(
            "🔧 Conditions JSON:",
            JSON.stringify(updatedBlocks, null, 2),
        )
        onUpdateConditions(updatedBlocks)
        setAddDialogOpen(false)
    }

    const handleDeleteBlock = (blockId) => {
        const deleteBlockRecursive = (blockList) => {
            return blockList.filter((block) => {
                if (block.id === blockId) return false

                // Also check child containers
                if (BLOCK_DEFINITIONS[block.type]?.canContainChildren) {
                    const childContainers =
                        BLOCK_DEFINITIONS[block.type].childContainers || []
                    for (const container of childContainers) {
                        if (block[container]) {
                            block[container] = deleteBlockRecursive(
                                block[container],
                            )
                        }
                    }
                }
                return true
            })
        }

        const updatedBlocks = deleteBlockRecursive(blocks)
        setBlocks(updatedBlocks)
        console.log(
            "🔧 Conditions JSON:",
            JSON.stringify(updatedBlocks, null, 2),
        )
        onUpdateConditions(updatedBlocks)
    }

    const handleUpdateBlock = (blockId, updatedBlock) => {
        const updateBlockRecursive = (blockList) => {
            return blockList.map((block) => {
                if (block.id === blockId) {
                    return updatedBlock
                }

                // Also check child containers
                if (BLOCK_DEFINITIONS[block.type]?.canContainChildren) {
                    const childContainers =
                        BLOCK_DEFINITIONS[block.type].childContainers || []
                    childContainers.forEach((container) => {
                        if (block[container]) {
                            block[container] = updateBlockRecursive(
                                block[container],
                            )
                        }
                    })
                }
                return block
            })
        }

        const updatedBlocks = updateBlockRecursive(blocks)
        setBlocks(updatedBlocks)
        console.log(
            "🔧 Conditions JSON:",
            JSON.stringify(updatedBlocks, null, 2),
        )
        onUpdateConditions(updatedBlocks)
    }

    const handleAddChildBlock = (parentBlockId, containerKey) => {
        // This function is kept for compatibility but won't be used
        // since we're using drag-and-drop instead of "Add Action" buttons
        console.log("Child block addition via drag-and-drop only")
    }

    const handleDragStart = (event) => {
        setActiveId(event.active.id)
    }

    const handleDragEnd = (event) => {
        const { active, over } = event
        setActiveId(null)

        if (!over) return

        console.log("Drag end:", { active: active?.id, over: over?.id })

        // Check if we're dropping into a droppable zone (IF block, If-Else block, or Switch case container)
        if (
            over.id &&
            (over.id.includes("-then") ||
                over.id.includes("-else") ||
                over.id.includes("-cases"))
        ) {
            const parentBlockId = over.id
                .replace("-then", "")
                .replace("-else", "")
                .replace("-cases", "")
            const draggedBlockId = active.id
            let containerType = "then"
            if (over.id.includes("-else")) {
                containerType = "else"
            } else if (over.id.includes("-cases")) {
                containerType = "cases"
            }

            console.log("Dropping into block:", {
                parentBlockId,
                draggedBlockId,
                containerType,
            })

            // Find and remove the dragged block from wherever it currently is
            const findAndRemoveBlock = (blockList) => {
                for (let i = 0; i < blockList.length; i++) {
                    const block = blockList[i]

                    // Check if this is the block we're looking for
                    if (block.id === draggedBlockId) {
                        const removedBlock = blockList.splice(i, 1)[0]
                        return removedBlock
                    }

                    // Check child containers
                    if (BLOCK_DEFINITIONS[block.type]?.canContainChildren) {
                        const childContainers =
                            BLOCK_DEFINITIONS[block.type].childContainers || []
                        for (const container of childContainers) {
                            if (
                                block[container] &&
                                Array.isArray(block[container])
                            ) {
                                const found = findAndRemoveBlock(
                                    block[container],
                                )
                                if (found) return found
                            }
                        }
                    }
                }
                return null
            }

            // Add block to the target block
            const addBlockToContainer = (blockList, blockToAdd) => {
                return blockList.map((block) => {
                    if (block.id === parentBlockId) {
                        if (containerType === "then") {
                            return {
                                ...block,
                                thenBlocks: [
                                    ...(block.thenBlocks || []),
                                    blockToAdd,
                                ],
                            }
                        } else if (containerType === "else") {
                            return {
                                ...block,
                                elseBlocks: [
                                    ...(block.elseBlocks || []),
                                    blockToAdd,
                                ],
                            }
                        } else if (containerType === "cases") {
                            return {
                                ...block,
                                cases: [...(block.cases || []), blockToAdd],
                            }
                        }
                    }

                    // Check child containers
                    if (BLOCK_DEFINITIONS[block.type]?.canContainChildren) {
                        const childContainers =
                            BLOCK_DEFINITIONS[block.type].childContainers || []
                        for (const container of childContainers) {
                            if (block[container]) {
                                block[container] = addBlockToContainer(
                                    block[container],
                                    blockToAdd,
                                )
                            }
                        }
                    }
                    return block
                })
            }

            // First, find and remove the block from a copy
            const blocksCopy = JSON.parse(JSON.stringify(blocks)) // Deep copy
            const draggedBlock = findAndRemoveBlock(blocksCopy)

            if (draggedBlock) {
                console.log("Found dragged block:", draggedBlock)

                // Then add it to the target block
                const updatedBlocks = addBlockToContainer(
                    blocksCopy,
                    draggedBlock,
                )
                setBlocks(updatedBlocks)
                console.log(
                    "🔧 Conditions JSON:",
                    JSON.stringify(updatedBlocks, null, 2),
                )
                onUpdateConditions(updatedBlocks)
            }
        }
        // Regular reordering within the same level
        else if (active.id !== over.id) {
            const oldIndex = blocks.findIndex((b) => b.id === active.id)
            const newIndex = blocks.findIndex((b) => b.id === over.id)

            if (oldIndex !== -1 && newIndex !== -1) {
                const updatedBlocks = arrayMove(blocks, oldIndex, newIndex)
                setBlocks(updatedBlocks)
                console.log(
                    "🔧 Conditions JSON:",
                    JSON.stringify(updatedBlocks, null, 2),
                )
                onUpdateConditions(updatedBlocks)
            }
        }
    }

    // Helper function to get all block IDs (including nested ones)
    const getAllBlockIds = (blockList) => {
        const ids = []
        blockList.forEach((block) => {
            ids.push(block.id)
            // Also include child blocks
            if (BLOCK_DEFINITIONS[block.type]?.canContainChildren) {
                const childContainers =
                    BLOCK_DEFINITIONS[block.type].childContainers || []
                childContainers.forEach((container) => {
                    if (block[container]) {
                        ids.push(...getAllBlockIds(block[container]))
                    }
                })
            }
        })
        return ids
    }

    const categories = ["Logic", "Actions"]

    const getCategoryIcon = (category) => {
        switch (category) {
            case "Logic":
                return <AccountTree />
            case "Actions":
                return <PlayArrow />
            default:
                return <Info />
        }
    }

    // Convert VBSP conditions to new block format
    const convertVbspToBlocks = (vbspConditions) => {
        const convertedBlocks = []

        // Generate UUID for this conversion to prevent duplicate keys
        const generateUniqueId = () =>
            `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

        // Helper function to find instance by path
        const findInstanceByPath = (instancePath) => {
            if (!formData.instances || typeof formData.instances !== "object") {
                return null
            }

            // Normalize the path for comparison
            const normalizedPath = instancePath
                .replace(/\\/g, "/")
                .toLowerCase()

            // Convert instances object to array format for searching
            const instancesArray = Object.entries(formData.instances)
                .filter(([index, instance]) => !instance._toRemove)
                .map(([index, instance]) => ({
                    ...instance,
                    index,
                }))

            // First try exact match
            let foundInstance = instancesArray.find((instance) => {
                const instancePath = instance.Name.replace(
                    /\\/g,
                    "/",
                ).toLowerCase()
                return instancePath === normalizedPath
            })

            if (foundInstance) {
                return foundInstance
            }

            // If no exact match, try partial match (in case of path differences)
            foundInstance = instancesArray.find((instance) => {
                const instancePath = instance.Name.replace(
                    /\\/g,
                    "/",
                ).toLowerCase()
                return (
                    instancePath.includes(normalizedPath) ||
                    normalizedPath.includes(instancePath)
                )
            })

            return foundInstance
        }

        // Helper function to find variable by name
        const findVariableByName = (varName) => {
            // First check BEE2 system variables
            const bee2SystemVariables = [
                {
                    displayName: "Connection Count",
                    fixupName: "$connectioncount",
                    type: "number",
                },
                {
                    displayName: "Rotation",
                    fixupName: "$rotation",
                    type: "number",
                },
                { displayName: "Angle", fixupName: "$angle", type: "number" },
                {
                    displayName: "Is Coop",
                    fixupName: "$is_coop",
                    type: "boolean",
                },
                {
                    displayName: "Is Preview",
                    fixupName: "$is_preview",
                    type: "boolean",
                },
                {
                    displayName: "Portal Gun On/Off",
                    fixupName: "$portalgun_onoff",
                    type: "boolean",
                },
                {
                    displayName: "Needs Portal Manager",
                    fixupName: "$needs_portalman",
                    type: "boolean",
                },
                {
                    displayName: "Dual Portal",
                    fixupName: "$dual_portal",
                    type: "boolean",
                },
            ]

            // Try to find in BEE2 system variables first
            const withDollar = `$${varName}`
            let foundVariable = bee2SystemVariables.find(
                (variable) => variable.fixupName === withDollar,
            )

            if (!foundVariable) {
                foundVariable = bee2SystemVariables.find(
                    (variable) => variable.fixupName === varName,
                )
            }

            // If not found in system variables, check user variables
            if (
                !foundVariable &&
                formData.variables &&
                Array.isArray(formData.variables)
            ) {
                foundVariable = formData.variables.find(
                    (variable) => variable.fixupName === withDollar,
                )

                if (!foundVariable) {
                    foundVariable = formData.variables.find(
                        (variable) => variable.fixupName === varName,
                    )
                }
            }

            return foundVariable
        }

        try {
            // Check if we have the expected VBSP structure
            console.log("Full VBSP conditions structure:", vbspConditions)

            if (!vbspConditions.Conditions) {
                throw new Error("Invalid VBSP structure: Missing Conditions")
            }

            console.log("vbspConditions.Conditions:", vbspConditions.Conditions)
            console.log(
                "Available keys in Conditions:",
                Object.keys(vbspConditions.Conditions),
            )

            // Handle different VBSP structure patterns
            let conditions = []

            if (vbspConditions.Conditions.Condition) {
                // Standard structure with Condition key
                conditions = Array.isArray(vbspConditions.Conditions.Condition)
                    ? vbspConditions.Conditions.Condition
                    : [vbspConditions.Conditions.Condition]
            } else {
                // Check for UUID-prefixed Condition keys or other condition patterns
                const allKeys = Object.keys(vbspConditions.Conditions)
                console.log("Checking for condition patterns in keys:", allKeys)

                // Look for UUID-prefixed Condition keys (like Condition_uuid)
                const conditionKeys = allKeys.filter(
                    (key) =>
                        key === "Condition" || key.startsWith("Condition_"),
                )

                if (conditionKeys.length > 0) {
                    console.log("Found condition keys:", conditionKeys)
                    conditions = conditionKeys.map(
                        (key) => vbspConditions.Conditions[key],
                    )
                } else {
                    // Look for any keys that contain condition-like structures
                    const structureKeys = allKeys.filter((key) => {
                        const obj = vbspConditions.Conditions[key]
                        return (
                            obj &&
                            typeof obj === "object" &&
                            (obj.Switch ||
                                obj.MapInstVar ||
                                obj.Result ||
                                key.startsWith("Switch_") ||
                                key.startsWith("MapInstVar_"))
                        )
                    })

                    if (structureKeys.length > 0) {
                        console.log("Found structure keys:", structureKeys)
                        conditions = structureKeys.map(
                            (key) => vbspConditions.Conditions[key],
                        )
                    } else {
                        // Treat the entire Conditions object as a single condition
                        console.log(
                            "Using entire Conditions object as single condition",
                        )
                        conditions = [vbspConditions.Conditions]
                    }
                }
            }

            console.log("Parsed conditions array:", conditions)

            if (conditions.length === 0) {
                console.warn("No conditions found to process!")
                return { success: true, blocks: [] }
            }

            // Process each top-level condition
            conditions.forEach((condition, index) => {
                console.log(`Processing condition ${index}:`, condition)
                if (condition) {
                    const processedBlocks = processCondition(condition)
                    console.log(
                        `Condition ${index} produced ${processedBlocks.length} blocks:`,
                        processedBlocks,
                    )
                    convertedBlocks.push(...processedBlocks)
                } else {
                    console.warn(
                        `Condition ${index} is null or undefined, skipping`,
                    )
                }
            })

            // Recursive function to process any condition structure
            function processCondition(condition) {
                const blocks = []

                // Check if condition is valid
                if (!condition || typeof condition !== "object") {
                    console.warn(
                        "processCondition called with invalid condition:",
                        condition,
                    )
                    return blocks
                }

                // Process MapInstVar blocks
                const mapInstVarKeys = Object.keys(condition).filter(
                    (key) =>
                        key === "MapInstVar" || key.startsWith("MapInstVar_"),
                )
                mapInstVarKeys.forEach((key) => {
                    if (condition[key]) {
                        const mapInstVarBlocks = createMapInstVarBlock(
                            condition[key],
                        )
                        blocks.push(...mapInstVarBlocks)
                    }
                })

                // Process Switch blocks
                const switchKeys = Object.keys(condition).filter(
                    (key) => key === "Switch" || key.startsWith("Switch_"),
                )
                switchKeys.forEach((key) => {
                    if (condition[key]) {
                        const switchBlock = createSwitchBlock(condition[key])
                        if (switchBlock) {
                            blocks.push(switchBlock)
                        }
                    }
                })

                // Process nested Condition blocks (for If-Else logic)
                const conditionKeys = Object.keys(condition).filter(
                    (key) =>
                        key === "Condition" || key.startsWith("Condition_"),
                )
                conditionKeys.forEach((key) => {
                    const nestedCondition = condition[key]

                    if (
                        !nestedCondition ||
                        typeof nestedCondition !== "object"
                    ) {
                        console.warn(
                            "Invalid nested condition:",
                            nestedCondition,
                        )
                        return
                    }

                    // Check if this is an If-Else structure
                    if (
                        nestedCondition.InstVar &&
                        (nestedCondition.Result || nestedCondition.Else)
                    ) {
                        const ifElseBlock = createIfElseBlock(nestedCondition)
                        blocks.push(ifElseBlock)
                    } else {
                        // Regular nested condition
                        const nestedBlocks = processCondition(nestedCondition)
                        blocks.push(...nestedBlocks)
                    }
                })

                // Process Result blocks
                if (condition.Result && typeof condition.Result === "object") {
                    const resultBlocks = processCondition(condition.Result)
                    blocks.push(...resultBlocks)
                }

                // Process "random" blocks - randomly selects one option
                if (condition.random && Array.isArray(condition.random)) {
                    console.log("Found random array:", condition.random)
                    // Create a random selection group block
                    const randomBlock = {
                        id: `random_${generateUniqueId()}`,
                        type: "randomSelection",
                        displayName: "Random Selection",
                        options: condition.random.map((item, index) => {
                            // Each item in the random array might have a ChangeInstance
                            if (typeof item === "string") {
                                return item
                            } else if (
                                typeof item === "object" &&
                                item.Changeinstance
                            ) {
                                return (
                                    item.Changeinstance || item.changeInstance
                                )
                            }
                            return `Option ${index + 1}`
                        }),
                        thenBlocks: [], // For nested actions if any
                    }
                    blocks.push(randomBlock)
                }

                // Process setInstVar (Change Fixup) blocks
                if (condition.setInstVar) {
                    // Format: "$variable value" or just "$variable"
                    const parts = condition.setInstVar.trim().split(/\s+/)
                    const variable = parts[0] || ""
                    const newValue = parts.slice(1).join(" ") || ""
                    const setInstVarBlock = {
                        id: `setInstVar_${generateUniqueId()}`,
                        type: "setInstVar",
                        displayName: "Change Fixup",
                        variable: variable,
                        newValue: newValue,
                    }
                    blocks.push(setInstVarBlock)
                }

                return blocks
            }

            // Helper function to create MapInstVar blocks
            function createMapInstVarBlock(mapInstVarData) {
                // Check if this is a timer structure
                const keys = Object.keys(mapInstVarData)
                const timerBlocks = []

                keys.forEach((key) => {
                    const value = mapInstVarData[key]
                    if (typeof value === "object" && value !== null) {
                        // Check for timer-related variables
                        const valueKeys = Object.keys(value)
                        const timerVar = valueKeys.find(
                            (k) => k.startsWith("$") && k.includes("timer"),
                        )
                        const delayVar = valueKeys.find(
                            (k) => k.startsWith("$") && k.includes("delay"),
                        )

                        if (timerVar || delayVar) {
                            // This is a timer structure
                            const timerBlock = {
                                id: `timer_${generateUniqueId()}`,
                                type: "timer",
                                displayName: "Timer",
                                variable: timerVar || delayVar || "Unknown",
                                delay: "0",
                                mappings: value,
                            }
                            timerBlocks.push(timerBlock)
                        } else {
                            // Check for other variable mappings
                            const varKeys = valueKeys.filter((k) =>
                                k.startsWith("$"),
                            )
                            if (varKeys.length > 0) {
                                const mapInstVarBlock = {
                                    id: `mapInstVar_${generateUniqueId()}`,
                                    type: "mapInstVar",
                                    displayName: "Map Instance Variable",
                                    sourceVariable: varKeys[0] || "Unknown",
                                    targetVariable: "Unknown",
                                    mappings: value,
                                }
                                timerBlocks.push(mapInstVarBlock)
                            }
                        }
                    }
                })

                // If we found timer blocks, return them
                if (timerBlocks.length > 0) {
                    return timerBlocks
                }

                // Fallback to original logic for non-timer structures
                let sourceVariable = "Unknown"
                let targetVariable = "Unknown"

                if (keys.length > 0) {
                    const varKeys = keys.filter((key) => key.startsWith("$"))
                    if (varKeys.length > 0) {
                        sourceVariable = varKeys[0]
                        const firstValue = mapInstVarData[varKeys[0]]
                        if (
                            typeof firstValue === "object" &&
                            firstValue !== null
                        ) {
                            const valueKeys = Object.keys(firstValue)
                            const targetVarKeys = valueKeys.filter((key) =>
                                key.startsWith("$"),
                            )
                            if (targetVarKeys.length > 0) {
                                targetVariable = targetVarKeys[0]
                            }
                        }
                    } else {
                        sourceVariable = keys[0]
                    }
                }

                return [
                    {
                        id: `mapInstVar_${generateUniqueId()}`,
                        type: "mapInstVar",
                        displayName: "Map Instance Variable",
                        sourceVariable: sourceVariable,
                        targetVariable: targetVariable,
                        mappings: mapInstVarData,
                    },
                ]
            }

            // Helper function to create If-Else blocks
            function createIfElseBlock(conditionData) {
                const ifElseBlock = {
                    id: `ifElse_${generateUniqueId()}`,
                    type: "ifElse",
                    displayName: "If-Else",
                    condition: conditionData.InstVar || "",
                    thenBlocks: [],
                    elseBlocks: [],
                }

                // Process Result (Then) blocks
                if (conditionData.Result) {
                    const thenBlocks = processCondition(conditionData.Result)
                    ifElseBlock.thenBlocks = thenBlocks
                }

                // Process Else blocks
                if (conditionData.Else) {
                    const elseBlocks = processCondition(conditionData.Else)
                    ifElseBlock.elseBlocks = elseBlocks
                }

                return ifElseBlock
            }

            // Helper function to create Switch blocks
            function createSwitchBlock(switchData) {
                if (!switchData || typeof switchData !== "object") {
                    console.warn(
                        "createSwitchBlock called with invalid data:",
                        switchData,
                    )
                    return null
                }

                const switchBlock = {
                    id: `switch_${generateUniqueId()}`,
                    type: "switchCase",
                    displayName: "Switch Case",
                    variable: "",
                    cases: [],
                }

                const flag = switchData.Flag || "instvar"
                const conditions = Object.keys(switchData).filter(
                    (key) => key !== "Flag",
                )

                // Extract variable from conditions
                if (conditions.length > 0) {
                    const variableCounts = {}
                    conditions.forEach((conditionKey) => {
                        const match = conditionKey.match(/^\$([^\s]+)/)
                        if (match) {
                            const varName = match[1]
                            variableCounts[varName] =
                                (variableCounts[varName] || 0) + 1
                        }
                    })

                    // Find the most common variable
                    let maxCount = 0
                    let mostCommonVariable = ""
                    for (const [varName, count] of Object.entries(
                        variableCounts,
                    )) {
                        if (count > maxCount) {
                            maxCount = count
                            mostCommonVariable = varName
                        }
                    }

                    if (mostCommonVariable) {
                        const foundVariable =
                            findVariableByName(mostCommonVariable)
                        switchBlock.variable = foundVariable
                            ? foundVariable.fixupName
                            : `$${mostCommonVariable}`
                    }
                }

                // Convert each condition to a case block
                conditions.forEach((conditionKey) => {
                    const caseBlock = {
                        id: `case_${generateUniqueId()}`,
                        type: "case",
                        displayName: "Case",
                        value: "",
                        thenBlocks: [],
                    }

                    // Extract value from condition
                    const valueMatch = conditionKey.match(/[=\s]+(.+)$/)
                    if (valueMatch) {
                        caseBlock.value = valueMatch[1].trim()
                    }

                    // Process the condition data for actions
                    const conditionData = switchData[conditionKey]
                    if (conditionData && typeof conditionData === "object") {
                        // Handle ChangeInstance
                        if (conditionData.Changeinstance) {
                            const foundInstance = findInstanceByPath(
                                conditionData.Changeinstance,
                            )
                            const changeInstanceBlock = {
                                id: `changeInstance_${generateUniqueId()}`,
                                type: "changeInstance",
                                displayName: "Change Instance",
                                instanceName: foundInstance
                                    ? foundInstance.Name
                                    : conditionData.Changeinstance,
                            }
                            caseBlock.thenBlocks.push(changeInstanceBlock)
                        }

                        // Handle OffsetInst
                        if (conditionData.OffsetInst) {
                            const offsetBlock = {
                                id: `offsetInst_${generateUniqueId()}`,
                                type: "offsetInstance",
                                displayName: "Offset Instance",
                                offset: conditionData.OffsetInst,
                            }
                            caseBlock.thenBlocks.push(offsetBlock)
                        }

                        // Handle setInstVar (Change Fixup)
                        if (conditionData.setInstVar) {
                            // Format: "$variable value" or "$variable"
                            const parts = conditionData.setInstVar.trim().split(/\s+/)
                            const variable = parts[0] || ""
                            const newValue = parts.slice(1).join(" ") || ""
                            const setInstVarBlock = {
                                id: `setInstVar_${generateUniqueId()}`,
                                type: "setInstVar",
                                displayName: "Change Fixup",
                                variable: variable,
                                newValue: newValue,
                            }
                            caseBlock.thenBlocks.push(setInstVarBlock)
                        }
                    }

                    switchBlock.cases.push(caseBlock)
                })

                return switchBlock
            }

            console.log("VBSP conversion successful:", {
                totalBlocks: convertedBlocks.length,
                blocks: convertedBlocks,
            })

            return { success: true, blocks: convertedBlocks }
        } catch (error) {
            console.error("VBSP conversion failed:", error)
            return { success: false, error: error.message }
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
                <Typography variant="h6">Conditions</Typography>
                <Box sx={{ display: "flex", gap: 1 }}>
                    <Button
                        variant="contained"
                        startIcon={<Add />}
                        onClick={() => setAddDialogOpen(true)}>
                        Add Block
                    </Button>
                    <Button
                        variant="outlined"
                        startIcon={<FileCopy />}
                        onClick={() => {
                            loadPrefabs()
                            setPrefabDialogOpen(true)
                        }}>
                        Add Prefab
                    </Button>
                </Box>
            </Box>

            {/* Error Summary */}
            {(() => {
                const allErrors = getAllBlockErrors(
                    blocks,
                    blocks,
                    availableVariables,
                    formData,
                )
                if (allErrors.length === 0) return null

                const totalErrors = allErrors.reduce(
                    (sum, block) =>
                        sum +
                        block.errors.filter((e) => e.type === "error").length,
                    0,
                )
                const totalWarnings = allErrors.reduce(
                    (sum, block) =>
                        sum +
                        block.errors.filter((e) => e.type === "warning").length,
                    0,
                )

                return (
                    <Alert
                        severity={totalErrors > 0 ? "error" : "warning"}
                        sx={{
                            mb: 3,
                            borderRadius: 2,
                            "& .MuiAlert-message": {
                                width: "100%",
                            },
                        }}>
                        <Box
                            sx={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                width: "100%",
                            }}>
                            <Box>
                                <Typography
                                    variant="subtitle2"
                                    sx={{ fontWeight: 600, mb: 0.5 }}>
                                    Configuration Issues Found
                                </Typography>
                                <Typography variant="body2">
                                    {totalErrors > 0 &&
                                        `${totalErrors} error${totalErrors !== 1 ? "s" : ""}`}
                                    {totalErrors > 0 &&
                                        totalWarnings > 0 &&
                                        ", "}
                                    {totalWarnings > 0 &&
                                        `${totalWarnings} warning${totalWarnings !== 1 ? "s" : ""}`}{" "}
                                    detected. Click on the error badges to see
                                    details.
                                </Typography>
                            </Box>
                            <Box
                                sx={{
                                    display: "flex",
                                    gap: 1,
                                    alignItems: "center",
                                    flexWrap: "wrap",
                                }}>
                                {totalErrors > 0 && (
                                    <Chip
                                        icon={<Error fontSize="small" />}
                                        label={`${totalErrors} Error${totalErrors !== 1 ? "s" : ""}`}
                                        size="small"
                                        color="error"
                                        variant="filled"
                                    />
                                )}
                                {totalWarnings > 0 && (
                                    <Chip
                                        icon={<Warning fontSize="small" />}
                                        label={`${totalWarnings} Warning${totalWarnings !== 1 ? "s" : ""}`}
                                        size="small"
                                        color="warning"
                                        variant="filled"
                                    />
                                )}
                            </Box>
                        </Box>
                    </Alert>
                )
            })()}

            {/* Blocks List */}
            {blocks.length > 0 ? (
                <DndContext
                    sensors={sensors}
                    collisionDetection={(args) => {
                        // First, check if we're over a droppable zone (higher priority)
                        const pointerIntersections = pointerWithin(args)
                        const dropZoneIntersections =
                            pointerIntersections.filter((intersection) => {
                                return (
                                    intersection.id &&
                                    (intersection.id.includes("-then") ||
                                        intersection.id.includes("-else") ||
                                        intersection.id.includes("-cases"))
                                )
                            })

                        if (dropZoneIntersections.length > 0) {
                            return dropZoneIntersections
                        }

                        // Otherwise, use rectangle intersection for better responsiveness
                        const rectIntersections = rectIntersection(args)
                        if (rectIntersections.length > 0) {
                            return rectIntersections
                        }

                        // Fallback to closest center
                        return closestCenter(args)
                    }}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}>
                    <SortableContext
                        items={getAllBlockIds(blocks)}
                        strategy={verticalListSortingStrategy}>
                        {blocks.map((block) => (
                            <SortableBlock
                                key={block.id}
                                block={block}
                                onUpdateBlock={handleUpdateBlock}
                                onDeleteBlock={handleDeleteBlock}
                                onAddChildBlock={handleAddChildBlock}
                                availableInstances={availableInstances}
                                availableVariables={availableVariables}
                                formData={formData}
                                editingNames={editingNames}
                                blocks={blocks}
                                depth={0}
                                onDuplicateBlock={handleDuplicateBlock}
                            />
                        ))}
                    </SortableContext>

                    {/* Drag Overlay for better visual feedback */}
                    <DragOverlay>
                        {activeId ? (
                            <Box
                                sx={{
                                    opacity: 0.8,
                                    transform: "rotate(-2deg)",
                                    boxShadow: "0 8px 25px rgba(0, 0, 0, 0.4)",
                                    borderRadius: 2,
                                    border: "2px solid #d2b019ff",
                                    pointerEvents: "none",
                                }}>
                                {(() => {
                                    // Find the active block
                                    const findBlock = (blockList) => {
                                        for (const block of blockList) {
                                            if (block.id === activeId)
                                                return block

                                            // Check child containers
                                            if (
                                                BLOCK_DEFINITIONS[block.type]
                                                    ?.canContainChildren
                                            ) {
                                                const childContainers =
                                                    BLOCK_DEFINITIONS[
                                                        block.type
                                                    ].childContainers || []
                                                for (const container of childContainers) {
                                                    if (
                                                        block[container] &&
                                                        Array.isArray(
                                                            block[container],
                                                        )
                                                    ) {
                                                        const found = findBlock(
                                                            block[container],
                                                        )
                                                        if (found) return found
                                                    }
                                                }
                                            }
                                        }
                                        return null
                                    }

                                    const activeBlock = findBlock(blocks)
                                    return activeBlock ? (
                                        <Paper
                                            sx={{
                                                p: 2,
                                                backgroundColor: "#2a2d30",
                                                borderLeft: `4px solid ${
                                                    activeBlock.type === "if" ||
                                                    activeBlock.type ===
                                                        "ifElse" ||
                                                    activeBlock.type ===
                                                        "switchCase"
                                                        ? "#FF9800"
                                                        : activeBlock.type ===
                                                            "case"
                                                          ? "#E65100"
                                                          : "#9C27B0"
                                                }`,
                                            }}>
                                            <Typography
                                                variant="body2"
                                                sx={{ fontWeight: 600 }}>
                                                {activeBlock.displayName ||
                                                    activeBlock.type}
                                            </Typography>
                                        </Paper>
                                    ) : null
                                })()}
                            </Box>
                        ) : null}
                    </DragOverlay>
                </DndContext>
            ) : (
                <Paper
                    sx={{
                        p: 4,
                        textAlign: "center",
                        backgroundColor: "#2a2d30",
                        borderRadius: 2,
                        border: "2px dashed",
                        borderColor: "#555",
                    }}>
                    <Box sx={{ mb: 2 }}>
                        <AccountTree
                            sx={{
                                fontSize: 60,
                                color: "text.secondary",
                                mb: 2,
                            }}
                        />
                    </Box>
                    <Typography
                        variant="h6"
                        color="text.secondary"
                        gutterBottom>
                        No blocks configured
                    </Typography>
                    <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mb: 3 }}>
                        Click "Add Block" to start building your conditional
                        logic
                    </Typography>
                    <Button
                        variant="outlined"
                        startIcon={<Add />}
                        onClick={() => setAddDialogOpen(true)}>
                        Create Your First Block
                    </Button>
                </Paper>
            )}

            {/* Add Block Dialog */}
            <Dialog
                open={addDialogOpen}
                onClose={() => setAddDialogOpen(false)}
                maxWidth="md"
                fullWidth
                PaperProps={{
                    sx: { borderRadius: 3 },
                }}>
                <DialogTitle sx={{ pb: 1 }}>
                    <Typography variant="h6" sx={{ fontWeight: 600 }}>
                        Add Block
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        Choose a block type to add to your configuration
                    </Typography>
                </DialogTitle>
                <DialogContent>
                    <Box sx={{ mb: 3 }}>
                        <Typography
                            variant="subtitle2"
                            gutterBottom
                            sx={{ mb: 2 }}>
                            Select Category
                        </Typography>
                        <Stack
                            direction="row"
                            spacing={1}
                            sx={{ flexWrap: "wrap", gap: 1 }}>
                            {categories.map((category) => (
                                <Chip
                                    key={category}
                                    label={category}
                                    icon={getCategoryIcon(category)}
                                    onClick={() =>
                                        setSelectedCategory(category)
                                    }
                                    color={
                                        selectedCategory === category
                                            ? "primary"
                                            : "default"
                                    }
                                    variant={
                                        selectedCategory === category
                                            ? "filled"
                                            : "outlined"
                                    }
                                    sx={{
                                        borderRadius: 2,
                                        backgroundColor:
                                            selectedCategory === category
                                                ? "#d2b019ff"
                                                : "#3a3a3a",
                                        color:
                                            selectedCategory === category
                                                ? "#000"
                                                : "#c3c7c9ff",
                                        "&:hover": {
                                            transform: "translateY(-1px)",
                                            boxShadow: 2,
                                            backgroundColor:
                                                selectedCategory === category
                                                    ? "#e6c34d"
                                                    : "#555",
                                        },
                                        transition: "all 0.2s ease-in-out",
                                    }}
                                />
                            ))}
                        </Stack>
                    </Box>

                    <List sx={{ pt: 0 }}>
                        {Object.entries(BLOCK_DEFINITIONS)
                            .filter(
                                ([key, block]) =>
                                    block.category === selectedCategory,
                            )
                            .map(([key, block]) => (
                                <ListItem
                                    key={key}
                                    disablePadding
                                    sx={{ mb: 1 }}>
                                    <ListItemButton
                                        onClick={() => handleAddBlock(key)}
                                        sx={{
                                            borderRadius: 2,
                                            border: "1px solid",
                                            borderColor: "#555",
                                            backgroundColor: "#2a2d30",
                                            "&:hover": {
                                                borderColor: "#d2b019ff",
                                                backgroundColor:
                                                    "rgba(210, 176, 25, 0.1)",
                                            },
                                            transition: "all 0.2s ease-in-out",
                                        }}>
                                        <ListItemText
                                            primary={
                                                <Box
                                                    sx={{
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: 1,
                                                    }}>
                                                    {getCategoryIcon(
                                                        block.category,
                                                    )}
                                                    {block.displayName}
                                                </Box>
                                            }
                                            secondary={block.description}
                                        />
                                    </ListItemButton>
                                </ListItem>
                            ))}
                    </List>
                </DialogContent>
                <DialogActions sx={{ p: 3, pt: 1 }}>
                    <Button
                        onClick={() => setAddDialogOpen(false)}
                        variant="outlined">
                        Cancel
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Add Prefab Dialog */}
            <Dialog
                open={prefabDialogOpen}
                onClose={() => setPrefabDialogOpen(false)}
                maxWidth="md"
                fullWidth
                PaperProps={{
                    sx: { borderRadius: 3 },
                }}>
                <DialogTitle sx={{ pb: 1 }} component="div">
                    <Typography variant="h6" component="div" sx={{ fontWeight: 600 }}>
                        Add Prefab
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        Choose a pre-built condition template to add
                    </Typography>
                </DialogTitle>
                <DialogContent>
                    {loadingPrefabs ? (
                        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                            <Typography color="text.secondary">Loading prefabs...</Typography>
                        </Box>
                    ) : prefabs ? (
                        <>
                            <Box sx={{ mb: 3 }}>
                                <Typography
                                    variant="subtitle2"
                                    gutterBottom
                                    sx={{ mb: 2 }}>
                                    Select Category
                                </Typography>
                                <Stack
                                    direction="row"
                                    spacing={1}
                                    sx={{ flexWrap: "wrap", gap: 1 }}>
                                    {prefabs.categories.map((category, index) => (
                                        <Chip
                                            key={category.name}
                                            label={category.name}
                                            onClick={() => setSelectedPrefabCategory(index)}
                                            color={selectedPrefabCategory === index ? "primary" : "default"}
                                            variant={selectedPrefabCategory === index ? "filled" : "outlined"}
                                            sx={{
                                                borderRadius: 2,
                                                backgroundColor:
                                                    selectedPrefabCategory === index
                                                        ? "#d2b019ff"
                                                        : "#3a3a3a",
                                                color:
                                                    selectedPrefabCategory === index
                                                        ? "#000"
                                                        : "#c3c7c9ff",
                                                "&:hover": {
                                                    transform: "translateY(-1px)",
                                                    boxShadow: 2,
                                                    backgroundColor:
                                                        selectedPrefabCategory === index
                                                            ? "#e6c34d"
                                                            : "#555",
                                                },
                                                transition: "all 0.2s ease-in-out",
                                            }}
                                        />
                                    ))}
                                </Stack>
                            </Box>

                            {prefabs.categories[selectedPrefabCategory] && (
                                <>
                                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                        {prefabs.categories[selectedPrefabCategory].description}
                                    </Typography>
                                    <List sx={{ pt: 0 }}>
                                        {prefabs.categories[selectedPrefabCategory].prefabs.map((prefab) => (
                                            <ListItem
                                                key={prefab.id}
                                                disablePadding
                                                sx={{ mb: 1 }}>
                                                <ListItemButton
                                                    onClick={() => applyPrefab(prefab)}
                                                    sx={{
                                                        borderRadius: 2,
                                                        border: "1px solid",
                                                        borderColor: "#555",
                                                        backgroundColor: "#2a2d30",
                                                        "&:hover": {
                                                            borderColor: "#d2b019ff",
                                                            backgroundColor: "rgba(210, 176, 25, 0.1)",
                                                        },
                                                        transition: "all 0.2s ease-in-out",
                                                    }}>
                                                    <ListItemText
                                                        primary={
                                                            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                                                                {prefab.name}
                                                            </Typography>
                                                        }
                                                        secondary={
                                                            <Typography variant="body2" color="text.secondary">
                                                                {prefab.description}
                                                            </Typography>
                                                        }
                                                    />
                                                </ListItemButton>
                                            </ListItem>
                                        ))}
                                    </List>
                                </>
                            )}
                        </>
                    ) : (
                        <Box sx={{ py: 4, textAlign: "center" }}>
                            <Typography color="error">Failed to load prefabs</Typography>
                        </Box>
                    )}
                </DialogContent>
                <DialogActions sx={{ p: 3, pt: 1 }}>
                    <Button
                        onClick={() => setPrefabDialogOpen(false)}
                        variant="outlined">
                        Cancel
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    )
}

export default Conditions
