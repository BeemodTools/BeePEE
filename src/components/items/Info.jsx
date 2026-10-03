import {
    Stack,
    TextField,
    Box,
    Typography,
    IconButton,
    Button,
    Divider,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Alert,
    InputAdornment,
} from "@mui/material"
import {
    Visibility,
    Edit,
    FolderOpen,
    Image,
    Warning,
    Lock,
} from "@mui/icons-material"
import ReactMarkdown from "react-markdown"
import { useState, useEffect } from "react"

function Info({ item, formData, onUpdate, hideWarnings = false, showId = false }) {
    const [iconSrc, setIconSrc] = useState(null)
    const [iconError, setIconError] = useState(false)
    const [isPreview, setIsPreview] = useState(false)

    useEffect(() => {
        // Load the icon when item changes or when staged icon changes
        const iconToLoad = formData.stagedIconPath || item?.icon
        if (iconToLoad) {
            window.package.loadFile(iconToLoad)
                .then(setIconSrc)
                .catch((error) => {
                    console.warn(
                        `Failed to load the icon of item "${item?.name}":`,
                        error,
                    )
                    setIconError(true)
                    setIconSrc(null)
                })
        } else {
            setIconSrc(null)
            setIconError(false)
        }
    }, [item, formData.stagedIconPath])

    const handleIconError = () => {
        setIconError(true)
    }

    // Get relative path from package root (show staged path if available)
    const getRelativeIconPath = () => {
        const iconPath = formData.stagedIconPath || item?.icon
        if (!iconPath || !item?.packagePath) return ""

        // If it's a staged icon, show just the filename
        if (formData.stagedIconPath) {
            const filename = formData.stagedIconPath.split(/[\\\/]/).pop()
            return `${filename} (staged)`
        }

        // Remove the package path from the full icon path to get relative path
        const fullIconPath = iconPath
        const packagePath = item.packagePath

        if (fullIconPath.startsWith(packagePath)) {
            return fullIconPath
                .substring(packagePath.length)
                .replace(/^[\\\/]/, "")
        }

        return iconPath // fallback to full path if something goes wrong
    }

    // Process markdown to handle single line breaks properly
    const processMarkdown = (text) => {
        return text
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line !== "") // Remove empty lines first
            .join("  \n") // Add two spaces + newline for proper markdown line breaks
    }

    const markdownComponents = {
        // Custom paragraph renderer to handle spacing better
        p: ({ children }) => (
            <Typography component="p" sx={{ mb: 1, "&:last-child": { mb: 0 } }}>
                {children}
            </Typography>
        ),
        // Better list styling
        ul: ({ children }) => (
            <Box
                component="ul"
                sx={{ pl: 2, mb: 1, "&:last-child": { mb: 0 } }}>
                {children}
            </Box>
        ),
        li: ({ children }) => (
            <Typography component="li" sx={{ mb: 0.5 }}>
                {children}
            </Typography>
        ),
        // Better strong/bold styling
        strong: ({ children }) => (
            <Box component="span" sx={{ fontWeight: "bold" }}>
                {children}
            </Box>
        ),
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
                <Typography variant="h6">Info</Typography>
            </Box>

            <Stack spacing={2} sx={{ height: "100%" }}>
                {/* Warning alert for missing fields */}
                {(() => {
                    if (hideWarnings) return null
                    const missing = []
                    if (!formData.name?.trim()) missing.push("Name")
                    if (!formData.author?.trim()) missing.push("Author")
                    if (!formData.stagedIconPath && !item?.icon) missing.push("Icon")
                    if (!formData.description?.trim()) missing.push("Description")
                    return missing.length > 0 ? (
                        <Alert severity="warning" icon={<Warning />}>
                            Missing required fields: {missing.join(", ")}
                        </Alert>
                    ) : null
                })()}

                {showId && (
                    <TextField
                        label="ID"
                        value={item?.id || ""}
                        disabled
                        helperText="Fixed identifier - cannot be changed"
                        fullWidth
                        variant="outlined"
                        InputProps={{
                            endAdornment: (
                                <InputAdornment position="end">
                                    <Lock
                                        sx={{
                                            fontSize: 16,
                                            color: "text.disabled",
                                        }}
                                    />
                                </InputAdornment>
                            ),
                        }}
                    />
                )}

                <TextField
                    label="Name"
                    value={formData.name}
                    onChange={(e) => onUpdate("name", e.target.value)}
                    fullWidth
                    variant="outlined"
                    error={!formData.name?.trim()}
                />

                <TextField
                    label="Author"
                    value={formData.author}
                    onChange={(e) => onUpdate("author", e.target.value)}
                    fullWidth
                    variant="outlined"
                    error={!formData.author?.trim()}
                />

                {/* Icon upload */}
                {(iconSrc || formData.stagedIconPath || item?.icon) ? (
                    <Box sx={{ display: "flex", gap: 1 }}>
                        <Button
                            variant="outlined"
                            fullWidth
                            startIcon={<FolderOpen />}
                            onClick={async () => {
                                try {
                                    const result = await window.package.browseForIconFile()
                                    if (result.success) {
                                        onUpdate("stagedIconPath", result.filePath)
                                        onUpdate("stagedIconName", result.fileName)
                                        onUpdate("iconChanged", true, "basicInfo")
                                    } else if (!result.canceled) {
                                        console.error(
                                            `Failed to select an icon file for item "${item?.name}":`,
                                            result.error,
                                        )
                                    }
                                } catch (error) {
                                    console.error(
                                        `Failed to select an icon file for item "${item?.name}":`,
                                        error,
                                    )
                                }
                            }}
                            sx={{ py: 1.5 }}
                        >
                            Change Icon
                        </Button>
                        <Button
                            variant="contained"
                            fullWidth
                            startIcon={<Visibility />}
                            onClick={async () => {
                                const iconToShow = formData.stagedIconPath || item?.icon
                                if (iconToShow) {
                                    try {
                                        await window.package.showIconPreview(iconToShow, item.name)
                                    } catch (error) {
                                        console.error(
                                            `Failed to show the icon preview for item "${item?.name}":`,
                                            error,
                                        )
                                    }
                                }
                            }}
                            sx={{ py: 1.5 }}
                        >
                            Preview
                        </Button>
                    </Box>
                ) : (
                    <Button
                        variant="contained"
                        fullWidth
                        color="warning"
                        startIcon={<FolderOpen />}
                        onClick={async () => {
                            try {
                                const result = await window.package.browseForIconFile()
                                if (result.success) {
                                    onUpdate("stagedIconPath", result.filePath)
                                    onUpdate("stagedIconName", result.fileName)
                                    onUpdate("iconChanged", true, "basicInfo")
                                } else if (!result.canceled) {
                                    console.error(
                                        `Failed to select an icon file for item "${item?.name}":`,
                                        result.error,
                                    )
                                }
                            } catch (error) {
                                console.error(
                                    `Failed to select an icon file for item "${item?.name}":`,
                                    error,
                                )
                            }
                        }}
                        sx={{ py: 1.5 }}
                    >
                        Upload Icon
                    </Button>
                )}

                {/* Description with preview toggle */}
                <Box sx={{ flex: 1, display: "flex", flexDirection: "column" }}>
                    <Box
                        sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1,
                            mb: 1,
                        }}>
                        <Typography variant="body2" color="text.secondary">
                            Description
                        </Typography>
                        <IconButton
                            size="small"
                            onClick={() => setIsPreview(!isPreview)}
                            sx={{ ml: "auto" }}
                            title={isPreview ? "Edit" : "Preview"}>
                            {isPreview ? <Edit /> : <Visibility />}
                        </IconButton>
                    </Box>

                    {isPreview ? (
                        <Box
                            sx={{
                                flex: 1,
                                border: "1px solid #ccc",
                                borderRadius: 1,
                                p: 2,
                                backgroundColor: "background.paper",
                                color: "text.primary",
                                overflow: "auto",
                                "& > *:first-of-type": { mt: 0 },
                                "& > *:last-child": { mb: 0 },
                            }}>
                            <ReactMarkdown components={markdownComponents}>
                                {processMarkdown(formData.description)}
                            </ReactMarkdown>
                        </Box>
                    ) : (
                        <TextField
                            value={formData.description}
                            onChange={(e) =>
                                onUpdate("description", e.target.value)
                            }
                            fullWidth
                            multiline
                            error={!formData.description?.trim()}
                            placeholder="Enter description...   Markdown formatting is supported"
                            sx={{
                                flex: 1,
                                "& .MuiInputBase-root": {
                                    height: "100%",
                                    alignItems: "flex-start",
                                },
                            }}
                        />
                    )}
                </Box>

                {/* Section divider */}
                <Divider sx={{ my: 1 }} />

                {/* Movement Handle */}
                <FormControl fullWidth>
                    <InputLabel id="movement-handle-label">
                        Rotation Handle
                    </InputLabel>
                    <Select
                        labelId="movement-handle-label"
                        label="Rotation Handle"
                        value={formData.movementHandle}
                        onChange={(e) =>
                            onUpdate("movementHandle", e.target.value)
                        }
                        variant="outlined">
                        <MenuItem value="HANDLE_NONE">No Handle</MenuItem>
                        <MenuItem value="HANDLE_4_DIRECTIONS">
                            4 Directions
                        </MenuItem>
                        <MenuItem value="HANDLE_36_DIRECTIONS">
                            36 Directions
                        </MenuItem>
                        <MenuItem value="HANDLE_6_POSITIONS">
                            6 Positions
                        </MenuItem>
                        <MenuItem value="HANDLE_5_POSITIONS">
                            5 Positions
                        </MenuItem>
                        <MenuItem value="HANDLE_8_POSITIONS">
                            8 Positions
                        </MenuItem>
                    </Select>
                </FormControl>

            </Stack>
        </Box>
    )
}

export default Info
