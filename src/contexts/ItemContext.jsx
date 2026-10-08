import {
    createContext,
    useContext,
    useState,
    useEffect,
    useCallback,
} from "react"

const ItemContext = createContext()

export const useItemContext = () => {
    const context = useContext(ItemContext)
    if (!context) {
        throw new Error("useItemContext must be used within an ItemProvider")
    }
    return context
}

export const ItemProvider = ({ children }) => {
    const [item, setItem] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    // Load the item from the backend again, like after a save: the
    // item-updated events sent while saving come while the editor still has
    // the changes being saved
    const reloadItem = useCallback(async (itemId) => {
        if (!itemId) return null

        setLoading(true)
        setError(null)

        try {
            const result = await window.package.getItem(itemId)
            if (!result?.success) {
                throw new Error(result?.error || "No reason given")
            }
            setItem(result.item)
            return result.item
        } catch (err) {
            console.error(`Failed to reload item ${itemId}:`, err)
            setError(err.message)
            return null
        } finally {
            setLoading(false)
        }
    }, [])

    // Function to update item data
    const updateItem = useCallback((newItemData) => {
        setItem(newItemData)
    }, [])

    // Listen for item updates from backend
    useEffect(() => {
        const handleItemUpdate = (event, updatedItem) => {
            setItem(updatedItem)
        }

        const handleItemLoaded = (event, loadedItem) => {
            const instanceCount = Object.keys(loadedItem.instances || {}).length
            console.log(
                `Loaded item "${loadedItem.name}" into the editor (${instanceCount} instances)`,
            )
            setItem(loadedItem)
        }

        // Set up event listeners with error handling
        try {
            if (window.package?.onItemUpdated) {
                window.package.onItemUpdated(handleItemUpdate)
            }
            if (window.package?.onItemLoaded) {
                window.package.onItemLoaded(handleItemLoaded)
            }
        } catch (err) {
            console.error("Failed to register item event listeners:", err)
        }

        // Cleanup
        return () => {
            try {
                // Remove all listeners for these events
                if (window.package?.onItemUpdated) {
                    window.package.onItemUpdated(null)
                }
                if (window.package?.onItemLoaded) {
                    window.package.onItemLoaded(null)
                }
            } catch (err) {
                console.error("Failed to remove item event listeners:", err)
            }
        }
    }, [])

    const value = {
        item,
        loading,
        error,
        reloadItem,
        updateItem,
        setItem,
    }

    return <ItemContext.Provider value={value}>{children}</ItemContext.Provider>
}
