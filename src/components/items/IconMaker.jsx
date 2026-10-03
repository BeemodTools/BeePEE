import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Canvas, useThree } from "@react-three/fiber"
import { ContactShadows, OrbitControls } from "@react-three/drei"
import * as THREE from "three"
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControlLabel,
    MenuItem,
    Select,
    Slider,
    Switch,
    TextField,
    ToggleButton,
    ToggleButtonGroup,
    Typography,
} from "@mui/material"
import { RestartAlt } from "@mui/icons-material"
import { buildObjModel, disposeModel } from "../../utils/objModel"

/** The palette icons' grayish white background */
export const ICON_BACKGROUND = "#E5E8E9"

const ICON_SIZES = [64, 128, 256]

/** Directions the camera looks at the model from: the editor's icons use the 3/4 view */
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

/** The view's size on screen; rendered at twice that and scaled down */
const VIEW_SIZE = 512

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
 * @param {number[]} direction - From the model towards the camera
 * @param {number} fov - The camera's field of view in degrees
 */
function frameModel(points, direction, fov) {
    const back = new THREE.Vector3(...direction).normalize()
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

    // Back far enough for every vertex to be in the frame
    const slope = Math.tan(THREE.MathUtils.degToRad(fov) / 2) * FILL
    let distance = 0
    for (let i = 0; i < points.length; i += 3) {
        const across = Math.max(
            Math.abs(along(right, i) - middle[0]),
            Math.abs(along(up, i) - middle[1]),
        )
        distance = Math.max(
            distance,
            along(back, i) - middle[2] + across / slope,
        )
    }
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

/** The model, lights and camera framing, and taking the icon */
function IconScene({
    onReady,
    model,
    view,
    viewKey,
    fov,
    shadow,
    background,
    captureRef,
}) {
    const { camera, gl, scene, controls } = useThree()
    const bounds = useMemo(() => {
        const box = new THREE.Box3().setFromObject(model)
        const sphere = box.getBoundingSphere(new THREE.Sphere())
        return { sphere, floor: box.min.y, points: modelPoints(model) }
    }, [model])
    // The lens, for framing (changing it alone doesn't frame the model again)
    const fovRef = useRef(fov)
    fovRef.current = fov

    // Frame the model from the view (when it's picked, or Reset Camera)
    useEffect(() => {
        camera.fov = fovRef.current
        const { target, position, distance } = frameModel(
            bounds.points,
            VIEWS[view].direction,
            camera.fov,
        )
        camera.position.copy(position)
        camera.near = distance / 100
        camera.far = distance * 10
        camera.updateProjectionMatrix()
        if (controls) {
            controls.target.copy(target)
            controls.update()
        }
    }, [bounds, view, viewKey, camera, controls])

    // A wider or narrower lens keeps the model the same size in the frame
    useEffect(() => {
        if (camera.fov === fov) return
        const target = controls?.target ?? bounds.sphere.center
        const offset = camera.position.clone().sub(target)
        const before = Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2)
        const after = Math.sin(THREE.MathUtils.degToRad(fov) / 2)
        camera.position.copy(target).addScaledVector(offset, before / after)
        camera.fov = fov
        camera.updateProjectionMatrix()
        controls?.update()
    }, [fov, camera, controls, bounds])

    useEffect(() => {
        captureRef.current = (size) => {
            gl.render(scene, camera)
            return scaleDown(gl.domElement, size)
        }
        // The canvas is made after the dialog: say when it can take icons
        const frame = requestAnimationFrame(() => onReady?.())
        return () => cancelAnimationFrame(frame)
    }, [gl, scene, camera, captureRef, onReady])

    const { center, radius } = bounds.sphere
    return (
        <>
            <color attach="background" args={[background]} />
            <hemisphereLight args={["#ffffff", "#9aa1a6", 1.1]} />
            <directionalLight position={[2, 4, 3]} intensity={1.2} />
            <directionalLight position={[-3, 1, -2]} intensity={0.35} />
            <primitive object={model} />
            {shadow && (
                <ContactShadows
                    key={model.uuid}
                    position={[
                        center.x,
                        bounds.floor - radius * 0.002,
                        center.z,
                    ]}
                    scale={radius * 4}
                    far={radius * 2}
                    blur={2.5}
                    opacity={0.45}
                    resolution={512}
                    frames={1}
                />
            )}
        </>
    )
}

/**
 * Make an item's palette icon: generate one of its instances' model, line up
 * the shot, and use the render as the icon
 * @param {{open: boolean, item: Object, currentIcon?: string, onClose: () => void, onIconMade: (filePath: string, fileName: string) => void}} props
 */
export default function IconMaker({
    open,
    item,
    currentIcon,
    onClose,
    onIconMade,
}) {
    const instances = useMemo(
        () =>
            Object.entries(item?.instances ?? {})
                .filter(([, instance]) => instance?.Name)
                .map(([key, instance]) => ({
                    key,
                    name: instance.Name.split(/[\\/]/).pop(),
                })),
        [item],
    )
    const [instanceKey, setInstanceKey] = useState(null)
    const [model, setModel] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [view, setView] = useState(DEFAULT_VIEW)
    const [viewKey, setViewKey] = useState(0)
    const [fov, setFov] = useState(DEFAULT_FOV)
    const [shadow, setShadow] = useState(true)
    const [background, setBackground] = useState(ICON_BACKGROUND)
    const [size, setSize] = useState(64)
    const [preview, setPreview] = useState(null)
    const [saving, setSaving] = useState(false)
    const captureRef = useRef(null)

    useEffect(() => {
        if (open) setInstanceKey(instances[0]?.key ?? null)
    }, [open, instances])

    // Generate the instance's model
    useEffect(() => {
        if (!open || instanceKey === null) return
        let cancelled = false
        setLoading(true)
        setError(null)
        setPreview(null)
        window.package
            .generateIconModel(item.id, instanceKey)
            .then((result) => {
                if (cancelled) return
                if (!result?.success)
                    throw new Error(result?.error ?? "No model")
                setModel(buildObjModel(result))
            })
            .catch((err) => {
                if (cancelled) return
                console.error(
                    `Failed to make the icon model of "${item.name}":`,
                    err,
                )
                setError(err.message)
                setModel(null)
            })
            .finally(() => !cancelled && setLoading(false))
        return () => {
            cancelled = true
        }
    }, [open, instanceKey, item])

    useEffect(() => () => disposeModel(model), [model])

    const updatePreview = useCallback(() => {
        if (captureRef.current) setPreview(captureRef.current(size))
    }, [size])

    // The preview follows the settings (after the view is drawn)
    useEffect(() => {
        if (!model) return
        const frame = requestAnimationFrame(() =>
            requestAnimationFrame(updatePreview),
        )
        return () => cancelAnimationFrame(frame)
    }, [model, view, viewKey, fov, shadow, background, updatePreview])

    const handleUse = async () => {
        if (!captureRef.current) return
        setSaving(true)
        try {
            const png = captureRef
                .current(size)
                .replace(/^data:image\/png;base64,/, "")
            const result = await window.package.saveMadeIcon(item.id, png)
            if (!result?.success) throw new Error(result?.error ?? "Not saved")
            console.log(
                `Made a ${size}x${size} icon for "${item.name}" (${VIEWS[view].label} view)`,
            )
            onIconMade(result.filePath, result.fileName)
            onClose()
        } catch (err) {
            console.error(`Failed to save the icon of "${item.name}":`, err)
            setError(err.message)
        } finally {
            setSaving(false)
        }
    }

    // Picking a view (again) frames the model from it
    const pickView = (key) => {
        if (!key) return
        setView(key)
        setViewKey((value) => value + 1)
    }

    // Back to the default shot, undoing any rotating, moving and zooming
    const resetCamera = () => {
        setFov(DEFAULT_FOV)
        pickView(DEFAULT_VIEW)
    }

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth={false}
            PaperProps={{ sx: { bgcolor: "#1e1e1e", color: "white" } }}>
            <DialogTitle>Make Icon: {item?.name}</DialogTitle>
            <DialogContent sx={{ display: "flex", gap: 3 }}>
                <Box>
                    <Box
                        sx={{
                            width: VIEW_SIZE,
                            height: VIEW_SIZE,
                            position: "relative",
                            border: "1px solid #555",
                            bgcolor: background,
                        }}>
                        {model && (
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
                                <IconScene
                                    onReady={updatePreview}
                                    model={model}
                                    view={view}
                                    viewKey={viewKey}
                                    fov={fov}
                                    shadow={shadow}
                                    background={background}
                                    captureRef={captureRef}
                                />
                                <OrbitControls
                                    makeDefault
                                    onEnd={updatePreview}
                                />
                            </Canvas>
                        )}
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
                                    Generating the model...
                                </Typography>
                            </Box>
                        )}
                    </Box>
                    <Typography variant="caption" color="text.secondary">
                        Left-drag: rotate • Right-drag: move • Wheel: zoom
                    </Typography>
                </Box>

                <Box
                    sx={{
                        width: 260,
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                    }}>
                    {instances.length === 0 ? (
                        <Alert severity="info">
                            Add an instance to the item first.
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
                        </Box>
                    )}

                    <Box>
                        <Typography variant="body2" color="text.secondary">
                            View
                        </Typography>
                        {/* Clicking the current view again lines it up again */}
                        <ToggleButtonGroup size="small" exclusive value={view}>
                            {Object.entries(VIEWS).map(([key, { label }]) => (
                                <ToggleButton
                                    key={key}
                                    value={key}
                                    onClick={() => pickView(key)}>
                                    {label}
                                </ToggleButton>
                            ))}
                        </ToggleButtonGroup>
                        <Button
                            size="small"
                            startIcon={<RestartAlt />}
                            onClick={resetCamera}
                            disabled={!model}
                            sx={{ display: "flex", mt: 1 }}>
                            Reset Camera
                        </Button>
                    </Box>

                    <Box>
                        <Typography variant="body2" color="text.secondary">
                            Lens: {fov}°
                        </Typography>
                        <Slider
                            size="small"
                            min={10}
                            max={60}
                            value={fov}
                            onChange={(e, value) => setFov(value)}
                        />
                    </Box>

                    <FormControlLabel
                        control={
                            <Switch
                                checked={shadow}
                                onChange={(e) => setShadow(e.target.checked)}
                            />
                        }
                        label="Shadow"
                    />

                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
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
                    </Box>
                    {background.toLowerCase() !==
                        ICON_BACKGROUND.toLowerCase() && (
                        <Button
                            size="small"
                            onClick={() => setBackground(ICON_BACKGROUND)}>
                            Use the editor's background
                        </Button>
                    )}

                    <Box>
                        <Typography variant="body2" color="text.secondary">
                            Size
                        </Typography>
                        <ToggleButtonGroup
                            size="small"
                            exclusive
                            value={size}
                            onChange={(e, value) => value && setSize(value)}>
                            {ICON_SIZES.map((value) => (
                                <ToggleButton key={value} value={value}>
                                    {value}
                                </ToggleButton>
                            ))}
                        </ToggleButtonGroup>
                    </Box>

                    <Box>
                        <Typography variant="body2" color="text.secondary">
                            Icon
                        </Typography>
                        <Box
                            sx={{
                                display: "flex",
                                gap: 2,
                                alignItems: "flex-end",
                                mt: 1,
                            }}>
                            {[
                                ["Now", currentIcon],
                                ["New", preview],
                            ].map(([label, src]) => (
                                <Box key={label} sx={{ textAlign: "center" }}>
                                    <Box
                                        sx={{
                                            width: 96,
                                            height: 96,
                                            border: "1px solid #555",
                                            bgcolor: "#2d2d2d",
                                        }}>
                                        {src && (
                                            <img
                                                src={src}
                                                alt={`${label} icon`}
                                                width={96}
                                                height={96}
                                            />
                                        )}
                                    </Box>
                                    <Typography
                                        variant="caption"
                                        color="text.secondary">
                                        {label}
                                    </Typography>
                                </Box>
                            ))}
                        </Box>
                    </Box>

                    {error && <Alert severity="error">{error}</Alert>}
                </Box>
            </DialogContent>
            <DialogActions>
                <Button
                    onClick={onClose}
                    sx={{ color: "rgba(255,255,255,0.6)" }}>
                    Cancel
                </Button>
                <Button
                    variant="contained"
                    onClick={handleUse}
                    disabled={!model || loading || saving}>
                    Use as Icon
                </Button>
            </DialogActions>
        </Dialog>
    )
}
