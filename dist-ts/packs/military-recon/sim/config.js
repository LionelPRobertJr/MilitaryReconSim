import { ENGINE_DEFAULTS } from "../../../engine/config.js";
export const INSTRUCTION_SETS = ["C1", "C2", "C3", "C4"];
/** The fixed list of study seeds (brief section 9: one per participant, balanced across conditions). */
export const RECON_STUDY_SEEDS = [2101, 2102, 2103, 2104];
export const RECON_DEFAULT_CONFIG = {
    domain: "military_recon",
    instructionSet: "C3",
    robotCount: 2,
    ...ENGINE_DEFAULTS,
    // Study 2 overrides of the shared engine fields: 24-minute mission, and the
    // Moon Base DRT/SART instruments are not part of this study.
    sessionLengthSeconds: 1440,
    seed: RECON_STUDY_SEEDS[0],
    drtEnabled: false,
    drtPowerLossEnabled: false,
    sartEnabled: false,
    routeSectionLength: 220,
    autonomousSpeed: 1.0,
    operatorGuidedSpeed: 0.7,
    detectionDistance: 10,
    assessingSpeed: 0.6,
    passDistance: 3.2,
    immobilisationRecoverySeconds: 30,
    probesEnabled: true,
    spotReportEnabled: true,
    spotReportIntervalSeconds: 20,
    spotReportNextAfterSubmitSeconds: 6,
    tutorial: false,
    scoring: {
        objectiveReachedPerUgv: 200,
        timeBonusPerSecond: 1,
        spotReportItemCorrect: 2,
        immobilisedPenalty: 100,
        stopPenalty: 50,
        unnecessaryTakeoverPenalty: 30
    }
};
