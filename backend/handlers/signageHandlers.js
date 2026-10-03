/**
 * Signage CRUD handlers - open editor, save signage
 */

const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const { dialog, app, shell } = require("electron")
const { packages, getCurrentPackageDir } = require("../packageManager")
const {
    createSignageEditor,
    sendSignageUpdateToEditor,
    sendStagedDesignToEditor,
    createSignageDesignerWindow,
    getSignageDesignerWindow,
} = require("../items/itemEditor")
const { generateSignageMaterial } = require("../utils/signageMaterial")
const { getSetting, setSetting } = require("../utils/settings")
const { logger } = require("../utils/logger")

// The SVG import folder defaults to a dedicated spot in the app's user-data
// directory (e.g. %APPDATA%/beepee/signage-svgs) so users have somewhere to
// drop SVGs without configuring anything first.
function resolveSvgFolder() {
    let folder = getSetting("signageSvgFolder", "")
    if (!folder) {
        folder = path.join(app.getPath("userData"), "signage-svgs")
        setSetting("signageSvgFolder", folder)
    }
    try {
        fs.mkdirSync(folder, { recursive: true })
    } catch {
        /* creation is best-effort; callers handle a missing folder */
    }
    return folder
}

function register(ipcMain, mainWindow) {
    // Open signage editor
    ipcMain.handle("open-signage-editor", async (event, signage) => {
        try {
            // Find the actual signage object from the packages
            const actualSignage = packages
                .flatMap((p) => p.signages || [])
                .find((s) => s.id === signage.id)

            if (!actualSignage) {
                throw new Error(`Signage not found: ${signage.id}`)
            }

            createSignageEditor(actualSignage, mainWindow)
            return { success: true }
        } catch (error) {
            console.error(
                `Failed to open the editor of signage ${signage?.id}:`,
                error,
            )
            throw error
        }
    })

    // Open the signage designer window. An optional edit payload
    // ({ editId, name, design }) opens it loaded with an existing design.
    ipcMain.handle("open-signage-designer-window", async (event, editPayload) => {
        try {
            createSignageDesignerWindow(mainWindow, editPayload || null)
            return { success: true }
        } catch (error) {
            console.error("Failed to open signage designer window:", error)
            return { success: false, error: error.message }
        }
    })

    // Read a signage's editable design source (.bpsign), if it has one.
    // Presence of a design is what marks a signage as "made with BeePEE".
    ipcMain.handle("get-signage-design", async (event, signageId, styleId) => {
        try {
            const packageDir = getCurrentPackageDir()
            if (!packageDir) return { success: true, design: null }
            // Non-Clean styles keep their own design file next to the base one
            const suffix =
                styleId && styleId !== "BEE2_CLEAN" ? `__${styleId}` : ""
            const designPath = path.join(
                packageDir,
                ".bpee",
                "signs",
                `${signageId}${suffix}.bpsign`,
            )
            if (!fs.existsSync(designPath)) {
                return { success: true, design: null }
            }
            const design = JSON.parse(fs.readFileSync(designPath, "utf-8"))
            return { success: true, design }
        } catch (error) {
            console.error(
                `Failed to read the design of signage ${signageId}:`,
                error,
            )
            return { success: false, error: error.message }
        }
    })

    // Load a .bpsign design file from disk (designer "Load" option)
    ipcMain.handle("load-bpsign-dialog", async () => {
        try {
            const { canceled, filePaths } = await dialog.showOpenDialog(
                mainWindow,
                {
                    title: "Load Signage Design",
                    properties: ["openFile"],
                    filters: [
                        { name: "BeePEE Signage", extensions: ["bpsign"] },
                    ],
                },
            )
            if (canceled || !filePaths.length) {
                return { success: false, canceled: true }
            }
            const design = JSON.parse(fs.readFileSync(filePaths[0], "utf-8"))
            return { success: true, design }
        } catch (error) {
            console.error("Failed to load .bpsign:", error)
            return { success: false, error: error.message }
        }
    })

    // Generic save-to-file dialog used by the designer's export options.
    // Pass either base64 (binary) or text.
    ipcMain.handle(
        "save-file-dialog",
        async (event, { defaultName, filters, base64, text }) => {
            try {
                // Start in the last export folder (when the setting allows)
                let defaultPath = defaultName
                const remember = getSetting("signageRememberExportDir", true)
                if (remember) {
                    const lastDir = getSetting("signageLastExportDir", null)
                    if (lastDir && fs.existsSync(lastDir)) {
                        defaultPath = path.join(lastDir, defaultName)
                    }
                }
                const { canceled, filePath } = await dialog.showSaveDialog(
                    mainWindow,
                    { defaultPath, filters },
                )
                if (canceled || !filePath) {
                    return { success: false, canceled: true }
                }
                if (base64 != null) {
                    fs.writeFileSync(filePath, Buffer.from(base64, "base64"))
                } else {
                    fs.writeFileSync(filePath, text ?? "", "utf-8")
                }
                if (remember) {
                    setSetting("signageLastExportDir", path.dirname(filePath))
                }
                return { success: true, filePath }
            } catch (error) {
                console.error(`Failed to save ${defaultName}:`, error)
                return { success: false, error: error.message }
            }
        },
    )

    // Stage a designer save for an EXISTING signage without committing it:
    // the payload is handed to the signage's editor window, which previews
    // the new icon and whose Save button performs the actual create-signage
    // commit. Closing the editor without saving discards it.
    ipcMain.handle("stage-signage-design", async (event, payload) => {
        try {
            const editId = payload?.editId
            if (!editId) throw new Error("stage-signage-design needs editId")

            if (!sendStagedDesignToEditor(editId, payload)) {
                // Editor window is closed - open it, then deliver once it's up
                const sig = packages
                    .flatMap((p) => p.signages || [])
                    .find((s) => s.id === editId)
                if (!sig) throw new Error(`Signage not found: ${editId}`)
                createSignageEditor(sig, mainWindow)
                let tries = 0
                const attempt = () => {
                    if (sendStagedDesignToEditor(editId, payload)) return
                    if (++tries < 20) setTimeout(attempt, 250)
                }
                setTimeout(attempt, 400)
            }

            // The designer's work is staged - close its window
            const designerWindow = getSignageDesignerWindow()
            if (designerWindow && !designerWindow.isDestroyed()) {
                designerWindow.close()
            }
            return { success: true }
        } catch (error) {
            console.error(
                `Failed to stage the design of signage ${payload?.editId}:`,
                error,
            )
            return { success: false, error: error.message }
        }
    })

    // Create a new signage, or update an existing designed one when editId
    // is provided (re-opening a .bpsign in the designer and saving).
    ipcMain.handle("create-signage", async (event, { name, iconPath, iconData, design, editId, materialData, maskData, materialOptions, styleId }) => {
        const title = `${editId ? "Updating" : "Creating"} signage "${name}"`
        return logger.section(title, async () => {
            try {
                const packageDir = getCurrentPackageDir()
                if (!packageDir) {
                    throw new Error("No package is currently loaded")
                }
                if (!name || !name.trim()) {
                    throw new Error("Signage name is required")
                }

                const infoPath = path.join(packageDir, "info.json")
                const packageInfo = JSON.parse(fs.readFileSync(infoPath, "utf-8"))

                // Ensure Signage array exists
                if (!packageInfo.Signage) {
                    packageInfo.Signage = []
                } else if (!Array.isArray(packageInfo.Signage)) {
                    packageInfo.Signage = [packageInfo.Signage]
                }

                const isEdit = !!editId
                const existingIndex = isEdit
                    ? packageInfo.Signage.findIndex((s) => s.ID === editId)
                    : -1
                if (isEdit && existingIndex === -1) {
                    throw new Error(`Signage not found for editing: ${editId}`)
                }

                let signageId
                if (isEdit) {
                    signageId = editId
                } else {
                    // Generate a unique ID: <PREFIX>_<NAME>_<4-hex chars>.
                    // The prefix is configurable (signageIdPrefix setting).
                    const rawPrefix = getSetting("signageIdPrefix", "SIGN_BPEE")
                    const prefix =
                        String(rawPrefix)
                            .replace(/[^a-zA-Z0-9_]/g, "")
                            .replace(/_+$/, "")
                            .toUpperCase() || "SIGN_BPEE"
                    const sanitizedName = name
                        .replace(/[^a-zA-Z0-9]/g, "")
                        .toUpperCase()
                    const existingIds = new Set([
                        ...packageInfo.Signage.map((s) => s.ID),
                        ...packages
                            .flatMap((p) => p.signages || [])
                            .map((s) => s.id),
                    ])
                    do {
                        const uuid = crypto
                            .randomBytes(2)
                            .toString("hex")
                            .toUpperCase()
                        signageId = `${prefix}_${sanitizedName}_${uuid}`
                    } while (existingIds.has(signageId))
                }

                // Which style this save targets. Designer edits carry the style
                // whose icon was edited; everything else lands on Clean. Icon,
                // material, and .bpsign filenames get a per-style suffix so a
                // 1950s edit can never overwrite the Clean assets.
                const styleKey =
                    isEdit && styleId && /^[A-Za-z0-9_]+$/.test(styleId)
                        ? styleId
                        : "BEE2_CLEAN"
                const bpsignSuffix =
                    styleKey === "BEE2_CLEAN" ? "" : `__${styleKey}`
                const texName =
                    signageId.toLowerCase() +
                    (styleKey === "BEE2_CLEAN"
                        ? ""
                        : `__${styleKey.toLowerCase()}`)

                // Start from the existing entry when editing so other styles,
                // Hidden, Secondary, etc. are preserved
                const newSignage = isEdit
                    ? { ...packageInfo.Signage[existingIndex], Name: name.trim() }
                    : { ID: signageId, Name: name.trim() }
                const resolvedStyles = {}

                // Optional starting icon - stored on the Clean style, written
                // into resources/BEE2 the same way save-signage stages icons.
                // Either a picked file (iconPath) or a designer-rasterized PNG
                // (iconData, a data URL).
                let iconFilename = null
                const bee2Dir = path.join(packageDir, "resources", "BEE2")
                if (iconPath && fs.existsSync(iconPath)) {
                    if (!fs.existsSync(bee2Dir)) {
                        fs.mkdirSync(bee2Dir, { recursive: true })
                    }
                    iconFilename = path.basename(iconPath)
                    fs.copyFileSync(iconPath, path.join(bee2Dir, iconFilename))
                } else if (
                    typeof iconData === "string" &&
                    iconData.startsWith("data:image/png;base64,")
                ) {
                    if (!fs.existsSync(bee2Dir)) {
                        fs.mkdirSync(bee2Dir, { recursive: true })
                    }
                    iconFilename = `${texName}.png`
                    fs.writeFileSync(
                        path.join(bee2Dir, iconFilename),
                        Buffer.from(iconData.split(",")[1], "base64"),
                    )
                }
                if (iconFilename) {
                    const overlay = `signage/${iconFilename.replace(/\.[^.]+$/, "")}`
                    // Merge so this save only replaces the style being edited
                    newSignage.Styles = {
                        ...(newSignage.Styles || {}),
                        [styleKey]: {
                            type: "square",
                            overlay,
                            icon: iconFilename,
                        },
                    }
                    resolvedStyles[styleKey] = {
                        type: "square",
                        overlay,
                        icon: path.join(bee2Dir, iconFilename),
                    }
                }

                if (isEdit) {
                    packageInfo.Signage[existingIndex] = newSignage
                } else {
                    packageInfo.Signage.push(newSignage)
                }
                fs.writeFileSync(infoPath, JSON.stringify(packageInfo, null, 2))

                // Store the editable design source (.bpsign) in the package's
                // .bpee staging folder (excluded from exports) so designer-made
                // signage can be reopened and edited later. Non-Clean styles get
                // their own design file next to the base one.
                if (design) {
                    try {
                        const signsDir = path.join(packageDir, ".bpee", "signs")
                        fs.mkdirSync(signsDir, { recursive: true })
                        fs.writeFileSync(
                            path.join(signsDir, `${signageId}${bpsignSuffix}.bpsign`),
                            JSON.stringify(design, null, 2),
                        )
                    } catch (err) {
                        console.warn(
                            `Failed to save the design source ${signageId}${bpsignSuffix}.bpsign:`,
                            err,
                        )
                    }
                }

                // Generate the in-game Source material (VTF + VMT) from the
                // designer's transparent render. Non-fatal: if MareTF fails the
                // signage still saves (the editor thumbnail is unaffected).
                // texName keys the files, so each style gets its own material.
                if (materialData) {
                    try {
                        await generateSignageMaterial({
                            packageDir,
                            signageId: texName,
                            baseData: materialData,
                            maskData: maskData || null,
                            options: materialOptions || {},
                        })
                    } catch (err) {
                        console.warn(
                            `Failed to generate the in-game material ${texName}:`,
                            err,
                        )
                    }
                }

                // Update in-memory package
                const pkg = packages.find((p) => p.packageDir === packageDir)
                let memSignage
                if (isEdit && pkg && pkg.signages) {
                    const memIdx = pkg.signages.findIndex((s) => s.id === signageId)
                    const prev = memIdx !== -1 ? pkg.signages[memIdx] : {}
                    memSignage = {
                        ...prev,
                        id: signageId,
                        name: name.trim(),
                        // keep other resolved styles, update Clean
                        styles: { ...(prev.styles || {}), ...resolvedStyles },
                    }
                    if (memIdx !== -1) pkg.signages[memIdx] = memSignage
                    else pkg.signages.push(memSignage)
                } else {
                    memSignage = {
                        id: signageId,
                        name: name.trim(),
                        hidden: false,
                        secondary: null,
                        styles: resolvedStyles,
                    }
                    if (pkg) {
                        if (!pkg.signages) pkg.signages = []
                        pkg.signages.push(memSignage)
                    }
                }

                // Package changed on disk (working dir) but not the .bpee
                global.titleManager?.setUnsavedChanges(true)

                // Refresh browser UI
                mainWindow.webContents.send("package:loaded", {
                    items: packages
                        .flatMap((p) => p.items)
                        .map((i) => i.toJSONWithExistence()),
                    signages: packages.flatMap((p) => p.signages || []),
                })

                // Close the designer window if the save came from it
                const designerWindow = getSignageDesignerWindow()
                if (designerWindow && !designerWindow.isDestroyed()) {
                    designerWindow.close()
                }

                if (isEdit) {
                    // Refresh an already-open editor for this signage, or open one
                    sendSignageUpdateToEditor(signageId, memSignage)
                    createSignageEditor(memSignage, mainWindow)
                } else {
                    // Open the editor so the user can configure styles right away
                    createSignageEditor(memSignage, mainWindow)
                }

                return { success: true, signageId }
            } catch (error) {
                console.error(`Failed to save signage "${name}":`, error)
                return { success: false, error: error.message }
            }
        })
    })

    // Delete a signage: remove its info.json entry, clean up the assets we
    // generate (designer icon, material VTF/VMT, .bpsign source), refresh the
    // browser, and close its editor window. User-uploaded icons with arbitrary
    // names are left alone to avoid removing assets shared with other signage.
    ipcMain.handle("delete-signage", async (event, { signageId }) => {
        return logger.section(`Deleting signage ${signageId}`, async () => {
            try {
                const packageDir = getCurrentPackageDir()
                if (!packageDir) throw new Error("No package is currently loaded")

                const infoPath = path.join(packageDir, "info.json")
                const packageInfo = JSON.parse(fs.readFileSync(infoPath, "utf-8"))
                if (!Array.isArray(packageInfo.Signage)) {
                    packageInfo.Signage = packageInfo.Signage
                        ? [packageInfo.Signage]
                        : []
                }
                const idx = packageInfo.Signage.findIndex((s) => s.ID === signageId)
                if (idx === -1) throw new Error(`Signage not found: ${signageId}`)
                const removedEntry = packageInfo.Signage[idx]
                packageInfo.Signage.splice(idx, 1)
                fs.writeFileSync(infoPath, JSON.stringify(packageInfo, null, 2))

                const rm = (p) => {
                    try {
                        if (fs.existsSync(p)) fs.unlinkSync(p)
                    } catch (err) {
                        console.warn(`Failed to delete ${p}:`, err)
                    }
                }

                // Delete the assets the entry's Styles actually declare (icons
                // live under resources/BEE2/, overlays under resources/materials/
                // as .vmt + .vtf) - imported packages keep these at arbitrary
                // nested paths, not our id-named convention. Assets still
                // referenced by another signage (shared art, Secondary pairs)
                // are kept.
                const styleAssets = (sig) => {
                    const icons = []
                    const overlays = []
                    for (const cfg of Object.values(sig?.Styles || {})) {
                        if (cfg && typeof cfg === "object") {
                            if (cfg.icon) icons.push(String(cfg.icon))
                            if (cfg.overlay) overlays.push(String(cfg.overlay))
                        }
                    }
                    return { icons, overlays }
                }
                const norm = (p) => String(p).replace(/\\/g, "/").toLowerCase()
                const stillUsed = { icons: new Set(), overlays: new Set() }
                for (const s of packageInfo.Signage) {
                    const a = styleAssets(s)
                    a.icons.forEach((i) => stillUsed.icons.add(norm(i)))
                    a.overlays.forEach((o) => stillUsed.overlays.add(norm(o)))
                }
                // Only ever delete inside the package directory
                const inPkg = (rel) => {
                    const full = path.resolve(packageDir, rel)
                    return full.startsWith(path.resolve(packageDir) + path.sep)
                        ? full
                        : null
                }
                const mine = styleAssets(removedEntry)
                for (const icon of mine.icons) {
                    if (stillUsed.icons.has(norm(icon))) continue
                    const full = inPkg(path.join("resources", "BEE2", icon))
                    if (full) rm(full)
                }
                for (const overlay of mine.overlays) {
                    if (stillUsed.overlays.has(norm(overlay))) continue
                    for (const suffix of [".vmt", ".vtf", "_selfillummask.vtf"]) {
                        const full = inPkg(
                            path.join("resources", "materials", overlay + suffix),
                        )
                        if (full) rm(full)
                    }
                }
                // Remove id-named assets, including per-style variants
                // (<id>__<style>.*) generated by designer edits of other styles
                const idl = signageId.toLowerCase()
                const rmMatching = (dir, prefix, prefixLower) => {
                    if (!fs.existsSync(dir)) return
                    for (const f of fs.readdirSync(dir)) {
                        const fl = f.toLowerCase()
                        if (
                            fl === prefixLower ||
                            fl.startsWith(`${prefixLower}.`) ||
                            fl.startsWith(`${prefixLower}__`) ||
                            fl.startsWith(`${prefixLower}_selfillummask`)
                        ) {
                            rm(path.join(dir, f))
                        }
                    }
                }
                rmMatching(path.join(packageDir, "resources", "BEE2"), signageId, idl)
                rmMatching(
                    path.join(packageDir, "resources", "materials", "signage"),
                    signageId,
                    idl,
                )
                rmMatching(
                    path.join(packageDir, ".bpee", "signs"),
                    signageId,
                    signageId.toLowerCase(),
                )

                // Update in-memory package
                const pkg = packages.find((p) => p.packageDir === packageDir)
                if (pkg && pkg.signages) {
                    pkg.signages = pkg.signages.filter((s) => s.id !== signageId)
                }

                // Package changed on disk (working dir) but not the .bpee
                global.titleManager?.setUnsavedChanges(true)

                // Refresh browser UI
                mainWindow.webContents.send("package:loaded", {
                    items: packages
                        .flatMap((p) => p.items)
                        .map((i) => i.toJSONWithExistence()),
                    signages: packages.flatMap((p) => p.signages || []),
                })

                return { success: true }
            } catch (error) {
                console.error(`Failed to delete signage ${signageId}:`, error)
                return { success: false, error: error.message }
            }
        })
    })

    // List SVGs from the user's configured import folder (signageSvgFolder
    // setting) so the designer can add them to its palette automatically.
    // The path is read from settings, not the renderer, so an arbitrary
    // directory can't be read through this channel.
    ipcMain.handle("list-signage-svg-folder", async () => {
        try {
            const folder = resolveSvgFolder()
            if (!folder || !fs.existsSync(folder)) {
                return { success: true, files: [] }
            }
            const files = fs
                .readdirSync(folder)
                .filter((f) => f.toLowerCase().endsWith(".svg"))
                .slice(0, 200) // sanity cap
                .map((f) => {
                    try {
                        return {
                            name: f.replace(/\.svg$/i, ""),
                            content: fs.readFileSync(
                                path.join(folder, f),
                                "utf-8",
                            ),
                        }
                    } catch {
                        return null
                    }
                })
                .filter(Boolean)
            return { success: true, files }
        } catch (error) {
            console.error("Failed to list the signage SVG folder:", error)
            return { success: false, error: error.message, files: [] }
        }
    })

    // Folder picker for the SVG import folder preference
    ipcMain.handle("browse-signage-svg-folder", async () => {
        try {
            const { canceled, filePaths } = await dialog.showOpenDialog(
                mainWindow,
                {
                    properties: ["openDirectory"],
                    defaultPath: resolveSvgFolder(),
                },
            )
            if (canceled || !filePaths.length) {
                return { success: false, canceled: true }
            }
            return { success: true, path: filePaths[0] }
        } catch (error) {
            return { success: false, error: error.message }
        }
    })

    // Reveal the SVG import folder in the system file explorer
    ipcMain.handle("open-signage-svg-folder", async () => {
        try {
            const folder = resolveSvgFolder()
            const err = await shell.openPath(folder)
            return err
                ? { success: false, error: err }
                : { success: true, path: folder }
        } catch (error) {
            return { success: false, error: error.message }
        }
    })

    // The resolved SVG folder path (creates + persists the default if unset),
    // so the preferences form can display it
    ipcMain.handle("get-signage-svg-folder", async () => {
        try {
            return { success: true, path: resolveSvgFolder() }
        } catch (error) {
            return { success: false, error: error.message }
        }
    })

    // Save signage
    ipcMain.handle("save-signage", async (event, signageData) => {
        const title = `Saving signage "${signageData?.name}"`
        return logger.section(title, async () => {
            try {
                const packageDir = getCurrentPackageDir()
                if (!packageDir) {
                    throw new Error("No package is currently loaded")
                }

                const infoPath = path.join(packageDir, "info.json")
                const packageInfo = JSON.parse(fs.readFileSync(infoPath, "utf-8"))

                // Ensure Signage array exists
                if (!packageInfo.Signage) {
                    packageInfo.Signage = []
                } else if (!Array.isArray(packageInfo.Signage)) {
                    packageInfo.Signage = [packageInfo.Signage]
                }

                // Find and update signage in Signage array
                const signageIndex = packageInfo.Signage.findIndex(
                    (s) => s.ID === signageData.originalId
                )

                if (signageIndex !== -1) {
                    // Convert formData back to BEE2 format
                    // Need to process styles to remove resolved icon paths
                    const processedStyles = {}
                    const bee2Dir = path.join(packageDir, "resources", "BEE2")

                    // Ensure resources/BEE2 directory exists
                    if (!fs.existsSync(bee2Dir)) {
                        fs.mkdirSync(bee2Dir, { recursive: true })
                    }

                    for (const [styleId, styleConfig] of Object.entries(
                        signageData.styles || {}
                    )) {
                        if (typeof styleConfig === "string") {
                            // Style inheritance reference
                            processedStyles[styleId] = styleConfig
                        } else {
                            let iconFilename = ""

                            // Handle staged icon - copy to resources/BEE2
                            if (styleConfig._stagedIconPath) {
                                const stagedPath = styleConfig._stagedIconPath
                                iconFilename = path.basename(stagedPath)
                                const destPath = path.join(bee2Dir, iconFilename)

                                // Copy the file
                                fs.copyFileSync(stagedPath, destPath)
                                logger.debug(
                                    `Copied the ${styleId} icon from ${stagedPath}`,
                                )
                            } else if (styleConfig.icon) {
                                // Extract filename from existing icon path
                                const iconPath = styleConfig.icon
                                if (
                                    iconPath.includes("resources/BEE2") ||
                                    iconPath.includes("resources\\BEE2")
                                ) {
                                    const match = iconPath.match(
                                        /resources[/\\]BEE2[/\\](.+)/
                                    )
                                    iconFilename = match ? match[1].replace(/\\/g, "/") : path.basename(iconPath)
                                } else {
                                    iconFilename = path.basename(iconPath)
                                }
                            }

                            // Auto-generate overlay from icon filename (without extension)
                            const iconBaseName = iconFilename.replace(/\.[^.]+$/, "")
                            const overlay = iconBaseName ? `signage/${iconBaseName}` : ""

                            processedStyles[styleId] = {
                                type: "square",
                                overlay: overlay,
                                icon: iconFilename,
                            }
                        }
                    }

                    const updatedSignage = {
                        ID: signageData.id,
                        Name: signageData.name,
                    }

                    // Only include optional fields if they have values
                    if (signageData.hidden) {
                        updatedSignage.Hidden = "1"
                    }
                    if (signageData.secondary) {
                        updatedSignage.Secondary = signageData.secondary
                    }
                    if (Object.keys(processedStyles).length > 0) {
                        updatedSignage.Styles = processedStyles
                    }

                    packageInfo.Signage[signageIndex] = updatedSignage

                    // Write to disk
                    fs.writeFileSync(infoPath, JSON.stringify(packageInfo, null, 2))

                    // Update in-memory signage in package
                    const pkg = packages.find((p) => p.packageDir === packageDir)
                    if (pkg && pkg.signages) {
                        const memSignageIndex = pkg.signages.findIndex(
                            (s) => s.id === signageData.originalId
                        )
                        if (memSignageIndex !== -1) {
                            // Re-resolve icon paths for in-memory version
                            const resolvedStyles = {}
                            for (const [styleId, styleConfig] of Object.entries(
                                signageData.styles || {}
                            )) {
                                if (typeof styleConfig === "string") {
                                    resolvedStyles[styleId] = styleConfig
                                } else if (styleConfig._stagedIconPath) {
                                    // The picked icon was copied into
                                    // resources/BEE2 above: point at that copy
                                    // (not the user's file), as a reload would
                                    resolvedStyles[styleId] = {
                                        ...processedStyles[styleId],
                                        icon: path.join(
                                            bee2Dir,
                                            processedStyles[styleId].icon,
                                        ),
                                    }
                                } else {
                                    resolvedStyles[styleId] = { ...styleConfig }
                                    // Re-resolve icon path if needed
                                    if (
                                        styleConfig.icon &&
                                        !styleConfig.icon.includes(packageDir)
                                    ) {
                                        resolvedStyles[styleId].icon = path.join(
                                            packageDir,
                                            "resources/BEE2",
                                            styleConfig.icon
                                        )
                                    }
                                }
                            }

                            pkg.signages[memSignageIndex] = {
                                id: signageData.id,
                                name: signageData.name,
                                hidden: signageData.hidden || false,
                                secondary: signageData.secondary || null,
                                styles: resolvedStyles,
                            }

                            // Send update to editor
                            sendSignageUpdateToEditor(
                                signageData.originalId,
                                pkg.signages[memSignageIndex]
                            )

                            // Package changed but the .bpee wasn't rewritten
                            global.titleManager?.setUnsavedChanges(true)

                            // Also update browser
                            mainWindow.webContents.send("package:loaded", {
                                items: packages
                                    .flatMap((p) => p.items)
                                    .map((i) => i.toJSONWithExistence()),
                                signages: packages.flatMap((p) => p.signages || []),
                            })
                        }
                    }

                    return { success: true }
                } else {
                    throw new Error(
                        `Signage not found in info.json: ${signageData.originalId}`
                    )
                }
            } catch (error) {
                console.error(
                    `Failed to save signage "${signageData?.name}":`,
                    error,
                )
                return { success: false, error: error.message }
            }
        })
    })
}

module.exports = { register }
