import { createServer, type IncomingMessage, type Server } from "node:http";

/**
 * A FAKE API FOR THE TRIAL'S TESTS (not shipped: only the tests import it). It answers the calls the four flows make with the
 * answers the code was read to give, and records every request, so a test can check what the trial SENT (field by field) and how it
 * reacts when an answer is not what it expects. It proves the trial's handling; that the real API gives these answers is proved by
 * the API integration spec, which runs the flows against the real application.
 */
export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
}

export interface FakeApi {
  readonly url: string;
  readonly requests: RecordedRequest[];
  /** Replaces the answer of one route ("METHOD /path-pattern"): status and a JSON body. */
  readonly override: (route: string, status: number, body: unknown) => void;
  close(): Promise<void>;
}

const readBody = (request: IncomingMessage): Promise<unknown> =>
  new Promise((resolve) => {
    let raw = "";
    request.on("data", (chunk: Buffer) => (raw += chunk.toString("utf8")));
    request.on("end", () => {
      try {
        resolve(raw === "" ? undefined : JSON.parse(raw));
      } catch {
        resolve(undefined);
      }
    });
  });

export const FAKE_TOKEN = "mobile_fake-token-not-real";
export const FAKE_UPDATED_AT = "2026-11-09T12:00:00.123Z";

export async function startFakeApi(): Promise<FakeApi> {
  const requests: RecordedRequest[] = [];
  const overrides = new Map<string, { status: number; body: unknown }>();
  const answers: [string, number, unknown][] = [
    [
      "POST /auth/mobile/login/password",
      201,
      { token: FAKE_TOKEN, user: { id: "u1" } },
    ],
    ["POST /customers", 201, { id: "cust-1", customerNumber: "VEVO-1" }],
    ["GET /customers/cust-1", 200, { id: "cust-1" }],
    [
      "POST /billing/documents",
      201,
      {
        id: "inv-1",
        status: "DRAFT",
        updatedAt: FAKE_UPDATED_AT,
        totals: { grossAmount: "12700.0000" },
      },
    ],
    [
      "POST /billing/documents/inv-1/issue",
      200,
      { id: "inv-1", status: "ISSUED", documentNumber: "TESZT-2026-0a1b2c3d" },
    ],
    [
      "POST /pos/sales",
      201,
      { detail: { id: "sale-1", status: "COMPLETED" }, successCount: 1 },
    ],
    ["GET /pos/sales/sale-1", 200, { id: "sale-1" }],
    [
      "PUT /service/worksheets/customers/cust-1/partner-code",
      200,
      { id: "cust-1" },
    ],
    [
      "POST /service/worksheets/customers/cust-1/departments",
      201,
      { id: "dep-1" },
    ],
    ["POST /service/worksheets", 201, { id: "ws-1" }],
    [
      "GET /service/worksheets/ws-1",
      200,
      { id: "ws-1", currentVersion: { status: "DRAFT" } },
    ],
    ["POST /service/jobs", 201, { id: "job-1", jobNumber: "HJ-2026-001" }],
    ["GET /service/jobs/job-1", 200, { id: "job-1", status: "NEW" }],
    ["POST /service/jobs/job-1/move", 201, { id: "job-1", status: "TRIAGED" }],
    ["GET /health", 200, { application: "ok" }],
  ];
  const server: Server = createServer(async (request, response) => {
    const path = (request.url ?? "").split("?")[0]!;
    const route = `${request.method} ${path}`;
    requests.push({
      method: request.method ?? "",
      path,
      authorization: request.headers.authorization,
      body: await readBody(request),
    });
    const found =
      overrides.get(route) ??
      (() => {
        const hit = answers.find(([key]) => key === route);
        return hit ? { status: hit[1], body: hit[2] } : undefined;
      })();
    response.statusCode = found?.status ?? 404;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(found?.body ?? { message: "not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    override: (route, status, body) => overrides.set(route, { status, body }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
