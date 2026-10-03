const fs = require("fs")
const path = require("path")
const { findMdlDependencies } = require("./mdlDependencies")
const {
    extractAssetsFromVMF,
    getPortal2SearchDirs,
    copyAssetToPackage,
    assetExistsInPortal2,
} = require("./vmfAssetExtractor")
const { findPortal2Resources } = require("../data")

/**
 * Get the materials (and their textures) a model needs (see mdlDependencies.js)
 * @param {string} mdlPath - Model path, like "models/props/cube.mdl"
 * @param {string} portal2Dir - Portal 2's install folder
 * @param {string[]} searchDirs - Extra search folders, relative to portal2Dir
 * @returns {Promise<string[]>} Paths under materials/, without extensions
 */
async function getMdlMaterials(mdlPath, portal2Dir, searchDirs = []) {
    // Extra folders are searched after the game's own (as before, special
    // paths and BEE2's folder are skipped)
    const searchPaths = searchDirs
        .filter((dir) => !dir.includes("|") && !dir.includes("bee2"))
        .map((dir) => path.join(portal2Dir, dir))
        .filter((dir) => fs.existsSync(dir))
    const result = await findMdlDependencies(mdlPath, {
        portal2Root: portal2Dir,
        searchPaths,
    })
    if (!result.success) {
        console.warn(`Failed to get MDL materials for ${mdlPath}:`, result.error)
        return []
    }
    // Both .vmt and .vtf files are listed: strip extensions and deduplicate
    const materials = result.materials.map((m) => m.replace(/\.(vmt|vtf)$/, ""))
    return [...new Set(materials)]
}


/**
 * Perform autopacking for an instance VMF file
 * @param {string} instancePath - Path to the instance VMF file
 * @param {string} packageDir - Package directory path
 * @param {string} itemName - Name of the item
 * @returns {Promise<Object>} Result object with success status and packed files
 */
async function autopackInstance(instancePath, packageDir, itemName) {
    try {
        console.log(`Starting autopacking for instance: ${instancePath}`)

        // Extract assets from VMF
        const assets = extractAssetsFromVMF(instancePath)
        console.log(`Extracted assets:`, assets)

        // Get Portal 2 directory
        const portal2Resources = await findPortal2Resources()
        if (!portal2Resources || !portal2Resources.root) {
            console.warn(
                "Portal 2 not found - autopacking skipped. Assets must be manually packed.",
            )
            return {
                success: true,
                skipped: true,
                reason: "Portal 2 not installed",
                totalAssets: 0,
                packedAssets: 0,
            }
        }
        const portal2Dir = portal2Resources.root

        // Get Portal 2 search directories
        const searchDirs = getPortal2SearchDirs(portal2Dir)
        console.log(`Portal 2 search directories:`, searchDirs)

        // Combine all assets into a single list with proper prefixes
        let allAssets = []

        // Add models (already have models/ prefix)
        if (assets.MODEL) {
            allAssets = allAssets.concat(assets.MODEL)
        }

        // Add materials with materials/ prefix if missing
        if (assets.MATERIAL) {
            const materials = assets.MATERIAL.map(mat =>
                mat.startsWith("materials/") ? mat : `materials/${mat}`
            )
            allAssets = allAssets.concat(materials)
        }

        // Add sounds with sound/ prefix if missing
        if (assets.SOUND) {
            const sounds = assets.SOUND.map(snd =>
                snd.startsWith("sound/") ? snd : `sound/${snd}`
            )
            allAssets = allAssets.concat(sounds)
        }

        // Add scripts with scripts/ prefix if missing
        if (assets.SCRIPT) {
            const scripts = assets.SCRIPT.map(scr =>
                scr.startsWith("scripts/") ? scr : `scripts/${scr}`
            )
            allAssets = allAssets.concat(scripts)
        }

        // Find dependent materials for models using srctools
        const dependentAssets = []
        for (const asset of allAssets) {
            if (asset.startsWith("models/")) {
                console.log(`Finding materials for model: ${asset}`)
                const dependentMaterials = await getMdlMaterials(asset, portal2Dir, searchDirs)
                console.log(`Found ${dependentMaterials.length} materials for ${asset}:`, dependentMaterials)
                dependentAssets.push(...dependentMaterials)
            }
        }

        // Combine main assets with dependent assets
        allAssets = [...allAssets, ...dependentAssets]

        // Remove duplicates
        allAssets = [...new Set(allAssets)]

        // Filter assets based on Portal 2 search paths
        // If asset exists in Portal 2 search paths, we should pack it
        // If it doesn't exist, it's either a base asset (in VPK) or missing
        const assetsToPack = []
        for (const asset of allAssets) {
            if (assetExistsInPortal2(asset, portal2Dir, searchDirs)) {
                assetsToPack.push(asset)
                console.log(`Asset needs packing (found in Portal 2 search paths): ${asset}`)
            } else {
                console.log(`Asset skipped (not in Portal 2 search paths - likely base asset): ${asset}`)
            }
        }

        console.log(`Assets to pack: ${assetsToPack.length}/${allAssets.length}`)

        // Copy assets to package
        const packedFiles = []
        for (const asset of assetsToPack) {
            const copiedFiles = copyAssetToPackage(
                asset,
                portal2Dir,
                packageDir,
                searchDirs,
            )
            packedFiles.push(...copiedFiles)
        }

        // Verify packing
        // Files are copied to resources/{asset} directly, not resources/{searchDir}/{asset}
        const verificationResults = []
        for (const asset of assetsToPack) {
            // For models, check for the .mdl file
            let assetToCheck = asset
            if (asset.startsWith("models/") && !asset.endsWith(".mdl")) {
                assetToCheck = asset + ".mdl"
            }

            const packagePath = path.join(packageDir, "resources", assetToCheck)
            const found = fs.existsSync(packagePath)
            verificationResults.push({ asset, found })
        }

        const successCount = verificationResults.filter((r) => r.found).length
        const totalCount = verificationResults.length

        console.log(
            `Autopacking completed: ${successCount}/${totalCount} assets packed`,
        )

        const allPacked = successCount === totalCount
        const failedAssets = verificationResults.filter((r) => !r.found).map((r) => r.asset)

        return {
            success: allPacked,
            error: allPacked ? null : `Failed to verify ${failedAssets.length} assets: ${failedAssets.join(", ")}`,
            packedFiles,
            verificationResults,
            totalAssets: totalCount,
            packedAssets: successCount,
        }
    } catch (error) {
        console.error(`Autopacking failed for ${instancePath}:`, error.message)
        return {
            success: false,
            error: error.message,
            packedFiles: [],
            verificationResults: [],
            totalAssets: 0,
            packedAssets: 0,
        }
    }
}

module.exports = {
    autopackInstance,
}
