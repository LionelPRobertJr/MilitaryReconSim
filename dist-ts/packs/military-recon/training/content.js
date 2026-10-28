// Study 2 training content, GENERATED from the event-definition file (brief
// section 7, point 1: "the robot's event behaviour and the C4 training text
// are generated from the same data file"). Nothing here hard-codes which
// event is robot-handled or operator-needed: every verdict comes from
// robotBehaviour() applied to the same capability facts the simulation uses,
// and every case list is built from the definitions' classes.
//
// Matching rules (brief section 7, points 3-5 and "Matching requirements"):
//  - C3 and C4 share the same pages, the same images in the same order, the
//    same practice items and the same number of words (within 5%). Where C4
//    shows the robot's view (height map) and reasons, C3 shows a second camera
//    angle and an equal-length description of the object's appearance; where
//    C4 states the capability boundary, C3 gives an equal-length neutral
//    paragraph about the vehicles.
//  - C1 and C2 reuse C3's pages, examples and practice, changing only the
//    instruction sentence (and their comprehension questions).
//  - No page, example, practice item or judgment card shows a bridge, a hidden
//    defect or a structural failure.
//  - No page, example or practice item shows a HELD-BACK kind (event-definitions.ts, Oct 10, 2026): those are the
//    mission's new obstacles, where only an understanding of the robot (C4) gives the right answer.
// training.test.ts enforces all of this.
import { CAPABILITY_BOUNDARY, CARD_KINDS, EVENT_KINDS, robotBehaviour } from "../sim/event-definitions.js";
export const VERDICT_LABEL = { handles: "Robot handles it", needs_you: "Needs you" };
/**
 * C1 and C2 are taught a rule about what YOU do (Study 1's instruction sets), so their examples and
 * practice are labelled with what that rule says to do, not with what the robot can do. Otherwise C2's
 * "any obstacle" rule would sit next to "Robot handles it" labels (playtest, Oct 2026). The answer codes
 * stay the same: "needs_you" = take over, "handles" = leave it to the UGV.
 */
export const RULE_LABEL = { handles: "Leave it to the UGV", needs_you: "Take over" };
const ruleFramed = (set) => set === "C1" || set === "C2";
/** The answer a condition's training gives for a scene: C2's rule says take over for every obstacle; the others follow the robot's capability. */
export function trainingVerdict(set, kind) {
    return set === "C2" ? "needs_you" : verdictOf(kind);
}
export function labelsFor(set) {
    return ruleFramed(set) ? RULE_LABEL : VERDICT_LABEL;
}
const DEFAULT_DEFS = { events: EVENT_KINDS, cards: CARD_KINDS, boundary: CAPABILITY_BOUNDARY };
export function verdictOf(kind) {
    return robotBehaviour(kind) === "continues" ? "handles" : "needs_you";
}
const HIDDEN_PHRASE = { beneath_surface: "what is beneath the surface", behind: "what is behind it", obscurant: "through it" };
/**
 * C4's reason for a verdict, generated from the capability facts. Since Oct 11, 2026 every reason walks through the
 * two questions of the "How a UGV decides" page, so participants practise the procedure they need for new obstacles.
 */
export function capabilityReason(kind) {
    const b = robotBehaviour(kind);
    if (b === "continues")
        return `Taller than its ground clearance? No. Anything it needs hidden? No. It measures the ${kind.object}: ${kind.heightFact}, so it drives on.`;
    if (b === "needs_operator")
        return `Taller than its ground clearance? Yes. It measures the ${kind.object}: ${kind.heightFact}, so it stops and needs you to send it around.`;
    return `Anything it needs hidden? Yes. It cannot sense ${HIDDEN_PHRASE[kind.hiddenFactor]}, so it cannot judge whether the ${kind.object} is safe, and it needs you before it drives in.`;
}
function itemText(kind, set) {
    // C2: say plainly that the rule covers scenes the UGV could pass too (research team decision, Oct 10, 2026: a
    // playtester could not square "take over everything" with seeing the UGV drive through things).
    const c2Passable = set === "C2" && verdictOf(kind) === "handles" ? " The UGV could drive through this by itself, but your rule is to take over whenever it meets any obstacle." : "";
    return `${labelsFor(set)[trainingVerdict(set, kind)]}. ${set === "C4" ? capabilityReason(kind) : kind.appearance}${c2Passable}`;
}
function images(kindId, set) {
    return [
        { sceneId: kindId, view: "camera" },
        { sceneId: kindId, view: set === "C4" ? "height_map" : "second_angle" }
    ];
}
function list(items, conj) {
    return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} ${conj} ${items.at(-1)}`;
}
/** The trained cases, in the order the examples present them: alternating robot-handled and operator-needed. */
export function trainedKinds(defs = DEFAULT_DEFS) {
    const trained = defs.events.filter((k) => k.trained && !k.structuralFailure);
    const handles = trained.filter((k) => verdictOf(k) === "handles");
    const needs = trained.filter((k) => verdictOf(k) === "needs_you");
    const out = [];
    for (let i = 0; i < Math.max(handles.length, needs.length); i++) {
        if (handles[i])
            out.push(handles[i]);
        if (needs[i])
            out.push(needs[i]);
    }
    return out;
}
/** The instruction sentence(s) for each condition (brief section 7 table), with case lists generated from the definitions. */
export function instruction(set, defs = DEFAULT_DEFS) {
    const kinds = trainedKinds(defs);
    const needs = kinds.filter((k) => verdictOf(k) === "needs_you");
    const handles = kinds.filter((k) => verdictOf(k) === "handles");
    const caseList = `UGVs need you for ${list(needs.map((k) => k.plural), "and")}. They handle ${list(handles.map((k) => k.plural), "and")} themselves.`;
    switch (set) {
        case "C1":
            return `Take over only when a UGV meets ${list(needs.map((k) => k.withArticle), "or")}.`;
        case "C2":
            return "Take over whenever a UGV meets any obstacle.";
        case "C3":
        case "C4":
            return caseList;
    }
}
/** C4's capability-boundary paragraph, from CAPABILITY_BOUNDARY. */
function boundaryParagraph(defs) {
    const b = defs.boundary;
    return `Why: a UGV judges the terrain by ${b.senses}. It cannot judge ${list([...b.cannotJudge.slice(0, -1)], "or")}, and it cannot see ${b.cannotJudge.at(-1)}. ${b.rule}`;
}
/** C1-C3's neutral paragraph in the same place, matched in length (brief section 7, point 4). */
const VEHICLE_PARAGRAPH = "About the vehicles: each UGV is a six-wheeled robot about the size of a small car. Its forward camera is what you see through the windscreen in its panel, and the view moves as it drives along. It drives at a steady pace along its own route, and more slowly whenever it follows waypoints that you chose for it.";
const RECAP_RULE = (_defs) => "For anything you meet, ask the two questions: is any part taller than its ground clearance, and is anything it needs hidden from it? If either answer is yes, it needs you.";
const RECAP_NEUTRAL = "For anything you meet, compare it with the six cases: does it look like one the UGVs handle, or like one that needs you? Keep an eye on both camera views and both status lights.";
/**
 * The page after the rule (Oct 11, 2026). C4: "How a UGV decides", the three capability facts and the two questions
 * (from CAPABILITY_BOUNDARY). C1-C3: an equal-length page on what the six trained cases look like, with no
 * capability terms (brief section 7, point 4: matched length, no causal model outside C4).
 */
function principlesPage(set, defs) {
    if (set === "C4") {
        return {
            id: "principles",
            title: "How a UGV decides",
            paragraphs: ["Three facts explain every case in this training, and they also apply to anything else a UGV meets.", ...defs.boundary.facts.map((f, i) => `${i + 1}. ${f}`), defs.boundary.questions],
            examples: []
        };
    }
    const kinds = trainedKinds(defs);
    const handles = kinds.filter((k) => verdictOf(k) === "handles");
    const needs = kinds.filter((k) => verdictOf(k) === "needs_you");
    return {
        id: "principles",
        title: "What the six cases look like",
        paragraphs: [
            "The examples on the next pages show six kinds of scene. Here is what each one looks like, so you can spot it quickly in a camera view.",
            `1. The UGVs handle these themselves. ${handles.map((k) => CASE_LOOK[k.id] ?? k.appearance).join(" ")}`,
            `2. These need you. ${needs.map((k) => CASE_LOOK[k.id] ?? k.appearance).join(" ")}`,
            "3. All of them are off-road. Every scene is on the dirt tracks the vehicles follow, and you see each one through the windscreen as the vehicle slowly drives closer.",
            "So for anything you meet, ask two questions. Which of the six scenes does it look most like? And is it one of the three the UGVs handle, or one of the three that need you? The next pages show each scene from two camera angles. In the mission, compare what you see with them as the vehicle comes closer, and then follow the rule on the previous page."
        ],
        examples: []
    };
}
/** Short descriptions of the six trained cases for the C1-C3 page (purely visual; no capability terms). */
const CASE_LOOK = {
    small_debris: "Small debris is stones and broken branches scattered across the track, mostly about the size of a fist.",
    shallow_water: "Shallow water is a thin, pale sheet lying flat across the track, with a few pebbles showing in it.",
    light_brush: "Light brush is thin, pale green grass and low plants growing over the edges of the track.",
    rubble_pile: "A rubble pile is a lumpy brown heap of broken rock and earth across the whole track, about as high as the vehicle.",
    fallen_tree: "A fallen tree is a thick, dark trunk lying across the full width of the track, its leaves at one end.",
    abandoned_vehicle: "An abandoned vehicle is a stalled green truck standing across the track, its door left open."
};
export function buildModule(set, defs = DEFAULT_DEFS) {
    const kinds = trainedKinds(defs);
    const example = (k) => ({ kindId: k.id, verdict: trainingVerdict(set, k), images: images(k.id, set), text: itemText(k, set) });
    const examplePages = [];
    for (let i = 0; i < kinds.length; i += 2) {
        examplePages.push({
            id: ["examples_1", "examples_2", "examples_3"][i / 2],
            title: `Examples ${i / 2 + 1} of ${Math.ceil(kinds.length / 2)}`,
            paragraphs: [set === "C4" ? "Left: the camera view. Right: the robot's view, a height map of what its sensors measure (ground is dark blue, objects below its ground clearance are teal, taller ones orange)." : "Left: the camera view. Right: a second camera angle of the same scene, taken from higher up and off to one side, so you see it from another direction."],
            examples: kinds.slice(i, i + 2).map(example)
        });
    }
    const practiceKinds = practiceOrder(defs);
    const practiceItems = practiceKinds.map((k, i) => ({
        id: `P${i + 1}`,
        kindId: k.id,
        images: images(k.id, set),
        answer: trainingVerdict(set, k),
        feedback: itemText(k, set)
    }));
    return {
        instructionSet: set,
        pages: [
            {
                id: "role",
                title: "Your role",
                paragraphs: [
                    "In the mission you supervise two unmanned ground vehicles (UGVs) on an off-road reconnaissance route. When a UGV sees something on the track ahead, its light turns yellow while it judges it. If it judges it can get through, it drives on and the light turns green again. If not, it stops and waits for you, which costs points. Taking over when it could have got through by itself also costs points.",
                    "This short module shows you when to take over. Taking over means sending the UGV around what is in its way: click one of the waypoints shown beside it in the UGV's camera view. You can do this as soon as it appears, and you can also press Stop to halt a UGV while you look. Take your time: the mission starts after it."
                ],
                examples: []
            },
            {
                id: "rule",
                title: "When to take over",
                paragraphs: [instruction(set, defs), set === "C4" ? boundaryParagraph(defs) : VEHICLE_PARAGRAPH],
                examples: []
            },
            principlesPage(set, defs),
            ...examplePages,
            {
                id: "practice",
                title: "Practice",
                paragraphs: [`${ruleFramed(set) ? "Decide for each scene whether you should take over." : "Decide for each scene whether the UGV handles it or needs you."} You need ${PRACTICE_CRITERION} of ${practiceItems.length} correct; otherwise the set repeats (at most ${PRACTICE_MAX_ROUNDS} rounds).`],
                examples: []
            },
            {
                id: "recap",
                title: "Remember",
                paragraphs: [instruction(set, defs), set === "C4" ? RECAP_RULE(defs) : RECAP_NEUTRAL],
                examples: []
            }
        ],
        practice: { items: practiceItems, criterion: PRACTICE_CRITERION, maxRounds: PRACTICE_MAX_ROUNDS, prompt: ruleFramed(set) ? "Should you take over here?" : "Does the UGV handle this itself, or does it need you?", labels: labelsFor(set) },
        comprehension: comprehension(set, defs)
    };
}
export const PRACTICE_CRITERION = 7;
export const PRACTICE_MAX_ROUNDS = 3;
/** The 8 practice scenes: the six trained cases plus a second picture of two of them, balanced 4 / 4. */
export function practiceOrder(defs = DEFAULT_DEFS) {
    const variants = defs.cards.filter((c) => c.transfer === "trained");
    const kinds = trainedKinds(defs);
    const byId = (id) => [...kinds, ...variants].find((k) => k.id === id);
    // Fixed order: variants first and last so the same picture never appears twice in a row.
    const order = [variants[0].id, kinds[5].id, kinds[2].id, variants[1].id, kinds[4].id, kinds[1].id, kinds[0].id, kinds[3].id];
    return order.map(byId);
}
function yesNo(id, prompt, yes) {
    return { id, prompt, options: [{ id: "yes", text: "Yes" }, { id: "no", text: "No" }], correct: yes ? "yes" : "no", relatedPageId: "rule" };
}
/** Three comprehension questions per condition (brief section 7). Answers follow each condition's own instruction. */
export function comprehension(set, defs = DEFAULT_DEFS) {
    const kinds = trainedKinds(defs);
    const handles = kinds.filter((k) => verdictOf(k) === "handles");
    const needs = kinds.filter((k) => verdictOf(k) === "needs_you");
    const rh = handles[0];
    const on = needs[0];
    const lists = {
        needs: `Only for ${list(needs.map((k) => k.plural), "and")}`,
        any: "Whenever a UGV meets any obstacle",
        asks: "Only when a UGV stops and waits for me"
    };
    switch (set) {
        case "C1":
            return [
                yesNo("Q1", `Should you take over when a UGV meets ${rh.withArticle}?`, false),
                yesNo("Q2", `A UGV meets ${on.withArticle}. Should you take over?`, true),
                { id: "Q3", prompt: "When should you take over?", options: [{ id: "a", text: lists.needs }, { id: "b", text: lists.any }, { id: "c", text: lists.asks }], correct: "a", relatedPageId: "rule" }
            ];
        case "C2":
            return [
                yesNo("Q1", `Should you take over when a UGV meets ${rh.withArticle}?`, true),
                yesNo("Q2", `A UGV meets ${on.withArticle}. Should you take over?`, true),
                { id: "Q3", prompt: "When should you take over?", options: [{ id: "a", text: lists.needs }, { id: "b", text: lists.any }, { id: "c", text: lists.asks }], correct: "b", relatedPageId: "rule" }
            ];
        case "C3":
            return [
                yesNo("Q1", `Should you take over when a UGV meets ${rh.withArticle}?`, false),
                yesNo("Q2", `A UGV meets ${on.withArticle}. Should you take over?`, true),
                {
                    id: "Q3",
                    prompt: "Which of these do the UGVs handle themselves?",
                    options: [
                        { id: "a", text: capitalise(list(handles.map((k) => k.plural), "and")) },
                        { id: "b", text: capitalise(list(needs.map((k) => k.plural), "and")) },
                        { id: "c", text: "Anything they meet on the track" }
                    ],
                    correct: "a",
                    relatedPageId: "rule"
                }
            ];
        case "C4":
            // One question per capability fact, each about a scene that is in neither the training nor the mission
            // (Oct 11, 2026). A wrong answer shows the "How a UGV decides" page again.
            return [
                {
                    id: "Q1",
                    prompt: "A wide concrete slab, only ankle-high, lies across the track. What does a UGV do?",
                    options: [
                        { id: "a", text: "Drives over it: it is lower than its ground clearance" },
                        { id: "b", text: "Stops and waits for you: it is wide and solid" },
                        { id: "c", text: "Stops and waits for you: it was never trained on concrete" }
                    ],
                    correct: "a",
                    relatedPageId: "principles"
                },
                {
                    id: "Q2",
                    prompt: "Fresh snow covers the track ahead. Why does a UGV need you there?",
                    options: [
                        { id: "a", text: "It cannot sense what is beneath the snow" },
                        { id: "b", text: "Snow is taller than its ground clearance" },
                        { id: "c", text: "It does not need you: the snow is flat" }
                    ],
                    correct: "a",
                    relatedPageId: "principles"
                },
                {
                    id: "Q3",
                    prompt: "Thick fog hides the ground ahead. Does a UGV need you?",
                    options: [
                        { id: "a", text: "Yes: it cannot see through the fog, so it cannot judge what is there" },
                        { id: "b", text: "No: fog is not solid, so it drives on" },
                        { id: "c", text: "Only if the fog is taller than the vehicle" }
                    ],
                    correct: "a",
                    relatedPageId: "principles"
                }
            ];
    }
}
const capitalise = (t) => t.charAt(0).toUpperCase() + t.slice(1);
/**
 * 18 cards, identical in every condition: 8 trained cases and 4 near-transfer (cards 0-11, rated before AND after the
 * mission), and 6 far-transfer cards (12-17, after the mission only): the held-back kinds the mission introduced,
 * never in training (Oct 10, 2026). The pre-mission set leaves them out so the mission is the first time anyone
 * meets them. The bridge is never a card (brief section 7, point 5).
 */
export function judgmentCards(defs = DEFAULT_DEFS) {
    const trained = [...trainedKinds(defs), ...defs.cards.filter((c) => c.transfer === "trained")];
    const near = defs.cards.filter((c) => c.transfer === "near");
    const far = defs.events.filter((k) => !k.trained && !k.structuralFailure);
    const card = (k, transfer) => ({ id: `J-${k.id}`, kindId: k.id, transfer, sceneId: k.id, text: k.cardText, answer: verdictOf(k) });
    return [...trained.map((k) => card(k, "trained")), ...near.map((k) => card(k, "near")), ...far.map((k) => card(k, "far"))];
}
/** Fixed presentation orders: the post-mission set is the same 12 cards re-ordered, with the 6 far-transfer cards mixed in. */
const PRE_ORDER = [3, 11, 0, 6, 9, 1, 4, 7, 10, 2, 5, 8];
const POST_ORDER = [12, 5, 9, 16, 1, 3, 13, 10, 7, 0, 17, 4, 11, 14, 2, 8, 15, 6];
export function judgmentDeck(phase, defs = DEFAULT_DEFS) {
    const cards = judgmentCards(defs);
    return (phase === "pre" ? PRE_ORDER : POST_ORDER).map((i) => cards[i]);
}
// --- text extraction for the matching checks --------------------------------------
/** Every word a participant reads in the module (pages, examples, practice prompt and feedback), in order. */
export function moduleText(m) {
    const parts = [];
    for (const p of m.pages) {
        parts.push(p.title, ...p.paragraphs, ...p.examples.map((e) => e.text));
        if (p.id === "practice")
            parts.push(m.practice.prompt, ...m.practice.items.map((i) => i.feedback));
    }
    return parts.join("\n");
}
/** The images a participant sees, in order (scene ids only - the view type is the C3/C4 difference). */
export function moduleSceneSequence(m) {
    return [...m.pages.flatMap((p) => p.examples.flatMap((e) => e.images.map((i) => i.sceneId))), ...m.practice.items.flatMap((i) => i.images.map((x) => x.sceneId))];
}
