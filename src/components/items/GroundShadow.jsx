import { useEffect, useMemo, useRef } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"
import { HorizontalBlurShader } from "three/examples/jsm/shaders/HorizontalBlurShader.js"
import { VerticalBlurShader } from "three/examples/jsm/shaders/VerticalBlurShader.js"

/**
 * A soft shadow on the ground under a model: the model's depth seen from
 * below, blurred, on a plane. Like drei's ContactShadows, whose blur draws a
 * plane left at the world's origin: anywhere else (under a model off the
 * origin) the blurred shadow came out shifted, or empty.
 * Drawn when it's put down (twice: the first frame may come before
 * everything is in place).
 * @param {{position: number[], size: number, far: number, blur?: number, opacity?: number, resolution?: number}} props
 *   position: the middle of the shadow (the ground's height); size: its
 *   width; far: how high above the ground things still cast a shadow
 */
export default function GroundShadow({
    position,
    size,
    far,
    blur = 2.5,
    opacity = 0.45,
    resolution = 512,
}) {
    const { gl, scene } = useThree()
    const group = useRef(null)
    const parts = useMemo(() => {
        const target = new THREE.WebGLRenderTarget(resolution, resolution)
        const blurTarget = new THREE.WebGLRenderTarget(resolution, resolution)
        target.texture.generateMipmaps = false
        blurTarget.texture.generateMipmaps = false
        const plane = new THREE.PlaneGeometry(size, size).rotateX(Math.PI / 2)
        const blurPlane = new THREE.Mesh(plane)
        // Darker the closer to the ground (drei's depth material)
        const depth = new THREE.MeshDepthMaterial()
        depth.depthTest = false
        depth.depthWrite = false
        depth.onBeforeCompile = (shader) => {
            shader.fragmentShader = shader.fragmentShader.replace(
                "vec4( vec3( 1.0 - fragCoordZ ), opacity );",
                "vec4( vec3( 0.0 ), 1.0 - fragCoordZ );",
            )
        }
        const horizontal = new THREE.ShaderMaterial(HorizontalBlurShader)
        const vertical = new THREE.ShaderMaterial(VerticalBlurShader)
        horizontal.depthTest = false
        vertical.depthTest = false
        // Looks up from the ground (in the group, which is turned to face up)
        const camera = new THREE.OrthographicCamera(
            -size / 2,
            size / 2,
            size / 2,
            -size / 2,
            0,
            far,
        )
        return {
            target,
            blurTarget,
            plane,
            blurPlane,
            depth,
            horizontal,
            vertical,
            camera,
        }
    }, [resolution, size, far])

    useEffect(
        () => () => {
            parts.target.dispose()
            parts.blurTarget.dispose()
            parts.plane.dispose()
            parts.depth.dispose()
            parts.horizontal.dispose()
            parts.vertical.dispose()
        },
        [parts],
    )

    // Drawn again when it moves or changes
    const drawn = useRef(0)
    useEffect(() => {
        drawn.current = 0
    }, [parts, position, blur])

    const blurShadow = (amount) => {
        const { target, blurTarget, blurPlane, horizontal, vertical, camera } =
            parts
        blurPlane.visible = true
        blurPlane.material = horizontal
        horizontal.uniforms.tDiffuse.value = target.texture
        horizontal.uniforms.h.value = amount / 256
        gl.setRenderTarget(blurTarget)
        gl.render(blurPlane, camera)
        blurPlane.material = vertical
        vertical.uniforms.tDiffuse.value = blurTarget.texture
        vertical.uniforms.v.value = amount / 256
        gl.setRenderTarget(target)
        gl.render(blurPlane, camera)
        blurPlane.visible = false
    }

    useFrame(() => {
        if (drawn.current >= 2 || !group.current) return
        drawn.current++
        const { target, blurPlane, depth, camera } = parts
        const background = scene.background
        const override = scene.overrideMaterial
        group.current.visible = false
        scene.background = null
        scene.overrideMaterial = depth
        gl.setRenderTarget(target)
        gl.render(scene, camera)

        // The blur plane in front of the shadow's camera, wherever it is
        camera.getWorldPosition(blurPlane.position)
        blurPlane.position.y += far / 2
        blurPlane.updateMatrixWorld()
        blurShadow(blur)
        blurShadow(blur * 0.4)

        gl.setRenderTarget(null)
        group.current.visible = true
        scene.overrideMaterial = override
        scene.background = background
    })

    return (
        <group ref={group} position={position} rotation-x={Math.PI / 2}>
            <mesh
                geometry={parts.plane}
                scale={[1, -1, 1]}
                rotation={[-Math.PI / 2, 0, 0]}>
                <meshBasicMaterial
                    transparent
                    map={parts.target.texture}
                    opacity={opacity}
                    depthWrite={false}
                />
            </mesh>
            <primitive object={parts.camera} />
        </group>
    )
}
