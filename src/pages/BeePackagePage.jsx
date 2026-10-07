import { useState, useEffect } from "react"
import {
    Box,
    Typography,
    Button,
    Stack,
    Alert,
    CircularProgress,
} from "@mui/material"
import { CheckCircle, Close } from "@mui/icons-material"
import BeePmFields from "../components/BeePmFields"
import {
    nameProblem,
    newBeePmFields,
    savedBeePmFields,
    versionProblem,
} from "../utils/beePm"

function BeePackagePage() {
    const [fields, setFields] = useState(() => newBeePmFields())
    const [packageId, setPackageId] = useState("")
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState(null)
    const [success, setSuccess] = useState(false)
    const [fileExists, setFileExists] = useState(false)

    useEffect(() => {
        const loadBeePackageInfo = async () => {
            try {
                setLoading(true)
                const result = await window.package.getBeePackageInfo()

                if (result.success) {
                    setFields(result.info)
                    setPackageId(result.packageId || "")
                    setFileExists(result.exists)
                } else {
                    setError(result.error || "Failed to load bee-package info")
                }
            } catch (err) {
                console.error("Failed to load bee-package info:", err)
                setError(err.message || "Failed to load bee-package info")
            } finally {
                setLoading(false)
            }
        }

        loadBeePackageInfo()
    }, [])

    const handleSave = async () => {
        setError(null)
        setSuccess(false)
        setSaving(true)

        try {
            const result = await window.package.saveBeePackageInfo(
                savedBeePmFields(fields),
            )

            if (result.success) {
                setSuccess(true)
                setFileExists(true)

                // Close window after a short delay
                setTimeout(() => {
                    window.close()
                }, 1000)
            } else {
                setError(result.error || "Failed to save bee-package.json")
            }
        } catch (err) {
            console.error("Failed to save bee-package info:", err)
            setError(err.message || "Failed to save bee-package.json")
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
                    BeePM Package Info
                </Typography>
                {!fileExists && (
                    <Typography variant="caption" color="warning.main">
                        File will be created on save
                    </Typography>
                )}
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
                        <Alert severity="success">Saved bee-package.json</Alert>
                    )}

                    <Typography variant="body2" color="text.secondary">
                        For publishing it on BeePM. Its name and description
                        there come from Edit &gt; Package Information.
                    </Typography>

                    <BeePmFields
                        value={fields}
                        onChange={(changed) => setFields(changed)}
                        disabled={saving}
                        packageId={packageId}
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
                        disabled={
                            saving ||
                            !!nameProblem(fields.name) ||
                            !!versionProblem(fields.version)
                        }
                        startIcon={<CheckCircle />}
                        sx={{ minWidth: 120 }}>
                        {saving ? "Saving..." : fileExists ? "Save" : "Create"}
                    </Button>
                </Stack>
            </Box>
        </Box>
    )
}

export default BeePackagePage
