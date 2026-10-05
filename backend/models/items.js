const fs = require("fs")
const path = require("path")
const { Instance } = require("../items/Instance")
const { vmfStatsCache } = require("../utils/vmfParser")
const {
    GENERATED_HEADER,
    sameEntries,
    stringify,
    toObject,
} = require("../utils/keyvalues")
const {
    RAW_BLOCK,
    readText,
    lineEnd,
    conditionEntries,
    rawBlocks,
    withConditions,
    isEmpty,
    withHeader,
    rawBlockObject,
} = require("../utils/vbspConditions")

/** "1 case", "3 cases" */
const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`

/** `object`'s value for `key` in any case (VDF keys aren't case-sensitive) */
function getKey(object, key) {
    if (!object || typeof object !== "object") return undefined
    if (key in object) return object[key]
    const lower = key.toLowerCase()
    const found = Object.keys(object).find((k) => k.toLowerCase() === lower)
    return found === undefined ? undefined : object[found]
}

/**
 * editoritems with its first "Item" block as Item. A file can have several:
 * BEE2 exports the others along with the item (see saveEditorItems).
 */
function mainItemBlock(editoritems) {
    const key = Object.keys(editoritems ?? {}).find(
        (k) => k.toLowerCase() === "item",
    )
    if (key === undefined) return editoritems
    const { [key]: block, ...rest } = editoritems
    return { ...rest, Item: Array.isArray(block) ? block[0] : block }
}

/**
 * An editoritems instance's VMF path: from its block's "Name", or BEE2's
 * short form, the path itself ("0" "instances/...vmf")
 */
function instanceName(instance) {
    return typeof instance === "string" ? instance : getKey(instance, "Name")
}

/** "ITEM_PLACEMENT_HELPER" -> "Placement Helper" */
function nameFromId(id) {
    return String(id ?? "")
        .replace(/^ITEM_/i, "")
        .split("_")
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ")
}

/** The styles an item's folder is taken from first */
const PREFERRED_STYLES = ["BEE2_CLEAN", "ANY_STYLE"]

/**
 * The folder (items/<folder>) of an item in info.json: from its first
 * version that names one (several "Version" blocks are an array), in
 * BEE2_CLEAN, ANY_STYLE or else the first style. A style's value is a
 * folder, another style's ("<BEE2_CLEAN>"), or a block with a "Folder" or
 * the "Base" style it builds on.
 * @returns {string|null}
 */
function itemFolderOf(itemJSON) {
    const versions = [getKey(itemJSON, "Version")].flat().filter(Boolean)
    for (const version of versions) {
        const styles = getKey(version, "Styles")
        if (!styles || typeof styles !== "object") continue
        const folderOf = (style, seen) => {
            const key = Object.keys(styles).find(
                (k) => k.toLowerCase() === String(style).toLowerCase(),
            )
            if (key === undefined || seen.has(key)) return null
            seen.add(key)
            const value = styles[key]
            if (typeof value === "string") {
                const same = value.trim().match(/^<(.+)>$/)
                return same ? folderOf(same[1], seen) : value.trim() || null
            }
            const folder = getKey(value, "Folder")
            if (typeof folder === "string" && folder.trim()) return folder.trim()
            const base = getKey(value, "Base")
            return typeof base === "string"
                ? folderOf(base.trim().replace(/^<(.+)>$/, "$1"), seen)
                : null
        }
        for (const style of [...PREFERRED_STYLES, ...Object.keys(styles)]) {
            const folder = folderOf(style, new Set())
            if (folder) return folder
        }
    }
    return null
}

class Item {
    constructor({ packagePath, itemJSON }) {
        this.packagePath = packagePath
        this.id = itemJSON.ID

        //get item folder from styles
        const folder = itemFolderOf(itemJSON)
        if (!folder) {
            throw new Error(
                `Item ${this.id}: info.json names no folder for it (Version > Styles)`,
            )
        }

        const fullItemPath = path.join(
            this.packagePath,
            "items",
            folder.toLowerCase(),
        )

        //Paths (now using .json instead of .txt)
        this.paths = {
            editorItems: path.join(fullItemPath, "editoritems.json"),
            properties: path.join(fullItemPath, "properties.json"),
            meta: path.join(fullItemPath, "meta.json"),
        }

        // The VBSP config: vbsp_config.cfg, as the package has it. Items
        // imported before BeePEE kept it have vbsp_config.json instead (read,
        // and replaced by the .cfg when their conditions are saved)
        this.paths.vbsp_cfg = path.join(fullItemPath, "vbsp_config.cfg")
        this.paths.vbsp_config = path.join(fullItemPath, "vbsp_config.json")

        //parse editoritems file
        const where = `items/${folder.toLowerCase()}`
        if (!fs.existsSync(this.paths.editorItems)) {
            throw new Error(`Item ${this.id}: ${where} has no editoritems`)
        }

        const parsedEditoritems = this.getEditorItems()

        //handle both single SubType and array of SubTypes. Items BEE2
        //uses itself (like ITEM_PLACEMENT_HELPER) have no Editor block: they
        //never show in the palette, and are named after their ID.
        const editor = getKey(parsedEditoritems.Item, "Editor")
        this.hasEditor = Boolean(editor)
        const subType = editor ? [getKey(editor, "SubType")].flat()[0] : undefined
        const name = editor ? getKey(subType, "Name") : nameFromId(this.id)
        if (!name) {
            throw new Error(
                `Item ${this.id}: ${where}/editoritems has no Editor > SubType > Name`,
            )
        }

        this.name = name

        // Get MovementHandle from editor properties
        this.movementHandle =
            getKey(editor, "MovementHandle") || "HANDLE_4_DIRECTIONS"

        //Get details. Items BEE2 uses itself (no Editor block) can do
        //without a properties file: they have no palette entry to describe.
        let parsedProperties = { Properties: {} }
        if (fs.existsSync(this.paths.properties)) {
            parsedProperties = JSON.parse(
                fs.readFileSync(this.paths.properties, "utf-8"),
            )
        } else if (this.hasEditor) {
            throw new Error(`Item ${this.id}: ${where} has no properties`)
        }

        this.details = parsedProperties["Properties"]

        //Get icon
        //Since the icon is only half :( we need to merge with full path
        const iconPath = parsedProperties.Properties?.Icon?.["0"]
        this.icon = iconPath
            ? path.join(packagePath, "resources/BEE2/items", iconPath)
            : null

        if (!this.icon) {
            //Icon isnt defined in properties, get it from editoritems
            const rawIconPath = subType?.Palette?.Image
            if (rawIconPath) {
                // Remove "palette/" prefix and build full path
                const cleanIconPath = rawIconPath.split("/").slice(1).join("/")
                this.icon = path.join(
                    packagePath,
                    "resources/BEE2/items",
                    cleanIconPath,
                )
            }
        }

        this.itemFolder = folder.toLowerCase()
        this.fullItemPath = fullItemPath

        // Initialize instances from editoritems
        this.instances = {}
        this._loadedInstances = new Map() // Cache for loaded Instance objects

        // Load metadata
        this.metadata = this.loadMetadata()

        // Add editor instances
        const editorInstances =
            parsedEditoritems.Item?.Exporting?.Instances || {}
        Object.entries(editorInstances).forEach(([key, instance]) => {
            // Skip keys written by the old NaN-index bug so they don't
            // propagate back into editoritems.json or the exported package
            if (key === "NaN" || key.startsWith("pending_")) {
                console.warn(
                    `Skipped invalid instance key "${key}" in the editoritems of item ${this.id}`,
                )
                return
            }
            this.instances[key] = {
                Name: instanceName(instance),
                source: "editor",
            }
        })

        // VBSP instances are now imported on-demand via autoImportVBSPInstances()
        // This is called during package import/load, not every time the item is created
    }

    extractChangeInstances(obj, result) {
        // Recursively search for "Changeinstance" keys in the JSON structure
        if (typeof obj === "object" && obj !== null) {
            for (const [key, value] of Object.entries(obj)) {
                if (key === "Changeinstance") {
                    // Not "" (which removes the instance) or "<ITEM_ID:name>"
                    // (an item's own instance, listed with it): not files
                    for (const instance of [value].flat()) {
                        const vmf =
                            typeof instance === "string" ? instance.trim() : ""
                        if (vmf && !/^<.*>$/.test(vmf)) result.push(vmf)
                    }
                } else if (typeof value === "object") {
                    this.extractChangeInstances(value, result)
                }
            }
        }
    }

    /**
     * Auto-import VBSP instances into this item
     * Called during package import/load, not every time the item is created
     * Returns true if instances were imported, false if already imported or no VBSP config
     */
    autoImportVBSPInstances() {
        // Check if already imported
        const meta = this.getMetadata()
        if (meta._vbsp_imported) {
            return false
        }

        try {
            const vbspData = this.readVbspObject()
            if (!vbspData) return false

            // Extract Changeinstance entries from the JSON structure
            const changeInstances = []
            this.extractChangeInstances(vbspData, changeInstances)

            if (changeInstances.length === 0) {
                return false
            }

            // Start index after the last editor instance
            let nextIndex = Object.keys(this.instances).length

            for (const instancePath of changeInstances) {
                // Only add if not already present (case-insensitive comparison)
                if (
                    !Object.values(this.instances).some(
                        (inst) =>
                            inst.Name?.toLowerCase() ===
                            instancePath.toLowerCase(),
                    )
                ) {
                    this.instances[nextIndex.toString()] = {
                        Name: instancePath,
                        source: "vbsp",
                    }
                    nextIndex++
                }
            }

            // Auto-register VBSP instances in editoritems.json
            this.autoRegisterVbspInstances(changeInstances)

            // Mark as imported in meta.json
            // Frontend will check this flag and skip auto-conversion
            meta._vbsp_imported = true
            meta.isImported = true
            this.saveMetadata(meta)

            return true
        } catch (error) {
            console.error(
                `Failed to import the VBSP instances of "${this.name}":`,
                error,
            )
            return false
        }
    }

    autoRegisterVbspInstances(changeInstances) {
        try {
            // Get current editoritems.json
            const editoritems = this.getEditorItems()

            // Ensure Exporting.Instances structure exists
            if (!editoritems.Item.Exporting) {
                editoritems.Item.Exporting = {}
            }
            if (!editoritems.Item.Exporting.Instances) {
                editoritems.Item.Exporting.Instances = {}
            }

            const existingInstances = editoritems.Item.Exporting.Instances
            const existingInstanceNames = Object.values(existingInstances).map(
                (inst) => inst.Name,
            )
            const existingInstanceNamesLower = existingInstanceNames.map(
                (name) => name.toLowerCase(),
            )

            let addedCount = 0

            // Process each VBSP instance
            for (const instancePath of changeInstances) {
                // Skip if already registered in editoritems.json (case-insensitive comparison)
                if (
                    existingInstanceNamesLower.includes(
                        instancePath.toLowerCase(),
                    )
                ) {
                    continue
                }

                // Find next available index (ignore non-numeric keys so a
                // bad key can't poison Math.max into NaN)
                const numericKeys = Object.keys(existingInstances)
                    .map((k) => parseInt(k, 10))
                    .filter(Number.isInteger)
                const nextIndex =
                    numericKeys.length > 0 ? Math.max(...numericKeys) + 1 : 0

                // Get VMF stats for the instance
                let vmfStats = {
                    EntityCount: 0,
                    BrushCount: 0,
                    BrushSideCount: 0,
                }

                try {
                    // Apply path fixing to remove BEE2/ prefix for actual file structure
                    const actualInstancePath =
                        this.fixInstancePath(instancePath)
                    const fullInstancePath = Instance.getCleanPath(
                        this.packagePath,
                        actualInstancePath,
                    )

                    // Get VMF stats using the cache
                    vmfStats = vmfStatsCache.getStats(fullInstancePath)
                } catch (error) {
                    console.warn(
                        `Failed to get the VMF stats of VBSP instance ${instancePath} of "${this.name}": ${error.message}`,
                    )
                    const meta = this.getMetadata()
                    if (!meta.instanceErrors) {
                        meta.instanceErrors = {}
                    }
                    meta.instanceErrors[nextIndex.toString()] = error.message
                    this.saveMetadata(meta)
                }

                // Add to editoritems.json
                editoritems.Item.Exporting.Instances[nextIndex.toString()] = {
                    Name: instancePath,
                    ...vmfStats,
                }

                addedCount++
            }

            // Save the updated editoritems.json if any instances were added
            if (addedCount > 0) {
                this.saveEditorItems(editoritems)
                console.log(
                    `Registered ${plural(addedCount, "VBSP instance")} in the editoritems of "${this.name}"`,
                )
            }
        } catch (error) {
            console.error(
                `Failed to register the VBSP instances of "${this.name}" in its editoritems:`,
                error,
            )
        }
    }

    reloadInstances() {
        // Clear current instances
        this.instances = {}
        this._loadedInstances.clear()

        // Re-read editoritems file
        const parsedEditoritems = this.getEditorItems()

        // Re-add editor instances
        const editorInstances =
            parsedEditoritems.Item?.Exporting?.Instances || {}
        Object.entries(editorInstances).forEach(([key, instance]) => {
            // Skip keys written by the old NaN-index bug
            if (key === "NaN" || key.startsWith("pending_")) {
                console.warn(
                    `Skipped invalid instance key "${key}" in the editoritems of item ${this.id}`,
                )
                return
            }
            this.instances[key] = {
                Name: instanceName(instance),
                // Preserve VMF stats if they exist in the saved data
                ...(instance.EntityCount !== undefined && {
                    EntityCount: instance.EntityCount,
                }),
                ...(instance.BrushCount !== undefined && {
                    BrushCount: instance.BrushCount,
                }),
                ...(instance.BrushSideCount !== undefined && {
                    BrushSideCount: instance.BrushSideCount,
                }),
            }
        })

        // Re-add VBSP instances if they exist
        if (this.hasVbspConfig()) {
            try {
                const vbspData = this.readVbspObject()

                // Extract Changeinstance entries from the JSON structure
                const changeInstances = []
                this.extractChangeInstances(vbspData, changeInstances)

                // Start index after the last editor instance
                let nextIndex = Object.keys(this.instances).length

                for (const instancePath of changeInstances) {
                    // Only add if not already present (case-insensitive comparison)
                    if (
                        !Object.values(this.instances).some(
                            (inst) =>
                                inst.Name.toLowerCase() ===
                                instancePath.toLowerCase(),
                        )
                    ) {
                        this.instances[nextIndex.toString()] = {
                            Name: instancePath,
                            source: "vbsp",
                        }
                        nextIndex++
                    }
                }

                // Auto-register VBSP instances in editoritems.json
                this.autoRegisterVbspInstances(changeInstances)
            } catch (error) {
                console.error(
                    `Failed to read the VBSP config of "${this.name}":`,
                    error,
                )
            }
        }
    }

    /**
     * Reload all item data from files (name, author, details, etc.)
     * This should be called after saving to ensure the in-memory data matches the saved files
     */
    reloadItemData() {
        try {
            // Re-read editoritems file
            const parsedEditoritems = this.getEditorItems()

            // Update name from editoritems
            const editor = getKey(parsedEditoritems.Item, "Editor") ?? {}
            const subType = [getKey(editor, "SubType")].flat()[0]
            const name = getKey(subType, "Name")
            if (name) {
                this.name = name
            }

            // Update MovementHandle
            this.movementHandle =
                getKey(editor, "MovementHandle") || "HANDLE_4_DIRECTIONS"

            // Re-read properties file
            if (fs.existsSync(this.paths.properties)) {
                const parsedProperties = JSON.parse(
                    fs.readFileSync(this.paths.properties, "utf-8"),
                )
                this.details = parsedProperties["Properties"]

                // Update icon path
                const iconPath = parsedProperties.Properties?.Icon?.["0"]
                this.icon = iconPath
                    ? path.join(
                          this.packagePath,
                          "resources/BEE2/items",
                          iconPath,
                      )
                    : null

                if (!this.icon) {
                    // Icon isn't defined in properties, get it from editoritems
                    const rawIconPath = subType?.Palette?.Image
                    if (rawIconPath) {
                        // Remove "palette/" prefix and build full path
                        const cleanIconPath = rawIconPath
                            .split("/")
                            .slice(1)
                            .join("/")
                        this.icon = path.join(
                            this.packagePath,
                            "resources/BEE2/items",
                            cleanIconPath,
                        )
                    }
                }
            }

            // Also reload instances
            this.reloadInstances()
        } catch (error) {
            console.error(
                `Failed to reload item "${this.name}" from disk:`,
                error,
            )
        }
    }

    /**
     * The item's editoritems. In a file with several "Item" blocks, Item is
     * the first (the item itself); saveEditorItems keeps the others.
     * @param {boolean} [raw] - The file's text instead
     */
    getEditorItems(raw = false) {
        const rawEditoritems = fs.readFileSync(this.paths.editorItems, "utf-8")
        if (raw) {
            return rawEditoritems
        } else {
            return mainItemBlock(JSON.parse(rawEditoritems))
        }
    }

    /**
     * Write the item's editoritems (from getEditorItems). The file's other
     * "Item" blocks, after the first, are kept.
     */
    saveEditorItems(editedJSON) {
        let data = editedJSON
        try {
            const current = JSON.parse(
                fs.readFileSync(this.paths.editorItems, "utf-8"),
            )
            const key = Object.keys(current).find(
                (k) => k.toLowerCase() === "item",
            )
            const blocks = key === undefined ? null : current[key]
            if (
                Array.isArray(blocks) &&
                blocks.length > 1 &&
                !Array.isArray(editedJSON.Item)
            ) {
                data = { ...editedJSON, Item: [editedJSON.Item, ...blocks.slice(1)] }
            }
        } catch {
            // No file yet (or one that can't be read): written as it is
        }
        fs.writeFileSync(
            this.paths.editorItems,
            JSON.stringify(data, null, 4),
            "utf8",
        )
    }

    saveProperties(propertiesJSON) {
        fs.writeFileSync(
            this.paths.properties,
            JSON.stringify(propertiesJSON, null, 4),
            "utf8",
        )
    }

    getInstance(index = "0") {
        // Return cached instance if already loaded
        if (this._loadedInstances.has(index)) {
            return this._loadedInstances.get(index)
        }

        // Check if instance exists
        const instanceData = this.instances[index]
        if (!instanceData) {
            return null
        }

        // Build full path to instance file using Instance class
        const instancePath = Instance.getCleanPath(
            this.packagePath,
            instanceData.Name,
        )

        // Check if file actually exists
        if (!fs.existsSync(instancePath)) {
            return null
        }

        // Create and cache the instance
        const instance = new Instance({ path: instancePath })
        this._loadedInstances.set(index, instance)

        return instance
    }

    getAvailableInstances() {
        return Object.keys(this.instances)
    }

    // Check if an instance file actually exists
    instanceExists(index) {
        const instanceData = this.instances[index]
        if (!instanceData || !instanceData.Name) {
            return false
        }

        // Apply path fixing to remove BEE2/ prefix for actual file structure
        const actualInstancePath = this.fixInstancePath(instanceData.Name)
        const fullInstancePath = Instance.getCleanPath(
            this.packagePath,
            actualInstancePath,
        )

        return fs.existsSync(fullInstancePath)
    }

    // Get only valid instances (files exist)
    getValidInstances() {
        const validInstances = {}

        for (const [index, instanceData] of Object.entries(this.instances)) {
            if (this.instanceExists(index)) {
                validInstances[index] = instanceData
            }
        }

        return validInstances
    }

    // Get instances with VMF stats and metadata
    getInstancesWithStatus() {
        const instancesWithStatus = {}

        for (const [index, instanceData] of Object.entries(this.instances)) {
            const metadata = this.getInstanceMetadata(index)

            // Use saved VMF stats if they exist, otherwise compute them
            let vmfStats = {
                EntityCount: instanceData.EntityCount || 0,
                BrushCount: instanceData.BrushCount || 0,
                BrushSideCount: instanceData.BrushSideCount || 0,
            }

            // Only compute VMF stats if they're not already saved and the file exists and it's not a VBSP instance
            if (
                !instanceData.EntityCount &&
                metadata.exists &&
                metadata.source !== "vbsp"
            ) {
                try {
                    // Apply path fixing to remove BEE2/ prefix for actual file structure
                    const actualInstancePath = this.fixInstancePath(
                        instanceData.Name,
                    )
                    const fullInstancePath = Instance.getCleanPath(
                        this.packagePath,
                        actualInstancePath,
                    )

                    // Get VMF stats using the cache
                    const computedStats =
                        vmfStatsCache.getStats(fullInstancePath)
                    vmfStats = {
                        EntityCount: computedStats.EntityCount || 0,
                        BrushCount: computedStats.BrushCount || 0,
                        BrushSideCount: computedStats.BrushSideCount || 0,
                    }
                } catch (error) {
                    console.error(
                        `Failed to get the VMF stats of instance ${index} of "${this.name}": ${error.message}`,
                    )
                    const meta = this.getMetadata()
                    if (!meta.instanceErrors) {
                        meta.instanceErrors = {}
                    }
                    meta.instanceErrors[index] = error.message
                    this.saveMetadata(meta)
                }
            }

            instancesWithStatus[index] = {
                ...instanceData,
                ...vmfStats,
                // Add metadata for frontend use
                _metadata: metadata,
                // Add custom name
                displayName: this.getInstanceName(index),
            }
        }

        return instancesWithStatus
    }

    // Helper method to determine if an instance is a VBSP instance
    isVbspInstance(instanceData) {
        return (
            instanceData.Name &&
            instanceData.Name.includes("instances/bee2_dev")
        )
    }

    // Helper method to get instance metadata (exists, source type)
    getInstanceMetadata(index) {
        const instanceData = this.instances[index]
        if (!instanceData) {
            return { exists: false, source: "unknown" }
        }

        const exists = this.instanceExists(index)
        const isVbsp = this.isVbspInstance(instanceData)
        const source = isVbsp ? "vbsp" : "editor"

        return { exists, source }
    }

    // Helper function to fix instance paths by removing BEE2/ prefix
    fixInstancePath(instancePath) {
        // Safety check for undefined or null instancePath
        if (!instancePath) {
            return ""
        }

        // Normalize path separators to forward slashes
        let normalizedPath = instancePath.replace(/\\/g, "/")

        if (normalizedPath.startsWith("instances/BEE2/")) {
            return normalizedPath.replace("instances/BEE2/", "instances/")
        }
        if (normalizedPath.startsWith("instances/bee2/")) {
            return normalizedPath.replace("instances/bee2/", "instances/")
        }
        return normalizedPath
    }

    addInstance(instanceName) {
        // Find the next available index. Ignore non-numeric keys - a single
        // bad key (e.g. "NaN") would otherwise poison Math.max and write
        // another "NaN" entry into editoritems.json
        const numericKeys = Object.keys(this.instances)
            .map((k) => parseInt(k, 10))
            .filter(Number.isInteger)
        const nextIndex =
            numericKeys.length > 0 ? Math.max(...numericKeys) + 1 : 0

        // Add the new instance
        this.instances[nextIndex.toString()] = {
            Name: instanceName,
            source: "editor",
        }

        // Update editoritems file
        const editoritems = this.getEditorItems()
        if (!editoritems.Item.Exporting) {
            editoritems.Item.Exporting = {}
        }
        if (!editoritems.Item.Exporting.Instances) {
            editoritems.Item.Exporting.Instances = {}
        }

        // Get VMF stats for the new instance
        let vmfStats = {
            EntityCount: 0,
            BrushCount: 0,
            BrushSideCount: 0,
        }

        try {
            // Apply path fixing to remove BEE2/ prefix for actual file structure
            const actualInstancePath = this.fixInstancePath(instanceName)
            const fullInstancePath = Instance.getCleanPath(
                this.packagePath,
                actualInstancePath,
            )

            // Get VMF stats using the cache
            vmfStats = vmfStatsCache.getStats(fullInstancePath)
        } catch (error) {
            console.error(
                `Failed to get the VMF stats of new instance ${instanceName} of "${this.name}":`,
                error,
            )
            const meta = this.getMetadata()
            if (!meta.instanceErrors) {
                meta.instanceErrors = {}
            }
            meta.instanceErrors[nextIndex.toString()] = error.message
            this.saveMetadata(meta)
        }

        editoritems.Item.Exporting.Instances[nextIndex.toString()] = {
            Name: instanceName,
            EntityCount: vmfStats.EntityCount || 0,
            BrushCount: vmfStats.BrushCount || 0,
            BrushSideCount: vmfStats.BrushSideCount || 0,
        }
        this.saveEditorItems(editoritems)

        // Reload instances from file to ensure consistency
        this.reloadInstances()

        return nextIndex.toString()
    }

    removeInstance(index) {
        const instance = this.instances[index]
        if (!instance) {
            throw new Error(`Instance ${index} not found`)
        }

        // Only allow removing editor instances
        if (instance.source === "vbsp") {
            throw new Error("Cannot remove VBSP instances")
        }

        // Delete the instance file from filesystem if it exists
        try {
            const fs = require("fs")
            const path = require("path")

            // Apply path fixing to remove BEE2/ prefix for actual file structure
            const actualFilePath = this.fixInstancePath(instance.Name)
            const instanceFilePath = path.join(
                this.packagePath,
                "resources",
                actualFilePath,
            )

            if (fs.existsSync(instanceFilePath)) {
                fs.unlinkSync(instanceFilePath)
                console.log(`Deleted instance file ${instanceFilePath}`)

                // Also try to remove the directory if it's empty
                const instanceDir = path.dirname(instanceFilePath)
                try {
                    const files = fs.readdirSync(instanceDir)
                    if (files.length === 0) {
                        fs.rmdirSync(instanceDir)
                        console.log(`Removed empty directory ${instanceDir}`)
                    }
                } catch (dirError) {
                    // Directory not empty or other error, ignore
                }
            } else {
                console.log(
                    `Instance file ${instanceFilePath} doesn't exist, nothing to delete`,
                )
            }
        } catch (fileError) {
            console.error(
                `Failed to delete the file of instance ${index} of "${this.name}":`,
                fileError,
            )
            // Don't throw error, continue with removal from editoritems
        }

        // Remove from memory
        delete this.instances[index]
        this._loadedInstances.delete(index)

        // Update editoritems file
        const editoritems = this.getEditorItems()
        if (editoritems.Item.Exporting?.Instances) {
            delete editoritems.Item.Exporting.Instances[index]
            // If no instances left, clean up the structure
            if (
                Object.keys(editoritems.Item.Exporting.Instances).length === 0
            ) {
                delete editoritems.Item.Exporting.Instances
                if (Object.keys(editoritems.Item.Exporting).length === 0) {
                    delete editoritems.Item.Exporting
                }
            }
            this.saveEditorItems(editoritems)
        }

        // Reload instances from file to ensure consistency
        this.reloadInstances()
    }

    // Check if item has I/O but no ConnectionPoints, and generate defaults if needed
    ensureConnectionPoints() {
        try {
            const editoritems = this.getEditorItems()
            const exporting = editoritems.Item?.Exporting
            if (!exporting) return

            const hasInputs =
                exporting.Inputs && Object.keys(exporting.Inputs).length > 0
            const hasOutputs =
                exporting.Outputs && Object.keys(exporting.Outputs).length > 0
            const hasConnectionPoints = !!exporting.ConnectionPoints

            if ((hasInputs || hasOutputs) && !hasConnectionPoints) {
                editoritems.Item.Exporting.ConnectionPoints =
                    this.generateDefaultConnectionPoints()
                this.saveEditorItems(editoritems)
                console.log(
                    `Added default ConnectionPoints to "${this.name}" (it has inputs or outputs but no ConnectionPoints)`,
                )
            }
        } catch (error) {
            // Silently ignore - item may not have editoritems yet
        }
    }

    // Generate default ConnectionPoints for a 1x1 floor item (8 points, 2 per face)
    generateDefaultConnectionPoints() {
        return {
            Point: [
                { Dir: "1 0 0", Pos: "-1 0 0", SignageOffset: "-2 -1 0", Priority: 0 },
                { Dir: "1 0 0", Pos: "-1 1 0", SignageOffset: "-2 2 0", Priority: 0 },
                { Dir: "-1 0 0", Pos: "2 0 0", SignageOffset: "3 -1 0", Priority: 0 },
                { Dir: "-1 0 0", Pos: "2 1 0", SignageOffset: "3 2 0", Priority: 0 },
                { Dir: "0 1 0", Pos: "0 -1 0", SignageOffset: "-1 -2 0", Priority: 0 },
                { Dir: "0 1 0", Pos: "1 -1 0", SignageOffset: "2 -2 0", Priority: 0 },
                { Dir: "0 -1 0", Pos: "0 2 0", SignageOffset: "-1 3 0", Priority: 0 },
                { Dir: "0 -1 0", Pos: "1 2 0", SignageOffset: "2 3 0", Priority: 0 },
            ],
        }
    }

    // Input management functions
    getInputs() {
        const editoritems = this.getEditorItems()
        return editoritems.Item?.Exporting?.Inputs || {}
    }

    addInput(inputName, inputConfig) {
        if (!inputName || typeof inputName !== "string") {
            throw new Error("Input name must be a non-empty string")
        }

        if (!inputConfig || typeof inputConfig !== "object") {
            throw new Error("Input config must be an object")
        }

        const editoritems = this.getEditorItems()

        // Ensure Exporting structure exists
        if (!editoritems.Item.Exporting) {
            editoritems.Item.Exporting = {}
        }
        if (!editoritems.Item.Exporting.Inputs) {
            editoritems.Item.Exporting.Inputs = {}
        }

        // Add the new input
        editoritems.Item.Exporting.Inputs[inputName] = inputConfig

        // Auto-generate ConnectionPoints if this item has I/O but none defined
        if (!editoritems.Item.Exporting.ConnectionPoints) {
            editoritems.Item.Exporting.ConnectionPoints =
                this.generateDefaultConnectionPoints()
        }

        this.saveEditorItems(editoritems)
        return inputName
    }

    updateInput(inputName, inputConfig) {
        if (!inputName || typeof inputName !== "string") {
            throw new Error("Input name must be a non-empty string")
        }

        const editoritems = this.getEditorItems()

        // Check if input exists
        if (!editoritems.Item?.Exporting?.Inputs?.[inputName]) {
            throw new Error(`Input '${inputName}' not found`)
        }

        if (!inputConfig || typeof inputConfig !== "object") {
            throw new Error("Input config must be an object")
        }

        // Update the input
        editoritems.Item.Exporting.Inputs[inputName] = inputConfig

        this.saveEditorItems(editoritems)
        return inputName
    }

    removeInput(inputName) {
        if (!inputName || typeof inputName !== "string") {
            throw new Error("Input name must be a non-empty string")
        }

        const editoritems = this.getEditorItems()

        // Check if input exists
        if (!editoritems.Item?.Exporting?.Inputs?.[inputName]) {
            throw new Error(`Input '${inputName}' not found`)
        }

        // Remove the input
        delete editoritems.Item.Exporting.Inputs[inputName]

        // Clean up empty structures
        if (Object.keys(editoritems.Item.Exporting.Inputs).length === 0) {
            delete editoritems.Item.Exporting.Inputs
            if (Object.keys(editoritems.Item.Exporting).length === 0) {
                delete editoritems.Item.Exporting
            }
        }

        this.saveEditorItems(editoritems)
        return inputName
    }

    // Utility function to get a specific input
    getInput(inputName) {
        if (!inputName || typeof inputName !== "string") {
            throw new Error("Input name must be a non-empty string")
        }

        const inputs = this.getInputs()
        return inputs[inputName] || null
    }

    // Utility function to check if an input exists
    hasInput(inputName) {
        if (!inputName || typeof inputName !== "string") {
            throw new Error("Input name must be a non-empty string")
        }

        const inputs = this.getInputs()
        return inputName in inputs
    }

    // Output management functions
    getOutputs() {
        const editoritems = this.getEditorItems()
        return editoritems.Item?.Exporting?.Outputs || {}
    }

    addOutput(outputName, outputConfig) {
        if (!outputName || typeof outputName !== "string") {
            throw new Error("Output name must be a non-empty string")
        }

        if (!outputConfig || typeof outputConfig !== "object") {
            throw new Error("Output config must be an object")
        }

        const editoritems = this.getEditorItems()

        // Ensure Exporting structure exists
        if (!editoritems.Item.Exporting) {
            editoritems.Item.Exporting = {}
        }
        if (!editoritems.Item.Exporting.Outputs) {
            editoritems.Item.Exporting.Outputs = {}
        }

        // Add the new output
        editoritems.Item.Exporting.Outputs[outputName] = outputConfig

        // Auto-generate ConnectionPoints if this item has I/O but none defined
        if (!editoritems.Item.Exporting.ConnectionPoints) {
            editoritems.Item.Exporting.ConnectionPoints =
                this.generateDefaultConnectionPoints()
        }

        this.saveEditorItems(editoritems)
        return outputName
    }

    updateOutput(outputName, outputConfig) {
        if (!outputName || typeof outputName !== "string") {
            throw new Error("Output name must be a non-empty string")
        }

        const editoritems = this.getEditorItems()

        // Check if output exists
        if (!editoritems.Item?.Exporting?.Outputs?.[outputName]) {
            throw new Error(`Output '${outputName}' not found`)
        }

        if (!outputConfig || typeof outputConfig !== "object") {
            throw new Error("Output config must be an object")
        }

        // Update the output
        editoritems.Item.Exporting.Outputs[outputName] = outputConfig

        this.saveEditorItems(editoritems)
        return outputName
    }

    removeOutput(outputName) {
        if (!outputName || typeof outputName !== "string") {
            throw new Error("Output name must be a non-empty string")
        }

        const editoritems = this.getEditorItems()

        // Check if output exists
        if (!editoritems.Item?.Exporting?.Outputs?.[outputName]) {
            throw new Error(`Output '${outputName}' not found`)
        }

        // Remove the output
        delete editoritems.Item.Exporting.Outputs[outputName]

        // Clean up empty structures
        if (Object.keys(editoritems.Item.Exporting.Outputs).length === 0) {
            delete editoritems.Item.Exporting.Outputs
            if (Object.keys(editoritems.Item.Exporting).length === 0) {
                delete editoritems.Item.Exporting
            }
        }

        this.saveEditorItems(editoritems)
        return outputName
    }

    // Utility function to get a specific output
    getOutput(outputName) {
        if (!outputName || typeof outputName !== "string") {
            throw new Error("Output name must be a non-empty string")
        }

        const outputs = this.getOutputs()
        return outputs[outputName] || null
    }

    // Utility function to check if an output exists
    hasOutput(outputName) {
        if (!outputName || typeof outputName !== "string") {
            throw new Error("Output name must be a non-empty string")
        }

        const outputs = this.getOutputs()
        return outputName in outputs
    }

    // Variables management functions
    getVariables() {
        try {
            // Read editoritems.json to get Properties section
            if (!fs.existsSync(this.paths.editorItems)) {
                return []
            }

            const editorItems = this.getEditorItems()

            const properties = editorItems?.Item?.Properties
            if (!properties) {
                return []
            }

            // Convert Properties object to array format expected by frontend
            const variables = []
            let index = 0

            for (const [key, value] of Object.entries(properties)) {
                // Skip non-variable properties (like ConnectionCount which isn't a VBSP variable)
                if (this.isVBSPVariable(key)) {
                    variables.push({
                        id: `var_${index}`,
                        presetKey: key,
                        displayName: this.getDisplayNameForVariable(key),
                        fixupName: this.getFixupNameForVariable(key),
                        description: this.getDescriptionForVariable(key),
                        defaultValue: value.DefaultValue?.toString() || "0",
                        type: this.getVariableType(key),
                        enumValues: this.getEnumValuesForVariable(key),
                        customValue: value.DefaultValue?.toString() || "0",
                        index: value.Index || index,
                    })
                    index++
                }
            }

            // Sort by index to maintain order
            variables.sort((a, b) => a.index - b.index)
            return variables
        } catch (error) {
            console.error(
                `Failed to read the variables of "${this.name}":`,
                error,
            )
            return []
        }
    }

    saveVariables(variables) {
        try {
            // Read current editoritems.json
            if (!fs.existsSync(this.paths.editorItems)) {
                throw new Error("editoritems.json not found")
            }

            const editorItems = this.getEditorItems()

            // Initialize Properties section if it doesn't exist
            if (!editorItems.Item.Properties) {
                editorItems.Item.Properties = {}
            }

            // Check if ButtonType variable is being added
            const hasButtonType = variables.some(
                (v) => v.presetKey === "ButtonType",
            )
            const hadButtonType = "ButtonType" in editorItems.Item.Properties

            // Clear existing VBSP variables
            for (const key of Object.keys(editorItems.Item.Properties)) {
                if (this.isVBSPVariable(key)) {
                    delete editorItems.Item.Properties[key]
                }
            }

            // Add new variables (starting from index 2 since index 1 is ConnectionCount)
            variables.forEach((variable, index) => {
                if (variable.presetKey) {
                    editorItems.Item.Properties[variable.presetKey] = {
                        DefaultValue: this.convertValueToCorrectType(
                            variable.customValue,
                            variable.type,
                        ),
                        Index: index + 2,
                    }
                }
            })

            // Handle ButtonType SubType generation
            const currentSubType = editorItems.Item.Editor.SubType

            if (hasButtonType) {
                // ButtonType exists - ensure we have 3 SubTypes
                // Always rebuild Editor to ensure correct key order
                const otherEditorProps = {}
                for (const [key, value] of Object.entries(
                    editorItems.Item.Editor,
                )) {
                    if (key !== "SubType" && key !== "SubTypeProperty") {
                        otherEditorProps[key] = value
                    }
                }

                const subTypeArray = Array.isArray(currentSubType)
                    ? currentSubType.length === 3
                        ? currentSubType
                        : [
                              currentSubType[0] || {},
                              currentSubType[0] || {},
                              currentSubType[0] || {},
                          ]
                    : [
                          { ...currentSubType },
                          { ...currentSubType },
                          { ...currentSubType },
                      ]

                // Rebuild with correct order: SubTypeProperty first, then SubType, then others
                editorItems.Item.Editor = {
                    SubTypeProperty: "ButtonType",
                    SubType: subTypeArray,
                    ...otherEditorProps,
                }
            } else {
                // No ButtonType - ensure we have single SubType
                if (
                    Array.isArray(currentSubType) &&
                    currentSubType.length > 0
                ) {
                    // Rebuild Editor object without SubTypeProperty
                    const otherEditorProps = {}
                    for (const [key, value] of Object.entries(
                        editorItems.Item.Editor,
                    )) {
                        if (key !== "SubType" && key !== "SubTypeProperty") {
                            otherEditorProps[key] = value
                        }
                    }

                    editorItems.Item.Editor = {
                        SubType: currentSubType[0],
                        ...otherEditorProps,
                    }
                    console.log(
                        `Reduced "${this.name}" to a single SubType (it has no ButtonType variable)`,
                    )
                }
            }

            // Write back to file
            this.saveEditorItems(editorItems)

            // Auto-generate VBSP conditions for ButtonType if needed
            if (hasButtonType) {
                this.autoGenerateButtonTypeConditions(editorItems)
            }

            return true
        } catch (error) {
            console.error(
                `Failed to save the variables of "${this.name}":`,
                error,
            )
            return false
        }
    }

    // Auto-generate VBSP conditions for ButtonType
    autoGenerateButtonTypeConditions(editorItems) {
        try {
            // Get all instances
            const instances = editorItems.Item.Exporting.Instances
            if (!instances || Object.keys(instances).length === 0) {
                console.log(
                    `Skipped generating ButtonType conditions for "${this.name}", it has no instances`,
                )
                return
            }

            // Create switch cases for each instance
            const cases = []
            for (const [index, instanceData] of Object.entries(instances)) {
                const instanceIndex = parseInt(index, 10)
                cases.push({
                    id: `case_${instanceIndex}`,
                    type: "case",
                    value: instanceIndex.toString(),
                    thenBlocks: [
                        {
                            id: `changeInstance_${instanceIndex}`,
                            type: "changeInstance",
                            instanceIndex: instanceIndex,
                        },
                    ],
                })
            }

            // Create the switch block
            const switchBlock = {
                id: "switch_button_type_auto",
                type: "switchCase",
                variable: "button_type",
                method: "first",
                cases: cases,
            }

            // Load existing blocks
            let existingBlocks = []
            try {
                const conditions = this.getConditions()
                if (conditions.blocks && Array.isArray(conditions.blocks)) {
                    existingBlocks = conditions.blocks
                }
            } catch (e) {
                // No existing conditions, start fresh
            }

            // Check if a button_type switch already exists
            const hasButtonTypeSwitch = existingBlocks.some(
                (block) =>
                    (block.type === "switchCase" ||
                        block.type === "switchGlobal") &&
                    block.variable === "button_type",
            )

            if (!hasButtonTypeSwitch) {
                // Add the new switch block, and save it with the others
                existingBlocks.push(switchBlock)
                this.saveConditions({ blocks: existingBlocks })

                console.log(
                    `Generated ButtonType conditions for "${this.name}" with ${plural(cases.length, "case")}`,
                )
            }
        } catch (error) {
            console.error(
                `Failed to generate ButtonType conditions for "${this.name}":`,
                error,
            )
        }
    }

    // Helper methods for variable management
    isVBSPVariable(key) {
        // List of known VBSP variable keys (excludes ConnectionCount which is at index 1)
        const vbspVariables = [
            "StartEnabled",
            "StartActive",
            "StartDeployed",
            "StartOpen",
            "StartLocked",
            "StartReversed",
            "AutoDrop",
            "AutoRespawn",
            "TimerDelay",
            "CubeType",
        ]
        return vbspVariables.includes(key)
    }

    getDisplayNameForVariable(key) {
        const displayNames = {
            StartEnabled: "Start Enabled",
            StartActive: "Start Active",
            StartDeployed: "Start Deployed",
            StartOpen: "Start Open",
            StartLocked: "Start Locked",
            StartReversed: "Start Reversed",
            AutoDrop: "Auto Drop",
            AutoRespawn: "Auto Respawn",
            TimerDelay: "Timer Delay",
            CubeType: "Cube Type",
        }
        return displayNames[key] || key
    }

    getFixupNameForVariable(key) {
        const fixupNames = {
            StartEnabled: "$start_enabled",
            StartActive: "$start_active",
            StartDeployed: "$start_deployed",
            StartOpen: "$start_open",
            StartLocked: "$start_locked",
            StartReversed: "$start_reversed",
            AutoDrop: "$disable_autodrop",
            AutoRespawn: "$disable_autorespawn",
            TimerDelay: "$timer_delay",
            CubeType: "$cube_type",
        }
        return fixupNames[key] || `$${key.toLowerCase()}`
    }

    getDescriptionForVariable(key) {
        const descriptions = {
            StartEnabled: "Whether the entity starts enabled",
            StartActive: "Whether the entity starts active",
            StartDeployed: "Whether the entity starts deployed",
            StartOpen: "Whether the entity starts open",
            StartLocked: "Whether the entity starts locked",
            StartReversed: "Whether the entity starts reversed",
            AutoDrop: "Disable automatic dropping",
            AutoRespawn: "Disable automatic respawning",
            TimerDelay: "Delay before timer activation",
            CubeType: "Type of cube to spawn",
        }
        return descriptions[key] || `VBSP variable: ${key}`
    }

    getVariableType(key) {
        const types = {
            StartEnabled: "boolean",
            StartActive: "boolean",
            StartDeployed: "boolean",
            StartOpen: "boolean",
            StartLocked: "boolean",
            StartReversed: "boolean",
            AutoDrop: "boolean",
            AutoRespawn: "boolean",
            TimerDelay: "number",
            CubeType: "enum",
        }
        return types[key] || "string"
    }

    getEnumValuesForVariable(key) {
        const enumValues = {
            CubeType: {
                0: "Standard",
                1: "Companion",
                2: "Reflective",
                3: "Sphere",
                4: "Franken",
            },
        }
        return enumValues[key] || null
    }

    convertValueToCorrectType(value, type) {
        switch (type) {
            case "boolean":
                return value === "1" || value === true ? 1 : 0
            case "number":
                return parseInt(value) || 0
            case "enum":
                return parseInt(value) || 0
            default:
                return value
        }
    }

    // Helper function to normalize blocks (ensure all case blocks have value property)
    normalizeBlocks(blocks) {
        const normalizeBlock = (block) => {
            // Ensure case blocks always have a value property
            // Use "0" as default since empty strings are now skipped during VBSP conversion
            if (
                block.type === "case" &&
                (block.value === undefined || block.value === "")
            ) {
                console.warn(
                    `Case block ${block.id} of "${this.name}" has no value, using "0" (change it to the right value)`,
                )
                block.value = "0"
            }

            // Recursively normalize child blocks
            if (block.thenBlocks && Array.isArray(block.thenBlocks)) {
                block.thenBlocks = block.thenBlocks.map(normalizeBlock)
            }
            if (block.elseBlocks && Array.isArray(block.elseBlocks)) {
                block.elseBlocks = block.elseBlocks.map(normalizeBlock)
            }
            if (block.cases && Array.isArray(block.cases)) {
                block.cases = block.cases.map(normalizeBlock)
            }

            return block
        }

        return blocks.map(normalizeBlock)
    }

    /** Whether the item has a VBSP config */
    hasVbspConfig() {
        return (
            fs.existsSync(this.paths.vbsp_cfg) ||
            fs.existsSync(this.paths.vbsp_config)
        )
    }

    /**
     * The VBSP config's text and its encoding: vbsp_config.cfg, or one
     * written from the vbsp_config.json of an older import. Null when the
     * item has none.
     */
    readVbspText() {
        if (fs.existsSync(this.paths.vbsp_cfg)) {
            return readText(this.paths.vbsp_cfg)
        }
        if (fs.existsSync(this.paths.vbsp_config)) {
            // Required here: packageManager requires this file
            const {
                convertJsonToVdf,
                removeUuidsFromVbspConditions,
            } = require("../packageManager")
            const json = JSON.parse(
                fs.readFileSync(this.paths.vbsp_config, "utf-8"),
            )
            return {
                text: convertJsonToVdf(removeUuidsFromVbspConditions(json)),
                encoding: "utf8",
            }
        }
        return null
    }

    /** The VBSP config as a JS object (a repeated key's values in an array) */
    readVbspObject() {
        if (fs.existsSync(this.paths.vbsp_cfg)) {
            return toObject(readText(this.paths.vbsp_cfg).text)
        }
        if (fs.existsSync(this.paths.vbsp_config)) {
            return JSON.parse(fs.readFileSync(this.paths.vbsp_config, "utf-8"))
        }
        return null
    }

    /**
     * The condition blocks: the ones the editor saved (meta.json), while
     * saving them would write the conditions the VBSP config has. Otherwise
     * (the file changed since, or was never saved by the editor) the file's
     * conditions, each a raw block: its text, as it is in the file. With
     * error when the VBSP config can't be read.
     */
    getConditions() {
        let saved = null
        if (fs.existsSync(this.paths.meta)) {
            try {
                const metaData = JSON.parse(
                    fs.readFileSync(this.paths.meta, "utf-8"),
                )
                if (Array.isArray(metaData.vbsp_blocks)) {
                    // Normalize blocks to ensure all case blocks have a value property
                    saved = this.normalizeBlocks(metaData.vbsp_blocks)
                }
            } catch (metaError) {
                console.warn(
                    `Failed to read the condition blocks in meta.json of "${this.name}", using its VBSP config:`,
                    metaError,
                )
            }
        }

        try {
            const vbsp = this.readVbspText()
            if (!vbsp) return { blocks: saved ?? [] }
            if (saved && this.writesConditionsOf(vbsp.text, saved)) {
                return { blocks: saved }
            }
            if (saved) {
                console.warn(
                    `The VBSP config of "${this.name}" has other conditions than its saved blocks write (it changed since they were saved), so they're shown as the file has them`,
                )
            }
            return { blocks: rawBlocks(vbsp.text) }
        } catch (error) {
            console.error(
                `Failed to read the VBSP config of "${this.name}":`,
                error,
            )
            return {
                blocks: [],
                error: `Its VBSP config can't be read (${error.message}), so BeePEE leaves it as it is`,
            }
        }
    }

    /** Whether saving `blocks` would write the conditions `text` has */
    writesConditionsOf(text, blocks) {
        try {
            const written = this.vbspTextWith(text, blocks)
            return sameEntries(conditionEntries(written), conditionEntries(text))
        } catch {
            return false
        }
    }

    /**
     * The VBSP config's text with its conditions replaced by `blocks`': raw
     * blocks as their text was, the others written from their blocks
     */
    vbspTextWith(text, blocks) {
        const eol = lineEnd(text)
        const written = this.blockConditions(blocks)
        const objects = new Map(blocks.map((block, i) => [block, written[i]]))
        return withConditions(text, blocks, (block) => {
            const condition = { Condition: objects.get(block) }
            return eol + stringify(condition, 1, eol).slice(0, -eol.length)
        })
    }

    /**
     * Save the condition blocks: in meta.json, and in the VBSP config, where
     * they replace what's in "Conditions". A raw block is written as its text
     * was; the rest of the file stays as it is. Throws if the VBSP config
     * can't be read (and leaves it as it is).
     */
    saveConditions(conditions) {
        if (!Array.isArray(conditions?.blocks)) {
            throw new Error("The conditions to save aren't a list of blocks")
        }
        const blocks = this.normalizeBlocks(conditions.blocks)

        const current = this.readVbspText()
        const updated = this.vbspTextWith(current?.text ?? "", blocks)

        if (isEmpty(updated)) {
            for (const file of [this.paths.vbsp_cfg, this.paths.vbsp_config]) {
                if (fs.existsSync(file)) fs.unlinkSync(file)
            }
        } else {
            fs.mkdirSync(path.dirname(this.paths.vbsp_cfg), { recursive: true })
            fs.writeFileSync(
                this.paths.vbsp_cfg,
                withHeader(updated, GENERATED_HEADER),
                current?.encoding ?? "utf8",
            )
            // The .cfg has the conditions now (see readVbspText)
            if (fs.existsSync(this.paths.vbsp_config)) {
                fs.unlinkSync(this.paths.vbsp_config)
            }
        }

        // The blocks, for the editor
        const metaData = fs.existsSync(this.paths.meta)
            ? JSON.parse(fs.readFileSync(this.paths.meta, "utf-8"))
            : {}
        if (blocks.length > 0) metaData.vbsp_blocks = blocks
        else delete metaData.vbsp_blocks
        delete metaData._vbsp_conditions_imported
        fs.writeFileSync(
            this.paths.meta,
            JSON.stringify(metaData, null, 4),
            "utf-8",
        )
        // Sync in-memory metadata to prevent stale data
        // (prevents updateMetadata() from overwriting vbsp_blocks)
        this.metadata = metaData
        return true
    }

    /**
     * Each top-level block as the VBSP condition it writes (with an Instance
     * test for this item), and null for a raw block (its text is its
     * condition)
     */
    blockConditions(blockList) {
        const applyTimerLogic = (variableName, value) => {
            if (!variableName) return value
            const cleanVariableName = variableName.replace(/^\\$/, "")
            if (
                cleanVariableName === "timer_delay" ||
                cleanVariableName === "TimerDelay"
            ) {
                const numValue = Number(value)
                if (!isNaN(numValue)) {
                    if (numValue >= 0 && numValue <= 30) return numValue
                    return 0 // default to infinite for out-of-range values
                }
            }
            return value
        }

        // Helper function to convert boolean values
        const convertBooleanValue = (value, variableName = "") => {
            // If value is explicitly provided, convert it
            if (value !== undefined && value !== null && value !== "") {
                if (value === true || value === "true") return "1"
                if (value === false || value === "false") return "0"
                return value.toString()
            }

            // If no value provided, check if it's a boolean variable and provide default
            if (variableName) {
                // Remove $ prefix if present for comparison
                const cleanVariableName = variableName.replace(/^\$/, "")

                // Check if the variable name suggests it's a boolean variable
                const booleanVariables = [
                    "StartEnabled",
                    "StartActive",
                    "StartDeployed",
                    "StartOpen",
                    "StartLocked",
                    "StartReversed",
                    "AutoDrop",
                    "AutoRespawn",
                ]
                if (
                    booleanVariables.some((v) => cleanVariableName.includes(v))
                ) {
                    // For boolean variables, default to '1' (true)
                    return "1"
                }
            }

            // For other cases, return '1' as a sensible default
            return "1"
        }

        // Convert a single block to VBSP format
        const convertBlockToVbsp = (block) => {
            // Helper function to process child blocks
            const processChildBlocks = (childBlocks, containerName) => {
                if (!childBlocks || childBlocks.length === 0) return {}

                const result = {}

                const addMulti = (obj, key, value) => {
                    if (obj[key] === undefined) {
                        obj[key] = value
                    } else if (Array.isArray(obj[key])) {
                        obj[key].push(value)
                    } else {
                        obj[key] = [obj[key], value]
                    }
                }

                childBlocks.forEach((childBlock) => {
                    if (childBlock.type === RAW_BLOCK) {
                        const raw = rawBlockObject(childBlock)
                        for (const [key, value] of Object.entries(raw)) {
                            for (const each of [value].flat()) {
                                addMulti(result, key, each)
                            }
                        }
                        return
                    }
                    const childVbsp = convertBlockToVbsp(childBlock)

                    // Wrap nested logical blocks under special result keys
                    if (
                        childBlock.type === "if" ||
                        childBlock.type === "ifElse"
                    ) {
                        addMulti(result, "Condition", childVbsp)
                        return
                    }
                    if (
                        childBlock.type === "switchCase" ||
                        childBlock.type === "switchGlobal"
                    ) {
                        // Merge inner Switch directly, support multiple switches
                        const inner =
                            childVbsp.Switch || childVbsp.switch || childVbsp
                        addMulti(result, "Switch", inner)
                        return
                    }

                    // Merge direct result-type blocks
                    Object.assign(result, childVbsp)
                })
                return result
            }

            switch (block.type) {
                case "if":
                    const modifiedIfValue = applyTimerLogic(
                        block.variable,
                        block.value,
                    )
                    // Only convert to boolean for boolean variables, use raw value for enums
                    const ifValue = block.variable?.includes("cube_type")
                        ? modifiedIfValue
                        : convertBooleanValue(modifiedIfValue, block.variable)
                    const ifOperator = block.operator || "=="
                    const ifResult = {
                        instVar: `${block.variable || ""} ${ifOperator} ${ifValue}`,
                    }

                    if (block.thenBlocks && block.thenBlocks.length > 0) {
                        const thenResult = processChildBlocks(
                            block.thenBlocks,
                            "thenBlocks",
                        )
                        ifResult.Result = thenResult
                    }

                    return ifResult

                case "ifElse":
                    const modifiedIfElseValue = applyTimerLogic(
                        block.variable,
                        block.value,
                    )
                    // Only convert to boolean for boolean variables, use raw value for enums
                    const ifElseValue = block.variable?.includes("cube_type")
                        ? modifiedIfElseValue
                        : convertBooleanValue(modifiedIfElseValue, block.variable)
                    const ifElseOperator = block.operator || "=="
                    const ifElseResult = {
                        instVar: `${block.variable || ""} ${ifElseOperator} ${ifElseValue}`,
                    }

                    if (block.thenBlocks && block.thenBlocks.length > 0) {
                        const thenResult = processChildBlocks(
                            block.thenBlocks,
                            "thenBlocks",
                        )
                        ifElseResult.Result = thenResult
                    }

                    if (block.elseBlocks && block.elseBlocks.length > 0) {
                        const elseResult = processChildBlocks(
                            block.elseBlocks,
                            "elseBlocks",
                        )
                        ifElseResult.Else = elseResult
                    }

                    return ifElseResult

                case "ifHas":
                    const ifHasResult = {
                        styleVar: block.value || "",
                    }

                    if (block.thenBlocks && block.thenBlocks.length > 0) {
                        const thenResult = processChildBlocks(
                            block.thenBlocks,
                            "thenBlocks",
                        )
                        ifHasResult.Result = thenResult
                    }

                    return ifHasResult

                case "ifHasElse":
                    const ifHasElseResult = {
                        styleVar: block.value || "",
                    }

                    if (block.thenBlocks && block.thenBlocks.length > 0) {
                        const thenResult = processChildBlocks(
                            block.thenBlocks,
                            "thenBlocks",
                        )
                        ifHasElseResult.Result = thenResult
                    }

                    if (block.elseBlocks && block.elseBlocks.length > 0) {
                        const elseResult = processChildBlocks(
                            block.elseBlocks,
                            "elseBlocks",
                        )
                        ifHasElseResult.Else = elseResult
                    }

                    return ifHasElseResult

                case "switchCase": {
                    // Build a proper Switch block using instvar test
                    const variable = block.variable || ""
                    const variableWithDollar = variable.startsWith("$")
                        ? variable
                        : variable
                          ? `$${variable}`
                          : ""
                    const switchObj = {
                        Switch: {
                            method: block.method || "first",
                            test: "instvar",
                        },
                    }

                    if (Array.isArray(block.cases)) {
                        // Process all cases that have actual values (including 0 and false, but NOT empty string)
                        for (const caseBlock of block.cases) {
                            // Check if value exists - explicitly handle 0 and false as valid, but reject empty strings
                            const valueStr = String(
                                caseBlock?.value || "",
                            ).trim()
                            const hasValue =
                                caseBlock &&
                                caseBlock.value !== undefined &&
                                caseBlock.value !== null &&
                                valueStr !== ""

                            if (!hasValue) {
                                console.warn(
                                    `Skipped case ${caseBlock?.id} of the ${variable} switch of "${this.name}", it has no value`,
                                )
                            }

                            if (hasValue) {
                                const modifiedCaseValue = applyTimerLogic(
                                    block.variable,
                                    caseBlock.value,
                                )
                                const arg = `${variableWithDollar} = ${convertBooleanValue(modifiedCaseValue, variableWithDollar)}`
                                const caseResults = processChildBlocks(
                                    caseBlock?.thenBlocks || [],
                                    "thenBlocks",
                                )

                                // Always add the case, even if result is empty
                                // This makes the VBSP more explicit about all possible cases
                                switchObj.Switch[arg] = caseResults
                            }
                        }
                    }
                    return switchObj
                }

                case "switchGlobal": {
                    // Build a Switch for global tests, default to styleVar unless specified
                    const testName = block.test || "styleVar"
                    const switchObj = {
                        Switch: {
                            method: block.method || "first",
                            test: testName,
                        },
                    }

                    if (Array.isArray(block.cases)) {
                        // Process all cases that have actual values (including 0 and false, but NOT empty string)
                        for (const caseBlock of block.cases) {
                            // Check if value exists - explicitly handle 0 and false as valid, but reject empty strings
                            const valueStr = String(
                                caseBlock?.value || "",
                            ).trim()
                            const hasValue =
                                caseBlock &&
                                caseBlock.value !== undefined &&
                                caseBlock.value !== null &&
                                valueStr !== ""

                            if (!hasValue) {
                                console.warn(
                                    `Skipped case ${caseBlock?.id} of the ${testName} switch of "${this.name}", it has no value`,
                                )
                            }

                            if (hasValue) {
                                const modifiedCaseValue = applyTimerLogic(
                                    block.test,
                                    caseBlock.value,
                                )
                                const arg = `${modifiedCaseValue}`
                                const caseResults = processChildBlocks(
                                    caseBlock?.thenBlocks || [],
                                    "thenBlocks",
                                )

                                // Always add the case, even if result is empty
                                // This makes the VBSP more explicit about all possible cases
                                switchObj.Switch[arg] = caseResults
                            }
                        }
                    }
                    return switchObj
                }

                case "case":
                    const caseResult = {}

                    if (block.thenBlocks && block.thenBlocks.length > 0) {
                        const thenResult = processChildBlocks(
                            block.thenBlocks,
                            "thenBlocks",
                        )
                        Object.assign(caseResult, thenResult)
                    }

                    return caseResult

                case "changeInstance":
                    return {
                        changeInstance: block.instanceName || "",
                    }

                case "addOverlay":
                    return {
                        addOverlay: block.overlayName || "",
                    }

                case "addGlobalEnt":
                    return {
                        addGlobalEnt: block.instanceName || "",
                    }

                case "offsetInstance":
                    return {
                        offsetInstance: `${block.instanceName || ""} ${block.offset || "0 0 0"}`,
                    }

                case "mapInstVar":
                    const mapResult = {}
                    if (block.sourceVariable && block.targetVariable) {
                        mapResult.setInstVar = `${block.targetVariable} ${block.sourceVariable}`
                    }
                    if (
                        block.mappings &&
                        Object.keys(block.mappings).length > 0
                    ) {
                        Object.assign(mapResult, block.mappings)
                    }
                    return mapResult

                case "debug":
                    return {
                        debug: block.message || "",
                    }

                default:
                    return {
                        unknown: {
                            type: block.type,
                            data: block,
                        },
                    }
            }
        }

        // Attach instance filter to ensure condition targets this item's instances only
        const topLevelInstanceTest = { Instance: `<${this.id}>` }
        return blockList.map((block) =>
            block.type === RAW_BLOCK
                ? null
                : { ...topLevelInstanceTest, ...convertBlockToVbsp(block) },
        )
    }

    // Convert blocks to VBSP format
    convertBlocksToVbsp(blockList) {
        const vbspConditions = {
            Conditions: {},
        }
        const objects = this.blockConditions(blockList)
        const conditions = []
        blockList.forEach((block, index) => {
            if (objects[index]) {
                conditions.push(objects[index])
                return
            }
            // A raw block's condition, as a JS object
            for (const [key, value] of Object.entries(rawBlockObject(block))) {
                if (key.toLowerCase() === "condition") {
                    conditions.push(...[value].flat())
                } else {
                    vbspConditions.Conditions[key] = value
                }
            }
        })

        // If there's only one condition, use a single object
        // If there are multiple conditions, use an array
        if (conditions.length === 1) {
            vbspConditions.Conditions.Condition = conditions[0]
        } else if (conditions.length > 1) {
            vbspConditions.Conditions.Condition = conditions
        }

        return vbspConditions
    }

    exists() {
        return (
            fs.existsSync(this.paths.editorItems) &&
            fs.existsSync(this.paths.properties)
        )
    }

    // Metadata methods
    loadMetadata() {
        try {
            if (fs.existsSync(this.paths.meta)) {
                const metadata = JSON.parse(
                    fs.readFileSync(this.paths.meta, "utf-8"),
                )

                // Repair metadata written by older versions: instance maps
                // must only have numeric keys ("NaN"/"pending_..." keys were
                // written by a bug and can break instance enumeration)
                for (const mapKey of ["instanceNames", "instanceErrors"]) {
                    const map = metadata[mapKey]
                    if (map && typeof map === "object") {
                        for (const key of Object.keys(map)) {
                            if (!/^\d+$/.test(key)) {
                                console.warn(
                                    `Dropped invalid ${mapKey} key "${key}" from the meta.json of item ${this.id}`,
                                )
                                delete map[key]
                            }
                        }
                    }
                }

                return metadata
            }
        } catch (error) {
            console.warn(
                `Failed to read the meta.json of item ${this.id}, making a new one:`,
                error,
            )
        }

        // Get actual file creation and modification dates
        const fileDates = this.getFileDates()

        // Create default metadata structure with actual file dates
        // Note: createdVersion is NOT set here - it's set explicitly when creating new items
        const defaultMetadata = {
            created: fileDates.created.toISOString(),
            lastModified: fileDates.lastModified.toISOString(),
        }

        // Create the meta.json file if it doesn't exist
        this.saveMetadata(defaultMetadata)

        return defaultMetadata
    }

    getFileDates() {
        let earliestCreated = new Date()
        let latestModified = new Date(0) // Start with epoch time

        // Check all item files for creation and modification dates
        const filesToCheck = [this.paths.editorItems, this.paths.properties]

        // Add VBSP config if it exists
        filesToCheck.push(this.paths.vbsp_cfg, this.paths.vbsp_config)

        for (const filePath of filesToCheck) {
            if (fs.existsSync(filePath)) {
                try {
                    const stats = fs.statSync(filePath)

                    // Use birthtime (creation) if available, otherwise use mtime
                    const created = stats.birthtime || stats.mtime
                    const modified = stats.mtime

                    // Find earliest creation date
                    if (created < earliestCreated) {
                        earliestCreated = created
                    }

                    // Find latest modification date
                    if (modified > latestModified) {
                        latestModified = modified
                    }
                } catch (error) {
                    console.warn(
                        `Failed to read the dates of ${filePath}:`,
                        error,
                    )
                }
            }
        }

        // If we couldn't get any valid dates, use current time
        if (
            earliestCreated.getTime() === new Date().getTime() &&
            latestModified.getTime() === 0
        ) {
            const now = new Date()
            return {
                created: now,
                lastModified: now,
            }
        }

        return {
            created: earliestCreated,
            lastModified: latestModified,
        }
    }

    saveMetadata(metadata = null) {
        try {
            const dataToSave = metadata || this.metadata

            // Get current file modification date
            const fileDates = this.getFileDates()
            dataToSave.lastModified = fileDates.lastModified.toISOString()

            // Ensure required fields exist
            if (!dataToSave.created) {
                dataToSave.created = fileDates.created.toISOString()
            }

            fs.writeFileSync(
                this.paths.meta,
                JSON.stringify(dataToSave, null, 4),
            )
            this.metadata = dataToSave
            return true
        } catch (error) {
            console.error(
                `Failed to save the meta.json of item ${this.id}:`,
                error,
            )
            return false
        }
    }

    updateMetadata(updates) {
        if (!updates || typeof updates !== "object") {
            throw new Error("Metadata updates must be an object")
        }

        // Re-read metadata from disk to avoid overwriting data written by
        // other methods (e.g. saveConditions writes vbsp_blocks to meta.json
        // and the in-memory copy may be stale)
        if (fs.existsSync(this.paths.meta)) {
            try {
                this.metadata = JSON.parse(
                    fs.readFileSync(this.paths.meta, "utf-8"),
                )
            } catch (e) {
                // Fall back to existing in-memory metadata
            }
        }

        this.metadata = {
            ...this.metadata,
            ...updates,
        }

        return this.saveMetadata()
    }

    getMetadata() {
        return this.metadata
    }

    // Instance naming methods
    getInstanceName(index) {
        const instanceNames = this.metadata.instanceNames || {}
        return instanceNames[index] || `Instance ${index}`
    }

    setInstanceName(index, name) {
        // Guard against NaN/pending indices leaking in from the frontend -
        // they would be serialized as literal "NaN"/"pending_..." keys in
        // meta.json and corrupt the package metadata
        const key = String(index)
        if (!/^\d+$/.test(key)) {
            console.warn(
                `Ignored the name of invalid instance index "${key}" of item ${this.id}`,
            )
            return
        }
        if (!this.metadata.instanceNames) {
            this.metadata.instanceNames = {}
        }
        this.metadata.instanceNames[key] = name
        this.saveMetadata()
    }

    getInstanceNames() {
        return this.metadata.instanceNames || {}
    }

    removeInstanceName(index) {
        if (this.metadata.instanceNames && this.metadata.instanceNames[index]) {
            delete this.metadata.instanceNames[index]
            this.saveMetadata()
        }
    }

    // Model management methods
    getModelName() {
        try {
            const editoritems = this.getEditorItems()
            const editor = editoritems?.Item?.Editor
            const subType = Array.isArray(editor?.SubType)
                ? editor.SubType[0]
                : editor?.SubType

            return subType?.Model?.ModelName || ""
        } catch (error) {
            console.error(
                `Failed to read the model name of item ${this.id}: ${error.message}`,
            )
            return ""
        }
    }

    setModelName(modelName) {
        try {
            const editoritems = this.getEditorItems()
            const editor = editoritems.Item.Editor

            // Check if this is a preset model (not "Custom" and ends with .3ds)
            const isPresetModel = modelName && 
                modelName.trim() !== "" && 
                modelName !== "Custom" && 
                modelName.endsWith(".3ds")

            // If preset model, ensure we only have ONE subtype
            if (isPresetModel) {
                const currentSubType = editor.SubType
                let singleSubType

                // Get the first subtype if it's an array, otherwise use the single one
                if (Array.isArray(currentSubType) && currentSubType.length > 0) {
                    singleSubType = currentSubType[0]
                } else if (Array.isArray(currentSubType) && currentSubType.length === 0) {
                    // If array is empty, create a new subtype
                    singleSubType = {}
                } else {
                    singleSubType = currentSubType || {}
                }

                // Update the model name
                if (!singleSubType.Model) {
                    singleSubType.Model = {}
                }
                singleSubType.Model.ModelName = modelName

                // Rebuild Editor object without SubTypeProperty and with single SubType
                const otherEditorProps = {}
                for (const [key, value] of Object.entries(editor)) {
                    if (key !== "SubType" && key !== "SubTypeProperty") {
                        otherEditorProps[key] = value
                    }
                }

                editoritems.Item.Editor = {
                    SubType: singleSubType,
                    ...otherEditorProps,
                }

                console.log(
                    `Set preset model ${modelName} on "${this.name}" (now a single SubType without SubTypeProperty)`,
                )
            } else {
                // For custom models or empty modelName, handle both single and array SubTypes
                if (Array.isArray(editor.SubType)) {
                    // Update all SubTypes
                    editor.SubType.forEach((subType) => {
                        if (!subType.Model) {
                            subType.Model = {}
                        }
                        if (modelName && modelName.trim() !== "") {
                            subType.Model.ModelName = modelName
                        } else {
                            // Remove ModelName if empty
                            delete subType.Model.ModelName
                            // Clean up empty Model object
                            if (Object.keys(subType.Model).length === 0) {
                                delete subType.Model
                            }
                        }
                    })
                } else {
                    // Single SubType
                    const subType = editor.SubType
                    if (!subType.Model) {
                        subType.Model = {}
                    }
                    if (modelName && modelName.trim() !== "") {
                        subType.Model.ModelName = modelName
                    } else {
                        // Remove ModelName if empty
                        delete subType.Model.ModelName
                        // Clean up empty Model object
                        if (Object.keys(subType.Model).length === 0) {
                            delete subType.Model
                        }
                    }
                }
            }

            this.saveEditorItems(editoritems)
            return true
        } catch (error) {
            console.error(`Failed to set the model of "${this.name}":`, error)
            return false
        }
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            movementHandle: this.movementHandle,
            details: this.details,
            icon: this.icon,
            paths: this.paths,
            itemFolder: this.itemFolder,
            fullItemPath: this.fullItemPath,
            packagePath: this.packagePath,
            instances: this.instances, // Regular instances without existence check
            metadata: this.metadata,
            modelName: this.getModelName(), // Include model name for warnings
        }
    }

    // Special method for item editor that includes existence status
    toJSONWithExistence() {
        return {
            id: this.id,
            name: this.name,
            movementHandle: this.movementHandle,
            details: this.details,
            icon: this.icon,
            paths: this.paths,
            itemFolder: this.itemFolder,
            fullItemPath: this.fullItemPath,
            packagePath: this.packagePath,
            instances: this.getInstancesWithStatus(), // Include existence status
            metadata: this.metadata,
            modelName: this.getModelName(), // Include model name for warnings
        }
    }
}

module.exports = {
    Item,
}
