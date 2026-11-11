import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  FAKE_FINGERPRINT,
  FAKE_TOKEN,
  FAKE_UPDATED_AT,
  startFakeApi,
  type FakeApi,
} from "./trial-fake-api.test.js";
import { runTrialFlows } from "./trial-flows.js";

/*
  THE FOUR FLOWS (S-trial). WHAT TURNS THIS RED: a body that sends what the real API rejects (an invoice line without
  `discountPercent`, a POS line with a `variantId` key, an issue without the draft's own `updatedAt`, a ticket without its
  department); a step that fails but is not named, or whose dependents vanish instead of being reported; a token, the password or the
  body of a server error in a check name; a trial that passes when an answer is not the one it expects (not ISSUED, no TESZT number,
  not TRIAGED).
*/
const PASSWORD = "stage-jelszo-nem-igazi-1"; // scan-secrets: allow (an invented test string, not a credential)
let api: FakeApi;
beforeEach(async () => {
  api = await startFakeApi();
});
afterEach(async () => {
  await api.close();
});
const run = () =>
  runTrialFlows({
    baseUrl: api.url,
    email: "u1abc@teszt.acropora.invalid",
    password: PASSWORD,
    now: () => new Date("2026-11-09T10:00:00Z"),
    random: (alphabet, length) => alphabet[0]!.repeat(length),
  });
const sent = (method: string, path: string) =>
  api.requests.find((r) => r.method === method && r.path === path);

describe("a trial against an API that answers as the code was read to", () => {
  it("passes every named step, in order", async () => {
    const checks = await run();
    assert.deepEqual(
      checks.filter((c) => !c.passed),
      [],
    );
    assert.deepEqual(
      checks.map((c) => c.name.split(":")[0]),
      [
        "login",
        "customer",
        "invoice",
        "invoice",
        "order",
        "work sheet",
        "work sheet",
        "ticket",
        "ticket",
      ],
    );
  });

  it("logs in with the stage password and sends the token on every later call, and only on those", async () => {
    await run();
    assert.equal(api.requests[0]!.authorization, undefined);
    assert.deepEqual(api.requests[0]!.body, {
      email: "u1abc@teszt.acropora.invalid",
      password: PASSWORD,
    });
    for (const request of api.requests.slice(1))
      assert.equal(request.authorization, `Bearer ${FAKE_TOKEN}`, request.path);
  });

  it("sends the invoice line with discountPercent null and the payment terms the issue step needs, and issues with the draft's own updatedAt", async () => {
    await run();
    const draft = sent("POST", "/billing/documents")!.body as Record<
      string,
      unknown
    >;
    assert.equal(draft.documentType, "INVOICE");
    assert.equal(draft.invoiceFormat, "PAPER");
    assert.equal(draft.customerId, "cust-1");
    assert.equal(draft.fulfillmentDate, "2026-11-09");
    assert.equal(draft.dueDate, "2026-11-17");
    assert.equal(draft.paymentMethod, "Átutalás");
    const line = (draft.lines as Record<string, unknown>[])[0]!;
    assert.ok("discountPercent" in line && line.discountPercent === null);
    assert.equal(typeof line.unitNet, "string");
    // the confirmation window's path (card 7ba97e0d): the issue carries what the summary showed
    assert.ok(sent("GET", "/billing/documents/inv-1/issue-summary"));
    assert.deepEqual(sent("POST", "/billing/documents/inv-1/issue")!.body, {
      expectedUpdatedAt: FAKE_UPDATED_AT,
      issueDate: "2026-11-09",
      fulfillmentDate: "2026-11-09",
      dueDate: "2026-11-17",
      fingerprint: FAKE_FINGERPRINT,
    });
  });

  it("sends a POS manual line with NO variantId key and a number VAT rate, a work sheet with the department, and a ticket with customer and department", async () => {
    await run();
    const sale = sent("POST", "/pos/sales")!.body as Record<string, unknown>;
    const line = (sale.lines as Record<string, unknown>[])[0]!;
    assert.ok(!("variantId" in line));
    assert.equal(line.vatRatePercent, 27);
    assert.equal(typeof line.unitGross, "number");
    const sheet = sent("POST", "/service/worksheets")!.body as Record<
      string,
      unknown
    >;
    assert.equal(sheet.customerId, "cust-1");
    assert.equal(sheet.departmentId, "dep-1");
    assert.match(String(sheet.clientOperationId), /^[A-Za-z0-9_.:-]{8,128}$/);
    assert.deepEqual(
      sent("PUT", "/service/worksheets/customers/cust-1/partner-code")!.body,
      {
        partnerCode: "TAAAAAA",
      },
    );
    const job = sent("POST", "/service/jobs")!.body as Record<string, unknown>;
    assert.equal(job.customerId, "cust-1");
    assert.equal(job.departmentId, "dep-1");
    assert.deepEqual(sent("POST", "/service/jobs/job-1/move")!.body, {
      to: "TRIAGED",
    });
  });

  it("creates nothing the API would take for a real person or a real provider (invented name, no mail, no assignee)", async () => {
    await run();
    const bodies = JSON.stringify(api.requests.map((r) => r.body));
    assert.ok(!/@/.test(bodies.replace("u1abc@teszt.acropora.invalid", "")));
    assert.ok(!bodies.includes("assigneeIds"));
    assert.ok(!bodies.includes("assetIds"));
  });
});

describe("a trial against an API that does not answer as expected", () => {
  it("names a failed step with its status and, for a 4xx, the API's message, and reports the steps that needed it as skipped, not as missing", async () => {
    api.override("POST /customers", 400, {
      message: ["displayName should not be empty"],
    });
    const checks = await run();
    assert.equal(checks.length, 9);
    const customer = checks.find((c) => c.name.startsWith("customer:"))!;
    assert.equal(customer.passed, false);
    assert.match(
      customer.name,
      /create customer: HTTP 400: displayName should not be empty/,
    );
    const skipped = checks.filter((c) =>
      c.name.includes("skipped: an earlier step failed"),
    );
    assert.deepEqual(
      skipped.map((c) => c.name.split(":")[0]),
      ["invoice", "invoice", "work sheet", "work sheet", "ticket", "ticket"],
    );
    assert.ok(
      checks.find((c) => c.name.startsWith("order:"))!.passed,
      "the order step does not need the customer",
    );
    assert.ok(skipped.every((c) => !c.passed));
  });

  it("says only the status of a server error, never its body", async () => {
    api.override("POST /billing/documents", 500, {
      message: "Key (email)=(valaki@pelda.hu) already exists",
    });
    const checks = await run();
    const draft = checks.find((c) => c.name.startsWith("invoice: a draft"))!;
    assert.match(draft.name, /HTTP 500\)$/);
    assert.ok(!JSON.stringify(checks).includes("valaki@pelda.hu"));
  });

  it("never puts the token or the password in a check name", async () => {
    api.override("POST /customers", 403, { message: "forbidden" });
    const text = JSON.stringify(await run());
    assert.ok(!text.includes(FAKE_TOKEN));
    assert.ok(!text.includes(PASSWORD));
  });

  it("fails the login step and skips everything when the stage password is refused", async () => {
    api.override("POST /auth/mobile/login/password", 401, {
      message: "Unauthorized",
    });
    const checks = await run();
    assert.equal(checks.filter((c) => c.passed).length, 0);
    assert.equal(checks.length, 9);
    assert.equal(api.requests.length, 1, "nothing else was called");
  });

  it("does not take an answer that is not the expected one for a pass (not ISSUED, a real invoice number, not TRIAGED, a draft that is not a draft)", async () => {
    const cases: [string, number, unknown, string][] = [
      [
        "POST /billing/documents/inv-1/issue",
        200,
        { status: "ISSUING" },
        "the invoice is not ISSUED",
      ],
      [
        "POST /billing/documents/inv-1/issue",
        200,
        { status: "ISSUED", documentNumber: "2026-000123" },
        "not a stub",
      ],
      [
        "POST /billing/documents/inv-1/issue",
        200,
        { status: "ISSUED", documentNumber: "TESZT-2026-0a1b2c3d" },
        "not a stub",
      ],
      ["POST /service/jobs/job-1/move", 201, { status: "NEW" }, "not TRIAGED"],
      [
        "GET /service/worksheets/ws-1",
        200,
        { id: "ws-1", currentVersion: { status: "SIGNED" } },
        "not a draft",
      ],
      [
        "POST /pos/sales",
        201,
        { detail: { id: "s", status: "OPEN" } },
        "not COMPLETED",
      ],
      [
        "POST /billing/documents",
        201,
        {
          id: "i",
          status: "ISSUED",
          updatedAt: "x",
          totals: { grossAmount: "12700" },
        },
        "not a draft",
      ],
    ];
    for (const [route, status, body, expected] of cases) {
      const fresh = await startFakeApi();
      fresh.override(route, status, body);
      const checks = await runTrialFlows({
        baseUrl: fresh.url,
        email: "e@x.invalid",
        password: PASSWORD,
        now: () => new Date("2026-11-09T10:00:00Z"),
      });
      await fresh.close();
      const failed = checks.filter(
        (c) => !c.passed && !c.name.includes("skipped"),
      );
      assert.ok(
        failed.some((c) => c.name.includes(expected)),
        `${route}: ${JSON.stringify(failed)}`,
      );
    }
  });

  it("reports an API that does not answer at all as a failed step, not as an exception", async () => {
    const checks = await runTrialFlows({
      baseUrl: "http://127.0.0.1:9",
      email: "e@x.invalid",
      password: PASSWORD,
    });
    assert.equal(checks.length, 9);
    assert.match(checks[0]!.name, /no answer from the API/);
    assert.equal(checks.filter((c) => c.passed).length, 0);
  });
});
