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
    showPackageOpenError,
} = require("../packageManager")
const {
    createPackageCreationWindow,
    getCreatePackageWindow,
} = require("../items/itemEditor")
const { getPackagesDir } = require("../utils/packagesDir")
const { getLastSavedBpeePath, setLastSavedBpeePath } = require("./shared")
const {
    problemWith,
    readBeePackage,
    writeBeePackage,
    searchBeePm,
} = require("../utils/beePackage")
const { beePmHandle } = require("../utils/beePmApp")

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
        async (event, { name, description, author, beePackage }) => {
            try {
                if (!name?.trim()) {
                    throw new Error("Package name is required")
                }
                // Whoever's logged in to BeePM, else who they typed. It can't
                // be changed once the package is made.
                const packageAuthor = beePmHandle() ?? author?.trim()
                if (!packageAuthor) throw new Error("Author is required")
                // Its bee-package.json (BeePM's), checked before anything's made
                const beePackageProblem = beePackage && problemWith(beePackage)
                if (beePackageProblem) throw new Error(beePackageProblem)

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
                    Author: packageAuthor,
                    Item: [],
                }

                const infoPath = path.join(packagePath, "info.json")
                fs.writeFileSync(
                    infoPath,
                    JSON.stringify(packageInfo, null, 2),
                )
                if (beePackage) writeBeePackage(packagePath, beePackage)
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
                await showPackageOpenError(
                    null,
                    "Failed to Create Package",
                    error.message,
                    error,
                )
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
            // Its bee-package.json fields (made from its name when it has none)
            const { exists: beePackageExists, ...beePackage } = readBeePackage(
                currentPackageDir,
                packageInfo.Name,
            )
            return {
                success: true,
                info: {
                    id: packageInfo.ID,
                    name: packageInfo.Name,
                    description: packageInfo.Desc,
                    author: packageInfo.Author,
                    path: currentPackageDir,
                },
                beePackage,
                beePackageExists,
            }
        } catch (error) {
            return { success: false, error: error.message }
        }
    })

    // Update package info, and its bee-package.json with beePackage. The
    // author stays: it's set when the package is made.
    ipcMain.handle(
        "update-package-info",
        async (event, { name, description, beePackage }) => {
            try {
                const currentPackageDir = getCurrentPackageDir()
                if (!currentPackageDir) {
                    return { success: false, error: "No package loaded" }
                }

                const infoPath = path.join(currentPackageDir, "info.json")
                if (!fs.existsSync(infoPath)) {
                    return { success: false, error: "info.json not found" }
                }
                // Checked before anything's written
                const beePackageProblem = beePackage && problemWith(beePackage)
                if (beePackageProblem) {
                    return { success: false, error: beePackageProblem }
                }

                const packageInfo = JSON.parse(
                    fs.readFileSync(infoPath, "utf-8"),
                )

                // Update fields
                if (name !== undefined) packageInfo.Name = name
                if (description !== undefined) packageInfo.Desc = description

                fs.writeFileSync(infoPath, JSON.stringify(packageInfo, null, 2))
                if (beePackage) writeBeePackage(currentPackageDir, beePackage)

                // Written to the working package, not the .bpee
                global.titleManager?.setUnsavedChanges(true)

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

    // Who's logged in to BeePM on this PC: a new package's author
    ipcMain.handle("get-beepm-handle", async () => ({ handle: beePmHandle() }))

    // Packages in BeePM, for what a package needs
    ipcMain.handle("search-beepm-packages", async (event, query) => {
        try {
            return { success: true, packages: await searchBeePm(query) }
        } catch (error) {
            return { success: false, error: error.message }
        }
    })
}

module.exports = { register }
