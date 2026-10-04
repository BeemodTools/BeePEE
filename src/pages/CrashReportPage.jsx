import { useState, useEffect } from "react"
import {
    Box,
    TextField,
    Button,
    Alert,
    Typography,
    CircularProgress,
    Collapse,
} from "@mui/material"
import BugReportIcon from "@mui/icons-material/BugReport"
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import UpdateIcon from "@mui/icons-material/SystemUpdateAlt"

export default function CrashReportPage() {
    const [errorDetails, setErrorDetails] = useState(null)
    const [isManual, setIsManual] = useState(true)
    const [userDescription, setUserDescription] = useState("")
    const [contact, setContact] = useState("")
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [submitResult, setSubmitResult] = useState(null)
    const [hasSubmitted, setHasSubmitted] = useState(false)
    const [showStack, setShowStack] = useState(false)
    const [updateInfo, setUpdateInfo] = useState(null)

    useEffect(() => {
        if (!window.package) return
        window.package.onCrashReportData((data) => {
            setErrorDetails(data.errorDetails)
            setIsManual(data.isManual)
        })
        // Check if the app needs an update - block reports on outdated versions
        window.package.isUpdateAvailable?.().then((result) => {
            if (result?.updateAvailable) {
                setUpdateInfo(result)
            }
        }).catch(() => {})
    }, [])

    const handleSubmit = async () => {
        setIsSubmitting(true)
        setSubmitResult(null)

        try {
            const result = await window.package.submitCrashReport(
                userDescription,
                errorDetails,
                contact,
            )
            setSubmitResult(result)
            if (result.success) {
                setHasSubmitted(true)
                setTimeout(() => window.close(), 2000)
            }
        } catch (err) {
            setSubmitResult({ success: false, error: err.message })
        } finally {
            setIsSubmitting(false)
        }
    }

    const handleCancel = () => {
        window.close()
    }

    return (
        <Box
            sx={{
                display: "flex",
                flexDirection: "column",
                height: "100vh",
                bgcolor: "#1e1e1e",
                color: "white",
            }}
        >
            {/* Header */}
            <Box
                sx={{
                    display: "flex",
                    alignItems: "center",
                    px: 3,
                    pt: 2.5,
                    pb: 1,
                }}
            >
                {isManual ? (
                    <BugReportIcon sx={{ mr: 1, fontSize: 28 }} />
                ) : (
                    <ErrorOutlineIcon sx={{ mr: 1, fontSize: 28, color: "#ff6666" }} />
                )}
                <Typography variant="h6" fontWeight="bold">
                    {isManual ? "Report a Bug" : "Unexpected Error"}
                </Typography>
            </Box>

            {/* Content */}
            <Box
                sx={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    px: 3,
                    py: 1.5,
                    overflow: "auto",
                }}
            >
                {/* Error details (for auto-triggered reports) */}
                {errorDetails && (
                    <Box>
                        <Alert
                            severity="error"
                            sx={{
                                bgcolor: "rgba(255,68,68,0.1)",
                                color: "#ff6666",
                                "& .MuiAlert-icon": { color: "#ff6666" },
                            }}
                        >
                            {errorDetails.message || "An unknown error occurred"}
                        </Alert>

                        {errorDetails.stack && (
                            <Box sx={{ mt: 1 }}>
                                <Button
                                    size="small"
                                    onClick={() => setShowStack(!showStack)}
                                    endIcon={
                                        showStack ? <ExpandLessIcon /> : <ExpandMoreIcon />
                                    }
                                    sx={{
                                        textTransform: "none",
                                        color: "rgba(255,255,255,0.6)",
                                        p: 0,
                                        minWidth: 0,
                                    }}
                                >
                                    <Typography variant="caption">
                                        {showStack ? "Hide" : "Show"} technical details
                                    </Typography>
                                </Button>
                                <Collapse in={showStack}>
                                    <Box
                                        sx={{
                                            mt: 1,
                                            p: 1.5,
                                            bgcolor: "rgba(0,0,0,0.3)",
                                            borderRadius: 1,
                                            maxHeight: 150,
                                            overflow: "auto",
                                        }}
                                    >
                                        <Typography
                                            variant="caption"
                                            sx={{
                                                fontFamily: "monospace",
                                                fontSize: "0.7rem",
                                                color: "rgba(255,255,255,0.7)",
                                                whiteSpace: "pre-wrap",
                                                wordBreak: "break-all",
                                            }}
                                        >
                                            {errorDetails.stack}
                                        </Typography>
                                    </Box>
                                </Collapse>
                            </Box>
                        )}
                    </Box>
                )}

                {/* Update required warning */}
                {updateInfo && (
                    <Alert
                        icon={<UpdateIcon />}
                        severity="warning"
                        sx={{
                            bgcolor: "rgba(255,152,0,0.1)",
                            color: "#ffb74d",
                            "& .MuiAlert-icon": { color: "#ffb74d" },
                        }}
                    >
                        A newer version ({updateInfo.latestVersion}) is available.
                        Please update BeePEE before submitting a report - your
                        issue may already be fixed.
                    </Alert>
                )}

                {/* User description field */}
                <TextField
                    label={isManual ? "What's wrong?" : "What were you doing when this happened?"}
                    multiline
                    rows={4}
                    value={userDescription}
                    onChange={(e) => setUserDescription(e.target.value)}
                    fullWidth
                    placeholder={
                        isManual
                            ? "Describe the issue you're experiencing..."
                            : "Describe the action that caused the error..."
                    }
                    disabled={isSubmitting || !!updateInfo}
                    sx={{
                        "& .MuiOutlinedInput-root": {
                            color: "white",
                            "& fieldset": { borderColor: "rgba(255,255,255,0.3)" },
                            "&:hover fieldset": { borderColor: "rgba(255,255,255,0.5)" },
                            "&.Mui-focused fieldset": { borderColor: "primary.main" },
                        },
                        "& .MuiInputLabel-root": { color: "rgba(255,255,255,0.7)" },
                        "& .MuiInputLabel-root.Mui-focused": { color: "primary.main" },
                    }}
                />

                {/* Optional contact for follow-up questions */}
                <TextField
                    label="Discord username (optional)"
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    fullWidth
                    size="small"
                    placeholder="So we can reach you if we have questions"
                    disabled={isSubmitting || !!updateInfo}
                    sx={{
                        "& .MuiOutlinedInput-root": {
                            color: "white",
                            "& fieldset": { borderColor: "rgba(255,255,255,0.3)" },
                            "&:hover fieldset": { borderColor: "rgba(255,255,255,0.5)" },
                            "&.Mui-focused fieldset": { borderColor: "primary.main" },
                        },
                        "& .MuiInputLabel-root": { color: "rgba(255,255,255,0.7)" },
                        "& .MuiInputLabel-root.Mui-focused": { color: "primary.main" },
                    }}
                />

                <Typography
                    variant="caption"
                    sx={{ color: "rgba(255,255,255,0.5)" }}
                >
                    Please be as descriptive as possible - it helps a lot! Your logs and current package will be included automatically (with your user name, PC name and other personal details taken out).
                </Typography>

                {/* Submission result feedback */}
                {submitResult && (
                    <Alert
                        severity={submitResult.success ? "success" : "error"}
                        sx={{
                            bgcolor: submitResult.success
                                ? "rgba(76,175,80,0.1)"
                                : "rgba(255,68,68,0.1)",
                            color: submitResult.success ? "#81c784" : "#ff6666",
                            "& .MuiAlert-icon": {
                                color: submitResult.success ? "#81c784" : "#ff6666",
                            },
                        }}
                    >
                        {submitResult.success
                            ? "Report sent successfully. Thank you!"
                            : submitResult.reason === "No endpoint configured"
                              ? "Bug reporting is not configured. Please contact the developer."
                              : `Failed to send report: ${submitResult.error || submitResult.reason}`}
                    </Alert>
                )}
            </Box>

            {/* Footer actions */}
            <Box
                sx={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 1,
                    px: 3,
                    py: 2,
                    borderTop: "1px solid rgba(255,255,255,0.1)",
                }}
            >
                <Button
                    onClick={handleCancel}
                    disabled={isSubmitting}
                    sx={{ color: "rgba(255,255,255,0.7)" }}
                >
                    Cancel
                </Button>
                <Button
                    onClick={handleSubmit}
                    variant="contained"
                    disabled={isSubmitting || hasSubmitted || !userDescription.trim() || !!updateInfo}
                    startIcon={
                        isSubmitting ? (
                            <CircularProgress size={16} color="inherit" />
                        ) : null
                    }
                >
                    {isSubmitting ? "Sending..." : "Send Report"}
                </Button>
            </Box>
        </Box>
    )
}
