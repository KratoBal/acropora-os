import { pathToFileURL } from "node:url";

import { UnasApiClient } from "./unas-api.client.js";
import {
  normalizeUnasProbeError,
  parseUnasProbeOptions,
  runUnasReadonlyProbe,
  type UnasReadonlyProbeClient,
} from "./unas-readonly-probe.js";

export interface UnasProbeOutput {
  stdout(value: string): void;
  stderr(value: string): void;
}

const processOutput: UnasProbeOutput = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

export async function main(
  argv: readonly string[],
  client: UnasReadonlyProbeClient = new UnasApiClient(),
  output: UnasProbeOutput = processOutput,
): Promise<number> {
  try {
    const options = parseUnasProbeOptions(argv);
    const summary = await runUnasReadonlyProbe(client, options);
    output.stdout(`${JSON.stringify(summary)}\n`);
    return 0;
  } catch (error) {
    output.stderr(
      `${JSON.stringify({ ok: false, errorCode: normalizeUnasProbeError(error) })}\n`,
    );
    return 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  process.exitCode = await main(process.argv.slice(2));
}
