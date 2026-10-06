import { useEffect, useState, useRef, Suspense, useMemo } from "react"
import { Canvas, useThree } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"
import * as THREE from "three"
import {
    Alert,
    Box,
    Chip,
    CircularProgress,
    Paper,
    Tooltip,
    Typography,
} from "@mui/material"
import { buildObjModel, disposeModel } from "../utils/objModel"

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

/** Frame the camera on a model (or a box): from the front-right, a little above */
function frameModel(camera, controls, object) {
    const box = object.isBox3 ? object : new THREE.Box3().setFromObject(object)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const maxSize = Math.max(size.x, size.y, size.z)
    if (maxSize <= 0) return
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

async function fetchText(url) {
    const response = await fetch(url)
    if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status}`)
    }
    return response.text()
}

// What's behind the surface the item is placed on (an instance's, from the
// Instances tab's warning) is red, the theme's error red: outlined brushes
// and props, and a marker for an entity without a model
const BEHIND_COLOR = 0xf44336
const BEHIND_CSS = "#f44336"

/**
 * A material for the outlines of what's behind the surface. They're hidden
 * behind the rest of the model, whose surfaces are pushed back a little
 * (pushBackSurfaces) so lines on them still show.
 */
const behindLineMaterial = () =>
    new THREE.LineBasicMaterial({ color: BEHIND_COLOR })

/** Push a model's surfaces back a little, so outlines drawn on them show */
function pushBackSurfaces(object) {
    object.traverse((child) => {
        if (!child.isMesh) return
        for (const material of [child.material].flat()) {
            if (!material) continue
            material.polygonOffset = true
            material.polygonOffsetFactor = 1
            material.polygonOffsetUnits = 1
            material.needsUpdate = true
        }
    })
}

/** An entity marker's size, as a part of the window's height */
const MARKER_SIZE = 0.032

/** A prop's model (brush entities' "*N" aren't) */
const propModel = (entity) =>
    entity.model && !entity.model.startsWith("*") ? entity.model : null

/** More edges than this (like ivy's leaves) are outlined as a box instead */
const MAX_OUTLINE_EDGES = 3000

/** The 12 edges of a box, as line segments */
function boxEdges(box) {
    const { min, max } = box
    const corner = (i) => [
        i & 1 ? max.x : min.x,
        i & 2 ? max.y : min.y,
        i & 4 ? max.z : min.z,
    ]
    const points = []
    for (let i = 0; i < 8; i++) {
        for (const bit of [1, 2, 4]) {
            if (!(i & bit)) points.push(...corner(i), ...corner(i | bit))
        }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3))
    return geometry
}

/** A model file's name, as the converter names its object in the OBJ */
const modelBaseName = (model) =>
    model
        .replace(/\\/g, "/")
        .split("/")
        .pop()
        .replace(/\.[^.]*$/, "")
        .toLowerCase()

/**
 * Outline the props behind the surface in a loaded model: the mesh of each
 * (the OBJ names a prop's mesh after its model) nearest to its origin
 * @returns {{outlined: Set<number>, remove: Function}} the entities outlined
 *   (by index), and a function that takes the outlines off
 */
function outlineProps(object, entities) {
    const meshes = []
    object.traverse((child) => {
        if (child.isMesh) meshes.push(child)
    })
    const centerOf = new Map(
        meshes.map((mesh) => {
            mesh.geometry.computeBoundingBox()
            return [mesh, mesh.geometry.boundingBox.getCenter(new THREE.Vector3())]
        }),
    )

    const used = new Set()
    const outlined = new Set()
    const added = []
    entities.forEach((entity, index) => {
        if (!propModel(entity)) return
        const name = modelBaseName(entity.model)
        const origin = new THREE.Vector3(...entity.origin)
        let nearest = null
        for (const mesh of meshes) {
            if (used.has(mesh) || mesh.name.toLowerCase() !== name) continue
            const distance = centerOf.get(mesh).distanceTo(origin)
            if (!nearest || distance < nearest.distance) {
                nearest = { mesh, distance }
            }
        }
        if (!nearest) return
        used.add(nearest.mesh)
        outlined.add(index)
        nearest.mesh.userData.behind = entity

        // A see-through or cut-out texture's edges (like leaves') are its
        // cards', not its shape's: those are outlined as a box
        const seeThrough = [nearest.mesh.material]
            .flat()
            .some((material) => material?.alphaTest > 0 || material?.transparent)
        let edges = seeThrough
            ? null
            : new THREE.EdgesGeometry(nearest.mesh.geometry, 40)
        let lines
        if (!edges || edges.attributes.position.count / 2 > MAX_OUTLINE_EDGES) {
            // A box, dashed: around the prop, not its shape
            edges?.dispose()
            lines = new THREE.LineSegments(
                boxEdges(nearest.mesh.geometry.boundingBox),
                new THREE.LineDashedMaterial({
                    color: BEHIND_COLOR,
                    dashSize: 6,
                    gapSize: 4,
                }),
            )
            lines.computeLineDistances()
        } else {
            lines = new THREE.LineSegments(edges, behindLineMaterial())
        }
        lines.renderOrder = 10
        lines.raycast = () => {}
        nearest.mesh.add(lines)
        added.push(lines)
    })

    const remove = () => {
        for (const lines of added) {
            lines.parent?.remove(lines)
            lines.geometry.dispose()
            lines.material.dispose()
        }
    }
    return { outlined, remove }
}

/** The brushes behind the surface, outlined: each face's edges */
function BrushOutlines({ brushes }) {
    const geometry = useMemo(() => {
        const points = []
        for (const { faces } of brushes) {
            for (const face of faces) {
                face.forEach((point, i) => {
                    points.push(...point, ...face[(i + 1) % face.length])
                })
            }
        }
        const lines = new THREE.BufferGeometry()
        lines.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(points, 3),
        )
        return lines
    }, [brushes])
    const material = useMemo(behindLineMaterial, [])
    useEffect(
        () => () => {
            geometry.dispose()
            material.dispose()
        },
        [geometry, material],
    )
    return (
        <lineSegments
            geometry={geometry}
            material={material}
            renderOrder={10}
            raycast={() => null}
        />
    )
}

/**
 * Draw an entity marker: a thin box with an X across it, like a point
 * entity in an editor (also the key's symbol)
 */
function drawMarker(context, size) {
    const inset = size * 0.08
    const cross = size * 0.27
    context.strokeStyle = BEHIND_CSS
    context.lineCap = "butt"
    context.lineWidth = size * 0.05
    context.strokeRect(inset, inset, size - 2 * inset, size - 2 * inset)
    context.beginPath()
    context.moveTo(cross, cross)
    context.lineTo(size - cross, size - cross)
    context.moveTo(size - cross, cross)
    context.lineTo(cross, size - cross)
    context.stroke()
}

/** The texture of an entity marker */
function useMarkerTexture() {
    const texture = useMemo(() => {
        const canvas = document.createElement("canvas")
        canvas.width = canvas.height = 128
        drawMarker(canvas.getContext("2d"), 128)
        return new THREE.CanvasTexture(canvas)
    }, [])
    useEffect(() => () => texture.dispose(), [texture])
    return texture
}

/**
 * An entity's marker, the same size on screen at any distance, over
 * everything: drawn last, and the pointer finds it first (markersFirst)
 */
function EntityMarker({ entity, texture, onHover }) {
    return (
        <sprite
            position={entity.origin}
            scale={[MARKER_SIZE, MARKER_SIZE, 1]}
            renderOrder={1000}
            userData={{ marker: true }}
            onPointerOver={(e) => {
                e.stopPropagation()
                onHover(entity)
            }}
            onPointerOut={() => onHover(null)}>
            <spriteMaterial
                map={texture}
                sizeAttenuation={false}
                depthTest={false}
                depthWrite={false}
                transparent
            />
        </sprite>
    )
}

/** What the pointer is on, entity markers first (they're drawn over the rest) */
const markersFirst = (hits) => [
    ...hits.filter((hit) => hit.object.userData.marker),
    ...hits.filter((hit) => !hit.object.userData.marker),
]

/**
 * What's behind the surface: the brushes outlined, the props outlined in the
 * model, and a marker for each other entity (or a prop the model doesn't
 * show, like one hidden at the start)
 */
function BehindSurface({ behind, hasModel, model, framedRef, onHover }) {
    const texture = useMarkerTexture()
    const { camera, controls, setEvents } = useThree()

    // The pointer finds entity markers before what's in front of them
    useEffect(() => {
        setEvents({ filter: markersFirst })
        return () => setEvents({ filter: undefined })
    }, [setEvents])
    const [outlined, setOutlined] = useState(new Set())
    // Which props the model shows is known once it's loaded (or there's none)
    const known = !hasModel || Boolean(model)

    useEffect(() => {
        if (!model) return
        pushBackSurfaces(model)
        const props = outlineProps(model, behind.entities)
        setOutlined(props.outlined)
        return props.remove
    }, [model, behind])

    // With no model, the camera is framed on what's behind the surface (once
    // the controls it turns around are there)
    useEffect(() => {
        if (hasModel || framedRef.current || !controls) return
        const box = new THREE.Box3()
        for (const { faces } of behind.brushes) {
            for (const face of faces) {
                for (const point of face) box.expandByPoint(new THREE.Vector3(...point))
            }
        }
        for (const { origin } of behind.entities) {
            box.expandByPoint(new THREE.Vector3(...origin))
        }
        if (box.isEmpty()) return
        frameModel(camera, controls, box.expandByScalar(64))
        framedRef.current = true
    }, [hasModel, behind, camera, controls, framedRef])

    return (
        <>
            <BrushOutlines brushes={behind.brushes} />
            {behind.entities.map((entity, index) =>
                outlined.has(index) || (propModel(entity) && !known) ? null : (
                    <EntityMarker
                        key={index}
                        entity={entity}
                        texture={texture}
                        onHover={onHover}
                    />
                ),
            )}
        </>
    )
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`

/** What each kind of red is, in the key */
const KEY = [
    { kind: "outline", label: "Brush or prop" },
    { kind: "box", label: "Prop with a cut-out texture, like leaves" },
    { kind: "marker", label: "Entity without a model" },
]

/** A key's symbol: an outline (a bent pipe), a dashed box or a marker */
function KeySymbol({ kind }) {
    const ref = useRef(null)
    useEffect(() => {
        if (kind !== "marker") return
        const context = ref.current.getContext("2d")
        context.clearRect(0, 0, 36, 36)
        drawMarker(context, 36)
    }, [kind])
    const size = { width: 18, height: 18, flexShrink: 0 }
    if (kind === "marker") {
        // Drawn at twice its size, for a sharp line
        return <canvas ref={ref} width={36} height={36} style={size} />
    }
    const path =
        kind === "box"
            ? "M1.5 5.5 H10.5 V14.5 H1.5 Z M1.5 5.5 L5.5 1.5 H14.5 V10.5 L10.5 14.5 M10.5 5.5 L14.5 1.5"
            : "M1.5 14.5 V7.5 Q1.5 2.5 6.5 2.5 H14.5 V7.5 H8.5 Q6.5 7.5 6.5 9.5 V14.5 Z"
    return (
        <Box component="svg" viewBox="0 0 16 16" sx={size}>
            <path
                d={path}
                fill="none"
                stroke={BEHIND_CSS}
                strokeWidth="1"
                strokeDasharray={kind === "box" ? "2 1.5" : undefined}
            />
        </Box>
    )
}

/**
 * The panel beside the view: how much is behind the surface, why it
 * matters (as the Instances tab's warning says), and what the reds are
 */
function BehindPanel({ behind, error }) {
    const deepest = Math.max(
        0,
        ...behind.entities.map((entity) => entity.depth),
        ...behind.brushes.map((brush) => brush.depth),
    )
    return (
        <Box
            sx={{
                width: { xs: "100%", sm: 284 },
                flexShrink: 0,
                overflowY: { sm: "auto" },
                display: "flex",
                flexDirection: "column",
                gap: 1.5,
            }}>
            <Box>
                <Typography variant="subtitle1">Behind the surface</Typography>
                <Typography variant="body2" color="text.secondary">
                    What the instance has behind the surface the item is
                    placed on (the grid)
                </Typography>
            </Box>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                <Chip
                    size="small"
                    label={plural(behind.entities.length, "entity", "entities")}
                />
                <Chip
                    size="small"
                    label={plural(behind.brushes.length, "brush", "brushes")}
                />
                <Chip size="small" label={`Up to ${deepest} units`} />
            </Box>
            {behind.entities.length > 0 ? (
                <Alert severity="warning">
                    An entity behind the wall can end up in the void, which
                    makes the map leak.
                </Alert>
            ) : (
                <Alert severity="info">
                    Brushes in the wall are hidden, and don't make the map leak.
                </Alert>
            )}
            <Paper
                variant="outlined"
                sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1 }}>
                {KEY.map(({ kind, label }) => (
                    <Box
                        key={kind}
                        sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <KeySymbol kind={kind} />
                        <Typography variant="body2">{label}</Typography>
                    </Box>
                ))}
            </Paper>
            <Typography variant="body2" color="text.secondary">
                Point at something red to see what it is.
            </Typography>
            {behind.modelError && (
                <Alert severity="info">
                    No model to show: {behind.modelError}
                </Alert>
            )}
            {error && <Alert severity="error">{error}</Alert>}
        </Box>
    )
}

/** What the pointer is on: its tooltip, laid out like the Instances tab's warning */
function BehindTooltipTitle({ entity }) {
    const model = propModel(entity)
    return (
        <Box>
            <Box sx={{ fontWeight: "bold" }}>
                {entity.classname}
                {entity.name ? ` "${entity.name}"` : ""}
            </Box>
            {model && <Box sx={{ opacity: 0.8 }}>{model}</Box>}
            <Box sx={{ mt: 0.5 }}>
                {plural(entity.depth, "unit", "units")} behind the surface
            </Box>
        </Box>
    )
}

// An OBJ model from beep:// URLs. The camera is framed on the first model
// only (framedRef), so switching segments keeps the view.
function Model({ objUrl, mtlUrl, framedRef, onLoad, onError, onHover }) {
    const [model, setModel] = useState(null)
    const { camera, controls } = useThree()
    // The latest of these, without loading the model again when they change
    const latest = useRef({})
    latest.current = { camera, controls, onLoad, onError }

    useEffect(() => {
        if (!objUrl) return
        let cancelled = false

        const loadModel = async () => {
            try {
                const [obj, mtl] = await Promise.all([
                    fetchText(objUrl),
                    mtlUrl
                        ? fetchText(mtlUrl).catch((mtlError) => {
                              console.warn(
                                  `Failed to load MTL ${mtlUrl}, continuing without materials:`,
                                  mtlError,
                              )
                              return null
                          })
                        : null,
                ])
                if (cancelled) return

                // Textures load from next to the MTL. Invisible and see-through
                // materials (the converter marks them in the MTL) show as such,
                // instead of as opaque dark surfaces in their textures' color
                const object = buildObjModel({
                    obj,
                    mtl,
                    baseUrl: mtlUrl
                        ? mtlUrl.substring(0, mtlUrl.lastIndexOf("/") + 1)
                        : "",
                })
                object.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true
                        child.receiveShadow = true
                    }
                })

                const { camera, controls, onLoad } = latest.current
                if (!framedRef.current) {
                    frameModel(camera, controls, object)
                    framedRef.current = true
                }
                setModel(object)
                if (onLoad) onLoad(object)
            } catch (error) {
                if (cancelled) return
                console.error(`Failed to load model ${objUrl}:`, error)
                latest.current.onError?.(error)
            }
        }

        loadModel()
        return () => {
            cancelled = true
        }
    }, [objUrl, mtlUrl, framedRef])

    // Free the model shown before when it's replaced
    useEffect(() => () => disposeModel(model), [model])

    if (!model) return null
    // Hovering a prop behind the surface (outlineProps marks them) says which:
    // the nearest one the pointer is on
    return onHover ? (
        <primitive
            object={model}
            onPointerMove={(e) => {
                e.stopPropagation()
                onHover(e.object.userData.behind ?? null)
            }}
            onPointerOut={() => onHover(null)}
        />
    ) : (
        <primitive object={model} />
    )
}

// Scene setup component. With what an instance has behind its surface
// (behind), the grid is that surface.
function Scene({
    objUrl,
    mtlUrl,
    framedRef,
    onLoad,
    onError,
    behind,
    loadedModel,
    modelFailed,
    onHoverProp,
    onHoverMarker,
}) {
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
            <SimpleGrid position={[0, behind?.surface ?? -64, 0]} />

            {/* Model */}
            {objUrl && (
                <Model
                    objUrl={objUrl}
                    mtlUrl={mtlUrl}
                    framedRef={framedRef}
                    onLoad={onLoad}
                    onError={onError}
                    onHover={behind ? onHoverProp : null}
                />
            )}

            {behind && (
                <BehindSurface
                    behind={behind}
                    hasModel={Boolean(objUrl) && !modelFailed}
                    model={loadedModel}
                    framedRef={framedRef}
                    onHover={onHoverMarker}
                />
            )}

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
    // Whether the camera was framed on a model yet: later models (segments)
    // keep the view
    const framedRef = useRef(false)
    // The model shown, and what behind the surface the pointer is on: an
    // entity's marker, or else a prop
    const [loadedModel, setLoadedModel] = useState(null)
    const [hoveredMarker, setHoveredMarker] = useState(null)
    const [hoveredProp, setHoveredProp] = useState(null)
    const hovered = hoveredMarker ?? hoveredProp

    // Receive model data from main process
    useEffect(() => {
        if (window.package?.onModelPreviewData) {
            window.package.onModelPreviewData((data) => {
                console.log(`Received model preview data for "${data?.title}"`)
                setModelData(data)
                // What's behind a surface can come without a model to load
                setLoading(Boolean(data?.objUrl || data?.segments?.length))
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
    const behind = modelData?.behindSurface ?? null

    const handleLoad = (object) => {
        setLoading(false)
        setLoadedModel(object)
        setInfoText("Model loaded! Left-drag: orbit • Right-drag: pan • Wheel: zoom")
    }

    const handleError = (err) => {
        setLoading(false)
        setError(err.message || "Failed to load model")
    }

    // 3D Canvas
    const canvas = (
        <Canvas
            camera={{ fov: 50, near: 0.1, far: 50000, position: [2, 2, 3] }}
            shadows
            style={{ background: "#1e1e1e" }}
        >
            <Suspense fallback={null}>
                {(objUrl || behind) && (
                    <Scene
                        objUrl={objUrl}
                        mtlUrl={mtlUrl}
                        framedRef={framedRef}
                        onLoad={handleLoad}
                        onError={handleError}
                        behind={behind}
                        loadedModel={loadedModel}
                        modelFailed={Boolean(error)}
                        onHoverProp={setHoveredProp}
                        onHoverMarker={setHoveredMarker}
                    />
                )}
            </Suspense>
        </Canvas>
    )

    // What an instance has behind its surface: the view, with a panel beside
    // it (like the icon maker's), and what the pointer is on in a tooltip
    if (behind) {
        return (
            <Box
                sx={{
                    height: "100vh",
                    boxSizing: "border-box",
                    display: "flex",
                    flexDirection: { xs: "column", sm: "row" },
                    gap: 3,
                    p: 3,
                    bgcolor: "background.default",
                    color: "text.primary",
                }}>
                <Box
                    sx={{
                        flex: 1,
                        minWidth: 0,
                        minHeight: 0,
                        display: "flex",
                        flexDirection: "column",
                    }}>
                    <Tooltip
                        open={Boolean(hovered)}
                        title={
                            hovered ? <BehindTooltipTitle entity={hovered} /> : ""
                        }
                        followCursor
                        disableInteractive
                        placement="bottom-start"
                        slotProps={{
                            popper: {
                                modifiers: [
                                    { name: "offset", options: { offset: [12, 12] } },
                                ],
                            },
                        }}>
                        <Box
                            sx={{
                                flex: 1,
                                minHeight: 0,
                                position: "relative",
                                overflow: "hidden",
                                border: "1px solid #555",
                            }}>
                            {canvas}
                            {loading && (
                                <Box
                                    sx={{
                                        position: "absolute",
                                        inset: 0,
                                        display: "flex",
                                        flexDirection: "column",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: 1,
                                        bgcolor: "rgba(0,0,0,0.45)",
                                    }}>
                                    <CircularProgress />
                                    <Typography variant="body2">
                                        Loading the model...
                                    </Typography>
                                </Box>
                            )}
                        </Box>
                    </Tooltip>
                    <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ mt: 0.5 }}>
                        Left-drag: rotate • Right-drag: move • Wheel: zoom
                    </Typography>
                </Box>
                <BehindPanel behind={behind} error={error} />
            </Box>
        )
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

            {canvas}
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
