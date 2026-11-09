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
export { runTrial, type TrialRunOptions } from "./trial-run.js";
export { runTrialFlows } from "./trial-flows.js";
export { withTrialCopy } from "./trial-copy.js";
export { createTrialCommand } from "./trial-command.js";
export { createTrialDatabase, type TrialDatabase } from "./trial-database.js";
export { withDatabaseName } from "./trial-environment.js";
/** The Prisma client class, for a caller that must not import the package's main entry (its module makes a client from the environment on load). */
export { PrismaClient } from "@prisma/client";
