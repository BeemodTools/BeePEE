import { useState, useEffect } from "react"
import {
    Snackbar,
    Alert,
    Button,
    LinearProgress,
    Box,
    Typography,
    Collapse,
    List,
    ListItem,
    ListItemText,
    IconButton,
} from "@mui/material"
import DownloadIcon from "@mui/icons-material/Download"
import UpdateIcon from "@mui/icons-material/Update"
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import ExpandLessIcon from "@mui/icons-material/ExpandLess"

export default function UpdateNotification() {
    const [updateStatus, setUpdateStatus] = useState(null)
    const [open, setOpen] = useState(false)
    const [downloadProgress, setDownloadProgress] = useState(0)
    const [showErrorDetails, setShowErrorDetails] = useState(false)

    useEffect(() => {
        // Listen for update status events
        window.package.onUpdateStatus((data) => {
            setUpdateStatus(data)

            // Show notification for relevant events
            if (
                data.status === "update-available" ||
                data.status === "update-downloaded" ||
                data.status === "update-error" ||
                data.status === "download-progress"
            ) {
                setOpen(true)
            }

            // Update download progress
            if (data.status === "download-progress") {
                setDownloadProgress(Math.round(data.data.percent))
            }
        })
    }, [])

    const handleClose = (event, reason) => {
        if (reason === "clickaway") {
            return
        }
        setOpen(false)
    }

    const handleDownload = () => {
        window.package.downloadUpdate()
        setOpen(false)
    }

    const handleInstall = () => {
        window.package.quitAndInstall()
    }

    const formatBytes = (bytes) => {
        if (!bytes) return "0 B"
        const k = 1024
        const sizes = ["B", "KB", "MB", "GB"]
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
    }

    const formatSpeed = (bytesPerSecond) => {
        if (!bytesPerSecond) return "0 B/s"
        return formatBytes(bytesPerSecond) + "/s"
    }

    const estimateTimeRemaining = (transferred, total, bytesPerSecond) => {
        if (!bytesPerSecond || bytesPerSecond === 0) return "Calculating..."
        const remaining = total - transferred
        const secondsRemaining = Math.ceil(remaining / bytesPerSecond)
        
        if (secondsRemaining < 60) {
            return `${secondsRemaining} seconds`
        } else if (secondsRemaining < 3600) {
            const minutes = Math.ceil(secondsRemaining / 60)
            return `${minutes} minute${minutes > 1 ? "s" : ""}`
        } else {
            const hours = Math.ceil(secondsRemaining / 3600)
            return `${hours} hour${hours > 1 ? "s" : ""}`
        }
    }

    if (!updateStatus) return null

    // Render different alerts based on update status
    switch (updateStatus.status) {
        case "checking-for-update":
            return (
                <Snackbar
                    open={open}
                    autoHideDuration={3000}
                    onClose={handleClose}
                    anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                >
                    <Alert
                        onClose={handleClose}
                        severity="info"
                        icon={<UpdateIcon />}
                    >
                        <Typography variant="body2">
                            Checking for updates...
                        </Typography>
                        <Typography variant="caption" sx={{ opacity: 0.8 }}>
                            This will only take a moment
                        </Typography>
                    </Alert>
                </Snackbar>
            )

        case "update-available":
            return (
                <Snackbar
                    open={open}
                    onClose={handleClose}
                    anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                >
                    <Alert
                        onClose={handleClose}
                        severity="info"
                        icon={<DownloadIcon />}
                        action={
                            <Button
                                color="inherit"
                                size="small"
                                onClick={handleDownload}
                            >
                                Download
                            </Button>
                        }
                    >
                        <Typography variant="body2" fontWeight="bold">
                            Update Available: v{updateStatus.data.version}
                        </Typography>
                        <Typography variant="caption">
                            A new version is ready to download
                        </Typography>
                    </Alert>
                </Snackbar>
            )

        case "download-started":
            return (
                <Snackbar
                    open={open}
                    onClose={handleClose}
                    anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                >
                    <Alert
                        onClose={handleClose}
                        severity="info"
                        icon={<DownloadIcon />}
                    >
                        <Typography variant="body2" fontWeight="bold">
                            Starting download...
                        </Typography>
                        <Typography variant="caption" sx={{ opacity: 0.8 }}>
                            Download progress will appear shortly
                        </Typography>
                    </Alert>
                </Snackbar>
            )

        case "download-progress":
            return (
                <Snackbar
                    open={open}
                    anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                >
                    <Alert
                        onClose={handleClose}
                        severity="info"
                        icon={<DownloadIcon />}
                        sx={{ minWidth: 350 }}
                    >
                        <Typography variant="body2" fontWeight="bold">
                            Downloading Update
                        </Typography>
                        <Box sx={{ width: "100%", mt: 1 }}>
                            <LinearProgress
                                variant="determinate"
                                value={downloadProgress}
                            />
                            <Box
                                sx={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    mt: 0.5,
                                }}
                            >
                                <Typography variant="caption">
                                    {downloadProgress}% -{" "}
                                    {formatBytes(updateStatus.data.transferred)}{" "}
                                    of {formatBytes(updateStatus.data.total)}
                                </Typography>
                                <Typography variant="caption">
                                    {formatSpeed(
                                        updateStatus.data.bytesPerSecond
                                    )}
                                </Typography>
                            </Box>
                            <Typography
                                variant="caption"
                                sx={{
                                    display: "block",
                                    mt: 0.25,
                                    opacity: 0.7,
                                }}
                            >
                                Estimated time:{" "}
                                {estimateTimeRemaining(
                                    updateStatus.data.transferred,
                                    updateStatus.data.total,
                                    updateStatus.data.bytesPerSecond
                                )}
                            </Typography>
                        </Box>
                    </Alert>
                </Snackbar>
            )

        case "update-downloaded":
            return (
                <Snackbar
                    open={open}
                    onClose={handleClose}
                    anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                >
                    <Alert
                        onClose={handleClose}
                        severity="success"
                        icon={<UpdateIcon />}
                        action={
                            <Button
                                color="inherit"
                                size="small"
                                onClick={handleInstall}
                            >
                                Restart
                            </Button>
                        }
                    >
                        <Typography variant="body2" fontWeight="bold">
                            Update Ready: v{updateStatus.data.version}
                        </Typography>
                        <Typography variant="caption">
                            Restart to install the update
                        </Typography>
                    </Alert>
                </Snackbar>
            )

        case "update-not-available":
            return (
                <Snackbar
                    open={open}
                    autoHideDuration={4000}
                    onClose={handleClose}
                    anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                >
                    <Alert
                        onClose={handleClose}
                        severity="success"
                        icon={<UpdateIcon />}
                    >
                        <Typography variant="body2" fontWeight="bold">
                            You're up to date! 🎉
                        </Typography>
                        <Typography variant="caption" sx={{ opacity: 0.8 }}>
                            No updates available at this time
                        </Typography>
                    </Alert>
                </Snackbar>
            )

        case "update-error":
            return (
                <Snackbar
                    open={open}
                    autoHideDuration={null}
                    onClose={handleClose}
                    anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                >
                    <Alert
                        onClose={handleClose}
                        severity="error"
                        icon={<ErrorOutlineIcon />}
                        sx={{ minWidth: 350, maxWidth: 500 }}
                    >
                        <Box>
                            <Typography variant="body2" fontWeight="bold">
                                Update Failed
                            </Typography>
                            <Typography
                                variant="body2"
                                sx={{ mt: 0.5, mb: 1 }}
                            >
                                {updateStatus.data.message}
                            </Typography>

                            {/* Troubleshooting tips */}
                            {updateStatus.data.troubleshooting &&
                                updateStatus.data.troubleshooting.length >
                                    0 && (
                                    <Box sx={{ mt: 1 }}>
                                        <Typography
                                            variant="caption"
                                            fontWeight="bold"
                                            sx={{ display: "block", mb: 0.5 }}
                                        >
                                            What to try:
                                        </Typography>
                                        <List
                                            dense
                                            sx={{
                                                py: 0,
                                                "& .MuiListItem-root": {
                                                    py: 0.25,
                                                    px: 0,
                                                },
                                            }}
                                        >
                                            {updateStatus.data.troubleshooting.map(
                                                (tip, index) => (
                                                    <ListItem key={index}>
                                                        <ListItemText
                                                            primary={`• ${tip}`}
                                                            primaryTypographyProps={{
                                                                variant:
                                                                    "caption",
                                                            }}
                                                        />
                                                    </ListItem>
                                                )
                                            )}
                                        </List>
                                    </Box>
                                )}

                            {/* Technical details toggle */}
                            {updateStatus.data.technicalDetails && (
                                <Box sx={{ mt: 1 }}>
                                    <Button
                                        size="small"
                                        onClick={() =>
                                            setShowErrorDetails(
                                                !showErrorDetails
                                            )
                                        }
                                        endIcon={
                                            showErrorDetails ? (
                                                <ExpandLessIcon />
                                            ) : (
                                                <ExpandMoreIcon />
                                            )
                                        }
                                        sx={{
                                            textTransform: "none",
                                            p: 0,
                                            minWidth: 0,
                                        }}
                                    >
                                        <Typography variant="caption">
                                            {showErrorDetails
                                                ? "Hide"
                                                : "Show"}{" "}
                                            technical details
                                        </Typography>
                                    </Button>
                                    <Collapse in={showErrorDetails}>
                                        <Box
                                            sx={{
                                                mt: 1,
                                                p: 1,
                                                backgroundColor:
                                                    "rgba(0, 0, 0, 0.1)",
                                                borderRadius: 1,
                                                wordBreak: "break-word",
                                            }}
                                        >
                                            <Typography
                                                variant="caption"
                                                sx={{
                                                    fontFamily: "monospace",
                                                    fontSize: "0.7rem",
                                                }}
                                            >
                                                {
                                                    updateStatus.data
                                                        .technicalDetails
                                                }
                                            </Typography>
                                        </Box>
                                    </Collapse>
                                </Box>
                            )}
                        </Box>
                    </Alert>
                </Snackbar>
            )

        default:
            return null
    }
}
