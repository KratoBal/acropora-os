import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MailTemplatePage } from "./mail-template-page";

/**
 * A LEVÉL-SABLON SZERKESZTŐJE (46413ef0).
 *
 * A három kikötés mindegyikére külön állítás áll, és mindegyik KÜLÖN `it()`:
 * a futtató a teszt nevét írja ki, nem az állításét, tehát egy közös blokkban
 * a kalibráció kimenetéből nem látszana, melyik fogott.
 */

const api = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }));

vi.mock("@/lib/api/mail-templates", async () => {
  const valodi = await vi.importActual<
    typeof import("@/lib/api/mail-templates")
  >("@/lib/api/mail-templates");
  return { ...valodi, mailTemplatesApi: api };
});

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      token: "token-1",
      user: { id: "user-1", email: "b@acropora.local", role: "OWNER" },
    },
  }),
}));

/**
 * A VÁLASZ SZÁNDÉKOSAN EGY OLYAN VÁLTOZÓT IS HOZ, AMI SEHOL NINCS BEÉGETVE.
 *
 * Ez az állítás lényege: ha a lap kézzel írt listát rajzolna ki, ez a név nem
 * jelenne meg -- és épp az ELSŐ ÚJ változónál válna ketté a felület a motortól.
 */
const VALASZ = {
  id: "WORKSHEET_SIGNED",
  /*
    A MEZO TIPUSA A KET ERTEKET FEDI, NEM CSAK A MAIT.

    Elso alakjaban `"default" as const` allt itt, es a `source: "stored"` eset
    NEM FORDULT LE -- a vitest futasa viszont ZOLD volt (10/10), mert az nem
    tipusellenoriz. A hibat a `typecheck` es a `build` fogta meg. Vagyis egy
    zold vitest-futas ebben a csomagban NEM kapu.
  */
  source: "default" as "default" | "stored",
  subject: "{{jegyszam}} {{jegy_targya}}",
  body: "Kedves {{cimzett}}!",
  variables: [
    { name: "cimzett", description: "A hibajegy nyitójának neve." },
    { name: "jegyszam", description: "A hibajegy száma." },
    { name: "jegy_targya", description: "A hibajegy címe." },
    { name: "holnaputani_valtozo", description: "Egy később felvett mező." },
  ],
};

const valaszal = (tulajdonsagok: Partial<typeof VALASZ> = {}) => {
  api.read.mockResolvedValue({ ...VALASZ, ...tulajdonsagok });
};

const megjelenit = async (tulajdonsagok: Partial<typeof VALASZ> = {}) => {
  valaszal(tulajdonsagok);
  render(<MailTemplatePage />);
  await waitFor(() => expect(screen.getByLabelText("Törzs")).toBeTruthy());
};

const torzs = () => screen.getByLabelText("Törzs") as HTMLTextAreaElement;

beforeEach(() => {
  api.read.mockReset();
  api.save.mockReset();
});

describe("a levélsablon szerkesztője", () => {
  /** 1. KIKÖTÉS: a változó-lista a VÁLASZBÓL jön, nem ittani felsorolásból. */
  it("azt a változót is kiírja, amit senki nem égetett a felületbe", async () => {
    await megjelenit();
    expect(screen.getByText("{{holnaputani_valtozo}}")).toBeTruthy();
    expect(screen.getByText("Egy később felvett mező.")).toBeTruthy();
    // KONTROLL: a lista nem ezt az EGYET mutatja, hanem mind a négyet.
    expect(screen.getByText("{{jegyszam}}")).toBeTruthy();
  });

  /**
   * 2. KIKÖTÉS: az előnézet UGYANAZT a motort használja, amit a küldés.
   *
   * A mérce nem az, hogy „behelyettesít valamit": egy sajátkezű `split`/`join`
   * is azt tenné. A SZÓKÖZÖS alak (`{{ jegyszam }}`) az, ami megkülönbözteti --
   * a közös motor mintája megengedi, egy kézzel írt csere jellemzően nem.
   */
  it("a szóközös alakot is behelyettesíti az előnézetben", async () => {
    await megjelenit({ body: "Szám: {{ jegyszam }}" });
    expect(screen.getByText(/Szám: HJ-2026-001/)).toBeTruthy();
  });

  /**
   * ÉS AZ ELŐNÉZET A MOTOR ELUTASÍTÁSÁT IS ÖRÖKLI. Ismeretlen névnél a küldés
   * NEM renderel -- ha az előnézet ilyenkor mutatna valamit, épp abban a
   * pillanatban hazudna, amikor a legtöbbet számít.
   */
  it("ismeretlen változónál nem mutat előnézetet", async () => {
    await megjelenit();
    fireEvent.change(torzs(), { target: { value: "Kedves {{nincs_ilyen}}!" } });
    expect(screen.getByText(/nem menne ki a levél/)).toBeTruthy();
  });

  /**
   * 3. KIKÖTÉS, ELSŐ FELE: az ismeretlen változó SZERKESZTÉSKOR látszik.
   *
   * A MEGNEVEZÉS ÉS A TILTÁS KÜLÖN `it()`: a kettő külön is el tud romlani (egy
   * elhagyott figyelmeztetés mellett a gomb még tilthat, és fordítva), és egy
   * közös állításnál a kalibráció kimenetéből nem látszana, melyik fogott.
   */
  it("az ismeretlen változót megnevezi", async () => {
    await megjelenit();
    fireEvent.change(torzs(), { target: { value: "Kedves {{nincs_ilyen}}!" } });
    /*
      A KERESES A FIGYELMEZTETESRE SZUKUL, NEM A TELJES LAPRA. Elso alakjaban a
      minta a SZERKESZTO MEZOJERE is illeszkedett -- ott all ugyanaz a szoveg,
      hiszen epp azt gepeltuk be. Ugyanaz a hatokor-hiba, mint amikor egy
      termeklap-allitas a fejlecben talalja meg a szot: a talalat igaz volt, es
      nem arrol szolt, amit merni akartam.
    */
    expect(screen.getByText("Ismeretlen változó a sablonban")).toBeTruthy();
    expect(
      screen.getByText(/ezeket a rendszer nem ismeri/).textContent,
    ).toContain("{{nincs_ilyen}}");
  });

  /** 3. KIKÖTÉS, MÁSODIK FELE: ilyen sablont el sem lehet menteni. */
  it("ismeretlen változóval a mentést nem engedi", async () => {
    await megjelenit();
    fireEvent.change(torzs(), { target: { value: "Kedves {{nincs_ilyen}}!" } });
    expect(
      (screen.getByRole("button", { name: "Mentés" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  /**
   * ÉS A TILTÁS FELOLDHATÓ -- KÜLÖN ÁLLÍTÁS, MERT KÜLÖN IS EL TUD ROMLANI.
   *
   * Egy mindig tiltó gomb ugyanúgy „átmenne" a fenti állításon. Ez méri, hogy
   * a kapu a SABLONRA szól, nem az állapotra.
   */
  it("helyes sablonnál a mentés megy", async () => {
    await megjelenit();
    expect(
      (screen.getByRole("button", { name: "Mentés" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  /**
   * AZ ELSŐ MENTÉS ELŐTT KIMONDJA, HOGY EZT MÉG SENKI NEM ÍRTA.
   *
   * A szerver a kódban álló alapértelmezést UGYANOLYAN alakban adja vissza,
   * mint egy tárolt sablont: a kettő a szövegből nem különböztethető meg.
   */
  it("kimondja, ha a kódban álló alapértelmezést látjuk", async () => {
    await megjelenit({ source: "default" });
    expect(
      screen.getByText("Ezt a szöveget még senki nem írta át"),
    ).toBeTruthy();
  });

  /** ÉS A KONTROLL: tárolt sablonnál ez a figyelmeztetés NINCS ott. */
  it("tárolt sablonnál nem írja ki a figyelmeztetést", async () => {
    await megjelenit({ source: "stored" });
    expect(
      screen.queryByText("Ezt a szöveget még senki nem írta át"),
    ).toBeNull();
  });

  /**
   * A VÁLTOZÓ BEILLESZTHETŐ -- ez Balázs szó szerinti kérése volt
   * (2026-09-21 11:39: „legyenek valtozok amiket be tudok illeszteni a level
   * torzsebe"). Egy lista, amiről csak leolvasni lehet, a gépelésre bízná a
   * pontos alakot.
   */
  it("a változóra kattintva a törzsbe kerül a jele", async () => {
    await megjelenit({ body: "" });
    fireEvent.click(screen.getByText("{{jegyszam}}"));
    await waitFor(() => expect(torzs().value).toContain("{{jegyszam}}"));
  });

  /** A MENTÉS AZT KÜLDI, AMI A MEZŐKBEN ÁLL, ÉS UTÁNA ÚJRAOLVAS. */
  it("a szerkesztett szöveget küldi el, és újraolvassa a sablont", async () => {
    await megjelenit({ body: "Régi" });
    api.save.mockResolvedValue({ ok: true });
    fireEvent.change(torzs(), { target: { value: "Új törzs" } });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(api.save.mock.calls[0]?.[2]).toMatchObject({ body: "Új törzs" });
    // AZ ELSO olvasas a betoltes volt; a mentes utan MEG egy kell.
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2));
  });
});
