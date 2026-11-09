/** The public surface of the stage anonymization chain (S6): the composed run and the register it runs on. */
export { ANONYMIZATION_REGISTER } from "../anonymization-register.js";
export { runStageAnonymization, type StageRunInput } from "./stage-run.js";
export type { RunnerResult } from "./runner.js";
export type { SqlClient } from "./prisma-adapter.js";
export {
  hashStagePassword,
  verifyStagePassword,
  MIN_STAGE_PASSWORD_LENGTH,
} from "./stage-password.js";
export {
  assessTrialIntegrations,
  CLOSED_URL,
  type ConnectionSettingState,
} from "./trial-integrations.js";
export { buildTrialEnvironment } from "./trial-environment.js";
export { parseTrialResult } from "./trial-result.js";
