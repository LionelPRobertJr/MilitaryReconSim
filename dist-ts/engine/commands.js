export const CORE_COMMAND_KINDS = new Set(["end_session", "drt_respond", "sart_submit"]);
export function isCoreCommand(cmd) {
    return CORE_COMMAND_KINDS.has(cmd.kind);
}
