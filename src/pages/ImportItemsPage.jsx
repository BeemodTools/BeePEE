import { useState, useEffect, useMemo } from "react"
import { useGridColumns } from "../utils/useGridColumns"
import {
    Box,
    Button,
    Typography,
    Tooltip,
    IconButton,
    Badge,
    CircularProgress,
    Alert,
    Stack,
} from "@mui/material"
import {
    Inventory2 as ItemsIcon,
    Image as SignagesIcon,
    Download,
    Close,
    Check,
} from "@mui/icons-material"

// Mirrors the main window: 56px icon sidebar (Items / Signages), a browser
// style grid of 96px tiles in the content area, and an editor-style footer.
// Opened via File > Import from Package... in its own window.

function ImportTile({ entry, checked, onToggle }) {
    return (
        <Tooltip
            title={
                entry.exists
                    ? `${entry.name} - already in this package`
                    : entry.name
            }
            placement="top"
            arrow>
            <Box
                onClick={() => !entry.exists && onToggle(entry.id)}
                sx={{
                    width: 96,
                    height: 96,
                    minWidth: 96,
                    border: checked ? "2px solid" : "1px solid #444",
                    borderColor: checked ? "primary.main" : "#444",
                    borderRadius: 1,
                    boxSizing: "border-box",
                    overflow: "hidden",
                    position: "relative",
                    cursor: entry.exists ? "default" : "pointer",
                    opacity: entry.exists ? 0.35 : 1,
                    bgcolor: "background.default",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    "&:hover": entry.exists
                        ? {}
                        : {
                              "& img": { filter: "brightness(0.5)" },
                              borderColor: "primary.main",
                          },
                }}>
                {entry.icon ? (
                    <img
                        src={entry.icon}
                        alt={entry.name}
                        style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            transition: "filter 0.2s ease",
                        }}
                    />
                ) : (
                    <ItemsIcon sx={{ fontSize: 32, color: "text.disabled" }} />
                )}
                {checked && (
                    <Box
                        sx={{
                            position: "absolute",
                            top: 4,
                            right: 4,
                            bgcolor: "primary.main",
                            borderRadius: "50%",
                            width: 20,
                            height: 20,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
                        }}>
                        <Check
                            sx={{ color: "background.default", fontSize: 14 }}
                        />
                    </Box>
                )}
            </Box>
        </Tooltip>
    )
}

const TABS = [
    { id: "items", label: "Items", icon: ItemsIcon },
    { id: "signages", label: "Signages", icon: SignagesIcon },
]


function ImportItemsPage() {
    const [phase, setPhase] = useState("loading") // loading | pick | importing
    const [manifest, setManifest] = useState(null)
    const [selected, setSelected] = useState(new Set())
    const [error, setError] = useState(null)
    const [activeTab, setActiveTab] = useState(0)
    // The empty cells fill the last row (and one more), like the browsers
    const [gridRef, gridCols] = useGridColumns(7)

    useEffect(() => {
        document.title = "BeePEE - Import from Package"

        // The backend already picked + extracted the package before opening
        // this window - just fetch the prepared manifest (idempotent, so
        // StrictMode's double mount is harmless)
        const fetchManifest = async () => {
            try {
                const r = await window.package.importItemsGetManifest()
                if (!r?.success) {
                    setError(r?.error || "Failed to read that package")
                    setPhase("pick")
                    return
                }
                setManifest(r)
                // Start on whichever tab actually has content
                if (!(r.items || []).length && (r.signages || []).length) {
                    setActiveTab(1)
                }
                setPhase("pick")
            } catch (err) {
                setError(err.message)
                setPhase("pick")
            }
        }
        fetchManifest()

        // Dropping the window (X) discards the staged extraction
        const cancel = () => window.package.importItemsCancel?.()
        window.addEventListener("beforeunload", cancel)
        return () => window.removeEventListener("beforeunload", cancel)
    }, [])

    const entries = useMemo(() => {
        if (!manifest) return []
        return activeTab === 0
            ? manifest.items || []
            : manifest.signages || []
    }, [manifest, activeTab])

    const selectable = entries.filter((e) => !e.exists)
    const selectedHere = selectable.filter((e) => selected.has(e.id)).length
    const allSelected =
        selectable.length > 0 && selectedHere === selectable.length

    const toggle = (id) =>
        setSelected((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })

    const toggleAll = () =>
        setSelected((prev) => {
            const next = new Set(prev)
            if (allSelected) selectable.forEach((e) => next.delete(e.id))
            else selectable.forEach((e) => next.add(e.id))
            return next
        })

    const selectedCount = selected.size

    const handleImport = async () => {
        if (!manifest) return
        setPhase("importing")
        setError(null)
        try {
            const itemIds = (manifest.items || [])
                .filter((e) => selected.has(e.id))
                .map((e) => e.id)
            const signageIds = (manifest.signages || [])
                .filter((e) => selected.has(e.id))
                .map((e) => e.id)
            const r = await window.package.importItemsExecute({
                itemIds,
                signageIds,
            })
            if (!r?.success) {
                setError(r?.error || "Import failed")
                setPhase("pick")
                return
            }
            // Backend closes this window and toasts the main one
        } catch (err) {
            setError(err.message)
            setPhase("pick")
        }
    }

    const handleCancel = () => {
        window.package.importItemsCancel?.().catch?.(() => {})
        window.close()
    }

    // Selected count per tab for the sidebar badges
    const tabCounts = TABS.map((t, i) => {
        const list =
            i === 0 ? manifest?.items || [] : manifest?.signages || []
        return list.filter((e) => selected.has(e.id)).length
    })

    const placeholders = entries.length % gridCols === 0
        ? gridCols
        : gridCols - (entries.length % gridCols) + gridCols

    return (
        <Box
            sx={{
                height: "100vh",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
            }}>
            <Box sx={{ display: "flex", flex: 1, overflow: "hidden" }}>
                {/* Sidebar - same look as the main window */}
                <Box
                    sx={{
                        width: 56,
                        minWidth: 56,
                        maxWidth: 56,
                        backgroundColor: "background.paper",
                        borderRight: 1,
                        borderColor: "divider",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        py: 1,
                        gap: 0.5,
                    }}>
                    {TABS.map((tab, index) => {
                        const Icon = tab.icon
                        return (
                            <Tooltip
                                key={tab.id}
                                title={tab.label}
                                placement="right">
                                <IconButton
                                    onClick={() => setActiveTab(index)}
                                    sx={{
                                        width: 44,
                                        height: 44,
                                        borderRadius: 1.5,
                                        color:
                                            activeTab === index
                                                ? "primary.main"
                                                : "text.secondary",
                                        "&:hover": {
                                            backgroundColor: "action.hover",
                                        },
                                    }}>
                                    <Badge
                                        badgeContent={tabCounts[index]}
                                        color="primary"
                                        overlap="circular">
                                        <Icon />
                                    </Badge>
                                </IconButton>
                            </Tooltip>
                        )
                    })}
                </Box>

                {/* Content */}
                <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
                    {phase === "loading" ? (
                        <Box
                            sx={{
                                height: "100%",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 1.5,
                            }}>
                            <CircularProgress size={22} />
                            <Typography variant="body2" color="text.secondary">
                                Reading package...
                            </Typography>
                        </Box>
                    ) : (
                        <>
                            <Box
                                sx={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    mb: 2,
                                }}>
                                <Typography variant="h6">
                                    {TABS[activeTab].label}
                                    {manifest?.sourceName
                                        ? ` from ${manifest.sourceName}`
                                        : ""}
                                </Typography>
                                {selectable.length > 0 && (
                                    <Button size="small" onClick={toggleAll}>
                                        {allSelected
                                            ? "Select none"
                                            : "Select all"}
                                    </Button>
                                )}
                            </Box>

                            {error && (
                                <Alert
                                    severity="error"
                                    sx={{ mb: 2 }}
                                    onClose={() => setError(null)}>
                                    {error}
                                </Alert>
                            )}

                            {!entries.length ? (
                                <Typography
                                    variant="body2"
                                    color="text.secondary">
                                    That package has no{" "}
                                    {TABS[activeTab].label.toLowerCase()}.
                                </Typography>
                            ) : (
                                <Box
                                    ref={gridRef}
                                    sx={{
                                        display: "flex",
                                        flexWrap: "wrap",
                                        gap: 1,
                                    }}>
                                    {entries.map((e) => (
                                        <ImportTile
                                            key={e.id}
                                            entry={e}
                                            checked={selected.has(e.id)}
                                            onToggle={toggle}
                                        />
                                    ))}
                                    {/* dashed placeholders like the browsers */}
                                    {Array.from({ length: placeholders }).map(
                                        (_, i) => (
                                            <Box
                                                key={`empty-${i}`}
                                                sx={{
                                                    width: 96,
                                                    height: 96,
                                                    border: "1px dashed #444",
                                                    borderRadius: 1,
                                                    boxSizing: "border-box",
                                                }}
                                            />
                                        ),
                                    )}
                                </Box>
                            )}
                        </>
                    )}
                </Box>
            </Box>

            {/* Footer */}
            <Box sx={{ p: 2, borderTop: 1, borderColor: "divider" }}>
                <Stack direction="row" spacing={1}>
                    <Button
                        variant="contained"
                        startIcon={
                            phase === "importing" ? (
                                <CircularProgress size={16} color="inherit" />
                            ) : (
                                <Download />
                            )
                        }
                        disabled={phase !== "pick" || !selectedCount}
                        onClick={handleImport}
                        sx={{ flex: 1 }}>
                        {phase === "importing"
                            ? "Importing..."
                            : `Import${selectedCount ? ` (${selectedCount})` : ""}`}
                    </Button>
                    <Button
                        variant="outlined"
                        startIcon={<Close />}
                        onClick={handleCancel}
                        disabled={phase === "importing"}
                        sx={{ flex: 1 }}>
                        Cancel
                    </Button>
                </Stack>
            </Box>
        </Box>
    )
}

export default ImportItemsPage
