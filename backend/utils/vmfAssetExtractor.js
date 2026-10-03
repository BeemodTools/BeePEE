const fs = require("fs")
const path = require("path")
const vdf = require("vdf-parser")
const { logger } = require("./logger")

/**
 * Extract assets (models, materials, sounds, scripts) from a VMF file
 * @param {string} vmfPath - Path to the VMF file
 * @returns {Object} Object containing arrays of assets by type
 */
function extractAssetsFromVMF(vmfPath) {
    if (!fs.existsSync(vmfPath)) {
        throw new Error("VMF file not found")
    }

    try {
        const content = fs.readFileSync(vmfPath, "utf-8")
        const vmfData = vdf.parse(content)

        const assets = {
            MODEL: [],
            MATERIAL: [],
            SOUND: [],
            SCRIPT: [],
        }

        // Recursive function to find entities and extract their assets
        const extractAssetsRecursive = (obj, parentKey = "") => {
            if (typeof obj !== "object" || obj === null) return

            // Check if this is an entity with asset properties
            if (obj.classname) {
                // Extract model paths
                if (obj.model) {
                    assets.MODEL.push(obj.model.toLowerCase())
                }

                // Extract material paths from various properties
                const materialProps = ["material", "texture", "skin", "overlay"]
                for (const prop of materialProps) {
                    if (obj[prop]) {
                        assets.MATERIAL.push(obj[prop].toLowerCase())
                    }
                }

                // Extract sound paths
                const soundProps = [
                    "sound",
                    "soundfile",
                    "soundname",
                    "ambient_generic",
                ]
                for (const prop of soundProps) {
                    if (obj[prop]) {
                        assets.SOUND.push(obj[prop].toLowerCase())
                    }
                }

                // Extract script paths
                if (obj.scriptfile) {
                    assets.SCRIPT.push(obj.scriptfile.toLowerCase())
                }
            }

            // Extract materials from brush sides (key is "side" in VMF structure)
            if (parentKey === "side" || obj.material) {
                if (obj.material && typeof obj.material === "string") {
                    assets.MATERIAL.push(obj.material.toLowerCase())
                }
            }

            // Recursively search all properties
            for (const [key, value] of Object.entries(obj)) {
                if (typeof value === "object" && value !== null) {
                    extractAssetsRecursive(value, key)
                }
            }
        }

        // Start recursive search from root
        extractAssetsRecursive(vmfData)

        // Remove duplicates and filter out empty values
        for (const assetType in assets) {
            assets[assetType] = [...new Set(assets[assetType])].filter(
                (asset) => asset && asset.trim(),
            )
        }

        // Filter out tool textures and common engine materials from the check
        assets.MATERIAL = assets.MATERIAL.filter((mat) => {
            // Skip tool textures (these are always available)
            if (mat.startsWith("tools/")) return false
            // Skip dev textures
            if (mat.startsWith("dev/")) return false
            // Skip skybox textures (handled specially)
            if (mat.startsWith("skybox/")) return false
            return true
        })

        return assets
    } catch (error) {
        console.error(`Failed to extract the assets of ${vmfPath}:`, error)
        throw error
    }
}

/**
 * Find dependent materials for models
 * @param {string} modelPath - Path to the model file
 * @param {string} portal2Dir - Portal 2 directory path
 * @returns {Array} Array of dependent material paths
 */
function findDependentMaterials(modelPath, portal2Dir) {
    const dependentMaterials = []

    try {
        // For now, we'll implement a basic version that looks for common material patterns
        // This could be enhanced to actually parse MDL files and extract material references

        // Extract model name without extension
        const modelName = path.basename(modelPath, ".mdl")

        // Common material patterns for models
        const commonMaterialPatterns = [
            `materials/models/${modelName}.vmt`,
            `materials/models/props/${modelName}.vmt`,
            `materials/models/props_map_editor/${modelName}.vmt`,
        ]

        for (const materialPattern of commonMaterialPatterns) {
            const fullPath = path.join(portal2Dir, materialPattern)
            if (fs.existsSync(fullPath)) {
                dependentMaterials.push(materialPattern)
            }
        }
    } catch (error) {
        console.error(`Failed to find the materials of ${modelPath}:`, error)
    }

    return dependentMaterials
}

/**
 * Check if an asset exists in Portal 2 search paths (from gameinfo.txt)
 * @param {string} assetPath - Asset path to check
 * @param {string} portal2Dir - Portal 2 directory path
 * @param {Array} searchDirs - Portal 2 search directories from gameinfo.txt
 * @returns {boolean} True if asset exists in Portal 2 search paths
 */
function assetExistsInPortal2(assetPath, portal2Dir, searchDirs) {
    try {
        // Determine file extensions based on asset type
        let extensions = []
        let baseAssetPath = assetPath
        
        if (assetPath.startsWith("materials/")) {
            extensions = [".vtf", ".vmt"]
        } else if (assetPath.startsWith("models/")) {
            // Strip .mdl extension from the path before adding extensions
            baseAssetPath = assetPath.replace(".mdl", "")
            extensions = [".mdl", ".phy", ".vvd", ".dx90.vtx"]
        } else if (assetPath.startsWith("scripts/")) {
            extensions = [".nut"]
        } else if (assetPath.startsWith("messages/")) {
            const ext = path.extname(assetPath)
            extensions = [ext]
        } else if (assetPath.startsWith("sounds/")) {
            extensions = [".wav", ".mp3"]
        }
        
        // Check if asset exists in Portal 2 search paths
        // If it exists here, Portal 2 can find it, so we should pack it
        for (const searchDir of searchDirs) {
            // Skip gameinfo_path and bee2 paths as they're not actual asset locations
            if (searchDir === "|gameinfo_path|." || searchDir.includes("bee2")) {
                continue
            }

            for (const ext of extensions) {
                const fullPath = path.join(portal2Dir, searchDir, baseAssetPath + ext)

                if (fs.existsSync(fullPath)) {
                    logger.debug(`Found ${baseAssetPath + ext} in ${searchDir}`)
                    return true // Asset exists in Portal 2 search paths - PACK IT!
                }
            }
        }

        logger.debug(`Did not find ${assetPath} in Portal 2's search paths`)
        return false // Asset doesn't exist in Portal 2 search paths - DON'T PACK IT!
    } catch (error) {
        console.error(
            `Failed to check whether ${assetPath} is in Portal 2's search paths:`,
            error,
        )
        return false // Assume it doesn't exist if we can't check
    }
}

/**
 * Get base assets list (now uses dynamic VPK checking instead of hardcoded list)
 * @returns {Promise<Array>} Empty array since we now check dynamically
 */
async function getBaseAssets() {
    return [] // Return empty array since we check dynamically now
}

/**
 * Find Portal 2 search directories from gameinfo.txt
 * @param {string} portal2Dir - Portal 2 directory path
 * @returns {Array} Array of search directories
 */
function getPortal2SearchDirs(portal2Dir) {
    const searchDirs = []

    try {
        const gameinfoPath = path.join(portal2Dir, "portal2", "gameinfo.txt")
        if (!fs.existsSync(gameinfoPath)) {
            return searchDirs
        }

        const content = fs.readFileSync(gameinfoPath, "utf-8")

        // Find Game entries
        const gameMatches = content.match(/Game\s+("[^"]+"|\w+)/g)
        if (gameMatches) {
            for (const match of gameMatches) {
                const dir = match.replace(/Game\s+/, "").replace(/"/g, "")
                searchDirs.push(dir)
            }
        }

        // Find portal2_dlc folders
        let count = 1
        while (true) {
            const dlcPath = path.join(portal2Dir, `portal2_dlc${count}`)
            if (!fs.existsSync(dlcPath)) {
                break
            }
            searchDirs.push(`portal2_dlc${count}`)
            count++
        }
    } catch (error) {
        console.error(
            "Failed to read Portal 2's search paths from gameinfo.txt:",
            error,
        )
    }

    return searchDirs
}

/**
 * Copy asset from Portal 2 to package resources
 * @param {string} assetPath - Asset path in Portal 2
 * @param {string} portal2Dir - Portal 2 directory path
 * @param {string} packageDir - Package directory path
 * @param {Array} searchDirs - Portal 2 search directories
 * @returns {Array} Array of copied file paths
 */
function copyAssetToPackage(assetPath, portal2Dir, packageDir, searchDirs) {
    const copiedFiles = []

    try {
        // Determine file extensions based on asset type
        let extensions = []
        let baseAssetPath = assetPath
        
        if (assetPath.startsWith("materials/")) {
            extensions = [".vtf", ".vmt"]
        } else if (assetPath.startsWith("models/")) {
            // Strip .mdl extension from the path before adding extensions
            baseAssetPath = assetPath.replace(".mdl", "")
            extensions = [".mdl", ".phy", ".vvd", ".dx90.vtx"]
        } else if (assetPath.startsWith("scripts/")) {
            extensions = [".nut"]
        } else if (assetPath.startsWith("messages/")) {
            const ext = path.extname(assetPath)
            extensions = [ext]
        } else if (assetPath.startsWith("sounds/")) {
            extensions = [".wav", ".mp3"]
        }

        // Search for the asset in Portal 2 directories
        for (const searchDir of searchDirs) {
            // Skip gameinfo_path and bee2 paths as they're not actual asset locations
            if (searchDir === "|gameinfo_path|." || searchDir.includes("bee2")) {
                continue
            }
            
            for (const ext of extensions) {
                const sourcePath = path.join(
                    portal2Dir,
                    searchDir,
                    baseAssetPath + ext,
                )

                if (fs.existsSync(sourcePath)) {
                    // Create target path using just the asset path, not the full Portal 2 structure
                    const targetPath = path.join(
                        packageDir,
                        "resources",
                        baseAssetPath + ext,
                    )

                    // Create target directory if it doesn't exist
                    const targetDir = path.dirname(targetPath)
                    if (!fs.existsSync(targetDir)) {
                        fs.mkdirSync(targetDir, { recursive: true })
                    }

                    // Copy file if target doesn't exist
                    if (!fs.existsSync(targetPath)) {
                        fs.copyFileSync(sourcePath, targetPath)
                        copiedFiles.push(targetPath)
                        logger.debug(
                            `Copied ${baseAssetPath + ext} from ${searchDir}`,
                        )
                    } else {
                        logger.debug(
                            `Skipped ${baseAssetPath + ext}, the package already has it`,
                        )
                    }
                }
            }
        }
    } catch (error) {
        console.error(`Failed to copy ${assetPath} into the package:`, error)
    }

    return copiedFiles
}

module.exports = {
    extractAssetsFromVMF,
    findDependentMaterials,
    getBaseAssets,
    getPortal2SearchDirs,
    copyAssetToPackage,
    assetExistsInPortal2,
}
