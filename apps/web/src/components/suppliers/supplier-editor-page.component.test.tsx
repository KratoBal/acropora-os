import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SupplierEditorPage } from "./supplier-editor-page";

const navigation = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const suppliers = vi.hoisted(() => ({
  detail: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  units: vi.fn(),
  createUnit: vi.fn(),
  deletionPlan: vi.fn(),
  remove: vi.fn(),
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
    suppliers.units.mockReset().mockResolvedValue({ items: [] });
    suppliers.createUnit.mockReset();
    suppliers.deletionPlan.mockReset();
    suppliers.remove.mockReset();
    navigation.push.mockReset();
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
   * Closing a worksheet requires the code, so it belongs to a partner we write
   * worksheets for and to no other. Asked for only after
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
   * A unit hangs off a partner, so until the partner is saved there is nothing
   * to hang it on. Ticking "Szerviz" on a new record must not offer it either:
   * the card would take input that has nowhere to go.
   */
  it("does not offer units on a partner that does not exist yet", () => {
    render(<SupplierEditorPage />);
    fireEvent.click(screen.getByLabelText("Szerviz"));

    expect(screen.queryByLabelText("Alegység kódja")).toBeNull();
  });

  /**
   * The other half, and the one that would be missed: on a saved service
   * partner the units are listed AND a new one can be added. Asserting only
   * the absence above would pass on a screen where this card never renders.
   */
  it("lists the units of a saved service partner and offers a new one", async () => {
    suppliers.detail.mockResolvedValue({
      id: "supplier-1",
      code: "SZALL-1",
      name: "Fankó Kft.",
      isSupplier: false,
      isService: true,
      country: "HU",
      isActive: true,
      createdAt: "2026-08-19T10:00:00.000Z",
      updatedAt: "2026-08-19T10:00:00.000Z",
    });
    suppliers.units.mockResolvedValue({
      items: [{ id: "unit-1", code: "BIO", name: "Bio labor", isActive: true }],
    });

    render(<SupplierEditorPage supplierId="supplier-1" />);

    expect(await screen.findByText("Bio labor")).toBeTruthy();
    expect(screen.getByLabelText("Alegység kódja")).toBeTruthy();
  });

  /**
   * A HELYSZINEK FAT ALKOTNAK, es a kepernyon EGY szinttel lejjebb is fel kell
   * tudni vinni ujat. A tulajdonos dontese (2026-08-25): tobb szint, nem ketto.
   *
   * AMIT EZ A TESZT ALLIT, es amit egy "megjelenik a lista" allitas NEM fogna
   * meg: hogy a kivalasztott szulo EL IS JUT a szerverig. Egy fa-nezet, ami
   * szepen behuz, de gyokerre menti az uj sort, pontosan ugy nez ki, mint a
   * helyes -- amig valaki meg nem nezi az adatot.
   */
  it("adds the new site under the selected parent", async () => {
    suppliers.detail.mockResolvedValue({
      id: "supplier-1",
      code: "SZALL-1",
      name: "Fankó Kft.",
      isSupplier: false,
      isService: true,
      country: "HU",
      isActive: true,
      createdAt: "2026-08-19T10:00:00.000Z",
      updatedAt: "2026-08-19T10:00:00.000Z",
    });
    suppliers.units.mockResolvedValue({
      items: [
        {
          id: "unit-1",
          parentId: null,
          code: "BIO",
          name: "Biodóm",
          isActive: true,
        },
        {
          id: "unit-2",
          parentId: "unit-1",
          code: "FNM",
          name: "Nagy főkamedence",
          isActive: true,
        },
      ],
    });
    suppliers.createUnit.mockResolvedValue({
      id: "unit-3",
      parentId: "unit-1",
      code: "ALG",
      name: "Algásító",
      isActive: true,
    });

    render(<SupplierEditorPage supplierId="supplier-1" />);

    // Mindket szint latszik: a gyerek nem tunhet el attol, hogy melyebben van.
    expect(await screen.findByText("Biodóm")).toBeTruthy();
    expect(screen.getByText("Nagy főkamedence")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Szülő helyszín"), {
      target: { value: "unit-1" },
    });
    fireEvent.change(screen.getByLabelText("Alegység kódja"), {
      target: { value: "alg" },
    });
    fireEvent.change(screen.getByLabelText("Alegység neve"), {
      target: { value: "Algásító" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Hozzáadás" }));

    await waitFor(() => {
      expect(suppliers.createUnit).toHaveBeenCalledWith(
        "token-1",
        "supplier-1",
        {
          parentId: "unit-1",
          code: "ALG",
          name: "Algásító",
        },
      );
    });
  });

  /**
   * Bank details are what we need in order to pay a partner, so a service-only
   * partner has none of them. The IBAN field is asserted as ABSENT and the
   * name field as PRESENT in the same test: without the second half this would
   * also pass on a screen that failed to render at all, which is the way an
   * empty result disguises itself as a correct one.
   */
  /**
   * A deleted partner leaves nothing behind on the screen, so the reader has
   * to be taken somewhere. Nothing in this test walked the app first, so the
   * screen's own fallback is what has to answer - the same list the button
   * always pointed at. What this asserts is not the destination but that the
   * screen still HAS one: a wiring that returns nowhere would leave the reader
   * looking at a record that no longer exists.
   */
  it("takes the reader away once the partner is deleted", async () => {
    suppliers.detail.mockResolvedValue({
      id: "supplier-1",
      code: "SZALL-1",
      name: "Fankó Kft.",
      isSupplier: true,
      isService: false,
      country: "HU",
      isActive: true,
      createdAt: "2026-08-19T10:00:00.000Z",
      updatedAt: "2026-08-19T10:00:00.000Z",
    });
    suppliers.deletionPlan.mockResolvedValue({
      action: "delete",
      alsoRemoved: [],
    });
    suppliers.remove.mockResolvedValue({ action: "delete", alsoRemoved: [] });

    render(<SupplierEditorPage supplierId="supplier-1" />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Partner törlése" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Végleges törlés" }),
    );

    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith("/partnerek"),
    );
  });

  it("hides the bank block for a partner we do not buy from", () => {
    render(<SupplierEditorPage />);
    expect(screen.getByLabelText("Bankszámlaszám")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Beszállító"));

    expect(screen.queryByLabelText("Bankszámlaszám")).toBeNull();
    expect(screen.getByLabelText("Név")).toBeTruthy();
  });
});
