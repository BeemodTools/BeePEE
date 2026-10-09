import { useEffect, useMemo, useState } from "react"
import {
    Alert,
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    FormControl,
    FormControlLabel,
    IconButton,
    InputLabel,
    List,
    ListItemButton,
    ListItemText,
    Menu,
    MenuItem,
    Paper,
    Select,
    Stack,
    Switch,
    TextField,
    Tooltip,
    Typography,
} from "@mui/material"
import {
    Add,
    ArrowDownward,
    ArrowUpward,
    CheckCircle,
    Delete,
    Undo,
} from "@mui/icons-material"
import ConfigValueField from "../components/ConfigValueField"
import {
    INFINITE,
    NEW_DEFAULTS,
    TIMER_VALUES,
    WIDGET_TYPES,
    configProblems,
    defaultOf,
    freeId,
    idFrom,
    labelsItself,
    timerValuesOf,
    valueError,
} from "../utils/configWidgets"

/** The groups as the backend takes them: without the window's own marks */
const forSaving = (groups) =>
    groups.map(({ isNew, idEdited, ...group }) => ({
        ...group,
        widgets: group.widgets.map(
            ({ isNew: newWidget, idEdited: edited, ...widget }) => widget,
        ),
    }))

/** What deleting a group takes with it, for the dialog asking first */
function deletedWith(group) {
    const count = group?.widgets.length ?? 0
    if (count === 0) return ""
    const widgets = count === 1 ? "Its widget goes" : `Its ${count} widgets go`
    return `${widgets} with it, and Get Config blocks reading ${count === 1 ? "it" : "them"} give their default instead. `
}

/** A new widget of a type, its ID from its label (one the group doesn't have) */
function newWidget(type, group) {
    const label = WIDGET_TYPES[type]
    const taken = group.widgets.map((w) => w.id)
    const widget = {
        id: freeId(idFrom(label), taken),
        label,
        type,
        typeName: "",
        tooltip: "",
        // A color's swatch only shows with a value for each timer value
        timer: type === "color",
        inf: false,
        default: NEW_DEFAULTS[type],
        extra: {},
        isNew: true,
    }
    return withType(widget, type)
}

/** A widget as another type: its type's options, and defaults it can have */
function withType(widget, type) {
    const next = { ...widget, type }
    delete next.options
    delete next.min
    delete next.max
    delete next.step
    delete next.zeroOff
    if (type === "dropdown") {
        next.options = widget.options ?? [{ id: "option_1", label: "Option 1" }]
    }
    if (type === "slider") {
        Object.assign(next, { min: "0", max: "10", step: "1", zeroOff: false })
    }
    if (type === "timer") Object.assign(next, { min: "0", max: "60" })
    if (type === "color") {
        next.timer = true
        next.inf = false
    }
    // Defaults this type takes
    const fallback =
        type === "dropdown" ? (next.options[0]?.id ?? "") : NEW_DEFAULTS[type]
    const fit = (value) => (valueError(next, value) ? fallback : value)
    next.default = fit(widget.default)
    if (next.timer) {
        next.defaults = Object.fromEntries(
            timerValuesOf(next).map((t) => [
                t,
                fit(widget.defaults?.[t] ?? widget.default),
            ]),
        )
    } else {
        delete next.defaults
    }
    return next
}

/** A widget with a value for each timer value, or one (and an infinite one) */
function withTimer(widget, timer, inf = false) {
    const next = { ...widget, timer, inf: timer && inf }
    if (timer) {
        const first = defaultOf(widget) || widget.default
        next.defaults = Object.fromEntries(
            timerValuesOf(next).map((t) => [
                t,
                widget.defaults?.[t] ??
                    (t === INFINITE ? first : widget.default),
            ]),
        )
    } else {
        next.default = defaultOf(widget)
        delete next.defaults
    }
    return next
}

/** The problems at a place, as small lines */
function Problems({ problems }) {
    if (problems.length === 0) return null
    return (
        <Stack spacing={0.5} sx={{ mt: 1 }}>
            {problems.map((problem, i) => (
                <Typography
                    key={i}
                    variant="caption"
                    color={problem.type === "error" ? "error" : "warning.main"}>
                    {problem.message}
                </Typography>
            ))}
        </Stack>
    )
}

/** A timer widget's defaults: one for each timer value, where BEE2 has them */
function TimerDefaults({ widget, onChange }) {
    const values = timerValuesOf(widget)
    const set = (timer, value) =>
        onChange({
            ...widget,
            defaults: { ...widget.defaults, [timer]: value },
        })
    return (
        <Box>
            <Box
                sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    mb: 1,
                }}>
                <Typography variant="caption" color="text.secondary">
                    Each slot's default (a slot for each timer value)
                </Typography>
                <Button
                    size="small"
                    onClick={() =>
                        onChange({
                            ...widget,
                            defaults: Object.fromEntries(
                                values.map((t) => [t, widget.defaults?.["3"]]),
                            ),
                        })
                    }>
                    Make all like slot 3
                </Button>
            </Box>
            <Box
                sx={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(76px, 1fr))",
                    gap: 1,
                }}>
                {values.map((timer) => (
                    <Box
                        key={timer}
                        sx={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 0.5,
                            p: 0.75,
                            borderRadius: 1,
                            bgcolor: "action.hover",
                        }}>
                        <Typography variant="caption" color="text.secondary">
                            {timer === INFINITE ? "Infinite" : timer}
                        </Typography>
                        <ConfigValueField
                            compact
                            widget={widget}
                            label={
                                timer === INFINITE
                                    ? "Slot for an infinite timer"
                                    : `Slot ${timer}`
                            }
                            value={widget.defaults?.[timer]}
                            error={Boolean(
                                valueError(widget, widget.defaults?.[timer]),
                            )}
                            onChange={(value) => set(timer, value)}
                        />
                    </Box>
                ))}
            </Box>
        </Box>
    )
}

/** A dropdown's options: their IDs (what Get Config gives) and labels */
function DropdownOptions({ widget, onChange }) {
    const options = widget.options ?? []
    const setOptions = (next) => onChange({ ...widget, options: next })
    return (
        <Box>
            <Typography variant="caption" color="text.secondary">
                Options (Get Config gives the ID of the one picked)
            </Typography>
            <Stack spacing={1} sx={{ mt: 1 }}>
                {options.map((option, i) => (
                    <Stack
                        key={i}
                        direction="row"
                        spacing={1}
                        alignItems="center">
                        <TextField
                            size="small"
                            label="ID"
                            value={option.id}
                            onChange={(e) =>
                                setOptions(
                                    options.map((o, j) =>
                                        j === i
                                            ? { ...o, id: e.target.value }
                                            : o,
                                    ),
                                )
                            }
                            sx={{ width: 180 }}
                        />
                        <TextField
                            size="small"
                            label="Label"
                            value={option.label}
                            onChange={(e) =>
                                setOptions(
                                    options.map((o, j) =>
                                        j === i
                                            ? { ...o, label: e.target.value }
                                            : o,
                                    ),
                                )
                            }
                            sx={{ flex: 1 }}
                        />
                        <Tooltip title="Remove this option">
                            <IconButton
                                size="small"
                                onClick={() =>
                                    setOptions(
                                        options.filter((_, j) => j !== i),
                                    )
                                }>
                                <Delete fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    </Stack>
                ))}
                <Box>
                    <Button
                        size="small"
                        startIcon={<Add />}
                        onClick={() => {
                            const id = freeId(
                                `option_${options.length + 1}`,
                                options.map((o) => o.id),
                            )
                            setOptions([
                                ...options,
                                { id, label: `Option ${options.length + 1}` },
                            ])
                        }}>
                        Add Option
                    </Button>
                </Box>
            </Stack>
        </Box>
    )
}

/** One widget of the group: what players see, and its default */
function WidgetCard({
    widget,
    group,
    problems,
    onChange,
    onMove,
    onDelete,
    first,
    last,
}) {
    const field = (name) =>
        problems.some((p) => p.field === name && p.type === "error")

    // Not one BeePEE edits (an item variant): kept as it is
    if (!widget.type) {
        return (
            <Paper variant="outlined" sx={{ p: 2 }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                    <Typography variant="body2" sx={{ flex: 1 }}>
                        {widget.label || widget.id}{" "}
                        <Typography
                            component="span"
                            variant="caption"
                            color="text.secondary">
                            ({widget.typeName || "no type"}: kept as it is)
                        </Typography>
                    </Typography>
                    <Tooltip title="Delete this widget">
                        <IconButton
                            size="small"
                            color="error"
                            onClick={onDelete}>
                            <Delete fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Stack>
            </Paper>
        )
    }

    const setLabel = (label) => {
        const next = { ...widget, label }
        // A new one's ID follows its label, until it's set
        if (widget.isNew && !widget.idEdited) {
            next.id = freeId(
                idFrom(label) || "widget",
                group.widgets.filter((w) => w !== widget).map((w) => w.id),
            )
        }
        onChange(next)
    }

    return (
        <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" spacing={1} alignItems="flex-start">
                <TextField
                    size="small"
                    label="Label"
                    value={widget.label}
                    onChange={(e) => setLabel(e.target.value)}
                    sx={{ flex: 1 }}
                />
                <Tooltip
                    title={
                        widget.isNew
                            ? "Get Config blocks read it by this"
                            : "Get Config blocks read it by this, so it stays as it was saved"
                    }>
                    <TextField
                        size="small"
                        label="ID"
                        value={widget.id}
                        disabled={!widget.isNew}
                        error={field("id")}
                        onChange={(e) =>
                            onChange({
                                ...widget,
                                id: e.target.value,
                                idEdited: true,
                            })
                        }
                        sx={{ width: 170 }}
                        inputProps={{ style: { fontFamily: "monospace" } }}
                    />
                </Tooltip>
                <FormControl size="small" sx={{ width: 170 }}>
                    <InputLabel>Type</InputLabel>
                    <Select
                        value={widget.type}
                        label="Type"
                        onChange={(e) =>
                            onChange(withType(widget, e.target.value))
                        }>
                        {Object.entries(WIDGET_TYPES).map(([type, name]) => (
                            <MenuItem key={type} value={type}>
                                {name}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
                <Tooltip title="Move up">
                    <span>
                        <IconButton
                            size="small"
                            disabled={first}
                            onClick={() => onMove(-1)}>
                            <ArrowUpward fontSize="small" />
                        </IconButton>
                    </span>
                </Tooltip>
                <Tooltip title="Move down">
                    <span>
                        <IconButton
                            size="small"
                            disabled={last}
                            onClick={() => onMove(1)}>
                            <ArrowDownward fontSize="small" />
                        </IconButton>
                    </span>
                </Tooltip>
                <Tooltip title="Delete this widget">
                    <IconButton size="small" color="error" onClick={onDelete}>
                        <Delete fontSize="small" />
                    </IconButton>
                </Tooltip>
            </Stack>

            <TextField
                size="small"
                label="Tooltip"
                fullWidth
                multiline
                value={widget.tooltip}
                onChange={(e) =>
                    onChange({ ...widget, tooltip: e.target.value })
                }
                sx={{ mt: 2 }}
            />

            {widget.type === "dropdown" && (
                <Box sx={{ mt: 2 }}>
                    <DropdownOptions
                        widget={widget}
                        onChange={(next) =>
                            onChange(withType(next, "dropdown"))
                        }
                    />
                </Box>
            )}

            {(widget.type === "slider" || widget.type === "timer") && (
                <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    sx={{ mt: 2 }}>
                    <TextField
                        size="small"
                        type="number"
                        label={
                            widget.type === "timer" ? "Min (seconds)" : "Min"
                        }
                        value={widget.min}
                        error={field("range")}
                        onChange={(e) =>
                            onChange({ ...widget, min: e.target.value })
                        }
                        sx={{ width: 140 }}
                    />
                    <TextField
                        size="small"
                        type="number"
                        label={
                            widget.type === "timer" ? "Max (seconds)" : "Max"
                        }
                        value={widget.max}
                        error={field("range")}
                        onChange={(e) =>
                            onChange({ ...widget, max: e.target.value })
                        }
                        sx={{ width: 140 }}
                    />
                    {widget.type === "slider" && (
                        <>
                            <TextField
                                size="small"
                                type="number"
                                label="Step"
                                value={widget.step}
                                error={field("range")}
                                onChange={(e) =>
                                    onChange({
                                        ...widget,
                                        step: e.target.value,
                                    })
                                }
                                sx={{ width: 110 }}
                            />
                            <FormControlLabel
                                control={
                                    <Switch
                                        size="small"
                                        checked={Boolean(widget.zeroOff)}
                                        onChange={(e) =>
                                            onChange({
                                                ...widget,
                                                zeroOff: e.target.checked,
                                            })
                                        }
                                    />
                                }
                                label={
                                    <Typography variant="body2">
                                        Show 0 as Off
                                    </Typography>
                                }
                            />
                        </>
                    )}
                </Stack>
            )}

            <Stack direction="row" spacing={2} sx={{ mt: 1.5 }}>
                <FormControlLabel
                    control={
                        <Switch
                            size="small"
                            checked={Boolean(widget.timer)}
                            onChange={(e) =>
                                onChange(withTimer(widget, e.target.checked))
                            }
                        />
                    }
                    label={
                        <Typography variant="body2">
                            A slot for each timer value
                        </Typography>
                    }
                />
                {widget.timer && widget.type !== "color" && (
                    <FormControlLabel
                        control={
                            <Switch
                                size="small"
                                checked={Boolean(widget.inf)}
                                onChange={(e) =>
                                    onChange(
                                        withTimer(
                                            widget,
                                            true,
                                            e.target.checked,
                                        ),
                                    )
                                }
                            />
                        }
                        label={
                            <Typography variant="body2">
                                And one for an infinite timer
                            </Typography>
                        }
                    />
                )}
            </Stack>

            <Box sx={{ mt: 1.5 }}>
                {widget.timer ? (
                    <TimerDefaults widget={widget} onChange={onChange} />
                ) : (
                    <Stack direction="row" spacing={1.5} alignItems="center">
                        {!labelsItself(widget.type) && (
                            <Typography variant="body2" color="text.secondary">
                                Default
                            </Typography>
                        )}
                        <ConfigValueField
                            widget={widget}
                            label={
                                widget.type === "checkbox" ? "On" : "Default"
                            }
                            value={widget.default}
                            error={field("default")}
                            onChange={(value) =>
                                onChange({ ...widget, default: value })
                            }
                        />
                    </Stack>
                )}
            </Box>

            <Problems problems={problems} />
        </Paper>
    )
}

/**
 * The Package Config window (Edit > Package Config): the package's config
 * groups, sections of BEE2's ItemVar menu with the widgets players set
 * there. Get Config blocks put a widget's value into a fixup.
 */
export default function PackageConfigPage() {
    const [opened, setOpened] = useState(null)
    const [groups, setGroups] = useState([])
    const [savedGroups, setSavedGroups] = useState("[]")
    const [selected, setSelected] = useState(0)
    const [error, setError] = useState(null)
    const [notice, setNotice] = useState(null)
    const [saving, setSaving] = useState(false)
    const [addMenu, setAddMenu] = useState(null)
    // The group Delete Group asks about (kept while the dialog closes)
    const [deleting, setDeleting] = useState({ open: false, group: null })

    const load = async () => {
        try {
            const result = await window.package.getConfigGroups()
            if (!result?.success) throw new Error(result?.error)
            setOpened({
                packageDir: result.packageDir,
                packageId: result.packageId,
                packageName: result.packageName,
            })
            setGroups(result.groups)
            setSavedGroups(JSON.stringify(result.groups))
            setSelected((current) =>
                Math.min(current, Math.max(0, result.groups.length - 1)),
            )
            setError(null)
        } catch (err) {
            console.error("Failed to read the package's config groups:", err)
            setError(err.message || "The package's config groups can't be read")
        }
    }

    useEffect(() => {
        document.title = "Package Config"
        load()
    }, [])

    const problems = useMemo(() => configProblems(groups), [groups])
    const errorCount = problems.filter((p) => p.type === "error").length
    const changed = JSON.stringify(groups) !== savedGroups
    const group = groups[selected]

    const setGroup = (index, next) =>
        setGroups((all) => all.map((g, i) => (i === index ? next : g)))
    const setWidget = (index, next) =>
        setGroup(selected, {
            ...group,
            widgets: group.widgets.map((w, i) => (i === index ? next : w)),
        })

    const addGroup = () => {
        const name = "New Group"
        const id = freeId(
            idFrom(`${opened?.packageId ?? ""} ${name}`, { upper: true }),
            groups.map((g) => g.id),
        )
        setGroups((all) => [
            ...all,
            {
                id,
                name,
                description: "",
                widgets: [],
                extra: {},
                isNew: true,
            },
        ])
        setSelected(groups.length)
    }

    const setGroupName = (name) => {
        const next = { ...group, name }
        // A new one's ID follows its name, until it's set
        if (group.isNew && !group.idEdited) {
            next.id = freeId(
                idFrom(`${opened?.packageId ?? ""} ${name || "group"}`, {
                    upper: true,
                }),
                groups.filter((g) => g !== group).map((g) => g.id),
            )
        }
        setGroup(selected, next)
    }

    const save = async () => {
        setSaving(true)
        setNotice(null)
        try {
            const result = await window.package.saveConfigGroups(
                opened.packageDir,
                forSaving(groups),
            )
            if (!result?.success) throw new Error(result?.error)
            setGroups(result.groups)
            setSavedGroups(JSON.stringify(result.groups))
            setError(null)
            setNotice("Saved. Save the package to put them in its .bpee")
        } catch (err) {
            console.error("Failed to save the package's config groups:", err)
            setError(err.message || "They couldn't be saved")
        } finally {
            setSaving(false)
        }
    }

    const groupProblems = (index) => problems.filter((p) => p.group === index)
    const closeDelete = () => setDeleting((d) => ({ ...d, open: false }))

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
                    alignItems: "baseline",
                    gap: 1.5,
                    px: 2,
                    py: 1.5,
                    borderBottom: 1,
                    borderColor: "divider",
                    bgcolor: "background.paper",
                }}>
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                    Package Config
                </Typography>
                {opened?.packageName && (
                    <Typography variant="body2" color="text.secondary">
                        {opened.packageName}
                    </Typography>
                )}
            </Box>

            <Box sx={{ flex: 1, minHeight: 0, display: "flex" }}>
                {/* The groups */}
                <Box
                    sx={{
                        width: 250,
                        flexShrink: 0,
                        borderRight: 1,
                        borderColor: "divider",
                        display: "flex",
                        flexDirection: "column",
                    }}>
                    <List dense sx={{ flex: 1, overflow: "auto", py: 0 }}>
                        {groups.map((g, i) => {
                            const has = groupProblems(i)
                            return (
                                <ListItemButton
                                    key={i}
                                    selected={i === selected}
                                    onClick={() => setSelected(i)}>
                                    <ListItemText
                                        primary={g.name || g.id || "(no name)"}
                                        secondary={`${g.id} · ${g.widgets.length} widget${g.widgets.length === 1 ? "" : "s"}`}
                                        primaryTypographyProps={{
                                            noWrap: true,
                                            color: has.some(
                                                (p) => p.type === "error",
                                            )
                                                ? "error"
                                                : undefined,
                                        }}
                                        secondaryTypographyProps={{
                                            noWrap: true,
                                            sx: {
                                                fontFamily: "monospace",
                                                fontSize: "0.7rem",
                                            },
                                        }}
                                    />
                                </ListItemButton>
                            )
                        })}
                    </List>
                    <Box sx={{ p: 1.5, borderTop: 1, borderColor: "divider" }}>
                        <Button
                            fullWidth
                            variant="outlined"
                            startIcon={<Add />}
                            disabled={!opened}
                            onClick={addGroup}>
                            New Group
                        </Button>
                    </Box>
                </Box>

                {/* The group being edited */}
                <Box sx={{ flex: 1, minWidth: 0, overflow: "auto", p: 3 }}>
                    {error && (
                        <Alert
                            severity="error"
                            sx={{ mb: 2 }}
                            onClose={() => setError(null)}>
                            {error}
                        </Alert>
                    )}
                    {!group ? (
                        <Typography variant="body2" color="text.secondary">
                            No config groups yet. A group is a section of BEE2's
                            ItemVar menu with settings players change, which
                            items' Get Config blocks put into fixups.
                        </Typography>
                    ) : (
                        <Stack spacing={2}>
                            <Stack
                                direction="row"
                                spacing={1.5}
                                alignItems="flex-start">
                                <TextField
                                    size="small"
                                    label="Name"
                                    value={group.name}
                                    error={groupProblems(selected).some(
                                        (p) =>
                                            p.widget === undefined &&
                                            p.field === "name",
                                    )}
                                    onChange={(e) =>
                                        setGroupName(e.target.value)
                                    }
                                    sx={{ flex: 1 }}
                                />
                                <Tooltip
                                    title={
                                        group.isNew
                                            ? "Get Config blocks read it by this"
                                            : "Get Config blocks read it by this, so it stays as it was saved"
                                    }>
                                    <TextField
                                        size="small"
                                        label="ID"
                                        value={group.id}
                                        disabled={!group.isNew}
                                        error={groupProblems(selected).some(
                                            (p) =>
                                                p.widget === undefined &&
                                                p.field === "id",
                                        )}
                                        onChange={(e) =>
                                            setGroup(selected, {
                                                ...group,
                                                id: e.target.value,
                                                idEdited: true,
                                            })
                                        }
                                        sx={{ width: 260 }}
                                        inputProps={{
                                            style: { fontFamily: "monospace" },
                                        }}
                                    />
                                </Tooltip>
                            </Stack>
                            <TextField
                                size="small"
                                label="Description"
                                multiline
                                minRows={2}
                                value={group.description}
                                onChange={(e) =>
                                    setGroup(selected, {
                                        ...group,
                                        description: e.target.value,
                                    })
                                }
                            />
                            <Problems
                                problems={groupProblems(selected).filter(
                                    (p) => p.widget === undefined,
                                )}
                            />

                            <Box
                                sx={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                }}>
                                <Typography
                                    variant="subtitle1"
                                    sx={{ fontWeight: 600 }}>
                                    Widgets
                                </Typography>
                                <Button
                                    size="small"
                                    variant="outlined"
                                    startIcon={<Add />}
                                    onClick={(e) =>
                                        setAddMenu(e.currentTarget)
                                    }>
                                    Add Widget
                                </Button>
                                <Menu
                                    anchorEl={addMenu}
                                    open={Boolean(addMenu)}
                                    onClose={() => setAddMenu(null)}>
                                    {Object.entries(WIDGET_TYPES).map(
                                        ([type, name]) => (
                                            <MenuItem
                                                key={type}
                                                onClick={() => {
                                                    setAddMenu(null)
                                                    setGroup(selected, {
                                                        ...group,
                                                        widgets: [
                                                            ...group.widgets,
                                                            newWidget(
                                                                type,
                                                                group,
                                                            ),
                                                        ],
                                                    })
                                                }}>
                                                {name}
                                            </MenuItem>
                                        ),
                                    )}
                                </Menu>
                            </Box>

                            {group.widgets.length === 0 && (
                                <Typography
                                    variant="body2"
                                    color="text.secondary">
                                    No widgets yet: add the settings players
                                    change.
                                </Typography>
                            )}
                            {group.widgets.map((widget, i) => (
                                <WidgetCard
                                    key={i}
                                    widget={widget}
                                    group={group}
                                    problems={groupProblems(selected).filter(
                                        (p) => p.widget === i,
                                    )}
                                    first={i === 0}
                                    last={i === group.widgets.length - 1}
                                    onChange={(next) => setWidget(i, next)}
                                    onMove={(by) => {
                                        const widgets = [...group.widgets]
                                        const [moved] = widgets.splice(i, 1)
                                        widgets.splice(i + by, 0, moved)
                                        setGroup(selected, {
                                            ...group,
                                            widgets,
                                        })
                                    }}
                                    onDelete={() =>
                                        setGroup(selected, {
                                            ...group,
                                            widgets: group.widgets.filter(
                                                (_, j) => j !== i,
                                            ),
                                        })
                                    }
                                />
                            ))}

                            <Box>
                                <Button
                                    color="error"
                                    startIcon={<Delete />}
                                    onClick={() =>
                                        setDeleting({ open: true, group })
                                    }>
                                    Delete Group
                                </Button>
                            </Box>
                        </Stack>
                    )}
                </Box>
            </Box>

            {/* Footer */}
            <Box
                sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    p: 2,
                    borderTop: 1,
                    borderColor: "divider",
                    bgcolor: "background.paper",
                }}>
                <Typography
                    variant="body2"
                    color={errorCount > 0 ? "error" : "text.secondary"}
                    sx={{ flex: 1 }}>
                    {errorCount > 0
                        ? `${errorCount} problem${errorCount === 1 ? "" : "s"} to fix before saving`
                        : changed
                          ? "Unsaved changes"
                          : (notice ?? "")}
                </Typography>
                <Button
                    variant="outlined"
                    startIcon={<Undo />}
                    disabled={saving || !changed}
                    onClick={load}>
                    Revert
                </Button>
                <Button
                    variant="contained"
                    startIcon={<CheckCircle />}
                    disabled={saving || !changed || errorCount > 0 || !opened}
                    onClick={save}
                    sx={{ minWidth: 120 }}>
                    {saving ? "Saving..." : "Save"}
                </Button>
            </Box>

            {/* Deleting a group: asked first */}
            <Dialog
                open={deleting.open}
                onClose={closeDelete}
                aria-labelledby="delete-group-title"
                aria-describedby="delete-group-description">
                <DialogTitle id="delete-group-title">
                    Delete Group "{deleting.group?.name || deleting.group?.id}"?
                </DialogTitle>
                <DialogContent>
                    <DialogContentText id="delete-group-description">
                        {deletedWith(deleting.group)}
                        It's gone once you save (Revert brings it back until
                        then).
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={closeDelete}>Cancel</Button>
                    <Button
                        color="error"
                        variant="contained"
                        startIcon={<Delete />}
                        onClick={() => {
                            setGroups((all) =>
                                all.filter((g) => g !== deleting.group),
                            )
                            setSelected((i) => Math.max(0, i - 1))
                            closeDelete()
                        }}>
                        Delete
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    )
}
