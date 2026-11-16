import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  ProductDetail,
  ProductHusbandry,
  ProductHusbandryFacts,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { answered } from "@/test/answered";
import { ApiError } from "@/lib/api/client";
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
  tempMinC: null,
  tempMaxC: null,
  salinityMinSg: null,
  salinityMaxSg: null,
  khMinDkh: null,
  khMaxDkh: null,
  lifespanYears: null,
  stingOrVenom: null,
  handlingWarning: null,
  quarantineWeeks: null,
  acclimatization: null,
  breedsInTank: null,
  ...overrides,
});

const husbandry = (
  overrides: Partial<ProductHusbandry> = {},
  factOverrides: Partial<ProductHusbandryFacts> = {},
): ProductHusbandry => ({
  productId: "product-1",
  version: "ver-1",
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
      seenVersion: "ver-1",
    });
    // the status line is there before the save's answer: the new state comes with it
    await waitFor(() =>
      expect(screen.getByTestId("husbandry-status").textContent).toContain(
        "Ellenőrizve",
      ),
    );
  });

  it("az ellenőrzés a betöltött verziót küldi vissza, a sima mentés nem küld verziót", async () => {
    api.husbandry.mockResolvedValue(husbandry({ version: "ver-7" }));
    api.updateHusbandry.mockResolvedValue(husbandry({ version: "ver-8" }));
    render(<ProductHusbandryCard token="t" product={product()} canManage />);
    await screen.findByTestId("husbandry-status");
    fireEvent.change(screen.getByLabelText("Kinek NEM ajánljuk (egy mondat)"), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    await waitFor(() => expect(api.updateHusbandry).toHaveBeenCalledTimes(1));
    expect(api.updateHusbandry.mock.calls[0]![2]).toEqual({ kinekNem: "x" });
    // the next verification names the version the SAVE returned, so it waits for that answer
    await answered(api.updateHusbandry);
    fireEvent.click(
      screen.getByRole("button", { name: "Mentés és ellenőrzöm" }),
    );
    await waitFor(() => expect(api.updateHusbandry).toHaveBeenCalledTimes(2));
    expect(api.updateHusbandry.mock.calls[1]![2]).toEqual({
      ellenorizve: true,
      seenVersion: "ver-8",
    });
  });

  it("409-nél a hiba kiírva marad, nem állítja, hogy ellenőrizve, és az Újratöltés a szerver állapotát hozza", async () => {
    api.husbandry.mockResolvedValueOnce(husbandry({ version: "ver-1" }));
    render(<ProductHusbandryCard token="t" product={product()} canManage />);
    await screen.findByTestId("husbandry-status");
    api.updateHusbandry.mockRejectedValue(
      new ApiError("Közben módosult a tartási blokk. Töltsd újra.", 409),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Mentés és ellenőrzöm" }),
    );
    expect(await screen.findByText(/Közben módosult/)).toBeTruthy();
    expect(screen.queryByText(/Elmentve és ellenőrizve/)).toBeNull();
    expect(screen.getByTestId("husbandry-status").textContent).toContain(
      "Nincs ellenőrizve",
    );
    // a reload takes the server's facts and the new version
    api.husbandry.mockResolvedValueOnce(
      husbandry({ version: "ver-2" }, { kinekNem: "Közben írták." }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Újratöltés" }));
    await waitFor(() =>
      expect(
        (
          screen.getByLabelText(
            "Kinek NEM ajánljuk (egy mondat)",
          ) as HTMLInputElement
        ).value,
      ).toBe("Közben írták."),
    );
    expect(screen.queryByRole("button", { name: "Újratöltés" })).toBeNull();
    api.updateHusbandry.mockResolvedValue(husbandry({ version: "ver-3" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Mentés és ellenőrzöm" }),
    );
    await waitFor(() => expect(api.updateHusbandry).toHaveBeenCalledTimes(2));
    expect(api.updateHusbandry.mock.calls[1]![2]).toEqual({
      ellenorizve: true,
      seenVersion: "ver-2",
    });
  });

  /*
    THE STING OR VENOM BANNER (V2.2 follow-up). WHAT TURNS THESE RED: a stated hazard with no banner; the banner showing the unsaved
    draft instead of the stored fact; the warning text missing from it; a "no" or an unknown showing it; a hazard without its warning
    that says nothing about the missing warning.
  */
  it("a tárolt csípés vagy méreg figyelmeztető sávot ad a kezelési figyelmeztetéssel, a nem és az ismeretlen nem", async () => {
    api.husbandry.mockResolvedValue(
      husbandry(
        {},
        { stingOrVenom: true, handlingWarning: "Kesztyűvel fogd meg." },
      ),
    );
    const { unmount } = render(
      <ProductHusbandryCard token="t" product={product("CORAL")} canManage />,
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Csípés vagy méreg");
    expect(alert.textContent).toContain("Kesztyűvel fogd meg.");
    unmount();

    for (const sting of [false, null]) {
      api.husbandry.mockResolvedValue(
        husbandry({}, { stingOrVenom: sting, handlingWarning: "Kesztyű." }),
      );
      const view = render(
        <ProductHusbandryCard token="t" product={product("CORAL")} canManage />,
      );
      await screen.findByTestId("husbandry-status");
      expect(screen.queryByRole("alert")).toBeNull();
      view.unmount();
    }
  });

  it("a figyelmeztetés nélkül talált veszély kimondja, hogy a figyelmeztetés hiányzik", async () => {
    api.husbandry.mockResolvedValue(
      husbandry({}, { stingOrVenom: true, handlingWarning: "   " }),
    );
    render(
      <ProductHusbandryCard token="t" product={product("CORAL")} canManage />,
    );
    expect(
      await screen.findByText(/A kezelési figyelmeztetés hiányzik/),
    ).toBeTruthy();
  });

  it("a sáv a tárolt állapotot mutatja, nem a még nem mentett piszkozatot", async () => {
    api.husbandry.mockResolvedValue(husbandry({}, { stingOrVenom: null }));
    render(
      <ProductHusbandryCard token="t" product={product("CORAL")} canManage />,
    );
    await screen.findByTestId("husbandry-status");
    fireEvent.change(screen.getByLabelText("Csípés vagy méreg"), {
      target: { value: "true" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a magyar nevet csak olvashatóan mutatja, a Nevek kártyára utalva", async () => {
    api.husbandry.mockResolvedValue(
      husbandry({}, { magyarNev: "Szarvkorall" }),
    );
    render(<ProductHusbandryCard token="t" product={product()} canManage />);
    const row = await screen.findByTestId("husbandry-name");
    expect(row.textContent).toContain("Szarvkorall");
    expect(row.textContent).toContain("Nevek kártyán");
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
    tempMinC: "",
    tempMaxC: "",
    salinityMinSg: "",
    salinityMaxSg: "",
    khMinDkh: "",
    khMaxDkh: "",
    lifespanYears: "",
    stingOrVenom: "",
    handlingWarning: "",
    quarantineWeeks: "",
    acclimatization: "",
    breedsInTank: "",
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

  it("az opcionális mezők: a szám szám (a tizedes marad), a logikai logikai, az üres törlés", () => {
    const stored = facts({
      tempMinC: "24.0",
      stingOrVenom: true,
      handlingWarning: "régi figyelmeztetés",
    });
    const result = husbandryChanges(
      stored,
      form({
        tempMinC: "24.5",
        salinityMinSg: "1.023",
        stingOrVenom: "false",
        handlingWarning: "",
        quarantineWeeks: "4",
        breedsInTank: "true",
      }),
    );
    expect(result.input).toEqual({
      tempMinC: 24.5,
      salinityMinSg: 1.023,
      stingOrVenom: false,
      handlingWarning: null,
      quarantineWeeks: 4,
      breedsInTank: true,
    });
    expect(result.badNumber).toBeNull();
  });

  it("a hibás számot megnevezi, és nem ad át értéket rá", () => {
    const result = husbandryChanges(facts(), form({ meretMax: "x" }));
    expect(result.badNumber).toBe("Kifejlett méret (cm)");
    expect(result.input).toEqual({});
  });
});
