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
const { logger } = require("./logger")

/** "1 asset", "3 assets" */
const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`

/** The files that show an asset is packed, by its folder */
const PACKED_EXTENSIONS = {
    materials: [".vmt", ".vtf"],
    models: [".mdl"],
    scripts: [".nut"],
}

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
        console.warn(
            `Failed to find the materials of ${mdlPath}: ${result.error}`,
        )
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
    const title = `Autopacking ${instancePath} for "${itemName}"`
    return logger.section(title, async () => {
        try {
            // Extract assets from VMF
            const assets = extractAssetsFromVMF(instancePath)
            console.log(
                `Found ${plural(assets.MODEL?.length ?? 0, "model")}, ${plural(assets.MATERIAL?.length ?? 0, "material")}, ${plural(assets.SOUND?.length ?? 0, "sound")} and ${plural(assets.SCRIPT?.length ?? 0, "script")} in the instance`,
            )

            // Get Portal 2 directory
            const portal2Resources = await findPortal2Resources()
            if (!portal2Resources || !portal2Resources.root) {
                console.warn(
                    "Skipped autopacking, Portal 2 wasn't found (the instance's assets must be packed by hand)",
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
            logger.debug(`Portal 2 search paths: ${searchDirs.join(", ")}`)

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
                    const dependentMaterials = await getMdlMaterials(asset, portal2Dir, searchDirs)
                    logger.debug(
                        `${asset} uses ${plural(dependentMaterials.length, "material")}`,
                    )
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
                    logger.debug(`Packing ${asset}`)
                } else {
                    logger.debug(
                        `Not packing ${asset}, it's not in a search path (likely base game content)`,
                    )
                }
            }

            console.log(
                `Packing ${assetsToPack.length} of ${plural(allAssets.length, "asset")} (ones outside Portal 2's search paths are likely base game content)`,
            )

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
            // Files are copied to resources/{asset} directly, not resources/{searchDir}/{asset}.
            // Asset paths have no extension (except some models): a material
            // is packed when its .vmt or .vtf is there, a model its .mdl, a
            // script its .nut
            const verificationResults = []
            for (const asset of assetsToPack) {
                const packagePath = path.join(packageDir, "resources", asset)
                const base = packagePath.replace(/\.mdl$/, "")
                const extensions = PACKED_EXTENSIONS[asset.split("/")[0]] ?? []
                const found =
                    fs.existsSync(packagePath) ||
                    extensions.some((ext) => fs.existsSync(base + ext))
                verificationResults.push({ asset, found })
            }

            const successCount = verificationResults.filter((r) => r.found).length
            const totalCount = verificationResults.length

            console.log(
                `Packed ${successCount} of ${plural(totalCount, "asset")} (${plural(packedFiles.length, "file")})`,
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
            console.error("Autopacking failed:", error)
            return {
                success: false,
                error: error.message,
                packedFiles: [],
                verificationResults: [],
                totalAssets: 0,
                packedAssets: 0,
            }
        }
    })
}

module.exports = {
    autopackInstance,
}
