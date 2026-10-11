// Spot Report stand-in (brief section 5). Study 1 used the open-source Spot
// Report task (Ali et al., 2024): count target objects in a still image and
// submit. That code was not available here, so this module reproduces the
// same mechanics - a new still image every spotReportIntervalSeconds, count
// the vehicles and the people, submit - with seeded, procedurally drawn
// images. It is self-contained so the original task can replace it.
/** Builds the n-th image of a session from the spot-report stream. */
export function buildSpotImage(rng, n) {
    const vehicles = 1 + Math.floor(rng() * 6); // 1-6
    const people = 2 + Math.floor(rng() * 8); // 2-9
    const trees = 2 + Math.floor(rng() * 5);
    const houses = 1 + Math.floor(rng() * 3);
    const backdrop = rng() < 0.5 ? "rural" : "town";
    const kinds = [
        ...Array(vehicles).fill("vehicle"),
        ...Array(people).fill("person"),
        ...Array(trees).fill("tree"),
        ...Array(houses).fill("house")
    ];
    // Rejection-sample positions on a coarse grid so objects don't overlap.
    const taken = new Set();
    const objects = [];
    for (const kind of kinds) {
        for (let attempt = 0; attempt < 200; attempt++) {
            const gx = Math.floor(rng() * 10);
            const gy = Math.floor(rng() * 6);
            const key = `${gx},${gy}`;
            if (taken.has(key))
                continue;
            taken.add(key);
            objects.push({ kind, x: (gx + 0.2 + rng() * 0.6) / 10, y: (gy + 0.25 + rng() * 0.5) / 6, scale: 0.85 + rng() * 0.3, flip: rng() < 0.5 });
            break;
        }
    }
    return { id: `SR${String(n).padStart(3, "0")}`, backdrop, objects };
}
export function spotTruth(image) {
    return {
        vehicles: image.objects.filter((o) => o.kind === "vehicle").length,
        people: image.objects.filter((o) => o.kind === "person").length
    };
}
