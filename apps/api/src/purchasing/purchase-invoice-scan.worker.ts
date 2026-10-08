import { parentPort, workerData } from "node:worker_threads";

import { renderScanPdf, ScanUnreadable } from "./purchase-invoice-scan.js";

/** The scan conversion off the API's event loop (card 35fe9a08). */
const input = workerData as { bytes: Uint8Array; kind: "png" | "jpeg" };

if (parentPort) {
  const port = parentPort;
  renderScanPdf(input.bytes, input.kind).then(
    (bytes) =>
      port.postMessage({ ok: true, bytes }, [bytes.buffer as ArrayBuffer]),
    (error: unknown) =>
      port.postMessage({
        ok: false,
        unreadable: error instanceof ScanUnreadable,
        message: error instanceof Error ? error.message : String(error),
      }),
  );
}
