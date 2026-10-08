import {
    Dialog,
    DialogContent,
    Box,
    Typography,
    LinearProgress,
    CircularProgress,
    Button,
} from "@mui/material"
import CloseIcon from "@mui/icons-material/Close"
import BugReportIcon from "@mui/icons-material/BugReport"
import { useState, useEffect } from "react"

function LoadingPopup({
    open,
    progress = 0,
    message = "Loading...",
    error = null,
    onClose,
    onReport,
}) {
    const [showSpinner, setShowSpinner] = useState(false)

    // Show spinner if progress is stuck at 0 or 100 for too long
    useEffect(() => {
        if (progress === 0 || progress === 100) {
            const timer = setTimeout(() => setShowSpinner(true), 2000)
            return () => clearTimeout(timer)
        } else {
            setShowSpinner(false)
        }
    }, [progress])

    return (
        <Dialog
            open={open}
            maxWidth="sm"
            fullWidth
            PaperProps={{
                sx: {
                    bgcolor: "#1e1e1e",
                    color: "white",
                    minHeight: "200px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                },
            }}>
            <DialogContent>
                <Box
                    sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 3,
                        py: 2,
                    }}>
                    {/* Spinner, Progress, or Error Icon */}
                    <Box
                        sx={{
                            position: "relative",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                        }}>
                        {error ? (
                            // Error state: Red circle with X
                            <Box
                                sx={{
                                    position: "relative",
                                    display: "inline-flex",
                                }}>
                                <CircularProgress
                                    variant="determinate"
                                    value={100}
                                    size={60}
                                    sx={{
                                        color: "#ff4444",
                                        "& .MuiCircularProgress-circle": {
                                            stroke: "#ff4444",
                                        },
                                    }}
                                />
                                <Box
                                    sx={{
                                        top: 0,
                                        left: 0,
                                        bottom: 0,
                                        right: 0,
                                        position: "absolute",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                    }}>
                                    <CloseIcon
                                        sx={{
                                            color: "#ff4444",
                                            fontSize: 30,
                                            fontWeight: "bold",
                                        }}
                                    />
                                </Box>
                            </Box>
                        ) : showSpinner ? (
                            <CircularProgress
                                size={60}
                                sx={{ color: "primary.main" }}
                            />
                        ) : (
                            <Box
                                sx={{
                                    position: "relative",
                                    display: "inline-flex",
                                }}>
                                <CircularProgress
                                    variant="determinate"
                                    value={progress}
                                    size={60}
                                    sx={{ color: "primary.main" }}
                                />
                                <Box
                                    sx={{
                                        top: 0,
                                        left: 0,
                                        bottom: 0,
                                        right: 0,
                                        position: "absolute",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                    }}>
                                    <Typography
                                        variant="caption"
                                        component="div"
                                        color="white"
                                        sx={{
                                            fontSize: "0.75rem",
                                            fontWeight: "bold",
                                        }}>
                                        {`${Math.round(progress)}%`}
                                    </Typography>
                                </Box>
                            </Box>
                        )}
                    </Box>

                    {/* Message */}
                    <Typography
                        variant="h6"
                        align="center"
                        sx={{ color: "white", fontWeight: "medium" }}>
                        {message}
                    </Typography>

                    {/* Progress Bar */}
                    <Box sx={{ width: "100%", maxWidth: 400 }}>
                        <LinearProgress
                            variant="determinate"
                            value={error ? 100 : progress}
                            sx={{
                                height: 8,
                                borderRadius: 4,
                                bgcolor: error
                                    ? "rgba(255,0,0,0.2)"
                                    : "rgba(255,255,255,0.1)",
                                "& .MuiLinearProgress-bar": {
                                    borderRadius: 4,
                                    bgcolor: error ? "#ff4444" : undefined,
                                },
                            }}
                        />
                    </Box>

                    {/* Error Message or Additional Info */}
                    {error ? (
                        <Box
                            sx={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                gap: 2,
                            }}>
                            <Typography
                                variant="body2"
                                align="center"
                                sx={{
                                    color: "#ff6666",
                                    fontSize: "0.875rem",
                                    fontWeight: "medium",
                                    maxWidth: 400,
                                    wordBreak: "break-word",
                                }}>
                                {error}
                            </Typography>
                            <Box sx={{ display: "flex", gap: 1.5 }}>
                                {onReport && (
                                    <Button
                                        variant="outlined"
                                        startIcon={<BugReportIcon />}
                                        onClick={onReport}
                                        sx={{
                                            color: "white",
                                            borderColor: "rgba(255,255,255,0.5)",
                                            "&:hover": {
                                                borderColor: "white",
                                                backgroundColor:
                                                    "rgba(255,255,255,0.08)",
                                            },
                                        }}>
                                        Report
                                    </Button>
                                )}
                                <Button
                                    variant="outlined"
                                    onClick={onClose}
                                    sx={{
                                        color: "#ff6666",
                                        borderColor: "#ff6666",
                                        "&:hover": {
                                            borderColor: "#ff8888",
                                            backgroundColor:
                                                "rgba(255,102,102,0.1)",
                                        },
                                    }}>
                                    Close
                                </Button>
                            </Box>
                        </Box>
                    ) : (
                        <Typography
                            variant="body2"
                            align="center"
                            sx={{
                                color: "rgba(255,255,255,0.7)",
                                fontSize: "0.875rem",
                            }}>
                            Please wait while we process your package...
                        </Typography>
                    )}
                </Box>
            </DialogContent>
        </Dialog>
    )
}

export default LoadingPopup
