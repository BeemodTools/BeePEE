// VTF conversion using MareTF (MIT License)
const fs = require("fs")
const path = require("path")
const { exec } = require("child_process")
const { promisify } = require("util")
const { app } = require("electron")
const { isDev } = require("./isDev.js")

const execAsync = promisify(exec)

// Helper to get MareTF path for Electron
function getMareTFPath() {
    const maretfPath = isDev
        ? path.join(__dirname, "..", "libs", "maretf", "maretf.exe")
        : path.join(
              process.resourcesPath,
              "extraResources",
              "maretf",
              "maretf.exe",
          )

    return maretfPath
}

/**
 * Converts an image file to VTF format using MareTF
 * @param {string} imagePath - Path to the source image file
 * @param {string} outputPath - Path where the VTF file should be saved
 * @param {Object} options - Conversion options
 * @returns {Promise<void>}
 */
/**
 * Finds the next power of 2 that is >= the given number
 */
function nextPowerOf2(n) {
    return Math.pow(2, Math.ceil(Math.log2(n)))
}

/**
 * Resizes and squares an image to power-of-2 dimensions for Source engine compatibility
 */
async function prepareImageForVTF(imagePath, tempPath) {
    const sharp = require("sharp")

    try {
        // Get image metadata
        const metadata = await sharp(imagePath).metadata()
        const { width, height } = metadata

        // Find the larger dimension and round up to next power of 2, but cap it for smaller VTF files
        const maxDimension = Math.max(width, height)
        let targetSize = Math.max(nextPowerOf2(maxDimension), 64) // Minimum 64x64

        // Cap the maximum size to keep VTF files smaller (max 512x512 instead of going higher)
        targetSize = Math.min(targetSize, 512)

        // Resize to square power-of-2 dimensions by stretching to fit
        await sharp(imagePath)
            .resize(targetSize, targetSize, {
                fit: "fill", // Stretch to fill the entire area, ignoring aspect ratio
            })
            .png() // Ensure consistent format for MareTF
            .toFile(tempPath)

        return tempPath
    } catch (error) {
        console.warn(
            `Failed to resize ${path.basename(imagePath)} for VTF, using it as is:`,
            error,
        )
        // If preparation fails, use original image
        return imagePath
    }
}

async function convertImageToVTF(imagePath, outputPath, options = {}) {
    let processedImagePath = imagePath // Initialize to original path

    try {
        // Ensure output directory exists
        const outputDir = path.dirname(outputPath)
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true })
        }

        // Remove existing VTF file if it exists to ensure clean overwrite
        if (fs.existsSync(outputPath)) {
            try {
                fs.unlinkSync(outputPath)
            } catch (removeError) {
                console.warn(
                    `Failed to delete the old ${path.basename(outputPath)}, overwriting it instead:`,
                    removeError,
                )
                // Continue anyway - MareTF might still be able to overwrite
            }
        }

        // Prepare image for VTF conversion (resize to square power-of-2)
        const tempImagePath = outputPath.replace(".vtf", "_temp.png")
        processedImagePath = await prepareImageForVTF(imagePath, tempImagePath)

        // Try MareTF first if available
        const maretfPath = getMareTFPath()

        if (fs.existsSync(maretfPath)) {
            let maretfProcess = null
            let timeout = null

            try {
                // Build MareTF command with faster options
                const format = options.format || "DXT1" // DXT1 is faster than DXT5
                const version = options.version || "7.4"

                // Add speed optimizations
                const command = `"${maretfPath}" create "${processedImagePath}" -o "${outputPath}" --format "${format}" --version "${version}" --filter BOX --no-mips --quiet`

                // Use spawn instead of exec to have better process control
                const { spawn } = require("child_process")
                const maretfArgs = [
                    "create",
                    processedImagePath,
                    "-o",
                    outputPath,
                    "--format",
                    format,
                    "--version",
                    version,
                    "--filter",
                    "BOX",
                    "--quiet",
                ]
                // Mipmaps are skipped by default (editor-icon textures);
                // pass mips: true for in-game textures viewed at a distance.
                if (!options.mips) maretfArgs.splice(maretfArgs.length - 1, 0, "--no-mips")
                maretfProcess = spawn(maretfPath, maretfArgs)

                // Set up timeout to kill process if it takes too long
                timeout = setTimeout(() => {
                    console.warn(
                        `MareTF took over 60 s to convert ${path.basename(imagePath)}, stopping it`,
                    )
                    if (maretfProcess && !maretfProcess.killed) {
                        maretfProcess.kill("SIGTERM")
                    }
                }, 60000) // 60 second timeout

                // Wait for process to complete
                await new Promise((resolve, reject) => {
                    let stdout = ""
                    let stderr = ""

                    maretfProcess.stdout.on("data", (data) => {
                        stdout += data.toString()
                    })

                    maretfProcess.stderr.on("data", (data) => {
                        stderr += data.toString()
                    })

                    maretfProcess.on("close", (code) => {
                        clearTimeout(timeout)

                        if (code === 0) {
                            resolve()
                        } else {
                            reject(
                                new Error(
                                    `MareTF process exited with code ${code}: ${stderr}`,
                                ),
                            )
                        }
                    })

                    maretfProcess.on("error", (error) => {
                        clearTimeout(timeout)
                        reject(error)
                    })
                })

                // MareTF uses stderr for some normal output, so check if file was actually created
                if (fs.existsSync(outputPath)) {
                    // Clean up temporary processed image if it was created
                    if (
                        processedImagePath !== imagePath &&
                        fs.existsSync(processedImagePath)
                    ) {
                        try {
                            fs.unlinkSync(processedImagePath)
                        } catch (cleanupError) {
                            // Ignore temp cleanup failures
                        }
                    }

                    // Create corresponding VMT file (unless skipVMT option is set)
                    if (options.skipVMT !== true) {
                        const vmtPath = outputPath.replace(".vtf", ".vmt")
                        await createVMTFile(vmtPath, outputPath)
                    }

                    return
                } else {
                    throw new Error(
                        `MareTF failed to create VTF file: Process completed but file not found`,
                    )
                }
            } catch (maretfError) {
                // Not logged here: the outer catch logs the error thrown below

                // Clean up timeout and process
                if (timeout) {
                    clearTimeout(timeout)
                }

                // Ensure process is killed if it's still running
                if (maretfProcess && !maretfProcess.killed) {
                    try {
                        maretfProcess.kill("SIGTERM")
                    } catch (killError) {
                        // Ignore kill failures
                    }
                }

                throw new Error(
                    `VTF conversion required but MareTF failed: ${maretfError.message}`,
                )
            }
        } else {
            throw new Error(
                "MareTF not found - VTF conversion is required for Source engine compatibility",
            )
        }

        // If we get here, VTF conversion failed and Source engine needs VTF files
        throw new Error(
            "VTF conversion failed - Source engine requires VTF format for textures",
        )
    } catch (error) {
        // Not logged here: every caller logs the failure in its own words

        // Clean up temporary processed image if it was created
        if (
            processedImagePath !== imagePath &&
            fs.existsSync(processedImagePath)
        ) {
            try {
                fs.unlinkSync(processedImagePath)
            } catch (cleanupError) {
                // Ignore temp cleanup failures
            }
        }

        throw error // Don't fallback to PNG since Source engine won't accept it
    }
}

/**
 * Creates a VMT file for a VTF texture
 * @param {string} vmtPath - Path where the VMT file should be created
 * @param {string} vtfPath - Path to the corresponding VTF file
 */
async function createVMTFile(vmtPath, vtfPath) {
    try {
        // Get the texture name relative to the materials directory
        // The $basetexture path is ABSOLUTE from materials/ directory
        const materialsDir = path.join(
            process.cwd(),
            "packages",
            "PieCreeper's Items",
            "resources",
            "materials",
        )
        const relativePath = path
            .relative(materialsDir, vtfPath)
            .replace(/\\/g, "/")
            .replace(".vtf", "")

        const vmtContent = `patch
{
include "materials/models/props_map_editor/item_lighting_common.vmt"
insert
{
$baseTexture "${relativePath}"
$selfillum 1
$model 1
}
}
`

        fs.writeFileSync(vmtPath, vmtContent, "utf-8")
    } catch (error) {
        console.error(`Failed to create ${vmtPath}:`, error)
        throw error
    }
}

/**
 * Converts palette image path to materials path structure
 * @param {string} packagePath - Path to the package directory
 * @param {string} imagePath - The image path from editoritems.json (e.g., "palette/beepkg/preplaced_gel.png")
 * @returns {string} - Full path to where the material file should be saved
 */
function getVTFPathFromImagePath(packagePath, imagePath) {
    // Keep the palette/ structure but change extension to .vtf
    const cleanPath = imagePath.replace(/\.[^.]+$/, ".vtf")

    // Build the full materials path: [package]/resources/materials/models/props_map_editor/[cleanPath]
    return path.join(
        packagePath,
        "resources",
        "materials",
        "models",
        "props_map_editor",
        cleanPath,
    )
}

/**
 * Updates editoritems.json file to point to the material file instead of the original image
 * @param {string} editorItemsPath - Path to editoritems.json
 * @param {string} originalImagePath - Original image path (e.g., "palette/beepkg/preplaced_gel.png")
 * @param {string} materialPath - Path to the material file (could be .vtf, .tga, or .png)
 * @returns {Object} - Updated editoritems object
 */
function updateEditorItemsWithVTF(
    editorItemsPath,
    originalImagePath,
    materialPath,
    packagePath,
) {
    if (!fs.existsSync(editorItemsPath)) {
        throw new Error(`Editor items file not found: ${editorItemsPath}`)
    }

    const editorItems = JSON.parse(fs.readFileSync(editorItemsPath, "utf-8"))

    // Determine which file actually exists (.vtf, .tga, or .png)
    let actualMaterialPath = materialPath
    const basePathWithoutExt = materialPath.replace(/\.[^.]+$/, "")

    // Check for VTF first (preferred), then TGA, then PNG
    const vtfPath = basePathWithoutExt + ".vtf"
    const tgaPath = basePathWithoutExt + ".tga"
    const pngPath = basePathWithoutExt + ".png"

    if (fs.existsSync(vtfPath)) {
        actualMaterialPath = vtfPath
    } else if (fs.existsSync(tgaPath)) {
        actualMaterialPath = tgaPath
    } else if (fs.existsSync(pngPath)) {
        actualMaterialPath = pngPath
    }

    // Get relative path from materials directory
    const materialsPath = path.join(packagePath, "resources", "materials")
    const relativeMaterialPath = path
        .relative(materialsPath, actualMaterialPath)
        .replace(/\\/g, "/")

    // Remove file extension for the path reference (Source engine adds the extension automatically)
    const referencePath = relativeMaterialPath.replace(/\.(vtf|tga|png)$/, "")

    // Update the Image path in the Palette section
    const editor = editorItems.Item?.Editor
    if (editor?.SubType) {
        const subType = Array.isArray(editor.SubType)
            ? editor.SubType[0]
            : editor.SubType

        // Check if this is a palette image path that needs VTF conversion
        if (
            subType?.Palette?.Image &&
            subType.Palette.Image.startsWith("palette/")
        ) {
            // Convert palette path to materials path (keep palette/ structure)
            const cleanPath = subType.Palette.Image.replace(/\.[^.]+$/, "")
            const materialsReferencePath = `models/props_map_editor/${cleanPath}`

            subType.Palette.Image = materialsReferencePath
        }
    }

    return editorItems
}

module.exports = {
    convertImageToVTF,
    getVTFPathFromImagePath,
    updateEditorItemsWithVTF,
    createVMTFile,
}
