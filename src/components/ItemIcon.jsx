import { Button, Box, Tooltip, Typography } from "@mui/material"
import { Edit, Warning } from "@mui/icons-material"
import { useState, useEffect, useMemo } from "react"
import missingIcon from "../assets/missing.png"

// Check what required fields are missing from an item
function getMissingFields(item, hasIconError) {
    const missing = []

    // Check name
    if (!item.name?.trim()) {
        missing.push("Name")
    }

    // Check author
    if (!item.details?.Authors?.trim()) {
        missing.push("Author")
    }

    // Check icon (either no path or failed to load)
    if (!item.icon || hasIconError) {
        missing.push("Icon")
    }

    // Check description (can be string or object with desc_ keys)
    const desc = item.details?.Description
    let hasDescription = false
    if (desc) {
        if (typeof desc === "string") {
            hasDescription = desc.trim() !== ""
        } else if (typeof desc === "object") {
            hasDescription = Object.keys(desc)
                .filter((key) => key.startsWith("desc_"))
                .some((key) => desc[key] && desc[key].trim() !== "")
        }
    }
    if (!hasDescription) {
        missing.push("Description")
    }

    // Check instances (need at least one)
    const instanceCount = item.instances ? Object.keys(item.instances).length : 0
    if (instanceCount === 0) {
        missing.push("Instance")
    }

    // Check editor model - warn if no model selected AND no custom model generated
    if (!item.metadata?.hasCustomModel && !item.modelName) {
        missing.push("Editor Model")
    }

    return missing
}

function ItemIcon({ item, onEdit }) {
    const [imageSrc, setImageSrc] = useState(null)
    const [imageError, setImageError] = useState(false)

    useEffect(() => {
        if (item.icon) {
            window.package.loadFile(item.icon)
                .then(setImageSrc)
                .catch((error) => {
                    console.warn(
                        `Failed to load icon for item "${item.name}":`,
                        error,
                    )
                    setImageError(true)
                    setImageSrc(null)
                })
        } else {
            setImageSrc(null)
            setImageError(false)
        }
    }, [item.icon])

    const handleImageError = () => {
        setImageError(true)
    }

    // Calculate missing fields
    const missingFields = useMemo(
        () => getMissingFields(item, imageError || !imageSrc),
        [item, imageError, imageSrc]
    )

    const hasMissingFields = missingFields.length > 0

    return (
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <Tooltip
                title={
                    hasMissingFields
                        ? `Missing: ${missingFields.join(", ")}`
                        : item.name || "Unnamed Item"
                }
                placement="top"
                arrow
            >
                <Button
                    className="item-icon"
                    onClick={onEdit}
                    sx={{
                        width: 96,
                        height: 96,
                        minWidth: 96,
                        minHeight: 96,
                        padding: 0,
                        border: hasMissingFields ? "2px solid #f57c00" : "1px solid #444",
                        borderRadius: 1,
                        overflow: "hidden",
                        boxSizing: "border-box",
                        position: "relative",
                        "&.MuiButton-root": {
                            width: 96,
                            height: 96,
                            minWidth: 96,
                            minHeight: 96,
                        },
                        "&:hover": {
                            "& img": {
                                filter: "brightness(0.3)",
                            },
                            "& .edit-icon": {
                                opacity: 1,
                            },
                        },
                    }}>
                    <img
                        src={imageSrc || missingIcon}
                        alt={item.name}
                        onError={handleImageError}
                        style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            transition: "filter 0.2s ease",
                        }}
                    />

                    {/* Warning badge for missing fields */}
                    {hasMissingFields && (
                        <Box
                            sx={{
                                position: "absolute",
                                top: 4,
                                right: 4,
                                backgroundColor: "#f57c00",
                                borderRadius: "50%",
                                width: 20,
                                height: 20,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
                            }}>
                            <Warning sx={{ color: "white", fontSize: 14 }} />
                        </Box>
                    )}

                    <Box
                        className="edit-icon"
                        sx={{
                            position: "absolute",
                            top: "50%",
                            left: "50%",
                            transform: "translate(-50%, -50%)",
                            opacity: 0,
                            transition: "opacity 0.2s ease",
                            pointerEvents: "none",
                        }}>
                        <Edit sx={{ color: "white", fontSize: 32 }} />
                    </Box>
                </Button>
            </Tooltip>
        </Box>
    )
}

export default ItemIcon
