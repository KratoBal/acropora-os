import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  PartnerMigrationPlan,
  PartnerMigrationRunPreview,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import { PartnerMigrationRunSection } from "./partner-migration-run-section";

/**
 * AZ ÁTVEZETÉS FUTTATÁSA AZ OLDALRÓL. MI PIROSÍT: ha az írás próba nélkül vagy hibás döntéssel elérhető; ha az írás NEM a próba
 * lenyomatával megy; ha a megerősítő ablak nem mondja ki a célzott adatbázist és a számokat; ha egy 409 után a régi lenyomat
 * használható marad; ha a visszaállítás próba nélkül nyomható; ha a kötési döntés a próbát nem érvényteleníti.
 */
const api = vi.hoisted(() => ({
  preview: vi.fn(),
  apply: vi.fn(),
  restorePreview: vi.fn(),
  restoreApply: vi.fn(),
}));
vi.mock("@/lib/api/partner-migration", () => ({ partnerMigrationApi: api }));

const customer = (id: string) => ({
  id,
  customerNumber: `VEVO-${id}`,
  displayName: `Vevő ${id}`,
  taxNumber: null,
  euTaxNumber: null,
  fromUnas: false,
  references: 2,
});

const plan = (): PartnerMigrationPlan => ({
  generatedAt: "2026-11-04T20:00:00.000Z",
  total: 1,
  byAction: { BIND_AMBIGUOUS: 1 },
  rows: [
    {
      supplierId: "s1",
      code: "AMB",
      name: "Kétes Kft.",
      taxNumber: null,
      country: "HU",
      isActive: true,
      roles: ["SUPPLIER"],
      worksheetPartnerCode: null,
      linkedCustomer: null,
      candidates: [customer("c1"), customer("c2")],
      nameCandidates: [],
      action: "BIND_AMBIGUOUS",
      notes: [],
    },
  ],
});

const previewOf = (
  over: Partial<PartnerMigrationRunPreview> = {},
): PartnerMigrationRunPreview => ({
  target: "stage-db:5432/acropora",
  operations: [
    { kind: "CREATE", supplierId: "s2", code: "NEW" },
    { kind: "SKIP", supplierId: "s1", code: "AMB", reason: "több jelölt" },
  ],
  problems: [],
  counts: { create: 1, bind: 0, skip: 1 },
  fingerprint: "a".repeat(64),
  ...over,
});

const mount = (onChanged = vi.fn()) => {
  render(
    <PartnerMigrationRunSection
      token="t1"
      plan={plan()}
      onChanged={onChanged}
    />,
  );
  return onChanged;
};
const button = (name: string) => screen.getByRole("button", { name });

describe("PartnerMigrationRunSection", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.preview.mockResolvedValue(previewOf());
  });

  it("cannot apply before a preview, and shows the target database and counts after one", async () => {
    mount();
    expect(
      (button("Átvezetés végrehajtása") as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(button("Próba"));
    const box = await screen.findByTestId("migration-preview");
    expect(box.textContent).toContain("stage-db:5432/acropora");
    expect(box.textContent).toContain(
      "1 új vevő-sor, 0 kötés meglévőhöz, 1 kimarad",
    );
    expect(
      (button("Átvezetés végrehajtása") as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(api.apply).not.toHaveBeenCalled();
  });

  it("applies only with the previewed fingerprint, after a confirmation that names the database and the numbers", async () => {
    api.apply.mockResolvedValue({
      target: "stage-db:5432/acropora",
      outcomes: [{ code: "NEW", mode: "CREATED", customerId: "c9" }],
    });
    const onChanged = mount();
    fireEvent.click(button("Próba"));
    await screen.findByTestId("migration-preview");
    fireEvent.click(button("Átvezetés végrehajtása"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("stage-db:5432/acropora");
    expect(dialog.textContent).toContain("1 új vevő-sor készül");
    expect(api.apply).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Átvezetés végrehajtása" }),
    );
    await waitFor(() => expect(api.apply).toHaveBeenCalledTimes(1));
    expect(api.apply).toHaveBeenCalledWith("t1", {
      fingerprint: "a".repeat(64),
      binds: {},
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    // a lenyomat egyszer használatos: új írás új próbát kér
    expect(
      (button("Átvezetés végrehajtása") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("a 409 drops the preview and asks for a new one", async () => {
    api.apply.mockRejectedValue(new ApiError("A terv közben változott.", 409));
    mount();
    fireEvent.click(button("Próba"));
    await screen.findByTestId("migration-preview");
    fireEvent.click(button("Átvezetés végrehajtása"));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Átvezetés végrehajtása",
      }),
    );
    await screen.findByText("A terv közben változott.");
    expect(screen.queryByTestId("migration-preview")).toBeNull();
    expect(
      (button("Átvezetés végrehajtása") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("does not offer the write when the preview has problems or nothing to write", async () => {
    api.preview.mockResolvedValue(
      previewOf({ problems: ["A --bind AMB=c1 nem megengedett"] }),
    );
    mount();
    fireEvent.click(button("Próba"));
    await screen.findByText(/nem megengedett/);
    expect(
      (button("Átvezetés végrehajtása") as HTMLButtonElement).disabled,
    ).toBe(true);
    api.preview.mockResolvedValue(
      previewOf({ counts: { create: 0, bind: 0, skip: 2 } }),
    );
    fireEvent.click(button("Próba"));
    await waitFor(() =>
      expect(screen.getByTestId("migration-preview").textContent).toContain(
        "0 új vevő-sor",
      ),
    );
    expect(
      (button("Átvezetés végrehajtása") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("an ambiguous partner gets a choice; the choice goes with the preview and the apply, and invalidates the old preview", async () => {
    api.apply.mockResolvedValue({ target: "x", outcomes: [] });
    mount();
    fireEvent.click(button("Próba"));
    await screen.findByTestId("migration-preview");
    fireEvent.change(
      screen.getByLabelText("Vevő-sor a(z) Kétes Kft. partnerhez"),
      {
        target: { value: "c2" },
      },
    );
    expect(screen.queryByTestId("migration-preview")).toBeNull();
    fireEvent.click(button("Próba"));
    await screen.findByTestId("migration-preview");
    expect(api.preview).toHaveBeenLastCalledWith("t1", { AMB: "c2" });
    fireEvent.click(button("Átvezetés végrehajtása"));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Átvezetés végrehajtása",
      }),
    );
    await waitFor(() => expect(api.apply).toHaveBeenCalled());
    expect(api.apply.mock.calls[0]![1].binds).toEqual({ AMB: "c2" });
  });

  it("a successful write drops the other, now stale preview (apply drops the restore preview, restore drops the apply preview)", async () => {
    api.apply.mockResolvedValue({ target: "x", outcomes: [] });
    api.restorePreview.mockResolvedValue({
      target: "x",
      outcomes: [{ supplierId: "s2", customerId: "c9", result: "RESTORED" }],
      fingerprint: "b".repeat(64),
    });
    api.restoreApply.mockResolvedValue({ target: "x", outcomes: [] });
    mount();
    fireEvent.click(button("Visszaállítási próba"));
    await screen.findByTestId("migration-restore-preview");
    fireEvent.click(button("Próba"));
    await screen.findByTestId("migration-preview");
    fireEvent.click(button("Átvezetés végrehajtása"));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Átvezetés végrehajtása",
      }),
    );
    await waitFor(() => expect(api.apply).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByTestId("migration-restore-preview")).toBeNull(),
    );
    expect((button("Visszaállítás") as HTMLButtonElement).disabled).toBe(true);
    // and the other way round
    fireEvent.click(button("Visszaállítási próba"));
    await screen.findByTestId("migration-restore-preview");
    fireEvent.click(button("Próba"));
    await screen.findByTestId("migration-preview");
    fireEvent.click(button("Visszaállítás"));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Visszaállítás",
      }),
    );
    await waitFor(() => expect(api.restoreApply).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByTestId("migration-preview")).toBeNull(),
    );
  });

  it("restores only after a restore preview, with its fingerprint", async () => {
    api.restorePreview.mockResolvedValue({
      target: "stage-db:5432/acropora",
      outcomes: [{ supplierId: "s2", customerId: "c9", result: "RESTORED" }],
      fingerprint: "b".repeat(64),
    });
    api.restoreApply.mockResolvedValue({ target: "x", outcomes: [] });
    const onChanged = mount();
    expect((button("Visszaállítás") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button("Visszaállítási próba"));
    await screen.findByTestId("migration-restore-preview");
    fireEvent.click(button("Visszaállítás"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("1 partner átvezetése áll vissza");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Visszaállítás" }),
    );
    await waitFor(() =>
      expect(api.restoreApply).toHaveBeenCalledWith("t1", {
        fingerprint: "b".repeat(64),
      }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("does not offer the restore when the preview restores nothing", async () => {
    api.restorePreview.mockResolvedValue({
      target: "x",
      outcomes: [
        {
          supplierId: "s2",
          customerId: "c9",
          result: "KEPT",
          detail: "hivatkozás van rajta",
        },
      ],
      fingerprint: "c".repeat(64),
    });
    mount();
    fireEvent.click(button("Visszaállítási próba"));
    await screen.findByText(/hivatkozás van rajta/);
    expect((button("Visszaállítás") as HTMLButtonElement).disabled).toBe(true);
  });
});
