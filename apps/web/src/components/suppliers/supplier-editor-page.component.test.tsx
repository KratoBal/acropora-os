import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SupplierEditorPage } from "./supplier-editor-page";

const navigation = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const suppliers = vi.hoisted(() => ({
  detail: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));
const postalCode = vi.hoisted(() => ({ lookup: vi.fn() }));
const viesVat = vi.hoisted(() => ({ lookup: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/suppliers", () => ({ suppliersApi: suppliers }));
vi.mock("@/lib/api/postal-code", () => ({ postalCodeApi: postalCode }));
vi.mock("@/lib/api/vies-vat", () => ({ viesVatApi: viesVat }));

const session: Session = {
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-1",
    email: "balazs@acropora.local",
    displayName: "Balázs",
    role: "OWNER",
  },
};

describe("SupplierEditorPage", () => {
  beforeEach(() => {
    auth.session = session;
    suppliers.detail.mockReset();
    suppliers.create.mockReset();
  });

  /** The Partners menu no longer holds suppliers only, so the screen must not
   * call every new record a supplier. The list page carries the same label and
   * is asserted in its own spec: changing one of the two and leaving the other
   * is exactly the half-finished state this pair of assertions rules out. */
  it("names a new record without calling it a supplier", () => {
    render(<SupplierEditorPage />);

    expect(screen.getByText("Új felvitele")).toBeTruthy();
    expect(screen.queryByText("Új beszállító")).toBeNull();
  });

  /** A new record is a supplier unless someone says otherwise, the same way
   * the column defaults. Anything else would make recording a supplier -- the
   * common case, and the only case until now -- take an extra click. */
  it("starts a new partner as a supplier and sends both kinds", async () => {
    suppliers.create.mockResolvedValue({ id: "supplier-9" });

    render(<SupplierEditorPage />);
    fireEvent.change(screen.getByLabelText("Név"), {
      target: { value: "Szerviz Bt." },
    });
    fireEvent.click(screen.getByLabelText("Szerviz"));
    fireEvent.click(
      screen.getByRole("button", { name: "Partner létrehozása" }),
    );

    await waitFor(() => expect(suppliers.create).toHaveBeenCalled());
    const payload = suppliers.create.mock.calls.at(0)?.[1];
    expect(payload?.isSupplier).toBe(true);
    expect(payload?.isService).toBe(true);
  });

  /**
   * The code is the worksheet number's first segment, so it belongs to a
   * partner we write worksheets for and to no other. Asked for only after
   * "Szerviz" is ticked, and NOT required even then: ticking a box should not
   * turn into "invent an abbreviation right now". The picker leaves partners
   * without a code out instead, so the gap costs nothing until a sheet is
   * wanted.
   */
  it("asks for the partner code only once the partner is a service partner", () => {
    render(<SupplierEditorPage />);
    expect(screen.queryByLabelText("Partnerkód")).toBeNull();

    fireEvent.click(screen.getByLabelText("Szerviz"));

    expect(screen.getByLabelText("Partnerkód")).toBeTruthy();
  });

  /** Two codes differing only in case would look identical on paper, and the
   * column is unique, so the screen settles the case rather than letting the
   * server reject what looked fine to the person typing it. */
  it("keeps the code in the shape the number needs", async () => {
    suppliers.create.mockResolvedValue({ id: "supplier-9" });

    render(<SupplierEditorPage />);
    fireEvent.change(screen.getByLabelText("Név"), {
      target: { value: "Fankó Kft." },
    });
    fireEvent.click(screen.getByLabelText("Szerviz"));
    fireEvent.change(screen.getByLabelText("Partnerkód"), {
      target: { value: "fank" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Partner létrehozása" }),
    );

    await waitFor(() => expect(suppliers.create).toHaveBeenCalled());
    expect(suppliers.create.mock.calls.at(0)?.[1]?.worksheetPartnerCode).toBe(
      "FANK",
    );
  });

  /**
   * Bank details are what we need in order to pay a partner, so a service-only
   * partner has none of them. The IBAN field is asserted as ABSENT and the
   * name field as PRESENT in the same test: without the second half this would
   * also pass on a screen that failed to render at all, which is the way an
   * empty result disguises itself as a correct one.
   */
  it("hides the bank block for a partner we do not buy from", () => {
    render(<SupplierEditorPage />);
    expect(screen.getByLabelText("Bankszámlaszám")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Beszállító"));

    expect(screen.queryByLabelText("Bankszámlaszám")).toBeNull();
    expect(screen.getByLabelText("Név")).toBeTruthy();
  });
});
