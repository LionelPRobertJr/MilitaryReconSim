import { DEFAULT_PLATFORM } from "../../../shell/participant/platform.js";
export const DEFAULT_DEPLOYMENT = {
    deploymentVersion: "local-dev",
    phase: "pilot",
    configFile: "config/study2/recon-config-pilot-1.json",
    studyId: "study2-local",
    assignEndpoint: "/api/participant/assign",
    uploadEndpoint: "/api/participant/upload",
    platform: DEFAULT_PLATFORM,
    payment: { currency: "$", basePayment: "the amount shown on the study page", bonusPerPoint: 0.001, bonusCap: 2 },
    minWindow: { width: 1280, height: 720 }
};
export async function loadDeployment(url = "./deployment.recon.json") {
    try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok)
            return DEFAULT_DEPLOYMENT;
        const d = (await res.json());
        return {
            ...DEFAULT_DEPLOYMENT,
            ...d,
            platform: { ...DEFAULT_PLATFORM, ...(d.platform ?? {}) },
            payment: { ...DEFAULT_DEPLOYMENT.payment, ...(d.payment ?? {}) },
            minWindow: { ...DEFAULT_DEPLOYMENT.minWindow, ...(d.minWindow ?? {}) }
        };
    }
    catch {
        return DEFAULT_DEPLOYMENT;
    }
}
