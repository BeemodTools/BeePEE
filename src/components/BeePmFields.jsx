import { useEffect, useMemo, useState } from "react"
import {
    Autocomplete,
    Box,
    Chip,
    InputAdornment,
    MenuItem,
    Stack,
    TextField,
    Typography,
} from "@mui/material"
import { nameProblem, versionProblem } from "../utils/beePm"

/** BEE2 versions a package can need, newest first ("4.46" is BEE2 2.4.46) */
const BEE2_VERSIONS = ["4.46", "4.45", "4.44", "4.43", "4.42", "4.41", "4.40"]

/** "Works with" choices: any version, or a version and newer */
function worksWithOptions(current) {
    const options = [
        { value: "", label: "Any BEE2 version" },
        ...BEE2_VERSIONS.map((version) => ({
            value: `>=2.${version}`,
            label: `BEE2 ${version} and newer`,
        })),
    ]
    // A range bee-package.json already had
    if (current && !options.some(({ value }) => value === current)) {
        options.push({ value: current, label: `BEE2 ${current}` })
    }
    return options
}

/** The Select's value for "" (any version), which MUI shows as empty */
const ANY = "any"

/**
 * Other BeePM packages it needs: picked from a search of BeePM (all of
 * them before anything's typed)
 */
function NeedsField({ dependencies, onChange, disabled, packageId }) {
    const [open, setOpen] = useState(false)
    const [input, setInput] = useState("")
    const [results, setResults] = useState([])
    const [status, setStatus] = useState("idle")
    // Display names of the packages BeePM sent, for the picked ones' chips
    const [displayNames, setDisplayNames] = useState({})
    const rememberNames = (packages) =>
        setDisplayNames((names) => ({
            ...names,
            ...Object.fromEntries(packages.map((p) => [p.name, p.displayName])),
        }))

    // The names of the ones bee-package.json already had (not BEE2's own)
    useEffect(() => {
        const listed = Object.keys(dependencies).some(
            (name) => !name.toLowerCase().startsWith("@beemod/"),
        )
        if (!listed) return
        let cancelled = false
        window.package
            .searchBeePm("")
            .then((result) => {
                if (!cancelled && result?.success) rememberNames(result.packages)
            })
            .catch(() => {})
        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        if (!open) return
        let cancelled = false
        setStatus("loading")
        const timer = setTimeout(
            async () => {
                try {
                    const result = await window.package.searchBeePm(input)
                    if (cancelled) return
                    if (!result?.success) {
                        setStatus("error")
                        return
                    }
                    setResults(result.packages)
                    rememberNames(result.packages)
                    setStatus("done")
                } catch {
                    if (!cancelled) setStatus("error")
                }
            },
            input ? 300 : 0,
        )
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [open, input])

    // The same list until it changes, or the Autocomplete clears what's typed
    const picked = useMemo(
        () => Object.keys(dependencies).map((name) => ({ name })),
        [dependencies],
    )
    const labelOf = (option) =>
        option.displayName ?? displayNames[option.name] ?? option.name
    // Not the package itself, if it's on BeePM already
    const options = results.filter(
        ({ beeId }) =>
            !beeId ||
            !packageId ||
            beeId.toUpperCase() !== packageId.toUpperCase(),
    )

    return (
        <Autocomplete
            multiple
            filterSelectedOptions
            disabled={disabled}
            open={open}
            onOpen={() => setOpen(true)}
            onClose={() => setOpen(false)}
            options={options}
            value={picked}
            inputValue={input}
            onInputChange={(event, value) => setInput(value)}
            onChange={(event, value) =>
                onChange(
                    Object.fromEntries(
                        value.map(({ name, latest }) => [
                            name,
                            // The range it had, or this version and newer
                            // (up to the next major one)
                            dependencies[name] ?? (latest ? `^${latest}` : "*"),
                        ]),
                    ),
                )
            }
            // BeePM's search already matched them
            filterOptions={(found) => found}
            isOptionEqualToValue={(option, value) => option.name === value.name}
            getOptionLabel={labelOf}
            loading={status === "loading"}
            loadingText="Searching BeePM..."
            noOptionsText={
                status === "error" ? "Can't reach BeePM" : "Nothing found"
            }
            renderOption={({ key, ...props }, option) => (
                <Box component="li" key={key} {...props}>
                    <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" noWrap>
                            {option.displayName}
                        </Typography>
                        <Typography
                            variant="caption"
                            color="text.secondary"
                            noWrap
                            component="div">
                            {option.name}
                            {option.latest ? ` · ${option.latest}` : ""}
                        </Typography>
                    </Box>
                </Box>
            )}
            renderValue={(values, getItemProps) =>
                values.map((option, index) => {
                    const { key, ...itemProps } = getItemProps({ index })
                    return (
                        <Chip
                            key={key}
                            {...itemProps}
                            size="small"
                            label={labelOf(option)}
                            title={`${option.name} ${dependencies[option.name] || "*"}`}
                        />
                    )
                })
            }
            renderInput={(params) => (
                <TextField
                    {...params}
                    label="Needs"
                    placeholder={picked.length ? "" : "Search BeePM"}
                    helperText="Other BeePM packages it needs"
                />
            )}
        />
    )
}

/**
 * A package's bee-package.json fields: its name on BeePM, version, the BEE2
 * versions it works with and the BeePM packages it needs.
 * onChange(fields). quietEmptyName: no error for an empty name
 * (a new package's, until it's named). publishedVersion: the highest version
 * BeePM has of it, which the version has to be newer than.
 */
function BeePmFields({
    value,
    onChange,
    disabled = false,
    packageId = "",
    quietEmptyName = false,
    publishedVersion = null,
}) {
    const change = (changes) => onChange({ ...value, ...changes })
    const nameError =
        quietEmptyName && !value.name ? null : nameProblem(value.name)
    const versionError = versionProblem(value.version, publishedVersion)

    return (
        <Stack spacing={2.5}>
            <TextField
                label="BeePM name"
                value={value.name}
                onChange={(e) =>
                    change({
                        name: e.target.value
                            .toLowerCase()
                            .replace(/\s+/g, "-")
                            .replace(/[^a-z0-9._-]/g, ""),
                    })
                }
                fullWidth
                required
                disabled={disabled}
                error={!!nameError}
                helperText={
                    nameError ??
                    (value.scope
                        ? "Its name on BeePM"
                        : "Your BeePM handle is added in front when you publish")
                }
                slotProps={{
                    htmlInput: { maxLength: 64, spellCheck: false },
                    input: {
                        sx: { fontFamily: "monospace" },
                        startAdornment: value.scope ? (
                            <InputAdornment position="start" sx={{ mr: 0 }}>
                                <Typography
                                    sx={{ fontFamily: "monospace" }}
                                    color="text.secondary">
                                    @{value.scope}/
                                </Typography>
                            </InputAdornment>
                        ) : undefined,
                    },
                }}
            />

            <Stack direction="row" spacing={2}>
                <TextField
                    label="Version"
                    value={value.version}
                    onChange={(e) =>
                        change({
                            version: e.target.value.trim().replace(/^v/i, ""),
                        })
                    }
                    required
                    disabled={disabled}
                    error={!!versionError}
                    helperText={
                        versionError ??
                        (publishedVersion ? `BeePM has ${publishedVersion}` : " ")
                    }
                    sx={{ flex: 1 }}
                    slotProps={{ htmlInput: { spellCheck: false } }}
                />
                <TextField
                    select
                    label="Works with"
                    value={value.compatibleWith || ANY}
                    onChange={(e) =>
                        change({
                            compatibleWith:
                                e.target.value === ANY ? "" : e.target.value,
                        })
                    }
                    disabled={disabled}
                    helperText=" "
                    sx={{ flex: 2 }}>
                    {worksWithOptions(value.compatibleWith).map((option) => (
                        <MenuItem
                            key={option.value || ANY}
                            value={option.value || ANY}>
                            {option.label}
                        </MenuItem>
                    ))}
                </TextField>
            </Stack>

            <NeedsField
                dependencies={value.dependencies}
                onChange={(dependencies) => change({ dependencies })}
                disabled={disabled}
                packageId={packageId}
            />
        </Stack>
    )
}

export default BeePmFields
