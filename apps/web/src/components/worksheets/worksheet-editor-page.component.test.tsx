import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorksheetEditorPage } from "./worksheet-editor-page";

const navigation = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const customers = vi.hoisted(() => ({ list: vi.fn() }));
const worksheets = vi.hoisted(() => ({
  departments: vi.fn(),
  createDepartment: vi.fn(),
  create: vi.fn(),
  updateDraft: vi.fn(),
  detail: vi.fn(),
  selectablePartners: vi.fn(),
  assignableUsers: vi.fn(),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/customers", () => ({ customersApi: customers }));
vi.mock("@/lib/api/worksheets", () => ({ worksheetsApi: worksheets }));

const session: Session = {
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-sanyi",
    email: "sanyi@acropora.local",
    displayName: "Szerelő Sándor",
    nickname: "Sanyi",
    role: "SERVICE",
    customerId: null,
    supplierId: null,
  },
};

describe("WorksheetEditorPage partner picker", () => {
  beforeEach(() => {
    auth.session = session;
    customers.list.mockReset();
    worksheets.departments.mockReset().mockResolvedValue({ items: [] });
    worksheets.detail.mockReset();
    worksheets.selectablePartners.mockReset().mockResolvedValue({ items: [] });
    worksheets.assignableUsers.mockReset().mockResolvedValue({ items: [] });
    worksheets.create.mockReset().mockResolvedValue({ id: "worksheet-1" });
  });

  /**
   * A worksheet is written for a service partner, not for somebody who bought
   * something in the webshop. The picker therefore reads the partner list.
   *
   * The customer endpoint is asserted as untouched in the same test: reading
   * both would also put the right names on screen, and would quietly bring
   * back the buyers this change exists to keep out.
   */
  it("offers service partners and leaves the buyers alone", async () => {
    worksheets.selectablePartners.mockResolvedValue({
      items: [
        { customerId: "customer-42", name: "Fankó Kft.", partnerCode: "FANK" },
      ],
    });

    render(<WorksheetEditorPage />);

    expect(
      await screen.findByRole("option", { name: "FANK - Fankó Kft." }),
    ).toBeTruthy();
    expect(customers.list).not.toHaveBeenCalled();
  });

  /**
   * The option's value is the id the worksheet stores, not the partner's own.
   * The two are different rows, and picking the wrong one would put the sheet
   * on a record that carries no worksheets -- it would fail on save, far from
   * the line that chose it.
   */
  it("carries the id the worksheet is stored against", async () => {
    worksheets.selectablePartners.mockResolvedValue({
      items: [
        { customerId: "customer-42", name: "Fankó Kft.", partnerCode: "FANK" },
      ],
    });

    render(<WorksheetEditorPage />);
    const option = (await screen.findByRole("option", {
      name: "FANK - Fankó Kft.",
    })) as HTMLOptionElement;

    expect(option.value).toBe("customer-42");
  });

  /**
   * An existing worksheet showed "Válassz partnert" where its partner's name
   * belongs, because the list is not loaded at all while editing and the
   * disabled Select had no option matching the assigned id.
   *
   * The name is asserted rather than the absence of the placeholder: the old
   * code rendered the placeholder AND no name, so only checking for a missing
   * option would have passed on a screen that shows nothing.
   */
  it("shows the partner of an existing worksheet without loading any list", async () => {
    worksheets.detail.mockResolvedValue({
      id: "ws-1",
      customer: {
        id: "customer-42",
        customerNumber: "V-0042",
        displayName: "Fankó Kft.",
        worksheetPartnerCode: "FANK",
      },
      department: { id: "dep-1", code: "BIO", name: "Bio", isActive: true },
      currentVersion: {
        subject: "Szivattyú csere",
        description: null,
        issueDate: null,
        fulfillmentDate: null,
        dueDate: null,
        lines: [],
      },
    });

    render(<WorksheetEditorPage worksheetId="ws-1" />);

    const selected = await screen.findByRole("option", { name: "Fankó Kft." });
    expect((selected as HTMLOptionElement).selected).toBe(true);
    expect(worksheets.selectablePartners).not.toHaveBeenCalled();
    expect(customers.list).not.toHaveBeenCalled();
  });

  /**
   * An empty dropdown reads as a broken screen. It is a rule instead: a
   * partner without the "Szerviz" tick or without an abbreviation is left out
   * on purpose, because a sheet written for one would refuse to close later.
   * The picker says so, and names the page that holds the missing field.
   */
  it("says why the picker is empty, and where the missing field is", async () => {
    worksheets.selectablePartners.mockResolvedValue({ items: [] });

    render(<WorksheetEditorPage />);

    expect(
      await screen.findByRole("option", {
        name: "Nincs választható szerviz partner",
      }),
    ).toBeTruthy();
    expect(screen.getByText(/partner adatlapján/)).toBeTruthy();
  });

  it("keeps the ordinary placeholder when there is something to pick", async () => {
    worksheets.selectablePartners.mockResolvedValue({
      items: [
        { customerId: "customer-42", name: "Fankó Kft.", partnerCode: "FANK" },
      ],
    });

    render(<WorksheetEditorPage />);

    expect(
      await screen.findByRole("option", { name: "Válassz partnert" }),
    ).toBeTruthy();
    expect(screen.queryByText(/partner adatlapján/)).toBeNull();
  });

  /**
   * A list that never arrived is not an empty list. Saying "there is no
   * service partner" after a failed request would send somebody to fill in a
   * field that is already filled in.
   */
  it("does not blame the data when the list could not be loaded", async () => {
    worksheets.selectablePartners.mockRejectedValue(new Error("network"));

    render(<WorksheetEditorPage />);

    expect(
      await screen.findByText("A partnerlista nem tölthető be."),
    ).toBeTruthy();
    expect(screen.queryByText(/partner adatlapján/)).toBeNull();
    expect(
      screen.queryByRole("option", {
        name: "Nincs választható szerviz partner",
      }),
    ).toBeNull();
  });
});

describe("WorksheetEditorPage assignees", () => {
  beforeEach(() => {
    auth.session = session;
    customers.list.mockReset();
    worksheets.departments.mockReset().mockResolvedValue({
      items: [
        {
          id: "department-1",
          parentId: null,
          code: "BIO",
          name: "Biodóm",
          isActive: true,
        },
      ],
    });
    worksheets.detail.mockReset();
    worksheets.selectablePartners.mockReset().mockResolvedValue({
      items: [
        { customerId: "customer-42", name: "Fankó Kft.", partnerCode: "FANK" },
      ],
    });
    worksheets.assignableUsers.mockReset().mockResolvedValue({
      items: [{ id: "user-sanyi", name: "Sanyi", role: "SERVICE" }],
    });
    worksheets.create.mockReset().mockResolvedValue({ id: "worksheet-1" });
  });

  /**
   * AZ IRODA NYIT LAPOT A SZERELŐNEK: a kiosztás a felvitel pillanatában
   * ismert. Külön lépésre bízva a felvivő azt hiszi, kiadta a munkát, közben a
   * lap senki listáján nem jelenik meg.
   */
  it("sends the chosen colleagues with the sheet, in one call", async () => {
    const user = userEvent.setup();
    render(<WorksheetEditorPage />);

    await user.selectOptions(
      await screen.findByLabelText("Partner"),
      "customer-42",
    );
    await user.selectOptions(
      await screen.findByLabelText("Alegység"),
      "department-1",
    );
    await user.type(screen.getByLabelText("Tárgy"), "Havi karbantartás");
    await user.click(await screen.findByLabelText("Sanyi"));
    await user.click(screen.getByRole("button", { name: "Mentés" }));

    expect(worksheets.create).toHaveBeenCalledTimes(1);
    expect(worksheets.create.mock.calls[0]?.[1]?.assigneeIds).toEqual([
      "user-sanyi",
    ]);
  });

  /**
   * A KIOSZTÁS ELHAGYHATÓ. Egy lapot fel kell tudni vinni akkor is, ha még nem
   * dőlt el, ki megy ki -- a felelős a lap adatlapján később is megadható.
   */
  it("creates an unassigned sheet without complaining", async () => {
    const user = userEvent.setup();
    render(<WorksheetEditorPage />);

    await user.selectOptions(
      await screen.findByLabelText("Partner"),
      "customer-42",
    );
    await user.selectOptions(
      await screen.findByLabelText("Alegység"),
      "department-1",
    );
    await user.type(screen.getByLabelText("Tárgy"), "Havi karbantartás");
    await user.click(screen.getByRole("button", { name: "Mentés" }));

    expect(worksheets.create.mock.calls[0]?.[1]?.assigneeIds).toEqual([]);
  });

  /**
   * ÜRES DOBOZ HELYETT MONDAT. Egy üres lista a "Felelősök" felirat alatt úgy
   * néz ki, mintha a betöltés akadt volna el, és a felvivő megvárná.
   */
  it("says out loud when there is nobody to assign", async () => {
    worksheets.assignableUsers.mockResolvedValue({ items: [] });

    render(<WorksheetEditorPage />);

    expect(
      await screen.findByText(
        "Nincs olyan kolléga, akire a lap kiosztható lenne.",
      ),
    ).toBeTruthy();
  });
});
