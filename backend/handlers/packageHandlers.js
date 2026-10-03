/**
 * Package management handlers - create, save, import packages
 */

const { dialog } = require("electron")
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const {
    packages,
    loadPackage,
    importPackage,
    Package,
    getCurrentPackageDir,
    savePackageAsBpee,
} = require("../packageManager")
const {
    createPackageCreationWindow,
    getCreatePackageWindow,
} = require("../items/itemEditor")
const { getPackagesDir } = require("../utils/packagesDir")
const { getLastSavedBpeePath, setLastSavedBpeePath } = require("./shared")

function register(ipcMain, mainWindow) {
    // Open create package window
    ipcMain.handle("open-create-package-window", async () => {
        try {
            createPackageCreationWindow(mainWindow)
            return { success: true }
        } catch (error) {
            console.error("Failed to open the package creation window:", error)
            throw error
        }
    })

    // Confirm close for new package
    ipcMain.handle("confirm-close-for-new-package", async () => {
        try {
            const result = await dialog.showMessageBox(mainWindow, {
                type: "question",
                buttons: ["Cancel", "Discard Changes"],
                defaultId: 0,
                title: "Unsaved Changes",
                message:
                    "You have unsaved changes. Are you sure you want to create a new package?",
            })
            return { confirmed: result.response === 1 }
        } catch (error) {
            return { confirmed: false, error: error.message }
        }
    })

    // Create package
    ipcMain.handle(
        "create-package",
        async (event, { name, description, author }) => {
            try {
                if (!name?.trim()) {
                    throw new Error("Package name is required")
                }

                const packagesDir = getPackagesDir()

                // Generate package ID
                const sanitizedName = name
                    .replace(/[^a-zA-Z0-9]/g, "")
                    .toUpperCase()
                const uuid = crypto
                    .randomBytes(2)
                    .toString("hex")
                    .toUpperCase()
                const packageId = `${sanitizedName}_${uuid}`

                // Create package directory
                const packagePath = path.join(packagesDir, packageId)
                if (fs.existsSync(packagePath)) {
                    throw new Error(
                        "A package with this ID already exists. Please try again.",
                    )
                }

                fs.mkdirSync(packagePath, { recursive: true })
                fs.mkdirSync(path.join(packagePath, "items"))
                fs.mkdirSync(path.join(packagePath, "resources"), {
                    recursive: true,
                })

                // Create info.json
                const packageInfo = {
                    ID: packageId,
                    Name: name,
                    Desc: description || "",
                    Author: author || "Unknown",
                    Item: [],
                }

                const infoPath = path.join(packagePath, "info.json")
                fs.writeFileSync(
                    infoPath,
                    JSON.stringify(packageInfo, null, 2),
                )
                console.log(`Created package "${name}" in ${packagePath}`)

                // Load the package
                const pkg = await loadPackage(infoPath)

                // Send to frontend
                mainWindow.webContents.send("package:loaded", {
                    items: pkg.items.map((item) => item.toJSONWithExistence()),
                    signages: pkg.signages,
                })

                // Close creation window
                const createWindow = getCreatePackageWindow()
                if (createWindow && !createWindow.isDestroyed()) {
                    createWindow.close()
                }

                return { success: true, packageId }
            } catch (error) {
                console.error(`Failed to create package "${name}":`, error)
                dialog.showErrorBox("Failed to Create Package", error.message)
                return { success: false, error: error.message }
            }
        },
    )

    // Get package info
    ipcMain.handle("get-package-info", async () => {
        try {
            const currentPackageDir = getCurrentPackageDir()
            if (!currentPackageDir) {
                return { success: false, error: "No package loaded" }
            }

            const infoPath = path.join(currentPackageDir, "info.json")
            if (!fs.existsSync(infoPath)) {
                return { success: false, error: "info.json not found" }
            }

            const packageInfo = JSON.parse(fs.readFileSync(infoPath, "utf-8"))
            return {
                success: true,
                info: {
                    id: packageInfo.ID,
                    name: packageInfo.Name,
                    description: packageInfo.Desc,
                    author: packageInfo.Author,
                    path: currentPackageDir,
                },
            }
        } catch (error) {
            return { success: false, error: error.message }
        }
    })

    // Update package info
    ipcMain.handle(
        "update-package-info",
        async (event, { name, description, author }) => {
            try {
                const currentPackageDir = getCurrentPackageDir()
                if (!currentPackageDir) {
                    return { success: false, error: "No package loaded" }
                }

                const infoPath = path.join(currentPackageDir, "info.json")
                if (!fs.existsSync(infoPath)) {
                    return { success: false, error: "info.json not found" }
                }

                const packageInfo = JSON.parse(
                    fs.readFileSync(infoPath, "utf-8"),
                )

                // Update fields
                if (name !== undefined) packageInfo.Name = name
                if (description !== undefined) packageInfo.Desc = description
                if (author !== undefined) packageInfo.Author = author

                fs.writeFileSync(infoPath, JSON.stringify(packageInfo, null, 2))

                return { success: true }
            } catch (error) {
                return {
                    success: false,
                    error: error.message || "Failed to update package information",
                }
            }
        },
    )

    // Import package dialog handler
    ipcMain.handle("import-package-dialog", async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ["openFile"],
            filters: [
                {
                    name: "BEEmod Package",
                    extensions: ["bee_pack", "zip"],
                },
            ],
        })

        if (result.canceled) return { success: false, canceled: true }

        try {
            const originalFilePath = result.filePaths[0]

            await importPackage(originalFilePath)

            const packagesDir = getPackagesDir()

            if (!fs.existsSync(packagesDir)) {
                throw new Error(`Packages directory does not exist: ${packagesDir}`)
            }

            const stat = fs.statSync(packagesDir)
            if (!stat.isDirectory()) {
                throw new Error(
                    `Packages path exists but is not a directory: ${packagesDir}`,
                )
            }

            // Find the most recently modified directory
            const packageDirs = fs
                .readdirSync(packagesDir)
                .map((name) => path.join(packagesDir, name))
                .filter((filepath) => {
                    try {
                        return fs.statSync(filepath).isDirectory()
                    } catch (error) {
                        console.error(`Failed to check ${filepath}:`, error)
                        return false
                    }
                })
                .sort((a, b) => {
                    try {
                        return fs.statSync(b).mtime - fs.statSync(a).mtime
                    } catch (error) {
                        console.error(
                            "Failed to sort the package directories by date:",
                            error,
                        )
                        return 0
                    }
                })

            if (packageDirs.length === 0) {
                throw new Error("No package directory found after extraction")
            }

            const extractedPackageDir = packageDirs[0]
            const infoPath = path.join(extractedPackageDir, "info.json")

            mainWindow.webContents.send("package-loading-progress", {
                progress: 80,
                message: "Loading imported package...",
            })

            const pkg = await loadPackage(infoPath)

            mainWindow.webContents.send("package-loading-progress", {
                progress: 100,
                message: "Package imported and loaded successfully!",
            })

            mainWindow.webContents.send("package:loaded", {
                items: pkg.items.map((item) => item.toJSONWithExistence()),
                signages: pkg.signages,
            })

            return { success: true }
        } catch (error) {
            // Import and load failures are logged with their stack already
            console.error(
                `Failed to import ${result.filePaths[0]}: ${error.message}`,
            )
            throw error
        }
    })

    // Save package
    ipcMain.on("save-package", async (event) => {
        try {
            const currentPackageDir = getCurrentPackageDir()
            if (!currentPackageDir) throw new Error("No package loaded")

            const lastPath = getLastSavedBpeePath()
            if (!lastPath) {
                // If no previous path, fall back to Save As
                event.sender.send("request-save-package-as")
                return
            }

            await savePackageAsBpee(currentPackageDir, lastPath)
            event.sender.send("package-saved", { path: lastPath })

            if (global.titleManager) {
                global.titleManager.setUnsavedChanges(false)
            }
        } catch (err) {
            dialog.showErrorBox("Save Failed", err.message)
        }
    })

    // Save package as
    ipcMain.on("save-package-as", async (event) => {
        try {
            const currentPackageDir = getCurrentPackageDir()
            if (!currentPackageDir) throw new Error("No package loaded")

            const { canceled, filePath } = await dialog.showSaveDialog({
                title: "Save Package As",
                defaultPath: "package.bpee",
                filters: [{ name: "BeePEE Package", extensions: ["bpee"] }],
            })

            if (canceled || !filePath) return

            await savePackageAsBpee(currentPackageDir, filePath)
            setLastSavedBpeePath(filePath)
            event.sender.send("package-saved", { path: filePath })

            if (global.titleManager) {
                global.titleManager.setUnsavedChanges(false)
            }
        } catch (err) {
            dialog.showErrorBox("Save As Failed", err.message)
        }
    })

    // Get bee-package.json info (or defaults from info.json)
    ipcMain.handle("get-bee-package-info", async () => {
        try {
            const currentPackageDir = getCurrentPackageDir()
            if (!currentPackageDir) {
                return { success: false, error: "No package loaded" }
            }

            const beePackagePath = path.join(currentPackageDir, "bee-package.json")
            const infoPath = path.join(currentPackageDir, "info.json")

            // Check if bee-package.json exists
            if (fs.existsSync(beePackagePath)) {
                const beePackage = JSON.parse(fs.readFileSync(beePackagePath, "utf-8"))
                return { success: true, info: beePackage, exists: true }
            }

            // Generate defaults from info.json
            if (!fs.existsSync(infoPath)) {
                return { success: false, error: "info.json not found" }
            }

            const packageInfo = JSON.parse(fs.readFileSync(infoPath, "utf-8"))

            // Generate default bee-package.json structure
            const defaultBeePackage = {
                id: packageInfo.ID || "",
                name: packageInfo.Name || "",
                author: packageInfo.Author || "",
                version: "1.0.0",
                compatibleWith: ">=2.4.41",
            }

            return { success: true, info: defaultBeePackage, exists: false }
        } catch (error) {
            return { success: false, error: error.message }
        }
    })

    // Save bee-package.json
    ipcMain.handle("save-bee-package-info", async (event, beePackageData) => {
        try {
            const currentPackageDir = getCurrentPackageDir()
            if (!currentPackageDir) {
                return { success: false, error: "No package loaded" }
            }

            const beePackagePath = path.join(currentPackageDir, "bee-package.json")

            // Validate required fields
            if (!beePackageData.id?.trim()) {
                return { success: false, error: "Package ID is required" }
            }
            if (!beePackageData.name?.trim()) {
                return { success: false, error: "Package name is required" }
            }
            if (!beePackageData.author?.trim()) {
                return { success: false, error: "Author is required" }
            }
            if (!beePackageData.version?.trim()) {
                return { success: false, error: "Version is required" }
            }

            // Build the bee-package.json object
            const beePackage = {
                id: beePackageData.id.trim(),
                name: beePackageData.name.trim(),
                author: beePackageData.author.trim(),
                version: beePackageData.version.trim(),
                compatibleWith: beePackageData.compatibleWith?.trim() || ">=2.4.41",
            }

            fs.writeFileSync(beePackagePath, JSON.stringify(beePackage, null, 2))

            // Written to the working package, not the .bpee
            global.titleManager?.setUnsavedChanges(true)

            return { success: true }
        } catch (error) {
            return { success: false, error: error.message }
        }
    })
}

module.exports = { register }
