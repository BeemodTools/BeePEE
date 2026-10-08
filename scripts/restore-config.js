/**
 * Removes the generated endpoints file after build so a dev machine
 * doesn't keep real endpoints lying around between builds. (The file is
 * gitignored either way - this is just tidiness, not leak prevention.)
 */

const fs = require("fs")
const path = require("path")

const GENERATED_FILE = path.join(
    __dirname,
    "..",
    "backend",
    "utils",
    "crashEndpoints.generated.json",
)

try {
    if (fs.existsSync(GENERATED_FILE)) {
        fs.unlinkSync(GENERATED_FILE)
        console.log("Removed generated crash endpoints file")
    }
} catch (err) {
    console.warn("Could not remove generated endpoints file:", err.message)
}
