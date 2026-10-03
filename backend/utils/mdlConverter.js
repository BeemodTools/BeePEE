// MDL conversion using STUDIOMDL from Source SDK
const fs = require("fs")
const path = require("path")
const { exec } = require("child_process")
const { promisify } = require("util")
const { app } = require("electron")
const sharp = require("sharp")
const { findPortal2Resources } = require("../data")
const { convertImageToVTF } = require("./vtfConverter")
const { isDev } = require("./isDev.js")

const execAsync = promisify(exec)

/**
 * Helper to create directory with retry logic for EPERM errors
 * Windows sometimes holds file handles briefly - retry with delays
 */
async function mkdirWithRetry(dirPath, maxAttempts = 5) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true })
            }
            return true
        } catch (error) {
            if (error.code === "EPERM" || error.code === "EBUSY") {
                if (attempt < maxAttempts - 1) {
                    console.warn(`mkdir attempt ${attempt + 1} failed (${error.code}), retrying in ${(attempt + 1) * 200}ms...`)
                    await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 200))
                } else {
                    throw error
                }
            } else {
                throw error
            }
        }
    }
}

/**
 * Helper to get STUDIOMDL path
 */
function getStudioMDLPath() {
    const studiomdlPath = isDev
        ? path.join(__dirname, "..", "libs", "studiomdl", "studiomdl.exe")
        : path.join(
              process.resourcesPath,
              "extraResources",
              "studiomdl",
              "studiomdl.exe",
          )

    return studiomdlPath
}

/**
 * Generate a QC file for STUDIOMDL compilation
 * @param {string} objPath - Path to the OBJ file
 * @param {string} outputPath - Path where the QC file should be saved
 * @param {Object} options - QC generation options
 * @returns {Promise<string>} - Path to the generated QC file
 */
async function generateQCFile(objPath, outputPath, options = {}) {
    const modelName =
        options.modelName || path.basename(objPath, path.extname(objPath))
    const scale = options.scale || 1.0
    // Materials folder can be different from model name (for shared materials)
    const materialsFolder = options.materialsFolder || modelName
    // Parent folder for models - all variants go in same folder
    const modelFolder = options.modelFolder || modelName

    // Get relative path from QC to OBJ (they should be in same directory)
    const objFileName = path.basename(objPath)

    // Generate QC content
    // All models for an item go in the same folder: bpee/{itemID}/{variant}.mdl
    // $cdmaterials should point to where VMT files are stored (relative to materials/ folder)
    const qcContent = `$modelname "props_map_editor/bpee/${modelFolder}/${modelName}.mdl"
$staticprop
$body body "${objFileName}"
$surfaceprop "default"
$cdmaterials "models/props_map_editor/bpee/${materialsFolder}/"
$scale ${scale}
$sequence idle "${objFileName}" fps 30
`

    fs.writeFileSync(outputPath, qcContent, "utf-8")

    return outputPath
}

/**
 * Reverse the rotation that was applied for Three.js viewing
 * Converts from Three.js coordinates back to Source Engine coordinates
 * @param {string} objPath - Path to the rotated OBJ file
 * @param {string} outputPath - Path for the un-rotated OBJ file
 */
function reverseSourceEngineRotation(objPath, outputPath) {

    const objContent = fs.readFileSync(objPath, "utf-8")
    const lines = objContent.split("\n")
    const reversedLines = []

    let vertexCount = 0
    let normalCount = 0

    for (const line of lines) {
        if (line.startsWith("v ")) {
            // Vertex line: v x y z [w]
            const parts = line.trim().split(/\s+/)
            if (parts.length >= 4) {
                const x = parseFloat(parts[1])
                const y = parseFloat(parts[2])
                const z = parseFloat(parts[3])

                // Apply Y -90° rotation first
                let rotatedX = -z
                let rotatedY = y
                let rotatedZ = x

                // Then apply X +90° rotation
                const originalX = rotatedX
                const originalY = -rotatedZ
                const originalZ = rotatedY

                let reversedLine = `v ${originalX} ${originalY} ${originalZ}`
                if (parts.length > 4) {
                    reversedLine += ` ${parts[4]}`
                }
                reversedLines.push(reversedLine)
                vertexCount++
            } else {
                reversedLines.push(line)
            }
        } else if (line.startsWith("vn ")) {
            // Normal line: vn x y z
            const parts = line.trim().split(/\s+/)
            if (parts.length >= 4) {
                const nx = parseFloat(parts[1])
                const ny = parseFloat(parts[2])
                const nz = parseFloat(parts[3])

                // Apply Y -90° rotation only (same as vertices)
                const originalNx = nz
                const originalNy = ny
                const originalNz = -nx

                reversedLines.push(
                    `vn ${originalNx} ${originalNy} ${originalNz}`,
                )
                normalCount++
            } else {
                reversedLines.push(line)
            }
        } else {
            reversedLines.push(line)
        }
    }

    fs.writeFileSync(outputPath, reversedLines.join("\n"), "utf-8")
}

/**
 * Converts an OBJ file to MDL format using STUDIOMDL
 * @param {string} objPath - Path to the source OBJ file (rotated for Three.js viewing)
 * @param {string} outputDir - Directory where MDL files should be created (temp location)
 * @param {Object} options - Conversion options
 * @param {string} options.packageMaterialsDir - Directory containing the VTF/VMT materials for this model
 * @returns {Promise<{mdlPath: string, vvdPath: string, vtxPath: string}>}
 */
async function convertObjToMDL(objPath, outputDir, options = {}) {
    if (!objPath || !fs.existsSync(objPath)) {
        throw new Error(`OBJ file not found: ${objPath}`)
    }

    const studiomdlPath = getStudioMDLPath()
    if (!fs.existsSync(studiomdlPath)) {
        throw new Error(`STUDIOMDL not found at: ${studiomdlPath}`)
    }

    // Ensure output directory exists (with retry for EPERM errors)
    await mkdirWithRetry(outputDir)

    const modelName =
        options.modelName || path.basename(objPath, path.extname(objPath))

    // Create a copy of the OBJ with REVERSED rotation for STUDIOMDL
    // The original OBJ is rotated for Three.js viewing, but Source Engine needs original coordinates
    const unrotatedObjPath = objPath.replace(".obj", "_sourcecoords.obj")
    reverseSourceEngineRotation(objPath, unrotatedObjPath)

    // Generate QC file pointing to the UN-ROTATED OBJ (Source Engine coordinates)
    const qcPath = path.join(path.dirname(unrotatedObjPath), `${modelName}.qc`)
    await generateQCFile(unrotatedObjPath, qcPath, {
        modelName,
        scale: options.scale,
        materialsFolder: options.materialsFolder, // Allow override for shared materials
        modelFolder: options.modelFolder, // Allow override for model parent folder
    })

    console.log(`Compiling MDL: ${path.basename(qcPath)}`)

    // Get Portal 2 game directory for STUDIOMDL -game parameter
    let gameDir = null
    try {
        const p2Resources = await findPortal2Resources()
        if (p2Resources?.root) {
            gameDir = path.join(p2Resources.root, "portal2")
        }
    } catch (error) {
        console.warn("Could not find Portal 2 directory:", error.message)
    }

    if (!gameDir || !fs.existsSync(gameDir)) {
        throw new Error(
            "Portal 2 game directory not found. STUDIOMDL requires -game parameter.",
        )
    }

    // Copy materials to Portal 2 game directory for STUDIOMDL compilation
    // Materials should ALREADY be converted to VTF/VMT format before calling this function
    const gameMaterialsDir = path.join(
        gameDir,
        "materials",
        "models",
        "props_map_editor",
    )
    await mkdirWithRetry(gameMaterialsDir)

    // Copy materials from package resources to Portal 2 (temporarily for compilation)
    const packageMaterialsDir = options.packageMaterialsDir
    if (packageMaterialsDir && fs.existsSync(packageMaterialsDir)) {
        // Copy all VTF/VMT files to Portal 2
        const copyDir = (src, dest) => {
            if (!fs.existsSync(dest)) {
                try {
                    fs.mkdirSync(dest, { recursive: true })
                } catch (e) {
                    // Ignore if already exists
                    if (e.code !== "EEXIST") throw e
                }
            }
            const entries = fs.readdirSync(src, { withFileTypes: true })
            for (const entry of entries) {
                const srcPath = path.join(src, entry.name)
                const destPath = path.join(dest, entry.name)
                if (entry.isDirectory()) {
                    copyDir(srcPath, destPath)
                } else {
                    fs.copyFileSync(srcPath, destPath)
                }
            }
        }
        copyDir(packageMaterialsDir, gameMaterialsDir)
    } else {
        console.warn(`⚠️ Package materials directory not found`)
    }

    // Run STUDIOMDL
    const cmd = `"${studiomdlPath}" -game "${gameDir}" -nop4 -verbose "${qcPath}"`

    try {
        const { stdout, stderr } = await execAsync(cmd, {
            cwd: path.dirname(studiomdlPath),
            maxBuffer: 1024 * 1024 * 10, // 10MB buffer for large outputs
            timeout: 120000, // 2 minute timeout
        })

        if (stderr && !stderr.includes("already exists")) console.warn("STUDIOMDL stderr:", stderr)

        // STUDIOMDL outputs to the game directory structure
        // The model will be at: gameDir/models/props_map_editor/bpee/{modelFolder}/{modelName}.mdl
        const modelFolder = options.modelFolder || modelName
        const compiledBasePath = path.join(
            gameDir,
            "models",
            "props_map_editor",
            "bpee",
            modelFolder,
            modelName,
        )
        const mdlPath = `${compiledBasePath}.mdl`
        const vvdPath = `${compiledBasePath}.vvd`

        // STUDIOMDL can create various VTX formats, check which ones exist
        const dx90VtxPath = `${compiledBasePath}.dx90.vtx`
        const dx80VtxPath = `${compiledBasePath}.dx80.vtx`
        const swVtxPath = `${compiledBasePath}.sw.vtx`
        const legacyVtxPath = `${compiledBasePath}.vtx` // Sometimes just .vtx

        // Check if files were created
        if (!fs.existsSync(mdlPath)) {
            throw new Error(
                `MDL file was not created at expected location: ${mdlPath}`,
            )
        }

        console.log(`✅ MDL compiled: ${path.basename(mdlPath)}`)

        // Collect all VTX files that exist
        const result = {
            mdlPath: fs.existsSync(mdlPath) ? mdlPath : null,
            vvdPath: fs.existsSync(vvdPath) ? vvdPath : null,
        }

        // Portal 2 expects .dx90.vtx format
        // If STUDIOMDL created just .vtx, we need to also copy it as .dx90.vtx
        if (fs.existsSync(dx90VtxPath)) {
            result.dx90_vtxPath = dx90VtxPath
        } else if (fs.existsSync(legacyVtxPath)) {
            // Legacy .vtx exists, copy it as dx90
            result.dx90_vtxPath = legacyVtxPath // Will be renamed during copy
            result.vtxPath = legacyVtxPath // Also keep original
        }

        if (fs.existsSync(dx80VtxPath)) result.dx80_vtxPath = dx80VtxPath
        if (fs.existsSync(swVtxPath)) result.sw_vtxPath = swVtxPath

        return result
    } catch (error) {
        console.error("STUDIOMDL execution failed:", error)
        throw new Error(`STUDIOMDL compilation failed: ${error.message}`)
    }
}

/**
 * VMT for an editor model texture (a patch of item_lighting_common.vmt)
 * @param {string} folderName - Folder under materials/models/props_map_editor/bpee
 * @param {string} textureName - Texture file name without extension
 * @param {"translucent"|"alphatest"|null} [alphaMode] - How the texture's alpha
 *   is used; the VMF2OBJ converter marks this in the MTL ("# beepee:<mode>")
 * @returns {string}
 */
function editorVmt(folderName, textureName, alphaMode = null) {
    // $selfillum makes the shader read the base alpha as a self-illumination
    // mask instead of opacity, so transparent textures go without it (like
    // Valve's own translucent editor materials)
    const materialLines =
        alphaMode === "translucent"
            ? "$model 1\n$translucent 1\n"
            : alphaMode === "alphatest"
              ? "$model 1\n$alphatest 1\n$alphatestreference .5\n"
              : "$selfillum 1\n$model 1\n"
    return `patch
{
include "materials/models/props_map_editor/item_lighting_common.vmt"
insert
{
$basetexture "models/props_map_editor/bpee/${folderName}/${textureName}"
${materialLines}}
}
`
}

/**
 * Convert materials from PNG to VTF/VMT format and copy to package resources
 * @param {string} materialsSourceDir - Directory containing PNG materials from VMF2OBJ
 * @param {string} materialTargetDir - Target directory in package resources
 * @param {string} tempDir - Temporary models directory (for MTL file)
 * @param {string} itemName - Name of the item
 */
async function convertMaterialsToPackage(
    materialsSourceDir,
    materialTargetDir,
    tempDir,
    itemName,
) {
    if (!materialsSourceDir || !fs.existsSync(materialsSourceDir)) {
        console.warn(
            `⚠️ Materials source directory not found: ${materialsSourceDir}`,
        )
        return
    }

    console.log("Converting materials to VTF/VMT...")

    // Find all PNG/TGA files and convert them to VTF + create VMT
    // FLAT structure - all VTFs go directly in materialTargetDir
    const convertMaterials = async (src, flatDest) => {
        if (!fs.existsSync(src)) {
            console.warn(`⚠️ Source materials directory not found: ${src}`)
            return
        }

        await mkdirWithRetry(flatDest)

        const entries = fs.readdirSync(src, { withFileTypes: true })
        for (const entry of entries) {
            const srcPath = path.join(src, entry.name)

            if (entry.isDirectory()) {
                // Recurse into subdirectories but keep output FLAT
                await convertMaterials(srcPath, flatDest)
            } else if (entry.name.match(/\.png$/i)) {
                // Only process PNG files (TGAs were already converted to PNG by VMF2OBJ)
                // Textures are ALREADY cartoonified by VMF2OBJ stage, just convert to VTF
                // Extract just the filename, ignore any directory structure
                const baseFileName = path.basename(entry.name, ".png")
                const vtfPath = path.join(flatDest, baseFileName + ".vtf")
                const vmtPath = path.join(flatDest, baseFileName + ".vmt")

                try {

                    // Convert PNG directly to VTF (already cartoonified by VMF2OBJ)
                    await convertImageToVTF(srcPath, vtfPath, {
                        format: "DXT5",
                        generateMipmaps: true,
                        skipVMT: true,
                    })

                    // Create VMT file immediately after VTF
                    fs.writeFileSync(
                        vmtPath,
                        editorVmt(itemName, baseFileName),
                        "utf-8",
                    )
                } catch (error) {
                    console.error(`  Failed to convert ${entry.name}: ${error.message}`)
                }
            }
        }
    }

    // Parse MTL file to get material names and their texture paths
    // Try to find the MTL file - it might have a different name than itemName
    // VMF2OBJ outputs {baseName}.mtl or {baseName}_0.mtl based on the VMF filename
    let mtlFilePath = path.join(tempDir, itemName + "_0.mtl")

    // If not found, search for any .mtl file in temp directory
    if (!fs.existsSync(mtlFilePath)) {
        const tempFiles = fs.readdirSync(tempDir)
        // First try *_0.mtl, then any .mtl file
        let mtlFile = tempFiles.find((f) => f.endsWith("_0.mtl"))
        if (!mtlFile) {
            mtlFile = tempFiles.find((f) => f.endsWith(".mtl"))
        }
        if (mtlFile) {
            mtlFilePath = path.join(tempDir, mtlFile)
        }
    }

    const materialMap = {}
    const alphaModes = {}
    if (fs.existsSync(mtlFilePath)) {
        const mtlContent = fs.readFileSync(mtlFilePath, "utf-8")
        const lines = mtlContent.split("\n")
        let currentMaterial = null

        for (const line of lines) {
            if (line.startsWith("newmtl ")) {
                currentMaterial = line.substring(7).trim()
            } else if (currentMaterial && line.startsWith("map_Kd ")) {
                const texturePath = line
                    .substring(7)
                    .trim()
                    .replace("materials/", "")
                materialMap[currentMaterial] = texturePath
            } else if (currentMaterial && line.startsWith("# beepee:")) {
                // Translucent/alphatest marker written by the VMF2OBJ converter
                alphaModes[currentMaterial] = line.substring(9).trim()
            }
        }
        console.log(`Found ${Object.keys(materialMap).length} materials in MTL file`)
    } else {
        console.warn(`⚠️ MTL file not found: ${mtlFilePath}`)
    }

    // Convert all materials from temp_models/materials/ to resources/materials/models/props_map_editor/
    // And create VMT files based on MATERIAL NAMES, not file paths
    try {
        await convertMaterials(materialsSourceDir, materialTargetDir)

        // Now create VMT files based on TEXTURE filenames (not material names!)
        // STUDIOMDL references materials by their TEXTURE filename, not the MTL material name
        const createdVmts = new Set()

        for (const [materialName, texturePath] of Object.entries(materialMap)) {
            try {
                // Extract just the texture filename (no path, no extension)
                // Use split on BOTH / and \ since MTL files use forward slashes
                const textureFileName = texturePath
                    .split(/[/\\]/)
                    .pop()
                    .replace(/\.(png|tga)$/i, "")

                // VMT filename MUST match the texture filename (what STUDIOMDL uses)
                const vmtPath = path.join(
                    materialTargetDir,
                    textureFileName + ".vmt",
                )

                fs.writeFileSync(
                    vmtPath,
                    editorVmt(
                        itemName,
                        textureFileName,
                        alphaModes[materialName],
                    ),
                    "utf-8",
                )
                createdVmts.add(textureFileName)
            } catch (error) {
                console.error(`  Failed to create VMT for ${materialName}: ${error.message}`)
            }
        }

        // Fallback: Create VMT files for any VTF that doesn't have a corresponding VMT
        // This handles cases where MTL parsing failed or was incomplete
        if (fs.existsSync(materialTargetDir)) {
            const vtfFiles = fs.readdirSync(materialTargetDir).filter(f => f.endsWith('.vtf'))
            for (const vtfFile of vtfFiles) {
                const baseName = vtfFile.replace('.vtf', '')
                if (!createdVmts.has(baseName)) {
                    const vmtPath = path.join(materialTargetDir, baseName + ".vmt")
                    if (!fs.existsSync(vmtPath)) {
                        fs.writeFileSync(
                            vmtPath,
                            editorVmt(itemName, baseName),
                            "utf-8",
                        )
                    }
                }
            }
        }

        console.log(`✅ Materials converted: ${Object.keys(materialMap).length} materials`)
    } catch (error) {
        console.warn(`⚠️  Failed to convert materials: ${error.message}`)
        throw error
    }
}

/**
 * Copy compiled MDL files to package resources directory and clean up Portal 2 directory
 * @param {Object} compiledFiles - Object containing paths to compiled MDL files
 * @param {string} packagePath - Root path of the package
 * @param {string} itemName - Name of the item (for the model filename)
 * @param {string} materialsSourceDir - DEPRECATED: Materials should be converted before calling this
 * @returns {Promise<Object>} - Object containing final paths
 */
async function copyMDLToPackage(
    compiledFiles,
    packagePath,
    itemName,
    materialsSourceDir = null,
    sharedFolder = null,
    useStaging = false,
) {
    // STAGING MODE: Copy to .bpee/models/ instead of resources/models/ (applied on Save)
    // FINAL MODE: Copy directly to resources/models/ (used when saving staged files)
    const folderName = sharedFolder || itemName
    const baseDir = useStaging ? ".bpee" : "resources"
    const targetDir = path.join(
        packagePath,
        baseDir,
        "models",
        "props_map_editor",
        "bpee",
        folderName,
    )

    // Ensure target directory exists (with retry for EPERM errors)
    await mkdirWithRetry(targetDir)

    const copiedFiles = {}
    const filesToDelete = []

    // Copy each file type (ALL files: .mdl, .vvd, .vtx)
    for (const [fileType, sourcePath] of Object.entries(compiledFiles)) {
        if (sourcePath && fs.existsSync(sourcePath)) {
            const fileName = path.basename(sourcePath)
            const targetPath = path.join(targetDir, fileName)

            fs.copyFileSync(sourcePath, targetPath)

            copiedFiles[fileType] = targetPath

            // Only add to delete list once (avoid deleting same file twice if it's used for multiple types)
            if (!filesToDelete.includes(sourcePath)) {
                filesToDelete.push(sourcePath)
            }
        }
    }

    // Clean up: Delete the compiled files from Portal 2 directory
    let cleanupDir = null
    for (const filePath of filesToDelete) {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath)
                if (!cleanupDir) cleanupDir = path.dirname(filePath)
            }
        } catch (error) {
            console.warn(`  Failed to delete ${path.basename(filePath)}: ${error.message}`)
        }
    }

    // Try to clean up empty directories
    if (cleanupDir) {
        try {
            const itemIdDir = cleanupDir
            if (fs.existsSync(itemIdDir) && fs.readdirSync(itemIdDir).length === 0) {
                fs.rmdirSync(itemIdDir)
                const bpeeDir = path.dirname(itemIdDir)
                if (fs.existsSync(bpeeDir) && fs.readdirSync(bpeeDir).length === 0) {
                    fs.rmdirSync(bpeeDir)
                }
            }
        } catch (error) {
            // Ignore cleanup failures
        }
    }

    // Return the relative path for editoritems (relative to resources/models/)
    // Use folderName (shared folder) not itemName
    const relativeModelPath = `bpee/${folderName}/${itemName}.mdl`

    return {
        copiedFiles,
        relativeModelPath,
        targetDir,
    }
}

/**
 * Main function: Convert OBJ to MDL and place in package
 * @param {string} objPath - Path to source OBJ file
 * @param {string} packagePath - Root path of the package
 * @param {string} itemName - Name of the item
 * @param {Object} options - Conversion options
 * @returns {Promise<Object>} - Object with MDL paths and metadata
 */
async function convertAndInstallMDL(
    objPath,
    packagePath,
    itemName,
    options = {},
) {
    console.log(`🔄 Converting OBJ to MDL: ${itemName}`)

    // STAGING MODE: Use .bpee/tempmdl instead of temp_models
    const useStaging = options.useStaging !== false  // Default to true
    const tempDir = path.dirname(objPath)

    // Step 1: Convert materials from PNG to VTF/VMT FIRST (unless using shared materials)
    let materialTargetDir

    if (options.skipMaterialConversion && options.sharedMaterialsPath) {
        materialTargetDir = options.sharedMaterialsPath
    } else {
        const materialsSourceDir = path.join(tempDir, "materials")

        // STAGING MODE: Copy to .bpee/materials/ instead of resources/materials/
        const baseDir = useStaging ? ".bpee" : "resources"
        materialTargetDir = path.join(
            packagePath,
            baseDir,
            "materials",
            "models",
            "props_map_editor",
            "bpee",
            itemName,
        )

        await convertMaterialsToPackage(
            materialsSourceDir,
            materialTargetDir,
            tempDir,
            itemName,
        )
    }

    // Step 2: Compile OBJ to MDL using STUDIOMDL

    // Extract the materials folder name from the path
    // e.g., ".../bpee/old_aperture_walls/" -> "old_aperture_walls"
    const materialsFolderName = path.basename(materialTargetDir)

    // Use sharedModelFolder if provided, otherwise use itemName
    const modelFolderName = options.sharedModelFolder || itemName

    const compiledFiles = await convertObjToMDL(objPath, tempDir, {
        modelName: itemName,
        scale: options.scale || 1.0,
        packageMaterialsDir: materialTargetDir, // Pass the materials location
        materialsFolder: materialsFolderName, // Use shared folder name for $cdmaterials
        modelFolder: modelFolderName, // Use shared folder for all model variants
    })

    // Step 3: Copy MDL files to package
    const result = await copyMDLToPackage(
        compiledFiles,
        packagePath,
        itemName,
        null,
        modelFolderName,
        useStaging,
    )

    console.log(`✅ MDL complete: ${result.relativeModelPath}`)

    // Step 4: Generate 3DS collision model
    let threeDSResult = null
    try {
        // 3DS file should be named after the item (same as MDL)
        const threeDSFileName = `${itemName}.3ds`
        const threeDSPath = path.join(tempDir, threeDSFileName)

        // Convert OBJ to 3DS with collision scale and rotation (default 0.0078 scale, 90deg roll)
        const collisionScale = options.collisionScale || 0.0078
        const collisionRoll = options.collisionRoll || 90
        const collisionPitch = options.collisionPitch || 0
        const collisionYaw = options.collisionYaw || 0
        await convertObjTo3DS(
            objPath,
            threeDSPath,
            collisionScale,
            collisionRoll,
            collisionPitch,
            collisionYaw,
        )

        // Copy 3DS to package (STAGING MODE or final location)
        // Use sharedModelFolder if provided (for multi-model items), otherwise use itemName
        const folderName = options.sharedModelFolder || itemName
        threeDSResult = await copy3DSToPackage(
            threeDSPath,
            packagePath,
            folderName,
            itemName,
            useStaging,
        )

        console.log(`✅ 3DS collision model: ${threeDSResult.relativeModelPath}`)
    } catch (threeDSError) {
        console.warn(`⚠️ 3DS collision model failed: ${threeDSError.message}`)
        // Don't throw - 3DS is optional, MDL is the main output
        threeDSResult = { success: false, error: threeDSError.message }
    }

    return {
        success: true,
        ...result,
        compiledFiles,
        threeDSResult,
        // Staging information
        isStaged: useStaging,
        stagingPaths: useStaging ? {
            models: path.join(packagePath, ".bpee", "models"),
            materials: path.join(packagePath, ".bpee", "materials"),
            tempmdl: tempDir,
        } : null,
    }
}

// VBSP PARSER FOR MULTI-MODEL GENERATION
// ===========================================

/**
 * Converts VBSP format conditions to blocks format for processing
 * @param {Object} vbspConditions - VBSP format conditions
 * @returns {Array} Array of blocks
 */
function convertVbspToBlocks(vbspConditions) {
    const blocks = []
    
    if (!vbspConditions || !vbspConditions.Conditions) {
        return blocks
    }
    
    // Handle different VBSP structure patterns
    let conditions = []
    
    if (vbspConditions.Conditions.Condition) {
        // Single condition
        conditions = Array.isArray(vbspConditions.Conditions.Condition) 
            ? vbspConditions.Conditions.Condition 
            : [vbspConditions.Conditions.Condition]
    } else {
        // Multiple conditions or different structure
        const allKeys = Object.keys(vbspConditions.Conditions)
        const conditionKeys = allKeys.filter(key => 
            key.startsWith("Switch_") || 
            key.startsWith("MapInstVar_") ||
            key === "Switch" ||
            key === "MapInstVar"
        )
        
        if (conditionKeys.length > 0) {
            conditions = conditionKeys.map(key => vbspConditions.Conditions[key])
        } else {
            conditions = [vbspConditions.Conditions]
        }
    }
    
    // Convert each condition to block format
    conditions.forEach((condition, index) => {
        if (condition.Switch) {
            // Switch case condition
            const switchBlock = {
                id: `switch_${index}`,
                type: "switchCase",
                variable: condition.Switch.Variable || condition.Switch,
                method: "first",
                cases: []
            }
            
            // Add cases
            if (condition.Switch.Case) {
                const cases = Array.isArray(condition.Switch.Case) 
                    ? condition.Switch.Case 
                    : [condition.Switch.Case]
                
                cases.forEach((caseItem, caseIndex) => {
                    const caseBlock = {
                        id: `case_${index}_${caseIndex}`,
                        type: "case",
                        value: caseItem.Value || caseItem.value || caseIndex.toString(),
                        thenBlocks: []
                    }
                    
                    // Add changeInstance if present
                    if (caseItem.Result && caseItem.Result.Instance) {
                        caseBlock.thenBlocks.push({
                            id: `changeInstance_${index}_${caseIndex}`,
                            type: "changeInstance",
                            instanceName: caseItem.Result.Instance
                        })
                    }
                    
                    switchBlock.cases.push(caseBlock)
                })
            }
            
            blocks.push(switchBlock)
        } else if (condition.MapInstVar) {
            // IF condition
            const ifBlock = {
                id: `if_${index}`,
                type: "if",
                condition: condition.MapInstVar.Variable || condition.MapInstVar,
                thenBlocks: []
            }
            
            // Add changeInstance if present
            if (condition.MapInstVar.Result && condition.MapInstVar.Result.Instance) {
                ifBlock.thenBlocks.push({
                    id: `changeInstance_${index}`,
                    type: "changeInstance",
                    instanceName: condition.MapInstVar.Result.Instance
                })
            }
            
            blocks.push(ifBlock)
        }
    })
    
    return blocks
}

/**
 * Parses VBSP blocks to extract a mapping from variable values to instance paths.
 * @param {Array|Object} blocksOrVbsp - Either blocks array or VBSP conditions object.
 * @param {string} targetVariable - The variable to search for (e.g., "TIMER DELAY").
 * @param {Object} item - The item object to access registered instances.
 * @returns {Map<string, string>} A map where keys are variable values (e.g., "3", "4") and values are instance paths.
 */
function mapVariableValuesToInstances(blocksOrVbsp, targetVariable, item = null) {
    const valueInstanceMap = new Map()

    console.log(`Mapping variable "${targetVariable}" to instances...`)

    let blocks = blocksOrVbsp

    // Handle VBSP format conditions
    if (!Array.isArray(blocksOrVbsp) && blocksOrVbsp && typeof blocksOrVbsp === 'object') {
        if (blocksOrVbsp.blocks && Array.isArray(blocksOrVbsp.blocks)) {
            blocks = blocksOrVbsp.blocks
        } else {
            blocks = convertVbspToBlocks(blocksOrVbsp)
        }
    }

    if (!Array.isArray(blocks)) {
        console.warn("Blocks is not an array")
        return valueInstanceMap
    }

    // Handle "DEFAULT" or "First Instance" specially
    const normalizedVariable = targetVariable.toUpperCase()
    if (normalizedVariable === "DEFAULT" || normalizedVariable === "FIRST INSTANCE") {
        return valueInstanceMap // Empty map for First Instance
    }

    // Convert target variable to fixup format (e.g., "Timer Delay" -> "$timer_delay")
    const fixupVariable = `$${targetVariable.replace(/ /g, "_").toLowerCase()}`

    // Helper function to get the first registered instance
    const getFirstRegisteredInstance = () => {
        if (!item || !item.instances) {
            return null
        }
        const instanceKeys = Object.keys(item.instances).sort(
            (a, b) => parseInt(a, 10) - parseInt(b, 10),
        )
        const firstKey = instanceKeys[0]
        return firstKey ? item.instances[firstKey]?.Name : null
    }

    // Helper function to recursively search for changeInstance blocks
    const findChangeInstancesInBlock = (block) => {
        if (block.type === "changeInstance" && block.instanceName) {
            return [{ instanceName: block.instanceName, value: null }]
        }

        const results = []

        // Check children array (for nested blocks)
        if (Array.isArray(block.children)) {
            for (const child of block.children) {
                results.push(...findChangeInstancesInBlock(child))
            }
        }

        // Check thenBlocks array (for IF blocks)
        if (Array.isArray(block.thenBlocks)) {
            for (const child of block.thenBlocks) {
                results.push(...findChangeInstancesInBlock(child))
            }
        }

        // Check elseBlocks array (for IF-ELSE blocks)
        if (Array.isArray(block.elseBlocks)) {
            for (const child of block.elseBlocks) {
                results.push(...findChangeInstancesInBlock(child))
            }
        }

        return results
    }

    // 1. First, try to find a SWITCH block for the target variable
    const switchBlock = blocks.find(
        (block) =>
            block.type === "switchCase" && block.variable === fixupVariable,
    )

    if (switchBlock && Array.isArray(switchBlock.cases)) {
        // Extract the value-to-instance mapping from each case
        for (const caseBlock of switchBlock.cases) {
            // Cases use 'thenBlocks' not 'children'!
            const blocks = caseBlock.thenBlocks || caseBlock.children || []
            if (caseBlock.value && Array.isArray(blocks)) {
                const changeInstanceBlock = blocks.find(
                    (child) => child.type === "changeInstance",
                )
                if (changeInstanceBlock && changeInstanceBlock.instanceName) {
                    valueInstanceMap.set(
                        caseBlock.value,
                        changeInstanceBlock.instanceName,
                    )
                }
            }
        }
    } else {
        // 2. If no switch block, look for IF/ELSE blocks that check this variable
        for (const block of blocks) {
            if (block.type === "if" || block.type === "ifElse") {
                // Check if this IF block uses our target variable
                const condition = block.condition || block.variable
                if (
                    condition &&
                    condition.includes(fixupVariable)
                ) {
                    // Extract the value being checked
                    let value = null

                    // Check for comparison pattern (e.g., "$timer_delay == 5")
                    const comparisonMatch = condition.match(/==\s*["']?(\w+)["']?/)
                    if (comparisonMatch) {
                        value = comparisonMatch[1]
                    } else if (condition === fixupVariable || condition === `"${fixupVariable}"`) {
                        // Handle boolean conditions (e.g., "$start_enabled" or "\"$start_enabled\"")
                        value = "true"
                    }

                    if (value) {
                        // Find changeInstance in this block's children
                        const instances = findChangeInstancesInBlock(block)
                        if (instances.length > 0) {
                            valueInstanceMap.set(
                                value,
                                instances[0].instanceName,
                            )
                        }

                        // For IF statements without ELSE, also add a default case
                        if (block.type === "if" && !block.elseBlocks) {
                            const firstInstance = getFirstRegisteredInstance()
                            if (firstInstance) {
                                valueInstanceMap.set("false", firstInstance)
                            }
                        }
                    }
                }
            }
        }
    }

    console.log(`   Mapped "${targetVariable}": ${valueInstanceMap.size} entries`)

    return valueInstanceMap
}

/**
 * Convert OBJ file to 3DS format using Trimesh
 * @param {string} objPath - Path to the source OBJ file
 * @param {string} outputPath - Path where 3DS should be saved
 * @param {number} scale - Scale factor for collision model (default: 0.9 for smaller collision)
 * @param {number} roll - Roll rotation in degrees around X-axis (default: 90)
 * @param {number} pitch - Pitch rotation in degrees around Y-axis (default: 0)
 * @param {number} yaw - Yaw rotation in degrees around Z-axis (default: 0)
 * @returns {Promise<string>} - Path to the created 3DS file
 */
async function convertObjTo3DS(
    objPath,
    outputPath,
    scale = 0.9,
    roll = 90,
    pitch = 0,
    yaw = 0,
) {
    if (!objPath || !fs.existsSync(objPath)) {
        throw new Error(`OBJ file not found: ${objPath}`)
    }

    const converterExe = isDev
        ? path.join(
              __dirname,
              "..",
              "libs",
              "areng_obj23ds",
              "convert_obj_to_3ds.exe",
          )
        : path.join(
              process.resourcesPath,
              "extraResources",
              "areng_obj23ds",
              "convert_obj_to_3ds.exe",
          )

    if (!fs.existsSync(converterExe)) {
        throw new Error(`Trimesh converter not found at: ${converterExe}`)
    }

    // Ensure output directory exists (with retry for EPERM errors)
    const outputDir = path.dirname(outputPath)
    await mkdirWithRetry(outputDir)

    // Run the converter executable with scale and rotation parameters
    const cmd = `"${converterExe}" "${objPath}" "${outputPath}" ${scale} ${roll} ${pitch} ${yaw}`

    try {
        const { stdout, stderr } = await execAsync(cmd, {
            maxBuffer: 1024 * 1024 * 10, // 10MB buffer
            timeout: 60000, // 1 minute timeout
        })

        if (stderr) console.warn("3DS converter stderr:", stderr)

        // Verify the file was created
        if (!fs.existsSync(outputPath)) {
            throw new Error(`3DS file was not created at: ${outputPath}`)
        }

        return outputPath
    } catch (error) {
        console.error("3DS conversion failed:", error)
        throw new Error(`3DS conversion failed: ${error.message}`)
    }
}

/**
 * Copy 3DS collision model to package resources
 * @param {string} threeDSPath - Path to the source 3DS file
 * @param {string} packagePath - Root path of the package
 * @param {string} folderName - Folder name (matches MDL folder structure)
 * @param {string} itemName - Name of the item (for filename)
 * @returns {Promise<Object>} - Object with copied file info and relative path
 */
async function copy3DSToPackage(
    threeDSPath,
    packagePath,
    folderName,
    itemName,
    useStaging = false,
) {
    if (!threeDSPath || !fs.existsSync(threeDSPath)) {
        throw new Error(`3DS file not found: ${threeDSPath}`)
    }

    // STAGING MODE: Copy to .bpee/models/puzzlemaker instead of resources/models/puzzlemaker
    const baseDir = useStaging ? ".bpee" : "resources"
    const targetDir = path.join(
        packagePath,
        baseDir,
        "models",
        "puzzlemaker",
        "selection_bpee",
        folderName,
    )

    // Ensure target directory exists (with retry for EPERM errors)
    await mkdirWithRetry(targetDir)

    // Copy the 3DS file with the correct name
    const fileName = `${itemName}.3ds`
    const targetPath = path.join(targetDir, fileName)

    fs.copyFileSync(threeDSPath, targetPath)

    // Return the relative path for editoritems
    // Path should be relative to resources/models/
    // This creates the path that Portal 2 expects: puzzlemaker/selection_bpee/{folderName}/{itemName}.3ds
    const relativeModelPath = `puzzlemaker/selection_bpee/${folderName}/${fileName}`

    return {
        targetPath,
        relativeModelPath,
        targetDir,
    }
}

module.exports = {
    getStudioMDLPath,
    generateQCFile,
    convertObjToMDL,
    convertMaterialsToPackage,
    editorVmt,
    copyMDLToPackage,
    convertAndInstallMDL,
    mapVariableValuesToInstances,
    convertObjTo3DS,
    copy3DSToPackage,
}
