// The scenario-pack interface (Study 2 brief section 12).
//
// The shared engine (engine.ts) owns everything that affects timing, logging
// or measurement: the fixed-step clock, the command queue and its comms
// delay, the video delay, session start/end, the event logger, config
// hashing, export, and the shared measurement instruments (DRT, SART,
// post-session questionnaires). A scenario pack supplies content: its world,
// its robots' behaviour, its own commands, events and summary metrics.
//
// A pack never advances the clock and never decides when a tick happens. It
// declares, as data, the ordered list of systems that run inside one tick
// (`tick`) and at session start (`startup`), with the engine's instrument
// phases placed explicitly among them. The engine checks that every
// instrument phase appears exactly once, so a pack cannot silently drop or
// duplicate a measurement step. Order matters: events from the same tick are
// logged in the order these systems run, and the logs are a research output.
export const INSTRUMENT_TICK_PHASES = ["drt.trigger", "drt.timeout", "drt.powerLossRecovery", "sart.trigger"];
export const INSTRUMENT_STARTUP_STEPS = ["drt.schedule", "sart.schedule"];
