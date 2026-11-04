import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  PartnerMergeLogEntry,
  PartnerMergePreview,
  PartnerMigrationPlan,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import { PartnerMergeSection } from "./partner-merge-section";

/**
 * AZ ÖSSZEVONÁS-SZAKASZ. MI PIROSÍT: ha az összevonás előnézet nélkül vagy akadállyal elérhető; ha a végrehajtás NEM az előnézet
 * lenyomatával megy, vagy a megerősítés nem nevezi meg a két sort és a számokat; ha a napló nem mutatja a visszavont sort mint
 * visszavontat, vagy egy visszavont sorhoz is ad Visszavonás gombot; ha a visszavonás jegyzete elvész; ha egy 409 után a régi
 * előnézet használható marad.
 */
const api = vi.hoisted(() => ({
  list: vi.fn(),
  preview: vi.fn(),
  execute: vi.fn(),
  undo: vi.fn(),
}));
vi.mock("@/lib/api/partner-merge", () => ({ partnerMergeApi: api }));

const customer = (id: string, name: string) => ({
  id,
  customerNumber: `VEVO-${id}`,
  displayName: name,
  taxNumber: "11111111-2-42",
  euTaxNumber: null,
  fromUnas: id === "u",
  references: 3,
});

const plan = (): PartnerMigrationPlan => ({
  generatedAt: "2026-11-04T20:00:00.000Z",
  total: 1,
  byAction: { MERGE_CANDIDATES: 1 },
  rows: [
    {
      supplierId: "s-zoo",
      code: "FANK",
      name: "Állatkert",
      taxNumber: "11111111-2-42",
      country: "HU",
      isActive: true,
      roles: ["SERVICE"],
      worksheetPartnerCode: "FANK",
      linkedCustomer: customer("k", "Állatkert (tükör)"),
      candidates: [customer("u", "Állatkert (UNAS)")],
      nameCandidates: [],
      action: "MERGE_CANDIDATES",
      notes: [],
    },
  ],
});

const previewOf = (
  over: Partial<PartnerMergePreview> = {},
): PartnerMergePreview => ({
  keptId: "k",
  mergedId: "u",
  kept: null,
  merged: null,
  willMove: { SalesOrder: 4, Invoice: 2 },
  fieldFills: [{ field: "email", kind: "fill", into: "email" }],
  notes: [],
  blockers: [],
  suggestSwap: false,
  canExecute: true,
  fingerprint: "f".repeat(64),
  ...over,
});

const entry = (
  over: Partial<PartnerMergeLogEntry> = {},
): PartnerMergeLogEntry => ({
  id: "log1",
  keptId: "k",
  mergedId: "u",
  reason: null,
  createdAt: "2026-11-04T21:00:00.000Z",
  undoneAt: null,
  moved: { SalesOrder: 4 },
  ...over,
});

const mount = (onChanged = vi.fn()) => {
  render(
    <PartnerMergeSection token="t1" plan={plan()} onChanged={onChanged} />,
  );
  return onChanged;
};
const button = (name: string) => screen.getByRole("button", { name });

describe("PartnerMergeSection", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.list.mockResolvedValue([]);
    api.preview.mockResolvedValue(previewOf());
  });

  it("offers a pair per candidate, names the kept and the merged row, and cannot merge before a preview", async () => {
    mount();
    const pair = await screen.findByTestId("merge-pair");
    expect(pair.textContent).toContain("megmarad");
    expect(pair.textContent).toContain("Állatkert (tükör) (VEVO-k)");
    expect(pair.textContent).toContain("Állatkert (UNAS) (VEVO-u)");
    expect((button("Összevonás") as HTMLButtonElement).disabled).toBe(true);
    expect(api.preview).not.toHaveBeenCalled();
  });

  it("shows what would move per table, and merges with the previewed fingerprint after a confirmation", async () => {
    api.execute.mockResolvedValue(entry());
    const onChanged = mount();
    await screen.findByTestId("merge-pair");
    fireEvent.click(button("Előnézet"));
    const preview = await screen.findByTestId("merge-preview");
    expect(preview.textContent).toContain("4 rendelés, 2 számla");
    expect(api.preview).toHaveBeenCalledWith("t1", "k", "u");
    fireEvent.click(button("Összevonás"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Állatkert (UNAS) (VEVO-u)");
    expect(dialog.textContent).toContain("4 rendelés, 2 számla");
    expect(api.execute).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Összevonás" }));
    await waitFor(() => expect(api.execute).toHaveBeenCalledTimes(1));
    expect(api.execute.mock.calls[0]![1]).toMatchObject({
      keptId: "k",
      mergedId: "u",
      fingerprint: "f".repeat(64),
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("shows the blockers and does not allow the merge", async () => {
    api.preview.mockResolvedValue(
      previewOf({
        canExecute: false,
        blockers: ["Mindkét sornak van UNAS-hivatkozása."],
      }),
    );
    mount();
    await screen.findByTestId("merge-pair");
    fireEvent.click(button("Előnézet"));
    await screen.findByText(/Akadály: Mindkét sornak van UNAS-hivatkozása/);
    expect((button("Összevonás") as HTMLButtonElement).disabled).toBe(true);
  });

  it("a 409 drops the previews", async () => {
    api.execute.mockRejectedValue(
      new ApiError("Az előnézet óta változott.", 409),
    );
    mount();
    await screen.findByTestId("merge-pair");
    fireEvent.click(button("Előnézet"));
    await screen.findByTestId("merge-preview");
    fireEvent.click(button("Összevonás"));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Összevonás",
      }),
    );
    await screen.findByText("Az előnézet óta változott.");
    expect(screen.queryByTestId("merge-preview")).toBeNull();
  });

  it("lists the log with an undo button only for the merges not undone yet, and shows the undo notes", async () => {
    api.list.mockResolvedValue([
      entry({ id: "log2", moved: { Invoice: 1 } }),
      entry({ id: "log1", undoneAt: "2026-11-04T22:00:00.000Z" }),
    ]);
    api.undo.mockResolvedValue({
      logId: "log2",
      restored: { Invoice: 1 },
      skipped: {},
      notes: ["A UNAS-hivatkozás visszakerült a megszűnő sorra."],
    });
    const onChanged = mount();
    const log = await screen.findByTestId("merge-log");
    expect(
      within(log).getAllByRole("button", { name: "Visszavonás" }),
    ).toHaveLength(1);
    expect(log.textContent).toContain("visszavonva:");
    fireEvent.click(within(log).getByRole("button", { name: "Visszavonás" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Visszavonás" }),
    );
    await waitFor(() => expect(api.undo).toHaveBeenCalledWith("t1", "log2"));
    await screen.findByText(/A UNAS-hivatkozás visszakerült a megszűnő sorra/);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("renders nothing when there is no pair and no log", async () => {
    render(
      <PartnerMergeSection
        token="t1"
        plan={{ generatedAt: "x", total: 0, byAction: {}, rows: [] }}
        onChanged={vi.fn()}
      />,
    );
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    expect(screen.queryByTestId("merge-section")).toBeNull();
  });
});
