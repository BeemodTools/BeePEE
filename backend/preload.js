const { contextBridge, ipcRenderer, webUtils } = require("electron")

// Expose general electron API
contextBridge.exposeInMainWorld("electron", {
    invoke: (channel, data) => ipcRenderer.invoke(channel, data),
    // Resolves Electron's { canceled, filePaths }
    showOpenDialog: (options) =>
        ipcRenderer.invoke("show-open-dialog", options),
    showMessageBox: (options) =>
        ipcRenderer.invoke("show-message-box", options),
    // Disk path of a dropped File ("" if it has none). Replaces File.path,
    // which Electron 32 removed.
    getPathForFile: (file) => webUtils.getPathForFile(file),
    // Console output for the log file (src/utils/logForwarding.js)
    log: (level, text) => ipcRenderer.send("renderer:log", level, text),
})

// Expose general event API for progress updates, etc.
contextBridge.exposeInMainWorld("api", {
    on: (channel, callback) => {
        const subscription = (event, ...args) => callback(event, ...args)
        ipcRenderer.on(channel, subscription)
        return subscription
    },
    off: (channel, callback) => {
        ipcRenderer.removeListener(channel, callback)
    },
})

contextBridge.exposeInMainWorld("package", {
    // ========================================
    // PACKAGE MANAGEMENT FUNCTIONS
    // ========================================
    loadPackage: () => ipcRenderer.invoke("dialog:loadPackage"),
    loadFile: (path) => ipcRenderer.invoke("api:loadImage", path),
    getCurrentItems: () => ipcRenderer.invoke("get-current-items"),
    getCurrentSignages: () => ipcRenderer.invoke("get-current-signages"),
    onPackageLoaded: (callback) => {
        // Note: We DON'T remove all listeners here because multiple components need to listen
        // (App.jsx for navigation, ItemBrowser for loading items, SignageBrowser for signages)
        ipcRenderer.on("package:loaded", (event, data) => {
            // Old format: just the items array; new format: { items, signages }
            callback(data)
        })
    },
    onPackageClosed: (callback) => {
        // Note: We DON'T remove all listeners here because multiple components need to listen
        // (App.jsx for navigation, ItemBrowser for clearing items)
        ipcRenderer.on("package:closed", () => {
            callback()
        })
    },

    // ========================================
    // ITEM EDITING FUNCTIONS
    // ========================================
    openItemEditor: (item) => ipcRenderer.invoke("open-item-editor", item),
    onItemLoaded: (callback) => {
        if (callback) {
            ipcRenderer.on("load-item", (event, item) => callback(event, item))
        } else {
            ipcRenderer.removeAllListeners("load-item")
        }
    },
    editorReady: () => ipcRenderer.send("editor-ready"),
    showIconPreview: (iconPath, itemName) =>
        ipcRenderer.invoke("show-icon-preview", { iconPath, itemName }),
    browseForIcon: (itemId) =>
        ipcRenderer.invoke("browse-for-icon", { itemId }),
    browseForIconFile: () => ipcRenderer.invoke("browse-for-icon-file"),
    // Icon maker (src/components/items/IconMaker.jsx)
    generateIconModel: (itemId, instanceKey) =>
        ipcRenderer.invoke("icon-maker-generate-model", { itemId, instanceKey }),
    // Makes the models of all the item's instances not made yet
    generateAllIconModels: (itemId) =>
        ipcRenderer.invoke("icon-maker-generate-all", { itemId }),
    // The instances whose icon maker model is made: [{ instanceKey, name }]
    listIconModels: (itemId) =>
        ipcRenderer.invoke("icon-maker-list-models", { itemId }),
    // Makes the item's model from an instance's icon maker model (Model Chooser)
    makeModelFromIconModel: (itemId, instanceKey) =>
        ipcRenderer.invoke("make-model-from-icon-model", { itemId, instanceKey }),
    saveMadeIcon: (itemId, png) =>
        ipcRenderer.invoke("icon-maker-save-icon", { itemId, png }),
    saveItem: (itemData) => ipcRenderer.invoke("save-item", itemData),
    onItemUpdated: (callback) => {
        // Remove existing listeners to prevent stacking
        ipcRenderer.removeAllListeners("item-updated")
        if (callback) {
            ipcRenderer.on("item-updated", (event, item) =>
                callback(event, item),
            )
        }
    },

    // ========================================
    // SIGNAGE EDITING FUNCTIONS
    // ========================================
    openSignageEditor: (signage) =>
        ipcRenderer.invoke("open-signage-editor", signage),
    onSignageLoaded: (callback) => {
        if (callback) {
            ipcRenderer.on("load-signage", (event, signage) =>
                callback(event, signage),
            )
        } else {
            ipcRenderer.removeAllListeners("load-signage")
        }
    },
    saveSignage: (signageData) => ipcRenderer.invoke("save-signage", signageData),
    createSignage: (data) => ipcRenderer.invoke("create-signage", data),
    deleteSignage: (signageId) =>
        ipcRenderer.invoke("delete-signage", { signageId }),
    stageSignageDesign: (payload) =>
        ipcRenderer.invoke("stage-signage-design", payload),
    onSignageDesignStaged: (callback) => {
        ipcRenderer.removeAllListeners("signage-design-staged")
        if (callback) {
            ipcRenderer.on("signage-design-staged", (event, payload) =>
                callback(payload),
            )
        }
    },
    listSignageSvgFolder: () => ipcRenderer.invoke("list-signage-svg-folder"),
    browseSignageSvgFolder: () =>
        ipcRenderer.invoke("browse-signage-svg-folder"),
    openSignageSvgFolder: () => ipcRenderer.invoke("open-signage-svg-folder"),
    getSignageSvgFolder: () => ipcRenderer.invoke("get-signage-svg-folder"),
    openSignageDesigner: (payload) =>
        ipcRenderer.invoke("open-signage-designer-window", payload),
    getSignageDesign: (signageId, styleId) =>
        ipcRenderer.invoke("get-signage-design", signageId, styleId),
    saveFileDialog: (options) =>
        ipcRenderer.invoke("save-file-dialog", options),
    loadBpsignDialog: () => ipcRenderer.invoke("load-bpsign-dialog"),
    onLoadSignageDesign: (callback) => {
        ipcRenderer.removeAllListeners("load-signage-design")
        if (callback) {
            ipcRenderer.on("load-signage-design", (event, payload) =>
                callback(payload),
            )
        }
    },
    onSignageDesignerMenu: (callback) => {
        ipcRenderer.removeAllListeners("signage-designer-menu")
        if (callback) {
            ipcRenderer.on("signage-designer-menu", (event, action) =>
                callback(action),
            )
        }
    },
    onSignageUpdated: (callback) => {
        ipcRenderer.removeAllListeners("signage-updated")
        if (callback) {
            ipcRenderer.on("signage-updated", (event, signage) =>
                callback(event, signage),
            )
        }
    },

    // ========================================
    // INSTANCE MANAGEMENT FUNCTIONS
    // ========================================
    editInstance: (instancePath) =>
        ipcRenderer.invoke("edit-instance", instancePath),
    addInstance: (itemId, instanceName) =>
        ipcRenderer.invoke("add-instance", { itemId, instanceName }),
    addInstanceFromFile: (itemId, filePath, instanceName) =>
        ipcRenderer.invoke("add-instance-from-file", {
            itemId,
            filePath,
            instanceName,
        }),
    addInstanceFileDialog: (itemId) =>
        ipcRenderer.invoke("add-instance-file-dialog", { itemId }),
    selectInstanceFile: (itemId) =>
        ipcRenderer.invoke("select-instance-file", { itemId }),
    replaceInstanceFileDialog: (itemId, instanceIndex) =>
        ipcRenderer.invoke("replace-instance-file-dialog", {
            itemId,
            instanceIndex,
        }),
    removeInstance: (itemId, instanceIndex) =>
        ipcRenderer.invoke("remove-instance", { itemId, instanceIndex }),
    getInstanceMetadata: (itemId, instanceIndex) =>
        ipcRenderer.invoke("get-instance-metadata", { itemId, instanceIndex }),
    checkVmfExternalAssets: (vmfPath) =>
        ipcRenderer.invoke("check-vmf-external-assets", { vmfPath }),

    // ========================================
    // INSTANCE NAMING FUNCTIONS
    // ========================================
    getInstanceName: (itemId, instanceIndex) =>
        ipcRenderer.invoke("get-instance-name", { itemId, instanceIndex }),
    setInstanceName: (itemId, instanceIndex, name) =>
        ipcRenderer.invoke("set-instance-name", {
            itemId,
            instanceIndex,
            name,
        }),
    getInstanceNames: (itemId) =>
        ipcRenderer.invoke("get-instance-names", { itemId }),
    removeInstanceName: (itemId, instanceIndex) =>
        ipcRenderer.invoke("remove-instance-name", { itemId, instanceIndex }),

    // ========================================
    // INPUT MANAGEMENT FUNCTIONS
    // ========================================
    getInputs: (itemId) => ipcRenderer.invoke("get-inputs", { itemId }),
    addInput: (itemId, inputName, inputConfig) =>
        ipcRenderer.invoke("add-input", { itemId, inputName, inputConfig }),
    updateInput: (itemId, inputName, inputConfig) =>
        ipcRenderer.invoke("update-input", { itemId, inputName, inputConfig }),
    removeInput: (itemId, inputName) =>
        ipcRenderer.invoke("remove-input", { itemId, inputName }),

    // ========================================
    // OUTPUT MANAGEMENT FUNCTIONS
    // ========================================
    getOutputs: (itemId) => ipcRenderer.invoke("get-outputs", { itemId }),
    addOutput: (itemId, outputName, outputConfig) =>
        ipcRenderer.invoke("add-output", { itemId, outputName, outputConfig }),
    updateOutput: (itemId, outputName, outputConfig) =>
        ipcRenderer.invoke("update-output", {
            itemId,
            outputName,
            outputConfig,
        }),
    removeOutput: (itemId, outputName) =>
        ipcRenderer.invoke("remove-output", { itemId, outputName }),

    // Ensure ConnectionPoints exist if item has I/O
    ensureConnectionPoints: (itemId) =>
        ipcRenderer.invoke("ensure-connection-points", { itemId }),

    // ========================================
    // VARIABLES MANAGEMENT FUNCTIONS
    // ========================================
    getVariables: (itemId) => ipcRenderer.invoke("get-variables", { itemId }),
    saveVariables: (itemId, variables) =>
        ipcRenderer.invoke("save-variables", { itemId, variables }),

    // ========================================
    // MODEL NAME MANAGEMENT FUNCTIONS
    // ========================================
    getModelName: (itemId) => ipcRenderer.invoke("get-model-name", { itemId }),
    saveModelName: (itemId, modelName) =>
        ipcRenderer.invoke("save-model-name", { itemId, modelName }),

    // ========================================
    // CONDITIONS MANAGEMENT FUNCTIONS
    // ========================================
    getConditions: (itemId) => ipcRenderer.invoke("get-conditions", { itemId }),
    saveConditions: (itemId, conditions) =>
        ipcRenderer.invoke("save-conditions", { itemId, conditions }),
    convertBlocksToVbsp: (blocks) =>
        ipcRenderer.invoke("convert-blocks-to-vbsp", { blocks }),
    getVbspPrefabs: () => ipcRenderer.invoke("get-vbsp-prefabs"),

    // ========================================
    // VMF2OBJ CONVERSION
    // ========================================
    convertVmfToObj: (vmfPath, outputDir) =>
        ipcRenderer.invoke("convert-vmf-to-obj", { vmfPath, outputDir }),
    convertInstanceToObj: (itemId, instanceKey, options = {}) =>
        ipcRenderer.invoke("convert-instance-to-obj", {
            itemId,
            instanceKey,
            options,
        }),
    setExtraResourcePaths: (paths) =>
        ipcRenderer.invoke("set-extra-resource-paths", { paths }),
    getExtraResourcePaths: () => ipcRenderer.invoke("get-extra-resource-paths"),
    findPortal2Resources: () => ipcRenderer.invoke("find-portal2-resources"),
    getFileStats: (filePath) =>
        ipcRenderer.invoke("get-file-stats", { filePath }),
    showItemInFolder: (filePath) =>
        ipcRenderer.invoke("show-item-in-folder", { filePath }),
    showModelPreview: (objPath, mtlPath, title, segments = null) =>
        ipcRenderer.invoke("show-model-preview", { objPath, mtlPath, title, segments }),
    listModelSegments: (itemId) =>
        ipcRenderer.invoke("list-model-segments", { itemId }),

    // ========================================
    // PORTAL 2 DETECTION
    // ========================================
    getPortal2Status: () => ipcRenderer.invoke("get-portal2-status"),

    // ========================================
    // ENTITY AND FGD DATA FUNCTIONS
    // ========================================
    getItemEntities: (itemId) =>
        ipcRenderer.invoke("get-item-entities", { itemId }),
    fixEntityNames: (itemId) =>
        ipcRenderer.invoke("fix-entity-names", { itemId }),
    getValidInstances: (itemId) =>
        ipcRenderer.invoke("get-valid-instances", { itemId }),
    getFgdData: () => ipcRenderer.invoke("get-fgd-data"),

    // ========================================
    // METADATA MANAGEMENT FUNCTIONS
    // ========================================
    getItemMetadata: (itemId) =>
        ipcRenderer.invoke("get-item-metadata", { itemId }),
    updateItemMetadata: (itemId, metadata) =>
        ipcRenderer.invoke("update-item-metadata", { itemId, metadata }),

    // ========================================
    // WINDOW TITLE MANAGEMENT
    // ========================================
    setUnsavedChanges: (hasChanges) =>
        ipcRenderer.invoke("set-unsaved-changes", hasChanges),

    // ========================================
    // PACKAGE MANAGEMENT FUNCTIONS
    // ========================================
    reloadPackage: () => ipcRenderer.invoke("reload-package"),

    // ========================================
    // ITEM IMPORTER (File > Import from Package...)
    // ========================================
    importItemsGetManifest: () => ipcRenderer.invoke("import-items-manifest"),
    importItemsExecute: (selection) =>
        ipcRenderer.invoke("import-items-execute", selection),
    importItemsCancel: () => ipcRenderer.invoke("import-items-cancel"),
    // Fired at the MAIN window when an import finishes (for the toast)
    onImportItemsDone: (callback) => {
        ipcRenderer.removeAllListeners("import-items:done")
        if (callback) {
            ipcRenderer.on("import-items:done", (event, data) =>
                callback(data),
            )
        }
    },

    // ========================================
    // PACKAGE LOADING PROGRESS
    // ========================================
    onPackageLoadingProgress: (callback) =>
        ipcRenderer.on("package-loading-progress", (event, data) =>
            callback(data),
        ),

    // ========================================
    // MODEL PREVIEW DATA
    // ========================================
    onModelPreviewData: (callback) => {
        ipcRenderer.removeAllListeners("model-preview-data")
        ipcRenderer.on("model-preview-data", (event, data) => callback(data))
    },

    // ========================================
    // AUTO-UPDATER FUNCTIONS
    // ========================================
    checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
    downloadUpdate: () => ipcRenderer.invoke("download-update"),
    quitAndInstall: () => ipcRenderer.invoke("quit-and-install"),
    onUpdateStatus: (callback) => {
        ipcRenderer.removeAllListeners("update-status")
        ipcRenderer.on("update-status", (event, data) => callback(data))
    },

    // ========================================
    // CRASH REPORT FUNCTIONS
    // ========================================
    submitCrashReport: (userDescription, errorDetails, contact) =>
        ipcRenderer.invoke("submit-crash-report", { userDescription, errorDetails, contact }),
    getCrashReportStatus: () =>
        ipcRenderer.invoke("get-crash-report-status"),
    onCrashReportData: (callback) => {
        ipcRenderer.removeAllListeners("crash-report-data")
        ipcRenderer.on("crash-report-data", (event, data) => callback(data))
    },
    isUpdateAvailable: () => ipcRenderer.invoke("is-update-available"),

    // ========================================
    // BEE PACKAGE INFO FUNCTIONS
    // ========================================
    getBeePackageInfo: () => ipcRenderer.invoke("get-bee-package-info"),
    saveBeePackageInfo: (beePackageData) =>
        ipcRenderer.invoke("save-bee-package-info", beePackageData),

    // ========================================
    // SETTINGS FUNCTIONS
    // ========================================
    getSettings: () => ipcRenderer.invoke("get-settings"),
    saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),
    getSetting: (key, defaultValue) =>
        ipcRenderer.invoke("get-setting", { key, defaultValue }),
    setSetting: (key, value) =>
        ipcRenderer.invoke("set-setting", { key, value }),
    checkSetupComplete: () => ipcRenderer.invoke("check-setup-complete"),
    getPortal2Path: () => ipcRenderer.invoke("get-portal2-path"),
    setPortal2Path: (path) => ipcRenderer.invoke("set-portal2-path", { path }),
    getBeemodPath: () => ipcRenderer.invoke("get-beemod-path"),
    setBeemodPath: (path) => ipcRenderer.invoke("set-beemod-path", { path }),
    completeSetup: (portal2Path, beemodPath) =>
        ipcRenderer.invoke("complete-setup", { portal2Path, beemodPath }),
    browsePortal2Path: () => ipcRenderer.invoke("browse-portal2-path"),
    browseBeemodPath: () => ipcRenderer.invoke("browse-beemod-path"),
    closeSetupWindow: () => ipcRenderer.invoke("close-setup-window"),
    closeSettingsWindow: () => ipcRenderer.invoke("close-settings-window"),
    deleteAllSettings: () => ipcRenderer.invoke("delete-all-settings"),
})
