/**
 * Utility functions for converting between block format and VBSP format
 */

/**
 * Convert blocks to VBSP format
 * @param {Array} blockList - Array of blocks to convert
 * @returns {Object} VBSP configuration object
 */
export const convertBlocksToVbsp = (blockList) => {
    const vbspConditions = {
        Conditions: {},
    }

    // Convert a single block to VBSP format
    function convertBlockToVbsp(block) {
        // Helper function to process child blocks
        function processChildBlocks(childBlocks, containerName) {
            if (!childBlocks || childBlocks.length === 0) return []

            return childBlocks.map((childBlock) => {
                return convertBlockToVbsp(childBlock)
            })
        }

        switch (block.type) {
            case "if":
                return {
                    Switch: {
                        Variable: block.variable || "",
                        Operator: block.operator || "==",
                        Value: block.value || "",
                        Result: processChildBlocks(
                            block.thenBlocks,
                            "thenBlocks",
                        ),
                    },
                }

            case "ifElse":
                return {
                    Switch: {
                        Variable: block.variable || "",
                        Operator: block.operator || "==",
                        Value: block.value || "",
                        Result: processChildBlocks(
                            block.thenBlocks,
                            "thenBlocks",
                        ),
                        Else: processChildBlocks(
                            block.elseBlocks,
                            "elseBlocks",
                        ),
                    },
                }

            case "ifHas":
                return {
                    IfHas: {
                        Value: block.value || "",
                        Result: processChildBlocks(
                            block.thenBlocks,
                            "thenBlocks",
                        ),
                    },
                }

            case "ifHasElse":
                return {
                    IfHas: {
                        Value: block.value || "",
                        Result: processChildBlocks(
                            block.thenBlocks,
                            "thenBlocks",
                        ),
                        Else: processChildBlocks(
                            block.elseBlocks,
                            "elseBlocks",
                        ),
                    },
                }

            case "switchCase":
                return {
                    Switch: {
                        Variable: block.variable || "",
                        Cases: processChildBlocks(block.cases, "cases"),
                    },
                }

            case "switchGlobal":
                return {
                    SwitchGlobal: {
                        Cases: processChildBlocks(block.cases, "cases"),
                    },
                }

            case "case":
                return {
                    Case: {
                        Value: block.value || "",
                        Result: processChildBlocks(
                            block.thenBlocks,
                            "thenBlocks",
                        ),
                    },
                }

            case "changeInstance":
                return {
                    ChangeInstance: {
                        Instance: block.instance || "",
                        NewInstance: block.newInstance || "",
                    },
                }

            case "addOverlay":
                return {
                    AddOverlay: {
                        Instance: block.instance || "",
                    },
                }

            case "addGlobalEnt":
                return {
                    AddGlobalEnt: {
                        Instance: block.instance || "",
                    },
                }

            case "offsetInstance":
                return {
                    OffsetInstance: {
                        Instance: block.instance || "",
                        Offset: block.offset || "0 0 0",
                    },
                }

            case "mapInstVar":
                return {
                    MapInstVar: {
                        SourceVariable: block.sourceVariable || "",
                        TargetVariable: block.targetVariable || "",
                        Mappings: block.mappings || {},
                    },
                }

            case "debug":
                return {
                    Debug: {
                        Message: block.message || "",
                    },
                }

            default:
                return {
                    Unknown: {
                        Type: block.type,
                        Data: block,
                    },
                }
        }
    }

    // Process each top-level block
    blockList.forEach((block, index) => {
        const vbspBlock = convertBlockToVbsp(block)
        const blockKey = `Condition_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        vbspConditions.Conditions[blockKey] = vbspBlock
    })

    return vbspConditions
}

/**
 * Log VBSP configuration to console
 * @param {Object} vbspConfig - VBSP configuration object
 * @param {string} itemName - Name of the item
 * @param {Array} blocks - Original blocks array
 */
export const logVbspConfig = (
    vbspConfig,
    itemName = "Unknown Item",
    blocks = [],
) => {
    console.log(
        `Converted ${blocks.length} condition blocks to VBSP config for "${itemName}"`,
    )
}
