const { dialog, ipcMain, app } = require("electron")
const { Package } = require("./models/package")
const fs = require("fs")
const path = require("path")
const vdf = require("vdf-parser")
let path7za = require("7zip-bin").path7za
const { extractFull } = require("node-7z")
const { add } = require("node-7z")
const { spawn } = require("child_process")
const { logger } = require("./utils/logger")
const { vmfStatsCache } = require("./utils/vmfParser")
const { getPackagesDir, ensurePackagesDir } = require("./utils/packagesDir")

/** "1 item", "3 items" */
const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`

/** BeePEE's version, for the signature at the top of the files it exports */
const APP_VERSION = require("../package.json").version

// Fix 7zip-bin path for packaged app
// When app is packaged, use extraResources directory
// Use try-catch to handle case where app isn't ready yet (during module loading)
if (app && app.isPackaged) {
    const resourcesPath = process.resourcesPath
    const platform = process.platform
    const arch = process.arch

    // Map Node.js platform names to 7zip-bin directory names
    let platformDir = platform
    if (platform === "win32") {
        platformDir = "win"
    } else if (platform === "darwin") {
        platformDir = "mac"
    } else if (platform === "linux") {
        platformDir = "linux"
    }

    // Determine the correct 7za executable path based on platform
    let execName = "7za"
    if (platform === "win32") {
        execName = "7za.exe"
    }

    // Build the path: resources/extraResources/7zip-bin/{platformDir}/{arch}/{execName}
    const extraResourcesPath = path.join(
        resourcesPath,
        "extraResources",
        "7zip-bin",
        platformDir,
        arch,
        execName
    )

    if (fs.existsSync(extraResourcesPath)) {
        path7za = extraResourcesPath
        console.log(`Using 7-Zip at ${path7za}`)
    } else {
        console.error(`7-Zip not found at ${extraResourcesPath}`)
        try {
            const extraResourcesRoot = path.join(resourcesPath, "extraResources")
            if (fs.existsSync(extraResourcesRoot)) {
                console.log(
                    `extraResources contains: ${fs.readdirSync(extraResourcesRoot).join(", ")}`,
                )
            }
        } catch (e) {
            console.error("Failed to list extraResources:", e)
        }
    }
}

// Global reference to main window for progress updates
let mainWindow = null

// Track current package directory and last saved path
let currentPackageDir = null
let lastSavedBpeePath = null // .bpee the open package was last saved to
let currentPackageSourcePath = null // .bpee/.zip the package was opened from

// Helper function to send progress updates
function sendProgressUpdate(progress, message, error = null) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("package-loading-progress", {
            progress,
            message,
            error,
        })
    }
}

// Helper function to forcefully remove directory using multiple strategies
async function removeDirectoryWithRetry(dirPath, maxRetries = 5) {
    // Clear all window caches first to release any file handles
    await clearAllWindowCaches()

    // Helper to wait
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

    // Helper to make files writable recursively (Windows read-only attribute can cause issues)
    const makeWritable = (dir) => {
        try {
            const items = fs.readdirSync(dir)
            for (const item of items) {
                const fullPath = path.join(dir, item)
                try {
                    const stat = fs.statSync(fullPath)
                    if (stat.isDirectory()) {
                        makeWritable(fullPath)
                    }
                    // Remove read-only attribute
                    fs.chmodSync(fullPath, 0o666)
                } catch (e) {
                    // Ignore errors for individual files
                }
            }
            fs.chmodSync(dir, 0o777)
        } catch (e) {
            // Ignore errors
        }
    }

    // Strategy 1: Try standard rmSync with retries and exponential backoff
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            if (!fs.existsSync(dirPath)) {
                return true // Already gone
            }

            // Make files writable before attempting deletion
            if (attempt > 0) {
                makeWritable(dirPath)
            }

            fs.rmSync(dirPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
            if (attempt > 0) {
                console.log(`Removed ${dirPath} on attempt ${attempt + 1}`)
            }
            return true
        } catch (error) {
            console.warn(
                `Failed to remove ${dirPath} (attempt ${attempt + 1} of ${maxRetries}, ${error.code})`,
            )

            if (attempt < maxRetries - 1) {
                // Exponential backoff: 200ms, 400ms, 800ms, 1600ms
                const delay = 200 * Math.pow(2, attempt)
                await sleep(delay)

                // Force garbage collection if available
                if (global.gc) {
                    global.gc()
                }
            }
        }
    }

    // Strategy 2: Try Windows-specific rd command (sometimes works when Node.js can't)
    if (process.platform === 'win32') {
        try {
            const { execSync } = require('child_process')
            // Use cmd /c rd /s /q which is Windows' native recursive delete
            execSync(`cmd /c rd /s /q "${dirPath}"`, { stdio: 'pipe', timeout: 30000 })

            if (!fs.existsSync(dirPath)) {
                console.log(`Removed ${dirPath} with rd /s /q`)
                return true
            }
        } catch (cmdError) {
            console.warn(
                `Failed to remove ${dirPath} with rd /s /q: ${cmdError.message}`,
            )
        }
    }

    // Strategy 3: Rename-then-delete (last resort)
    const renamedPath = `${dirPath}_deleted_${Date.now()}`
    try {
        fs.renameSync(dirPath, renamedPath)
        console.log(
            `Renamed the locked directory ${dirPath} to ${path.basename(renamedPath)}, deleting it in the background`,
        )

        // Now try to delete the renamed directory in background
        setImmediate(async () => {
            await sleep(500) // Give some time for handles to release
            try {
                fs.rmSync(renamedPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
                console.log(`Deleted ${renamedPath}`)
            } catch (deleteError) {
                console.warn(
                    `Failed to delete ${renamedPath} (${deleteError.code}), will retry on next startup`,
                )
            }
        })
        return true
    } catch (renameError) {
        // If rename fails too, just let the extraction proceed and overwrite
        console.warn(
            `Failed to remove or rename ${dirPath} (${renameError.code}), its files will be overwritten`,
        )
        return false
    }
}

// Clean up any leftover renamed directories from previous sessions
function cleanupDeletedDirectories() {
    const packagesDir = getPackagesDir()
    if (!fs.existsSync(packagesDir)) return

    try {
        const entries = fs.readdirSync(packagesDir, { withFileTypes: true })
        for (const entry of entries) {
            if (entry.isDirectory() && entry.name.includes("_deleted_")) {
                const fullPath = path.join(packagesDir, entry.name)
                try {
                    fs.rmSync(fullPath, { recursive: true, force: true })
                    console.log(`Removed leftover directory ${fullPath}`)
                } catch (e) {
                    // Ignore, will try again next time
                }
            }
        }
    } catch (e) {
        // Ignore errors during cleanup
    }
}

/**
 * Clear all window caches to release file handles
 * This should be called before any directory deletion operations
 */
async function clearAllWindowCaches() {
    const { BrowserWindow } = require("electron")

    // Clear main window cache
    if (mainWindow && !mainWindow.isDestroyed()) {
        try {
            const session = mainWindow.webContents.session
            await session.clearCache()
            await session.clearStorageData({
                storages: ["appcache", "cookies", "filesystem", "indexdb", "localstorage", "shadercache", "websql", "serviceworkers", "cachestorage"],
            })
        } catch (e) {
            console.warn("Failed to clear the main window's cache:", e)
        }
    }

    // Clear all other window caches
    const allWindows = BrowserWindow.getAllWindows()
    for (const win of allWindows) {
        if (win && !win.isDestroyed() && win !== mainWindow) {
            try {
                const session = win.webContents.session
                await session.clearCache()
            } catch (e) {
                // Ignore errors for other windows
            }
        }
    }

    // Force garbage collection if available
    if (global.gc) {
        global.gc()
    }

    // Give time for handles to be released
    await new Promise(resolve => setTimeout(resolve, 300))
}

var packages = []

// Helper function to check if a file is a VDF file
function isVdfFile(filePath) {
    try {
        const content = fs.readFileSync(filePath, "utf-8")
        const lines = content.split("\n")

        // Check if the file contains VDF-like content
        // VDF files typically start with a key and have opening/closing braces
        let hasVdfStructure = false
        let braceCount = 0

        for (const line of lines) {
            const trimmedLine = line.trim()

            // Skip empty lines and comments
            if (!trimmedLine || trimmedLine.startsWith("//")) {
                continue
            }

            // Count braces to check for VDF structure
            if (trimmedLine.includes("{")) {
                braceCount++
                hasVdfStructure = true
            }
            if (trimmedLine.includes("}")) {
                braceCount--
            }

            // If we find a line that looks like a VDF key (no spaces around =, or just a key)
            if (
                trimmedLine.includes("=") ||
                (trimmedLine &&
                    !trimmedLine.includes(" ") &&
                    !trimmedLine.includes("\t"))
            ) {
                hasVdfStructure = true
            }
        }

        // File is VDF if it has VDF structure and balanced braces
        return hasVdfStructure && braceCount === 0
    } catch (error) {
        // If we can't read the file, assume it's not a VDF file
        return false
    }
}

// Helper function to add UUIDs to VBSP blocks that can have duplicates
function addUuidsToVbspConditions(data) {
    const generateUuid = () =>
        `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    function processObject(obj) {
        if (typeof obj !== "object" || obj === null) {
            return obj
        }

        const newObj = {}
        for (const [key, value] of Object.entries(obj)) {
            let newKey = key
            let newValue = value

            // Add UUID to blocks that can have multiple instances
            if (
                (key === "Switch" ||
                    key === "Condition" ||
                    key === "MapInstVar") &&
                typeof value === "object"
            ) {
                newKey = `${key}_${generateUuid()}`
                newValue =
                    typeof value === "object" ? processObject(value) : value
            } else {
                // Recursively process nested objects
                newValue =
                    typeof value === "object" ? processObject(value) : value
            }

            newObj[newKey] = newValue
        }

        return newObj
    }

    return processObject(data)
}

// Helper function to remove UUIDs from VBSP blocks for export
function removeUuidsFromVbspConditions(data) {
    function processObject(obj) {
        if (typeof obj !== "object" || obj === null) {
            return obj
        }

        const newObj = {}
        for (const [key, value] of Object.entries(obj)) {
            let newKey = key
            let newValue = value

            // Remove UUID suffix from blocks that were added during import
            if (
                key.startsWith("Switch_") ||
                key.startsWith("Condition_") ||
                key.startsWith("MapInstVar_")
            ) {
                // Extract the base key name (before the UUID)
                const baseKey = key.split("_")[0]
                newKey = baseKey
                newValue =
                    typeof value === "object" ? processObject(value) : value
            } else {
                // Recursively process nested objects
                newValue =
                    typeof value === "object" ? processObject(value) : value
            }

            newObj[newKey] = newValue
        }

        return newObj
    }

    return processObject(data)
}

// Helper function to check if an object is an array-like object (all keys are sequential numbers)
function isArrayLikeObject(obj) {
    const keys = Object.keys(obj)
    if (keys.length === 0) return false

    // Check if all keys are numeric strings
    const numericKeys = keys.map((k) => parseInt(k, 10))
    if (numericKeys.some((k) => isNaN(k))) return false

    // Check if keys are sequential starting from 0
    numericKeys.sort((a, b) => a - b)
    for (let i = 0; i < numericKeys.length; i++) {
        if (numericKeys[i] !== i) return false
    }

    return true
}

// Helper function to convert JSON to VDF format
// VDF quoted tokens can't contain raw newlines or double quotes (the BEE2
// parser has no escape handling for them) - sanitize so a stray character in
// user-entered text can't produce a malformed file that hangs BEEmod on load
function sanitizeVdfToken(value) {
    return String(value)
        .replace(/\r?\n/g, " ")
        .replace(/"/g, "'")
}

function convertJsonToVdf(jsonData, indent = 0, parentKey = null) {
    const indentStr = "\t".repeat(indent)
    let vdfString = ""

    // Add BeePEE signature, with the version that made the file, at the top
    // of root-level files. parentKey is set when recursing for a root-level
    // array section (e.g. "Signage") with indent still 0 - that's not the
    // file start, so no header there.
    if (indent === 0 && parentKey === null) {
        vdfString += `//Generated by BeePEE v${APP_VERSION} (@https://github.com/BeemodTools/BeePEE )\n`
    }

    if (typeof jsonData !== "object" || jsonData === null) {
        return `"${sanitizeVdfToken(jsonData)}"`
    }

    // Check if this object represents an array (all keys are sequential numbers 0, 1, 2, ...)
    if (isArrayLikeObject(jsonData)) {
        // This is an array - write each element as a separate block with the parent key
        const sortedKeys = Object.keys(jsonData).sort(
            (a, b) => parseInt(a, 10) - parseInt(b, 10),
        )

        // Check if all values are simple (non-object) types
        const allSimpleValues = sortedKeys.every((key) => {
            const value = jsonData[key]
            return typeof value !== "object" || value === null
        })

        if (allSimpleValues && parentKey) {
            // For simple values with a parentKey (like Description or Icon),
            // wrap them in a block with the parent key
            for (const key of sortedKeys) {
                const value = jsonData[key]
                // Use empty string as key for desc_ prefixed keys, otherwise use the numeric key
                vdfString += `${indentStr}"${key}" "${sanitizeVdfToken(value)}"\n`
            }
        } else {
            // For object values, create separate blocks for each element
            for (const key of sortedKeys) {
                const value = jsonData[key]
                if (typeof value === "object" && value !== null) {
                    // Write array element as a separate block
                    // Use the parent key name for each array element
                    if (parentKey) {
                        vdfString += `${indentStr}"${parentKey}"\n${indentStr}{\n`
                        vdfString += convertJsonToVdf(value, indent + 1, null)
                        vdfString += `${indentStr}}\n`
                    }
                }
            }
        }
    } else {
        // Regular object - write key-value pairs
        for (const [key, value] of Object.entries(jsonData)) {
            // Handle desc_ keys - convert them back to empty string keys
            const vdfKey = key.startsWith("desc_") ? "" : key

            // Root-level sections with no entries (e.g. "Item": [] in a
            // signage-only package) would export as an empty block, which
            // BEE2 parses as an object missing its ID and errors on. Omit
            // them - absent and empty mean the same thing to the parser.
            if (
                indent === 0 &&
                typeof value === "object" &&
                value !== null &&
                Object.keys(value).length === 0
            ) {
                continue
            }

            if (typeof value === "object" && value !== null) {
                // Check if the value is an array-like object
                if (isArrayLikeObject(value)) {
                    // Check if all values are simple types
                    const allSimple = Object.values(value).every(
                        (v) => typeof v !== "object" || v === null,
                    )

                    if (allSimple) {
                        // For simple values, write as a block with key-value pairs inside
                        vdfString += `${indentStr}"${vdfKey}"\n${indentStr}{\n`
                        const sortedKeys = Object.keys(value).sort(
                            (a, b) => parseInt(a, 10) - parseInt(b, 10),
                        )
                        for (const k of sortedKeys) {
                            // Handle desc_ prefix - convert to empty string
                            const innerKey = k.startsWith("desc_") ? "" : k
                            vdfString += `${"\t".repeat(indent + 1)}"${innerKey}" "${sanitizeVdfToken(value[k])}"\n`
                        }
                        vdfString += `${indentStr}}\n`
                    } else if (vdfKey === "Instances") {
                        // Special handling for Instances: write as numbered sub-blocks
                        vdfString += `${indentStr}"${vdfKey}"\n${indentStr}{\n`
                        const sortedKeys = Object.keys(value).sort(
                            (a, b) => parseInt(a, 10) - parseInt(b, 10),
                        )
                        for (const k of sortedKeys) {
                            vdfString += `${"\t".repeat(indent + 1)}"${k}"\n${"\t".repeat(indent + 1)}{\n`
                            vdfString += convertJsonToVdf(
                                value[k],
                                indent + 2,
                                null,
                            )
                            vdfString += `${"\t".repeat(indent + 1)}}\n`
                        }
                        vdfString += `${indentStr}}\n`
                    } else if (vdfKey === "SubType") {
                        // Special handling for SubType array: write as repeated "SubType" keys
                        const sortedKeys = Object.keys(value).sort(
                            (a, b) => parseInt(a, 10) - parseInt(b, 10),
                        )
                        for (const k of sortedKeys) {
                            vdfString += `${indentStr}"${vdfKey}"\n${indentStr}{\n`
                            vdfString += convertJsonToVdf(
                                value[k],
                                indent + 1,
                                null,
                            )
                            vdfString += `${indentStr}}\n`
                        }
                    } else {
                        // For other array-like objects with object values, write with repeated parent key
                        vdfString += convertJsonToVdf(value, indent, vdfKey)
                    }
                } else {
                    // Nested object
                    vdfString += `${indentStr}"${vdfKey}"\n${indentStr}{\n`
                    vdfString += convertJsonToVdf(value, indent + 1, null)
                    vdfString += `${indentStr}}\n`
                }
            } else {
                // Simple key-value pair
                vdfString += `${indentStr}"${vdfKey}" "${sanitizeVdfToken(value)}"\n`
            }
        }
    }

    return vdfString
}

// Helper function to convert VDF to JSON
function convertVdfToJson(filePath) {
    try {
        const rawData = fs.readFileSync(filePath, "utf-8")
        let emptyKeyCounter = 0

        // Split into lines and process each line
        const lines = rawData.split("\n")
        const fixedLines = lines.map((line) => {
            return line.replace(/^(\s*)""\s+(".*")/, (match, indent, value) => {
                return `${indent}"desc_${emptyKeyCounter++}" ${value}`
            })
        })

        const parsedData = vdf.parse(fixedLines.join("\n"))

        // Add UUIDs to VBSP condition keys if this is a vbsp_config file
        if (filePath.includes("vbsp_config")) {
            return addUuidsToVbspConditions(parsedData)
        }

        return parsedData
    } catch (error) {
        // Extract item name from file path for better error reporting
        const fileName = path.basename(filePath, ".txt")
        const itemName = fileName.replace(/\.txt$/i, "")

        throw new Error(
            `[${itemName} : ${path.basename(filePath)}]: ${error.message}`,
        )
    }
}

// Helper function to recursively process VDF files
function processVdfFiles(directory) {
    let files
    try {
        files = fs.readdirSync(directory)
    } catch (error) {
        // Skip directories we can't read (locked by another process, permission denied, etc.)
        console.warn(
            `Skipped unreadable directory ${directory} (${error.code || error.message})`,
        )
        return
    }

    for (const file of files) {
        // Skip .bpee directory - it's BeePEE's internal storage (case-insensitive check)
        if (file.toLowerCase() === ".bpee") {
            continue
        }

        const fullPath = path.join(directory, file)
        let stat
        try {
            stat = fs.statSync(fullPath)
        } catch (error) {
            // Skip files/directories we can't stat
            console.warn(
                `Skipped inaccessible path ${fullPath} (${error.code || error.message})`,
            )
            continue
        }

        if (stat.isDirectory()) {
            // Recursively process subdirectories
            processVdfFiles(fullPath)
        } else if (
            file === "info.txt" ||
            file === "editoritems.txt" ||
            file === "properties.txt"
        ) {
            // Always convert these specific files to JSON
            try {
                // Convert VDF to JSON
                const jsonData = convertVdfToJson(fullPath)

                // Save as JSON file (same name but .json extension)
                const jsonPath = fullPath.replace(/\.txt$/i, ".json")
                fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 4))

                // Delete the original .txt file
                fs.unlinkSync(fullPath)
            } catch (error) {
                // The error already contains the file context from convertVdfToJson
                throw error
            }
        } else if (file === "vbsp_config.cfg") {
            // Convert vbsp_config.cfg to JSON
            try {
                // Convert VDF to JSON
                const jsonData = convertVdfToJson(fullPath)

                // Save as JSON file (same name but .json extension)
                const jsonPath = fullPath.replace(/\.cfg$/i, ".json")
                fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 4))

                // Delete the original .cfg file
                fs.unlinkSync(fullPath)
            } catch (error) {
                // The error already contains the file context from convertVdfToJson
                throw error
            }
        } else if (file.endsWith(".vmx")) {
            // Delete .vmx files (not needed)
            fs.unlinkSync(fullPath)
        } else if (file === "editoritems.json") {
            // Ensure instance paths in editoritems.json use .vmf extension
            const jsonData = JSON.parse(fs.readFileSync(fullPath, "utf-8"))
            if (jsonData.Item?.Exporting?.Instances) {
                for (const instance of Object.values(
                    jsonData.Item.Exporting.Instances,
                )) {
                    if (instance.Name) {
                        // Ensure instance paths use .vmf extension
                        instance.Name = instance.Name.replace(
                            /\.json$/i,
                            ".vmf",
                        )
                    }
                }
                fs.writeFileSync(fullPath, JSON.stringify(jsonData, null, 4))
            }
        }
    }
}

// Helper function to recursively process JSON files back to VDF for export
function processJsonFilesToVdf(directory) {
    let files
    try {
        files = fs.readdirSync(directory)
    } catch (error) {
        console.warn(
            `Skipped unreadable directory ${directory} (${error.code || error.message})`,
        )
        return
    }

    for (const file of files) {
        // Skip .bpee directory
        if (file.toLowerCase() === ".bpee") {
            continue
        }

        const fullPath = path.join(directory, file)
        let stat
        try {
            stat = fs.statSync(fullPath)
        } catch (error) {
            console.warn(
                `Skipped inaccessible path ${fullPath} (${error.code || error.message})`,
            )
            continue
        }

        if (stat.isDirectory()) {
            // Recursively process subdirectories
            processJsonFilesToVdf(fullPath)
        } else if (file === "info.json") {
            // Convert info.json to info.txt
            try {
                const jsonData = JSON.parse(fs.readFileSync(fullPath, "utf-8"))
                const vdfString = convertJsonToVdf(jsonData)
                const txtPath = fullPath.replace(/\.json$/i, ".txt")
                fs.writeFileSync(txtPath, vdfString)
                fs.unlinkSync(fullPath)
            } catch (error) {
                throw new Error(
                    `[${path.basename(directory)} : info.json]: ${error.message}`,
                )
            }
        } else if (file === "editoritems.json") {
            // Convert editoritems.json to editoritems.txt
            try {
                const jsonData = JSON.parse(fs.readFileSync(fullPath, "utf-8"))
                const vdfString = convertJsonToVdf(jsonData)
                const txtPath = fullPath.replace(/\.json$/i, ".txt")
                fs.writeFileSync(txtPath, vdfString)
                fs.unlinkSync(fullPath)
            } catch (error) {
                throw new Error(
                    `[${path.basename(directory)} : editoritems.json]: ${error.message}`,
                )
            }
        } else if (file === "properties.json") {
            // Convert properties.json to properties.txt
            try {
                const jsonData = JSON.parse(fs.readFileSync(fullPath, "utf-8"))
                const vdfString = convertJsonToVdf(jsonData)
                const txtPath = fullPath.replace(/\.json$/i, ".txt")
                fs.writeFileSync(txtPath, vdfString)
                fs.unlinkSync(fullPath)
            } catch (error) {
                throw new Error(
                    `[${path.basename(directory)} : properties.json]: ${error.message}`,
                )
            }
        } else if (file === "vbsp_config.json") {
            // Convert vbsp_config.json to vbsp_config.cfg
            try {
                let jsonData = JSON.parse(fs.readFileSync(fullPath, "utf-8"))
                // Remove UUIDs from VBSP conditions before export
                jsonData = removeUuidsFromVbspConditions(jsonData)
                const vdfString = convertJsonToVdf(jsonData)
                const cfgPath = fullPath.replace(/\.json$/i, ".cfg")
                fs.writeFileSync(cfgPath, vdfString)
                fs.unlinkSync(fullPath)
            } catch (error) {
                throw new Error(
                    `[${path.basename(directory)} : vbsp_config.json]: ${error.message}`,
                )
            }
        }
    }
}

// Helper function to update VMF stats for all instances in a package
const updateVMFStatsForPackage = async (packageDir) => {
    return logger.section("Updating VMF stats", async () => {
        try {
            // Find all editoritems.json files in the package
            const findEditorItemsFiles = (dir) => {
                const files = []
                let items
                try {
                    items = fs.readdirSync(dir)
                } catch (error) {
                    console.warn(
                        `Skipped unreadable directory ${dir} (${error.code || error.message})`,
                    )
                    return files
                }

                for (const item of items) {
                    // Skip .bpee directory
                    if (item.toLowerCase() === ".bpee") {
                        continue
                    }

                    const fullPath = path.join(dir, item)
                    let stat
                    try {
                        stat = fs.statSync(fullPath)
                    } catch (error) {
                        console.warn(
                            `Skipped inaccessible path ${fullPath} (${error.code || error.message})`,
                        )
                        continue
                    }

                    if (stat.isDirectory()) {
                        files.push(...findEditorItemsFiles(fullPath))
                    } else if (item === "editoritems.json") {
                        files.push(fullPath)
                    }
                }

                return files
            }

            const editorItemsFiles = findEditorItemsFiles(packageDir)
            let updatedFiles = 0
            // For the log: how many instance files are missing, and where
            let missingFiles = 0
            const itemsWithMissingFiles = new Set()

            if (editorItemsFiles.length > 0) {
                sendProgressUpdate(
                    75,
                    `Analyzing ${editorItemsFiles.length} item files...`,
                )

                for (let i = 0; i < editorItemsFiles.length; i++) {
                    const editorItemsPath = editorItemsFiles[i]
                    const progress =
                        75 + Math.floor((i / editorItemsFiles.length) * 20)
                    sendProgressUpdate(
                        progress,
                        `Analyzing item ${i + 1}/${editorItemsFiles.length}...`,
                    )

                    try {
                        const editorItems = JSON.parse(
                            fs.readFileSync(editorItemsPath, "utf-8"),
                        )
                        let hasChanges = false

                        if (editorItems.Item?.Exporting?.Instances) {
                            for (const [index, instance] of Object.entries(
                                editorItems.Item.Exporting.Instances,
                            )) {
                                if (instance.Name) {
                                    // Check if this is a VMF file (not VBSP)
                                    const isVbspInstance =
                                        instance.Name.includes(
                                            "instances/bee2_dev",
                                        )
                                    if (!isVbspInstance) {
                                        // Build the full path to the VMF file
                                        const instancePath =
                                            instance.Name.replace(
                                                /^instances\/BEE2\//,
                                                "instances/",
                                            )
                                        const fullInstancePath = path.join(
                                            packageDir,
                                            "resources",
                                            instancePath,
                                        )

                                        if (fs.existsSync(fullInstancePath)) {
                                            // Always get VMF stats on import (don't check if they already exist)
                                            const vmfStats =
                                                vmfStatsCache.getStats(
                                                    fullInstancePath,
                                                )

                                            // Always update the instance data with current stats
                                            const updatedInstance = {
                                                ...instance,
                                                EntityCount:
                                                    vmfStats.EntityCount || 0,
                                                BrushCount:
                                                    vmfStats.BrushCount || 0,
                                                BrushSideCount:
                                                    vmfStats.BrushSideCount ||
                                                    0,
                                            }
                                            editorItems.Item.Exporting.Instances[
                                                index
                                            ] = updatedInstance
                                            hasChanges = true
                                            logger.debug(
                                                `${instance.Name}: ${updatedInstance.EntityCount} entities, ${updatedInstance.BrushCount} brushes, ${updatedInstance.BrushSideCount} brush sides`,
                                            )
                                        } else {
                                            missingFiles++
                                            itemsWithMissingFiles.add(
                                                path.basename(
                                                    path.dirname(
                                                        editorItemsPath,
                                                    ),
                                                ),
                                            )
                                            logger.debug(
                                                `Instance file not found: ${instance.Name}`,
                                            )
                                        }
                                    }
                                }
                            }

                            if (hasChanges) {
                                fs.writeFileSync(
                                    editorItemsPath,
                                    JSON.stringify(editorItems, null, 4),
                                )
                                updatedFiles++
                            }
                        }
                    } catch (error) {
                        const itemName = path.basename(
                            path.dirname(editorItemsPath),
                        )
                        console.warn(
                            `Failed to update the VMF stats of item ${itemName}:`,
                            error,
                        )
                    }
                }
            }

            console.log(
                `Updated the VMF stats of ${updatedFiles} of ${plural(editorItemsFiles.length, "item")}`,
            )
            if (missingFiles > 0) {
                console.warn(
                    `Missing ${plural(missingFiles, "instance file")} in ${plural(itemsWithMissingFiles.size, "item")}: ${[...itemsWithMissingFiles].join(", ")}`,
                )
            }
        } catch (error) {
            console.error("Failed to update VMF stats:", error)
        }
    })
}

const unloadPackage = async (packageName, remove = false) => {
    const index = packages.findIndex((pkg) => pkg.name === packageName)
    if (index !== -1) {
        if (remove) {
            const pkg = packages[index]
            // Delete the extracted files if remove is true
            if (pkg.packageDir && fs.existsSync(pkg.packageDir)) {
                await removeDirectoryWithRetry(pkg.packageDir)
            }
        }
        return packages.splice(index, 1)[0]
    }
}

const extractPackage = async (pathToPackage, packageDir) => {
    const stream = extractFull(pathToPackage, packageDir, {
        $bin: path7za,
        recursive: true,
        overwrite: 'a', // Overwrite all existing files without prompt
    })

    // One "data" event per extracted file or folder
    let extractedCount = 0
    stream.on("data", () => {
        extractedCount++
    })

    await new Promise((resolve, reject) => {
        stream.on("end", () => {
            resolve()
        })
        stream.on("error", (error) => {
            console.error(
                `7-Zip failed to extract ${path.basename(pathToPackage)}:`,
                error,
            )
            const rawMessage = String(error.message || error)
            // 7zip reports disk-full as "There is not enough space on the disk",
            // Node as ENOSPC - surface a clear, actionable message instead
            const isDiskFull = /ENOSPC|not enough space|no space left/i.test(
                rawMessage,
            )
            const message = isDiskFull
                ? `Not enough disk space to extract the package. Free up space on the drive containing "${packageDir}" and try again.`
                : `Extraction failed - ${rawMessage}`
            reject(
                new Error(
                    `[package : ${path.basename(pathToPackage)}]: ${message}`,
                ),
            )
        })
    })
    console.log(
        `Extracted ${extractedCount} files and folders to ${packageDir}`,
    )
}

const importPackage = async (pathToPackage) => {
    return logger.section(`Importing package ${pathToPackage}`, async () => {
        let tempPkg = null
        try {
            // Close all editor/preview windows to release file handles
            try {
                const { closeAllWindows } = require("./items/itemEditor")
                await closeAllWindows()
            } catch (e) {
                console.warn("Failed to close the windows before importing:", e)
                // Ignore if itemEditor module not available yet
            }

            // Validate that the file exists and is an archive
            if (!fs.existsSync(pathToPackage)) {
                throw new Error(`Package file not found: ${pathToPackage}`)
            }

            const ext = path.extname(pathToPackage).toLowerCase()
            if (ext !== ".bee_pack" && ext !== ".zip") {
                throw new Error(
                    `Invalid package format. Expected .bee_pack or .zip, got: ${ext}`,
                )
            }

            sendProgressUpdate(0, "Starting package import...")

            tempPkg = new Package(pathToPackage)

            sendProgressUpdate(10, "Preparing package directory...")

            // Packages directory should already be initialized at app startup
            ensurePackagesDir()

            // Try to wipe existing directory first, but don't fail if locked
            if (fs.existsSync(tempPkg.packageDir)) {
                const stat = fs.statSync(tempPkg.packageDir)
                if (stat.isDirectory()) {
                    console.log("Deleting the existing package directory")
                    try {
                        await removeDirectoryWithRetry(tempPkg.packageDir)
                    } catch (deleteError) {
                        console.warn(
                            "Failed to delete the existing package directory, extracting over it:",
                            deleteError,
                        )
                    }
                } else {
                    // If it's a file, remove it
                    fs.unlinkSync(tempPkg.packageDir)
                }
            }
            fs.mkdirSync(tempPkg.packageDir, { recursive: true })

            sendProgressUpdate(20, "Extracting package files...")
            await extractPackage(pathToPackage, tempPkg.packageDir)

            sendProgressUpdate(50, "Processing VDF files...")
            // Process all VDF files recursively
            await logger.section("Converting VDF files to JSON", () => {
                processVdfFiles(tempPkg.packageDir)
                return Promise.resolve()
            })

            sendProgressUpdate(70, "Analyzing VMF files...")
            // Update VMF stats for all instances in the package
            await updateVMFStatsForPackage(tempPkg.packageDir)

            // Don't send 100% here since we're continuing to load
            return true
        } catch (error) {
            console.error("Failed to import package:", error)

            // Send error to frontend
            sendProgressUpdate(100, "Package import failed!", error.message)

            // Cleanup on failure
            if (tempPkg?.packageDir && fs.existsSync(tempPkg.packageDir)) {
                try {
                    fs.rmSync(tempPkg.packageDir, {
                        recursive: true,
                        force: true,
                    })
                    console.log(
                        `Removed the partly imported package directory ${tempPkg.packageDir}`,
                    )
                } catch (cleanupError) {
                    console.error(
                        `Failed to remove the partly imported package directory ${tempPkg.packageDir}:`,
                        cleanupError,
                    )
                }
            }

            // Don't show error dialog since we're already showing it in the loading popup
            // dialog.showErrorBox(
            //     "Package Import Failed",
            //     `Failed to import package ${path.parse(pathToPackage).name}: ${error.message}`,
            // )

            throw error
        }
    })
}

const loadPackage = async (
    pathToPackage,
    skipProgressReset = false,
    alreadyExtracted = false,
) => {
    return logger.section(`Loading package ${pathToPackage}`, async () => {
        let extractionDir = null
        try {
            // Close all editor/preview windows to release file handles before loading
            try {
                const { closeAllWindows } = require("./items/itemEditor")
                await closeAllWindows()
            } catch (e) {
                // Ignore if itemEditor module not available yet
            }

            if (!skipProgressReset) {
                sendProgressUpdate(0, "Starting package load...")
            }

            // Check if the package file exists
            if (!fs.existsSync(pathToPackage)) {
                throw new Error(
                    `[package : ${path.basename(pathToPackage)}]: Package file does not exist`,
                )
            }

            // Determine if we're loading from an already-extracted package (info.json) or an archive
            const isInfoJson = path.basename(pathToPackage) === "info.json"

            let pkg
            let packageDir

            if (isInfoJson) {
                // Loading from already-extracted package directory
                packageDir = path.dirname(pathToPackage)

                // Create a temporary Package instance just to get the packageDir path structure
                // We'll use the actual directory path instead
                pkg = new Package(pathToPackage)
                pkg.packageDir = packageDir // Override with the actual directory

                if (!skipProgressReset) {
                    sendProgressUpdate(50, "Loading extracted package...")
                }
            } else if (alreadyExtracted) {
                // The archive was just extracted and converted by
                // importPackage() - re-extracting would wipe that work
                // (including the VMF stats analysis, which this path
                // doesn't redo) and double the load time.
                console.log("Reading the files extracted by the import")
                pkg = new Package(pathToPackage)
                packageDir = pkg.packageDir
                if (!fs.existsSync(path.join(packageDir, "info.json"))) {
                    throw new Error(
                        `Imported package directory is missing info.json: ${packageDir}`,
                    )
                }
                if (!skipProgressReset) {
                    sendProgressUpdate(50, "Loading imported package...")
                }
            } else {
                // Loading from archive - need to extract

                // Create package instance
                pkg = new Package(pathToPackage)
                packageDir = pkg.packageDir

                if (!skipProgressReset) {
                    sendProgressUpdate(10, "Preparing package directory...")
                }

                // Try to wipe existing directory first, but don't fail if it can't be deleted
                // (antivirus may lock files - 7zip can still overwrite)
                if (fs.existsSync(packageDir)) {
                    console.log("Deleting the previously extracted files")
                    try {
                        await removeDirectoryWithRetry(packageDir)
                    } catch (deleteError) {
                        console.warn(
                            "Failed to delete the previously extracted files, extracting over them:",
                            deleteError,
                        )
                    }
                }
                fs.mkdirSync(packageDir, { recursive: true })
                extractionDir = packageDir

                if (!skipProgressReset) {
                    sendProgressUpdate(20, "Extracting package files...")
                }
                await extractPackage(pathToPackage, packageDir)

                if (!skipProgressReset) {
                    sendProgressUpdate(50, "Processing VDF files...")
                }
                // Process all VDF files recursively (convert .txt to .json)
                await logger.section("Converting VDF files to JSON", () => {
                    processVdfFiles(packageDir)
                    return Promise.resolve()
                })
            }

            if (!skipProgressReset) {
                sendProgressUpdate(80, "Loading package data...")
            }

            // Close existing package
            await closePackage()
            currentPackageDir = null
            lastSavedBpeePath = null
            mainWindow.webContents.send("package:closed")

            // Now load the package
            await pkg.load()
            packages.push(pkg)

            // Set the current package directory
            currentPackageDir = pkg.packageDir
            currentPackageSourcePath = pathToPackage
            notifyPackageStateChanged()

            // Remember the last opened package (for "Open last package on startup")
            try {
                const { getSetting, setSetting } = require("./utils/settings")
                if (getSetting("openLastPackageOnStartup", false)) {
                    setSetting("lastPackagePath", pathToPackage)
                }
            } catch (err) {
                console.warn("Failed to remember the last opened package:", err)
            }

            // Update window title with package name
            if (global.titleManager) {
                global.titleManager.setCurrentPackage(pkg.name)
            }

            if (!skipProgressReset) {
                sendProgressUpdate(100, "Package loaded successfully!")
            }

            return pkg
        } catch (error) {
            console.error("Failed to load package:", error)

            // Clean up a partially extracted directory so a failed load
            // (e.g. disk full) doesn't leave a broken package behind
            if (extractionDir && fs.existsSync(extractionDir)) {
                try {
                    fs.rmSync(extractionDir, { recursive: true, force: true })
                    console.log(
                        `Removed the partly extracted package directory ${extractionDir}`,
                    )
                } catch (cleanupError) {
                    console.warn(
                        `Failed to remove the partly extracted package directory ${extractionDir}:`,
                        cleanupError,
                    )
                }
            }

            // Send error to frontend
            sendProgressUpdate(100, "Package load failed!", error.message)

            throw error
        }
    })
}

const reg_loadPackagePopup = () => {
    ipcMain.handle("dialog:loadPackage", async () => {
        const result = await dialog.showOpenDialog({
            properties: ["openFile"],
            filters: [
                {
                    name: "BeePEE Package",
                    extensions: ["bpee"],
                },
            ],
        })

        if (result.canceled) return null

        const pkg = await loadPackage(result.filePaths[0])

        // Send package loaded event to main window
        if (mainWindow) {
            mainWindow.webContents.send("package:loaded", {
                items: pkg.items.map((item) => item.toJSONWithExistence()),
                signages: pkg.signages,
            })
        }

        return pkg.items // return the package's items
    })
}

/**
 * Zips a package directory into a .bpee file using 7zip.
 * @param {string} packageDir - The directory to zip.
 * @param {string} outputBpeePath - The output .bpee file path.
 * @returns {Promise<void>} Resolves when done, rejects on error.
 */
function savePackageAsBpee(packageDir, outputBpeePath) {
    return logger.section(`Saving package to ${outputBpeePath}`, () => {
        return new Promise((resolve, reject) => {
            const fs = require("fs")
            const path = require("path")
            // Ensure output directory exists
            const outDir = path.dirname(outputBpeePath)
            if (!fs.existsSync(outDir)) {
                fs.mkdirSync(outDir, { recursive: true })
            }

            // Delete existing file if it exists
            if (fs.existsSync(outputBpeePath)) {
                fs.unlinkSync(outputBpeePath)
            }

            // Use 7z command directly to create ZIP format
            // Command: 7za a -tzip output.bpee packageDir\*
            const args = [
                "a", // add to archive
                "-tzip", // use ZIP format
                "-r", // recursive
                outputBpeePath,
                path.join(packageDir, "*"),
            ]

            const process = spawn(path7za, args)

            let errorOutput = ""
            process.stderr.on("data", (data) => {
                errorOutput += data.toString()
            })

            process.on("close", (code) => {
                if (code === 0) {
                    resolve()
                } else {
                    reject(
                        new Error(
                            `7zip failed with code ${code}: ${errorOutput}`,
                        ),
                    )
                }
            })

            process.on("error", (error) => {
                reject(error)
            })
        })
    })
}

/**
 * Exports a package directory as a .bee_pack file using 7zip.
 * Converts all JSON files back to VDF format before archiving.
 * @param {string} packageDir - The directory to export.
 * @param {string} outputBeePackPath - The output .bee_pack file path.
 * @returns {Promise<void>} Resolves when done, rejects on error.
 */
async function exportPackageAsBeePack(packageDir, outputBeePackPath) {
    const title = `Exporting package to ${outputBeePackPath}`
    return logger.section(title, async () => {
        // Create a temporary directory for the export
        const tempExportDir = path.join(
            path.dirname(packageDir),
            `${path.basename(packageDir)}_export_temp`,
        )

        try {
            sendProgressUpdate(0, "Starting package export...")

            // Copy the package directory to a temporary location
            if (fs.existsSync(tempExportDir)) {
                fs.rmSync(tempExportDir, { recursive: true, force: true })
            }

            sendProgressUpdate(10, "Copying package files...")

            // Recursively copy directory
            const copyDir = (src, dest) => {
                fs.mkdirSync(dest, { recursive: true })
                const entries = fs.readdirSync(src, { withFileTypes: true })

                for (const entry of entries) {
                    // Skip .bpee directory - it's only used for local staging and temp files
                    if (entry.name === ".bpee") {
                        logger.debug(`Skipped ${path.join(src, entry.name)}`)
                        continue
                    }

                    const srcPath = path.join(src, entry.name)
                    const destPath = path.join(dest, entry.name)

                    if (entry.isDirectory()) {
                        copyDir(srcPath, destPath)
                    } else {
                        fs.copyFileSync(srcPath, destPath)
                    }
                }
            }

            copyDir(packageDir, tempExportDir)

            sendProgressUpdate(40, "Converting JSON files to VDF format...")

            // Convert all JSON files back to VDF
            processJsonFilesToVdf(tempExportDir)

            sendProgressUpdate(70, "Creating .bee_pack archive...")

            // Ensure output directory exists
            const outDir = path.dirname(outputBeePackPath)
            if (!fs.existsSync(outDir)) {
                fs.mkdirSync(outDir, { recursive: true })
            }

            // Zip the temporary directory as .bee_pack (must be ZIP format)
            // Delete existing file if it exists
            if (fs.existsSync(outputBeePackPath)) {
                fs.unlinkSync(outputBeePackPath)
            }

            await new Promise((resolve, reject) => {
                // Use 7z command directly to create ZIP format
                // Command: 7za a -tzip output.bee_pack tempDir\*
                const args = [
                    "a", // add to archive
                    "-tzip", // use ZIP format
                    "-r", // recursive
                    outputBeePackPath,
                    path.join(tempExportDir, "*"),
                ]

                const process = spawn(path7za, args)

                let errorOutput = ""
                process.stderr.on("data", (data) => {
                    errorOutput += data.toString()
                })

                process.on("close", (code) => {
                    if (code === 0) {
                        resolve()
                    } else {
                        reject(
                            new Error(
                                `7zip failed with code ${code}: ${errorOutput}`,
                            ),
                        )
                    }
                })

                process.on("error", (error) => {
                    reject(error)
                })
            })

            sendProgressUpdate(90, "Cleaning up temporary files...")

            // Clean up temporary directory with retry (Dropbox can cause ENOTEMPTY)
            const cleanupWithRetry = async (dir, retries = 3) => {
                for (let i = 0; i < retries; i++) {
                    try {
                        fs.rmSync(dir, { recursive: true, force: true })
                        return
                    } catch (err) {
                        if (i < retries - 1 && err.code === "ENOTEMPTY") {
                            await new Promise((r) => setTimeout(r, 500))
                        } else {
                            throw err
                        }
                    }
                }
            }
            await cleanupWithRetry(tempExportDir)

            sendProgressUpdate(100, "Package exported successfully!")
        } catch (error) {
            console.error("Failed to export package:", error)

            // Send error to frontend
            sendProgressUpdate(100, "Package export failed!", error.message)

            // Clean up temporary directory on error
            if (fs.existsSync(tempExportDir)) {
                try {
                    fs.rmSync(tempExportDir, { recursive: true, force: true })
                } catch (cleanupError) {
                    console.error(
                        `Failed to remove the temporary export directory ${tempExportDir}:`,
                        cleanupError,
                    )
                }
            }

            throw error
        }
    })
}

/**
 * Clears all contents of the packages directory at the project root.
 * @returns {Promise<void>} Resolves when done, rejects on error.
 */
function clearPackagesDirectory() {
    const packagesDir = getPackagesDir()

    if (!fs.existsSync(packagesDir)) {
        return
    }

    const entries = fs.readdirSync(packagesDir)

    for (const entry of entries) {
        const entryPath = path.join(packagesDir, entry)
        try {
            const stat = fs.statSync(entryPath)
            if (stat.isDirectory()) {
                fs.rmSync(entryPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
            } else {
                fs.unlinkSync(entryPath)
            }
        } catch (error) {
            console.error(`Failed to remove ${entryPath}:`, error)
            // Continue with other entries even if one fails
        }
    }

    console.log(`Cleared the packages directory ${packagesDir}`)
}

const closePackage = async () => {
    const names = packages.map((pkg) => `"${pkg?.name}"`).join(", ")

    // Remove all packages from memory
    packages.length = 0

    // Clear the current package directory so package-dependent
    // features (save/export menu items, etc.) know nothing is loaded
    currentPackageDir = null
    currentPackageSourcePath = null
    lastSavedBpeePath = null
    notifyPackageStateChanged()

    // Clear window title
    if (global.titleManager) {
        global.titleManager.clearPackage()
    }

    if (names) {
        console.log(`Closed package ${names}`)
    }
    return true
}

// Tell the menu to re-evaluate package-dependent items.
// Lazy require to avoid a circular import (menu.js requires this module).
function notifyPackageStateChanged() {
    try {
        require("./menu").updateMenuState()
    } catch (err) {
        // Menu may not be built yet (e.g. during startup)
    }
}

// Function to set main window reference
const setMainWindow = (window) => {
    mainWindow = window
}

// Getter for currentPackageDir
const getCurrentPackageDir = () => currentPackageDir

// Where the loaded package was opened from (.bpee/.zip), if anywhere
const getCurrentPackageSourcePath = () => currentPackageSourcePath

// The .bpee the open package was last saved to, where Save writes again.
// Forgotten when the package is closed or another one is opened, so Save
// never writes one package into another's file.
const getLastSavedBpeePath = () => lastSavedBpeePath
const setLastSavedBpeePath = (bpeePath) => {
    lastSavedBpeePath = bpeePath
}

module.exports = {
    reg_loadPackagePopup,
    loadPackage,
    importPackage,
    unloadPackage,
    packages,
    Package,
    savePackageAsBpee,
    exportPackageAsBeePack,
    clearPackagesDirectory,
    closePackage,
    setMainWindow,
    getCurrentPackageDir,
    getCurrentPackageSourcePath,
    getLastSavedBpeePath,
    setLastSavedBpeePath,
    convertJsonToVdf,
    extractPackage,
    processVdfFiles,
    cleanupDeletedDirectories,
}
