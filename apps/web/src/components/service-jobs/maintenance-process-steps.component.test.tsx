import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { MaintenanceInvoiceSummary } from "@acropora/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CompletionCertificateSummary } from "@/lib/api/completion-certificates";

import {
  MaintenanceProcessSteps,
  maintenanceProcessSteps,
  type StepInputs,
} from "./maintenance-process-steps";

/*
  A KARBANTARTÁSI LAP LÉPÉSSORA (Picasso 3.3, acrobot 62058): csak MEGJELENÍT, a panelek adatából. MI PIROSÍT: ha egy ismeretlen (betöltés, hiba) állapot
  ténynek látszik; ha az első nyitott lépés nem kapja a "Következő" jelet, vagy egy várakozó/ismeretlen lépés kapja; ha a lépések sorrendje vagy állapota elcsúszik
  a panelek adatától; ha a sor nem olvas újra a `refreshKey` változására.
*/
const api = vi.hoisted(() => ({ list: vi.fn(), byCertificate: vi.fn() }));
vi.mock("@/lib/api/completion-certificates", () => ({
  completionCertificatesApi: { list: api.list },
}));
vi.mock("@/lib/api/maintenance-invoice", () => ({
  maintenanceInvoiceApi: { byCertificate: api.byCertificate },
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { token: "t1" } }),
}));

const certificate = (signed: boolean): CompletionCertificateSummary => ({
  id: "c1",
  number: "TIG-2026-001",
  issuedAt: "2026-11-20T10:00:00Z",
  issuedByName: "Balázs",
  documents: signed
    ? [
        {
          id: "d1",
          type: "SIGNED_FORM",
          fileName: "alairt.pdf",
          contentType: "application/pdf",
          sizeBytes: 10,
          createdAt: "2026-11-21T10:00:00Z",
        },
      ]
    : [],
});
const invoice = (
  status: MaintenanceInvoiceSummary["status"],
  invoiceNumber?: string,
): MaintenanceInvoiceSummary => ({
  id: "i1",
  status,
  currency: "HUF",
  netAmount: "1000",
  vatAmount: "270",
  grossAmount: "1270",
  createdAt: "2026-11-22T10:00:00Z",
  issueEnabled: true,
  ...(invoiceNumber ? { invoiceNumber } : {}),
});
const steps = (over: Partial<StepInputs> = {}) =>
  maintenanceProcessSteps({
    worksheets: [{ status: "SIGNED" }],
    certificates: [certificate(true)],
    invoice: invoice("DRAFT"),
    ...over,
  });
const byKey = (list: ReturnType<typeof steps>, key: string) =>
  list.find((step) => step.key === key)!;

describe("maintenanceProcessSteps", () => {
  it("has the four steps in the page's order: worksheets, certificate, invoice, package", () => {
    expect(steps().map((step) => step.key)).toEqual([
      "worksheets",
      "certificate",
      "invoice",
      "package",
    ]);
  });

  it("the worksheets step: none, part signed, all signed", () => {
    expect(byKey(steps({ worksheets: [] }), "worksheets")).toMatchObject({
      state: "Még nincs munkalap",
      tone: "open",
    });
    expect(
      byKey(
        steps({ worksheets: [{ status: "SIGNED" }, { status: "DRAFT" }] }),
        "worksheets",
      ),
    ).toMatchObject({ state: "1 / 2 aláírva", tone: "open" });
    expect(byKey(steps(), "worksheets")).toMatchObject({
      state: "Mind aláírva (1)",
      tone: "done",
    });
  });

  it("the first open step is the next one, and only that one", () => {
    const none = steps({
      worksheets: [],
      certificates: [],
      invoice: undefined,
    });
    expect(none.filter((step) => step.next).map((step) => step.key)).toEqual([
      "worksheets",
    ]);
    const signed = steps({ certificates: [], invoice: undefined });
    expect(signed.filter((step) => step.next).map((step) => step.key)).toEqual([
      "certificate",
    ]);
    const unsignedCert = steps({
      certificates: [certificate(false)],
      invoice: null,
    });
    expect(byKey(unsignedCert, "certificate")).toMatchObject({
      state: "TIG-2026-001: aláírt példány még nincs",
      tone: "open",
      next: true,
    });
    const draft = steps({ invoice: invoice("DRAFT") });
    expect(draft.filter((step) => step.next).map((step) => step.key)).toEqual([
      "invoice",
    ]);
    expect(byKey(draft, "invoice").state).toBe(
      "Piszkozat, még nincs kiállítva",
    );
  });

  it("an issued invoice is done and nothing is next any more; the package never is", () => {
    const all = steps({ invoice: invoice("ISSUED", "ACR-2026-77") });
    expect(byKey(all, "invoice")).toMatchObject({
      state: "Kiállítva: ACR-2026-77",
      tone: "done",
    });
    expect(all.some((step) => step.next)).toBe(false);
    expect(byKey(all, "package").tone).toBe("waiting");
  });

  it("a cancelled issued invoice is NOT done: it says Sztornózva with its number and is the next step (card 2cd1ed80)", () => {
    const cancelled = steps({
      invoice: { ...invoice("ISSUED", "ACR-2026-9"), cancelled: true },
    });
    expect(byKey(cancelled, "invoice")).toMatchObject({
      state: "Sztornózva: ACR-2026-9",
      tone: "open",
      next: true,
    });
    // the same issued invoice without the signal stays done, with nothing next
    const plain = steps({ invoice: invoice("ISSUED", "ACR-2026-9") });
    expect(byKey(plain, "invoice")).toMatchObject({ tone: "done" });
    expect(plain.some((step) => step.next)).toBe(false);
  });

  it("an invoice mid-issue asks for a manual check, and the sheet has no invoice yet without a draft", () => {
    expect(
      byKey(steps({ invoice: invoice("ISSUING") }), "invoice"),
    ).toMatchObject({
      tone: "open",
      state: "Kiállítás folyamatban: kézi ellenőrzés kell",
    });
    expect(byKey(steps({ invoice: null }), "invoice")).toMatchObject({
      tone: "open",
      state: "Még nincs számla-piszkozat",
    });
  });

  it("an unknown state is said to be unknown and is never next (loading, failed)", () => {
    const loading = steps({ certificates: null, invoice: undefined });
    expect(byKey(loading, "certificate")).toMatchObject({
      state: "Betöltés…",
      tone: "unknown",
      next: false,
    });
    expect(byKey(loading, "invoice").tone).toBe("unknown");
    const failed = steps({ certificates: "error", invoice: undefined });
    expect(byKey(failed, "certificate").state).toBe(
      "Az állapota nem tölthető be",
    );
    expect(failed.filter((step) => step.tone === "unknown")).toHaveLength(2);
    expect(byKey(steps({ invoice: "error" }), "invoice").state).toBe(
      "Az állapota nem tölthető be",
    );
  });

  it("a sheet that cannot have a certificate waits, with no next step on the certificate or after", () => {
    const blocked = steps({
      certificateBlockedReason: "A lapnak nincs megrendelőlapja.",
      certificates: [],
      invoice: undefined,
    });
    expect(byKey(blocked, "certificate")).toMatchObject({
      tone: "waiting",
      next: false,
    });
    expect(byKey(blocked, "invoice")).toMatchObject({
      tone: "waiting",
      state: "A teljesítési igazolás után",
    });
  });
});

describe("MaintenanceProcessSteps", () => {
  beforeEach(() => {
    api.list.mockReset().mockResolvedValue([certificate(true)]);
    api.byCertificate.mockReset().mockResolvedValue(invoice("DRAFT"));
  });
  afterEach(() => cleanup());

  it("draws the strip with the next step marked, and reads the certificate and its invoice", async () => {
    render(
      <MaintenanceProcessSteps
        serviceJobId="job-1"
        worksheets={[{ status: "SIGNED" }]}
        refreshKey={0}
      />,
    );
    const list = screen.getByRole("list", { name: "A karbantartás lépései" });
    expect(
      await screen.findByText("Piszkozat, még nincs kiállítva"),
    ).toBeInTheDocument();
    const current = list.querySelector('[aria-current="step"]')!;
    expect(current.textContent).toContain("Számla");
    expect(current.textContent).toContain("Következő");
    expect(api.list).toHaveBeenCalledWith("t1", "job-1");
    expect(api.byCertificate).toHaveBeenCalledWith("t1", "c1");
  });

  it("reads again when the refreshKey changes, and says so when it cannot read", async () => {
    const { rerender } = render(
      <MaintenanceProcessSteps
        serviceJobId="job-1"
        worksheets={[]}
        refreshKey={0}
      />,
    );
    await screen.findByText("Piszkozat, még nincs kiállítva");
    api.byCertificate.mockResolvedValue(invoice("ISSUED", "ACR-1"));
    rerender(
      <MaintenanceProcessSteps
        serviceJobId="job-1"
        worksheets={[]}
        refreshKey={1}
      />,
    );
    expect(await screen.findByText("Kiállítva: ACR-1")).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it("an unreadable certificate list is said, not guessed", async () => {
    api.list.mockRejectedValue(new Error("boom"));
    render(
      <MaintenanceProcessSteps
        serviceJobId="job-1"
        worksheets={[]}
        refreshKey={0}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getAllByText("Az állapota nem tölthető be").length,
      ).toBeGreaterThan(0),
    );
    expect(screen.queryByText("Még nincs kiállítva")).toBeNull();
  });
});
