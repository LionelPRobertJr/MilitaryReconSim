// THE single source of truth for Study 2's route events (brief sections 6
// and 7). Pure data plus one derivation rule - no simulation logic.
//
// Two consumers read this file and nothing else for event semantics:
//   1. The simulation (session.ts): how a UGV behaves at each event - how long
//      it processes, whether it continues or asks for help, and what happens
//      after each operator action - is derived from these entries via
//      robotBehaviour() below.
//   2. The training modules (milestone M3): the C1-C4 module text, the
//      practice-scene feedback and the judgment cards are generated from the
//      same entries, so what C4 operators learn is verifiably the robot's
//      actual model (brief section 7, point 1).
//
// Every kind declares its class (the research label) AND the capability facts
// the robot's behaviour is derived from; a unit test fails if the declared
// class and the derived behaviour ever disagree.
/** The robot's capability boundary - the one rule set every event follows (brief section 6). */
export const CAPABILITY_BOUNDARY = {
    /** Completes "a UGV judges the terrain by ...". */
    senses: "its shape and height, measured by its LiDAR sensors, plus the object types it was trained to recognise",
    /** The last entry completes "it cannot see ..."; the others complete "it cannot judge ...". */
    cannotJudge: ["what is beneath a surface", "what is behind something", "through obscurants such as dust or fog"],
    rule: "When the scene depends on something it cannot sense, it needs you.",
    /**
     * C4's "How a UGV decides" page (Oct 11, 2026: research team asked for training that makes sure C4 participants
     * understand the principles needed to infer what the UGV can do). Three facts, then the two questions to ask of
     * anything new. The examples are deliberately NOT any mission obstacle (snow, fog, dust, a steep rise).
     */
    facts: [
        "It goes by height, not by looks. Its LiDAR measures how tall things are. Anything lower than its ground clearance, about knee height, it drives over, however big, long or messy it looks. Anything taller that spans the track stops it.",
        "It cannot see beneath a surface. It knows water is shallow only when its sensors reach the firm bottom through clear water. When the ground is covered, for example by fresh snow, it cannot tell what lies under it.",
        "It cannot see behind or through things. When something blocks its view of the ground ahead, such as fog, dust or the top of a steep rise, it cannot judge what is there."
    ],
    questions: "So for anything new, even something this training never showed, ask two questions. Is any part taller than its ground clearance? Then it stops and needs you to send it around. Is anything it needs to measure hidden from it? Then it cannot judge it, may drive in and get stuck, and needs you before it gets there. If both answers are no, it drives on by itself."
};
export const EVENT_KINDS = [
    {
        id: "small_debris",
        label: "Small debris",
        classId: "robot_handled",
        trained: true,
        geometry: "passable",
        structuralFailure: false,
        hiddenFactor: null,
        appearance: "Scattered stones and broken branches lie across the track. Most pieces are about the size of a fist, spread loosely over both wheel ruts and the grassy strip between them.",
        plural: "small debris",
        withArticle: "small debris",
        object: "stones and branches",
        heightFact: "every piece is lower than its ground clearance",
        cardText: "Stones and broken branches scattered across the track."
    },
    {
        id: "shallow_water",
        label: "Shallow water",
        classId: "robot_handled",
        trained: true,
        geometry: "passable",
        structuralFailure: false,
        hiddenFactor: null,
        appearance: "A thin sheet of pale, still water covers the track after rain. It is shallow and flat, with a few pebbles showing in it and the track running straight on beyond it.",
        plural: "shallow water",
        withArticle: "shallow water",
        object: "water",
        heightFact: "it senses the firm track bed under the clear water, only a few centimetres down",
        cardText: "A thin sheet of pale, still water across the track."
    },
    {
        id: "light_brush",
        label: "Light brush",
        classId: "robot_handled",
        trained: true,
        geometry: "passable",
        structuralFailure: false,
        hiddenFactor: null,
        appearance: "Low brush and long grass have grown over the edges of the track. The stems are thin and pale green, and a few tufts reach into the middle of the track.",
        plural: "light brush",
        withArticle: "light brush",
        object: "brush",
        heightFact: "the stems are thin and bend, and nothing solid rises above its ground clearance",
        cardText: "Low brush and grass growing over the track."
    },
    {
        id: "rubble_pile",
        label: "Rubble pile",
        classId: "operator_needed",
        trained: true,
        geometry: "blocked",
        structuralFailure: false,
        hiddenFactor: null,
        appearance: "A heap of broken rock and earth covers the whole track. It rises about as high as the vehicle, brown and lumpy, with loose stones scattered around its base.",
        plural: "rubble piles",
        withArticle: "a rubble pile",
        object: "rubble pile",
        heightFact: "it is far taller than its ground clearance and covers the whole track",
        cardText: "A heap of broken rock covering the track."
    },
    {
        id: "fallen_tree",
        label: "Fallen tree",
        classId: "operator_needed",
        trained: true,
        geometry: "blocked",
        structuralFailure: false,
        hiddenFactor: null,
        appearance: "A large tree trunk lies across the full width of the track. The bark is dark and rough, and a thick crown of leaves still hangs from the broken end at the left.",
        plural: "fallen trees",
        withArticle: "a fallen tree",
        object: "trunk",
        heightFact: "it is taller than its ground clearance and spans the full width of the track",
        cardText: "A large tree trunk lying across the track."
    },
    {
        id: "abandoned_vehicle",
        label: "Abandoned vehicle",
        classId: "operator_needed",
        trained: true,
        geometry: "blocked",
        structuralFailure: false,
        hiddenFactor: null,
        appearance: "A stalled truck stands across the track, blocking the way. It is green and dusty, with flat tyres, an empty cab and the driver's door left wide open on one side.",
        plural: "abandoned vehicles",
        withArticle: "an abandoned vehicle",
        object: "truck",
        heightFact: "it is a solid object much taller than the UGV, filling the track",
        cardText: "A stalled truck standing across the track."
    },
    {
        id: "damaged_bridge",
        label: "Damaged bridge",
        classId: "critical_novel",
        trained: false,
        geometry: "passable",
        structuralFailure: true,
        hiddenFactor: "beneath_surface",
        appearance: "A narrow vehicle bridge carrying the track over a ravine; the deck looks intact at the approach, with a gap visible in the deck at mid-span.",
        plural: "damaged bridges",
        withArticle: "a damaged bridge",
        object: "bridge deck",
        heightFact: "the deck is flat and level where it begins",
        cardText: "A narrow vehicle bridge over a ravine."
    },
    // --- held back from training (Oct 10, 2026) ---------------------------------------------
    // Each looks like a trained case whose answer is the opposite: the flooded dip and the tall reeds look like the
    // shallow water and light brush the UGV handles; the low mound and the fallen sapling look like the rubble pile
    // and fallen tree it cannot pass. Only the capability model separates them. Smoke and the clear gravel ford
    // follow the model too (the ford is a control: a list-learner should also leave it).
    {
        id: "flooded_dip",
        label: "Flooded dip",
        classId: "novel_needed",
        trained: false,
        geometry: "passable",
        hiddenFactor: "beneath_surface",
        structuralFailure: false,
        plural: "flooded dips",
        withArticle: "a flooded dip",
        object: "muddy water",
        heightFact: "the water surface is flat and level",
        appearance: "A dip in the track is filled with muddy brown water; no bottom is visible.",
        cardText: "A dip in the track filled with muddy brown water; the bottom cannot be seen."
    },
    {
        id: "tall_reeds",
        label: "Tall reeds",
        classId: "novel_needed",
        trained: false,
        geometry: "passable",
        hiddenFactor: "behind",
        structuralFailure: false,
        plural: "tall reeds",
        withArticle: "tall reeds",
        object: "reed bed",
        heightFact: "the stems are thin and bend, but they stand taller than the vehicle",
        appearance: "Tall, dense reeds fill the track and grow higher than the vehicle; the ground among them cannot be seen.",
        cardText: "Tall, dense reeds filling the track, higher than the vehicle; the ground cannot be seen."
    },
    {
        id: "smoke_drift",
        label: "Drifting smoke",
        classId: "novel_needed",
        trained: false,
        geometry: "passable",
        hiddenFactor: "obscurant",
        structuralFailure: false,
        plural: "drifting smoke",
        withArticle: "drifting smoke",
        object: "smoke",
        heightFact: "the track ahead is flat as far as it can measure",
        appearance: "Thick smoke drifts across the track and hides the ground beyond it.",
        cardText: "Thick smoke drifting across the track, hiding the ground beyond."
    },
    {
        id: "low_berm",
        label: "Low mound",
        classId: "novel_handled",
        trained: false,
        geometry: "passable",
        hiddenFactor: null,
        structuralFailure: false,
        plural: "low mounds",
        withArticle: "a low mound",
        object: "mound",
        heightFact: "it rises less than its ground clearance, with gentle slopes",
        appearance: "A low grassy bank runs across the track, with the two wheel ruts worn bare over it.",
        cardText: "A low grassy bank running across the track, the wheel ruts worn bare over it."
    },
    {
        id: "fallen_sapling",
        label: "Fallen sapling",
        classId: "novel_handled",
        trained: false,
        geometry: "passable",
        hiddenFactor: null,
        structuralFailure: false,
        plural: "fallen saplings",
        withArticle: "a fallen sapling",
        object: "sapling",
        heightFact: "its thin trunk lies flat, lower than its ground clearance, and the twigs bend",
        appearance: "A thin young tree has fallen across the track; its trunk is about as thick as an arm.",
        cardText: "A thin young tree lying across the track; its trunk is about as thick as an arm."
    },
    {
        id: "gravel_ford",
        label: "Gravel ford",
        classId: "novel_handled",
        trained: false,
        geometry: "passable",
        hiddenFactor: null,
        structuralFailure: false,
        plural: "gravel fords",
        withArticle: "a gravel ford",
        object: "stream",
        heightFact: "it senses the firm gravel bed under the clear water, only a few centimetres down",
        appearance: "A shallow stream crosses the track over a gravel bed you can see clearly.",
        cardText: "A shallow, clear stream crossing the track over a gravel bed."
    }
];
/**
 * Scenes used only for training practice and the capability-judgment cards
 * (8 trained cases and 4 near-transfer, before and after the mission; after the mission the held-back mission
 * kinds are added as far transfer, see training/content.ts judgmentCards). None
 * shows a bridge, a hidden defect or a structural failure (point 5 of brief
 * section 7). Ground truth is the robot's actual rule: robotBehaviour() of the
 * same facts the simulation uses.
 */
export const CARD_KINDS = [
    {
        id: "small_debris_b",
        label: "Small debris",
        transfer: "trained",
        variantOf: "small_debris",
        geometry: "passable",
        hiddenFactor: null,
        structuralFailure: false,
        plural: "small debris",
        withArticle: "small debris",
        object: "twigs and pebbles",
        heightFact: "every piece is lower than its ground clearance",
        appearance: "Twigs, pine cones and pebbles are spread along the track. The pieces are small and brown, scattered loosely across both wheel ruts and the grass in between.",
        cardText: "Twigs and pebbles spread along the track."
    },
    {
        id: "fallen_tree_b",
        label: "Fallen tree",
        transfer: "trained",
        variantOf: "fallen_tree",
        geometry: "blocked",
        hiddenFactor: null,
        structuralFailure: false,
        plural: "fallen trees",
        withArticle: "a fallen tree",
        object: "trunk",
        heightFact: "it is taller than its ground clearance and spans the full width of the track",
        appearance: "Another fallen tree lies across the full width of the track. Its trunk is thick and straight, its bark is pale grey and weathered, and dark leaves still cover the far end.",
        cardText: "A fallen tree with pale grey bark lying across the track."
    },
    {
        id: "fallen_pole",
        label: "Fallen pole",
        transfer: "near",
        geometry: "blocked",
        hiddenFactor: null,
        structuralFailure: false,
        plural: "fallen poles",
        withArticle: "a fallen pole",
        object: "pole",
        heightFact: "it is taller than its ground clearance and spans the track",
        appearance: "A wooden utility pole has fallen and lies across the track.",
        cardText: "A wooden utility pole lying across the track."
    },
    {
        id: "stalled_tractor",
        label: "Stalled tractor",
        transfer: "near",
        geometry: "blocked",
        hiddenFactor: null,
        structuralFailure: false,
        plural: "stalled tractors",
        withArticle: "a stalled tractor",
        object: "tractor",
        heightFact: "it is a solid object much taller than the UGV, filling the track",
        appearance: "A broken-down tractor stands across the track.",
        cardText: "A broken-down farm tractor standing across the track."
    },
    {
        id: "flat_litter",
        label: "Flat litter",
        transfer: "near",
        geometry: "passable",
        hiddenFactor: null,
        structuralFailure: false,
        plural: "flat litter",
        withArticle: "flat litter",
        object: "litter",
        heightFact: "every piece lies flat, lower than its ground clearance",
        appearance: "Flattened cardboard and plastic sheeting lie on the track.",
        cardText: "Flattened cardboard and plastic sheeting lying on the track."
    },
    {
        id: "dry_ditch",
        label: "Shallow ditch",
        transfer: "near",
        geometry: "passable",
        hiddenFactor: null,
        structuralFailure: false,
        plural: "shallow ditches",
        withArticle: "a shallow ditch",
        object: "ditch",
        heightFact: "its sides are gentle and its floor is well within reach of the wheels",
        appearance: "A shallow, dry ditch with gentle sides crosses the track.",
        cardText: "A shallow, dry ditch with gentle sides crossing the track."
    }
];
/** Any scene kind by id (mission or card-only). */
export function sceneKindById(id) {
    const def = EVENT_KINDS.find((k) => k.id === id) ?? CARD_KINDS.find((k) => k.id === id);
    if (!def)
        throw new Error(`unknown scene kind ${id}`);
    return def;
}
/** The derivation rule: behaviour follows from the capability facts alone. */
export function robotBehaviour(kind) {
    if (kind.hiddenFactor !== null)
        return "unresolvable";
    if (kind.geometry === "blocked")
        return "needs_operator";
    return "continues";
}
/** The operator action that resolves each behaviour correctly. */
export function correctAction(behaviour) {
    return behaviour === "continues" ? "none" : "reroute";
}
/** Which behaviour each research class must produce (checked by test). */
export const CLASS_BEHAVIOUR = {
    robot_handled: "continues",
    operator_needed: "needs_operator",
    novel_handled: "continues",
    novel_needed: "unresolvable",
    critical_novel: "unresolvable"
};
/** Held back from training: the novel classes and the critical event. */
export const isHeldBack = (classId) => classId === "novel_handled" || classId === "novel_needed" || classId === "critical_novel";
/** Classes where the correct action is to take over. */
export const needsOperator = (classId) => CLASS_BEHAVIOUR[classId] !== "continues";
export function eventKindById(id) {
    const def = EVENT_KINDS.find((k) => k.id === id);
    if (!def)
        throw new Error(`unknown event kind ${id}`);
    return def;
}
