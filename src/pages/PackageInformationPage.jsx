import { useState, useEffect } from "react"
import {
    Box,
    Typography,
    TextField,
    Button,
    Stack,
    Alert,
    CircularProgress,
} from "@mui/material"
import { CheckCircle, Close } from "@mui/icons-material"

function PackageInformationPage() {
    const [name, setName] = useState("")
    const [description, setDescription] = useState("")
    const [packageId, setPackageId] = useState("")
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState(null)
    const [success, setSuccess] = useState(false)

    useEffect(() => {
        // Load current package information
        const loadPackageInfo = async () => {
            try {
                setLoading(true)
                const result = await window.electron.invoke("get-package-info")

                if (result.success) {
                    setPackageId(result.info.id || "")
                    setName(result.info.name || "")
                    setDescription(result.info.description || "")
                } else {
                    setError(
                        result.error || "Failed to load package information",
                    )
                }
            } catch (err) {
                console.error("Failed to load package info:", err)
                setError(err.message || "Failed to load package information")
            } finally {
                setLoading(false)
            }
        }

        loadPackageInfo()
    }, [])

    const handleSave = async () => {
        setError(null)
        setSuccess(false)
        setSaving(true)

        try {
            const result = await window.electron.invoke("update-package-info", {
                name,
                description,
            })

            if (result.success) {
                setSuccess(true)
                console.log(`Updated package info for "${name}"`)

                // Close window after a short delay
                setTimeout(() => {
                    window.close()
                }, 1000)
            } else {
                setError(result.error || "Failed to update package information")
            }
        } catch (err) {
            console.error("Failed to update package info:", err)
            setError(err.message || "Failed to update package information")
        } finally {
            setSaving(false)
        }
    }

    const handleCancel = () => {
        window.close()
    }

    if (loading) {
        return (
            <Box
                sx={{
                    height: "100vh",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    bgcolor: "background.default",
                }}>
                <CircularProgress />
            </Box>
        )
    }

    return (
        <Box
            sx={{
                height: "100vh",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                bgcolor: "background.default",
            }}>
            {/* Header */}
            <Box
                sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    px: 2,
                    py: 1.5,
                    borderBottom: 1,
                    borderColor: "divider",
                    bgcolor: "background.paper",
                }}>
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                    Package Information
                </Typography>
            </Box>

            {/* Content */}
            <Box sx={{ flex: 1, overflow: "auto", p: 3 }}>
                <Stack spacing={3}>
                    {error && (
                        <Alert severity="error" onClose={() => setError(null)}>
                            {error}
                        </Alert>
                    )}

                    {success && (
                        <Alert severity="success">
                            Package information updated successfully!
                        </Alert>
                    )}

                    <TextField
                        label="Package ID"
                        value={packageId}
                        fullWidth
                        disabled
                        helperText="Package ID cannot be changed"
                        InputProps={{
                            sx: { fontFamily: "monospace" },
                        }}
                    />

                    <TextField
                        label="Package Name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="My Awesome Package"
                        fullWidth
                        required
                        disabled={saving}
                        helperText="A descriptive name for your package"
                    />

                    <TextField
                        label="Description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Adds custom items and styles to Portal 2"
                        fullWidth
                        multiline
                        rows={4}
                        disabled={saving}
                        helperText="What does this package add?"
                    />
                </Stack>
            </Box>

            {/* Footer */}
            <Box
                sx={{
                    p: 2,
                    borderTop: 1,
                    borderColor: "divider",
                    bgcolor: "background.paper",
                }}>
                <Stack direction="row" spacing={1} justifyContent="flex-end">
                    <Button
                        variant="outlined"
                        onClick={handleCancel}
                        disabled={saving}
                        startIcon={<Close />}
                        sx={{ minWidth: 120 }}>
                        Cancel
                    </Button>
                    <Button
                        variant="contained"
                        color="primary"
                        onClick={handleSave}
                        disabled={saving || !name.trim()}
                        startIcon={<CheckCircle />}
                        sx={{ minWidth: 120 }}>
                        {saving ? "Saving..." : "Save"}
                    </Button>
                </Stack>
            </Box>
        </Box>
    )
}

export default PackageInformationPage
