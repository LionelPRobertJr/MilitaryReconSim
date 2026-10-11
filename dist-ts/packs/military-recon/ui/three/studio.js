import * as THREE from "three";
import { sceneKindById } from "../../sim/event-definitions.js";
import { exitAfter, OBSTACLE_AHEAD } from "../../sim/route.js";
import { HEIGHT_MAP } from "./models.js";
import { SCALE, World3D } from "./world.js";
export const STUDIO_SIZE = { width: 800, height: 500 };
const ROUTE_LEN = 90;
const EVENT_S = 40;
/** How far short of the obstacle the training camera stands (map units). */
const CAMERA_BACK = -(OBSTACLE_AHEAD - 1.75); // about 10 m from the obstacle
let renderer = null;
const urls = new Map();
function studioRenderer() {
    if (renderer)
        return renderer;
    const canvas = document.createElement("canvas");
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, stencil: true });
    return renderer;
}
/** A one-event network: a straight track with the obstacle on it. */
function network(kindId) {
    const kind = sceneKindById(kindId);
    const classId = kind.classId ?? (kind.geometry === "blocked" ? "operator_needed" : "robot_handled");
    const points = Array.from({ length: ROUTE_LEN + 1 }, (_, i) => ({ x: i, y: 0 }));
    const cum = points.map((_, i) => i);
    const sE = EVENT_S;
    // Fallen trees and the like turn their smaller end towards the way round (world.ts): the right, here.
    return {
        width: ROUTE_LEN,
        height: 40,
        sections: ["A"],
        sectionLineX: [],
        sectionLength: ROUTE_LEN,
        routes: { UGV1: { robotId: "UGV1", points, cum, length: ROUTE_LEN, sectionEnds: [ROUTE_LEN + 400] }, UGV2: { robotId: "UGV2", points, cum, length: ROUTE_LEN, sectionEnds: [ROUTE_LEN + 400] } },
        events: [{ id: "S1", robotId: "UGV1", section: "A", kindId, classId, behaviour: "robot_continue", sP: sE - 6, sE, sX: sE + exitAfter(classId), bypassId: "B1" }],
        bypasses: [{ id: "B1", robotId: "UGV1", side: 1, eventId: "S1", points: [], length: 0, label: "" }],
        nodes: { UGV1: [], UGV2: [] },
        staging: { UGV1: { x: 0, y: 0 }, UGV2: { x: 0, y: 0 } },
        objective: { x: ROUTE_LEN, y: 0 }
    };
}
function heightMap(world, geometry) {
    const flat = (c) => new THREE.MeshBasicMaterial({ color: c, fog: false });
    const ground = flat(HEIGHT_MAP.ground);
    const track = flat(HEIGHT_MAP.track);
    const objectColour = flat(geometry === "blocked" ? HEIGHT_MAP.blocked : HEIGHT_MAP.passable);
    const low = flat(HEIGHT_MAP.passable);
    world.showScenery = false;
    world.scene.fog = null;
    world.scene.background = new THREE.Color(HEIGHT_MAP.sky);
    world.scene.traverse((o) => {
        if (!o.isMesh)
            return;
        const role = o.userData?.role ?? o.parent?.userData?.role;
        if (role === "water")
            o.visible = false;
        else if (role === "surface")
            o.material = ground;
        else if (role === "bottom")
            o.material = low;
        else if (role === "solid")
            o.material = objectColour;
        else if (o.isInstancedMesh)
            o.visible = false; // trees and grass are outside the robot's sensor range here
        else
            o.material = o.renderOrder === 2 ? track : ground;
    });
}
/** An image URL (JPEG data URL) of the given kind and view, rendered on first use. */
export function studioImage(kindId, view, metresAway) {
    const key = `${kindId}|${view}${metresAway ? `|${metresAway}` : ""}`;
    const hit = urls.get(key);
    if (hit)
        return hit;
    const r = studioRenderer();
    const net = network(kindId);
    const world = new World3D(r.domElement, net, "UGV1", r);
    r.setPixelRatio(1);
    r.setSize(STUDIO_SIZE.width, STUDIO_SIZE.height, false);
    world.camera.aspect = STUDIO_SIZE.width / STUDIO_SIZE.height;
    world.camera.fov = 50;
    world.camera.updateProjectionMatrix();
    // The bridge (not in training; used for research previews) is seen from 10 m before its deck.
    // metresAway (research previews only): the camera this far from the obstacle instead of the training distance.
    const s = metresAway ? EVENT_S + OBSTACLE_AHEAD - metresAway / SCALE : kindId === "damaged_bridge" ? EVENT_S - 1.75 : EVENT_S - CAMERA_BACK;
    const u = { id: "UGV1", x: s, y: 0, s, heading: 0, state: "processing", manual: null };
    const w = { eventStatus: { S1: "detected" } };
    const look = [{ x: s, y: 0 }, { x: s + 30, y: 0 }];
    if (view === "height_map")
        heightMap(world, sceneKindById(kindId).geometry);
    world.render(u, w, look, 0, null, false);
    if (view === "second_angle") {
        // Higher up, off to the left and a little past the obstacle's near edge, looking back across it.
        const target = new THREE.Vector3((EVENT_S + OBSTACLE_AHEAD) * SCALE, 0.6, 0);
        world.camera.position.set((EVENT_S + OBSTACLE_AHEAD - 1.2) * SCALE, 5.5, -8);
        world.camera.lookAt(target);
        r.render(world.scene, world.camera);
    }
    const url = r.domElement.toDataURL("image/jpeg", 0.9);
    urls.set(key, url);
    return url;
}
/** Releases the studio's WebGL context (after training, before the mission's two views start). */
export function closeStudio() {
    if (!renderer)
        return;
    renderer.dispose();
    renderer.forceContextLoss?.();
    renderer = null;
}
