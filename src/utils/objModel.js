import * as THREE from "three"
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js"
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js"

/**
 * How the converter marks materials whose texture alpha is see-through:
 * "# beepee:translucent" / "# beepee:alphatest" after their "newmtl"
 */
function alphaModes(mtl) {
    const modes = new Map()
    let current = null
    for (const line of mtl.split(/\r?\n/)) {
        if (line.startsWith("newmtl ")) current = line.slice(7).trim()
        else if (current && line.startsWith("# beepee:")) {
            modes.set(current, line.slice(9).trim())
        }
    }
    return modes
}

/**
 * A model from OBJ and MTL text, its textures loaded from the URLs given for
 * the paths the MTL names them by (data URLs for local files)
 * @param {{obj: string, mtl?: string, textures?: Object<string, string>}} model
 * @returns {THREE.Group}
 */
export function buildObjModel({ obj, mtl, textures = {} }) {
    const objLoader = new OBJLoader()
    if (mtl) {
        const manager = new THREE.LoadingManager()
        manager.setURLModifier((url) => textures[url] ?? url)
        const materials = new MTLLoader(manager).parse(mtl, "")
        materials.preload()
        for (const [name, mode] of alphaModes(mtl)) {
            const material = materials.materials[name]
            if (!material) continue
            if (mode === "translucent") {
                material.transparent = true
                material.depthWrite = false
            } else if (mode === "alphatest") {
                material.alphaTest = 0.5
            }
        }
        objLoader.setMaterials(materials)
    }

    const object = objLoader.parse(obj)
    object.traverse((child) => {
        if (!child.isMesh) return
        const materials = Array.isArray(child.material)
            ? child.material
            : [child.material]
        for (const material of materials) {
            if (material) material.side = THREE.DoubleSide
        }
    })
    return object
}

/** Free a model's GPU resources */
export function disposeModel(object) {
    object?.traverse((child) => {
        if (!child.isMesh) return
        child.geometry?.dispose()
        const materials = Array.isArray(child.material)
            ? child.material
            : [child.material]
        for (const material of materials) {
            material?.map?.dispose()
            material?.dispose()
        }
    })
}
