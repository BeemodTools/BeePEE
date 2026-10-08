import {
    Box,
    Typography,
    Button,
    TextField,
    Alert,
    CircularProgress,
    Stack,
    Chip,
    InputAdornment,
    Tabs,
    Tab,
    Tooltip,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    ButtonBase,
} from "@mui/material"
import { Check } from "@mui/icons-material"
import {
    FolderOpen,
    CheckCircle,
    Error as ErrorIcon,
    AutoAwesome,
    SportsEsports,
    Extension,
    Save,
    Close,
    Folder,
    DeleteForever,
    Warning,
    FolderZip,
    PowerSettingsNew,
    BugReport,
    Brush,
    RestartAlt,
} from "@mui/icons-material"
import { useState, useEffect } from "react"
import {
    SignagePreferencesForm,
    SIGNAGE_PREF_DEFAULTS,
    SIGNAGE_PREF_KEYS,
} from "../components/signages/SignagePreferences"

// Custom toggle button component for settings
function SettingToggle({ name, description, checked, onChange, disabled, color = "primary" }) {
    const isError = color === "error"
    const activeColor = isError ? "error.main" : "primary.main"

    return (
        <ButtonBase
            onClick={() => !disabled && onChange(!checked)}
            disabled={disabled}
            sx={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "flex-start",
                textAlign: "left",
                p: 1.5,
                borderRadius: 1,
                border: 1,
                borderColor: checked ? activeColor : "divider",
                bgcolor: "transparent",
                opacity: disabled ? 0.5 : 1,
                transition: "all 0.15s ease",
                width: "100%",
                "&:hover": {
                    bgcolor: "action.hover",
                    borderColor: checked ? activeColor : "text.secondary",
                },
            }}>
            <Box
                sx={{
                    width: 20,
                    height: 20,
                    borderRadius: 0.5,
                    border: 2,
                    borderColor: checked ? activeColor : "text.disabled",
                    bgcolor: "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    mr: 1.5,
                    flexShrink: 0,
                }}>
                {checked && <Check sx={{ fontSize: 16, color: activeColor }} />}
            </Box>
            <Box sx={{ flex: 1 }}>
                <Typography
                    variant="body2"
                    fontWeight={600}
                    color={disabled ? "text.disabled" : "text.primary"}>
                    {name}
                </Typography>
                <Typography
                    variant="caption"
                    color={disabled ? "text.disabled" : "text.secondary"}
                    sx={{ display: "block", lineHeight: 1.3 }}>
                    {description}
                </Typography>
            </Box>
        </ButtonBase>
    )
}

// Tab order in the sidebar; ?tab=signage opens straight to that tab (used
// by the designer's File > Preferences)
const TAB_INDEX = { signage: 4 }

function SettingsPage() {
    const [tabValue, setTabValue] = useState(() => {
        const tab = new URLSearchParams(window.location.search).get("tab")
        return TAB_INDEX[tab] ?? 0
    })
    const [portal2Path, setPortal2Path] = useState("")
    const [beemodPath, setBeemodPath] = useState("")
    const [portal2AutoDetected, setPortal2AutoDetected] = useState(false)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState(null)
    const [showSaveSuccess, setShowSaveSuccess] = useState(false)
    const [portal2Error, setPortal2Error] = useState(null)
    const [beemodError, setBeemodError] = useState(null)
    const [hasChanges, setHasChanges] = useState(false)
    const [originalPortal2Path, setOriginalPortal2Path] = useState("")
    const [originalBeemodPath, setOriginalBeemodPath] = useState("")

    // App Settings state
    const [appSettings, setAppSettings] = useState({
        launchBeemodAfterExport: false,
        openFolderAfterExport: true,
        exportFormat: "bee_pack",
        autoBackupBeforeExport: true,
        openLastPackageOnStartup: false,
        hideWarnings: false,
        skipDeleteConfirmations: false,
        devMode: false,
        showItemIds: false,
        verboseLogging: false,
        ...SIGNAGE_PREF_DEFAULTS,
    })
    const [originalAppSettings, setOriginalAppSettings] = useState({})
    const [deleteConfigDialogOpen, setDeleteConfigDialogOpen] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)

    useEffect(() => {
        const loadSettings = async () => {
            try {
                // Load Portal 2 path
                const p2Result = await window.package.getPortal2Path()
                if (p2Result.success && p2Result.path) {
                    setPortal2Path(p2Result.path)
                    setOriginalPortal2Path(p2Result.path)
                    setPortal2AutoDetected(p2Result.canAutoDetect)
                }

                // Load BEEMod path
                const beeResult = await window.package.getBeemodPath()
                if (beeResult.success && beeResult.path) {
                    setBeemodPath(beeResult.path)
                    setOriginalBeemodPath(beeResult.path)
                }

                // Load app settings
                const settingsToLoad = [
                    "launchBeemodAfterExport",
                    "openFolderAfterExport",
                    "exportFormat",
                    "autoBackupBeforeExport",
                    "openLastPackageOnStartup",
                    "hideWarnings",
                    "skipDeleteConfirmations",
                    "devMode",
                    "showItemIds",
                    "verboseLogging",
                    ...SIGNAGE_PREF_KEYS,
                ]

                const loadedSettings = {}
                for (const key of settingsToLoad) {
                    const result = await window.package.getSetting(key)
                    // Unset settings come back as null - keep the default
                    // instead of letting null blank out the field
                    if (
                        result.success &&
                        result.value !== undefined &&
                        result.value !== null
                    ) {
                        loadedSettings[key] = result.value
                    }
                }

                const newSettings = { ...appSettings, ...loadedSettings }
                setAppSettings(newSettings)
                setOriginalAppSettings(newSettings)
            } catch (err) {
                console.error("Failed to load settings:", err)
                setError("Failed to load settings")
            } finally {
                setLoading(false)
            }
        }
        loadSettings()
    }, [])

    // Track changes
    useEffect(() => {
        const pathsChanged =
            portal2Path !== originalPortal2Path ||
            beemodPath !== originalBeemodPath

        const appSettingsChanged = Object.keys(appSettings).some(
            (key) => appSettings[key] !== originalAppSettings[key]
        )

        setHasChanges(pathsChanged || appSettingsChanged)
    }, [portal2Path, beemodPath, originalPortal2Path, originalBeemodPath, appSettings, originalAppSettings])

    // "*" in the window title while there are unsaved changes
    useEffect(() => {
        document.title = `${hasChanges ? "*" : ""}BeePEE - Preferences`
    }, [hasChanges])

    const handleBrowsePortal2 = async () => {
        try {
            setPortal2Error(null)
            const result = await window.package.browsePortal2Path()
            if (result.success && result.path) {
                setPortal2Path(result.path)
                setPortal2AutoDetected(false)
            } else if (!result.success && result.error) {
                setPortal2Error(result.error)
            }
        } catch (err) {
            setPortal2Error(err.message)
        }
    }

    const handleBrowseBeemod = async () => {
        try {
            setBeemodError(null)
            const result = await window.package.browseBeemodPath()
            if (result.success && result.path) {
                setBeemodPath(result.path)
            } else if (!result.success && result.error) {
                setBeemodError(result.error)
            }
        } catch (err) {
            setBeemodError(err.message)
        }
    }

    const updateAppSetting = (key, value) => {
        setAppSettings((prev) => ({ ...prev, [key]: value }))
    }

    const handleSave = async () => {
        setSaving(true)
        setError(null)
        setPortal2Error(null)
        setBeemodError(null)

        try {
            // Save Portal 2 path if changed
            if (portal2Path !== originalPortal2Path) {
                const p2Result = await window.package.setPortal2Path(portal2Path || null)
                if (!p2Result.success) {
                    setPortal2Error(p2Result.error)
                    setSaving(false)
                    return
                }
            }

            // Save BEEMod path if changed
            if (beemodPath !== originalBeemodPath) {
                const beeResult = await window.package.setBeemodPath(beemodPath)
                if (!beeResult.success) {
                    setBeemodError(beeResult.error)
                    setSaving(false)
                    return
                }
            }

            // Save app settings if changed
            for (const [key, value] of Object.entries(appSettings)) {
                if (value !== originalAppSettings[key]) {
                    await window.package.setSetting(key, value)
                }
            }

            setOriginalPortal2Path(portal2Path)
            setOriginalBeemodPath(beemodPath)
            setOriginalAppSettings({ ...appSettings })
            setHasChanges(false)
            setShowSaveSuccess(true)
            setTimeout(() => setShowSaveSuccess(false), 2000)
        } catch (err) {
            setError(err.message)
        } finally {
            setSaving(false)
        }
    }

    const handleDeleteConfig = async () => {
        setIsDeleting(true)
        try {
            // On success the backend saves any open package, restarts the
            // app into setup, and reopens the package afterwards - this
            // window is about to go away, so just keep the spinner up
            const result = await window.package.deleteAllSettings()
            if (result && result.success === false) {
                setError("Failed to delete settings: " + (result.error || ""))
                setIsDeleting(false)
                setDeleteConfigDialogOpen(false)
            }
        } catch (err) {
            setError("Failed to delete settings: " + err.message)
            setIsDeleting(false)
            setDeleteConfigDialogOpen(false)
        }
    }

    const handleClose = () => {
        window.package.closeSettingsWindow()
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
            }}>
            {/* Main Content Area with Vertical Sidebar */}
            <Box sx={{ display: "flex", flex: 1, overflow: "hidden" }}>
                {/* Vertical Sidebar */}
                <Tabs
                    value={tabValue}
                    onChange={(e, newValue) => setTabValue(newValue)}
                    orientation="vertical"
                    variant="scrollable"
                    scrollButtons={false}
                    sx={{
                        borderRight: 1,
                        borderColor: "divider",
                        minWidth: 56,
                        maxWidth: 56,
                        bgcolor: "background.paper",
                        "& .MuiTabs-indicator": {
                            left: 0,
                            width: 3,
                        },
                        "& .MuiTab-root": {
                            minWidth: 56,
                            width: 56,
                            minHeight: 48,
                            alignItems: "center",
                            justifyContent: "center",
                        },
                    }}>
                    <Tooltip title="Game Paths" placement="right">
                        <Tab icon={<Folder />} />
                    </Tooltip>
                    <Tooltip title="Export" placement="right">
                        <Tab icon={<FolderZip />} />
                    </Tooltip>
                    <Tooltip title="Startup" placement="right">
                        <Tab icon={<PowerSettingsNew />} />
                    </Tooltip>
                    <Tooltip title="Warnings" placement="right">
                        <Tab icon={<Warning />} />
                    </Tooltip>
                    <Tooltip title="Signage" placement="right">
                        <Tab icon={<Brush />} />
                    </Tooltip>
                    <Tooltip title="Developer" placement="right">
                        <Tab icon={<BugReport />} />
                    </Tooltip>
                    <Tooltip title="Danger Zone" placement="right">
                        <Tab icon={<DeleteForever sx={{ color: "error.main" }} />} />
                    </Tooltip>
                </Tabs>

                {/* Content Area */}
                <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
                    {/* Game Paths Tab */}
                    <Box sx={{ display: tabValue === 0 ? "block" : "none" }}>
                        <Box
                            sx={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                mb: 2,
                            }}>
                            <Typography variant="h6">Game Paths</Typography>
                        </Box>

                        <Stack spacing={2}>
                            {/* Portal 2 Path */}
                            <Box>
                                <Stack
                                    direction="row"
                                    alignItems="center"
                                    spacing={1}
                                    sx={{ mb: 0.5 }}>
                                    <SportsEsports
                                        sx={{ fontSize: 18, color: "text.secondary" }}
                                    />
                                    <Typography variant="subtitle2" fontWeight={600}>
                                        Portal 2
                                    </Typography>
                                    {portal2AutoDetected && (
                                        <Chip
                                            size="small"
                                            icon={<AutoAwesome sx={{ fontSize: 12 }} />}
                                            label="Auto-detected"
                                            color="success"
                                            variant="outlined"
                                            sx={{ height: 20, fontSize: 11 }}
                                        />
                                    )}
                                </Stack>
                                <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    sx={{ display: "block", mb: 1 }}>
                                    {portal2AutoDetected
                                        ? "Found via Steam. Change if needed."
                                        : "Select your Portal 2 installation folder."}
                                </Typography>
                                <Stack direction="row" spacing={1}>
                                    <TextField
                                        fullWidth
                                        variant="outlined"
                                        value={portal2Path}
                                        onChange={(e) => {
                                            setPortal2Path(e.target.value)
                                            setPortal2AutoDetected(false)
                                        }}
                                        placeholder="C:\...\Portal 2"
                                        error={!!portal2Error}
                                        InputProps={{
                                            endAdornment: portal2Path && !portal2Error && (
                                                <InputAdornment position="end">
                                                    <CheckCircle
                                                        sx={{
                                                            color: "success.main",
                                                            fontSize: 18,
                                                        }}
                                                    />
                                                </InputAdornment>
                                            ),
                                        }}
                                    />
                                    <Button
                                        variant="outlined"
                                        onClick={handleBrowsePortal2}
                                        sx={{ minWidth: 56, px: 2 }}>
                                        <FolderOpen />
                                    </Button>
                                </Stack>
                                {portal2Error && (
                                    <Alert
                                        severity="error"
                                        sx={{ mt: 1, py: 0 }}
                                        icon={<ErrorIcon sx={{ fontSize: 16 }} />}>
                                        <Typography variant="caption">
                                            {portal2Error}
                                        </Typography>
                                    </Alert>
                                )}
                            </Box>

                            {/* BEEMod Path */}
                            <Box>
                                <Stack
                                    direction="row"
                                    alignItems="center"
                                    spacing={1}
                                    sx={{ mb: 0.5 }}>
                                    <Extension
                                        sx={{ fontSize: 18, color: "text.secondary" }}
                                    />
                                    <Typography variant="subtitle2" fontWeight={600}>
                                        BEEMod
                                    </Typography>
                                </Stack>
                                <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    sx={{ display: "block", mb: 1 }}>
                                    Folder containing BEE2.exe
                                </Typography>
                                <Stack direction="row" spacing={1}>
                                    <TextField
                                        fullWidth
                                        variant="outlined"
                                        value={beemodPath}
                                        onChange={(e) => setBeemodPath(e.target.value)}
                                        placeholder="C:\BEEMod"
                                        error={!!beemodError}
                                        InputProps={{
                                            endAdornment: beemodPath && !beemodError && (
                                                <InputAdornment position="end">
                                                    <CheckCircle
                                                        sx={{
                                                            color: "success.main",
                                                            fontSize: 18,
                                                        }}
                                                    />
                                                </InputAdornment>
                                            ),
                                        }}
                                    />
                                    <Button
                                        variant="outlined"
                                        onClick={handleBrowseBeemod}
                                        sx={{ minWidth: 56, px: 2 }}>
                                        <FolderOpen />
                                    </Button>
                                </Stack>
                                {beemodError && (
                                    <Alert
                                        severity="error"
                                        sx={{ mt: 1, py: 0 }}
                                        icon={<ErrorIcon sx={{ fontSize: 16 }} />}>
                                        <Typography variant="caption">
                                            {beemodError}
                                        </Typography>
                                    </Alert>
                                )}
                            </Box>
                        </Stack>

                        {error && (
                            <Alert severity="error" sx={{ mt: 3 }}>
                                {error}
                            </Alert>
                        )}
                    </Box>

                    {/* Export Settings Tab */}
                    <Box sx={{ display: tabValue === 1 ? "block" : "none" }}>
                        <Box
                            sx={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                mb: 2,
                            }}>
                            <Typography variant="h6">Export Settings</Typography>
                        </Box>

                        <Stack spacing={1.5}>
                            <FormControl fullWidth size="small" sx={{ mb: 1 }}>
                                <InputLabel>Export Format</InputLabel>
                                <Select
                                    value={appSettings.exportFormat}
                                    label="Export Format"
                                    onChange={(e) =>
                                        updateAppSetting("exportFormat", e.target.value)
                                    }>
                                    <MenuItem value="zip">.zip (Standard)</MenuItem>
                                    <MenuItem value="bee_pack">.bee_pack (BEEMod)</MenuItem>
                                </Select>
                            </FormControl>

                            <SettingToggle
                                name="Launch BEEMod after export"
                                description="Export straight to the BEEMod packages folder (no save dialog) and open BEE2 afterwards"
                                checked={appSettings.launchBeemodAfterExport}
                                onChange={(value) => updateAppSetting("launchBeemodAfterExport", value)}
                            />

                            <SettingToggle
                                name="Open folder after export"
                                description="Show the exported file in your file explorer"
                                checked={appSettings.openFolderAfterExport}
                                onChange={(value) => updateAppSetting("openFolderAfterExport", value)}
                            />

                            <SettingToggle
                                name="Auto-backup before export"
                                description="Create a backup copy of your package before exporting"
                                checked={appSettings.autoBackupBeforeExport}
                                onChange={(value) => updateAppSetting("autoBackupBeforeExport", value)}
                            />
                        </Stack>
                    </Box>

                    {/* Startup Settings Tab */}
                    <Box sx={{ display: tabValue === 2 ? "block" : "none" }}>
                        <Box
                            sx={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                mb: 2,
                            }}>
                            <Typography variant="h6">Startup</Typography>
                        </Box>

                        <Stack spacing={1.5}>
                            <SettingToggle
                                name="Open last package on startup"
                                description="Remember the most recently opened package and load it automatically when BeePEE starts"
                                checked={appSettings.openLastPackageOnStartup}
                                onChange={(value) => updateAppSetting("openLastPackageOnStartup", value)}
                            />
                        </Stack>
                    </Box>

                    {/* Warnings Tab */}
                    <Box sx={{ display: tabValue === 3 ? "block" : "none" }}>
                        <Box
                            sx={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                mb: 2,
                            }}>
                            <Typography variant="h6">Warnings & Confirmations</Typography>
                        </Box>

                        <Stack spacing={1.5}>
                            <SettingToggle
                                name="Hide non-critical warnings"
                                description="Suppress minor warning messages throughout the app"
                                checked={appSettings.hideWarnings}
                                onChange={(value) => updateAppSetting("hideWarnings", value)}
                            />

                            <SettingToggle
                                name="Skip delete confirmations"
                                description="Delete items immediately without asking for confirmation"
                                checked={appSettings.skipDeleteConfirmations}
                                onChange={(value) => updateAppSetting("skipDeleteConfirmations", value)}
                                color="error"
                            />
                        </Stack>
                    </Box>

                    {/* Signage Tab */}
                    <Box sx={{ display: tabValue === 4 ? "block" : "none" }}>
                        <Box
                            sx={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                mb: 2,
                            }}>
                            <Typography variant="h6">Signage</Typography>
                            <Tooltip title="Set every signage preference back to its default (applied on Save)">
                                <Button
                                    size="small"
                                    startIcon={<RestartAlt />}
                                    onClick={() =>
                                        setAppSettings((prev) => ({
                                            ...prev,
                                            ...SIGNAGE_PREF_DEFAULTS,
                                        }))
                                    }>
                                    Reset to defaults
                                </Button>
                            </Tooltip>
                        </Box>
                        <SignagePreferencesForm
                            values={appSettings}
                            onChange={updateAppSetting}
                        />
                    </Box>

                    {/* Developer Tab */}
                    <Box sx={{ display: tabValue === 5 ? "block" : "none" }}>
                        <Box
                            sx={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                mb: 2,
                            }}>
                            <Typography variant="h6">Developer</Typography>
                        </Box>

                        <Stack spacing={1.5}>
                            <SettingToggle
                                name="Developer mode"
                                description="Show DevTools console and enable debugging features"
                                checked={appSettings.devMode}
                                onChange={(value) => updateAppSetting("devMode", value)}
                            />

                            <SettingToggle
                                name="Show item IDs"
                                description="Display the locked item/signage ID field in the editor"
                                checked={appSettings.showItemIds}
                                onChange={(value) => updateAppSetting("showItemIds", value)}
                            />

                            <SettingToggle
                                name="Verbose logging"
                                description="Output detailed logs for troubleshooting issues"
                                checked={appSettings.verboseLogging}
                                onChange={(value) => updateAppSetting("verboseLogging", value)}
                            />
                        </Stack>
                    </Box>

                    {/* Danger Zone Tab */}
                    <Box sx={{ display: tabValue === 6 ? "block" : "none" }}>
                        <Box
                            sx={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                mb: 2,
                            }}>
                            <Typography variant="h6" color="error.main">
                                Danger Zone
                            </Typography>
                        </Box>

                        <Stack spacing={2}>
                            <Box>
                                <Button
                                    variant="outlined"
                                    color="error"
                                    startIcon={<DeleteForever />}
                                    onClick={() => setDeleteConfigDialogOpen(true)}>
                                    Delete All Settings
                                </Button>
                                <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    sx={{ display: "block", mt: 1 }}>
                                    This will reset all settings to defaults and clear saved
                                    paths. You will need to run through setup again.
                                </Typography>
                            </Box>
                        </Stack>
                    </Box>
                </Box>
            </Box>

            {/* Footer with Save/Close Buttons */}
            <Box sx={{ p: 2, borderTop: 1, borderColor: "divider" }}>
                <Stack direction="row" spacing={1}>
                    <Tooltip title={hasChanges ? "Save changes" : "No unsaved changes"}>
                        {/* span: the tooltip still works while it's disabled */}
                        <span style={{ flex: 1, display: "flex" }}>
                        <Button
                            variant="contained"
                            startIcon={
                                saving ? (
                                    <CircularProgress size={20} color="inherit" />
                                ) : showSaveSuccess ? (
                                    <CheckCircle />
                                ) : (
                                    <Save />
                                )
                            }
                            onClick={handleSave}
                            color={showSaveSuccess ? "success" : "primary"}
                            disabled={!hasChanges || saving}
                            sx={{ flex: 1 }}>
                            {saving ? "Saving..." : showSaveSuccess ? "Saved!" : "Save"}
                        </Button>
                        </span>
                    </Tooltip>
                    <Tooltip title={hasChanges ? "Discard changes and close" : "Close"}>
                        <Button
                            variant="outlined"
                            startIcon={<Close />}
                            onClick={handleClose}
                            color={hasChanges ? "error" : "primary"}
                            sx={{ flex: 1 }}>
                            {hasChanges ? "Discard" : "Close"}
                        </Button>
                    </Tooltip>
                </Stack>
            </Box>

            {/* Delete Config Confirmation Dialog */}
            <Dialog
                open={deleteConfigDialogOpen}
                onClose={() => !isDeleting && setDeleteConfigDialogOpen(false)}>
                <DialogTitle>Delete All Settings?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        This will permanently delete all your settings, including:
                    </DialogContentText>
                    <Alert severity="warning" sx={{ mt: 2 }}>
                        <ul style={{ margin: 0, paddingLeft: 20 }}>
                            <li>Portal 2 and BEEMod paths</li>
                            <li>All app preferences</li>
                            <li>Recent packages list</li>
                            <li>Setup completion status</li>
                        </ul>
                    </Alert>
                    <DialogContentText sx={{ mt: 2 }}>
                        BeePEE will restart and take you through setup again.
                        If a package is open it will be saved first and
                        reopened after setup.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={() => setDeleteConfigDialogOpen(false)}
                        disabled={isDeleting}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleDeleteConfig}
                        color="error"
                        variant="contained"
                        disabled={isDeleting}
                        startIcon={
                            isDeleting ? (
                                <CircularProgress size={20} color="inherit" />
                            ) : (
                                <DeleteForever />
                            )
                        }>
                        {isDeleting ? "Deleting..." : "Delete Everything"}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    )
}

export default SettingsPage
