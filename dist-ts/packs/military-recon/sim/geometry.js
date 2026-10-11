// Small polyline helpers for route following. Pure functions, no state.
export function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}
/** Cumulative arc length at each vertex (first entry 0). */
export function cumulative(points) {
    const out = [0];
    for (let i = 1; i < points.length; i++)
        out.push(out[i - 1] + dist(points[i - 1], points[i]));
    return out;
}
export function polylineLength(points) {
    let len = 0;
    for (let i = 1; i < points.length; i++)
        len += dist(points[i - 1], points[i]);
    return len;
}
/** Point and heading (radians) at arc length s along a polyline, clamped to its ends. */
export function pointAt(points, cum, s) {
    const total = cum[cum.length - 1];
    const t = Math.max(0, Math.min(total, s));
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= t)
            lo = mid;
        else
            hi = mid;
    }
    const a = points[lo];
    const b = points[hi];
    const seg = cum[hi] - cum[lo];
    const f = seg > 0 ? (t - cum[lo]) / seg : 0;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, heading: Math.atan2(b.y - a.y, b.x - a.x) };
}
/** The sub-polyline between arc lengths s0 < s1. */
export function slice(points, cum, s0, s1) {
    const out = [];
    const p0 = pointAt(points, cum, s0);
    out.push({ x: p0.x, y: p0.y });
    for (let i = 0; i < points.length; i++) {
        if (cum[i] > s0 && cum[i] < s1)
            out.push({ x: points[i].x, y: points[i].y });
    }
    const p1 = pointAt(points, cum, s1);
    out.push({ x: p1.x, y: p1.y });
    return out;
}
/**
 * A smooth bulge from a to b, offset to one side by height h (quadratic
 * curve, sampled), as used for bypass edges.
 */
export function bulge(a, b, h, side, samples = 24) {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    // Unit normal; side picks which way it bulges (+1 = towards +y for a left-to-right chord).
    const nx = (-dy / len) * side;
    const ny = (dx / len) * side;
    const cx = mx + nx * 2 * h;
    const cy = my + ny * 2 * h;
    const out = [];
    for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const u = 1 - t;
        out.push({ x: u * u * a.x + 2 * u * t * cx + t * t * b.x, y: u * u * a.y + 2 * u * t * cy + t * t * b.y });
    }
    return out;
}
/** Finds the bulge height giving a target path length (bisection). */
export function bulgeForLength(a, b, targetLength, side) {
    let lo = 0;
    let hi = 400;
    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (polylineLength(bulge(a, b, mid, side)) < targetLength)
            lo = mid;
        else
            hi = mid;
    }
    return bulge(a, b, (lo + hi) / 2, side);
}
/**
 * A swerve: from arc length s0 the path eases sideways by d (side +1 = right of the direction of travel, map y
 * pointing down), is fully to the side from inEnd to holdEnd, and eases back onto the route by s1. Sampled every
 * `step` along the route.
 */
export function swerve(points, cum, s0, inEnd, holdEnd, s1, side, d, step = 0.25) {
    const smooth = (t) => {
        const x = Math.max(0, Math.min(1, t));
        return x * x * (3 - 2 * x);
    };
    const offset = (a) => (a < inEnd ? smooth((a - s0) / Math.max(1e-6, inEnd - s0)) : a > holdEnd ? 1 - smooth((a - holdEnd) / Math.max(1e-6, s1 - holdEnd)) : 1) * d;
    const out = [];
    const n = Math.max(2, Math.ceil((s1 - s0) / step));
    for (let i = 0; i <= n; i++) {
        const a = s0 + ((s1 - s0) * i) / n;
        const p = pointAt(points, cum, a);
        const o = offset(a) * side;
        out.push({ x: p.x - Math.sin(p.heading) * o, y: p.y + Math.cos(p.heading) * o });
    }
    return out;
}
