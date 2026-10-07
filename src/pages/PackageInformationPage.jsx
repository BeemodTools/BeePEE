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
    InputAdornment,
    Tooltip,
} from "@mui/material"
import { CheckCircle, Close, LockOutlined } from "@mui/icons-material"
import BeePmFields from "../components/BeePmFields"
import {
    beePmName,
    nameProblem,
    newBeePmFields,
    savedBeePmFields,
    versionProblem,
} from "../utils/beePm"

/** A field that's set when the package is made */
function LockedField({ label, value, monospace = false, helperText, sx }) {
    return (
        <TextField
            label={label}
            value={value}
            disabled
            fullWidth
            helperText={helperText}
            sx={sx}
            slotProps={{
                input: {
                    sx: monospace ? { fontFamily: "monospace" } : undefined,
                    endAdornment: (
                        <InputAdornment position="end">
                            <Tooltip title="Set when the package was made">
                                <LockOutlined fontSize="small" />
                            </Tooltip>
                        </InputAdornment>
                    ),
                },
            }}
        />
    )
}

function PackageInformationPage() {
    const [name, setName] = useState("")
    const [description, setDescription] = useState("")
    const [packageId, setPackageId] = useState("")
    const [author, setAuthor] = useState("")
    const [beePm, setBeePm] = useState(() => newBeePmFields())
    // Whether it has a bee-package.json yet (its BeePM name is picked then)
    const [beePmExists, setBeePmExists] = useState(false)
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
                    setAuthor(result.info.author || "")
                    setBeePm(
                        result.beePackage ?? newBeePmFields(result.info.name),
                    )
                    setBeePmExists(!!result.beePackageExists)
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

    const handleNameChange = (newName) => {
        // Without a bee-package.json, the BeePM name follows the package's
        // until it's changed
        if (!beePmExists && (!beePm.name || beePm.name === beePmName(name))) {
            setBeePm({ ...beePm, name: beePmName(newName) })
        }
        setName(newName)
    }

    const handleSave = async () => {
        setError(null)
        setSuccess(false)
        setSaving(true)

        try {
            const result = await window.electron.invoke("update-package-info", {
                name,
                description,
                beePackage: savedBeePmFields(beePm),
            })

            if (result.success) {
                setSuccess(true)
                setBeePmExists(true)
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
                <Stack spacing={2.5}>
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

                    <LockedField label="Package ID" value={packageId} monospace />

                    <Stack direction="row" spacing={2}>
                        <TextField
                            label="Package Name"
                            value={name}
                            onChange={(e) => handleNameChange(e.target.value)}
                            placeholder="My Awesome Package"
                            required
                            disabled={saving}
                            helperText="A descriptive name for your package"
                            sx={{ flex: 3 }}
                        />
                        <LockedField
                            label="Author"
                            value={author || "Unknown"}
                            helperText="Can't be changed"
                            sx={{ flex: 2 }}
                        />
                    </Stack>

                    <TextField
                        label="Description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Adds custom items and styles to Portal 2"
                        fullWidth
                        multiline
                        rows={3}
                        disabled={saving}
                        helperText="What does this package add?"
                    />

                    <Divider />

                    <Box>
                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                            BeePM
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            For publishing it on BeePM, with the name and
                            description above.
                        </Typography>
                    </Box>

                    <BeePmFields
                        value={beePm}
                        onChange={(fields) => setBeePm(fields)}
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
                            !name.trim() ||
                            !!nameProblem(beePm.name) ||
                            !!versionProblem(beePm.version)
                        }
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
