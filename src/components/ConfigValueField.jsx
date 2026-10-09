import {
    Box,
    Checkbox,
    FormControl,
    InputAdornment,
    InputLabel,
    MenuItem,
    Select,
    TextField,
} from "@mui/material"
import { ColorPickerButton } from "./ColorPicker"
import { PRESET_COLORS, hexToRgb, rgbToHex } from "../utils/bee2Colors"
import { minutesSeconds } from "../utils/configWidgets"

/**
 * A value for a config widget (Package Config), as its type has them: on or
 * off, one of its options, a number, seconds, a color ("R G B") or text.
 * Compact: small, for a timer value's cell.
 */
export default function ConfigValueField({
    widget,
    value,
    onChange,
    label,
    error = false,
    compact = false,
    disabled = false,
}) {
    const text = String(value ?? "")
    // A compact one (a timer value's cell) has its label for screen readers
    // only: the cell says which it is
    const shown = compact ? undefined : label

    switch (widget?.type) {
        case "checkbox":
            return (
                <Checkbox
                    size="small"
                    checked={text === "1"}
                    disabled={disabled}
                    onChange={(e) => onChange(e.target.checked ? "1" : "0")}
                    sx={{ p: compact ? 0.25 : 0.5 }}
                    inputProps={{ "aria-label": label ?? "On" }}
                />
            )

        case "dropdown": {
            const options = widget.options ?? []
            return (
                <FormControl
                    size="small"
                    error={error}
                    disabled={disabled}
                    sx={{
                        minWidth: compact ? 0 : 160,
                        width: compact ? "100%" : undefined,
                    }}>
                    {shown && <InputLabel>{shown}</InputLabel>}
                    <Select
                        value={options.some((o) => o.id === text) ? text : ""}
                        label={shown}
                        inputProps={{ "aria-label": label }}
                        onChange={(e) => onChange(e.target.value)}
                        sx={compact ? { fontSize: "0.75rem" } : undefined}>
                        {options.map((option) => (
                            <MenuItem key={option.id} value={option.id}>
                                {option.label || option.id}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
            )
        }

        case "color":
            return (
                <ColorPickerButton
                    title={label ?? "Pick a color"}
                    value={rgbToHex(text)}
                    onChange={(hex) => onChange(hexToRgb(hex))}
                    presets={PRESET_COLORS}>
                    <Box
                        sx={{
                            width: compact ? 28 : 40,
                            height: compact ? 28 : 40,
                            borderRadius: 1,
                            bgcolor: rgbToHex(text),
                            border: "1px solid",
                            borderColor: error ? "error.main" : "divider",
                            opacity: disabled ? 0.5 : 1,
                        }}
                    />
                </ColorPickerButton>
            )

        case "slider":
            return (
                <TextField
                    size="small"
                    type="number"
                    label={shown}
                    value={text}
                    error={error}
                    disabled={disabled}
                    onChange={(e) => onChange(e.target.value)}
                    inputProps={{
                        min: widget.min === "" ? undefined : widget.min,
                        max: widget.max === "" ? undefined : widget.max,
                        step: widget.step === "" ? undefined : widget.step,
                        "aria-label": label,
                        style: compact
                            ? { fontSize: "0.75rem", padding: 6 }
                            : undefined,
                    }}
                    sx={{ width: compact ? "100%" : 140 }}
                />
            )

        case "timer":
            return (
                <TextField
                    size="small"
                    type="number"
                    label={shown}
                    value={text}
                    error={error}
                    disabled={disabled}
                    onChange={(e) => onChange(e.target.value)}
                    inputProps={{
                        min: 0,
                        step: 1,
                        "aria-label": label,
                        style: compact
                            ? { fontSize: "0.75rem", padding: 6 }
                            : undefined,
                    }}
                    InputProps={
                        compact
                            ? undefined
                            : {
                                  endAdornment: (
                                      <InputAdornment position="end">
                                          s ({minutesSeconds(text)})
                                      </InputAdornment>
                                  ),
                              }
                    }
                    sx={{ width: compact ? "100%" : 180 }}
                />
            )

        default:
            return (
                <TextField
                    size="small"
                    label={shown}
                    value={text}
                    error={error}
                    disabled={disabled}
                    onChange={(e) => onChange(e.target.value)}
                    inputProps={{
                        "aria-label": label,
                        style: compact
                            ? { fontSize: "0.75rem", padding: 6 }
                            : undefined,
                    }}
                    sx={{ width: compact ? "100%" : 240 }}
                />
            )
    }
}
