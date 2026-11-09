import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import type {
  PaymentMarkState,
  PaymentMarkStore,
} from "../integrations/szamlazz/outgoing-payment-marks.js";
import type { SzamlazzCredentialProvider } from "../integrations/szamlazz/szamlazz-credential.provider.js";
import type { SzamlazzAgentResponse } from "../integrations/szamlazz/szamlazz-agent-xml.js";
import {
  ManualOutgoingPaymentService,
  manualPaymentProblem,
  type ManualPaymentAuditRepository,
  type ManualPaymentInput,
} from "./manual-outgoing-payment.service.js";

/**
 * KÉZI KIFIZETÉS-RÖGZÍTÉS (kártya 2026/00083-86; acrobot 42564). SEMMILYEN TESZT NEM HÍV
 * VALÓDI SZÁMLÁZZ.HU-T: a kliens mindig kézzel írt hamis. MI PIROSÍT: ha nem a Számlázz.hu-ba
 * ír (a közös úton, `MANUAL` forrással); ha a nyitott összegnél többet enged; ha ugyanaz a
 * kérés kétszer ír; ha kikapcsolt írásnál hív; ha a teszt-szerveren a valódi klienst hívja;
 * ha a rögzítés nem kerül az auditnaplóba.
 */
const USER: AuthenticatedUser = {
  id: "user-1",
  email: "luca@acropora.local",
  displayName: "Luca",
  role: "ADMIN",
  customerId: null,
  supplierId: null,
};
const NOW = new Date("2026-11-04T17:00:00.000Z");
const input = (over: Partial<ManualPaymentInput> = {}): ManualPaymentInput => ({
  invoiceNumber: "ACRW-2026/00084",
  date: "2026-11-04",
  amount: "127000",
  requestId: "6f1b3c1e-1d2a-4c55-9a7e-111111111111",
  ...over,
});

function setup(
  options: {
    invoice?: { paidAmount: string; grossAmount?: string } | null;
    env?: NodeJS.ProcessEnv;
    answer?: SzamlazzAgentResponse | Error;
  } = {},
) {
  const calls: string[] = [];
  const audits: unknown[] = [];
  const rows = new Map<
    string,
    {
      id: string;
      state: PaymentMarkState;
      invoiceNumber?: string;
      amount?: string;
    }
  >();
  const store: PaymentMarkStore = {
    async invoice() {
      if (options.invoice === null) return null;
      return {
        paymentsKnown: true,
        paidAmount: options.invoice?.paidAmount ?? "0",
        grossAmount: options.invoice?.grossAmount ?? "127000",
        currency: "HUF",
      };
    },
    async logRow(source, number, ref) {
      return rows.get(`${source} ${number} ${ref}`) ?? null;
    },
    async create(row) {
      const key = `${row.source} ${row.invoiceNumber} ${row.sourceRef}`;
      if (rows.has(key)) return null;
      const created = {
        id: key,
        state: row.state,
        invoiceNumber: row.invoiceNumber,
        amount: row.amount,
      };
      rows.set(key, created);
      return { id: key };
    },
    async update(id, patch) {
      rows.set(id, { ...rows.get(id)!, id, state: patch.state });
    },
    async ownMarks(invoiceNumber, _since, excludeId) {
      let written = 0;
      let uncertain = 0;
      for (const row of rows.values())
        if (row.invoiceNumber === invoiceNumber && row.id !== excludeId)
          if (row.state === "WRITTEN") written += Number(row.amount);
          else if (row.state === "PLANNED" || row.state === "UNKNOWN")
            uncertain += 1;
      return { writtenSince: String(written), uncertain };
    },
  };
  const client = {
    async registerPayment(xml: string) {
      calls.push(xml);
      const answer = options.answer ?? { successful: true, outstanding: 0 };
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  const credentials = {
    resolve: async () => ({ agentKey: "live-key" }),
  } as unknown as SzamlazzCredentialProvider;
  const audit = {
    record: async (row: unknown) => {
      audits.push(row);
    },
  } as unknown as ManualPaymentAuditRepository;
  const service = new ManualOutgoingPaymentService(
    credentials,
    audit,
    store,
    client,
    options.env ?? { BILLING_ISSUE_ENABLED: "true" },
  );
  return { service, calls, audits, rows };
}

describe("a kézi kifizetés bemenete", () => {
  it("dátum, összeg és megjegyzés: a hiba szövegét adja", () => {
    assert.equal(manualPaymentProblem(input(), NOW), null);
    assert.equal(manualPaymentProblem(input({ amount: "1000,5" }), NOW), null);
    for (const [over, text] of [
      [{ date: "2026-11-05" }, /nem lehet a mai napnál későbbi/],
      [{ date: "11/04/2026" }, /ÉÉÉÉ-HH-NN/],
      [{ amount: "0" }, /pozitív szám/],
      [{ amount: "-5" }, /pozitív szám/],
      [{ amount: "12.345" }, /két tizedessel/],
      [{ invoiceNumber: "  " }, /számlaszám kötelező/],
      [{ note: "x".repeat(201) }, /200 karakter/],
    ] as const)
      assert.match(manualPaymentProblem(input(over), NOW) ?? "", text);
  });
});

describe("ManualOutgoingPaymentService.record", () => {
  it("a Számlázz.hu-ba írja a közös úton, MANUAL forrással, és naplózza", async () => {
    const { service, calls, audits, rows } = setup();
    const result = await service.record(input(), USER, NOW);
    assert.equal(result.state, "WRITTEN");
    assert.equal(calls.length, 1);
    assert.match(calls[0]!, /<szamlaszam>ACRW-2026\/00084<\/szamlaszam>/);
    assert.match(calls[0]!, /<osszeg>127000(\.00)?<\/osszeg>/);
    assert.match(calls[0]!, /<szamlaagentkulcs>live-key<\/szamlaagentkulcs>/);
    assert.deepEqual(
      [...rows.keys()],
      ["MANUAL ACRW-2026/00084 6f1b3c1e-1d2a-4c55-9a7e-111111111111"],
    );
    assert.deepEqual(audits, [
      {
        userId: "user-1",
        invoiceNumber: "ACRW-2026/00084",
        metadata: {
          requestId: "6f1b3c1e-1d2a-4c55-9a7e-111111111111",
          date: "2026-11-04",
          amount: "127000.00",
          mode: "live",
          outcome: "WRITTEN",
        },
      },
    ]);
  });

  it("ugyanaz a kérés másodszor nem ír", async () => {
    const { service, calls } = setup();
    await service.record(input(), USER, NOW);
    const again = await service.record(input(), USER, NOW);
    assert.equal(again.state, "ALREADY_RECORDED");
    assert.equal(calls.length, 1);
  });

  // barracuda (#2168): two forms (two request ids), the full amount twice, the feed unchanged
  it("két külön kérés teljes összeggel: a második nem ír, mert a nyitott összeg már nulla", async () => {
    const { service, calls } = setup();
    await service.record(input(), USER, NOW);
    await assert.rejects(
      () =>
        service.record(
          input({ requestId: "6f1b3c1e-1d2a-4c55-9a7e-333333333333" }),
          USER,
          NOW,
        ),
      (e: unknown) =>
        e instanceof BadRequestException &&
        e.message.includes("nyitott összege (0.00)"),
    );
    assert.equal(
      calls.length,
      1,
      "the second request never reaches Számlázz.hu",
    );
  });

  it("egy függő (bizonytalan) jelölés mellett nem ír, bizonytalant mond", async () => {
    const { service, calls } = setup({ answer: new Error("timeout") });
    await assert.rejects(
      () => service.record(input(), USER, NOW),
      BadGatewayException,
    );
    await assert.rejects(
      () =>
        service.record(
          input({ requestId: "6f1b3c1e-1d2a-4c55-9a7e-444444444444" }),
          USER,
          NOW,
        ),
      (e: unknown) =>
        e instanceof BadGatewayException && e.message.includes("bizonytalan"),
    );
    assert.equal(calls.length, 1);
  });

  it("részben fizetett számlára a nyitott összegig, többet nem", async () => {
    const { service, calls } = setup({ invoice: { paidAmount: "27000" } });
    await assert.rejects(
      () => service.record(input({ amount: "100003" }), USER, NOW),
      (e: unknown) =>
        e instanceof BadRequestException &&
        e.message.includes("több, mint a számla nyitott összege (100000.00)"),
    );
    assert.equal(calls.length, 0);
    const ok = await service.record(
      input({
        amount: "100000",
        requestId: "6f1b3c1e-1d2a-4c55-9a7e-222222222222",
      }),
      USER,
      NOW,
    );
    assert.equal(ok.state, "WRITTEN");
  });

  it("kifizetett, ismeretlen vagy elutasított számla: érthető hiba, kettős írás nincs", async () => {
    await assert.rejects(
      () =>
        setup({ invoice: { paidAmount: "127000" } }).service.record(
          input(),
          USER,
          NOW,
        ),
      ConflictException,
    );
    await assert.rejects(
      () => setup({ invoice: null }).service.record(input(), USER, NOW),
      NotFoundException,
    );
    await assert.rejects(
      () =>
        setup({
          answer: {
            successful: false,
            errorCode: "7",
            errorMessage: "nincs ilyen számla",
          },
        }).service.record(input(), USER, NOW),
      (e: unknown) =>
        e instanceof BadGatewayException && e.message.includes("(7)"),
    );
    await assert.rejects(
      () =>
        setup({ answer: new Error("timeout") }).service.record(
          input(),
          USER,
          NOW,
        ),
      (e: unknown) =>
        e instanceof BadGatewayException && e.message.includes("bizonytalan"),
    );
  });

  it("kikapcsolt írásnál nem hív, a teszt-szerveren az álszámlázóval megy", async () => {
    const off = setup({ env: {} });
    await assert.rejects(
      () => off.service.record(input(), USER, NOW),
      ServiceUnavailableException,
    );
    assert.equal(off.calls.length, 0);
    const stub = setup({ env: { SZAMLAZZ_AGENT_MODE: "stub" } });
    const result = await stub.service.record(input(), USER, NOW);
    assert.equal(result.state, "WRITTEN");
    assert.equal(
      stub.calls.length,
      0,
      "the real client is never called on stage",
    );
    assert.match(result.message, /Teszt-szerver/);
  });
});
