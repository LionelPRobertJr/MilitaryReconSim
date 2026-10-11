import { Engine } from "../../../engine/engine.js";
import { militaryReconPack } from "./pack.js";
/** The shared engine running the Military Recon pack. */
export class ReconSimulation extends Engine {
    constructor(options = {}) {
        super(militaryReconPack, options);
    }
    /** Static map geometry (routes, bypasses, nodes) for this seed. */
    get network() {
        return this.session.network;
    }
    availableActions(robotId) {
        return this.session.availableActions(robotId);
    }
    /** Why each action is unavailable right now (null = available). */
    actionReasons(robotId) {
        return this.session.actionReasons(robotId);
    }
    /** The bypass a take-over would follow right now (the UI shows its waypoints beside the obstacle), or null. */
    rerouteTarget(robotId) {
        return this.session.rerouteTarget(robotId);
    }
    /** UI-originated measures (brief section 10's camera_view / robot_select); not commands, they change nothing. */
    logCameraView(robotId) {
        if (this.isEnded())
            return;
        this.logger.record({ t: this.snapshotTime(), type: "camera_view", robotId });
    }
    logRobotSelect(robotId) {
        if (this.isEnded())
            return;
        this.logger.record({ t: this.snapshotTime(), type: "robot_select", robotId });
    }
    snapshotTime() {
        return this.world.simTime;
    }
}
