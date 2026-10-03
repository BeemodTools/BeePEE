/**
 * Item Importer: pick another .bpee and copy selected items/signages
 * into the currently loaded package.
 *
 * Flow: the Edit menu calls startImportFlow, which shows the file picker
 * over the MAIN window, extracts the chosen .bpee into a temp staging dir,
 * builds a manifest (items + signages with names/icons/collision flags) and
 * only then opens the importer window; the window fetches the manifest via
 * import-items-manifest. import-items-execute copies the selected entries'
 * files into the current package, merges info.json, reloads the package in
 * memory and refreshes the UI. Entries whose ID already exists are skipped.
 */

const fs = require("fs")
const path = require("path")
const os = require("os")
const { dialog } = require("electron")
const { logger } = require("../utils/logger")

/** "1 item", "3 items" */
const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`

// One import session at a time
let staging = null // { dir, info, sourceName, manifest }

function readJson(p) {
    try {
        return JSON.parse(fs.readFileSync(p, "utf-8"))
    } catch {
        return null
    }
}

function toArray(v) {
    if (!v) return []
    return Array.isArray(v) ? v : [v]
}

function fileToDataUrl(p) {
    try {
        if (!p || !fs.existsSync(p)) return null
        return `data:image/png;base64,${fs.readFileSync(p).toString("base64")}`
    } catch {
        return null
    }
}

// First style folder of an item entry ("BEE2_CLEAN": "folder" or {folder})
function entryFolders(entry) {
    const folders = new Set()
    const styles = entry?.Version?.Styles || {}
    for (const v of Object.values(styles)) {
        if (typeof v === "string") folders.add(v)
        else if (v && typeof v === "object" && v.folder) folders.add(v.folder)
    }
    return [...folders]
}

// Item display info from its (source) folder
function itemDisplayInfo(sourceDir, folder, entry) {
    const itemDir = path.join(sourceDir, "items", folder.toLowerCase())
    let name = entry.ID
    let iconAbs = null
    const ed = readJson(path.join(itemDir, "editoritems.json"))
    let sub = ed?.Item?.Editor?.SubType
    if (Array.isArray(sub)) sub = sub[0]
    if (sub?.Name) name = sub.Name
    const props = readJson(path.join(itemDir, "properties.json"))
    const iconRel =
        props?.Properties?.Icon?.["0"] ||
        (typeof props?.Properties?.Icon === "string"
            ? props.Properties.Icon
            : null) ||
        (sub?.Palette?.Image
            ? String(sub.Palette.Image).replace(/^palette\//i, "")
            : null)
    if (iconRel) {
        iconAbs = path.join(sourceDir, "resources", "BEE2", "items", iconRel)
    }
    return { name, iconRel, iconAbs }
}

// Signage icon path resolution (same rules as Package.load)
function signageIconAbs(baseDir, icon) {
    if (!icon) return null
    const pathPart = icon.includes(":") ? icon.split(":")[1] : icon
    return path.join(baseDir, "resources", "BEE2", pathPart)
}

function ensureDirFor(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

// Copy a file unless the destination already exists (never clobber the
// current package's own assets)
function copyFileSafe(src, dest) {
    if (!fs.existsSync(src) || fs.existsSync(dest)) return false
    ensureDirFor(dest)
    fs.copyFileSync(src, dest)
    return true
}

function copyDirSafe(src, dest) {
    if (!fs.existsSync(src)) return false
    fs.cpSync(src, dest, { recursive: true, force: false, errorOnExist: false })
    return true
}

// All files under dir (relative paths, forward slashes)
function walkFiles(dir, base = dir, out = []) {
    if (!fs.existsSync(dir)) return out
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name)
        if (e.isDirectory()) walkFiles(abs, base, out)
        else out.push(path.relative(base, abs).split(path.sep).join("/"))
    }
    return out
}

function cleanupStaging() {
    if (staging?.dir) {
        try {
            fs.rmSync(staging.dir, { recursive: true, force: true })
        } catch (err) {
            console.warn(
                `Failed to remove the import staging directory ${staging.dir}:`,
                err,
            )
        }
    }
    staging = null
}

// Menu entry point: file picker over the main window first, then extract
// and open the importer window with the manifest ready.
async function startImportFlow(mainWindow) {
    const {
        getCurrentPackageDir,
        extractPackage,
        processVdfFiles,
    } = require("../packageManager")
    try {
        const targetDir = getCurrentPackageDir()
        if (!targetDir) return

        const result = await dialog.showOpenDialog(mainWindow, {
            title: "Import from Package",
            properties: ["openFile"],
            filters: [{ name: "BeePEE Package", extensions: ["bpee"] }],
        })
        if (result.canceled || !result.filePaths?.length) return
        const sourcePath = result.filePaths[0]

        const title = `Reading ${sourcePath} to import from it`
        const prepared = await logger.section(title, async () => {
            cleanupStaging()
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bpee-import-"))
            await extractPackage(sourcePath, dir)
            processVdfFiles(dir)

            const info = readJson(path.join(dir, "info.json"))
            if (!info) {
                fs.rmSync(dir, { recursive: true, force: true })
                dialog.showErrorBox(
                    "Import Failed",
                    "That file doesn't look like a BeePEE package (no info.json).",
                )
                return {
                    success: false,
                    error: "It has no info.json, so it isn't a BeePEE package",
                }
            }
            const sourceName =
                info.Name || info.ID || path.basename(sourcePath, ".bpee")

            const targetInfo = readJson(path.join(targetDir, "info.json")) || {}
            const existingItemIds = new Set(
                toArray(targetInfo.Item).map((i) => i.ID),
            )
            const existingSignageIds = new Set(
                toArray(targetInfo.Signage).map((s) => s.ID),
            )

            const items = toArray(info.Item)
                .filter((e) => e && e.ID)
                .map((entry) => {
                    const folders = entryFolders(entry)
                    const display = folders.length
                        ? itemDisplayInfo(dir, folders[0], entry)
                        : { name: entry.ID, iconAbs: null }
                    return {
                        id: entry.ID,
                        name: display.name,
                        icon: fileToDataUrl(display.iconAbs),
                        exists: existingItemIds.has(entry.ID),
                    }
                })

            const signages = toArray(info.Signage)
                .filter((s) => s && typeof s === "object" && s.ID)
                .map((sig) => {
                    // Prefer the Clean icon, else the first style with one
                    let icon = null
                    const styles = sig.Styles || {}
                    const cfgs = [
                        styles.BEE2_CLEAN,
                        ...Object.values(styles),
                    ].filter((v) => v && typeof v === "object")
                    for (const cfg of cfgs) {
                        icon = fileToDataUrl(signageIconAbs(dir, cfg.icon))
                        if (icon) break
                    }
                    return {
                        id: sig.ID,
                        name: sig.Name || sig.ID,
                        icon,
                        exists: existingSignageIds.has(sig.ID),
                    }
                })

            staging = {
                dir,
                info,
                sourceName,
                manifest: { success: true, sourceName, items, signages },
            }
            console.log(
                `Found ${plural(items.length, "item")} and ${plural(signages.length, "signage")} in "${sourceName}"`,
            )
            return { success: true }
        })
        if (!prepared.success) return

        // Everything's ready - now show the window
        require("../items/itemEditor").createImportItemsWindow(mainWindow)
    } catch (error) {
        console.error("Failed to start import:", error)
        cleanupStaging()
        dialog.showErrorBox("Import Failed", error.message)
    }
}

function register(ipcMain, mainWindow) {
    const { packages, getCurrentPackageDir } = require("../packageManager")

    // The importer window asks for the manifest prepared by startImportFlow
    ipcMain.handle("import-items-manifest", async () => {
        if (!staging?.manifest) {
            return { success: false, error: "No import in progress" }
        }
        return staging.manifest
    })

    // Copy the selected entries into the current package
    ipcMain.handle(
        "import-items-execute",
        async (event, { itemIds = [], signageIds = [] } = {}) => {
            const source = staging ? ` from "${staging.sourceName}"` : ""
            const title = `Importing ${plural(itemIds?.length ?? 0, "item")} and ${plural(signageIds?.length ?? 0, "signage")}${source}`
            return logger.section(title, async () => {
                try {
                    if (!staging) {
                        return {
                            success: false,
                            error: "No import in progress",
                        }
                    }
                    const targetDir = getCurrentPackageDir()
                    if (!targetDir) {
                        return { success: false, error: "No package is loaded" }
                    }
                    const { dir: sourceDir, info: sourceInfo } = staging

                    const infoPath = path.join(targetDir, "info.json")
                    const targetInfo = readJson(infoPath)
                    if (!targetInfo) {
                        return {
                            success: false,
                            error: "Current package has no info.json",
                        }
                    }
                    targetInfo.Item = toArray(targetInfo.Item)
                    targetInfo.Signage = toArray(targetInfo.Signage)
                    const existingItemIds = new Set(
                        targetInfo.Item.map((i) => i.ID),
                    )
                    const existingSignageIds = new Set(
                        targetInfo.Signage.map((s) => s.ID),
                    )

                    const skipped = { items: [], signages: [] }
                    const imported = { items: 0, signages: 0 }

                    // Pre-walk source resources once for id-matching copies
                    const sourceResourceFiles = walkFiles(
                        path.join(sourceDir, "resources"),
                    )

                    // ---- Items ----
                    for (const itemId of itemIds) {
                        const entry = toArray(sourceInfo.Item).find(
                            (e) => e && e.ID === itemId,
                        )
                        if (!entry) continue
                        if (existingItemIds.has(itemId)) {
                            skipped.items.push(itemId)
                            continue
                        }

                        // Deep-copy the entry; item folders that clash with an
                        // existing (different) item's folder get a new name
                        const newEntry = JSON.parse(JSON.stringify(entry))
                        const folderMap = {}
                        for (const folder of entryFolders(entry)) {
                            const lower = folder.toLowerCase()
                            let dest = lower
                            if (
                                fs.existsSync(
                                    path.join(targetDir, "items", dest),
                                )
                            ) {
                                let i = 2
                                dest = `${lower}_imp`
                                while (
                                    fs.existsSync(
                                        path.join(targetDir, "items", dest),
                                    )
                                ) {
                                    dest = `${lower}_imp${i++}`
                                }
                            }
                            folderMap[folder] = dest
                            copyDirSafe(
                                path.join(sourceDir, "items", lower),
                                path.join(targetDir, "items", dest),
                            )
                        }
                        // Rewrite folder references in the entry
                        const styles = newEntry?.Version?.Styles || {}
                        for (const [k, v] of Object.entries(styles)) {
                            if (typeof v === "string" && folderMap[v]) {
                                styles[k] = folderMap[v]
                            } else if (v && typeof v === "object") {
                                if (v.folder && folderMap[v.folder]) {
                                    const nf = folderMap[v.folder]
                                    if (v.Append) {
                                        v.Append = String(v.Append).replace(
                                            new RegExp(`^${v.folder}/`, "i"),
                                            `${nf}/`,
                                        )
                                    }
                                    v.folder = nf
                                }
                            }
                        }

                        // Item icon (from the source folder's properties.json)
                        const firstFolder = entryFolders(entry)[0]
                        if (firstFolder) {
                            const { iconRel } = itemDisplayInfo(
                                sourceDir,
                                firstFolder,
                                entry,
                            )
                            if (iconRel) {
                                copyFileSafe(
                                    path.join(
                                        sourceDir,
                                        "resources",
                                        "BEE2",
                                        "items",
                                        iconRel,
                                    ),
                                    path.join(
                                        targetDir,
                                        "resources",
                                        "BEE2",
                                        "items",
                                        iconRel,
                                    ),
                                )
                            }
                            // Instance files referenced by editoritems.json
                            const ed = readJson(
                                path.join(
                                    sourceDir,
                                    "items",
                                    firstFolder.toLowerCase(),
                                    "editoritems.json",
                                ),
                            )
                            const instances =
                                ed?.Item?.Exporting?.Instances || {}
                            for (const inst of Object.values(instances)) {
                                const name =
                                    typeof inst === "string" ? inst : inst?.Name
                                if (!name) continue
                                const clean = String(name).replace(
                                    /^instances\/(BEE2|bee2)\//,
                                    "",
                                )
                                copyFileSafe(
                                    path.join(
                                        sourceDir,
                                        "resources",
                                        "instances",
                                        clean,
                                    ),
                                    path.join(
                                        targetDir,
                                        "resources",
                                        "instances",
                                        clean,
                                    ),
                                )
                            }
                        }

                        // Anything else named after the item (custom models,
                        // materials, palette models, instance folders...)
                        const needle = itemId.toLowerCase()
                        for (const rel of sourceResourceFiles) {
                            if (rel.toLowerCase().includes(needle)) {
                                copyFileSafe(
                                    path.join(sourceDir, "resources", rel),
                                    path.join(targetDir, "resources", rel),
                                )
                            }
                        }

                        targetInfo.Item.push(newEntry)
                        existingItemIds.add(itemId)
                        imported.items++
                    }

                    // ---- Signages ----
                    const sourceBpeeSigns = walkFiles(
                        path.join(sourceDir, ".bpee", "signs"),
                    )
                    for (const sigId of signageIds) {
                        const sig = toArray(sourceInfo.Signage).find(
                            (s) => s && s.ID === sigId,
                        )
                        if (!sig) continue
                        if (existingSignageIds.has(sigId)) {
                            skipped.signages.push(sigId)
                            continue
                        }

                        // Declared style assets (icon + overlay materials)
                        for (const cfg of Object.values(sig.Styles || {})) {
                            if (!cfg || typeof cfg !== "object") continue
                            if (cfg.icon) {
                                const pathPart = cfg.icon.includes(":")
                                    ? cfg.icon.split(":")[1]
                                    : cfg.icon
                                copyFileSafe(
                                    path.join(
                                        sourceDir,
                                        "resources",
                                        "BEE2",
                                        pathPart,
                                    ),
                                    path.join(
                                        targetDir,
                                        "resources",
                                        "BEE2",
                                        pathPart,
                                    ),
                                )
                            }
                            if (cfg.overlay) {
                                for (const suffix of ["", "_selfillummask"]) {
                                    for (const ext of [".vmt", ".vtf"]) {
                                        const rel = path.join(
                                            "materials",
                                            `${cfg.overlay}${suffix}${ext}`,
                                        )
                                        copyFileSafe(
                                            path.join(
                                                sourceDir,
                                                "resources",
                                                rel,
                                            ),
                                            path.join(
                                                targetDir,
                                                "resources",
                                                rel,
                                            ),
                                        )
                                    }
                                }
                            }
                        }

                        // ID-named assets (per-style icon/material variants) and
                        // .bpsign design files
                        const needle = sigId.toLowerCase()
                        for (const rel of sourceResourceFiles) {
                            const base = path.basename(rel).toLowerCase()
                            if (base.startsWith(needle)) {
                                copyFileSafe(
                                    path.join(sourceDir, "resources", rel),
                                    path.join(targetDir, "resources", rel),
                                )
                            }
                        }
                        for (const rel of sourceBpeeSigns) {
                            if (path.basename(rel).toLowerCase().startsWith(needle)) {
                                copyFileSafe(
                                    path.join(sourceDir, ".bpee", "signs", rel),
                                    path.join(targetDir, ".bpee", "signs", rel),
                                )
                            }
                        }

                        targetInfo.Signage.push(
                            JSON.parse(JSON.stringify(sig)),
                        )
                        existingSignageIds.add(sigId)
                        imported.signages++
                    }

                    // Empty sections are omitted on export anyway; keep info.json
                    // tidy by not writing empty arrays we created ourselves
                    if (!targetInfo.Item.length) delete targetInfo.Item
                    if (!targetInfo.Signage.length) delete targetInfo.Signage
                    fs.writeFileSync(
                        infoPath,
                        JSON.stringify(targetInfo, null, 2),
                    )
                    console.log(
                        `Imported ${plural(imported.items, "item")} and ${plural(imported.signages, "signage")} (${skipped.items.length + skipped.signages.length} skipped, already in the package)`,
                    )

                    // Reload the package so the new items/signages get real
                    // Item instances and resolved icon paths
                    const pkg = packages.find((p) => p.packageDir === targetDir)
                    if (pkg) {
                        await pkg.load()
                    }

                    mainWindow.webContents.send("package:loaded", {
                        items: packages
                            .flatMap((p) => p.items)
                            .map((i) => i.toJSONWithExistence()),
                        signages: packages.flatMap((p) => p.signages || []),
                    })

                    if (global.titleManager) {
                        global.titleManager.setUnsavedChanges(true)
                    }

                    // Success toast lives in the main window; close the importer
                    // and hand focus back explicitly (otherwise Windows can
                    // minimize the whole app when the child window goes away)
                    mainWindow.webContents.send("import-items:done", {
                        imported,
                        skipped,
                    })
                    try {
                        require("../items/itemEditor").closeImportItemsWindow()
                    } catch {
                        /* window may already be gone */
                    }
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.focus()
                    }

                    cleanupStaging()
                    return { success: true, imported, skipped }
                } catch (error) {
                    console.error("Failed to import items:", error)
                    return { success: false, error: error.message }
                }
            })
        },
    )

    // Dialog dismissed - drop the staging dir
    ipcMain.handle("import-items-cancel", async () => {
        cleanupStaging()
        return { success: true }
    })
}

module.exports = { register, startImportFlow }
