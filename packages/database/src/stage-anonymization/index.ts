/** The public surface of the stage anonymization chain (S6): the composed run and the register it runs on. */
export { ANONYMIZATION_REGISTER } from "../anonymization-register.js";
export { runStageAnonymization, type StageRunInput } from "./stage-run.js";
export type { RunnerResult } from "./runner.js";
export type { SqlClient } from "./prisma-adapter.js";
