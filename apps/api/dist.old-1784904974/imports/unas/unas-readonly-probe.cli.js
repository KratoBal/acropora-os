import { pathToFileURL } from "node:url";
import { UnasApiClient } from "./unas-api.client.js";
import { normalizeUnasProbeError, parseUnasProbeOptions, runUnasReadonlyProbe, } from "./unas-readonly-probe.js";
const processOutput = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
};
export async function main(argv, client = new UnasApiClient(), output = processOutput) {
    try {
        const options = parseUnasProbeOptions(argv);
        const summary = await runUnasReadonlyProbe(client, options);
        output.stdout(`${JSON.stringify(summary)}\n`);
        return 0;
    }
    catch (error) {
        output.stderr(`${JSON.stringify({ ok: false, errorCode: normalizeUnasProbeError(error) })}\n`);
        return 1;
    }
}
const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
    process.exitCode = await main(process.argv.slice(2));
}
//# sourceMappingURL=unas-readonly-probe.cli.js.map