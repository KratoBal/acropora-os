import { type UnasReadonlyProbeClient } from "./unas-readonly-probe.js";
export interface UnasProbeOutput {
    stdout(value: string): void;
    stderr(value: string): void;
}
export declare function main(argv: readonly string[], client?: UnasReadonlyProbeClient, output?: UnasProbeOutput): Promise<number>;
