const path = require("path")
const fs = require("fs")
const vdf = require("vdf-parser")

/**
 * Never asked to have a name: the world (an instance's worldspawn is its
 * brushes), and what the compile turns into surfaces, though the FGD gives
 * them a name and inputs
 */
const NO_NAME_CLASSES = new Set([
    "worldspawn",
    "info_overlay",
    "info_overlay_transition",
    "infodecal",
])

/**
 * Classes whose entities can't be named, or take no inputs and fire no
 * outputs: what needsName goes by when the FGD isn't there
 */
const NO_IO_CLASSES = new Set([
    "prop_static",
    "prop_detail",
    "func_detail",
    "func_instance",
    "func_instance_parms",
    "info_lighting",
    "env_cubemap",
])

const lowerClasses = new WeakMap()

/**
 * Whether an unnamed entity of this class should get a name: it can take
 * one and has inputs or outputs, by the FGD (findPortal2Resources().entities,
 * from parseFGD). Never NO_NAME_CLASSES.
 * @param {string} classname
 * @param {Object|null} fgdEntities - Classes by name; without them, all but
 *   NO_IO_CLASSES
 */
function needsName(classname, fgdEntities) {
    const lower = String(classname).toLowerCase()
    if (NO_NAME_CLASSES.has(lower)) return false
    if (!fgdEntities) return !NO_IO_CLASSES.has(lower)

    if (!lowerClasses.has(fgdEntities)) {
        lowerClasses.set(
            fgdEntities,
            new Map(
                Object.entries(fgdEntities).map(([name, entity]) => [
                    name.toLowerCase(),
                    entity,
                ]),
            ),
        )
    }
    const entity = lowerClasses.get(fgdEntities).get(lower)
    // Nothing says a class the FGD doesn't have takes inputs or outputs
    if (!entity) return false
    return (
        entity.nameable !== false &&
        (entity.inputs?.length > 0 || entity.outputs?.length > 0)
    )
}

class Instance {
    constructor({ path: instancePath }) {
        this.path = instancePath
    }

    /**
     * Gets the raw instance path as stored in the package
     * @param {string} packagePath - Path to the package directory
     * @param {string} instanceName - Name of the instance from the package data
     * @returns {string} Full path to the instance file
     */
    static getRawPath(packagePath, instanceName) {
        return path.join(packagePath, "resources", instanceName)
    }

    /**
     * Gets the cleaned instance path (removes BEE2 prefix if present)
     * @param {string} packagePath - Path to the package directory
     * @param {string} instanceName - Name of the instance from the package data
     * @returns {string} Full path to the instance file with BEE2 prefix removed
     */
    static getCleanPath(packagePath, instanceName) {
        // First normalize the instance name to use OS-specific path separators
        const normalizedName = instanceName.replace(/[/\\]/g, path.sep)

        // Remove any BEE2 prefix (case-insensitive) and ensure proper instances prefix
        const cleanInstanceName = normalizedName
            .split(path.sep)
            .filter((part) => part.toUpperCase() !== "BEE2")
            .join(path.sep)

        // Ensure the path starts with "instances"
        const finalPath = cleanInstanceName.startsWith("instances" + path.sep)
            ? cleanInstanceName
            : path.join("instances", cleanInstanceName)

        // Join with the package resources directory
        return path.normalize(path.join(packagePath, "resources", finalPath))
    }

    // Clean up malformed VMF content before parsing
    cleanVmfContent(content) {
        // Remove lines with empty key-value pairs like "" ""
        // This handles the specific error we're seeing on line 270
        content = content.replace(/^\s*""\s+""\s*$/gm, "")

        // Also handle variations of empty quotes
        content = content.replace(/^\s*""\s*""\s*$/gm, "")
        content = content.replace(/^\s*''\s*''\s*$/gm, "")

        // Remove empty lines after cleaning
        content = content.replace(/^\s*\n/gm, "")

        // Fix common VMF formatting issues
        // Remove trailing commas that might cause parsing issues
        content = content.replace(/,(\s*[}\]])/g, "$1")

        // Normalize line endings
        content = content.replace(/\r\n/g, "\n")

        // Remove any remaining problematic empty entries
        content = content.replace(/^\s*""\s*\n/gm, "")

        return content
    }

    // Parse VMF and return all entities with better comprehensive parsing
    getAllEntities() {
        try {
            // Read and parse the VMF file
            let vmfContent = fs.readFileSync(this.path, "utf-8")

            // Clean up malformed VMF content
            vmfContent = this.cleanVmfContent(vmfContent)

            const vmfData = vdf.parse(vmfContent)

            const entities = {}

            // Recursive function to find entities anywhere in the VMF structure
            const findEntitiesRecursive = (obj, path = "") => {
                if (typeof obj !== "object" || obj === null) return

                // Check if this object is an entity (has both classname and targetname)
                if (obj.classname && obj.targetname) {
                    entities[obj.targetname] = obj.classname
                    return
                }

                // Recursively search all properties
                for (const [key, value] of Object.entries(obj)) {
                    if (typeof value === "object" && value !== null) {
                        findEntitiesRecursive(
                            value,
                            path ? `${path}.${key}` : key,
                        )
                    }
                }
            }

            // Start recursive search from root
            findEntitiesRecursive(vmfData, "root")

            return entities
        } catch (error) {
            console.error(`Failed to parse VMF file ${this.path}:`, error)

            // Try to provide more context about the error
            if (error.message && error.message.includes("line")) {
                console.error(
                    "The VMF file may have malformed syntax or be corrupted",
                )
            }

            // Return empty object instead of crashing
            return {}
        }
    }

    /**
     * Get validation issues for entities in this instance
     * @param {Object|null} [fgdEntities] - The FGD's classes, for which
     *   unnamed entities need a name (see needsName)
     */
    getEntityValidationIssues(fgdEntities = null) {
        try {
            let vmfContent = fs.readFileSync(this.path, "utf-8")
            vmfContent = this.cleanVmfContent(vmfContent)
            const vmfData = vdf.parse(vmfContent)

            const issues = {
                unnamedEntities: [], // Entities with classname but no targetname
                invalidNames: [], // Entities with spaces or other invalid chars in name
            }

            // Recursive function to find all entities and check for issues
            const findEntitiesRecursive = (obj) => {
                if (typeof obj !== "object" || obj === null) return

                // Check if this object is an entity (has classname)
                if (obj.classname) {
                    // Check for unnamed entity (that could have inputs or
                    // outputs if it had a name)
                    if (!obj.targetname || obj.targetname.trim() === "") {
                        if (needsName(obj.classname, fgdEntities)) {
                            issues.unnamedEntities.push({
                                classname: obj.classname,
                                id: obj.id || "unknown",
                            })
                        }
                    } else {
                        // Check for spaces in name
                        if (obj.targetname.includes(" ")) {
                            issues.invalidNames.push({
                                name: obj.targetname,
                                classname: obj.classname,
                                id: obj.id || "unknown",
                                fixedName: obj.targetname.replace(/ /g, "_"),
                                issue: "space",
                            })
                        }
                    }
                    return
                }

                // Recursively search all properties
                for (const [key, value] of Object.entries(obj)) {
                    if (typeof value === "object" && value !== null) {
                        findEntitiesRecursive(value)
                    }
                }
            }

            findEntitiesRecursive(vmfData)

            return issues
        } catch (error) {
            console.error(
                `Failed to check the entity names in ${this.path}:`,
                error,
            )
            return { unnamedEntities: [], invalidNames: [] }
        }
    }

    // Fix entity names with spaces by replacing them with underscores
    fixEntityNames() {
        try {
            let vmfContent = fs.readFileSync(this.path, "utf-8")
            let modified = false
            const renamed = [] // For the log: "old" -> "new"

            // Find and fix targetnames with spaces using regex
            // Match "targetname" "value with spaces"
            const targetNameRegex = /("targetname"\s*")([^"]*\s[^"]*)(")/g
            vmfContent = vmfContent.replace(
                targetNameRegex,
                (match, prefix, name, suffix) => {
                    const fixedName = name.replace(/ /g, "_")
                    if (fixedName !== name) {
                        modified = true
                        renamed.push(`"${name}" -> "${fixedName}"`)
                    }
                    return prefix + fixedName + suffix
                },
            )

            if (modified) {
                fs.writeFileSync(this.path, vmfContent, "utf-8")
                console.log(
                    `Replaced spaces with underscores in the entity names of ${this.path}: ${renamed.join(", ")}`,
                )
                return { success: true, modified: true }
            }

            return { success: true, modified: false }
        } catch (error) {
            console.error(
                `Failed to fix the entity names in ${this.path}:`,
                error,
            )
            return { success: false, error: error.message }
        }
    }
}

module.exports = { Instance, needsName }
