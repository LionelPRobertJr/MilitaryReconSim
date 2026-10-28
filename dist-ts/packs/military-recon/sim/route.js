import { eventKindById, robotBehaviour } from "./event-definitions.js";
import { cumulative, slice, swerve } from "./geometry.js";
export const ROBOT_IDS = ["UGV1", "UGV2"];
/** Event slots as fractions of the section length, for 1, 3 or 4 events in a section. */
const SLOT_FRACTIONS = { 1: [0.44], 3: [0.23, 0.5, 0.77], 4: [0.18, 0.4, 0.62, 0.8], 5: [0.15, 0.32, 0.49, 0.66, 0.83] };
/**
 * The held-back kinds on each route (the bridge is placed separately, first in UGV1's Section B). Each route meets the
 * flooded dip, the low mound and the fallen sapling; UGV1 also the tall reeds, UGV2 the smoke and the gravel ford.
 * Across both routes: 5 that need the operator (dip x2, reeds, smoke, bridge) and 5 the UGV handles (mound x2,
 * sapling x2, ford).
 */
export const HELD_BACK = {
    UGV1: ["flooded_dip", "low_berm", "fallen_sapling", "tall_reeds"],
    UGV2: ["flooded_dip", "low_berm", "fallen_sapling", "smoke_drift", "gravel_ford"]
};
/** Plain scene-change points, as fractions of the section length (where recon waypoints used to be). */
const PLAIN_SCENE_FRACTIONS = [0.07, 0.96];
const APPROACH_BEFORE = 8;
// The world is laid out so the 3D views and the simulation agree (Oct 2026). A UGV that stops at an obstacle stops
// at sE; the obstacle itself stands OBSTACLE_AHEAD further on (one map unit is 6 m in the 3D views, so 13 m). The
// way round eases sideways, passes the obstacle SWERVE_OFFSET to the side (6 m), and rejoins the route just past it.
// The bridge is different: the UGV drives onto the deck (deck from sE - 0.3), and the way round is an intact
// crossing of the ravine CRITICAL_SWERVE_OFFSET (15.6 m) to the side, reached by backing off the deck first.
export const OBSTACLE_AHEAD = 2.2;
/**
 * Where a UGV gets stuck at a held-back obstacle whose danger is hidden (dip, reeds, smoke): in it, just past its near
 * edge (relative to sE), not short of it. The bridge keeps its own geometry (the deck starts at sE).
 */
export const HIDDEN_STUCK_AT = OBSTACLE_AHEAD - 0.5;
export const SWERVE_OFFSET = 1.1;
export const CRITICAL_SWERVE_OFFSET = 2.6;
const WAY = { inStart: -2.5, inEnd: -0.7, holdEnd: 0.7, exit: 2.8 }; // relative to the obstacle (sE + OBSTACLE_AHEAD)
const CRITICAL_WAY = { backTo: -3.3, inEnd: -0.5, holdEnd: 2.6, exit: 5.5 }; // relative to sE
/** The take-over waypoints' positions: entering the swerve, beside the obstacle, and leaving it (map coordinates). */
export function wayRoundPins(route, ev, side) {
    const critical = ev.classId === "critical_novel";
    const d = critical ? CRITICAL_SWERVE_OFFSET : SWERVE_OFFSET;
    const at = (a, f) => {
        const i = route.cum.findIndex((c) => c >= a);
        const k = Math.max(1, i < 0 ? route.cum.length - 1 : i);
        const p0 = route.points[k - 1];
        const p1 = route.points[k];
        const t = (a - route.cum[k - 1]) / Math.max(1e-9, route.cum[k] - route.cum[k - 1]);
        const x = p0.x + (p1.x - p0.x) * t;
        const y = p0.y + (p1.y - p0.y) * t;
        const h = Math.atan2(p1.y - p0.y, p1.x - p0.x);
        return { x: x - Math.sin(h) * d * f * side, y: y + Math.cos(h) * d * f * side };
    };
    if (critical)
        return [at(ev.sE + CRITICAL_WAY.inEnd - 0.6, 0.75), at(ev.sE + 1.0, 1), at(ev.sE + CRITICAL_WAY.holdEnd + 0.9, 0.75)];
    const o = ev.sE + OBSTACLE_AHEAD;
    return [at(o + WAY.inEnd - 0.55, 0.8), at(o, 1), at(o + WAY.holdEnd + 0.75, 0.75)];
}
/** Arc length where the way round rejoins the route. */
export function exitAfter(classId) {
    return classId === "critical_novel" ? CRITICAL_WAY.exit : OBSTACLE_AHEAD + WAY.exit;
}
/**
 * The way round an obstacle, driven at operator-guided speed from the UGV's position fromS: straight on (or backing
 * up, at the bridge) to where it starts easing sideways, then the swerve back onto the route. Shared by the
 * simulation (what the UGV drives) and the 3D view (where the waypoints are drawn), so the two always agree.
 */
export function wayRound(route, ev, side, fromS) {
    const critical = ev.classId === "critical_novel";
    let s0;
    let lead = [];
    let backUp = 0;
    let inEnd;
    let holdEnd;
    if (critical) {
        s0 = ev.sE + CRITICAL_WAY.backTo;
        inEnd = ev.sE + CRITICAL_WAY.inEnd;
        holdEnd = ev.sE + CRITICAL_WAY.holdEnd;
        if (fromS > s0) {
            backUp = fromS - s0;
            lead = slice(route.points, route.cum, s0, fromS).reverse();
        }
        else if (fromS < s0)
            lead = slice(route.points, route.cum, fromS, s0);
    }
    else {
        const o = ev.sE + OBSTACLE_AHEAD;
        inEnd = o + WAY.inEnd;
        holdEnd = o + WAY.holdEnd;
        s0 = Math.min(Math.max(fromS, o + WAY.inStart), inEnd - 0.5);
        if (fromS < s0)
            lead = slice(route.points, route.cum, fromS, s0);
        else if (fromS > s0 + 1e-9) {
            // Stuck in a held-back obstacle (HIDDEN_STUCK_AT): back out a little before easing round.
            backUp = fromS - s0;
            lead = slice(route.points, route.cum, s0, fromS).reverse();
        }
    }
    const around = swerve(route.points, route.cum, s0, inEnd, holdEnd, ev.sX, side, critical ? CRITICAL_SWERVE_OFFSET : SWERVE_OFFSET);
    return { path: lead.length ? [...lead, ...around.slice(1)] : around, backUp };
}
const TUTORIAL_SECTION_LENGTH = 160;
/**
 * The two routes' slots are staggered (research team decision, Oct 28, 2026: with identical slots both vehicles met
 * their obstacles at the same moment, so every alert came in pairs). UGV1's come a little earlier and UGV2's a
 * little later: 0.07 of a section apart, about 15 s of driving, before operator actions shift them further.
 */
export const SLOT_STAGGER = { UGV1: -0.035, UGV2: 0.035 };
/** Arc lengths (from section start) of the event slots in a section of this length (robotId: staggered, main mission). */
export function slotPositions(eventCount, sectionLength, robotId) {
    const shift = robotId ? SLOT_STAGGER[robotId] : 0;
    return SLOT_FRACTIONS[eventCount].map((f) => Math.round((f + shift) * sectionLength));
}
function shuffle(rng, items) {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
/** A gently winding route across the sections, with an exact arc length per section. */
function buildRouteCurve(xs, yBase, phase, sectionLength) {
    const points = [];
    for (let i = 0; i < xs.length - 1; i++) {
        const x0 = xs[i];
        const span = xs[i + 1] - x0;
        const sample = (amp) => {
            const pts = [];
            for (let k = 0; k <= span; k++) {
                pts.push({ x: x0 + k, y: yBase + amp * Math.sin((2 * Math.PI * 1.5 * k) / span + phase) });
            }
            return pts;
        };
        let lo = 0;
        let hi = 200;
        for (let it = 0; it < 60; it++) {
            const mid = (lo + hi) / 2;
            const pts = sample(mid);
            const len = cumulative(pts).at(-1);
            if (len < sectionLength)
                lo = mid;
            else
                hi = mid;
        }
        const pts = sample((lo + hi) / 2);
        points.push(...(i === 0 ? pts : pts.slice(1)));
    }
    return points;
}
/** Seeded, balanced assignment of event kinds to slots (main mission). */
function placeEvents(rng) {
    const sections = ["A", "B", "C"];
    const robotHandled = shuffle(rng, ["small_debris", "shallow_water", "light_brush"].flatMap((k) => [k, k, k, k]));
    const operatorNeeded = shuffle(rng, ["rubble_pile", "fallen_tree", "abandoned_vehicle"].flatMap((k) => [k, k]));
    // Section A's held-back obstacle is always one the UGV handles (the low mound or the fallen sapling), so no UGV gets
    // stuck before the bridge and the bridge lands at the same mission time for every seed (brief section 4).
    const heldBack = {};
    for (const robotId of ROBOT_IDS) {
        const first = rng() < 0.5 ? "low_berm" : "fallen_sapling";
        heldBack[robotId] = [first, ...shuffle(rng, HELD_BACK[robotId].filter((k) => k !== first))];
    }
    const heldPerSection = { UGV1: { A: 1, B: 1, C: 2 }, UGV2: { A: 1, B: 2, C: 2 } };
    const placements = [];
    let rh = 0;
    let on = 0;
    const hb = { UGV1: 0, UGV2: 0 };
    for (const section of sections) {
        for (const robotId of ROBOT_IDS) {
            const known = [robotHandled[rh++], robotHandled[rh++], operatorNeeded[on++]];
            const held = Array.from({ length: heldPerSection[robotId][section] }, () => heldBack[robotId][hb[robotId]++]);
            // In Section A the held-back obstacle comes third or fourth, after the participant has met trained ones.
            const ordered = section === "A" ? shuffle(rng, known) : shuffle(rng, [...known, ...held]);
            if (section === "A")
                ordered.splice(2 + (rng() < 0.5 ? 0 : 1), 0, ...held);
            if (section === "B" && robotId === "UGV1")
                ordered.unshift("damaged_bridge");
            placements.push({ robotId, section, kinds: ordered });
        }
    }
    return placements;
}
function plainScene(section, index) {
    // Off-road throughout: open country in A, scrubland in B, woodland and open country in C.
    const terrain = section === "A" ? "open" : section === "B" ? "scrub" : index % 2 === 0 ? "wood" : "open";
    return `track_${terrain}_${index % 3}`;
}
export function buildRouteNetwork(rng, tutorial, mainSectionLength) {
    const sections = tutorial ? ["A"] : ["A", "B", "C"];
    const sectionLength = tutorial ? TUTORIAL_SECTION_LENGTH : mainSectionLength;
    // Horizontal span per section; the route winds a little so its arc length is exactly sectionLength.
    const span = Math.round(sectionLength * 0.9);
    const xs = sections.map((_, i) => 60 + i * span);
    xs.push(60 + sections.length * span);
    const width = xs.at(-1) + 60;
    const height = tutorial ? 300 : 470;
    const yBase = tutorial ? { UGV1: 95, UGV2: 205 } : { UGV1: 135, UGV2: 340 };
    const side = { UGV1: -1, UGV2: 1 };
    const placements = tutorial
        ? [
            { robotId: "UGV1", section: "A", kinds: ["small_debris"] },
            { robotId: "UGV2", section: "A", kinds: ["fallen_tree"] }
        ]
        : placeEvents(rng);
    const routes = {};
    const nodes = {};
    const events = [];
    const bypasses = [];
    let eventCounter = 0;
    for (const robotId of ROBOT_IDS) {
        const points = buildRouteCurve(xs, yBase[robotId], robotId === "UGV1" ? 0 : Math.PI, sectionLength);
        const cum = cumulative(points);
        const sectionEnds = sections.map((_, i) => (i + 1) * sectionLength);
        routes[robotId] = { robotId, points, cum, length: cum.at(-1), sectionEnds };
        const list = [];
        let nodeIdx = 0;
        const addNode = (s, kind, section, eventId, sceneId) => {
            list.push({ id: `${robotId}-n${++nodeIdx}`, robotId, s, kind, section, eventId, sceneId });
        };
        addNode(0, "start", sections[0], null, plainScene(sections[0], 0));
        sections.forEach((section, si) => {
            const base = si * sectionLength;
            const placement = placements.find((p) => p.robotId === robotId && p.section === section);
            const slots = slotPositions(placement.kinds.length, sectionLength, tutorial ? undefined : robotId);
            const plainOffsets = PLAIN_SCENE_FRACTIONS.map((f) => Math.round(f * sectionLength));
            plainOffsets.forEach((off, wi) => addNode(base + off, "scene", section, null, plainScene(section, wi + si)));
            placement.kinds.forEach((kindId, k) => {
                const kind = eventKindById(kindId);
                const id = `E${String(++eventCounter).padStart(2, "0")}`;
                const sE = base + slots[k];
                const ev = {
                    id,
                    robotId,
                    section,
                    kindId,
                    classId: kind.classId,
                    behaviour: robotBehaviour(kind), // derived from the capability facts - the same rule the training is generated from
                    sP: sE - APPROACH_BEFORE,
                    sE,
                    sX: sE + exitAfter(kind.classId),
                    bypassId: `${id}-bypass`
                };
                events.push(ev);
                const bp = wayRound({ robotId, points, cum, length: cum.at(-1), sectionEnds: [] }, ev, side[robotId], ev.sP).path;
                bypasses.push({ id: ev.bypassId, robotId, eventId: id, side: side[robotId], points: bp, length: cumulative(bp).at(-1), label: "Bypass" }); // the same label for every bypass: the map gives no advance cue to the critical event
                addNode(ev.sP, "approach", section, id, plainScene(section, k));
                addNode(ev.sE, "event", section, id, kindId);
                addNode(ev.sX, "exit", section, id, plainScene(section, k + 1));
            });
            const last = si === sections.length - 1;
            addNode(base + sectionLength, last ? "objective" : "section_line", section, null, last ? "objective" : "section_line");
        });
        list.sort((p, q) => p.s - q.s);
        nodes[robotId] = list;
    }
    return {
        width,
        height,
        sections,
        sectionLineX: xs.slice(1, -1),
        sectionLength,
        routes,
        events,
        bypasses,
        nodes,
        staging: { UGV1: { x: xs[0] - 30, y: yBase.UGV1 }, UGV2: { x: xs[0] - 30, y: yBase.UGV2 } },
        objective: { x: xs.at(-1) + 25, y: (yBase.UGV1 + yBase.UGV2) / 2 }
    };
}
