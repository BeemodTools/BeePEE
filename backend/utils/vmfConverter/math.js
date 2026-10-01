/**
 * Small vector/matrix helpers. Vectors are [x, y, z] arrays; affine matrices
 * are 12-element row-major 3x4 arrays (rotation in columns 0-2, translation in 3).
 */

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
]
const length = (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])
const distance = (a, b) => length(sub(a, b))

function normalize(a) {
    const len = length(a)
    return [a[0] / len, a[1] / len, a[2] / len]
}

/** Exact key for de-duplicating vertices (no lossy hashing) */
const vectorKey = (a) => `${a[0]},${a[1]},${a[2]}`

const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0])

/**
 * Rotation matrix from Euler angles, R = Rz(z) * Ry(y) * Rx(x).
 * This is the convention of both SMD bone rotations (radians) and Source's
 * AngleMatrix for entity angles (pitch = y, yaw = z, roll = x).
 * @returns {number[]} 3x4 matrix
 */
function eulerMatrix(x, y, z, tx = 0, ty = 0, tz = 0) {
    const cx = Math.cos(x)
    const sx = Math.sin(x)
    const cy = Math.cos(y)
    const sy = Math.sin(y)
    const cz = Math.cos(z)
    const sz = Math.sin(z)
    return [
        cy * cz,
        sx * sy * cz - cx * sz,
        cx * sy * cz + sx * sz,
        tx,
        cy * sz,
        sx * sy * sz + cx * cz,
        cx * sy * sz - sx * cz,
        ty,
        -sy,
        sx * cy,
        cx * cy,
        tz,
    ]
}

/**
 * Source entity transform: rotate by "pitch yaw roll" (degrees), then translate.
 * @param {number[]} angles - [pitch, yaw, roll] in degrees
 * @param {number[]} origin - [x, y, z]
 */
function entityMatrix(angles, origin) {
    const rad = Math.PI / 180
    return eulerMatrix(
        angles[2] * rad,
        angles[0] * rad,
        angles[1] * rad,
        origin[0],
        origin[1],
        origin[2],
    )
}

function multiply(a, b) {
    const r = new Array(12)
    for (let row = 0; row < 3; row++) {
        const o = row * 4
        for (let col = 0; col < 3; col++) {
            r[o + col] =
                a[o] * b[col] + a[o + 1] * b[4 + col] + a[o + 2] * b[8 + col]
        }
        r[o + 3] = a[o] * b[3] + a[o + 1] * b[7] + a[o + 2] * b[11] + a[o + 3]
    }
    return r
}

/** Inverse of a rigid (rotation + translation) transform */
function invertRigid(m) {
    const r = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0]
    r[3] = -(r[0] * m[3] + r[1] * m[7] + r[2] * m[11])
    r[7] = -(r[4] * m[3] + r[5] * m[7] + r[6] * m[11])
    r[11] = -(r[8] * m[3] + r[9] * m[7] + r[10] * m[11])
    return r
}

function transformPoint(m, p) {
    return [
        m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
        m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
        m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
    ]
}

function transformDirection(m, d) {
    return [
        m[0] * d[0] + m[1] * d[1] + m[2] * d[2],
        m[4] * d[0] + m[5] * d[1] + m[6] * d[2],
        m[8] * d[0] + m[9] * d[1] + m[10] * d[2],
    ]
}

function isNearIdentity(m, epsilon = 1e-6) {
    for (let i = 0; i < 12; i++) {
        if (Math.abs(m[i] - IDENTITY[i]) > epsilon) return false
    }
    return true
}

module.exports = {
    add,
    sub,
    scale,
    dot,
    cross,
    length,
    distance,
    normalize,
    vectorKey,
    IDENTITY,
    eulerMatrix,
    entityMatrix,
    multiply,
    invertRigid,
    transformPoint,
    transformDirection,
    isNearIdentity,
}
