import { useEffect, useState } from "react"
import { Alert, Box, Button, Tooltip, Typography } from "@mui/material"
import ColorPicker from "../components/ColorPicker"
import {
    COLOR_TIMERS,
    DEFAULT_TIMER_COLORS,
    EMPTY_COLOR,
    PRESET_COLORS,
    hexToRgb,
    isEmptyColor,
    rgbToHex,
} from "../utils/timerColors"

/** The item and its colors, from the window's address */
function fromAddress() {
    const params = new URLSearchParams(window.location.search)
    let colors = {}
    try {
        colors = JSON.parse(params.get("colors") ?? "{}") ?? {}
    } catch {
        // None: all empty
    }
    return {
        item: { id: params.get("itemId"), name: params.get("itemName") ?? "" },
        colors: { ...DEFAULT_TIMER_COLORS, ...colors },
    }
}

/**
 * The Default Colors window (item editor > Variables > Color): the color
 * players start with for each timer value in BEE2's ItemVar menu, where
 * BEE2 has them (rows of 10, from timer 3), and BeePEE's color picker for
 * the one picked. Save hands them to the item's editor, which saves them
 * with the item.
 */
export default function TimerColorsPage() {
    const [{ item, colors: given }] = useState(fromAddress)
    const [colors, setColors] = useState(given)
    const [selected, setSelected] = useState(COLOR_TIMERS[0])
    const [error, setError] = useState(null)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        document.title = `Default Colors: ${item.name}`
    }, [item])

    const setColor = (timer, color) =>
        setColors((previous) => ({ ...previous, [timer]: color }))
    const allEmpty = COLOR_TIMERS.every((timer) => isEmptyColor(colors[timer]))

    const save = async () => {
        setSaving(true)
        try {
            const result = await window.package.sendTimerColorsToEditor(
                item.id,
                colors,
            )
            if (!result?.success) {
                throw new Error(
                    result?.error ?? "The item's editor didn't get the colors",
                )
            }
            window.close()
        } catch (err) {
            console.error(
                `Failed to hand the default colors of "${item.name}" to its editor:`,
                err,
            )
            setError(err.message)
            setSaving(false)
        }
    }

    return (
        <Box
            sx={{
                height: "100vh",
                display: "flex",
                flexDirection: "column",
                bgcolor: "#1e1e1e",
                color: "white",
            }}>
            <Box sx={{ flex: 1, minHeight: 0, display: "flex", gap: 3, p: 3 }}>
                {/* The swatches: click one to pick its color */}
                <Box sx={{ flex: 1 }}>
                    <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mb: 2.5 }}>
                        The colors players start with in BEE2's ItemVar menu,
                        one for each timer value. Empty ones look empty there.
                    </Typography>
                    <Box
                        sx={{
                            display: "grid",
                            gridTemplateColumns: "repeat(10, 40px)",
                            columnGap: 1.5,
                            rowGap: 1,
                        }}>
                        {COLOR_TIMERS.map((timer) => {
                            const empty = isEmptyColor(colors[timer])
                            const picked = timer === selected
                            return (
                                <Box
                                    key={timer}
                                    sx={{
                                        // Where BEE2's menu has it
                                        gridColumn:
                                            ((Number(timer) - 1) % 10) + 1,
                                        gridRow:
                                            Math.floor(
                                                (Number(timer) - 1) / 10,
                                            ) + 1,
                                        display: "flex",
                                        flexDirection: "column",
                                        alignItems: "center",
                                        gap: 0.5,
                                    }}>
                                    <Tooltip
                                        title={
                                            empty
                                                ? `Timer ${timer}: empty`
                                                : `Timer ${timer}: right-click to empty it`
                                        }>
                                        <Box
                                            role="button"
                                            tabIndex={0}
                                            aria-label={`Timer ${timer}`}
                                            aria-pressed={picked}
                                            onClick={() => setSelected(timer)}
                                            onKeyDown={(e) => {
                                                if (
                                                    e.key === "Enter" ||
                                                    e.key === " "
                                                ) {
                                                    e.preventDefault()
                                                    setSelected(timer)
                                                }
                                            }}
                                            onContextMenu={(e) => {
                                                e.preventDefault()
                                                setColor(timer, EMPTY_COLOR)
                                            }}
                                            sx={{
                                                width: 40,
                                                height: 40,
                                                borderRadius: "6px",
                                                boxSizing: "border-box",
                                                cursor: "pointer",
                                                outline: picked
                                                    ? "2px solid"
                                                    : "none",
                                                outlineColor: "primary.main",
                                                outlineOffset: "2px",
                                                ...(empty
                                                    ? {
                                                          border: "2px dashed rgba(255,255,255,0.25)",
                                                      }
                                                    : {
                                                          border: "1px solid #555",
                                                          backgroundColor:
                                                              rgbToHex(
                                                                  colors[timer],
                                                              ),
                                                      }),
                                                "&:hover, &:focus-visible": {
                                                    borderColor: "primary.main",
                                                },
                                            }}
                                        />
                                    </Tooltip>
                                    <Typography
                                        variant="caption"
                                        color={
                                            picked
                                                ? "primary.main"
                                                : "text.secondary"
                                        }>
                                        {timer}
                                    </Typography>
                                </Box>
                            )
                        })}
                    </Box>
                </Box>

                {/* The picked one's color */}
                <Box
                    sx={{
                        width: 268,
                        flexShrink: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: 1.5,
                        p: 2,
                        borderRadius: 2,
                        bgcolor: "background.paper",
                        border: "1px solid #3a3a3a",
                    }}>
                    <Box
                        sx={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                        }}>
                        <Typography variant="subtitle2">
                            Timer {selected}
                        </Typography>
                        <Button
                            size="small"
                            onClick={() => setColor(selected, EMPTY_COLOR)}
                            disabled={isEmptyColor(colors[selected])}
                            sx={{
                                color: "rgba(255,255,255,0.6)",
                                minWidth: 0,
                            }}>
                            Empty
                        </Button>
                    </Box>
                    <ColorPicker
                        value={rgbToHex(colors[selected])}
                        onChange={(hex) => setColor(selected, hexToRgb(hex))}
                        presets={PRESET_COLORS}
                    />
                </Box>
            </Box>
            <Box
                sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    px: 3,
                    py: 2,
                    borderTop: "1px solid rgba(255,255,255,0.12)",
                }}>
                <Button
                    onClick={() => setColors({ ...DEFAULT_TIMER_COLORS })}
                    disabled={allEmpty}
                    sx={{ color: "rgba(255,255,255,0.6)" }}>
                    Empty All
                </Button>
                {error && (
                    <Alert severity="error" sx={{ py: 0, minWidth: 0 }}>
                        {error}
                    </Alert>
                )}
                <Button
                    onClick={() => window.close()}
                    sx={{ ml: "auto", color: "rgba(255,255,255,0.6)" }}>
                    Cancel
                </Button>
                <Button variant="contained" onClick={save} disabled={saving}>
                    Save
                </Button>
            </Box>
        </Box>
    )
}
