import { useLayoutEffect, useState } from "react"

/**
 * How many cells a row of a wrapping grid holds, measured on the grid
 * itself. A guess from the window's width (minus a margin) is one off at
 * some window sizes, so the empty cells filling the last row didn't reach
 * its end.
 * @param {number} initialColumns - Until the grid is measured
 * @returns {[(element: HTMLElement | null) => void, number]} A ref for the
 *   grid container (its children are the cells; it may appear later), and
 *   its columns
 */
export function useGridColumns(initialColumns = 8) {
    const [grid, setGrid] = useState(null)
    const [columns, setColumns] = useState(initialColumns)

    useLayoutEffect(() => {
        if (!grid) return

        const measure = () => {
            const cells = grid.children
            if (cells.length === 0) return
            const top = cells[0].offsetTop
            let inFirstRow = 1
            while (
                inFirstRow < cells.length &&
                cells[inFirstRow].offsetTop === top
            ) {
                inFirstRow++
            }
            // With a second row, the first holds as many as fit
            if (inFirstRow < cells.length) {
                setColumns(inFirstRow)
                return
            }
            // All in one row: as many as its width fits
            const style = getComputedStyle(grid)
            const width =
                grid.getBoundingClientRect().width -
                parseFloat(style.paddingLeft) -
                parseFloat(style.paddingRight) -
                parseFloat(style.borderLeftWidth) -
                parseFloat(style.borderRightWidth)
            const gap = parseFloat(style.columnGap) || 0
            const cellWidth = cells[0].getBoundingClientRect().width
            if (!cellWidth) return
            setColumns(
                Math.max(
                    inFirstRow,
                    Math.floor((width + gap) / (cellWidth + gap) + 0.001),
                ),
            )
        }

        measure()
        // The window's width changes it, and so do new cells (new rows)
        const observer = new ResizeObserver(measure)
        observer.observe(grid)
        return () => observer.disconnect()
    }, [grid])

    return [setGrid, columns]
}
