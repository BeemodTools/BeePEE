const fs = require("fs")
const path = require("path")
const { Item } = require("./items")
const { getPackagesDir } = require("../utils/packagesDir")
const { logger } = require("../utils/logger")

/** "1 item", "3 items" */
const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`

class Package {
    constructor(packagePath) {
        this.path = packagePath
        this.name = path.parse(this.path).name
        const packageName = path.parse(this.path).name
        this.packageDir = path.join(getPackagesDir(), packageName)
        this.items = []
        this.signages = []
    }

    isLoaded() {
        return fs.existsSync(this.packageDir)
    }

    async load() {
        try {
            const infoPath = path.join(this.packageDir, "info.json")
            if (!fs.existsSync(infoPath)) {
                throw new Error(
                    `[package : ${this.name}]: Missing info.json file`,
                )
            }

            // Read and parse info.json
            const parsedInfo = JSON.parse(fs.readFileSync(infoPath, "utf-8"))

            // Use the actual package name from info.json if available
            if (parsedInfo.Name) {
                this.name = parsedInfo.Name
            } else if (parsedInfo.ID) {
                this.name = parsedInfo.ID
            }

            // Items (now optional - packages can have only signages)
            let rawitems = parsedInfo["Item"] || []

            // Convert single item to array
            if (!Array.isArray(rawitems)) {
                rawitems = [rawitems]
            }

            // Create items directly in this package. An item that can't be
            // read is left out (and listed in skippedItems) rather than
            // failing the package; its files stay as they are.
            this.items = []
            this.skippedItems = []
            for (const element of rawitems) {
                try {
                    this.items.push(
                        new Item({
                            packagePath: this.packageDir,
                            itemJSON: element,
                        }),
                    )
                } catch (error) {
                    const id = element?.ID ?? "(an item with no ID)"
                    this.skippedItems.push({ id, reason: error.message })
                    console.warn(`Left out item ${id}: ${error.message}`)
                }
            }

            // Signages (also optional)
            let rawSignages = parsedInfo["Signage"] || []

            // Convert single signage to array
            if (!Array.isArray(rawSignages)) {
                rawSignages = [rawSignages]
            }

            // Filter out null/undefined/invalid signage entries
            rawSignages = rawSignages.filter(
                (sig) => sig && typeof sig === "object" && sig.ID
            )

            // Parse signages and resolve icon paths
            this.signages = rawSignages.map((sig) => {
                // Process styles to resolve icon paths
                const processedStyles = {}
                if (sig.Styles) {
                    for (const [styleKey, styleValue] of Object.entries(
                        sig.Styles,
                    )) {
                        // Handle style inheritance (e.g., "BORING_STYLE" = "FANCY_STYLE")
                        if (typeof styleValue === "string") {
                            processedStyles[styleKey] = styleValue
                        } else if (styleValue && typeof styleValue === "object") {
                            // Resolve icon path relative to package
                            // Icon can be:
                            // - "items/clean/BEE/signage/cake.png" -> resources/BEE2/items/...
                            // - "PACKAGE:path/file.png" -> resources/BEE2/path/file.png
                            // - "filename.png" -> resources/BEE2/filename.png
                            const resolveIcon = (iconPath) =>
                                path.join(
                                    this.packageDir,
                                    "resources/BEE2",
                                    // Package reference - just use the part after ':'
                                    iconPath.includes(":")
                                        ? iconPath.split(":")[1]
                                        : iconPath,
                                )
                            const icon = styleValue.icon
                            let resolvedIcon = null
                            if (typeof icon === "string" && icon) {
                                resolvedIcon = resolveIcon(icon)
                            } else if (icon && typeof icon === "object") {
                                // An icon made of image layers ("img" lines in
                                // an "icon" block): the first one in this
                                // package
                                const layers = [icon.img ?? icon.Img]
                                    .flat()
                                    .filter((layer) => typeof layer === "string")
                                resolvedIcon =
                                    layers
                                        .map(resolveIcon)
                                        .find((file) => fs.existsSync(file)) ?? null
                            }
                            processedStyles[styleKey] = {
                                ...styleValue,
                                icon: resolvedIcon,
                            }
                        }
                    }
                }

                return {
                    id: sig.ID,
                    name: sig.Name,
                    hidden: sig.Hidden === "1" || sig.Hidden === true,
                    primary: sig.Primary || null,
                    secondary: sig.Secondary || null,
                    styles: processedStyles,
                }
            })

            // Set importedVersion for items that don't have it (for imported packages)
            try {
                const packageJson = require("../../package.json")
                const appVersion = packageJson.version
                if (appVersion) {
                    for (const item of this.items) {
                        const metadata = item.getMetadata()
                        // Only set importedVersion if it doesn't exist (meaning it was imported)
                        // and if createdVersion doesn't exist (meaning it wasn't created in this app)
                        if (!metadata.importedVersion && !metadata.createdVersion) {
                            item.updateMetadata({ importedVersion: appVersion })
                        }
                    }
                }
            } catch (error) {
                console.warn(
                    "Failed to set the items' imported version:",
                    error,
                )
            }

            // Auto-import VBSP instances for all items (runs once per item)
            await logger.section("Auto-importing VBSP instances", () => {
                let totalImported = 0
                for (const item of this.items) {
                    if (item.autoImportVBSPInstances()) {
                        totalImported++
                    }
                }
                console.log(
                    totalImported > 0
                        ? `Imported the VBSP instances of ${plural(totalImported, "item")}`
                        : "No new VBSP instances to import",
                )
            })

            console.log(
                `Loaded "${this.name}": ${plural(this.items.length, "item")} and ${plural(this.signages.length, "signage")}`,
            )
            return { items: this.items, signages: this.signages }
        } catch (error) {
            // The caller logs the error with its stack
            console.error(
                `Failed to load package "${this.name}": ${error.message}`,
            )
            this.items = []
            this.signages = []
            throw error
        }
    }

    addItem(packagePath, itemJSON) {
        //Adds a item to the itemsArray
        //NOTE: YOU NEED TO MAKE THE FOLDER STRUCUTRE + EDITORITEMS BEFORE CALLING THIS
        return this.items.push(new Item({ packagePath, itemJSON }))
    }

    getItemByName(name) {
        if (!name) {
            throw new Error("Name is empty!")
        }

        return this.items.find((item) => item.name === name)
    }

    getItemById(id) {
        if (!id) {
            throw new Error("ID is empty!")
        }

        return this.items.find((item) => item.id === id)
    }

    removeItem(identifier) {
        const index = this.items.findIndex(
            (item) => item.name === identifier || item.id === identifier,
        )
        if (index !== -1) {
            return this.items.splice(index, 1)[0]
        }
        return null
    }

    removeAllItems() {
        this.items.length = 0
    }

    // Static method for creating and loading a package
    static async create(packagePath) {
        const pkg = new Package(packagePath)
        await pkg.load()
        return pkg
    }
}

module.exports = { Package }
