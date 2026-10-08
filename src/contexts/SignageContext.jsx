import {
    createContext,
    useContext,
    useState,
    useEffect,
    useCallback,
} from "react"

const SignageContext = createContext()

export const useSignageContext = () => {
    const context = useContext(SignageContext)
    if (!context) {
        throw new Error("useSignageContext must be used within a SignageProvider")
    }
    return context
}

export const SignageProvider = ({ children }) => {
    const [signage, setSignage] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    // Function to update signage data
    const updateSignage = useCallback((newSignageData) => {
        setSignage(newSignageData)
    }, [])

    // Listen for signage updates from backend
    useEffect(() => {
        const handleSignageUpdate = (event, updatedSignage) => {
            setSignage(updatedSignage)
        }

        const handleSignageLoaded = (event, loadedSignage) => {
            console.log(
                `Loaded signage "${loadedSignage.name}" (${loadedSignage.id}) with ${Object.keys(loadedSignage.styles || {}).length} styles`,
            )
            setSignage(loadedSignage)
        }

        // Set up event listeners with error handling
        try {
            if (window.package?.onSignageUpdated) {
                window.package.onSignageUpdated(handleSignageUpdate)
            }
            if (window.package?.onSignageLoaded) {
                window.package.onSignageLoaded(handleSignageLoaded)
            }
        } catch (err) {
            console.error("Failed to set up signage event listeners:", err)
        }

        // Cleanup
        return () => {
            try {
                if (window.package?.onSignageUpdated) {
                    window.package.onSignageUpdated(null)
                }
                if (window.package?.onSignageLoaded) {
                    window.package.onSignageLoaded(null)
                }
            } catch (err) {
                console.error("Failed to remove signage event listeners:", err)
            }
        }
    }, [])

    const value = {
        signage,
        loading,
        error,
        updateSignage,
        setSignage,
    }

    return (
        <SignageContext.Provider value={value}>{children}</SignageContext.Provider>
    )
}
