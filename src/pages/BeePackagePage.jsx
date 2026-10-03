import { useState, useEffect } from "react"
import {
    Box,
    Typography,
    TextField,
    Button,
    Stack,
    Alert,
    CircularProgress,
    Divider,
} from "@mui/material"
import { CheckCircle, Close, Info } from "@mui/icons-material"

function BeePackagePage() {
    const [id, setId] = useState("")
    const [name, setName] = useState("")
    const [author, setAuthor] = useState("")
    const [version, setVersion] = useState("1.0.0")
    const [compatibleWith, setCompatibleWith] = useState(">=2.4.41")
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
                    setId(result.info.id || "")
                    setName(result.info.name || "")
                    setAuthor(result.info.author || "")
                    setVersion(result.info.version || "1.0.0")
                    setCompatibleWith(result.info.compatibleWith || ">=2.4.41")
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
            const result = await window.package.saveBeePackageInfo({
                id,
                name,
                author,
                version,
                compatibleWith,
            })

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
                <Stack spacing={2.5}>
                    {error && (
                        <Alert severity="error" onClose={() => setError(null)}>
                            {error}
                        </Alert>
                    )}

                    {success && (
                        <Alert severity="success">
                            bee-package.json saved successfully!
                        </Alert>
                    )}

                    <Alert severity="info" icon={<Info />}>
                        This file is used by BeePM to identify your package.
                        Fill in the required fields below.
                    </Alert>

                    <TextField
                        label="Package ID"
                        value={id}
                        onChange={(e) =>
                            setId(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))
                        }
                        placeholder="MY_PACKAGE_ID"
                        fullWidth
                        required
                        disabled={saving}
                        helperText="Uppercase, alphanumeric + underscores only"
                        InputProps={{
                            sx: { fontFamily: "monospace" },
                        }}
                    />

                    <TextField
                        label="Display Name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="My Awesome Package"
                        fullWidth
                        required
                        disabled={saving}
                        helperText="Human-readable name (letters, numbers, spaces)"
                    />

                    <TextField
                        label="Author"
                        value={author}
                        onChange={(e) =>
                            setAuthor(e.target.value.replace(/[^a-zA-Z0-9]/g, ""))
                        }
                        placeholder="GitHubUsername"
                        fullWidth
                        required
                        disabled={saving}
                        helperText="Your GitHub username (alphanumeric only)"
                    />

                    <Divider />

                    <TextField
                        label="Version"
                        value={version}
                        onChange={(e) => setVersion(e.target.value)}
                        placeholder="1.0.0"
                        fullWidth
                        required
                        disabled={saving}
                        helperText="Semantic version (e.g., 1.0.0, 2.1.3)"
                    />

                    <TextField
                        label="Compatible With"
                        value={compatibleWith}
                        onChange={(e) => setCompatibleWith(e.target.value)}
                        placeholder=">=2.4.41"
                        fullWidth
                        disabled={saving}
                        helperText="BEE2 version specifier (e.g., >=2.4.41, ^2.4.46)"
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
                            !id.trim() ||
                            !name.trim() ||
                            !author.trim() ||
                            !version.trim()
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
