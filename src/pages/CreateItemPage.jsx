import { useState } from "react"
import {
    Box,
    Typography,
    TextField,
    Button,
    Alert,
    Stack,
} from "@mui/material"
import { CheckCircle, Close } from "@mui/icons-material"

function CreateItemPage() {
    const [itemName, setItemName] = useState("")
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)

    const handleCreate = async () => {
        setError("")
        setLoading(true)

        try {
            // Validate required fields
            if (!itemName.trim()) {
                throw new Error("Item name is required")
            }

            // Validate item name format
            if (!/^[a-zA-Z0-9_ ]+$/.test(itemName.trim())) {
                throw new Error(
                    "Item name can only contain letters, numbers, spaces, and underscores",
                )
            }

            // Call backend to create item
            const result = await window.electron.invoke("create-item-simple", {
                name: itemName.trim(),
            })

            if (result.success) {
                // Automatically open the item editor
                await window.electron.invoke("open-item-editor", result.item)
                // Window will be closed by the backend
                console.log(
                    `Created item "${itemName.trim()}" (${result.itemId})`,
                )
            }
        } catch (err) {
            setError(err.message || "Failed to create item")
        } finally {
            setLoading(false)
        }
    }

    const handleCancel = () => {
        window.close()
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
                    Create New Item
                </Typography>
            </Box>

            {/* Content */}
            <Box sx={{ flex: 1, overflow: "auto", p: 3 }}>
                <Stack spacing={3}>
                    {error && (
                        <Alert severity="error" onClose={() => setError("")}>
                            {error}
                        </Alert>
                    )}

                    <TextField
                        label="Item Name"
                        value={itemName}
                        onChange={(e) => setItemName(e.target.value)}
                        placeholder="My Custom Item"
                        fullWidth
                        required
                        autoFocus
                        disabled={loading}
                        helperText="Enter a name for your item (a unique ID will be generated automatically)"
                    />

                    <Alert severity="info">
                        The item will be created with default settings. You can
                        configure all other properties in the editor after
                        creation.
                    </Alert>
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
                        disabled={loading}
                        startIcon={<Close />}
                        sx={{ minWidth: 120 }}>
                        Cancel
                    </Button>
                    <Button
                        variant="contained"
                        color="primary"
                        onClick={handleCreate}
                        disabled={loading || !itemName.trim()}
                        startIcon={<CheckCircle />}
                        sx={{ minWidth: 120 }}>
                        {loading ? "Creating..." : "Create"}
                    </Button>
                </Stack>
            </Box>
        </Box>
    )
}

export default CreateItemPage
