const fs = require("fs")
const path = require("path")

/**
 * Parse a VMF file and extract statistics
 * @param {string} vmfPath - Path to the VMF file
 * @returns {Object} Statistics object with entity, brush, and brush side counts
 */
function parseVMFStats(vmfPath) {
    if (!fs.existsSync(vmfPath)) {
        throw new Error("File not found")
    }

    try {
        const content = fs.readFileSync(vmfPath, "utf8")
        const stats = parseVMFContent(content)

        return {
            EntityCount: stats.entityCount,
            BrushCount: stats.brushCount,
            BrushSideCount: stats.brushSideCount,
        }
    } catch (error) {
        console.error(`Failed to parse ${vmfPath}:`, error)
        throw error
    }
}

/**
 * Parse VMF content and count entities, brushes, and brush sides
 * @param {string} content - VMF file content
 * @returns {Object} Parsed statistics
 */
function parseVMFContent(content) {
    let entityCount = 0
    let brushCount = 0
    let brushSideCount = 0

    // Split content into lines for easier parsing
    const lines = content.split("\n").map((line) => line.trim())
    let currentDepth = 0
    let inWorld = false
    let inEntity = false
    let inSolid = false
    let inSide = false

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]

        // Skip empty lines and comments
        if (!line || line.startsWith("//")) {
            continue
        }

        // Track bracket depth
        if (line === "{") {
            currentDepth++
        } else if (line === "}") {
            currentDepth--

            // Reset flags when exiting blocks based on the depth we're at
            if (inSide && currentDepth <= 2) {
                inSide = false
            }
            if (inSolid && currentDepth <= 1) {
                inSolid = false
            }
            if (inEntity && currentDepth <= 0) {
                inEntity = false
            }
            if (inWorld && currentDepth <= 0) {
                inWorld = false
            }
        }

        // Check for world block (contains brushes)
        if (line === "world" && currentDepth === 0) {
            // Look ahead to see if next line is opening brace
            if (i + 1 < lines.length && lines[i + 1] === "{") {
                inWorld = true
            }
        }

        // Check for entity blocks (but not the world entity)
        if (line === "entity" && currentDepth === 0) {
            // Look ahead to see if next line is opening brace
            if (i + 1 < lines.length && lines[i + 1] === "{") {
                entityCount++
                inEntity = true
            }
        }

        // Check for solid blocks (brushes) within world or entities
        if (line === "solid" && (inWorld || inEntity)) {
            // Look ahead to see if next line is opening brace
            if (i + 1 < lines.length && lines[i + 1] === "{") {
                brushCount++
                inSolid = true
            }
        }

        // Check for side blocks within solids
        if (line === "side" && inSolid) {
            // Look ahead to see if next line is opening brace
            if (i + 1 < lines.length && lines[i + 1] === "{") {
                brushSideCount++
                inSide = true
            }
        }
    }

    return {
        entityCount,
        brushCount,
        brushSideCount,
    }
}

/**
 * Parse VMF stats for multiple files with caching
 */
class VMFStatsCache {
    constructor() {
        this.cache = new Map()
        this.fileMtimes = new Map()
    }

    /**
     * Get stats for a VMF file, using cache if file hasn't changed
     * @param {string} vmfPath - Path to VMF file
     * @returns {Object} VMF statistics
     */
    getStats(vmfPath) {
        try {
            if (!fs.existsSync(vmfPath)) {
                this.clearCache(vmfPath)
                throw new Error("File not found")
            }

            const stat = fs.statSync(vmfPath)
            const mtime = stat.mtime.getTime()
            const cachedMtime = this.fileMtimes.get(vmfPath)

            // Check if we have cached data and file hasn't changed
            if (cachedMtime === mtime && this.cache.has(vmfPath)) {
                return this.cache.get(vmfPath)
            }

            // Parse the file and cache the result
            const stats = parseVMFStats(vmfPath)
            this.cache.set(vmfPath, stats)
            this.fileMtimes.set(vmfPath, mtime)

            return stats
        } catch (error) {
            // Message only: parse errors were logged with their stack above,
            // and a missing file needs none
            console.error(
                `Failed to get the VMF stats of ${vmfPath}:`,
                error.message,
            )
            throw error
        }
    }

    /**
     * Clear cache for a specific file
     * @param {string} vmfPath - Path to VMF file
     */
    clearCache(vmfPath) {
        this.cache.delete(vmfPath)
        this.fileMtimes.delete(vmfPath)
    }

    /**
     * Clear entire cache
     */
    clearAllCache() {
        this.cache.clear()
        this.fileMtimes.clear()
    }
}

// Create a global cache instance
const vmfStatsCache = new VMFStatsCache()

module.exports = {
    parseVMFStats,
    parseVMFContent,
    VMFStatsCache,
    vmfStatsCache,
}
