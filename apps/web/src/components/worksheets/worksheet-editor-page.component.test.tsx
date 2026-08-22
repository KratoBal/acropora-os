import { render, screen } from "@testing-library/react";
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
  },
};

describe("WorksheetEditorPage partner picker", () => {
  beforeEach(() => {
    auth.session = session;
    customers.list.mockReset();
    worksheets.departments.mockReset().mockResolvedValue({ items: [] });
    worksheets.detail.mockReset();
    worksheets.selectablePartners.mockReset().mockResolvedValue({ items: [] });
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
