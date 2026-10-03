import { useEffect, useState, useMemo } from "react"
import {
    Box,
    Tabs,
    Tab,
    Button,
    Stack,
    Alert,
    Tooltip,
    Badge,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    DialogContentText,
    CircularProgress,
    IconButton,
} from "@mui/material"
import {
    Info as InfoIcon,
    Input,
    ViewInAr,
    Code,
    Save,
    Close,
    Construction,
    CheckCircle,
    Description,
    Undo,
    Redo,
    Functions,
    DataObject,
    Rule,
    Delete,
    Warning,
} from "@mui/icons-material"
import Info from "./items/Info"
import Inputs from "./items/Inputs"
import Instances from "./items/Instances"
import Variables from "./items/Variables"
import Conditions from "./items/Conditions"
import Other from "./items/Other"
import Metadata from "./items/Metadata"
import { useItemContext } from "../contexts/ItemContext"

function ItemEditor() {
    const { item, reloadItem } = useItemContext()
    const [tabValue, setTabValue] = useState(0)
    const [saveError, setSaveError] = useState(null)
    const [showSaveSuccess, setShowSaveSuccess] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const [discardDialogOpen, setDiscardDialogOpen] = useState(false)
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)

    // User preferences (Settings → Warnings / Developer)
    const [hideWarnings, setHideWarnings] = useState(false)
    const [skipDeleteConfirmations, setSkipDeleteConfirmations] =
        useState(false)
    const [showItemIds, setShowItemIds] = useState(false)

    useEffect(() => {
        const loadPreferences = async () => {
            try {
                const warningsResult =
                    await window.package.getSetting("hideWarnings")
                if (warningsResult.success && warningsResult.value !== undefined) {
                    setHideWarnings(warningsResult.value)
                }
                const skipResult = await window.package.getSetting(
                    "skipDeleteConfirmations",
                )
                if (skipResult.success && skipResult.value !== undefined) {
                    setSkipDeleteConfirmations(skipResult.value)
                }
                const showIdResult =
                    await window.package.getSetting("showItemIds")
                if (showIdResult.success && showIdResult.value !== undefined) {
                    setShowItemIds(showIdResult.value)
                }
            } catch (error) {
                console.warn("Failed to load editor preferences:", error)
            }
        }
        loadPreferences()
    }, [])

    // Model generation staging
    const [isGeneratingModel, setIsGeneratingModel] = useState(false)
    const [stagedEditorItems, setStagedEditorItems] = useState(null)

    // Undo/Redo system
    const [undoStack, setUndoStack] = useState([])
    const [redoStack, setRedoStack] = useState([])
    const [isUndoRedoAction, setIsUndoRedoAction] = useState(false)
    const [editingNames, setEditingNames] = useState({})

    // Create a snapshot of current form data for undo/redo
    const createSnapshot = (action, description) => {
        return {
            action,
            description,
            timestamp: Date.now(),
            formData: JSON.parse(JSON.stringify(formData)), // Deep clone
        }
    }

    // Add action to undo stack
    const addToUndoStack = (action, description) => {
        if (isUndoRedoAction) return // Don't track undo/redo actions themselves

        const snapshot = createSnapshot(action, description)
        setUndoStack((prev) => [...prev, snapshot].slice(-50)) // Keep last 50 actions
        setRedoStack([]) // Clear redo stack when new action is performed
    }

    // Undo function
    const performUndo = () => {
        if (undoStack.length === 0) return

        const currentSnapshot = createSnapshot("current", "Current state")
        const previousSnapshot = undoStack[undoStack.length - 1]

        setIsUndoRedoAction(true)
        setFormData(previousSnapshot.formData)
        setUndoStack((prev) => prev.slice(0, -1))
        setRedoStack((prev) => [...prev, currentSnapshot])

        console.log(`Undid: ${previousSnapshot.description}`)
        setTimeout(() => setIsUndoRedoAction(false), 100)
    }

    // Redo function
    const performRedo = () => {
        if (redoStack.length === 0) return

        const currentSnapshot = createSnapshot("current", "Current state")
        const nextSnapshot = redoStack[redoStack.length - 1]

        setIsUndoRedoAction(true)
        setFormData(nextSnapshot.formData)
        setRedoStack((prev) => prev.slice(0, -1))
        setUndoStack((prev) => [...prev, currentSnapshot])

        console.log(`Redid: ${nextSnapshot.description}`)
        setTimeout(() => setIsUndoRedoAction(false), 100)
    }

    // Keyboard shortcuts for undo/redo
    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.ctrlKey || event.metaKey) {
                if (event.key === "z" && !event.shiftKey) {
                    event.preventDefault()
                    performUndo()
                } else if (
                    event.key === "y" ||
                    (event.key === "z" && event.shiftKey)
                ) {
                    event.preventDefault()
                    performRedo()
                }
            }
        }

        document.addEventListener("keydown", handleKeyDown)
        return () => document.removeEventListener("keydown", handleKeyDown)
    }, [undoStack, redoStack])

    // Form state for all tabs
    const [formData, setFormData] = useState({
        name: "",
        author: "",
        description: "",
        movementHandle: "HANDLE_4_DIRECTIONS",
        modelName: "",
        // Icon staging
        stagedIconPath: null,
        stagedIconName: null,
        iconChanged: false,
        // Inputs and Outputs data
        inputs: {},
        outputs: {},
        // Instances data
        instances: {},
        // Variables and Conditions data
        variables: {},
        conditions: {},
        // Other tab data
        other: {},
        // Track what has been modified
        _modified: {
            basicInfo: false,
            inputs: false,
            outputs: false,
            instances: false,
            variables: false,
            conditions: false,
            other: false,
        },
    })

    // "*" in the window title while there are unsaved changes
    useEffect(() => {
        if (!item) return
        const dirty =
            Object.values(formData._modified || {}).some(Boolean) ||
            !!stagedEditorItems
        document.title = `${dirty ? "*" : ""}Edit ${item.name}`
    }, [item, formData._modified, stagedEditorItems])

    useEffect(() => {
        // Initialize form data when item changes
        if (item) {
            document.title = `Edit ${item.name}`

            // Initialize form data with loaded item
            const desc = item.details?.Description
            let description = ""

            if (desc && typeof desc === "object") {
                const descValues = Object.keys(desc)
                    .filter((key) => key.startsWith("desc_"))
                    .sort(
                        (a, b) =>
                            parseInt(a.slice(5), 10) - parseInt(b.slice(5), 10),
                    )
                    .map((key) => desc[key])
                    .filter((value) => value && value.trim() !== "")
                    .join("\n")
                    .trim()
                description = descValues
            } else {
                description = desc || ""
            }

            // Load inputs, outputs, variables, and conditions
            const loadData = async () => {
                try {
                    const [
                        inputResult,
                        outputResult,
                        variablesResult,
                        conditionsResult,
                        modelNameResult,
                    ] = await Promise.all([
                        window.package.getInputs(item.id),
                        window.package.getOutputs(item.id),
                        window.package.getVariables(item.id),
                        window.package.getConditions(item.id),
                        window.package.getModelName(item.id),
                    ])

                    // Handle conditions - can be either blocks or VBSP format
                    const conditionsData = conditionsResult.success
                        ? conditionsResult.conditions
                        : {}
                    const hasBlocks =
                        conditionsData.blocks &&
                        Array.isArray(conditionsData.blocks)

                    setFormData((prev) => ({
                        ...prev,
                        name: item.name || "",
                        author: item.details?.Authors || "",
                        description: description,
                        movementHandle:
                            item.movementHandle || "HANDLE_4_DIRECTIONS",
                        modelName: modelNameResult.success ? modelNameResult.modelName : "",
                        inputs: inputResult.success ? inputResult.inputs : {},
                        outputs: outputResult.success
                            ? outputResult.outputs
                            : {},
                        // Update instances from item data, but preserve local modifications
                        instances: prev._modified.instances
                            ? prev.instances
                            : item.instances || {},
                        variables: variablesResult.success
                            ? variablesResult.variables
                            : {},
                        // If blocks are present, use them directly, otherwise use VBSP format
                        blocks: hasBlocks ? conditionsData.blocks : undefined,
                        conditions: hasBlocks ? {} : conditionsData,
                        other: item.other || {},
                        _modified: {
                            basicInfo: false,
                            inputs: false,
                            outputs: false,
                            // Keep instances modified flag if it was already set
                            instances: prev._modified.instances,
                            variables: false,
                            conditions: false,
                            other: false,
                        },
                    }))
                } catch (error) {
                    console.error(
                        `Failed to load editor data for item "${item.name}":`,
                        error,
                    )
                    setFormData((prev) => ({
                        ...prev,
                        name: item.name || "",
                        author: item.details?.Authors || "",
                        description: description,
                        movementHandle:
                            item.movementHandle || "HANDLE_4_DIRECTIONS",
                        inputs: {},
                        outputs: {},
                        // Update instances from item data, but preserve local modifications
                        instances: prev._modified.instances
                            ? prev.instances
                            : item.instances || {},
                        variables: {},
                        blocks: undefined,
                        conditions: {},
                        other: item.other || {},
                        _modified: {
                            basicInfo: false,
                            inputs: false,
                            outputs: false,
                            // Keep instances modified flag if it was already set
                            instances: prev._modified.instances,
                            variables: false,
                            conditions: false,
                            other: false,
                        },
                    }))
                }
            }

            loadData()
        }
    }, [item])

    useEffect(() => {
        // Notify backend that editor is ready
        window.package?.editorReady?.()

        // Add class to body to hide scrollbars for ItemEditor
        document.body.classList.add("item-editor-active")

        // Cleanup: remove class when component unmounts
        return () => {
            document.body.classList.remove("item-editor-active")
        }
    }, [])

    // Functions to manage model generation state (passed to Other tab)
    const handleModelGenerationStart = () => {
        setIsGeneratingModel(true)
    }

    const handleModelGenerationComplete = (editorItems) => {
        setIsGeneratingModel(false)
        if (editorItems) {
            setStagedEditorItems(editorItems)
            // Mark as modified so Save button becomes enabled
            setFormData((prev) => ({
                ...prev,
                _modified: {
                    ...prev._modified,
                    other: true,
                },
            }))
        }
    }

    // Compute missing required fields for warning badges
    const missingFieldsWarnings = useMemo(() => {
        const warnings = {
            info: [], // Tab 0 - Name, Author, Description, Icon
            instances: [], // Tab 1 - At least one instance
            other: [], // Tab 5 - Editor Model
        }

        // "Hide non-critical warnings" setting suppresses these badges
        if (hideWarnings) return warnings

        // Check Info tab fields
        if (!formData.name?.trim()) warnings.info.push("Name")
        if (!formData.author?.trim()) warnings.info.push("Author")
        if (!formData.description?.trim()) warnings.info.push("Description")
        if (!item?.icon && !formData.stagedIconPath) warnings.info.push("Icon")

        // Check Instances - need at least one
        const instanceCount = formData.instances ? Object.keys(formData.instances).length : 0
        if (instanceCount === 0) warnings.instances.push("Instance")

        // Check Editor Model - warn if no model selected AND no custom model generated
        if (!item?.metadata?.hasCustomModel && !formData.modelName) warnings.other.push("Editor Model")

        return warnings
    }, [formData.name, formData.author, formData.description, formData.stagedIconPath, formData.instances, formData.modelName, item?.icon, item?.metadata?.hasCustomModel, hideWarnings])

    const handleTabChange = (event, newValue) => {
        setTabValue(newValue)
    }

    const updateFormData = (field, value, section = "basicInfo") => {
        // Add to undo stack before making changes
        addToUndoStack(section, `Change ${field}`)

        // If the user changes the model away from a generated model, clear staged editoritems
        // so the old generated model data doesn't overwrite their new choice on save
        if (field === "modelName" && value !== "Generate" && !(typeof value === "string" && value.startsWith("bpee/"))) {
            setStagedEditorItems(null)
        }

        setFormData((prev) => {
            const newData = {
                ...prev,
                [field]: value,
                _modified: {
                    ...prev._modified,
                    [section]: true,
                },
            }

            return newData
        })
    }

    // Specialized update functions for different sections
    const updateInputsData = (inputs) => {
        // Add to undo stack before making changes
        addToUndoStack("inputs", "Update inputs")

        setFormData((prev) => ({
            ...prev,
            inputs,
            _modified: {
                ...prev._modified,
                inputs: true,
            },
        }))
    }

    const updateOutputsData = (outputs) => {
        // Add to undo stack before making changes
        addToUndoStack("outputs", "Update outputs")

        setFormData((prev) => ({
            ...prev,
            outputs,
            _modified: {
                ...prev._modified,
                outputs: true,
            },
        }))
    }

    const updateInstancesData = (instances) => {
        // Add to undo stack before making changes
        addToUndoStack("instances", "Update instances")

        setFormData((prev) => ({
            ...prev,
            instances,
            _modified: {
                ...prev._modified,
                instances: true,
            },
        }))
    }

    const updateVariablesData = (variables) => {
        // Add to undo stack before making changes
        addToUndoStack("variables", "Update Variables")

        setFormData((prev) => ({
            ...prev,
            variables,
            _modified: {
                ...prev._modified,
                variables: true,
            },
        }))
    }

    const updateConditionsData = (blocks) => {
        // Add to undo stack before making changes
        addToUndoStack("conditions", "Update Conditions")

        setFormData((prev) => ({
            ...prev,
            blocks, // Store as blocks format
            _modified: {
                ...prev._modified,
                conditions: true,
            },
        }))
    }

    const importConditionsData = (blocks) => {
        // Import conditions and save immediately to meta.json
        // This happens when auto-converting from VBSP format to blocks
        setFormData((prev) => ({
            ...prev,
            blocks, // Store as blocks instead of conditions
            _modified: {
                ...prev._modified,
                conditions: false, // Don't mark as modified - we'll save immediately
            },
        }))

        // Auto-save the converted blocks immediately to meta.json
        // This prevents "unsaved changes" from appearing on first open
        if (item?.id && blocks) {
            console.log(
                `Auto-saving the converted VBSP conditions of item "${item.name}"`,
            )
            window.package
                .saveConditions(item.id, { blocks })
                .catch((error) => {
                    console.error(
                        `Failed to auto-save the converted VBSP conditions of item "${item.name}":`,
                        error,
                    )
                })
        }

        // Don't set unsaved changes or add to undo stack since this is automatic
    }

    const updateOtherData = (other) => {
        // Add to undo stack before making changes
        addToUndoStack("other", "Update other data")

        setFormData((prev) => ({
            ...prev,
            other,
            _modified: {
                ...prev._modified,
                other: true,
            },
        }))
    }

    const handleSave = async () => {
        try {
            setIsSaving(true)
            setSaveError(null)

            // Validate required fields
            if (!formData.name?.trim()) {
                throw new Error("Item name cannot be empty")
            }

            const savePromises = []
            let hasErrors = false

            // Most save handlers report a failure as { success: false, error }
            // instead of throwing, so every result is checked: a failed part
            // must stop the save, not end up reported as saved
            const assertSaved = (result) => {
                if (result?.success === false) {
                    throw new Error(result.error || "No reason given")
                }
                return result
            }

            // Save basic info if modified
            if (formData._modified.basicInfo) {
                const saveData = {
                    id: item.id,
                    name: formData.name,
                    movementHandle: formData.movementHandle,
                    fullItemPath: item.fullItemPath,
                    details: {
                        ...item.details,
                        Authors: formData.author,
                        Description: formData.description,
                    },
                    // Include staged icon data if changed
                    iconData: formData.iconChanged
                        ? {
                              stagedIconPath: formData.stagedIconPath,
                              stagedIconName: formData.stagedIconName,
                          }
                        : null,
                }

                savePromises.push(
                    window.package?.saveItem?.(saveData).then(assertSaved).catch((error) => {
                        console.error(
                            `Failed to save basic info of item "${item.name}":`,
                            error,
                        )
                        hasErrors = true
                        throw new Error(`Basic info: ${error.message}`)
                    }),
                )
            }

            // Save inputs if modified - handle add/update/remove operations
            if (formData._modified.inputs) {
                try {
                    // Get original inputs to compare changes
                    const originalInputsResult = await window.package.getInputs(
                        item.id,
                    )
                    const originalInputs = originalInputsResult.success
                        ? originalInputsResult.inputs
                        : {}

                    // Find inputs to add, update, or remove
                    const currentInputs = formData.inputs || {}

                    // Remove inputs that are in original but not in current
                    for (const inputName of Object.keys(originalInputs)) {
                        if (!(inputName in currentInputs)) {
                            assertSaved(
                                await window.package.removeInput(
                                    item.id,
                                    inputName,
                                ),
                            )
                        }
                    }

                    // Add or update inputs
                    for (const [inputName, inputConfig] of Object.entries(
                        currentInputs,
                    )) {
                        if (inputName in originalInputs) {
                            // Update existing input
                            assertSaved(
                                await window.package.updateInput(
                                    item.id,
                                    inputName,
                                    inputConfig,
                                ),
                            )
                        } else {
                            // Add new input
                            assertSaved(
                                await window.package.addInput(
                                    item.id,
                                    inputName,
                                    inputConfig,
                                ),
                            )
                        }
                    }
                } catch (error) {
                    console.error(
                        `Failed to save inputs of item "${item.name}":`,
                        error,
                    )
                    hasErrors = true
                    throw new Error(`Inputs: ${error.message}`)
                }
            }

            // Save outputs if modified - handle add/update/remove operations
            if (formData._modified.outputs) {
                try {
                    // Get original outputs to compare changes
                    const originalOutputsResult =
                        await window.package.getOutputs(item.id)
                    const originalOutputs = originalOutputsResult.success
                        ? originalOutputsResult.outputs
                        : {}

                    // Find outputs to add, update, or remove
                    const currentOutputs = formData.outputs || {}

                    // Remove outputs that are in original but not in current
                    for (const outputName of Object.keys(originalOutputs)) {
                        if (!(outputName in currentOutputs)) {
                            assertSaved(
                                await window.package.removeOutput(
                                    item.id,
                                    outputName,
                                ),
                            )
                        }
                    }

                    // Add or update outputs
                    for (const [outputName, outputConfig] of Object.entries(
                        currentOutputs,
                    )) {
                        if (outputName in originalOutputs) {
                            // Update existing output
                            assertSaved(
                                await window.package.updateOutput(
                                    item.id,
                                    outputName,
                                    outputConfig,
                                ),
                            )
                        } else {
                            // Add new output
                            assertSaved(
                                await window.package.addOutput(
                                    item.id,
                                    outputName,
                                    outputConfig,
                                ),
                            )
                        }
                    }
                } catch (error) {
                    console.error(
                        `Failed to save outputs of item "${item.name}":`,
                        error,
                    )
                    hasErrors = true
                    throw new Error(`Outputs: ${error.message}`)
                }
            }

            // Save instances if modified
            // Maps temporary "pending_..." indices to the real numeric index
            // assigned by the backend when the instance is added during this save
            const pendingIndexMap = {}
            if (formData._modified.instances) {
                try {
                    const currentInstances = formData.instances || {}
                    const originalInstances = item.instances || {}

                    // Process removals first
                    for (const [index, instanceData] of Object.entries(
                        currentInstances,
                    )) {
                        if (
                            instanceData._toRemove &&
                            originalInstances[index]
                        ) {
                            console.log(
                                `Removing instance "${instanceData.Name}" from item "${item.name}"`,
                            )
                            assertSaved(
                                await window.package.removeInstance(
                                    item.id,
                                    index,
                                ),
                            )
                        }
                    }

                    // Process additions
                    for (const [index, instanceData] of Object.entries(
                        currentInstances,
                    )) {
                        if (instanceData._pending && instanceData._filePath) {
                            console.log(
                                `Adding instance "${instanceData.Name}" to item "${item.name}"`,
                            )
                            // Use a new backend function to add instance from file path
                            const addResult = assertSaved(
                                await window.package.addInstanceFromFile(
                                    item.id,
                                    instanceData._filePath,
                                    instanceData.Name,
                                ),
                            )
                            if (
                                addResult?.success &&
                                addResult.index !== undefined
                            ) {
                                pendingIndexMap[index] = String(addResult.index)
                            }
                        }
                    }
                } catch (error) {
                    console.error(
                        `Failed to save instances of item "${item.name}":`,
                        error,
                    )
                    hasErrors = true
                    throw new Error(`Instances: ${error.message}`)
                }
            }

            // Save instance names if any are being edited
            if (Object.keys(editingNames).length > 0) {
                try {
                    for (const [instanceIndex, newName] of Object.entries(
                        editingNames,
                    )) {
                        // Pending instances get their real index assigned
                        // during this save; anything still non-numeric would
                        // be written to meta.json as a literal "NaN" key
                        const resolvedIndex =
                            pendingIndexMap[instanceIndex] ?? instanceIndex
                        const numericIndex = parseInt(resolvedIndex, 10)
                        if (
                            !Number.isInteger(numericIndex) ||
                            numericIndex < 0
                        ) {
                            console.warn(
                                `Skipped saving the name of instance ${instanceIndex}, its index could not be resolved`,
                            )
                            continue
                        }

                        const trimmedName = newName.trim()
                        const defaultName = `Instance ${numericIndex + 1}`

                        if (trimmedName === defaultName || trimmedName === "") {
                            // Remove custom name
                            assertSaved(
                                await window.package.removeInstanceName(
                                    item.id,
                                    numericIndex,
                                ),
                            )
                        } else {
                            // Set custom name
                            assertSaved(
                                await window.package.setInstanceName(
                                    item.id,
                                    numericIndex,
                                    trimmedName,
                                ),
                            )
                        }
                    }

                    // Clear editing names after saving
                    setEditingNames({})
                } catch (error) {
                    console.error(
                        `Failed to save instance names of item "${item.name}":`,
                        error,
                    )
                    hasErrors = true
                    throw new Error(`Instance names: ${error.message}`)
                }
            }

            // Save Variables data if modified
            if (formData._modified.variables) {
                try {
                    assertSaved(
                        await window.package.saveVariables?.(
                            item.id,
                            formData.variables,
                        ),
                    )
                } catch (error) {
                    console.error(
                        `Failed to save variables of item "${item.name}":`,
                        error,
                    )
                    hasErrors = true
                    throw new Error(`Variables: ${error.message}`)
                }
            }

            // Save Conditions data if modified
            if (formData._modified.conditions) {
                try {
                    // Save blocks format - the backend will handle conversion and logging
                    assertSaved(
                        await window.package.saveConditions?.(item.id, {
                            blocks: formData.blocks,
                        }),
                    )
                } catch (error) {
                    console.error(
                        `Failed to save conditions of item "${item.name}":`,
                        error,
                    )
                    hasErrors = true
                    throw new Error(`Conditions: ${error.message}`)
                }
            }

            // Save other data if modified (including modelName)
            if (formData._modified.other) {
                try {
                    await window.package.saveOther?.(item.id, formData.other)
                    // Save model name
                    await window.package?.saveModelName?.(item.id, formData.modelName).then(assertSaved).catch((error) => {
                        console.error(
                            `Failed to save model name of item "${item.name}":`,
                            error,
                        )
                        hasErrors = true
                        throw new Error(`Model name: ${error.message}`)
                    })
                } catch (error) {
                    console.error(
                        `Failed to save other data of item "${item.name}":`,
                        error,
                    )
                    hasErrors = true
                    throw new Error(`Other: ${error.message}`)
                }
            }

            // Save staged model/material files from model generation (if any)
            // Always try to copy staged files - they may exist even if stagedEditorItems is null
            // (e.g., if MDL conversion failed but VTF conversion succeeded)
            try {
                // Step 1: Copy staged model/material files from .bpee/ to resources/
                const copyResult = assertSaved(
                    await window.electron.invoke("copy-staged-model-files", {
                        itemId: item.id,
                    }),
                )

                // Step 2: Save staged editoritems.json changes (only if we have them)
                if (stagedEditorItems) {
                    assertSaved(
                        await window.electron.invoke("save-staged-editoritems", {
                            itemId: item.id,
                            stagedEditorItems: stagedEditorItems,
                            hasObjFiles: copyResult.hasObjFiles || false,
                        }),
                    )
                }
            } catch (error) {
                console.error(
                    `Failed to save staged model changes of item "${item.name}":`,
                    error,
                )
                hasErrors = true
                throw new Error(`Staged model changes: ${error.message}`)
            }

            // Wait for all saves to complete
            if (savePromises.length > 0) {
                await Promise.all(savePromises)
            }

            // Ensure ConnectionPoints exist if item has I/O
            try {
                assertSaved(
                    await window.package?.ensureConnectionPoints?.(item.id),
                )
            } catch (error) {
                console.error(
                    `Failed to add connection points to item "${item.name}":`,
                    error,
                )
                hasErrors = true
                throw new Error(`Connection points: ${error.message}`)
            }

            if (!hasErrors) {
                // Show checkmark icon temporarily
                setShowSaveSuccess(true)
                setSaveError(null)
                setTimeout(() => setShowSaveSuccess(false), 2000)

                // Clear all modified flags and staged data
                setFormData((prev) => ({
                    ...prev,
                    // Clear staged icon data after successful save
                    stagedIconPath: null,
                    stagedIconName: null,
                    iconChanged: false,
                    _modified: {
                        basicInfo: false,
                        inputs: false,
                        outputs: false,
                        instances: false,
                        variables: false,
                        conditions: false,
                        other: false,
                    },
                }))

                // Clear staged editoritems from model generation
                setStagedEditorItems(null)

                // Trigger reload to get fresh data from backend
                reloadItem(item.id)
            }
        } catch (error) {
            console.error(`Failed to save item "${item.name}":`, error)
            setSaveError(error.message)
        } finally {
            setIsSaving(false)
        }
    }

    const handleCloseError = () => {
        setSaveError(null)
    }

    const handleCloseOrDiscard = () => {
        const hasUnsavedChanges = Object.values(formData._modified).some(
            (modified) => modified,
        )

        if (hasUnsavedChanges) {
            setDiscardDialogOpen(true)
        } else {
            window.close()
        }
    }

    const handleConfirmDiscard = () => {
        setDiscardDialogOpen(false)
        window.close()
    }

    const handleCancelDiscard = () => {
        setDiscardDialogOpen(false)
    }

    const handleDeleteItem = async () => {
        setIsDeleting(true)
        try {
            const result = await window.electron.invoke("delete-item", {
                itemId: item.id,
            })
            if (result.success) {
                // Close the editor window after successful deletion
                window.close()
            }
        } catch (error) {
            console.error(`Failed to delete item "${item.name}":`, error)
            setSaveError(error.message || "Failed to delete item")
            setDeleteDialogOpen(false)
        } finally {
            setIsDeleting(false)
        }
    }

    if (!item) return null

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
                        title={
                            missingFieldsWarnings.info.length > 0
                                ? `Info - Missing: ${missingFieldsWarnings.info.join(", ")}`
                                : "Info - Edit name, author, description"
                        }
                        placement="right">
                        <Tab
                            icon={
                                <Badge
                                    color="primary"
                                    variant="dot"
                                    invisible={!formData._modified.basicInfo || missingFieldsWarnings.info.length > 0}>
                                    <Box sx={{ position: "relative" }}>
                                        <InfoIcon />
                                        {missingFieldsWarnings.info.length > 0 && (
                                            <Warning
                                                sx={{
                                                    position: "absolute",
                                                    top: -6,
                                                    right: -6,
                                                    fontSize: 14,
                                                    color: "#f57c00",
                                                }}
                                            />
                                        )}
                                    </Box>
                                </Badge>
                            }
                        />
                    </Tooltip>
                    <Tooltip
                        title={
                            missingFieldsWarnings.instances.length > 0
                                ? `Instances - Missing: ${missingFieldsWarnings.instances.join(", ")}`
                                : "Instances - Manage item's VMF instances"
                        }
                        placement="right">
                        <Tab
                            icon={
                                <Badge
                                    color="primary"
                                    variant="dot"
                                    invisible={!formData._modified.instances || missingFieldsWarnings.instances.length > 0}>
                                    <Box sx={{ position: "relative" }}>
                                        <ViewInAr />
                                        {missingFieldsWarnings.instances.length > 0 && (
                                            <Warning
                                                sx={{
                                                    position: "absolute",
                                                    top: -6,
                                                    right: -6,
                                                    fontSize: 14,
                                                    color: "#f57c00",
                                                }}
                                            />
                                        )}
                                    </Box>
                                </Badge>
                            }
                        />
                    </Tooltip>
                    <Tooltip
                        title="Inputs - Configure item inputs and outputs"
                        placement="right">
                        <Tab
                            icon={
                                <Badge
                                    color="primary"
                                    variant="dot"
                                    invisible={
                                        !formData._modified.inputs &&
                                        !formData._modified.outputs
                                    }>
                                    <Input />
                                </Badge>
                            }
                        />
                    </Tooltip>
                    <Tooltip
                        title="Variables - Configure VBSP variables"
                        placement="right">
                        <Tab
                            icon={
                                <Badge
                                    color="primary"
                                    variant="dot"
                                    invisible={!formData._modified.variables}>
                                    <DataObject />
                                </Badge>
                            }
                        />
                    </Tooltip>
                    <Tooltip
                        title="Conditions - Configure VBSP conditions and logic"
                        placement="right">
                        <Tab
                            icon={
                                <Badge
                                    color="primary"
                                    variant="dot"
                                    invisible={!formData._modified.conditions}>
                                    <Rule />
                                </Badge>
                            }
                        />
                    </Tooltip>
                    <Tooltip
                        title={
                            missingFieldsWarnings.other.length > 0
                                ? `Other - Missing: ${missingFieldsWarnings.other.join(", ")}`
                                : "Other - Model chooser and generator"
                        }
                        placement="right">
                        <Tab
                            icon={
                                <Badge
                                    color="primary"
                                    variant="dot"
                                    invisible={!formData._modified.other || missingFieldsWarnings.other.length > 0}>
                                    <Box sx={{ position: "relative" }}>
                                        <Construction />
                                        {missingFieldsWarnings.other.length > 0 && (
                                            <Warning
                                                sx={{
                                                    position: "absolute",
                                                    top: -6,
                                                    right: -6,
                                                    fontSize: 14,
                                                    color: "#f57c00",
                                                }}
                                            />
                                        )}
                                    </Box>
                                </Badge>
                            }
                        />
                    </Tooltip>
                    <Tooltip
                        title="Metadata - Item metadata and tags"
                        placement="right">
                        <Tab icon={<Description />} />
                    </Tooltip>
                </Tabs>

                {/* Tab Content */}
                <Box sx={{ flex: 1, p: 2, overflow: "auto" }}>
                    <Box sx={{ display: tabValue === 0 ? "block" : "none" }}>
                        <Info
                            item={item}
                            formData={formData}
                            onUpdate={updateFormData}
                            hideWarnings={hideWarnings}
                            showId={showItemIds}
                        />
                    </Box>
                    <Box sx={{ display: tabValue === 1 ? "block" : "none" }}>
                        <Instances
                            item={item}
                            formData={formData}
                            onUpdate={updateFormData}
                            onUpdateInstances={updateInstancesData}
                            editingNames={editingNames}
                            setEditingNames={setEditingNames}
                        />
                    </Box>
                    <Box sx={{ display: tabValue === 2 ? "block" : "none" }}>
                        <Inputs
                            item={item}
                            formData={formData}
                            onUpdate={updateFormData}
                            onUpdateInputs={updateInputsData}
                            onUpdateOutputs={updateOutputsData}
                        />
                    </Box>
                    <Box sx={{ display: tabValue === 3 ? "block" : "none" }}>
                        <Variables
                            item={item}
                            formData={formData}
                            onUpdate={updateFormData}
                            onUpdateVariables={updateVariablesData}
                        />
                    </Box>
                    <Box sx={{ display: tabValue === 4 ? "block" : "none" }}>
                        <Conditions
                            item={item}
                            formData={formData}
                            onUpdate={updateFormData}
                            onUpdateConditions={updateConditionsData}
                            onImportConditions={importConditionsData}
                            editingNames={editingNames}
                        />
                    </Box>
                    <Box sx={{ display: tabValue === 5 ? "block" : "none" }}>
                        <Other
                            item={item}
                            formData={formData}
                            onUpdate={updateFormData}
                            onUpdateOther={updateOtherData}
                            onModelGenerationStart={handleModelGenerationStart}
                            onModelGenerationComplete={handleModelGenerationComplete}
                        />
                    </Box>
                    <Box sx={{ display: tabValue === 6 ? "block" : "none" }}>
                        <Metadata item={item} />
                    </Box>
                </Box>
            </Box>

            {/* Save/Close Buttons */}
            <Box sx={{ p: 2, borderTop: 1, borderColor: "divider" }}>
                <Stack direction="row" spacing={1}>
                    {/* Undo/Redo Buttons */}
                    <Tooltip
                        title={`Undo (Ctrl+Z)${undoStack.length > 0 ? ` - ${undoStack[undoStack.length - 1]?.description}` : " - No actions to undo"}`}>
                        <span>
                            <IconButton
                                onClick={performUndo}
                                disabled={undoStack.length === 0}
                                size="small">
                                <Undo />
                            </IconButton>
                        </span>
                    </Tooltip>
                    <Tooltip
                        title={`Redo (Ctrl+Y)${redoStack.length > 0 ? ` - ${redoStack[redoStack.length - 1]?.description}` : " - No actions to redo"}`}>
                        <span>
                            <IconButton
                                onClick={performRedo}
                                disabled={redoStack.length === 0}
                                size="small">
                                <Redo />
                            </IconButton>
                        </span>
                    </Tooltip>
                    <Tooltip
                        title={(() => {
                            const modifiedSections = Object.entries(
                                formData._modified,
                            )
                                .filter(([section, isModified]) => isModified)
                                .map(([section]) => {
                                    switch (section) {
                                        case "basicInfo":
                                            return "Basic Info"
                                        case "inputs":
                                            return "Inputs"
                                        case "outputs":
                                            return "Outputs"
                                        case "instances":
                                            return "Instances"
                                        case "variables":
                                            return "Variables"
                                        case "conditions":
                                            return "Conditions"
                                        case "other":
                                            return "Other"
                                        default:
                                            return section
                                    }
                                })

                            // Add instance names if being edited
                            if (Object.keys(editingNames).length > 0) {
                                modifiedSections.push("Instance Names")
                            }

                            if (modifiedSections.length === 0) {
                                return "No unsaved changes"
                            }

                            return `Save changes to: ${modifiedSections.join(", ")}`
                        })()}>
                        <Button
                            variant="contained"
                            startIcon={
                                isSaving ? (
                                    <CircularProgress
                                        size={20}
                                        color="inherit"
                                    />
                                ) : showSaveSuccess ? (
                                    <CheckCircle />
                                ) : (
                                    <Save />
                                )
                            }
                            onClick={handleSave}
                            color={showSaveSuccess ? "success" : "primary"}
                            disabled={
                                (!Object.values(formData._modified).some(
                                    (modified) => modified,
                                ) &&
                                    Object.keys(editingNames).length === 0 &&
                                    !stagedEditorItems) ||
                                isSaving ||
                                isGeneratingModel
                            }
                            sx={{ flex: 1 }}>
                            {isSaving
                                ? "Saving..."
                                : showSaveSuccess
                                  ? "Saved!"
                                  : "Save"}
                        </Button>
                    </Tooltip>
                    <Tooltip
                        title={(() => {
                            const hasUnsavedChanges = Object.values(
                                formData._modified,
                            ).some((modified) => modified)
                            return hasUnsavedChanges
                                ? "Discard unsaved changes and close editor"
                                : "Close editor"
                        })()}>
                        <Button
                            variant="outlined"
                            startIcon={<Close />}
                            onClick={handleCloseOrDiscard}
                            color={
                                Object.values(formData._modified).some(
                                    (modified) => modified,
                                )
                                    ? "error"
                                    : "primary"
                            }
                            sx={{ flex: 1 }}>
                            {Object.values(formData._modified).some(
                                (modified) => modified,
                            )
                                ? "Discard"
                                : "Close"}
                        </Button>
                    </Tooltip>
                    <Box sx={{ flex: 1 }} />
                    <Tooltip
                        title={
                            skipDeleteConfirmations
                                ? "Delete this item permanently (confirmation skipped)"
                                : "Delete this item permanently"
                        }>
                        <Button
                            variant="outlined"
                            startIcon={<Delete />}
                            onClick={() =>
                                skipDeleteConfirmations
                                    ? handleDeleteItem()
                                    : setDeleteDialogOpen(true)
                            }
                            color="error"
                            disabled={isDeleting}>
                            Delete
                        </Button>
                    </Tooltip>
                </Stack>
                {saveError && (
                    <Alert
                        severity="error"
                        onClose={handleCloseError}
                        sx={{ mt: 2 }}>
                        {saveError}
                    </Alert>
                )}
            </Box>

            {/* Discard Changes Confirmation Dialog */}
            <Dialog
                open={discardDialogOpen}
                onClose={handleCancelDiscard}
                aria-labelledby="discard-dialog-title"
                aria-describedby="discard-dialog-description">
                <DialogTitle id="discard-dialog-title">
                    Discard Unsaved Changes?
                </DialogTitle>
                <DialogContent>
                    <DialogContentText id="discard-dialog-description">
                        You have unsaved changes that will be lost if you close
                        the editor. Are you sure you want to discard these
                        changes?
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCancelDiscard} color="primary">
                        Cancel
                    </Button>
                    <Button
                        onClick={handleConfirmDiscard}
                        color="error"
                        variant="contained">
                        Discard Changes
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Delete Item Confirmation Dialog */}
            <Dialog
                open={deleteDialogOpen}
                onClose={() => !isDeleting && setDeleteDialogOpen(false)}
                aria-labelledby="delete-dialog-title"
                aria-describedby="delete-dialog-description">
                <DialogTitle id="delete-dialog-title">
                    Delete Item "{item.name}"?
                </DialogTitle>
                <DialogContent>
                    <DialogContentText id="delete-dialog-description">
                        This will permanently delete the item and all its
                        associated files. This action cannot be undone.
                    </DialogContentText>
                    <Alert severity="warning" sx={{ mt: 2 }}>
                        <strong>Warning:</strong> All data for this item will be
                        lost, including:
                        <ul style={{ marginTop: 8, marginBottom: 0 }}>
                            <li>Item configuration</li>
                            <li>All instances</li>
                            <li>Conditions and variables</li>
                            <li>Metadata</li>
                        </ul>
                    </Alert>
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={() => setDeleteDialogOpen(false)}
                        disabled={isDeleting}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleDeleteItem}
                        color="error"
                        variant="contained"
                        disabled={isDeleting}
                        startIcon={
                            isDeleting ? (
                                <CircularProgress size={20} color="inherit" />
                            ) : (
                                <Delete />
                            )
                        }>
                        {isDeleting ? "Deleting..." : "Delete Permanently"}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    )
}

export default ItemEditor
