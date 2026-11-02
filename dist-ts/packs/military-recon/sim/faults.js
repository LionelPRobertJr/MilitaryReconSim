// Optional vehicle faults (repairs) for the Military Recon pack (Oct 29, 2026, user: "add a repair condition like
// the ones in the Moon Base Builder, only with fewer", for realism and workload in FUTURE studies). Off by default
// (config.faults.enabled = false): Study 2 runs exactly as before.
//
// When on, a few faults are scheduled per mission on stretches of plain track between obstacles. A UGV with a fault
// stops (purple light) and waits. The operator opens its fault report: four sensor readings, exactly one of them out
// of its normal range. They pick the matching fix (short), or Reboot (always works, longest). A wrong fix takes its
// time, does nothing, and costs points. Faults never start while a vehicle is judging, passing or going round an
// obstacle, so they never coincide with an obstacle decision on the same vehicle.
/** The sensor readings on every fault report; one is abnormal (the fault's own). */
export const FAULT_READINGS = [
    { key: "motor_temp", label: "Drive motor temperature", normal: "64 °C" },
    { key: "position_error", label: "Navigation position error", normal: "0.4 m" },
    { key: "camera_signal", label: "Forward camera signal", normal: "OK" },
    { key: "battery", label: "Battery charge", normal: "81 %" }
];
export const FAULT_TYPES = [
    { id: "motor_overheat", label: "Drive motor overheating", reading: "motor_temp", abnormal: "118 °C", fix: "cool_motor" },
    { id: "nav_drift", label: "Navigation drift", reading: "position_error", abnormal: "14.6 m", fix: "reset_nav" },
    { id: "camera_loss", label: "Camera signal lost", reading: "camera_signal", abnormal: "NO SIGNAL", fix: "restart_camera" }
];
/** The fixes offered on every report (the same three, plus Reboot), and how long each takes. */
export const FAULT_FIXES = [
    { id: "cool_motor", label: "Cool down the motor", seconds: 10 },
    { id: "reset_nav", label: "Reset navigation", seconds: 8 },
    { id: "restart_camera", label: "Restart the camera", seconds: 6 }
];
export const faultType = (id) => FAULT_TYPES.find((t) => t.id === id);
export const fixSeconds = (id) => FAULT_FIXES.find((f) => f.id === id).seconds;
/**
 * Where the faults go, for this seed. Each one sits midway along a stretch of plain track: between where the vehicle
 * is past one obstacle (its exit) and where it would detect the next. Section by section, alternating vehicles; the
 * types come in a seeded order from its own random stream, so nothing else in the mission changes.
 */
export function scheduleFaults(settings, network, detectionDistance, rng, tutorial) {
    if (!settings.enabled)
        return [];
    const types = settings.types
        .split(",")
        .map((t) => t.trim())
        .filter((t) => FAULT_TYPES.some((f) => f.id === t));
    if (!types.length)
        return [];
    // Seeded order of the types (Fisher-Yates on the faults stream).
    for (let i = types.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [types[i], types[j]] = [types[j], types[i]];
    }
    const count = tutorial ? 1 : Math.max(0, Math.min(settings.count, network.sections.length * 2));
    const out = [];
    for (let i = 0; i < count; i++) {
        const section = network.sections[i % network.sections.length];
        const round = Math.floor(i / network.sections.length);
        const robotId = tutorial ? "UGV1" : (i + round) % 2 === 0 ? "UGV2" : "UGV1";
        const evs = network.events.filter((e) => e.robotId === robotId && e.section === section).sort((a, b) => a.sE - b.sE);
        const si = network.sections.indexOf(section);
        const start = si * network.sectionLength;
        const end = network.routes[robotId].sectionEnds[si];
        // The gap after the middle obstacle (or after the last one, if there are fewer than two).
        const g = evs.length >= 5 ? 2 : evs.length >= 2 ? 1 : evs.length - 1;
        const from = g >= 0 ? evs[g].sX : start + 2;
        const to = evs[g + 1] ? evs[g + 1].sE - detectionDistance : end - 2;
        out.push({ id: `F${String(i + 1).padStart(2, "0")}`, robotId, section, s: Math.round(((from + to) / 2) * 100) / 100, typeId: types[i % types.length] });
    }
    return out;
}
