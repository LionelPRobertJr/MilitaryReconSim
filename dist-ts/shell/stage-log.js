// Event log for participant-paced stages outside the simulation (training,
// questionnaires, judgment tasks). Same EventLogger and JSONL format as the
// engine; `t` is seconds since the log was created, from an injectable clock
// so tests are deterministic. Wall-clock ISO timestamps and per-stage upload
// arrive with the participant shell (Study 2 milestone M4).
import { EventLogger } from "../engine/events.js";
export class StageLog {
    clock;
    logger = new EventLogger();
    t0;
    constructor(clock = () => performance.now()) {
        this.clock = clock;
        this.t0 = clock();
    }
    /** Seconds since the log was created. */
    now() {
        return Math.round(this.clock() - this.t0) / 1000;
    }
    record(event) {
        this.logger.record({ ...event, t: event.t ?? this.now() });
    }
    all() {
        return this.logger.all();
    }
    toJSONL() {
        return this.logger.toJSONL();
    }
}
