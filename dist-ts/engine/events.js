// Event schema version. Bump whenever a field is added/removed/renamed so
// external analysis scripts can detect incompatible logs (brief section 9).
// v2 (Sept 2026): added AssignmentCreatedEvent.auto, FaultConfirmedEvent.auto
// (both distinguish an operator-issued action from one the autonomyMode
// system performed on the robot's own initiative - see simulation.ts's
// autoAssignIdleRobots/checkFaultResolutions) and the new CommandQueuedEvent
// (SimConfig.commandDelaySeconds - logs the moment a robot-directed command
// is received, separately from whichever event logs the moment it actually
// takes effect, so analysis can recover the transit delay itself).
// v3 (Sept 2026): added the periodic self-report check (SimConfig.sart*) -
// SartScheduleEvent, SartCheckOnsetEvent, SartResponseEvent - a free-text
// fleet-status report plus a 3D-SART situation-awareness rating, submitted
// together. Purely additive, same as v2's CommandQueuedEvent addition.
// v4 (Oct 2026, Study 2 M1 engine extraction): session_start and summary.json
// now carry domain (the scenario pack), packVersion and engineVersion right
// after schemaVersion, and config gains a leading `domain` field (so every
// config hash changes). Also fixes a long-standing bug: session_start and
// summary.json had schemaVersion hard-coded to 1 instead of this constant.
// Moon Base events are otherwise unchanged from v3.
// v5 (Oct 2026, Study 2 M2): adds the shared pause_start/pause_end events
// (probe stages) and the Military Recon pack's event types. Moon Base logs are
// unchanged apart from this version number.
export const LOG_SCHEMA_VERSION = 5;
export class EventLogger {
    events = [];
    listeners = [];
    record(event) {
        this.events.push(event);
        for (const fn of this.listeners)
            fn(event);
    }
    /**
     * Calls fn with every event recorded from now on, at the moment it is
     * recorded (the participant shell uses this to stamp wall-clock time and
     * stage onto simulation events as they happen). Observing only: it cannot
     * change or reorder the log. Returns an unsubscribe function.
     */
    subscribe(fn) {
        this.listeners.push(fn);
        return () => {
            this.listeners = this.listeners.filter((l) => l !== fn);
        };
    }
    all() {
        return this.events;
    }
    toJSONL() {
        return this.events.map((e) => JSON.stringify(e)).join("\n");
    }
}
