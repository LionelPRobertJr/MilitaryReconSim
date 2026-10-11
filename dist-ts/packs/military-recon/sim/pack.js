import { createStream } from "../../../engine/rng.js";
import { RECON_DEFAULT_CONFIG } from "./config.js";
import { buildRouteNetwork } from "./route.js";
import { createReconWorld, ReconSession } from "./session.js";
/** Version of the Military Recon pack; logged in every session_start. */
export const RECON_PACK_VERSION = "0.2.0";
/** The Military Recon scenario pack (Study 2). */
export const militaryReconPack = {
    id: "military_recon",
    version: RECON_PACK_VERSION,
    defaultConfig: RECON_DEFAULT_CONFIG,
    defaultCondition: (config) => (config.tutorial ? "tutorial" : config.instructionSet),
    createWorld: (config) => createReconWorld(config, buildRouteNetwork(createStream(config.seed, "route-placement"), config.tutorial, config.routeSectionLength)),
    // The network is rebuilt from the same seeded stream, so the session sees exactly the world's layout.
    createSession: (ctx) => new ReconSession(ctx, buildRouteNetwork(ctx.stream("route-placement"), ctx.config.tutorial, ctx.config.routeSectionLength))
};
