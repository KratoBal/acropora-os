import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  ProductDetail,
  ProductHusbandry,
  ProductHusbandryFacts,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ProductHusbandryCard,
  husbandryChanges,
} from "./product-husbandry-card";

const api = vi.hoisted(() => ({
  husbandry: vi.fn(),
  updateHusbandry: vi.fn(),
}));
vi.mock("@/lib/api/products", () => ({ productApi: api }));

/*
  MI PIROSIT (V2.2 S2, kartya d2fc06e7): a kartya megjelenik nem elo allatnal; a hianyzo kotelezo mezok nem nevesitve; egy
  ures mezo alapertekkel kitoltve (a spec szerint "ellenorzes alatt", nem alapertek); a mentes a NEM valtozott mezoket is
  kuldi; a torles nem null; az ellenorzes gomb nem kuld `ellenorizve: true`-t, vagy kuld nevet/idot; egy hibas szam elmegy;
  hiba utan a kijelzett allapot megvaltozik; a jog nelkuli felhasznalo szerkeszthet; a mentes utan a szerver valasza nem kerul ki.
*/
const facts = (
  overrides: Partial<ProductHusbandryFacts> = {},
): ProductHusbandryFacts => ({
  magyarNev: null,
  genus: "Zebrasoma",
  species: null,
  careDifficulty: null,
  minLiter: null,
  medenceErettsegHonap: null,
  elhelyezesZona: null,
  reefSafe: null,
  reefSafeIndok: null,
  socialKeeping: null,
  aggression: [],
  korallevo: null,
  gerinctelenevo: null,
  feedingType: [],
  etetesGyakorisag: null,
  eloEleseg: null,
  fenyIgeny: null,
  aramlasIgeny: null,
  meretMax: null,
  meretDimenzio: null,
  szarmazas: null,
  kinekNem: null,
  forrasTipus: null,
  forrasHivatkozas: null,
  ...overrides,
});

const husbandry = (
  overrides: Partial<ProductHusbandry> = {},
  factOverrides: Partial<ProductHusbandryFacts> = {},
): ProductHusbandry => ({
  productId: "product-1",
  livestockKind: "FISH",
  facts: facts(factOverrides),
  verification: { verified: false, byUserId: null, at: null },
  missing: ["careDifficulty", "kinekNem", "verification"],
  ...overrides,
});

const product = (kind: ProductDetail["livestockKind"] = "FISH") =>
  ({
    id: "product-1",
    name: "Zebrasoma",
    livestockKind: kind,
  }) as unknown as ProductDetail;

beforeEach(() => {
  api.husbandry.mockReset();
  api.updateHusbandry.mockReset();
});

describe("A tartási blokk szerkesztője", () => {
  it("nem élő állatnál nem jelenik meg és nem is tölt be semmit", () => {
    const { container } = render(
      <ProductHusbandryCard token="t" product={product(null)} canManage />,
    );
    expect(container.textContent).toBe("");
    expect(api.husbandry).not.toHaveBeenCalled();
  });

  it("megnevezi a hiányzó kötelező mezőket, és kiírja, hogy nincs ellenőrizve", async () => {
    api.husbandry.mockResolvedValue(husbandry());
    render(<ProductHusbandryCard token="t" product={product()} canManage />);
    const status = await screen.findByTestId("husbandry-status");
    expect(status.textContent).toContain("Nincs ellenőrizve");
    expect(status.textContent).toContain("Tartási nehézség");
    expect(status.textContent).toContain("Kinek NEM ajánljuk");
    expect(status.textContent).toContain("Ellenőrzés");
  });

  it("az üres mező 'Ellenőrzés alatt', nem alapérték", async () => {
    api.husbandry.mockResolvedValue(husbandry());
    render(<ProductHusbandryCard token="t" product={product()} canManage />);
    await screen.findByTestId("husbandry-status");
    const select = screen.getByLabelText(
      "Tartási nehézség",
    ) as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(select.options[0]!.textContent).toBe("Ellenőrzés alatt");
    expect(
      (screen.getByLabelText("Korallevő") as HTMLSelectElement).value,
    ).toBe("");
  });

  it("csak a megváltozott mezőt küldi, és a szerver válaszát teszi ki", async () => {
    api.husbandry.mockResolvedValue(husbandry());
    api.updateHusbandry.mockResolvedValue(
      husbandry(
        { missing: ["verification"] },
        { kinekNem: "Kis medencébe nem ajánljuk." },
      ),
    );
    render(<ProductHusbandryCard token="t" product={product()} canManage />);
    await screen.findByTestId("husbandry-status");
    fireEvent.change(screen.getByLabelText("Kinek NEM ajánljuk (egy mondat)"), {
      target: { value: " Kis medencébe nem ajánljuk. " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    await waitFor(() => expect(api.updateHusbandry).toHaveBeenCalled());
    expect(api.updateHusbandry).toHaveBeenCalledWith("t", "product-1", {
      kinekNem: "Kis medencébe nem ajánljuk.",
    });
    await waitFor(() =>
      expect(
        (
          screen.getByLabelText(
            "Kinek NEM ajánljuk (egy mondat)",
          ) as HTMLInputElement
        ).value,
      ).toBe("Kis medencébe nem ajánljuk."),
    );
    expect(screen.getByTestId("husbandry-status").textContent).not.toContain(
      "Kinek NEM ajánljuk",
    );
  });

  it("változás nélkül nem küld semmit", async () => {
    api.husbandry.mockResolvedValue(husbandry());
    render(<ProductHusbandryCard token="t" product={product()} canManage />);
    await screen.findByTestId("husbandry-status");
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    expect(await screen.findByText(/Nincs változás/)).toBeTruthy();
    expect(api.updateHusbandry).not.toHaveBeenCalled();
  });

  it("a 'Mentés és ellenőrzöm' az `ellenorizve: true`-t küldi, nevet vagy időt nem", async () => {
    api.husbandry.mockResolvedValue(
      husbandry({}, { forrasTipus: "gyártó", forrasHivatkozas: "x" }),
    );
    api.updateHusbandry.mockResolvedValue(
      husbandry(
        {
          verification: {
            verified: true,
            byUserId: "u",
            at: "2026-11-10T10:00:00.000Z",
          },
          missing: [],
        },
        { forrasTipus: "gyártó", forrasHivatkozas: "x" },
      ),
    );
    render(<ProductHusbandryCard token="t" product={product()} canManage />);
    await screen.findByTestId("husbandry-status");
    fireEvent.click(
      screen.getByRole("button", { name: "Mentés és ellenőrzöm" }),
    );
    await waitFor(() => expect(api.updateHusbandry).toHaveBeenCalled());
    expect(api.updateHusbandry).toHaveBeenCalledWith("t", "product-1", {
      ellenorizve: true,
    });
    expect(
      (await screen.findByTestId("husbandry-status")).textContent,
    ).toContain("Ellenőrizve");
  });

  it("a hibás szám nem megy el, a szerver elutasítása kiírva marad", async () => {
    api.husbandry.mockResolvedValue(husbandry());
    render(<ProductHusbandryCard token="t" product={product()} canManage />);
    await screen.findByTestId("husbandry-status");
    fireEvent.change(screen.getByLabelText("Minimális medence (liter)"), {
      target: { value: "sok" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    expect(await screen.findByText(/számot írj/)).toBeTruthy();
    expect(api.updateHusbandry).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Minimális medence (liter)"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Tartási nehézség"), {
      target: { value: "KONNYU" },
    });
    api.updateHusbandry.mockRejectedValue(
      new Error("Az 1-es fokozat (Kezdőknek is) Acropora fajra nem adható."),
    );
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    expect(await screen.findByText(/Acropora fajra nem adható/)).toBeTruthy();
  });

  it("jog nélkül nincs mentés-gomb és a mezők le vannak tiltva", async () => {
    api.husbandry.mockResolvedValue(husbandry());
    render(
      <ProductHusbandryCard token="t" product={product()} canManage={false} />,
    );
    await screen.findByTestId("husbandry-status");
    expect(screen.queryByRole("button", { name: "Mentés" })).toBeNull();
    expect(
      (screen.getByLabelText("Tartási nehézség") as HTMLSelectElement).disabled,
    ).toBe(true);
  });
});

describe("husbandryChanges", () => {
  const form = (overrides: Record<string, string | string[]> = {}) => ({
    genus: "Zebrasoma",
    species: "",
    careDifficulty: "",
    minLiter: "",
    medenceErettsegHonap: "",
    elhelyezesZona: "",
    reefSafe: "",
    reefSafeIndok: "",
    socialKeeping: "",
    aggression: [] as string[],
    korallevo: "",
    gerinctelenevo: "",
    feedingType: [] as string[],
    etetesGyakorisag: "",
    eloEleseg: "",
    fenyIgeny: "",
    aramlasIgeny: "",
    meretMax: "",
    meretDimenzio: "",
    szarmazas: "",
    kinekNem: "",
    forrasTipus: "",
    forrasHivatkozas: "",
    ...overrides,
  });

  it("a változatlan űrlap nem ad változást", () => {
    expect(husbandryChanges(facts(), form()).input).toEqual({});
  });

  it("a törlés null, az igen/nem logikai érték, a szám szám, a lista lista", () => {
    const stored = facts({
      kinekNem: "régi",
      aggression: ["BEKES"],
      korallevo: true,
    });
    const result = husbandryChanges(
      stored,
      form({
        kinekNem: "",
        aggression: [],
        korallevo: "false",
        minLiter: "300",
        feedingType: ["ALGAEVO"],
      }),
    );
    expect(result.input).toEqual({
      kinekNem: null,
      aggression: null,
      korallevo: false,
      minLiter: 300,
      feedingType: ["ALGAEVO"],
    });
    expect(result.badNumber).toBeNull();
  });

  it("a hibás számot megnevezi, és nem ad át értéket rá", () => {
    const result = husbandryChanges(facts(), form({ meretMax: "x" }));
    expect(result.badNumber).toBe("Kifejlett méret (cm)");
    expect(result.input).toEqual({});
  });
});
