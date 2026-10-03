const fs = require("fs")
const path = require("path")
const { app } = require("electron")
const { findPortal2Resources } = require("../data")
const { VmfConverter, assertHasGeometry } = require("./vmfConverter")
const { cartoonify } = require("./cartoonFilter")

/**
 * Helper to create directory with retry logic for EPERM errors
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
                    console.warn(
                        `mkdir attempt ${attempt + 1} failed (${error.code}), retrying in ${(attempt + 1) * 200}ms...`,
                    )
                    await new Promise((resolve) =>
                        setTimeout(resolve, (attempt + 1) * 200),
                    )
                } else {
                    throw error
                }
            } else {
                throw error
            }
        }
    }
}

// Extra resource search paths configurable at runtime (folders or VPKs)
let extraResourcePaths = []
function setExtraResourcePaths(paths) {
    extraResourcePaths = Array.isArray(paths)
        ? paths.filter((p) => typeof p === "string" && p.trim() !== "")
        : []
}
function getExtraResourcePaths() {
    return [...extraResourcePaths]
}

function uniquePaths(paths) {
    const seen = new Set()
    const result = []
    for (const p of paths) {
        const norm = p.replace(/\\/g, "/").toLowerCase()
        if (!seen.has(norm)) {
            seen.add(norm)
            result.push(p)
        }
    }
    return result
}

/**
 * Resolve a bundled tool inside backend/libs (dev) or extraResources (packaged)
 */
function getLibPath(...segments) {
    return app.isPackaged
        ? path.join(process.resourcesPath, "extraResources", ...segments)
        : path.join(__dirname, "..", "libs", ...segments)
}

function getCrowbarPath() {
    return getLibPath("crowbar", "CrowbarCommandLineDecomp.exe")
}

function findPngFilesRecursively(dirPath) {
    const result = []
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true })
        for (const entry of entries) {
            const full = path.join(dirPath, entry.name)
            if (entry.isDirectory()) {
                result.push(...findPngFilesRecursively(full))
            } else if (entry.isFile() && /\.png$/i.test(entry.name)) {
                result.push(full)
            }
        }
    } catch {}
    return result
}

/**
 * Give the textures the cartoon style (cartoonFilter.js), in place. PNGs with
 * an alpha channel (translucent textures like glass) keep it.
 */
async function applyCartoonishToTextures(outputDir) {
    const materialsDir = path.join(outputDir, "materials")
    if (!fs.existsSync(materialsDir)) {
        console.log("No materials directory for cartoonify, skipping")
        return { success: true, processed: 0 }
    }

    const pngFiles = findPngFilesRecursively(materialsDir)
    if (pngFiles.length === 0) {
        console.log("No PNG textures found to cartoonify, skipping")
        return { success: true, processed: 0 }
    }

    const sharp = require("sharp")
    let processed = 0
    for (const file of pngFiles) {
        try {
            // Buffers, not paths: sharp caches decoded files by path
            const input = fs.readFileSync(file)
            const { hasAlpha } = await sharp(input).metadata()
            const { data, info } = await sharp(input)
                .ensureAlpha()
                .raw()
                .toBuffer({ resolveWithObject: true })
            // Textures usually come out smaller (see cartoonFilter.js)
            const cartoon = cartoonify(data, info.width, info.height)
            let output = sharp(cartoon.rgba, {
                raw: {
                    width: cartoon.width,
                    height: cartoon.height,
                    channels: 4,
                },
            })
            if (!hasAlpha) output = output.removeAlpha()
            fs.writeFileSync(file, await output.png().toBuffer())
            processed++
        } catch (error) {
            console.warn(
                `Could not cartoonify ${path.basename(file)}:`,
                error.message,
            )
        }
        // Keep the (Electron main) event loop responsive between textures
        await new Promise((resolve) => setImmediate(resolve))
    }

    return { success: true, processed }
}

/**
 * Apply Source engine coordinate rotation to OBJ file
 * Rotates 90 degrees around Z-axis to convert from Source to standard 3D coordinates
 * @param {string} objPath - Path to the OBJ file to modify
 */
async function applySourceEngineRotation(objPath) {
    try {
        console.log(`🔄 Starting Source engine rotation on: ${objPath}`)

        // Read the OBJ file
        const objContent = fs.readFileSync(objPath, "utf-8")
        const lines = objContent.split("\n")
        const rotatedLines = []

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

                    // Apply -90-degree rotation around X-axis:
                    // x' = x
                    // y' = y*cos(-90°) - z*sin(-90°) = z
                    // z' = y*sin(-90°) + z*cos(-90°) = -y
                    const rotatedX = x
                    const rotatedY = z
                    const rotatedZ = -y

                    // Reconstruct the line with rotated coordinates
                    let rotatedLine = `v ${rotatedX} ${rotatedY} ${rotatedZ}`
                    if (parts.length > 4) {
                        // Include w coordinate if present
                        rotatedLine += ` ${parts[4]}`
                    }
                    rotatedLines.push(rotatedLine)
                    vertexCount++
                } else {
                    rotatedLines.push(line)
                }
            } else if (line.startsWith("vn ")) {
                // Normal line: vn x y z
                const parts = line.trim().split(/\s+/)
                if (parts.length >= 4) {
                    const nx = parseFloat(parts[1])
                    const ny = parseFloat(parts[2])
                    const nz = parseFloat(parts[3])

                    // Apply same rotation to normals
                    const rotatedNx = nx
                    const rotatedNy = nz
                    const rotatedNz = -ny

                    rotatedLines.push(
                        `vn ${rotatedNx} ${rotatedNy} ${rotatedNz}`,
                    )
                    normalCount++
                } else {
                    rotatedLines.push(line)
                }
            } else {
                // Keep all other lines unchanged
                rotatedLines.push(line)
            }
        }

        console.log(
            `✅ Rotation complete! Modified ${vertexCount} vertices and ${normalCount} normals`,
        )

        // Write the rotated OBJ back to file
        fs.writeFileSync(objPath, rotatedLines.join("\n"), "utf-8")
        console.log(`💾 Rotated OBJ saved to: ${objPath}`)
    } catch (error) {
        console.error(`❌ Rotation failed: ${error.message}`)
        throw new Error(
            `Failed to apply Source engine rotation: ${error.message}`,
        )
    }
}

/**
 * Find the package "resources" folder a VMF lives in (walking up from the VMF)
 */
function findResourcesDir(vmfPath) {
    let currentDir = path.dirname(vmfPath)
    for (let i = 0; i < 10; i++) {
        if (path.basename(currentDir).toLowerCase() === "resources") {
            return fs.existsSync(currentDir) ? currentDir : null
        }
        const parentDir = path.dirname(currentDir)
        if (parentDir === currentDir) break // Reached root
        currentDir = parentDir
    }
    return null
}

/**
 * Build the resource search list: Portal 2's pak01 (unless paths are given),
 * the package resources folder(s) of the VMFs, then the configured extras.
 * Earlier entries win when several contain the same file.
 */
async function resolveResourcePaths(vmfPaths, explicitPaths) {
    const resourcePaths = explicitPaths ? [...explicitPaths] : []
    if (!explicitPaths) {
        try {
            const resources = await findPortal2Resources(console)
            if (resources?.root) {
                const pak01Path = path.join(
                    resources.root,
                    "portal2",
                    "pak01_dir.vpk",
                )
                if (fs.existsSync(pak01Path)) resourcePaths.push(pak01Path)
            }
        } catch {}
    }

    for (const vmfPath of vmfPaths) {
        const resourcesDir = findResourcesDir(vmfPath)
        if (resourcesDir) resourcePaths.push(resourcesDir)
    }

    const unique = uniquePaths([...resourcePaths, ...getExtraResourcePaths()])
    if (unique.length > 0) {
        console.log(`🔍 VMF2OBJ resource paths:`, unique)
    }
    return unique
}

function createConverter(resourcePaths, options) {
    const debug = !!options.debug
    return new VmfConverter({
        resourcePaths,
        crowbarPath: getCrowbarPath(),
        // Tool brushes are kept only when debugging
        skipTools: !debug,
        quiet: !debug,
        // Editor models only use the base texture; normal maps would just end up
        // as extra VTFs in the package
        includeBumpMaps: false,
        timeoutMs: options.timeoutMs,
        logger: console,
    }).init()
}

/**
 * Rotate the OBJs into BeePEE's (Three.js) frame and apply the texture style
 */
async function postProcessOutputs(objPaths, outputDir, options) {
    if (options.applySourceRotation !== false) {
        for (const objPath of objPaths) {
            try {
                await applySourceEngineRotation(objPath)
            } catch (rotationError) {
                console.warn(
                    "Failed to apply Source engine rotation:",
                    rotationError.message,
                )
            }
        }
    }

    // Textures are written as PNG directly, so only the cartoon pass remains
    if ((options.textureStyle || "cartoon") === "cartoon") {
        try {
            console.log("Applying cartoonish effect to textures...")
            const cartoonResult = await applyCartoonishToTextures(outputDir)
            console.log(`Cartoonified ${cartoonResult.processed} textures`)
        } catch (cartoonError) {
            console.warn(
                "Cartoonify step failed:",
                cartoonError?.message || cartoonError,
            )
        }
    }
}

function logWarnings(name, warnings) {
    if (warnings.length > 0) {
        console.warn(
            `⚠️ VMF2OBJ warnings for ${name}:\n  ${warnings.join("\n  ")}`,
        )
    }
}

/**
 * Convert a VMF file to OBJ (+ MTL and PNG textures in outputDir/materials)
 * @param {string} vmfPath - Full path to the VMF file
 * @param {{outputDir?: string, timeoutMs?: number, resourcePaths?: string[], textureStyle?: 'cartoon' | 'raw', debug?: boolean, applySourceRotation?: boolean}} options
 * @returns {Promise<{objPath?: string, mtlPath?: string, resourcePaths: string[], warnings: string[]}>}
 */
async function convertVmfToObj(vmfPath, options = {}) {
    if (!vmfPath || !fs.existsSync(vmfPath)) {
        throw new Error(`VMF file not found: ${vmfPath}`)
    }

    const baseName = path.basename(vmfPath, path.extname(vmfPath))
    const outputDir = options.outputDir || path.dirname(vmfPath)
    await mkdirWithRetry(outputDir)

    // Remove existing outputs to ensure clean run
    for (const ext of [".obj", ".mtl"]) {
        try {
            fs.rmSync(path.join(outputDir, baseName + ext), { force: true })
        } catch {}
    }

    const resourcePaths = await resolveResourcePaths(
        [vmfPath],
        options.resourcePaths,
    )
    const converter = await createConverter(resourcePaths, {
        ...options,
        timeoutMs: options.timeoutMs ?? 120000, // 2 minutes
    })

    let result
    try {
        console.log(`Converting VMF to OBJ: ${vmfPath}`)
        result = await converter.convert(
            vmfPath,
            path.join(outputDir, baseName),
        )
    } finally {
        await converter.dispose()
    }
    logWarnings(baseName, result.warnings)
    assertHasGeometry(result, vmfPath)

    await postProcessOutputs([result.objPath], outputDir, options)

    return {
        objPath: result.objPath,
        mtlPath: result.mtlPath,
        resourcePaths,
        warnings: result.warnings,
    }
}

/**
 * Convert several VMFs into one output folder in a single session (shared
 * resource index, decompiled models and textures). Every MTL lists the
 * materials of all variants, so they can share one converted material set.
 * @param {Array<{vmfPath: string, outputName: string}>} jobs
 * @param {{outputDir: string, timeoutMs?: number, resourcePaths?: string[], textureStyle?: 'cartoon' | 'raw', debug?: boolean, applySourceRotation?: boolean}} options
 * @returns {Promise<Array<{vmfPath: string, outputName: string, objPath?: string, mtlPath?: string, warnings?: string[], error?: string}>>}
 */
async function convertVmfsToObj(jobs, options) {
    const outputDir = options.outputDir
    await mkdirWithRetry(outputDir)

    const resourcePaths = await resolveResourcePaths(
        jobs.map((job) => job.vmfPath),
        options.resourcePaths,
    )
    const converter = await createConverter(resourcePaths, options)

    const results = []
    try {
        for (const job of jobs) {
            try {
                if (fs.readFileSync(job.vmfPath, "utf8").includes("NaN")) {
                    throw new Error("VMF contains NaN values")
                }
                const result = await converter.convert(
                    job.vmfPath,
                    path.join(outputDir, job.outputName),
                )
                logWarnings(job.outputName, result.warnings)
                assertHasGeometry(result, job.vmfPath)
                results.push({ ...job, ...result })
            } catch (error) {
                console.error(
                    `❌ VMF2OBJ failed for ${job.vmfPath}:`,
                    error.message,
                )
                results.push({ ...job, error: error.message })
            }
        }
    } finally {
        await converter.dispose()
    }

    const converted = results.filter((r) => r.objPath)

    // Share one MTL across the variants (materials are converted once for all)
    const blocks = new Map()
    for (const { mtlPath } of converted) {
        const content = fs.readFileSync(mtlPath, "utf8")
        for (const block of content.split(/\n(?=newmtl )/).slice(1)) {
            const name = block.slice("newmtl ".length).split("\n")[0].trim()
            if (!blocks.has(name)) blocks.set(name, block.trimEnd())
        }
    }
    if (converted.length > 1) {
        const header = "# Materials shared by all variants\n"
        const shared =
            header + [...blocks.values()].map((b) => `\n${b}\n`).join("")
        for (const { mtlPath } of converted) fs.writeFileSync(mtlPath, shared)
    }

    await postProcessOutputs(
        converted.map((r) => r.objPath),
        outputDir,
        options,
    )
    return results
}

module.exports = {
    convertVmfToObj,
    convertVmfsToObj,
    setExtraResourcePaths,
    getExtraResourcePaths,
}
