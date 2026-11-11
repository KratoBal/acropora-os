import { randomBytes } from "node:crypto";

import type { TrialCheck } from "./verification-gate.js";

/**
 * THE FOUR FLOWS OF THE WORKING TRIAL (task stage-anonim-proba; acrobot 45147). Over HTTP, against an API instance bound to the
 * trial copy of the temporary database, as an OWNER or ADMIN who logs in with the stage password: a customer, a stub invoice, an
 * order (a POS sale), a work sheet and a ticket. One NAMED check per step, so the gate's report says what the trial covered and
 * what broke. A step that needs an earlier one that failed is reported as failed too ("skipped: ... failed"), never left out: a
 * missing check would read as a smaller trial, not as a broken one.
 *
 * THE BODIES ARE THE MINIMAL VALID ONES, written from the DTO classes and the service code (read 2026-11-09), and the API's global
 * validation rejects an extra field, so nothing optional is sent unless a later step needs it. The gotchas that cost a request
 * each, kept here so nobody rediscovers them:
 *   - an invoice line MUST carry `discountPercent` (null is fine): omitted, the amount computation throws and the call is a 500;
 *   - issuing an INVOICE needs `fulfillmentDate`, `dueDate` and `paymentMethod` on the draft, and `expectedUpdatedAt` is the create
 *     response's `updatedAt` byte for byte (any save in between makes it a 409);
 *   - a POS manual line has NO `variantId` key at all (a null one still counts as present), and the VAT rate is 27, 18 or 5;
 *   - a ticket needs a customer AND a department that belongs to it, although only the title is marked required.
 *
 * NOTHING IS LEFT BEHIND IN THE SWAP CANDIDATE: the instance is bound to a throwaway COPY of the temporary database (`withTrialCopy`),
 * dropped afterwards, so the trial's customer, TESZT invoice, sale, work sheet and ticket never reach the stage.
 *
 * WHAT A FAILED STEP MAY SAY: the HTTP status and, for a 4xx, the API's own message (a validation or business-rule text, which names
 * fields). Never a body of a 5xx, never a token, never the password.
 */

export interface TrialFlowsOptions {
  readonly baseUrl: string;
  readonly email: string;
  readonly password: string;
  readonly fetchImpl?: typeof fetch;
  /** The date the bodies use (a test fixes it). */
  readonly now?: () => Date;
  /** A random string of `length` characters from `alphabet` (a test fixes it). */
  readonly random?: (alphabet: string, length: number) => string;
  /** Progress lines (names only), for the operator's terminal. */
  readonly progress?: (line: string) => void;
}

interface Response {
  readonly status: number;
  readonly json: unknown;
}

class StepError extends Error {}

const ALNUM = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const defaultRandom = (alphabet: string, length: number): string => {
  const bytes = randomBytes(length);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const field = (value: unknown, ...path: string[]): unknown => {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
};

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

const dateOnly = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * The API's own message of a 4xx (a validation or business-rule text), cut short. Never of a 5xx.
 *
 * ONE BRANCH WHERE "NO VALUE IN THE REPORT" RESTS ON AN ASSUMPTION (barracuda, #2333): a 4xx text written by the application, such as a
 * unique-conflict turned into a 409 or a business rule, could carry a value. The trial runs on the anonymized copy, so any value
 * there is invented data, and the trial only sends values it made up itself; that is why this message is allowed through. It is
 * allowed on purpose, and said here so it is not mistaken for a guarantee.
 */
function hintOf(response: Response): string {
  if (response.status < 400 || response.status >= 500) return "";
  const message = field(response.json, "message");
  const joined = Array.isArray(message)
    ? message.filter((m): m is string => typeof m === "string").join("; ")
    : typeof message === "string"
      ? message
      : "";
  return joined === "" ? "" : `: ${joined.slice(0, 160)}`;
}

export async function runTrialFlows(
  options: TrialFlowsOptions,
): Promise<TrialCheck[]> {
  const doFetch = options.fetchImpl ?? fetch;
  const random = options.random ?? defaultRandom;
  const today = (options.now ?? (() => new Date()))();
  const checks: TrialCheck[] = [];
  let token: string | undefined;

  const call = async (
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> => {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (token !== undefined) headers.authorization = `Bearer ${token}`;
    let response;
    try {
      response = await doFetch(`${options.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new StepError(`${method} ${path}: no answer from the API`);
    }
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    return { status: response.status, json };
  };

  /** A successful (2xx) answer, or a StepError naming the call, the status and, for a 4xx, the API's message. */
  const ok = (what: string, response: Response): Response => {
    if (response.status < 200 || response.status >= 300)
      throw new StepError(
        `${what}: HTTP ${response.status}${hintOf(response)}`,
      );
    return response;
  };

  const step = async (
    name: string,
    needs: readonly boolean[],
    run: () => Promise<void>,
  ): Promise<boolean> => {
    options.progress?.(name);
    if (needs.some((done) => !done)) {
      checks.push({
        name: `${name} (skipped: an earlier step failed)`,
        passed: false,
      });
      return false;
    }
    try {
      await run();
      checks.push({ name, passed: true });
      return true;
    } catch (error) {
      const reason =
        error instanceof StepError ? error.message : "unexpected error";
      checks.push({ name: `${name} (${reason})`, passed: false });
      return false;
    }
  };

  const expectField = (what: string, value: unknown): string => {
    const found = text(value);
    if (found === undefined)
      throw new StepError(`${what} is missing from the answer`);
    return found;
  };

  let customerId = "";
  let invoiceId = "";
  let invoiceUpdatedAt = "";
  let departmentId = "";
  let jobId = "";

  const loggedIn = await step(
    "login: an owner or admin logs in with the stage password",
    [],
    async () => {
      const response = ok(
        "login",
        await call("POST", "/auth/mobile/login/password", {
          email: options.email,
          password: options.password,
        }),
      );
      token = expectField("the token", field(response.json, "token"));
    },
  );

  const customerOk = await step(
    "customer: a person with a billing address is created and reads back",
    [loggedIn],
    async () => {
      const created = ok(
        "create customer",
        await call("POST", "/customers", {
          type: "PERSON",
          displayName: "Teszt Elek",
          addresses: [
            {
              type: "BILLING",
              postalCode: "1051",
              city: "Budapest",
              line1: "Teszt utca 1.",
              isDefault: true,
            },
          ],
        }),
      );
      customerId = expectField("the customer id", field(created.json, "id"));
      const read = ok(
        "read customer",
        await call("GET", `/customers/${customerId}`),
      );
      if (field(read.json, "id") !== customerId)
        throw new StepError("the customer read back is another one");
    },
  );

  const draftOk = await step(
    "invoice: a draft is created",
    [customerOk],
    async () => {
      const created = ok(
        "create invoice draft",
        await call("POST", "/billing/documents", {
          documentType: "INVOICE",
          invoiceFormat: "PAPER",
          customerId,
          fulfillmentDate: dateOnly(today),
          dueDate: dateOnly(new Date(today.getTime() + 8 * 86_400_000)),
          paymentMethod: "Átutalás",
          currency: "HUF",
          language: "hu",
          lines: [
            {
              description: "Teszt szolgáltatás",
              quantity: "1",
              unitNet: "10000",
              vatRatePercent: "27",
              discountPercent: null,
            },
          ],
        }),
      );
      invoiceId = expectField("the invoice id", field(created.json, "id"));
      invoiceUpdatedAt = expectField(
        "updatedAt",
        field(created.json, "updatedAt"),
      );
      if (field(created.json, "status") !== "DRAFT")
        throw new StepError("the new invoice is not a draft");
      const gross = text(field(created.json, "totals", "grossAmount"));
      if (gross === undefined || !/^12700(\.0+)?$/.test(gross))
        throw new StepError("the gross amount is not 12700");
    },
  );

  await step(
    "invoice: the draft is issued in stub mode with a TESZT number (no Számlázz.hu call)",
    [draftOk],
    async () => {
      // the confirmation window's path (card 7ba97e0d): the summary first, then the issue with what it showed
      const summary = ok(
        "invoice issue summary",
        await call("GET", `/billing/documents/${invoiceId}/issue-summary`),
      );
      const issued = ok(
        "issue invoice",
        await call("POST", `/billing/documents/${invoiceId}/issue`, {
          expectedUpdatedAt: invoiceUpdatedAt,
          issueDate: expectField(
            "the summary's issue date",
            field(summary.json, "issueDate"),
          ),
          fulfillmentDate: expectField(
            "the summary's fulfilment date",
            field(summary.json, "fulfillmentDate"),
          ),
          dueDate: field(summary.json, "dueDate") ?? null,
          fingerprint: expectField(
            "the summary's fingerprint",
            field(summary.json, "fingerprint"),
          ),
        }),
      );
      if (field(issued.json, "status") !== "ISSUED")
        throw new StepError("the invoice is not ISSUED");
      const number = text(field(issued.json, "documentNumber"));
      if (number === undefined || !/^TESZT-\d{4}-[0-9A-F]{8}$/.test(number))
        throw new StepError(
          "the document number is not a stub (TESZT-...) number",
        );
    },
  );

  await step(
    "order: a POS sale with a manual line is completed and reads back",
    [loggedIn],
    async () => {
      const created = ok(
        "create POS sale",
        await call("POST", "/pos/sales", {
          paymentMethod: "CASH",
          lines: [
            {
              description: "Teszt kézi tétel",
              vatRatePercent: 27,
              quantity: 1,
              unitGross: 12700,
            },
          ],
        }),
      );
      const id = expectField(
        "the sale id",
        field(created.json, "detail", "id"),
      );
      if (field(created.json, "detail", "status") !== "COMPLETED")
        throw new StepError("the sale is not COMPLETED");
      const read = ok("read POS sale", await call("GET", `/pos/sales/${id}`));
      if (field(read.json, "id") !== id)
        throw new StepError("the sale read back is another one");
    },
  );

  const partnerOk = await step(
    "work sheet: a partner code and a department are set for the customer",
    [customerOk],
    async () => {
      ok(
        "set partner code",
        await call(
          "PUT",
          `/service/worksheets/customers/${customerId}/partner-code`,
          { partnerCode: `T${random(ALNUM, 6)}` },
        ),
      );
      const department = ok(
        "create department",
        await call(
          "POST",
          `/service/worksheets/customers/${customerId}/departments`,
          { code: random(ALNUM, 5), name: "Teszt helyszín" },
        ),
      );
      departmentId = expectField(
        "the department id",
        field(department.json, "id"),
      );
    },
  );

  await step(
    "work sheet: a work sheet is created and reads back as a draft",
    [partnerOk],
    async () => {
      const created = ok(
        "create work sheet",
        await call("POST", "/service/worksheets", {
          clientOperationId: `stage-trial-ws-${random(ALNUM, 10)}`,
          customerId,
          departmentId,
          subject: "Teszt munkalap",
          lines: [
            {
              description: "Helyszíni karbantartás",
              quantity: 2,
              unit: "óra",
              kind: "LABOR",
            },
          ],
        }),
      );
      const id = expectField("the work sheet id", field(created.json, "id"));
      const read = ok(
        "read work sheet",
        await call("GET", `/service/worksheets/${id}`),
      );
      if (field(read.json, "id") !== id)
        throw new StepError("the work sheet read back is another one");
      if (field(read.json, "currentVersion", "status") !== "DRAFT")
        throw new StepError("the work sheet is not a draft");
    },
  );

  const jobOk = await step(
    "ticket: a ticket is created and reads back as NEW",
    [partnerOk],
    async () => {
      const created = ok(
        "create ticket",
        await call("POST", "/service/jobs", {
          title: "Teszt hibajegy",
          kind: "REPAIR",
          customerId,
          departmentId,
        }),
      );
      jobId = expectField("the ticket id", field(created.json, "id"));
      expectField("the ticket number", field(created.json, "jobNumber"));
      const read = ok(
        "read ticket",
        await call("GET", `/service/jobs/${jobId}`),
      );
      if (field(read.json, "status") !== "NEW")
        throw new StepError("the new ticket is not NEW");
    },
  );

  await step("ticket: the ticket moves to TRIAGED", [jobOk], async () => {
    const moved = ok(
      "move ticket",
      await call("POST", `/service/jobs/${jobId}/move`, { to: "TRIAGED" }),
    );
    if (field(moved.json, "status") !== "TRIAGED")
      throw new StepError("the ticket is not TRIAGED");
  });

  return checks;
}
