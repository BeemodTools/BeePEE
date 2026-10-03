import { useEffect, useState } from "react"
import { Box, Grid } from "@mui/material"
import { useNavigate } from "react-router-dom"
import ItemIcon from "./ItemIcon"
import AddButton from "./AddItem"

function ItemBrowser() {
    const [items, setItems] = useState([])
    const [gridSize, setGridSize] = useState({ cols: 12, rows: 8 })
    const navigate = useNavigate()

    useEffect(() => {
        // Fetch current items on mount (in case package was already loaded)
        const fetchCurrentItems = async () => {
            try {
                const currentItems = await window.package.getCurrentItems?.()
                if (currentItems && currentItems.length > 0) {
                    console.log(
                        `Loaded item list from the open package (${currentItems.length} items)`,
                    )
                    setItems(currentItems)
                }
            } catch (error) {
                console.log(
                    "Could not fetch the current items, waiting for a package to load:",
                    error,
                )
            }
        }
        fetchCurrentItems()

        // Handle initial package load and updates (includes create/delete)
        const handlePackageLoaded = (data) => {
            // Handle both old format (items array) and new format ({ items, signages })
            const loadedItems = Array.isArray(data) ? data : data?.items || []
            console.log(`Loaded item list (${loadedItems.length} items)`)

            setItems(loadedItems)
        }

        // Handle package close
        const handlePackageClosed = () => {
            console.log("Cleared the item list because the package was closed")
            setItems([])
        }

        // Handle individual item updates
        const handleItemUpdated = (event, updatedItem) => {
            if (!updatedItem || !updatedItem.id) {
                console.warn("Skipped an item update that has no item id")
                return
            }

            setItems((currentItems) => {
                const itemIndex = currentItems.findIndex(
                    (item) => item.id === updatedItem.id,
                )
                if (itemIndex === -1) {
                    return [...currentItems, updatedItem]
                } else {
                    return currentItems.map((item) =>
                        item.id === updatedItem.id ? updatedItem : item,
                    )
                }
            })
        }

        // Register listeners
        window.package.onPackageLoaded(handlePackageLoaded)
        window.package.onPackageClosed(handlePackageClosed)
        window.package.onItemUpdated(handleItemUpdated)

        // Add a manual refresh function to window for debugging
        window.refreshItemBrowser = () => {
            console.log("Triggered a manual refresh of the item browser")
            // Try to reload the current package
            if (window.package && window.package.reloadPackage) {
                window.package.reloadPackage()
            }
        }

        // Cleanup function - important for preventing duplicate listeners!
        return () => {
            // Note: The current preload doesn't support unregistering, but this prevents memory leaks
        }
    }, [])

    useEffect(() => {
        const updateGridSize = () => {
            const itemSize = 96
            const spacing = 8
            const totalItemSize = itemSize + spacing

            const cols = Math.floor((window.innerWidth - 40) / totalItemSize)
            const rows = Math.floor((window.innerHeight - 40) / totalItemSize)
            setGridSize({ cols, rows })
        }

        updateGridSize()
        window.addEventListener("resize", updateGridSize)
        return () => window.removeEventListener("resize", updateGridSize)
    }, [])

    const handleEditItem = (itemId) => {
        // Always use the current state to find the item
        const currentItem = items.find((i) => i.id === itemId)
        if (!currentItem) {
            console.warn(
                `Skipped opening the editor for item ${itemId}, it no longer exists`,
            )
            return
        }

        window.package.openItemEditor(currentItem)
    }

    const handleAddItem = async () => {
        try {
            await window.electron.invoke("open-create-item-window")
        } catch (error) {
            console.error("Failed to open create item window:", error)
        }
    }

    const itemsInLastRow = items.length % gridSize.cols
    const placeholdersToCompleteRow =
        itemsInLastRow === 0 ? 0 : gridSize.cols - itemsInLastRow
    const totalPlaceholders = placeholdersToCompleteRow + gridSize.cols

    return (
        <Box sx={{ width: "100%", height: "100vh" }}>
            <Grid container spacing={1} sx={{ py: 2, px: 2 }}>
                {/* Actual items */}
                {items.map((item) => (
                    <Grid key={item.id} size="auto">
                        <ItemIcon
                            item={item}
                            onEdit={() => handleEditItem(item.id)}
                        />
                    </Grid>
                ))}

                {/* Add button - first placeholder */}
                <Grid size="auto">
                    <AddButton onClick={handleAddItem} />
                </Grid>

                {/* Regular placeholder cells */}
                {Array.from({ length: totalPlaceholders - 1 }).map(
                    (_, index) => (
                        <Grid key={`empty-${index}`} size="auto">
                            <Box
                                sx={{
                                    width: 96,
                                    height: 96,
                                    border: "1px dashed #444",
                                    borderRadius: 1,
                                    boxSizing: "border-box",
                                    overflow: "hidden",
                                    cursor: "default",
                                }}
                            />
                        </Grid>
                    ),
                )}
            </Grid>
        </Box>
    )
}

export default ItemBrowser
