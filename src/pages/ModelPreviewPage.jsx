import { useEffect, useState, useRef, Suspense, useMemo } from "react"
import { Canvas, useThree } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"
import * as THREE from "three"
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader"
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader"

// Dual grid component: main grid at 128 units, lighter sub-grid at 64 units
function SimpleGrid({ size = 20480, position = [0, -64, 0] }) {
    // Main grid: 128 units per cell (size / 128 = divisions)
    const mainGrid = useMemo(() => {
        const grid = new THREE.GridHelper(size, size / 128, 0x555555, 0x555555)
        return grid
    }, [size])

    // Sub-grid: 64 units per cell (lighter, finer lines)
    const subGrid = useMemo(() => {
        const grid = new THREE.GridHelper(size, size / 64, 0x333333, 0x333333)
        return grid
    }, [size])

    return (
        <group position={position}>
            <primitive object={subGrid} />
            <primitive object={mainGrid} />
        </group>
    )
}

// Custom OBJ model component that handles beep:// URLs
function Model({ objUrl, mtlUrl, onLoad, onError }) {
    const [model, setModel] = useState(null)
    const { camera, controls } = useThree()

    useEffect(() => {
        if (!objUrl) return

        const loadModel = async () => {
            try {
                const objLoader = new OBJLoader()

                // Load MTL first if available
                if (mtlUrl) {
                    try {
                        const mtlResponse = await fetch(mtlUrl)
                        if (mtlResponse.ok) {
                            const mtlText = await mtlResponse.text()
                            const mtlLoader = new MTLLoader()

                            // Extract base directory for texture paths
                            const mtlBaseDir = mtlUrl.substring(0, mtlUrl.lastIndexOf("/") + 1)
                            const materials = mtlLoader.parse(mtlText, mtlBaseDir)

                            // Preload materials and set up texture loader override
                            materials.preload()

                            // Override texture loader to handle beep:// URLs
                            const originalLoad = THREE.TextureLoader.prototype.load
                            THREE.TextureLoader.prototype.load = function (url, onLoad, onProgress, onError) {
                                let normalizedUrl = url.replace(/\\\\/g, "/").replace(/\\/g, "/")
                                normalizedUrl = normalizedUrl.replace(/([^:])\/\//g, "$1/")

                                if (normalizedUrl.startsWith("beep://")) {
                                    const texture = new THREE.Texture()
                                    fetch(normalizedUrl)
                                        .then((response) => response.blob())
                                        .then((blob) => {
                                            const objectUrl = URL.createObjectURL(blob)
                                            const img = new Image()
                                            img.onload = () => {
                                                texture.image = img
                                                texture.needsUpdate = true
                                                URL.revokeObjectURL(objectUrl)
                                                if (onLoad) onLoad(texture)
                                            }
                                            img.onerror = (err) => {
                                                URL.revokeObjectURL(objectUrl)
                                                if (onError) onError(err)
                                            }
                                            img.src = objectUrl
                                        })
                                        .catch((err) => {
                                            if (onError) onError(err)
                                        })
                                    return texture
                                }
                                return originalLoad.call(this, normalizedUrl, onLoad, onProgress, onError)
                            }

                            objLoader.setMaterials(materials)
                        }
                    } catch (mtlError) {
                        console.warn(
                            `Failed to load MTL ${mtlUrl}, continuing without materials:`,
                            mtlError,
                        )
                    }
                }

                // Load OBJ
                const objResponse = await fetch(objUrl)
                if (!objResponse.ok) {
                    throw new Error(`Failed to fetch OBJ: ${objResponse.status}`)
                }
                const objText = await objResponse.text()
                const object = objLoader.parse(objText)

                // Apply default material settings
                object.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true
                        child.receiveShadow = true
                        if (child.material) {
                            if (Array.isArray(child.material)) {
                                child.material.forEach((mat) => {
                                    mat.side = THREE.DoubleSide
                                })
                            } else {
                                child.material.side = THREE.DoubleSide
                            }
                        } else {
                            child.material = new THREE.MeshStandardMaterial({
                                color: 0xcccccc,
                                roughness: 0.7,
                                metalness: 0.1,
                                side: THREE.DoubleSide,
                            })
                        }
                    }
                })

                // Center camera on model
                const box = new THREE.Box3().setFromObject(object)
                const size = box.getSize(new THREE.Vector3())
                const center = box.getCenter(new THREE.Vector3())

                const maxSize = Math.max(size.x, size.y, size.z)
                if (maxSize > 0) {
                    const fov = camera.fov * (Math.PI / 180)
                    const distance = (maxSize / 2) / Math.tan(fov / 2)
                    const nearDistance = distance * 0.85

                    camera.position.set(
                        center.x + nearDistance,
                        center.y + nearDistance * 0.35,
                        center.z + nearDistance
                    )
                    if (controls) {
                        controls.target.copy(center)
                        controls.update()
                    }
                }

                setModel(object)
                if (onLoad) onLoad()
            } catch (error) {
                console.error(`Failed to load model ${objUrl}:`, error)
                if (onError) onError(error)
            }
        }

        loadModel()
    }, [objUrl, mtlUrl, camera, controls, onLoad, onError])

    return model ? <primitive object={model} /> : null
}

// Scene setup component
function Scene({ objUrl, mtlUrl, onLoad, onError }) {
    return (
        <>
            {/* Lighting */}
            <ambientLight intensity={0.4} />
            <directionalLight
                position={[10, 10, 10]}
                intensity={1.0}
                castShadow
                shadow-mapSize={[2048, 2048]}
            />
            <directionalLight position={[-10, -10, -10]} intensity={0.6} />
            <directionalLight position={[0, 5, -10]} intensity={0.3} />

            {/* Grid */}
            <SimpleGrid />

            {/* Model */}
            <Model objUrl={objUrl} mtlUrl={mtlUrl} onLoad={onLoad} onError={onError} />

            {/* Controls */}
            <OrbitControls
                enableDamping
                dampingFactor={0.05}
                makeDefault
            />
        </>
    )
}

// Segment selector component
function SegmentSelector({ segments, currentIndex, onChange }) {
    if (!segments || segments.length <= 1) return null

    const handlePrev = () => {
        if (currentIndex < segments.length - 1) {
            onChange(currentIndex + 1)
        }
    }

    const handleNext = () => {
        if (currentIndex > 0) {
            onChange(currentIndex - 1)
        }
    }

    return (
        <div style={styles.segmentSelector}>
            <button
                style={styles.navBtn}
                onClick={handlePrev}
                disabled={currentIndex >= segments.length - 1}
                title="Previous segment (Up arrow)"
            >
                ▲
            </button>
            <select
                style={styles.dropdown}
                value={currentIndex}
                onChange={(e) => onChange(parseInt(e.target.value))}
            >
                {segments.map((seg, idx) => (
                    <option key={idx} value={idx}>
                        {seg.label || `Segment ${seg.index}`}
                    </option>
                ))}
            </select>
            <button
                style={styles.navBtn}
                onClick={handleNext}
                disabled={currentIndex <= 0}
                title="Next segment (Down arrow)"
            >
                ▼
            </button>
        </div>
    )
}

// Main component
export default function ModelPreviewPage() {
    const [modelData, setModelData] = useState(null)
    const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [infoText, setInfoText] = useState("Loading model...")

    // Receive model data from main process
    useEffect(() => {
        if (window.package?.onModelPreviewData) {
            window.package.onModelPreviewData((data) => {
                console.log(`Received model preview data for "${data?.title}"`)
                setModelData(data)
                setLoading(true)
                setError(null)
            })
        }

        // Request the data
        if (window.package?.requestModelPreviewData) {
            window.package.requestModelPreviewData()
        }
    }, [])

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (!modelData?.segments || modelData.segments.length <= 1) return
            if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return

            if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
                e.preventDefault()
                setCurrentSegmentIndex((prev) =>
                    prev < modelData.segments.length - 1 ? prev + 1 : prev
                )
            } else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
                e.preventDefault()
                setCurrentSegmentIndex((prev) => (prev > 0 ? prev - 1 : prev))
            }
        }

        window.addEventListener("keydown", handleKeyDown)
        return () => window.removeEventListener("keydown", handleKeyDown)
    }, [modelData])

    // Get current model URLs
    const getCurrentUrls = () => {
        if (!modelData) return { objUrl: null, mtlUrl: null }

        if (modelData.segments && modelData.segments.length > 0) {
            const segment = modelData.segments[currentSegmentIndex]
            return {
                objUrl: segment?.objUrl || null,
                mtlUrl: segment?.mtlUrl || null,
            }
        }

        return {
            objUrl: modelData.objUrl || null,
            mtlUrl: modelData.mtlUrl || null,
        }
    }

    const { objUrl, mtlUrl } = getCurrentUrls()

    const handleLoad = () => {
        setLoading(false)
        setInfoText("Model loaded! Left-drag: orbit • Right-drag: pan • Wheel: zoom")
    }

    const handleError = (err) => {
        setLoading(false)
        setError(err.message || "Failed to load model")
    }

    return (
        <div style={styles.container}>
            {/* Info overlay */}
            <div style={styles.info}>{loading ? "Loading model..." : infoText}</div>

            {/* Segment selector */}
            <SegmentSelector
                segments={modelData?.segments}
                currentIndex={currentSegmentIndex}
                onChange={setCurrentSegmentIndex}
            />

            {/* Loading indicator */}
            {loading && <div style={styles.loading}>Loading 3D model...</div>}

            {/* Error display */}
            {error && <div style={styles.error}>{error}</div>}

            {/* 3D Canvas */}
            <Canvas
                camera={{ fov: 50, near: 0.1, far: 50000, position: [2, 2, 3] }}
                shadows
                style={{ background: "#1e1e1e" }}
            >
                <Suspense fallback={null}>
                    {objUrl && (
                        <Scene
                            key={`${objUrl}-${currentSegmentIndex}`}
                            objUrl={objUrl}
                            mtlUrl={mtlUrl}
                            onLoad={handleLoad}
                            onError={handleError}
                        />
                    )}
                </Suspense>
            </Canvas>
        </div>
    )
}

// Styles
const styles = {
    container: {
        width: "100%",
        height: "100vh",
        position: "relative",
        overflow: "hidden",
    },
    info: {
        position: "absolute",
        top: 10,
        left: 10,
        color: "#ddd",
        fontSize: 12,
        fontFamily: "sans-serif",
        zIndex: 100,
        background: "rgba(0,0,0,0.7)",
        padding: "8px 12px",
        borderRadius: 4,
    },
    loading: {
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        color: "#ddd",
        fontSize: 16,
        zIndex: 50,
    },
    error: {
        position: "absolute",
        bottom: 20,
        left: 20,
        right: 20,
        background: "#d32f2f",
        color: "white",
        padding: 12,
        borderRadius: 4,
        zIndex: 100,
    },
    segmentSelector: {
        position: "absolute",
        top: 10,
        right: 10,
        zIndex: 100,
        background: "rgba(0,0,0,0.7)",
        padding: "8px 12px",
        borderRadius: 4,
        display: "flex",
        alignItems: "center",
        gap: 8,
    },
    dropdown: {
        padding: "6px 10px",
        borderRadius: 4,
        border: "1px solid #555",
        background: "#2d2d2d",
        color: "#ddd",
        fontSize: 14,
        cursor: "pointer",
        minWidth: 120,
    },
    navBtn: {
        width: 28,
        height: 28,
        borderRadius: 4,
        border: "1px solid #555",
        background: "#2d2d2d",
        color: "#ddd",
        fontSize: 16,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
}
