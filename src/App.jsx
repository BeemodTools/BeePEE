import { HashRouter, Routes, Route } from "react-router-dom"
import { useState, useEffect } from "react"
import ItemBrowser from "./components/ItemBrowser"
import MainTabs from "./components/MainTabs"
import ItemEditor from "./components/ItemEditor"
import CreateItemPage from "./pages/CreateItemPage"
import CreatePackagePage from "./pages/CreatePackagePage"
import PackageInformationPage from "./pages/PackageInformationPage"
import ChangelogPage from "./pages/ChangelogPage"
import WelcomePage from "./pages/WelcomePage"
import SetupPage from "./pages/SetupPage"
import SettingsPage from "./pages/SettingsPage"
import ModelPreviewPage from "./pages/ModelPreviewPage"
import LoadingPopup from "./components/LoadingPopup"
import UpdateNotification from "./components/UpdateNotification"
import CrashReportPage from "./pages/CrashReportPage"
import SignageEditor from "./components/SignageEditor"
import SignageDesignerPage from "./pages/SignageDesignerPage"
import ImportItemsPage from "./pages/ImportItemsPage"
import IconMakerPage from "./pages/IconMakerPage"
import TimerColorsPage from "./pages/TimerColorsPage"
import { ItemProvider } from "./contexts/ItemContext"
import { SignageProvider } from "./contexts/SignageContext"
import "./global.css"

function App() {
    // Check if this window should show the editor or create page (for production builds)
    const urlParams = new URLSearchParams(window.location.search)
    const routeParam = urlParams.get("route")
    const showEditor = routeParam === "editor"
    const showCreateItem = routeParam === "create-item"
    const showCreatePackage = routeParam === "create-package"
    const showPackageInformation = routeParam === "package-information"
    const showChangelog = routeParam === "changelog"
    const showModelPreview = routeParam === "model-preview"
    const showCrashReport = routeParam === "crash-report"
    const showSignageEditor = routeParam === "signage-editor"
    const showSignageDesigner = routeParam === "signage-designer"
    const showImportItems = routeParam === "import-items"
    const showIconMaker = routeParam === "icon-maker"
    const showTimerColors = routeParam === "timer-colors"
    const showSettings = routeParam === "settings"
    const showSetup = routeParam === "setup"
    const [packageLoaded, setPackageLoaded] = useState(false)
    const [setupComplete, setSetupComplete] = useState(null) // null = loading, true/false = known
    const [loadingState, setLoadingState] = useState({
        open: false,
        progress: 0,
        message: "Loading...",
        error: null,
        // The package that failed to open, to report it
        failureId: null,
    })
    // Check if setup is complete on mount
    useEffect(() => {
        const checkSetup = async () => {
            if (!window.package?.checkSetupComplete) {
                // If API is not available, assume setup is complete (for backwards compatibility)
                setSetupComplete(true)
                return
            }
            try {
                const result = await window.package.checkSetupComplete()
                setSetupComplete(result.setupComplete)
            } catch (error) {
                console.error("Failed to check setup status:", error)
                // On error, assume setup is complete to avoid blocking
                setSetupComplete(true)
            }
        }
        checkSetup()
    }, [])

    useEffect(() => {
        // window.package should be available immediately after preload script loads
        if (!window.package) {
            console.error("window.package is not available - preload script may have failed")
            return
        }

        // Listen for package loading progress updates
        const handleProgress = (data) => {
            setLoadingState({
                open: true,
                progress: data.progress,
                message: data.message,
                error: data.error || null,
                failureId: data.failureId || null,
            })

            if (data.progress >= 100 && !data.error) {
                setLoadingState((prev) => ({ ...prev, open: false }))
            }
        }

        // Listen for package loaded event
        const handlePackageLoaded = () => {
            setPackageLoaded(true)
        }

        // Listen for package closed event
        const handlePackageClosed = () => {
            setPackageLoaded(false)
        }

        // Register event listeners
        window.package.onPackageLoadingProgress(handleProgress)
        window.package.onPackageLoaded(handlePackageLoaded)
        window.package.onPackageClosed(handlePackageClosed)

        // Cleanup is handled by preload script's event listener management
    }, [])

    return (
        <ItemProvider>
            {showEditor ? (
                // Show ItemEditor directly for production editor windows
                <>
                    <ItemEditor />
                    <LoadingPopup
                        open={loadingState.open}
                        progress={loadingState.progress}
                        message={loadingState.message}
                        error={loadingState.error}
                        onClose={() =>
                            setLoadingState((prev) => ({
                                ...prev,
                                open: false,
                                error: null,
                            }))
                        }
                        onReport={
                            loadingState.failureId
                                ? () => {
                                      window.package.reportFailedPackage?.(
                                          loadingState.failureId,
                                      )
                                      setLoadingState((prev) => ({
                                          ...prev,
                                          open: false,
                                          error: null,
                                      }))
                                  }
                                : undefined
                        }
                    />
                </>
            ) : showCreateItem ? (
                // Show CreateItemPage directly for production create windows
                <CreateItemPage />
            ) : showCreatePackage ? (
                // Show CreatePackagePage directly for production create windows
                <CreatePackagePage />
            ) : showPackageInformation ? (
                // Show PackageInformationPage directly for production windows
                <PackageInformationPage />
            ) : showChangelog ? (
                // Show ChangelogPage directly for production windows
                <ChangelogPage />
            ) : showModelPreview ? (
                // Show ModelPreviewPage directly for production windows
                <ModelPreviewPage />
            ) : showCrashReport ? (
                // Show CrashReportPage directly for production windows
                <CrashReportPage />
            ) : showSignageEditor ? (
                // Show SignageEditor directly for production windows
                <SignageProvider>
                    <SignageEditor />
                </SignageProvider>
            ) : showSignageDesigner ? (
                // Show SignageDesignerPage directly for production windows
                <SignageDesignerPage />
            ) : showImportItems ? (
                // Item Importer window (File > Import from Package...)
                <ImportItemsPage />
            ) : showIconMaker ? (
                // Icon maker window (item editor > Info > Make Icon)
                <IconMakerPage />
            ) : showTimerColors ? (
                // Default Colors window (item editor > Variables > Color)
                <TimerColorsPage />
            ) : showSettings ? (
                // Show SettingsPage directly for production windows
                <SettingsPage />
            ) : showSetup ? (
                // Show SetupPage directly for production setup window
                <SetupPage
                    onSetupComplete={async () => {
                        // Close setup window and signal main window
                        await window.package?.closeSetupWindow?.()
                    }}
                />
            ) : setupComplete === null ? (
                // Still checking setup status - show loading
                <LoadingPopup open={true} progress={0} message="Loading..." />
            ) : !setupComplete ? (
                // Setup not complete - show setup page
                <SetupPage onSetupComplete={() => setSetupComplete(true)} />
            ) : (
                // Use normal routing for main window and development
                <>
                    <HashRouter>
                        <Routes>
                            <Route
                                path="/"
                                element={
                                    packageLoaded ? (
                                        <MainTabs />
                                    ) : (
                                        <WelcomePage />
                                    )
                                }
                            />
                            <Route path="/editor" element={<ItemEditor />} />
                            <Route
                                path="/create-item"
                                element={<CreateItemPage />}
                            />
                            <Route
                                path="/create-package"
                                element={<CreatePackagePage />}
                            />
                            <Route
                                path="/package-information"
                                element={<PackageInformationPage />}
                            />
                            <Route
                                path="/changelog"
                                element={<ChangelogPage />}
                            />
                            <Route
                                path="/model-preview"
                                element={<ModelPreviewPage />}
                            />
                            <Route
                                path="/crash-report"
                                element={<CrashReportPage />}
                            />
                            <Route
                                path="/signage-editor"
                                element={
                                    <SignageProvider>
                                        <SignageEditor />
                                    </SignageProvider>
                                }
                            />
                            <Route
                                path="/signage-designer"
                                element={<SignageDesignerPage />}
                            />
                            <Route
                                path="/import-items"
                                element={<ImportItemsPage />}
                            />
                            <Route
                                path="/settings"
                                element={<SettingsPage />}
                            />
                        </Routes>
                    </HashRouter>
                    <LoadingPopup
                        open={loadingState.open}
                        progress={loadingState.progress}
                        message={loadingState.message}
                        error={loadingState.error}
                        onClose={() =>
                            setLoadingState((prev) => ({
                                ...prev,
                                open: false,
                                error: null,
                            }))
                        }
                        onReport={
                            loadingState.failureId
                                ? () => {
                                      window.package.reportFailedPackage?.(
                                          loadingState.failureId,
                                      )
                                      setLoadingState((prev) => ({
                                          ...prev,
                                          open: false,
                                          error: null,
                                      }))
                                  }
                                : undefined
                        }
                    />
                    <UpdateNotification />
                </>
            )}
        </ItemProvider>
    )
}

export default App
