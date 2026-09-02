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
  updateUnit: vi.fn(),
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
    customerId: null,
    supplierId: null,
  },
};

describe("SupplierEditorPage", () => {
  beforeEach(() => {
    auth.session = session;
    suppliers.detail.mockReset();
    suppliers.create.mockReset();
    suppliers.update.mockReset();
    suppliers.units.mockReset().mockResolvedValue({ items: [] });
    suppliers.createUnit.mockReset();
    suppliers.updateUnit.mockReset();
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
   * AMIT EZ A PÁR ŐRIZ, ÉS AMI A KÉPERNYŐN SOHA NEM LÁTSZIK: egy változatlan
   * kód visszaküldése minden JÖVŐBELI szigorítást kiterjesztene a partner
   * összes többi mezőjének szerkesztésére. A kérés a validáción bukna el, és
   * aki csak a telefonszámot javította, nem értené, miért.
   *
   * Ez nem elméleti. A négy karakteres szabály bevezetésekor pontosan ez
   * fenyegetett, és csak azért nem történt meg, mert élesben nulla ilyen sor
   * volt. A képernyő addig működik, amíg nincs szigorítás, tehát egy későbbi
   * refaktor gond nélkül visszatehetné a feltétel nélküli küldést -- ez a két
   * állítás az, ami akkor pirosra vált.
   *
   * KETTŐ kell belőle, mert a kihagyás önmagában lehetne elrontott küldés is:
   * az egyik azt állítja, hogy a VÁLTOZATLAN kód nem megy el, a másik, hogy a
   * MEGVÁLTOZTATOTT igen.
   */
  it("leaves an unchanged partner code out of the update", async () => {
    suppliers.detail.mockResolvedValue({
      id: "supplier-1",
      code: "SZALL-1",
      name: "Fankó Kft.",
      isSupplier: false,
      isService: true,
      worksheetPartnerCode: "FANK",
      country: "HU",
      isActive: true,
      createdAt: "2026-08-19T10:00:00.000Z",
      updatedAt: "2026-08-19T10:00:00.000Z",
    });
    suppliers.update.mockResolvedValue({ id: "supplier-1" });

    render(<SupplierEditorPage supplierId="supplier-1" />);
    fireEvent.change(await screen.findByLabelText("Név"), {
      target: { value: "Fankó és Társa Kft." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Változások mentése" }));

    await waitFor(() => expect(suppliers.update).toHaveBeenCalled());
    // A SOROSÍTOTT alakot nézzük, mert a szerverhez az jut el: a
    // `JSON.stringify` az `undefined` értékű kulcsot kihagyja, tehát a memóriában
    // meglévő kulcs a dróton már nincs ott. Az objektumon állítani azt jelentené,
    // hogy egy megvalósítási részletet állítunk a tényleges kérés helyett.
    const sent = suppliers.update.mock.calls.at(0)?.[2];
    expect(sent?.name).toBe("Fankó és Társa Kft.");
    const wire = JSON.parse(JSON.stringify(sent ?? {}));
    expect("worksheetPartnerCode" in wire).toBe(false);
  });

  it("sends the partner code once it actually changes", async () => {
    suppliers.detail.mockResolvedValue({
      id: "supplier-1",
      code: "SZALL-1",
      name: "Fankó Kft.",
      isSupplier: false,
      isService: true,
      worksheetPartnerCode: "FANK",
      country: "HU",
      isActive: true,
      createdAt: "2026-08-19T10:00:00.000Z",
      updatedAt: "2026-08-19T10:00:00.000Z",
    });
    suppliers.update.mockResolvedValue({ id: "supplier-1" });

    render(<SupplierEditorPage supplierId="supplier-1" />);
    fireEvent.change(await screen.findByLabelText("Partnerkód"), {
      target: { value: "BIOD" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Változások mentése" }));

    await waitFor(() => expect(suppliers.update).toHaveBeenCalled());
    expect(suppliers.update.mock.calls.at(0)?.[2]?.worksheetPartnerCode).toBe(
      "BIOD",
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

/*
 * AZ ALEGYSEG ATNEVEZESE ES ARCHIVALASA.
 *
 * A hatokort a tulajdonos huzta meg (Balazs, 2026-09-02 20:29): "csak a nevet
 * lehessen atirni menjen az archivalassal". A kod es az athelyezes KIVUL van,
 * es azt a szerver oldali allitas orzi (partner-unit-editing.spec.ts) -- itt a
 * FELULET viselkedese all.
 */
describe("SupplierEditorPage: unit editing", () => {
  const serviceSupplier = {
    id: "supplier-1",
    code: "SZALL-1",
    name: "Fankó Kft.",
    isSupplier: false,
    isService: true,
    worksheetPartnerCode: "FANK",
    country: "HU",
    isActive: true,
    createdAt: "2026-08-19T10:00:00.000Z",
    updatedAt: "2026-08-19T10:00:00.000Z",
  };
  const biodom = {
    id: "unit-bio",
    parentId: null,
    code: "BIO",
    name: "Biodóm",
    isActive: true,
  };

  beforeEach(() => {
    auth.session = session;
    suppliers.detail.mockReset().mockResolvedValue(serviceSupplier);
    suppliers.update.mockReset();
    suppliers.units.mockReset().mockResolvedValue({ items: [biodom] });
    suppliers.createUnit.mockReset();
    suppliers.updateUnit.mockReset();
    suppliers.deletionPlan.mockReset();
    suppliers.remove.mockReset();
  });

  it("sends only the new name when a unit is renamed", async () => {
    suppliers.updateUnit.mockResolvedValue({ ...biodom, name: "Biodóm 2" });

    render(<SupplierEditorPage supplierId="supplier-1" />);
    fireEvent.click(await screen.findByLabelText("Biodóm átnevezése"));
    fireEvent.change(screen.getByLabelText("Alegység új neve"), {
      target: { value: "Biodóm 2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));

    await waitFor(() => expect(suppliers.updateUnit).toHaveBeenCalledTimes(1));
    expect(suppliers.updateUnit.mock.calls[0]?.[3]).toEqual({
      name: "Biodóm 2",
    });
  });

  /**
   * EZ AZ AZ ALLITAS, AMI NELKUL SEMMI NEM ORIZNE A MEGEROSITEST.
   *
   * A repo halója (`confirm-usage.component.test.ts`) a torlo-jellegu
   * hivasokat a `method: "DELETE"` alapjan ismeri fel. Az archivalas PATCH,
   * tehat a halo hatokoren KIVUL esik: ha valaki kiveszi a kerdest, semmi mas
   * nem valt pirosra.
   */
  it("asks before archiving, and sends nothing until the answer", async () => {
    render(<SupplierEditorPage supplierId="supplier-1" />);
    fireEvent.click(await screen.findByLabelText("Biodóm archiválása"));

    expect(suppliers.updateUnit).not.toHaveBeenCalled();
    expect(screen.getByText(/Archiválod ezt az alegységet/)).toBeTruthy();
  });

  it("archives only after the question is answered", async () => {
    suppliers.updateUnit.mockResolvedValue({ ...biodom, isActive: false });

    render(<SupplierEditorPage supplierId="supplier-1" />);
    fireEvent.click(await screen.findByLabelText("Biodóm archiválása"));
    fireEvent.click(
      screen.getByRole("button", { name: "Alegység archiválása" }),
    );

    await waitFor(() => expect(suppliers.updateUnit).toHaveBeenCalledTimes(1));
    expect(suppliers.updateUnit.mock.calls[0]?.[3]).toEqual({
      isActive: false,
    });
  });

  /**
   * AZ ARCHIVALT SOR NEM TUNIK EL. A partner adatlapja a TELJES fat mutatja:
   * ha eltunne, a gyerekei szulo nelkul maradnanak a kepernyon, es
   * visszaallitani sem lehetne.
   */
  it("keeps an archived unit on the screen, marked and restorable", async () => {
    suppliers.units.mockResolvedValue({
      items: [{ ...biodom, isActive: false }],
    });

    render(<SupplierEditorPage supplierId="supplier-1" />);

    expect(await screen.findByText(/archivált/)).toBeTruthy();
    expect(screen.getByLabelText("Biodóm visszaállítása")).toBeTruthy();
    expect(screen.queryByLabelText("Biodóm archiválása")).toBeNull();
  });

  /** A visszaallitas nem veszit el semmit, tehat nem kerdez -- csak kuld. */
  it("restores without a question", async () => {
    suppliers.units.mockResolvedValue({
      items: [{ ...biodom, isActive: false }],
    });
    suppliers.updateUnit.mockResolvedValue(biodom);

    render(<SupplierEditorPage supplierId="supplier-1" />);
    fireEvent.click(await screen.findByLabelText("Biodóm visszaállítása"));

    await waitFor(() => expect(suppliers.updateUnit).toHaveBeenCalledTimes(1));
    expect(suppliers.updateUnit.mock.calls[0]?.[3]).toEqual({ isActive: true });
  });
});

/*
 * MIT AJANL FEL A SZULO-VALASZTO, ES MIT MUTAT A LISTA.
 *
 * A ketto SZANDEKOSAN kulonbozik (acrobot dontese, 2026-09-02 21:13): a
 * valaszto csak aktivat ajanl (kulonben egy uj, aktiv alegyseg csendben
 * visszahozna egy archivalt agat a munkaba), a lista viszont a teljes fat
 * mutatja, kulonben a meglevo gyerekek szulo nelkul maradnanak a kepernyon.
 */
describe("SupplierEditorPage: what the parent picker offers", () => {
  const serviceSupplier = {
    id: "supplier-1",
    code: "SZALL-1",
    name: "Fankó Kft.",
    isSupplier: false,
    isService: true,
    worksheetPartnerCode: "FANK",
    country: "HU",
    isActive: true,
    createdAt: "2026-08-19T10:00:00.000Z",
    updatedAt: "2026-08-19T10:00:00.000Z",
  };
  const archived = {
    id: "unit-regi",
    parentId: null,
    code: "REG",
    name: "Régi szárny",
    isActive: false,
  };
  const active = {
    id: "unit-bio",
    parentId: null,
    code: "BIO",
    name: "Biodóm",
    isActive: true,
  };

  beforeEach(() => {
    auth.session = session;
    suppliers.detail.mockReset().mockResolvedValue(serviceSupplier);
    suppliers.update.mockReset();
    suppliers.units
      .mockReset()
      .mockResolvedValue({ items: [archived, active] });
    suppliers.createUnit.mockReset();
    suppliers.updateUnit.mockReset();
    suppliers.deletionPlan.mockReset();
    suppliers.remove.mockReset();
  });

  /**
   * EZ AZ AZ ALLITAS, AMI A DONTEST ORZI. Ha valaki kiveszi a szurest, egy uj
   * alegyseg archivalt ag ala kerulhet, es onnantol a munkalap-valasztoban
   * megjelenik -- hibauzenet nelkul.
   */
  it("offers only active units as a parent", async () => {
    render(<SupplierEditorPage supplierId="supplier-1" />);
    const picker = await screen.findByLabelText("Szülő helyszín");

    const offered = Array.from(
      picker.querySelectorAll("option"),
      (option) => option.textContent ?? "",
    );
    expect(offered.some((text) => text.includes("BIO"))).toBe(true);
    expect(offered.some((text) => text.includes("REG"))).toBe(false);
  });

  /**
   * A SZIGOR LEGVESZELYESEBB MELLEKHATASA, ES EZERT ALL KULON ALLITAS RAJTA:
   * a szures NEM veszi el a MEGLEVOT. Egy archivalt helyszin tovabbra is
   * lathato a fan -- kulonben a rajta allo gyerekek szulo nelkul maradnanak,
   * es visszaallitani sem lehetne.
   */
  it("keeps the archived unit visible in the tree it filtered out of", async () => {
    render(<SupplierEditorPage supplierId="supplier-1" />);

    expect(await screen.findByText("Régi szárny")).toBeTruthy();
    expect(screen.getByLabelText("Régi szárny visszaállítása")).toBeTruthy();
  });
});
