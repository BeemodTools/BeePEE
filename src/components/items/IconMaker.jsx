import { useEffect, useMemo, useRef, useState } from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"
import * as THREE from "three"
import {
    Alert,
    Box,
    Button,
    Chip,
    CircularProgress,
    Collapse,
    FormControlLabel,
    IconButton,
    MenuItem,
    Select,
    Slider,
    Switch,
    TextField,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
    Typography,
} from "@mui/material"
import { ExpandLess, ExpandMore, RestartAlt, Save } from "@mui/icons-material"
import { buildObjModel, disposeModel } from "../../utils/objModel"
import GroundShadow from "./GroundShadow"

/** The palette icons' grayish white background (RGB 229, 233, 233) */
export const ICON_BACKGROUND = "#E5E9E9"

const ICON_SIZES = [128, 256, 512]
const DEFAULT_SIZE = 256

/** Directions the camera looks at the model from (the palette icons' own shot is the Palette preset) */
const VIEWS = {
    angle: { label: "3/4", direction: [1, 0.85, 1] },
    front: { label: "Front", direction: [0, 0.12, 1] },
    side: { label: "Side", direction: [1, 0.12, 0] },
    top: { label: "Top", direction: [0.0001, 1, 0.0001] },
}

/** The shot Reset Camera goes back to */
const DEFAULT_VIEW = "angle"
const DEFAULT_FOV = 30

/** How much of the frame the model fills when framed, like the editor's icons */
const FILL = 0.85

/** The icon is drawn at this size (whatever the view's size on screen) and scaled down */
const CAPTURE_SIZE = 1024

/** A setting's name with a button on its right */
const HEADING_ROW = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 30,
}

/** Where camera presets are kept (the app's settings: shared by all items) */
const PRESETS_SETTING = "iconMakerCameraPresets"

/**
 * Shots that are always there, before the saved ones. Palette is how the
 * editor's palette icons are taken (like Konclan's Blender icon renderer for
 * BEEmod): isometric, 30° down and 30° off the item's front. That renderer's
 * camera angles (60 0 330) are in the decompiled model's axes, a quarter turn
 * from the instance's.
 */
const BUILT_IN_PRESETS = [
    {
        name: "Palette",
        description:
            "The palette icons' shot: isometric, 30° down and 30° off the front",
        projection: "iso",
        fov: DEFAULT_FOV,
        roll: 0,
        yaw: 60,
        pitch: 30,
        distance: 1,
        offset: [0, 0, 0],
    },
]

/** Pitch stops short of straight up or down, where the camera can't aim */
const MAX_PITCH = 89.9

/** The model's rotation fields: like an instance's angles in Hammer */
const MODEL_ANGLES = ["Pitch", "Yaw", "Roll"]

/** An angle in degrees as one over -180 up to 180 */
function wrapAngle(angle) {
    return angle - 360 * Math.ceil((angle - 180) / 360)
}

const radians = THREE.MathUtils.degToRad
const degrees = THREE.MathUtils.radToDeg

/** The direction from the target to the camera, for a yaw and pitch in degrees */
function directionOf(yaw, pitch) {
    const y = radians(yaw)
    const p = radians(pitch)
    return new THREE.Vector3(
        Math.cos(p) * Math.sin(y),
        Math.sin(p),
        Math.cos(p) * Math.cos(y),
    )
}

/** The yaw and pitch (degrees) of a direction from the target to the camera */
function anglesOf(direction) {
    const d = direction.clone().normalize()
    return {
        yaw: degrees(Math.atan2(d.x, d.z)),
        pitch: degrees(Math.asin(THREE.MathUtils.clamp(d.y, -1, 1))),
    }
}

/** The model's vertex positions (in the scene), for framing it */
function modelPoints(model) {
    const points = []
    const point = new THREE.Vector3()
    model.updateWorldMatrix(true, true)
    model.traverse((child) => {
        const positions = child.isMesh && child.geometry.attributes.position
        if (!positions) return
        for (let i = 0; i < positions.count; i++) {
            point
                .fromBufferAttribute(positions, i)
                .applyMatrix4(child.matrixWorld)
            points.push(point.x, point.y, point.z)
        }
    })
    return points
}

/**
 * Where the camera goes to look at the model from a direction: centered, the
 * model filling FILL of the (square) frame
 * @param {number[]} points - x, y, z of the model's vertices (modelPoints)
 * @param {THREE.Vector3} direction - From the model towards the camera
 * @param {number} fov - The camera's field of view in degrees
 * @param {boolean} isometric - Framed for the isometric view, where nearer
 *   parts don't look bigger
 */
function frameModel(points, direction, fov, isometric = false) {
    const back = direction.clone().normalize()
    if (points.length === 0) {
        return {
            target: new THREE.Vector3(),
            position: back.clone().multiplyScalar(100),
            distance: 100,
        }
    }
    // The camera's axes, as it'll look at the model (up stays up)
    const axes = new THREE.Matrix4().lookAt(
        back,
        new THREE.Vector3(),
        new THREE.Vector3(0, 1, 0),
    )
    const right = new THREE.Vector3().setFromMatrixColumn(axes, 0)
    const up = new THREE.Vector3().setFromMatrixColumn(axes, 1)
    const along = (axis, i) =>
        points[i] * axis.x + points[i + 1] * axis.y + points[i + 2] * axis.z

    // Centered on the model's extent across the frame and along the view
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < points.length; i += 3) {
        ;[right, up, back].forEach((axis, a) => {
            const value = along(axis, i)
            min[a] = Math.min(min[a], value)
            max[a] = Math.max(max[a], value)
        })
    }
    const middle = min.map((value, a) => (value + max[a]) / 2)
    const target = new THREE.Vector3()
        .addScaledVector(right, middle[0])
        .addScaledVector(up, middle[1])
        .addScaledVector(back, middle[2])

    // Back far enough for every vertex to be in the frame (isometric: the
    // frame's size at the target is what counts, see aimCamera)
    const slope = Math.tan(radians(fov) / 2) * FILL
    let distance = 0
    for (let i = 0; i < points.length; i += 3) {
        const across = Math.max(
            Math.abs(along(right, i) - middle[0]),
            Math.abs(along(up, i) - middle[1]),
        )
        const depth = isometric ? 0 : along(back, i) - middle[2]
        distance = Math.max(distance, depth + across / slope)
    }
    distance = Math.max(distance, 1e-3)
    return {
        target,
        position: target.clone().addScaledVector(back, distance),
        distance,
    }
}

/**
 * An image of a canvas at `size` x `size`, scaled down in halves for smooth
 * edges
 * @returns {string} A PNG data URL
 */
function scaleDown(source, size) {
    let image = source
    while (image.width / 2 >= size) {
        const half = document.createElement("canvas")
        half.width = Math.round(image.width / 2)
        half.height = Math.round(image.height / 2)
        const context = half.getContext("2d")
        context.imageSmoothingQuality = "high"
        context.drawImage(image, 0, 0, half.width, half.height)
        image = half
    }
    const icon = document.createElement("canvas")
    icon.width = size
    icon.height = size
    const context = icon.getContext("2d")
    context.imageSmoothingQuality = "high"
    context.drawImage(image, 0, 0, size, size)
    return icon.toDataURL("image/png")
}

/**
 * The model, lights and camera, and taking the icon. The orbit controls move
 * a perspective camera; the isometric view is an orthographic camera that
 * follows it (its frame at the target as big as the perspective one's), so
 * rotating, moving and zooming work the same in both.
 * rigRef gets the camera's controls for the window: frame, read, move,
 * presetOf, applyPreset and report.
 * angles turns the model: Hammer's pitch, yaw and roll, in degrees.
 */
function IconScene({
    model,
    angles,
    projection,
    fov,
    roll,
    shadow,
    background,
    framedRef,
    rigRef,
    captureRef,
    onCameraChange,
}) {
    const { camera, gl, scene, controls, size } = useThree()
    const [modelPitch, modelYaw, modelRoll] = angles
    const bounds = useMemo(() => {
        // Turned like an instance with these angles in Hammer, around its
        // origin. The scene has Hammer's axes with Z up as Y (x, z, -y): yaw
        // turns around Y, pitch around -Z and roll around X, in Hammer's order.
        model.rotation.set(
            radians(modelRoll),
            radians(modelYaw),
            -radians(modelPitch),
            "YZX",
        )
        const points = modelPoints(model)
        const box = new THREE.Box3().setFromArray(points)
        const sphere = box.getBoundingSphere(new THREE.Sphere())
        return {
            sphere,
            points,
            // Where the shadow goes: under the middle, at the bottom
            ground: [
                sphere.center.x,
                box.min.y - sphere.radius * 0.002,
                sphere.center.z,
            ],
        }
    }, [model, modelPitch, modelYaw, modelRoll])
    const isometricCamera = useMemo(() => new THREE.OrthographicCamera(), [])

    // The latest props, for the render loop and the rig
    const latest = useRef({})
    latest.current = {
        projection,
        roll,
        bounds,
        controls,
        size,
        onCameraChange,
    }

    const targetOf = () =>
        latest.current.controls?.target ?? latest.current.bounds.sphere.center

    /** Aim the camera (rolled) and get the one to draw with */
    const aimCamera = () => {
        const { projection, roll, bounds, size } = latest.current
        const target = targetOf()
        camera.lookAt(target)
        if (roll) camera.rotateZ(-radians(roll))
        const distance = camera.position.distanceTo(target)
        const reach = distance + bounds.sphere.radius * 4
        camera.near = Math.max(distance / 100, 1e-3)
        camera.far = reach * 2
        camera.updateProjectionMatrix()
        if (projection !== "iso") return camera

        const half = distance * Math.tan(radians(camera.fov) / 2)
        const aspect = size.width / size.height
        isometricCamera.left = -half * aspect
        isometricCamera.right = half * aspect
        isometricCamera.top = half
        isometricCamera.bottom = -half
        isometricCamera.near = -reach
        isometricCamera.far = reach
        isometricCamera.position.copy(camera.position)
        isometricCamera.quaternion.copy(camera.quaternion)
        isometricCamera.updateProjectionMatrix()
        isometricCamera.updateMatrixWorld()
        return isometricCamera
    }

    // Drawn here (after the orbit controls moved the camera), with the
    // projection picked
    useFrame(() => {
        gl.render(scene, aimCamera())
    }, 1)

    /** Where the camera is, for the window's fields */
    const read = () => {
        const target = targetOf().clone()
        const offset = camera.position.clone().sub(target)
        return {
            position: camera.position.toArray(),
            target: target.toArray(),
            distance: offset.length(),
            ...anglesOf(offset),
        }
    }

    // Tell the window where the camera is, once a frame at most
    const pendingReport = useRef(0)
    const report = () => {
        if (pendingReport.current) return
        pendingReport.current = requestAnimationFrame(() => {
            pendingReport.current = 0
            latest.current.onCameraChange?.(read())
        })
    }
    useEffect(
        () => () => {
            cancelAnimationFrame(pendingReport.current)
            pendingReport.current = 0
        },
        [],
    )

    const place = (target, position) => {
        camera.position.copy(position)
        latest.current.controls?.target.copy(target)
        latest.current.controls?.update()
        report()
    }

    /** Line the model up from a direction (the views, Reset Camera) */
    const frame = (direction, options = {}) => {
        const shotFov = options.fov ?? camera.fov
        const isometric =
            (options.projection ?? latest.current.projection) === "iso"
        const { target, position } = frameModel(
            latest.current.bounds.points,
            direction,
            shotFov,
            isometric,
        )
        camera.fov = shotFov
        camera.updateProjectionMatrix()
        place(target, position)
    }

    /** Move the camera: to a position, or by yaw, pitch and distance */
    const move = (changes) => {
        const now = read()
        const target = new THREE.Vector3(...(changes.target ?? now.target))
        let position
        if (changes.position) {
            position = new THREE.Vector3(...changes.position)
        } else if (changes.target) {
            // Looking at another point from where it is
            position = new THREE.Vector3(...now.position)
        } else {
            const pitch = THREE.MathUtils.clamp(
                changes.pitch ?? now.pitch,
                -MAX_PITCH,
                MAX_PITCH,
            )
            const distance = Math.max(changes.distance ?? now.distance, 1e-3)
            position = target
                .clone()
                .addScaledVector(
                    directionOf(changes.yaw ?? now.yaw, pitch),
                    distance,
                )
        }
        place(target, position)
    }

    // A preset is kept relative to the model's framing from its direction,
    // so it gives the same shot on any item
    const presetOf = (name) => {
        const { projection, roll } = latest.current
        const { yaw, pitch, distance, target } = read()
        const framed = frameModel(
            latest.current.bounds.points,
            directionOf(yaw, pitch),
            camera.fov,
            projection === "iso",
        )
        const offset = new THREE.Vector3(...target)
            .sub(framed.target)
            .divideScalar(framed.distance)
        return {
            name,
            projection,
            fov: camera.fov,
            roll,
            yaw,
            pitch,
            distance: distance / framed.distance,
            offset: offset.toArray(),
        }
    }

    const applyPreset = (preset) => {
        const direction = directionOf(preset.yaw, preset.pitch)
        const framed = frameModel(
            latest.current.bounds.points,
            direction,
            preset.fov,
            preset.projection === "iso",
        )
        const target = framed.target
            .clone()
            .addScaledVector(
                new THREE.Vector3(...(preset.offset ?? [0, 0, 0])),
                framed.distance,
            )
        camera.fov = preset.fov
        camera.updateProjectionMatrix()
        place(
            target,
            target
                .clone()
                .addScaledVector(direction, preset.distance * framed.distance),
        )
    }

    useEffect(() => {
        rigRef.current = { frame, read, move, presetOf, applyPreset, report }
    })
    useEffect(() => () => (rigRef.current = null), [rigRef])

    // Line up the first model; the next ones (other instances) keep the
    // camera where it is. Waits for the controls, which hold the target.
    useEffect(() => {
        if (framedRef.current || !controls) return
        framedRef.current = true
        frame(new THREE.Vector3(...VIEWS[DEFAULT_VIEW].direction))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bounds, controls, framedRef])

    // Turning the model lines it up again, from where the camera looks
    const turnedTo = useRef(angles.join(" "))
    useEffect(() => {
        const turn = angles.join(" ")
        if (turnedTo.current === turn || !controls) return
        turnedTo.current = turn
        const now = read()
        frame(directionOf(now.yaw, now.pitch))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [modelPitch, modelYaw, modelRoll, controls])

    // Fill in the window's camera fields once the scene is up. Also needed
    // after StrictMode's unmount and mount again in development: that
    // cancels the report the first lining up made, and doesn't line up again.
    useEffect(() => {
        if (controls) report()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [controls])

    // A wider or narrower lens keeps the model the same size in the frame
    useEffect(() => {
        if (camera.fov === fov) return
        const target = targetOf()
        const offset = camera.position.clone().sub(target)
        const before = Math.sin(radians(camera.fov) / 2)
        const after = Math.sin(radians(fov) / 2)
        camera.position.copy(target).addScaledVector(offset, before / after)
        camera.fov = fov
        camera.updateProjectionMatrix()
        controls?.update()
        report()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fov, camera, controls])

    useEffect(() => {
        captureRef.current = (iconSize) => {
            // Drawn at CAPTURE_SIZE: the view is square like the icon, but
            // how big it is depends on the window
            const shown = gl.getSize(new THREE.Vector2())
            const pixelRatio = gl.getPixelRatio()
            gl.setPixelRatio(1)
            gl.setSize(CAPTURE_SIZE, CAPTURE_SIZE, false)
            gl.render(scene, aimCamera())
            const icon = scaleDown(gl.domElement, iconSize)
            gl.setPixelRatio(pixelRatio)
            gl.setSize(shown.x, shown.y, false)
            gl.render(scene, aimCamera())
            return icon
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gl, scene, camera, captureRef])

    const { radius } = bounds.sphere
    return (
        <>
            <color attach="background" args={[background]} />
            <hemisphereLight args={["#ffffff", "#9aa1a6", 1.1]} />
            <directionalLight position={[2, 4, 3]} intensity={1.2} />
            <directionalLight position={[-3, 1, -2]} intensity={0.35} />
            <primitive object={model} />
            {shadow && (
                <GroundShadow
                    key={model.uuid}
                    position={bounds.ground}
                    size={radius * 4}
                    far={radius * 2}
                />
            )}
        </>
    )
}

/**
 * A number field that applies what's typed as soon as it's a number (and
 * shows the actual value again when it loses focus)
 */
function NumberField({ label, value, onCommit, digits = 1, disabled }) {
    const [text, setText] = useState("")
    const [editing, setEditing] = useState(false)
    const shown = Number.isFinite(value) ? value.toFixed(digits) : ""
    return (
        <TextField
            size="small"
            type="number"
            label={label}
            disabled={disabled}
            value={editing ? text : shown}
            onFocus={() => {
                setText(shown)
                setEditing(true)
            }}
            onBlur={() => setEditing(false)}
            onChange={(e) => {
                setText(e.target.value)
                const number = parseFloat(e.target.value)
                if (Number.isFinite(number)) onCommit(number)
            }}
            slotProps={{ htmlInput: { step: 1 } }}
            sx={{ flex: 1, minWidth: 0 }}
        />
    )
}

/** X, Y and Z fields for a point */
function PointFields({ label, point, onCommit, disabled }) {
    return (
        <Box>
            <Typography variant="caption" color="text.secondary">
                {label}
            </Typography>
            <Box sx={{ display: "flex", gap: 1, mt: 0.5 }}>
                {["X", "Y", "Z"].map((axis, i) => (
                    <NumberField
                        key={axis}
                        label={axis}
                        value={point?.[i]}
                        disabled={disabled}
                        onCommit={(value) => {
                            const next = [...(point ?? [0, 0, 0])]
                            next[i] = value
                            onCommit(next)
                        }}
                    />
                ))}
            </Box>
        </Box>
    )
}

/**
 * Make an item's palette icon: generate its instances' models, line up the
 * shot, and use the render as the icon. Fills its own window
 * (src/pages/IconMakerPage.jsx).
 * @param {{item: {id: string, name: string}, onClose: () => void, onIconMade: (filePath: string, fileName: string) => Promise<void>}} props
 *   onIconMade: hands the icon to the item editor (throws if it can't)
 */
export default function IconMaker({ item, onClose, onIconMade }) {
    // The instances to pick from: those whose VMF exists and has something
    // to draw (null until the backend says), and the ones left out
    const [instances, setInstances] = useState(null)
    const [leftOut, setLeftOut] = useState([])
    const [instanceKey, setInstanceKey] = useState(null)
    const [model, setModel] = useState(null)
    const [loading, setLoading] = useState(false)
    const [generatingAll, setGeneratingAll] = useState(false)
    const [error, setError] = useState(null)
    const [view, setView] = useState(DEFAULT_VIEW)
    const [projection, setProjection] = useState("perspective")
    const [fov, setFov] = useState(DEFAULT_FOV)
    const [roll, setRoll] = useState(0)
    // The model's rotation (pitch, yaw, roll), for whichever instance shows
    const [modelAngles, setModelAngles] = useState([0, 0, 0])
    const [rotationOpen, setRotationOpen] = useState(false)
    // Where the camera is, for the advanced camera fields
    const [cameraFields, setCameraFields] = useState(null)
    const [advancedOpen, setAdvancedOpen] = useState(false)
    const [presets, setPresets] = useState([])
    const [savingPreset, setSavingPreset] = useState(false)
    const [presetName, setPresetName] = useState("")
    const [shadow, setShadow] = useState(true)
    const [background, setBackground] = useState(ICON_BACKGROUND)
    const [size, setSize] = useState(DEFAULT_SIZE)
    const [saving, setSaving] = useState(false)
    const captureRef = useRef(null)
    const rigRef = useRef(null)
    // Whether the camera has been lined up on a model since the window opened
    const framedRef = useRef(false)
    // The instances' models, so switching back to one is instant
    const modelsRef = useRef(new Map())
    const generatedAllRef = useRef(false)

    useEffect(() => {
        if (!item?.id) return
        let cancelled = false
        window.package
            .listIconInstances(item.id)
            .then((result) => {
                if (cancelled) return
                if (!result?.success) {
                    throw new Error(result?.error ?? "No instances")
                }
                setInstances(
                    result.instances.map(({ instanceKey: key, name }) => ({
                        key,
                        name,
                    })),
                )
                setLeftOut(result.leftOut ?? [])
            })
            .catch((err) => {
                if (cancelled) return
                console.error(
                    `Failed to list the instances of "${item.name}":`,
                    err,
                )
                setError(err.message)
                setInstances([])
            })
        return () => {
            cancelled = true
        }
    }, [item])

    // Keep the instance picked, unless it's gone
    useEffect(() => {
        if (!instances) return
        setInstanceKey((key) =>
            instances.some((instance) => instance.key === key)
                ? key
                : (instances[0]?.key ?? null),
        )
    }, [instances])

    // Closing the window frees the models
    useEffect(
        () => () => {
            for (const kept of modelsRef.current.values()) disposeModel(kept)
            modelsRef.current.clear()
        },
        [],
    )

    // The camera presets, kept in the app's settings
    useEffect(() => {
        window.package
            ?.getSetting?.(PRESETS_SETTING)
            .then((result) => {
                if (result?.success && Array.isArray(result.value)) {
                    setPresets(
                        result.value.filter(
                            (preset) => typeof preset?.name === "string",
                        ),
                    )
                }
            })
            .catch((err) =>
                console.warn(
                    "Failed to load the icon maker's camera presets:",
                    err,
                ),
            )
    }, [])

    // Show the instance's model: kept from before, or generated (the
    // backend keeps it too, until the instance's VMF changes)
    useEffect(() => {
        if (instanceKey === null) return
        const kept = modelsRef.current.get(instanceKey)
        if (kept) {
            setModel(kept)
            setError(null)
            return
        }
        let cancelled = false
        setLoading(true)
        setError(null)
        window.package
            .generateIconModel(item.id, instanceKey)
            .then((result) => {
                if (!result?.success)
                    throw new Error(result?.error ?? "No model")
                const built = buildObjModel(result)
                modelsRef.current.set(instanceKey, built)
                if (!cancelled) setModel(built)
            })
            .catch((err) => {
                if (cancelled) return
                console.error(
                    `Failed to make the icon model of "${item.name}" (instance ${instanceKey}):`,
                    err,
                )
                setError(err.message)
                setModel(null)
            })
            .finally(() => !cancelled && setLoading(false))
        return () => {
            cancelled = true
        }
    }, [instanceKey, item])

    // Once a model shows, make the other instances' models in the
    // background, so picking one doesn't wait for it to be generated
    useEffect(() => {
        if (!model || generatedAllRef.current) return
        generatedAllRef.current = true
        if (!instances || instances.length < 2) return
        setGeneratingAll(true)
        window.package
            .generateAllIconModels(item.id)
            .then((result) => {
                if (!result?.success) throw new Error(result?.error)
                const failed = Object.keys(result.failed ?? {})
                if (failed.length > 0) {
                    console.warn(
                        `Couldn't make the icon models of instances ${failed.join(", ")} of "${item.name}"`,
                    )
                }
            })
            .catch((err) =>
                console.warn(
                    `Failed to make the other icon models of "${item.name}":`,
                    err,
                ),
            )
            .finally(() => setGeneratingAll(false))
    }, [model, instances, item])

    const handleUse = async () => {
        if (!captureRef.current) return
        setSaving(true)
        try {
            const png = captureRef
                .current(size)
                .replace(/^data:image\/png;base64,/, "")
            const result = await window.package.saveMadeIcon(item.id, png)
            if (!result?.success) throw new Error(result?.error ?? "Not saved")
            const turned = modelAngles.some((angle) => angle !== 0)
                ? `, model turned ${modelAngles.join(" ")}`
                : ""
            console.log(
                `Made a ${size}x${size} icon for "${item.name}" (instance ${instanceKey}, ${projection === "iso" ? "isometric" : "perspective"}${turned})`,
            )
            await onIconMade(result.filePath, result.fileName)
            onClose()
        } catch (err) {
            console.error(`Failed to save the icon of "${item.name}":`, err)
            setError(err.message)
        } finally {
            setSaving(false)
        }
    }

    // Picking a view (again) lines the model up from it
    const pickView = (key) => {
        if (!key) return
        setView(key)
        setRoll(0)
        rigRef.current?.frame(new THREE.Vector3(...VIEWS[key].direction))
    }

    // Back to the default shot, undoing any rotating, moving and zooming
    const resetCamera = () => {
        setView(DEFAULT_VIEW)
        setRoll(0)
        setFov(DEFAULT_FOV)
        rigRef.current?.frame(
            new THREE.Vector3(...VIEWS[DEFAULT_VIEW].direction),
            {
                fov: DEFAULT_FOV,
            },
        )
    }

    // Switching the projection lines the model up again from the same
    // direction, so it fills the frame the same
    const pickProjection = (value) => {
        if (!value || value === projection) return
        setProjection(value)
        const now = rigRef.current?.read()
        if (now) {
            rigRef.current.frame(directionOf(now.yaw, now.pitch), {
                projection: value,
            })
        }
    }

    const turnModel = (axis, angle) => {
        setModelAngles((angles) =>
            angles.map((value, i) => (i === axis ? angle : value)),
        )
    }

    const moveCamera = (changes) => {
        rigRef.current?.move(changes)
    }

    const savePresets = async (next) => {
        setPresets(next)
        try {
            const result = await window.package.setSetting(
                PRESETS_SETTING,
                next,
            )
            if (result?.success === false) throw new Error(result.error)
        } catch (err) {
            console.error(
                "Failed to save the icon maker's camera presets:",
                err,
            )
            setError(`Couldn't save the presets: ${err.message}`)
        }
    }

    const savePreset = () => {
        const name = presetName.trim()
        if (!name || !rigRef.current) return
        const preset = rigRef.current.presetOf(name)
        savePresets([...presets.filter((p) => p.name !== name), preset])
        console.log(`Saved the icon maker camera preset "${name}"`)
        setSavingPreset(false)
        setPresetName("")
    }

    const applyPreset = (preset) => {
        if (!rigRef.current) return
        setProjection(preset.projection === "iso" ? "iso" : "perspective")
        setFov(preset.fov ?? DEFAULT_FOV)
        setRoll(preset.roll ?? 0)
        rigRef.current.applyPreset({
            ...preset,
            fov: preset.fov ?? DEFAULT_FOV,
        })
    }

    const deletePreset = (name) => {
        savePresets(presets.filter((p) => p.name !== name))
        console.log(`Deleted the icon maker camera preset "${name}"`)
    }

    return (
        <Box
            sx={{
                height: "100vh",
                display: "flex",
                flexDirection: "column",
                bgcolor: "#1e1e1e",
                color: "white",
            }}>
            {/* The view as big as the window lets it be, with the settings
                beside it (under it, in a narrow window) */}
            <Box
                sx={{
                    flex: 1,
                    minHeight: 0,
                    display: "flex",
                    flexDirection: { xs: "column", sm: "row" },
                    gap: 3,
                    p: 3,
                    overflowY: { xs: "auto", sm: "hidden" },
                }}>
                <Box
                    sx={{
                        flex: { xs: "none", sm: 1 },
                        minWidth: 0,
                        minHeight: 0,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        // Its size is the view's room (cqw, cqh)
                        containerType: { sm: "size" },
                    }}>
                    <Box
                        sx={{
                            // Square: as big as the room, less the line under it
                            width: {
                                xs: "100%",
                                sm: "min(100cqw, calc(100cqh - 24px))",
                            },
                            aspectRatio: "1",
                            flexShrink: 0,
                            // Not held open by the canvas when it gets smaller
                            overflow: "hidden",
                            position: "relative",
                            border: "1px solid #555",
                            bgcolor: background,
                        }}>
                        <Canvas
                            flat
                            dpr={2}
                            gl={{
                                preserveDrawingBuffer: true,
                                antialias: true,
                            }}
                            camera={{
                                fov: DEFAULT_FOV,
                                position: [1, 1, 1],
                            }}>
                            {model && (
                                <IconScene
                                    model={model}
                                    angles={modelAngles}
                                    projection={projection}
                                    fov={fov}
                                    roll={roll}
                                    shadow={shadow}
                                    background={background}
                                    framedRef={framedRef}
                                    rigRef={rigRef}
                                    captureRef={captureRef}
                                    onCameraChange={setCameraFields}
                                />
                            )}
                            <OrbitControls
                                makeDefault
                                onChange={() => rigRef.current?.report()}
                            />
                        </Canvas>
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
                    <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ mt: 0.5 }}>
                        Left-drag: rotate • Right-drag: move • Wheel: zoom
                    </Typography>
                </Box>

                {/* What doesn't fit (like the advanced camera) scrolls */}
                <Box
                    sx={{
                        width: { xs: "100%", sm: 284 },
                        flexShrink: 0,
                        overflowY: { sm: "auto" },
                        scrollbarGutter: { sm: "stable" },
                        pr: { sm: 1 },
                        display: "flex",
                        flexDirection: "column",
                        gap: 1.5,
                        "&::-webkit-scrollbar": { width: 8 },
                        "&::-webkit-scrollbar-thumb": {
                            backgroundColor: "rgba(255,255,255,0.2)",
                            borderRadius: 4,
                        },
                    }}>
                    {instances === null ? (
                        <Typography variant="body2" color="text.secondary">
                            Finding the instances...
                        </Typography>
                    ) : instances.length === 0 ? (
                        <Alert severity="info">
                            {leftOut.length > 0
                                ? "The item's instances are missing or have nothing to draw."
                                : "Add an instance to the item first."}
                        </Alert>
                    ) : (
                        <Box>
                            <Typography variant="body2" color="text.secondary">
                                Instance
                            </Typography>
                            <Select
                                size="small"
                                fullWidth
                                value={instanceKey ?? ""}
                                onChange={(e) =>
                                    setInstanceKey(e.target.value)
                                }>
                                {instances.map((instance) => (
                                    <MenuItem
                                        key={instance.key}
                                        value={instance.key}>
                                        {instance.key}: {instance.name}
                                    </MenuItem>
                                ))}
                            </Select>
                            {generatingAll && (
                                <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    sx={{ display: "block" }}>
                                    Generating the other instances' models...
                                </Typography>
                            )}
                        </Box>
                    )}

                    <Box>
                        <Box sx={HEADING_ROW}>
                            <Typography variant="body2" color="text.secondary">
                                View
                            </Typography>
                            <Button
                                size="small"
                                startIcon={<RestartAlt />}
                                onClick={resetCamera}
                                disabled={!model}>
                                Reset Camera
                            </Button>
                        </Box>
                        {/* Clicking the current view again lines it up again */}
                        <ToggleButtonGroup
                            size="small"
                            exclusive
                            fullWidth
                            value={view}>
                            {Object.entries(VIEWS).map(([key, { label }]) => (
                                <ToggleButton
                                    key={key}
                                    value={key}
                                    onClick={() => pickView(key)}>
                                    {label}
                                </ToggleButton>
                            ))}
                        </ToggleButtonGroup>
                    </Box>

                    {projection === "perspective" && (
                        <Box
                            sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 2,
                            }}>
                            <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{
                                    whiteSpace: "nowrap",
                                    minWidth: 64,
                                }}>
                                Lens {fov}°
                            </Typography>
                            <Slider
                                size="small"
                                min={10}
                                max={60}
                                value={fov}
                                onChange={(e, value) => setFov(value)}
                                sx={{ flex: 1, mr: 1 }}
                            />
                        </Box>
                    )}

                    <Box>
                        <Box sx={HEADING_ROW}>
                            <Typography variant="body2" color="text.secondary">
                                Camera presets
                            </Typography>
                            {!savingPreset && (
                                <Button
                                    size="small"
                                    startIcon={<Save />}
                                    onClick={() => setSavingPreset(true)}
                                    disabled={!model}>
                                    Save
                                </Button>
                            )}
                        </Box>
                        {savingPreset ? (
                            <Box
                                sx={{
                                    display: "flex",
                                    gap: 1,
                                    mt: 0.5,
                                }}>
                                <TextField
                                    size="small"
                                    autoFocus
                                    label="Preset name"
                                    value={presetName}
                                    onChange={(e) =>
                                        setPresetName(e.target.value)
                                    }
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") savePreset()
                                        if (e.key === "Escape") {
                                            e.stopPropagation()
                                            setSavingPreset(false)
                                        }
                                    }}
                                    sx={{ flex: 1 }}
                                />
                                <Button
                                    size="small"
                                    onClick={savePreset}
                                    disabled={!presetName.trim()}>
                                    Save
                                </Button>
                            </Box>
                        ) : (
                            <Box
                                sx={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: 0.5,
                                }}>
                                {BUILT_IN_PRESETS.map((preset) => (
                                    <Tooltip
                                        key={`built-in:${preset.name}`}
                                        title={preset.description}>
                                        <Chip
                                            label={preset.name}
                                            size="small"
                                            disabled={!model}
                                            onClick={() => applyPreset(preset)}
                                        />
                                    </Tooltip>
                                ))}
                                {presets.map((preset) => (
                                    <Chip
                                        key={`saved:${preset.name}`}
                                        label={preset.name}
                                        size="small"
                                        variant="outlined"
                                        disabled={!model}
                                        onClick={() => applyPreset(preset)}
                                        onDelete={() =>
                                            deletePreset(preset.name)
                                        }
                                    />
                                ))}
                                {presets.length === 0 && (
                                    <Typography
                                        variant="caption"
                                        color="text.secondary"
                                        sx={{ width: "100%" }}>
                                        Save a shot to use it on other items too
                                    </Typography>
                                )}
                            </Box>
                        )}
                    </Box>

                    <Box>
                        <Box sx={HEADING_ROW}>
                            <Button
                                size="small"
                                onClick={() =>
                                    setRotationOpen((value) => !value)
                                }
                                endIcon={
                                    rotationOpen ? (
                                        <ExpandLess />
                                    ) : (
                                        <ExpandMore />
                                    )
                                }>
                                Model rotation
                            </Button>
                            {modelAngles.some((angle) => angle !== 0) && (
                                <Tooltip title="Reset the model's rotation">
                                    <IconButton
                                        size="small"
                                        onClick={() =>
                                            setModelAngles([0, 0, 0])
                                        }>
                                        <RestartAlt fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                            )}
                        </Box>
                        <Collapse in={rotationOpen}>
                            <Box
                                sx={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 1,
                                    mt: 1,
                                }}>
                                <Box sx={{ display: "flex", gap: 1 }}>
                                    {MODEL_ANGLES.map((label, axis) => (
                                        <NumberField
                                            key={label}
                                            label={`${label} °`}
                                            value={modelAngles[axis]}
                                            disabled={!model}
                                            onCommit={(angle) =>
                                                turnModel(axis, angle)
                                            }
                                        />
                                    ))}
                                </Box>
                                <Box sx={{ display: "flex", gap: 1 }}>
                                    {MODEL_ANGLES.map((label, axis) => (
                                        <Button
                                            key={label}
                                            size="small"
                                            variant="outlined"
                                            disabled={!model}
                                            onClick={() =>
                                                turnModel(
                                                    axis,
                                                    wrapAngle(
                                                        modelAngles[axis] + 90,
                                                    ),
                                                )
                                            }
                                            sx={{
                                                flex: 1,
                                                minWidth: 0,
                                            }}>
                                            +90°
                                        </Button>
                                    ))}
                                </Box>
                            </Box>
                        </Collapse>
                    </Box>

                    <Box>
                        <Button
                            size="small"
                            onClick={() => setAdvancedOpen((value) => !value)}
                            endIcon={
                                advancedOpen ? <ExpandLess /> : <ExpandMore />
                            }>
                            Advanced camera
                        </Button>
                        <Collapse in={advancedOpen}>
                            <Box
                                sx={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 1.5,
                                    mt: 1,
                                }}>
                                <ToggleButtonGroup
                                    size="small"
                                    exclusive
                                    fullWidth
                                    value={projection}
                                    disabled={!model}
                                    onChange={(e, value) =>
                                        pickProjection(value)
                                    }>
                                    <ToggleButton value="perspective">
                                        Perspective
                                    </ToggleButton>
                                    <ToggleButton value="iso">
                                        Isometric
                                    </ToggleButton>
                                </ToggleButtonGroup>
                                <Box sx={{ display: "flex", gap: 1 }}>
                                    <NumberField
                                        label="Yaw °"
                                        value={cameraFields?.yaw}
                                        disabled={!model}
                                        onCommit={(yaw) => moveCamera({ yaw })}
                                    />
                                    <NumberField
                                        label="Pitch °"
                                        value={cameraFields?.pitch}
                                        disabled={!model}
                                        onCommit={(pitch) =>
                                            moveCamera({ pitch })
                                        }
                                    />
                                    <NumberField
                                        label="Roll °"
                                        value={roll}
                                        disabled={!model}
                                        onCommit={setRoll}
                                    />
                                </Box>
                                <NumberField
                                    label={
                                        projection === "iso"
                                            ? "Distance (zoom)"
                                            : "Distance"
                                    }
                                    value={cameraFields?.distance}
                                    disabled={!model}
                                    onCommit={(distance) =>
                                        moveCamera({ distance })
                                    }
                                />
                                <PointFields
                                    label="Camera position"
                                    point={cameraFields?.position}
                                    disabled={!model}
                                    onCommit={(position) =>
                                        moveCamera({ position })
                                    }
                                />
                                <PointFields
                                    label="Looks at"
                                    point={cameraFields?.target}
                                    disabled={!model}
                                    onCommit={(target) =>
                                        moveCamera({ target })
                                    }
                                />
                            </Box>
                        </Collapse>
                    </Box>

                    <Box
                        sx={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                        }}>
                        <FormControlLabel
                            control={
                                <Switch
                                    size="small"
                                    checked={shadow}
                                    onChange={(e) =>
                                        setShadow(e.target.checked)
                                    }
                                />
                            }
                            label="Shadow"
                            sx={{ m: 0, gap: 0.5 }}
                        />
                        <Box
                            sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 1,
                            }}>
                            <Typography variant="body2" color="text.secondary">
                                Size
                            </Typography>
                            <ToggleButtonGroup
                                size="small"
                                exclusive
                                value={size}
                                onChange={(e, value) =>
                                    value && setSize(value)
                                }>
                                {ICON_SIZES.map((value) => (
                                    <ToggleButton key={value} value={value}>
                                        {value}
                                    </ToggleButton>
                                ))}
                            </ToggleButtonGroup>
                        </Box>
                    </Box>

                    <Box
                        sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1,
                        }}>
                        <TextField
                            size="small"
                            label="Background"
                            value={background}
                            onChange={(e) => setBackground(e.target.value)}
                            sx={{ flex: 1 }}
                        />
                        <input
                            type="color"
                            value={
                                /^#[0-9a-f]{6}$/i.test(background)
                                    ? background
                                    : ICON_BACKGROUND
                            }
                            onChange={(e) => setBackground(e.target.value)}
                            style={{
                                width: 36,
                                height: 36,
                                border: "none",
                                background: "none",
                            }}
                        />
                        {background.toLowerCase() !==
                            ICON_BACKGROUND.toLowerCase() && (
                            <Tooltip title="Use the editor's background">
                                <IconButton
                                    size="small"
                                    onClick={() =>
                                        setBackground(ICON_BACKGROUND)
                                    }>
                                    <RestartAlt fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        )}
                    </Box>
                </Box>
            </Box>
            <Box
                sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    px: 3,
                    py: 2,
                    borderTop: "1px solid rgba(255,255,255,0.12)",
                }}>
                {error && (
                    <Alert severity="error" sx={{ py: 0, minWidth: 0 }}>
                        {error}
                    </Alert>
                )}
                <Button
                    onClick={onClose}
                    sx={{ ml: "auto", color: "rgba(255,255,255,0.6)" }}>
                    Cancel
                </Button>
                <Button
                    variant="contained"
                    onClick={handleUse}
                    disabled={!model || loading || saving}>
                    Use as Icon
                </Button>
            </Box>
        </Box>
    )
}
