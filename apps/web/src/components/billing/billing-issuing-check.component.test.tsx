import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  BillingDocumentDetail,
  BillingIssuingCheck,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BillingIssuingCheckPanel } from "./billing-issuing-check";

/**
 * A KIÁLLÍTÁS VÉSZÁLLAPOTÁNAK FELÜLETE (kártya 38e9271d). Mi pirosít: a panel
 * ott, ahol a bizonylat nem ISSUING; az ellenőrzés gombja jog nélkül; végrehajtó
 * gomb a „nem tudjuk” javaslatnál; végrehajtás megerősítés nélkül; a szervernek
 * visszaküldött megerősítés eltér az ellenőrzés javaslatától.
 */
const api = vi.hoisted(() => ({
  issuingCheck: vi.fn(),
  issuingResolve: vi.fn(),
}));
vi.mock("@/lib/api/billing-documents", () => ({ billingDocumentsApi: api }));

const UPDATED = "2026-10-28T10:00:00.000Z";
const check = (
  over: Partial<BillingIssuingCheck> = {},
): BillingIssuingCheck => ({
  documentId: "doc-1",
  kind: "NO_REPLY",
  lookup: "FOUND",
  action: "RECORD_ISSUED",
  invoiceNumber: "E-TST-2026-7",
  reason: "A Számlázz.hu igazolja a(z) E-TST-2026-7 bizonylatot.",
  expectedUpdatedAt: UPDATED,
  ageMinutes: 180,
  ...over,
});
const resolved = { id: "doc-1", status: "ISSUED" } as BillingDocumentDetail;

function panel(
  props: { status?: "ISSUING" | "ISSUED"; canManage?: boolean } = {},
  onDone = vi.fn(),
) {
  render(
    <BillingIssuingCheckPanel
      detail={{ id: "doc-1", status: props.status ?? "ISSUING" }}
      token="t"
      canManage={props.canManage ?? true}
      onDone={onDone}
    />,
  );
  return onDone;
}

beforeEach(() => {
  api.issuingCheck.mockReset();
  api.issuingResolve.mockReset();
});

describe("BillingIssuingCheckPanel", () => {
  it("renders nothing where the document is not waiting for checking", () => {
    panel({ status: "ISSUED" });
    expect(screen.queryByText("A kiállítás ellenőrzésre vár")).toBeNull();
  });

  it("says why it waits, and offers the check only with the finance right", () => {
    panel({ canManage: false });
    expect(
      screen.getByText("A kiállítás ellenőrzésre vár"),
    ).toBeInTheDocument();
    expect(screen.getByText(/pénzügyi kezelői jog kell/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Kiállítás ellenőrzése" }),
    ).toBeNull();
  });

  it("an unknown result shows its sentence and offers NO executing button", async () => {
    api.issuingCheck.mockResolvedValue(
      check({
        action: "NONE",
        lookup: "UNKNOWN",
        invoiceNumber: null,
        reason: "A Számlázz.hu válasza nem érkezett meg vagy nem érthető.",
      }),
    );
    panel();
    fireEvent.click(
      screen.getByRole("button", { name: "Kiállítás ellenőrzése" }),
    );
    expect(await screen.findByText("Nem tudjuk biztosan")).toBeInTheDocument();
    expect(
      screen.getByText(/nem érkezett meg vagy nem érthető/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Rögzítés|Vissza vázlatba/ }),
    ).toBeNull();
    expect(api.issuingCheck).toHaveBeenCalledWith("t", "doc-1");
  });

  it("recording goes out only after the confirmation, with the proposal the check made", async () => {
    api.issuingCheck.mockResolvedValue(check());
    api.issuingResolve.mockResolvedValue(resolved);
    const onDone = panel();
    fireEvent.click(
      screen.getByRole("button", { name: "Kiállítás ellenőrzése" }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Rögzítés kiállítottként (E-TST-2026-7)",
      }),
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("E-TST-2026-7");
    expect(dialog).toHaveTextContent("Új kiállítás nem indul");
    expect(api.issuingResolve).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Rögzítem" }));
    await waitFor(() =>
      expect(api.issuingResolve).toHaveBeenCalledWith("t", "doc-1", {
        expectedUpdatedAt: UPDATED,
        action: "RECORD_ISSUED",
        invoiceNumber: "E-TST-2026-7",
      }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(resolved));
  });

  it("back to draft names its consequence and sends no number", async () => {
    api.issuingCheck.mockResolvedValue(
      check({
        action: "BACK_TO_DRAFT",
        lookup: "NOT_FOUND",
        invoiceNumber: null,
        reason: "Bizonyított, hogy nincs kiállított bizonylat.",
      }),
    );
    api.issuingResolve.mockResolvedValue(resolved);
    panel();
    fireEvent.click(
      screen.getByRole("button", { name: "Kiállítás ellenőrzése" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Vissza vázlatba" }),
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(
      "A Számlázz.hu nem ismeri ezt a bizonylatot",
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Visszateszem" }),
    );
    await waitFor(() =>
      expect(api.issuingResolve).toHaveBeenCalledWith("t", "doc-1", {
        expectedUpdatedAt: UPDATED,
        action: "BACK_TO_DRAFT",
        invoiceNumber: null,
      }),
    );
  });

  it("a refused confirmation shows the server's sentence and asks for a new check", async () => {
    api.issuingCheck.mockResolvedValue(check());
    api.issuingResolve.mockRejectedValue(
      new Error(
        "Az ellenőrzés óta változott a bizonylat vagy a Számlázz.hu válasza.",
      ),
    );
    const onDone = panel();
    fireEvent.click(
      screen.getByRole("button", { name: "Kiállítás ellenőrzése" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Rögzítés kiállítottként/ }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Rögzítem",
      }),
    );
    expect(
      await screen.findByText(/Az ellenőrzés óta változott/),
    ).toBeInTheDocument();
    // az elavult javaslat eltűnt: új ellenőrzés kell
    expect(
      screen.queryByRole("button", { name: /Rögzítés kiállítottként/ }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Kiállítás ellenőrzése" }),
    ).toBeEnabled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("a failed check shows the error and no proposal", async () => {
    api.issuingCheck.mockRejectedValue(
      new Error("Az ellenőrzés nem sikerült."),
    );
    panel();
    fireEvent.click(
      screen.getByRole("button", { name: "Kiállítás ellenőrzése" }),
    );
    expect(
      await screen.findByText("Az ellenőrzés nem sikerült."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Az ellenőrzés javaslata")).toBeNull();
  });
});
