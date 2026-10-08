const fs = require("fs")
const path = require("path")
const sharp = require("sharp")
const { logger } = require("./logger")

const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`

/**
 * Native TGA Header structure
 */
const TGA_HEADER_SIZE = 18

/**
 * TGA Image Types
 */
const TGA_TYPE = {
    NO_IMAGE: 0,
    INDEXED: 1,
    RGB: 2,
    MONO: 3,
    RLE_INDEXED: 9,
    RLE_RGB: 10,
    RLE_MONO: 11,
}

/**
 * Parse TGA header from buffer
 * @param {Buffer} buffer - TGA file buffer
 * @returns {Object} TGA header info
 */
function parseTgaHeader(buffer) {
    if (buffer.length < TGA_HEADER_SIZE) {
        throw new Error("Invalid TGA file: header too small")
    }

    const header = {
        idLength: buffer.readUInt8(0),
        colorMapType: buffer.readUInt8(1),
        imageType: buffer.readUInt8(2),
        colorMapOrigin: buffer.readUInt16LE(3),
        colorMapLength: buffer.readUInt16LE(5),
        colorMapDepth: buffer.readUInt8(7),
        xOrigin: buffer.readUInt16LE(8),
        yOrigin: buffer.readUInt16LE(10),
        width: buffer.readUInt16LE(12),
        height: buffer.readUInt16LE(14),
        bitsPerPixel: buffer.readUInt8(16),
        imageDescriptor: buffer.readUInt8(17),
    }

    return header
}

/**
 * Decode TGA image data to RGBA
 * @param {Buffer} buffer - TGA file buffer
 * @param {Object} header - TGA header info
 * @returns {Buffer} RGBA pixel data
 */
function decodeTgaImage(buffer, header) {
    const { width, height, bitsPerPixel, imageType, idLength } = header
    const bytesPerPixel = Math.floor(bitsPerPixel / 8)
    const imageDataSize = width * height * bytesPerPixel

    // Skip ID field if present
    let dataStart = TGA_HEADER_SIZE + idLength

    // Skip color map if present
    if (header.colorMapType === 1) {
        const colorMapSize =
            header.colorMapLength * Math.floor(header.colorMapDepth / 8)
        dataStart += colorMapSize
    }

    let imageData

    // Handle different image types
    switch (imageType) {
        case TGA_TYPE.RGB:
            imageData = buffer.slice(dataStart, dataStart + imageDataSize)
            break

        case TGA_TYPE.RLE_RGB:
            imageData = decodeRLE(
                buffer,
                dataStart,
                width * height,
                bytesPerPixel,
            )
            break

        default:
            throw new Error(`Unsupported TGA image type: ${imageType}`)
    }

    // Convert to RGBA format
    const rgbaData = Buffer.alloc(width * height * 4)

    for (let i = 0; i < width * height; i++) {
        const srcOffset = i * bytesPerPixel
        const dstOffset = i * 4

        if (bytesPerPixel === 3) {
            // BGR to RGBA
            rgbaData[dstOffset] = imageData[srcOffset + 2] // R
            rgbaData[dstOffset + 1] = imageData[srcOffset + 1] // G
            rgbaData[dstOffset + 2] = imageData[srcOffset] // B
            rgbaData[dstOffset + 3] = 255 // A
        } else if (bytesPerPixel === 4) {
            // BGRA to RGBA
            rgbaData[dstOffset] = imageData[srcOffset + 2] // R
            rgbaData[dstOffset + 1] = imageData[srcOffset + 1] // G
            rgbaData[dstOffset + 2] = imageData[srcOffset] // B
            rgbaData[dstOffset + 3] = imageData[srcOffset + 3] // A
        } else {
            throw new Error(`Unsupported bits per pixel: ${bitsPerPixel}`)
        }
    }

    // Handle vertical flip if needed (TGA images are usually stored upside down)
    const flipVertical = (header.imageDescriptor & 0x20) === 0
    if (flipVertical) {
        const flippedData = Buffer.alloc(rgbaData.length)
        const rowSize = width * 4

        for (let y = 0; y < height; y++) {
            const srcRow = (height - 1 - y) * rowSize
            const dstRow = y * rowSize
            rgbaData.copy(flippedData, dstRow, srcRow, srcRow + rowSize)
        }

        return flippedData
    }

    return rgbaData
}

/**
 * Decode RLE compressed image data
 * @param {Buffer} buffer - Source buffer
 * @param {number} offset - Start offset in buffer
 * @param {number} pixelCount - Total number of pixels
 * @param {number} bytesPerPixel - Bytes per pixel
 * @returns {Buffer} Decoded pixel data
 */
function decodeRLE(buffer, offset, pixelCount, bytesPerPixel) {
    const decodedData = Buffer.alloc(pixelCount * bytesPerPixel)
    let srcPos = offset
    let dstPos = 0
    let pixelsDecoded = 0

    while (pixelsDecoded < pixelCount && srcPos < buffer.length) {
        const packet = buffer.readUInt8(srcPos++)
        const runLength = (packet & 0x7f) + 1

        if (packet & 0x80) {
            // RLE packet - repeat next pixel
            const pixel = buffer.slice(srcPos, srcPos + bytesPerPixel)
            srcPos += bytesPerPixel

            for (let i = 0; i < runLength; i++) {
                pixel.copy(decodedData, dstPos)
                dstPos += bytesPerPixel
            }
        } else {
            // Raw packet - copy pixels directly
            const pixelData = buffer.slice(
                srcPos,
                srcPos + runLength * bytesPerPixel,
            )
            srcPos += runLength * bytesPerPixel
            pixelData.copy(decodedData, dstPos)
            dstPos += runLength * bytesPerPixel
        }

        pixelsDecoded += runLength
    }

    return decodedData
}

/**
 * Convert TGA file to PNG using native parser
 * @param {string} tgaPath - Path to the TGA file
 * @param {string} pngPath - Output path for the PNG file
 * @returns {Promise<boolean>} - Success status
 */
async function convertTgaToPng(tgaPath, pngPath) {
    try {
        if (!fs.existsSync(tgaPath)) {
            console.warn(
                `Failed to convert ${tgaPath} to PNG: the file doesn't exist`,
            )
            return false
        }

        // Ensure output directory exists
        const outputDir = path.dirname(pngPath)
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true })
        }

        // Try Sharp first (faster for supported TGA formats)
        try {
            await sharp(tgaPath).png().toFile(pngPath)

            logger.debug(`Converted ${path.basename(tgaPath)} to PNG`)
            return true
        } catch (sharpError) {
            logger.debug(
                `Sharp can't read ${path.basename(tgaPath)} (${sharpError.message}), decoding it directly`,
            )

            // Fallback to native TGA parser
            const tgaBuffer = fs.readFileSync(tgaPath)
            const header = parseTgaHeader(tgaBuffer)
            const rgbaData = decodeTgaImage(tgaBuffer, header)

            // Use Sharp to create PNG from raw RGBA data
            await sharp(rgbaData, {
                raw: {
                    width: header.width,
                    height: header.height,
                    channels: 4,
                },
            })
                .png()
                .toFile(pngPath)

            logger.debug(
                `Converted ${path.basename(tgaPath)} to PNG with the built-in TGA decoder`,
            )
            return true
        }
    } catch (error) {
        console.error(`Failed to convert ${tgaPath} to PNG:`, error)
        return false
    }
}

/**
 * Convert all TGA files in a directory to PNG
 * @param {string} materialsDir - Directory containing TGA files
 * @returns {Promise<{converted: string[], failed: string[]}>} - Conversion results
 */
async function convertAllTgaInDirectory(materialsDir) {
    const results = { converted: [], failed: [] }

    if (!fs.existsSync(materialsDir)) {
        console.warn(`Skipped TGA conversion: ${materialsDir} doesn't exist`)
        return results
    }

    try {
        // Find all TGA files recursively
        const tgaFiles = findTgaFiles(materialsDir)

        // Convert each TGA file to PNG
        for (const tgaPath of tgaFiles) {
            const relativePath = path.relative(materialsDir, tgaPath)
            const pngPath = path.join(
                materialsDir,
                relativePath.replace(/\.tga$/i, ".png"),
            )

            const success = await convertTgaToPng(tgaPath, pngPath)
            if (success) {
                results.converted.push(relativePath)
            } else {
                results.failed.push(relativePath)
            }
        }

        const failed = results.failed.length
        console.log(
            `Converted ${plural(results.converted.length, "TGA texture")} to PNG${failed ? ` (${failed} failed)` : ""}`,
        )
    } catch (error) {
        console.error(
            `Failed to convert the TGA textures in ${materialsDir}:`,
            error,
        )
    }

    return results
}

/**
 * Find all TGA files in a directory recursively
 * @param {string} dir - Directory to search
 * @returns {string[]} - Array of TGA file paths
 */
function findTgaFiles(dir) {
    const tgaFiles = []

    function searchDirectory(currentDir) {
        try {
            const entries = fs.readdirSync(currentDir, { withFileTypes: true })

            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name)

                if (entry.isDirectory()) {
                    searchDirectory(fullPath)
                } else if (
                    entry.isFile() &&
                    entry.name.toLowerCase().endsWith(".tga")
                ) {
                    tgaFiles.push(fullPath)
                }
            }
        } catch (error) {
            console.warn(`Failed to read ${currentDir}, skipping it:`, error)
        }
    }

    searchDirectory(dir)
    return tgaFiles
}

/**
 * Update MTL file to reference PNG files instead of TGA
 * @param {string} mtlPath - Path to the MTL file
 * @returns {Promise<boolean>} - Success status
 */
async function updateMtlForPngTextures(mtlPath) {
    try {
        if (!fs.existsSync(mtlPath)) {
            console.warn(`Failed to update ${mtlPath}: the file doesn't exist`)
            return false
        }

        let mtlContent = fs.readFileSync(mtlPath, "utf8")
        let modified = false

        // Replace .tga extensions with .png in texture references
        // Common MTL texture directives: map_Kd, map_Ka, map_Ks, map_Ns, map_d, map_bump, etc.
        const textureDirectives = [
            "map_Kd",
            "map_Ka",
            "map_Ks",
            "map_Ns",
            "map_d",
            "map_bump",
            "bump",
            "disp",
            "decal",
        ]

        for (const directive of textureDirectives) {
            const regex = new RegExp(`^(${directive}\\s+.+)\\.tga\\s*$`, "gmi")
            const newContent = mtlContent.replace(regex, "$1.png")
            if (newContent !== mtlContent) {
                mtlContent = newContent
                modified = true
            }
        }

        if (modified) {
            // Create backup of original MTL file
            const backupPath = mtlPath + ".tga-backup"
            if (!fs.existsSync(backupPath)) {
                fs.copyFileSync(mtlPath, backupPath)
            }

            // Write updated MTL file
            fs.writeFileSync(mtlPath, mtlContent, "utf8")
            console.log(
                `Updated ${path.basename(mtlPath)} to use the PNG textures`,
            )
            return true
        } else {
            console.log(
                `Found no TGA textures to replace in ${path.basename(mtlPath)}`,
            )
            return true
        }
    } catch (error) {
        console.error(`Failed to update ${mtlPath}:`, error)
        return false
    }
}

/**
 * Convert TGA textures to PNG and update MTL file - complete workflow
 * @param {string} outputDir - Directory containing the OBJ/MTL and materials
 * @param {string} baseName - Base name of the OBJ/MTL files
 * @returns {Promise<{success: boolean, converted: string[], failed: string[]}>}
 */
async function convertTexturesForModel(outputDir, baseName) {
    const title = `Converting the TGA textures of ${baseName} to PNG`
    return logger.section(title, async () => {
        const results = { success: false, converted: [], failed: [] }

        try {
            // Find materials directory
            const materialsDir = path.join(outputDir, "materials")
            if (!fs.existsSync(materialsDir)) {
                console.log("Skipped, there's no materials folder")
                results.success = true
                return results
            }

            // Convert all TGA files to PNG
            const conversionResults = await convertAllTgaInDirectory(materialsDir)
            results.converted = conversionResults.converted
            results.failed = conversionResults.failed

            // Update MTL file if any conversions were successful
            const mtlPath = path.join(outputDir, `${baseName}.mtl`)
            if (conversionResults.converted.length > 0) {
                const mtlUpdated = await updateMtlForPngTextures(mtlPath)
                // Consider it successful even if some files failed, as long as MTL was updated
                results.success = mtlUpdated
            } else if (conversionResults.failed.length === 0) {
                results.success = true
            } else {
                results.success = false
            }
        } catch (error) {
            console.error(
                `Failed to convert the TGA textures of ${baseName}:`,
                error,
            )
            results.success = false
        }

        return results
    })
}

module.exports = {
    convertTgaToPng,
    convertAllTgaInDirectory,
    updateMtlForPngTextures,
    convertTexturesForModel,
    findTgaFiles,
}
