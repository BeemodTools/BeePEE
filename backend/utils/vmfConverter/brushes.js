/**
 * Brush geometry: turns VMF side planes into face polygons and builds
 * displacement grids. Ported from VMF2OBJ (Side.completeSide, Vector3,
 * Plane, VectorSorter) keeping the same operations so output matches it.
 */

const {
    add,
    sub,
    scale,
    dot,
    cross,
    length,
    normalize,
    distance,
} = require("./math")

const MERGE_DISTANCE = 0.2

const divide = (a, s) => [a[0] / s, a[1] / s, a[2] / s]
const planeNormal = (p) => cross(sub(p[1], p[0]), sub(p[2], p[0]))
const planeCenter = (p) => divide(add(add(p[0], p[1]), p[2]), 3)

function planeDistance(p) {
    const n = planeNormal(p)
    return dot(p[0], n) / length(n)
}

/** Intersection point of three planes, or null if (nearly) parallel */
function planeIntersection(p1, p2, p3) {
    const n1 = normalize(planeNormal(p1))
    const n2 = normalize(planeNormal(p2))
    const n3 = normalize(planeNormal(p3))
    const determinant =
        n1[0] * n2[1] * n3[2] +
        n1[1] * n2[2] * n3[0] +
        n1[2] * n2[0] * n3[1] -
        (n1[2] * n2[1] * n3[0] + n1[1] * n2[0] * n3[2] + n1[0] * n2[2] * n3[1])

    if (
        (determinant <= 0.01 && determinant >= -0.01) ||
        Number.isNaN(determinant)
    ) {
        return null
    }

    const sum = add(
        add(
            scale(cross(n2, n3), planeDistance(p1)),
            scale(cross(n3, n1), planeDistance(p2)),
        ),
        scale(cross(n1, n2), planeDistance(p3)),
    )
    return divide(sum, determinant)
}

function pointInHull(point, planes) {
    for (const plane of planes) {
        const facing = normalize(sub(point, planeCenter(plane)))
        if (dot(facing, normalize(planeNormal(plane))) < -0.01) return false
    }
    return true
}

const longer = (a, b) => (length(a) > length(b) ? a : b)

/**
 * Compute the polygon of one brush side by intersecting it with every pair of
 * the brush's other planes, then sort the corners around the face normal.
 * @param {number[][]} plane - The side's three plane points
 * @param {number[][][]} planes - All planes of the brush
 * @returns {number[][]|null} Ordered corner points, or null if malformed
 */
function completeSide(plane, planes) {
    const intersections = []
    const seen = new Set()

    for (const plane2 of planes) {
        for (const plane3 of planes) {
            let intersection = planeIntersection(plane, plane2, plane3)
            if (!intersection) continue

            const key = intersection.join(",")
            if (seen.has(key)) continue
            if (!pointInHull(intersection, planes)) continue
            if (
                intersections.some(
                    (p) => distance(p, intersection) < MERGE_DISTANCE,
                )
            ) {
                continue
            }

            // Snap to an existing plane point that is very close
            for (const other of planes) {
                for (const existing of other) {
                    if (distance(existing, intersection) < MERGE_DISTANCE) {
                        intersection = existing
                        break
                    }
                }
            }

            seen.add(intersection.join(","))
            intersections.push(intersection)
        }
    }

    if (intersections.length < 3) return null

    let sum = [0, 0, 0]
    for (const point of intersections) sum = add(sum, point)
    const center = divide(sum, intersections.length)
    const normal = normalize(planeNormal(plane))

    const pp = longer(
        longer(cross(normal, [1, 0, 0]), cross(normal, [0, 1, 0])),
        cross(normal, [0, 0, 1]),
    )
    const qp = cross(normal, pp)
    const order = (v) => {
        const relative = sub(v, center)
        return Math.atan2(
            dot(normal, cross(relative, pp)),
            dot(normal, cross(relative, qp)),
        )
    }

    return intersections
        .map((point) => ({ point, order: order(point) }))
        .sort((a, b) => a.order - b.order)
        .map((item) => item.point)
}

/**
 * Fill in face polygons for every side of a solid (mutates side.points)
 * @returns {string[]} Ids of malformed sides
 */
function completeSolid(solid) {
    const planes = solid.sides.map((side) => side.plane)
    const malformed = []
    for (const side of solid.sides) {
        const points = completeSide(side.plane, planes)
        if (points) {
            side.points = points
        } else {
            malformed.push(side.id)
        }
    }
    return malformed
}

const floorMod = (a, n) => ((a % n) + n) % n

/**
 * Build the displacement vertex generator for a 4-sided displacement face
 * @returns {{rows: number, cols: number, point: (row: number, col: number) => number[]}}
 */
function displacementGrid(side) {
    const disp = side.dispinfo
    const points = side.points
    let startIndex = 0
    let best = distance(disp.startPosition, points[0])
    for (let i = 1; i < points.length; i++) {
        const d = distance(disp.startPosition, points[i])
        if (d < best) {
            best = d
            startIndex = i
        }
    }

    // Corners go around counter-clockwise from the start position
    const count = points.length
    const a = points[floorMod(startIndex - 2, count)]
    const b = points[floorMod(startIndex - 1, count)]
    const c = points[startIndex]
    const d = points[floorMod(startIndex + 1, count)]
    const cd = sub(d, c)
    const cb = sub(b, c)
    const ba = sub(a, b)

    const rows = disp.normals.length
    const cols = disp.normals[0].length

    const point = (i, j) => {
        const rowProgress = j / (cols - 1)
        const colProgress = i / (rows - 1)
        const normal = disp.normals[i]?.[j] ?? [0, 0, 0]
        const dist = disp.distances[i]?.[j] ?? 0
        return add(
            add(
                add(
                    c,
                    add(
                        scale(scale(cd, colProgress), 1 - rowProgress),
                        scale(scale(ba, colProgress), rowProgress),
                    ),
                ),
                scale(cb, rowProgress),
            ),
            scale(normal, dist),
        )
    }

    return { rows, cols, point }
}

module.exports = {
    planeIntersection,
    pointInHull,
    completeSide,
    completeSolid,
    displacementGrid,
}
