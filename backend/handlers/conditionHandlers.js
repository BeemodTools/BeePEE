/**
 * Conditions and VBSP conversion handlers
 */

const { dialog } = require("electron")
const fs = require("fs")
const path = require("path")
const { packages } = require("../packageManager")
const { sendItemUpdateToEditor } = require("../items/itemEditor")

const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`

function register(ipcMain, mainWindow) {
    // Conditions management handlers
    ipcMain.handle("get-conditions", async (event, { itemId }) => {
        try {
            const item = packages
                .flatMap((p) => p.items)
                .find((i) => i.id === itemId)
            if (!item) throw new Error("Item not found")

            return { success: true, conditions: item.getConditions() }
        } catch (error) {
            return { success: false, error: error.message }
        }
    })

    ipcMain.handle("save-conditions", async (event, { itemId, conditions }) => {
        try {
            const item = packages
                .flatMap((p) => p.items)
                .find((i) => i.id === itemId)
            if (!item) throw new Error("Item not found")

            // Convert blocks to VBSP format and save
            const success = item.saveConditions(conditions)
            if (!success) {
                throw new Error("Failed to save conditions to VBSP config")
            }
            console.log(
                `Saved ${plural(conditions?.blocks?.length ?? 0, "condition block")} of "${item.name}"`,
            )

            // Send updated item data to frontend
            const updatedItem = item.toJSONWithExistence()
            mainWindow.webContents.send("item-updated", updatedItem)
            sendItemUpdateToEditor(itemId, updatedItem)

            return { success: true }
        } catch (error) {
            console.error(
                `Failed to save the conditions of item ${itemId}:`,
                error,
            )
            dialog.showErrorBox("Failed to Save Conditions", error.message)
            return { success: false, error: error.message }
        }
    })

    // Load VBSP prefabs
    ipcMain.handle("get-vbsp-prefabs", async () => {
        try {
            // Check both dev and packaged paths
            const devPath = path.join(__dirname, "..", "prefabs", "vbsp_prefabs.json")
            const packagedPath = path.join(process.resourcesPath || "", "prefabs", "vbsp_prefabs.json")

            let prefabsPath = null
            if (fs.existsSync(devPath)) {
                prefabsPath = devPath
            } else if (fs.existsSync(packagedPath)) {
                prefabsPath = packagedPath
            }

            if (!prefabsPath) {
                return { success: false, error: "Prefabs file not found" }
            }

            const prefabsData = JSON.parse(fs.readFileSync(prefabsPath, "utf-8"))
            return { success: true, prefabs: prefabsData }
        } catch (error) {
            console.error("Failed to load VBSP prefabs:", error)
            return { success: false, error: error.message }
        }
    })

    // VBSP conversion handler (standalone testing)
    ipcMain.handle("convert-blocks-to-vbsp", async (event, { blocks }) => {
        try {
            // Create a temporary item instance to use the conversion method
            const vbspConfig = convertBlocksToVbsp(blocks)
            return { success: true, vbspConfig }
        } catch (error) {
            console.error("Failed to convert blocks to VBSP:", error)
            return { success: false, error: error.message }
        }
    })
}

/**
 * Convert blocks to VBSP format
 */
function convertBlocksToVbsp(blockList) {
    const vbspConditions = {
        Conditions: {},
    }

    // Helper function to convert boolean values
    function convertBooleanValue(value, variableName = "") {
        if (value !== undefined && value !== null && value !== "") {
            if (value === true || value === "true") return "1"
            if (value === false || value === "false") return "0"
            return value.toString()
        }

        if (variableName) {
            const cleanVariableName = variableName.replace(/^\$/, "")
            const booleanVariables = [
                "StartEnabled",
                "StartActive",
                "StartDeployed",
                "StartOpen",
                "StartLocked",
                "StartReversed",
                "AutoDrop",
                "AutoRespawn",
            ]
            if (booleanVariables.some((v) => cleanVariableName.includes(v))) {
                return "1"
            }
        }

        return "1"
    }

    // Convert a single block to VBSP format
    function convertBlockToVbsp(block) {
        function processChildBlocks(childBlocks, containerName) {
            if (!childBlocks || childBlocks.length === 0) return {}

            const result = {}

            function addMulti(obj, key, value) {
                if (obj[key] === undefined) {
                    obj[key] = value
                } else if (Array.isArray(obj[key])) {
                    obj[key].push(value)
                } else {
                    obj[key] = [obj[key], value]
                }
            }

            childBlocks.forEach((childBlock) => {
                const childVbsp = convertBlockToVbsp(childBlock)

                if (childBlock.type === "if" || childBlock.type === "ifElse") {
                    addMulti(result, "Condition", childVbsp)
                    return
                }
                if (childBlock.type === "switchCase" || childBlock.type === "switchGlobal") {
                    const inner = childVbsp.Switch || childVbsp.switch || childVbsp
                    addMulti(result, "Switch", inner)
                    return
                }

                Object.assign(result, childVbsp)
            })
            return result
        }

        switch (block.type) {
            case "if": {
                const ifValue = convertBooleanValue(block.value, block.variable)
                const ifOperator = block.operator || "=="
                const ifResult = {
                    instVar: `${block.variable || ""} ${ifOperator} ${ifValue}`,
                }

                if (block.thenBlocks && block.thenBlocks.length > 0) {
                    const thenResult = processChildBlocks(block.thenBlocks, "thenBlocks")
                    ifResult.Result = thenResult
                }

                return ifResult
            }

            case "ifElse": {
                const ifElseValue = convertBooleanValue(block.value, block.variable)
                const ifElseOperator = block.operator || "=="
                const ifElseResult = {
                    instVar: `${block.variable || ""} ${ifElseOperator} ${ifElseValue}`,
                }

                if (block.thenBlocks && block.thenBlocks.length > 0) {
                    const thenResult = processChildBlocks(block.thenBlocks, "thenBlocks")
                    ifElseResult.Result = thenResult
                }

                if (block.elseBlocks && block.elseBlocks.length > 0) {
                    const elseResult = processChildBlocks(block.elseBlocks, "elseBlocks")
                    ifElseResult.Else = elseResult
                }

                return ifElseResult
            }

            case "ifHas": {
                const ifHasResult = {
                    styleVar: block.value || "",
                }

                if (block.thenBlocks && block.thenBlocks.length > 0) {
                    const thenResult = processChildBlocks(block.thenBlocks, "thenBlocks")
                    ifHasResult.Result = thenResult
                }

                return ifHasResult
            }

            case "ifHasElse": {
                const ifHasElseResult = {
                    styleVar: block.value || "",
                }

                if (block.thenBlocks && block.thenBlocks.length > 0) {
                    const thenResult = processChildBlocks(block.thenBlocks, "thenBlocks")
                    ifHasElseResult.Result = thenResult
                }

                if (block.elseBlocks && block.elseBlocks.length > 0) {
                    const elseResult = processChildBlocks(block.elseBlocks, "elseBlocks")
                    ifHasElseResult.Else = elseResult
                }

                return ifHasElseResult
            }

            case "switchCase": {
                const variable = block.variable || ""
                const variableWithDollar = variable.startsWith("$")
                    ? variable
                    : variable
                      ? `$${variable}`
                      : ""
                const switchObj = {
                    Switch: {
                        method: block.method || "first",
                        test: "instvar",
                    },
                }

                if (Array.isArray(block.cases)) {
                    for (const caseBlock of block.cases) {
                        const arg =
                            caseBlock &&
                            caseBlock.value !== undefined &&
                            caseBlock.value !== null &&
                            caseBlock.value !== ""
                                ? `${variableWithDollar} ${convertBooleanValue(caseBlock.value, variableWithDollar)}`
                                : "<default>"
                        const caseResults = processChildBlocks(caseBlock?.thenBlocks || [], "thenBlocks")
                        switchObj.Switch[arg] = caseResults
                    }
                }
                return switchObj
            }

            case "switchGlobal": {
                const testName = block.test || "styleVar"
                const switchObj = {
                    Switch: {
                        method: block.method || "first",
                        test: testName,
                    },
                }

                if (Array.isArray(block.cases)) {
                    for (const caseBlock of block.cases) {
                        const arg =
                            caseBlock &&
                            caseBlock.value !== undefined &&
                            caseBlock.value !== null &&
                            caseBlock.value !== ""
                                ? `${caseBlock.value}`
                                : "<default>"
                        const caseResults = processChildBlocks(caseBlock?.thenBlocks || [], "thenBlocks")
                        switchObj.Switch[arg] = caseResults
                    }
                }
                return switchObj
            }

            case "case": {
                const caseResult = {}

                if (block.thenBlocks && block.thenBlocks.length > 0) {
                    const thenResult = processChildBlocks(block.thenBlocks, "thenBlocks")
                    Object.assign(caseResult, thenResult)
                }

                return caseResult
            }

            case "changeInstance":
                return {
                    changeInstance: block.instanceName || "",
                }

            case "addOverlay":
                return {
                    addOverlay: block.overlayName || "",
                }

            case "addGlobalEnt":
                return {
                    addGlobalEnt: block.instanceName || "",
                }

            case "offsetInstance":
                return {
                    offsetInstance: `${block.instanceName || ""} ${block.offset || "0 0 0"}`,
                }

            case "mapInstVar": {
                const mapResult = {}
                if (block.sourceVariable && block.targetVariable) {
                    mapResult.setInstVar = `${block.targetVariable} ${block.sourceVariable}`
                }
                if (block.mappings && Object.keys(block.mappings).length > 0) {
                    Object.assign(mapResult, block.mappings)
                }
                return mapResult
            }

            case "debug":
                return {
                    debug: block.message || "",
                }

            default:
                return {
                    unknown: {
                        type: block.type,
                        data: block,
                    },
                }
        }
    }

    // Process each top-level block and create Condition objects
    const conditions = []
    blockList.forEach((block) => {
        const vbspBlock = convertBlockToVbsp(block)
        conditions.push(vbspBlock)
    })

    // If there's only one condition, use a single object
    // If there are multiple conditions, use an array
    if (conditions.length === 1) {
        vbspConditions.Conditions.Condition = conditions[0]
    } else if (conditions.length > 1) {
        vbspConditions.Conditions.Condition = conditions
    }

    return vbspConditions
}

module.exports = { register }
