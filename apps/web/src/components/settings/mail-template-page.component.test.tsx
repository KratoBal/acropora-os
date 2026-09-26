import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
  /*
    A DUPLA VARRATA, ES A FORDITO ITT NEM SZOL: az `api.read` egy `vi.fn()`,
    tehat a valasz alakja NINCS a `MailTemplateResponse` tipushoz merve. Amit a
    HIVO hasznal (a visszatoltes gombja ezt olvassa), de a dupla nem ad meg, az
    a dupla biztos hibaja -- es itt `undefined`-kent erkezne, nem hibauzenetkent.
  */
  defaultTemplate: {
    subject: "{{jegyszam}} alapértelmezett tárgy",
    body: "Alapértelmezett törzs: {{jegy_targya}}",
  },
  subject: "{{jegyszam}} {{jegy_targya}}",
  body: "Kedves {{cimzett}}!",
  /*
    2026-09-26 OTA A VALASZ HORDOZZA. `null`: a sablon szoveges, a lap a `body`-t
    alakitja at. A szerver `null`-t ad, nem hianyzo kulcsot -- a dupla ugyanigy.
  */
  bodyHtml: null as string | null,
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

/**
 * A TORZS 2026-09-26 OTA NEM `<textarea>`, HANEM EGY TIPTAP SZERKESZTO.
 *
 * A `contenteditable` elemen a `fireEvent.change` nem mukodik (nincs `value`),
 * es a billentyu-szimulacio a happy-dom alatt nem hu a bongeszohoz. Ezert a
 * szerkesztot a SAJAT parancsaval allitjuk -- a TipTap a DOM-elemre teszi ki a
 * peldanyt (`dom.editor`), es a `setContent` ugyanazt az `onUpdate` utat
 * jarja be, mint a gepeles. Ez a korlat: a gepelest magat nem mertuk.
 */
interface SzerkesztoPeldany {
  getHTML(): string;
  commands: {
    setContent(tartalom: string, opciok?: { emitUpdate?: boolean }): boolean;
  };
}
const szerkeszto = () =>
  (
    screen.getByLabelText("Törzs") as HTMLElement & {
      editor: SzerkesztoPeldany;
    }
  ).editor;
const torzsBeir = (html: string) =>
  act(() => {
    szerkeszto().commands.setContent(html, { emitUpdate: true });
  });
const szovegesElonezet = () => {
  fireEvent.click(screen.getByRole("tab", { name: "Szöveges" }));
};

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
    /*
      TAROLT HTML-KENT, NEM SZOVEGKENT: a szoveg atalakitasa az ismert nevet
      atomma teszi es a szokozt eldobja, tehat a motor szokoz-turese nem lenne
      merve. A nyers helyorzo a HTML-ben szoveg marad.
    */
    await megjelenit({ bodyHtml: "<p>Szám: {{ jegyszam }}</p>" });
    szovegesElonezet();
    expect(screen.getByText(/Szám: HJ-2026-001/)).toBeTruthy();
  });

  /**
   * ÉS AZ ELŐNÉZET A MOTOR ELUTASÍTÁSÁT IS ÖRÖKLI. Ismeretlen névnél a küldés
   * NEM renderel -- ha az előnézet ilyenkor mutatna valamit, épp abban a
   * pillanatban hazudna, amikor a legtöbbet számít.
   */
  it("ismeretlen változónál nem mutat előnézetet", async () => {
    await megjelenit();
    await torzsBeir("<p>Kedves {{nincs_ilyen}}!</p>");
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
    await torzsBeir("<p>Kedves {{nincs_ilyen}}!</p>");
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
    await torzsBeir("<p>Kedves {{nincs_ilyen}}!</p>");
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
  /*
    ATOMKENT KERUL BE, NEM SZOVEGKENT: a `data-variable` jeloles az, ami miatt
    egy kesobbi formazas nem vaghatja ketté.
  */
  it("a változóra kattintva a törzsbe kerül, atomként", async () => {
    await megjelenit({ body: "" });
    fireEvent.click(screen.getByText("{{jegyszam}}"));
    await waitFor(() =>
      expect(szerkeszto().getHTML()).toContain(
        '<span data-variable="jegyszam">{{jegyszam}}</span>',
      ),
    );
  });

  /**
   * A MENTÉS A FORMÁZOTT TÖRZSET ÉS A SZÖVEGES VETÜLETÉT EGYÜTT KÜLDI, ÉS
   * UTÁNA ÚJRAOLVAS.
   */
  it("a szerkesztett törzset HTML-ként és szövegként küldi el, és újraolvas", async () => {
    await megjelenit({ body: "Régi" });
    api.save.mockResolvedValue({ ok: true });
    await torzsBeir("<p>Új <strong>törzs</strong></p>");
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(api.save.mock.calls[0]?.[2]).toEqual({
      subject: "{{jegyszam}} {{jegy_targya}}",
      body: "Új törzs",
      bodyHtml: "<p>Új <strong>törzs</strong></p>",
    });
    // AZ ELSO olvasas a betoltes volt; a mentes utan MEG egy kell.
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2));
  });

  /** A SZOVEGES SABLON BEKEZDESEKKE ES ATOMOKKA ALAKUL, A SZERVER NEM KAP SEMMIT. */
  it("szöveges sablont formázottá alakít betöltéskor, mentés nélkül", async () => {
    await megjelenit({ body: "Kedves {{cimzett}}!\n\nMásodik bekezdés" });
    expect(szerkeszto().getHTML()).toBe(
      '<p>Kedves <span data-variable="cimzett">{{cimzett}}</span>!</p><p>Második bekezdés</p>',
    );
    expect(api.save).not.toHaveBeenCalled();
  });

  it("tárolt formázott sablonnál a tárolt HTML-t tölti be", async () => {
    await megjelenit({
      body: "ezt nem használja",
      bodyHtml: "<p><em>Formázott</em> törzs</p>",
    });
    expect(szerkeszto().getHTML()).toBe("<p><em>Formázott</em> törzs</p>");
  });

  /**
   * A KETTÉVÁGOTT VÁLTOZÓ: a figyelmeztetés MEGNEVEZI, és a mentés tilt. Két
   * `it()`, ugyanabból az okból, mint az ismeretlen változónál.
   */
  it("a formázás által kettévágott változót megnevezi", async () => {
    await megjelenit();
    await torzsBeir("<p>{{jegy<strong>szam</strong>}}</p>");
    expect(screen.getByText("Kettévágott változó a sablonban")).toBeTruthy();
    expect(
      screen.getByText(/egy formázás a változó közepére került/).textContent,
    ).toContain("{{jegyszam}}");
  });

  it("kettévágott változóval a mentést nem engedi", async () => {
    await megjelenit();
    await torzsBeir("<p>{{jegy<strong>szam</strong>}}</p>");
    expect(
      (screen.getByRole("button", { name: "Mentés" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  /**
   * AZ ELŐNÉZET IFRAME-JE SEMMIT NEM FUTTAT, ÉS A MINTA-ÉRTÉK ESCAPE-ELVE ÁLL
   * BENNE -- ugyanazon az úton, mint küldéskor.
   */
  it("a formázott előnézet homokozóban áll, a behelyettesített tartalommal", async () => {
    await megjelenit({
      bodyHtml: "<p><strong>Tárgy:</strong> {{jegy_targya}}</p>",
    });
    const keret = screen.getByTitle(
      "A levél formázott előnézete",
    ) as HTMLIFrameElement;
    expect(keret.getAttribute("sandbox")).toBe("");
    expect(keret.getAttribute("srcdoc")).toContain(
      "<p><strong>Tárgy:</strong> Szivattyú zúg</p>",
    );
  });
});

/**
 * AZ ALAPERTELMEZES VISSZAHOZHATO AZ ELSO MENTES UTAN IS (880f3588).
 *
 * 2026-09-21-ig a szerver a tarolt sort VAGY a kodban allot adta, soha a
 * kettot egyutt -- tehat az elso mentes utan az alapertelmezes elerhetetlen
 * volt. Nem tunt el: ott allt a kodban, csak semmi nem adta oda.
 */
describe("MailTemplatePage és az alapértelmezés visszatöltése", () => {
  it("MENTETT sablonnál felkínálja a visszatöltést", async () => {
    await megjelenit({
      source: "stored",
      subject: "Átírt tárgy",
      body: "Átírt törzs",
    });

    expect(
      screen.getByRole("button", { name: "Alapértelmezés visszatöltése" }),
    ).toBeTruthy();
  });

  it("a visszatöltés a mezőkbe tölt, és NEM ment", async () => {
    api.save.mockClear();
    await megjelenit({
      source: "stored",
      subject: "Átírt tárgy",
      body: "Átírt törzs",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Alapértelmezés visszatöltése" }),
    );

    expect(
      (screen.getByLabelText("Tárgy") as HTMLInputElement).value,
    ).toContain("alapértelmezett tárgy");

    /*
      A GOMB NEM IR. Egy visszatoltes, ami egy kattintasra felulirja a ma
      hatalyos sablont, ugyanaz a nema muvelet, mint amit ez a kartya javit --
      csak forditva. A mentes a szerkeszto dontese marad.
    */
    expect(api.save).not.toHaveBeenCalled();
  });

  /*
    ISMERT POZITIV KONTROLL A FENTI TAGADAS MELLE: a Mentes gomb ATTOL MEG ir.
    Enelkul a "nem hivta a mentest" allitas egy olyan lapon is zold lenne, ahol
    SEMMI nem ment -- es akkor nem a gombot mernenk, hanem a lap halalat.
  */
  it("a Mentés gomb továbbra is ír (pozitív kontroll)", async () => {
    api.save.mockClear().mockResolvedValue({ ok: true });
    await megjelenit({ source: "stored" });

    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));

    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
  });

  /*
    ES AHOL NINCS MIT VISSZAALLITANI, OTT NINCS GOMB. Egy gomb, ami nem
    valtoztat semmin, azt igeri, hogy a mezoben mas all, mint ami.
  */
  it("ha a szerkesztőben ÉPPEN az alapértelmezés áll, nincs gomb", async () => {
    await megjelenit({
      source: "stored",
      subject: "{{jegyszam}} alapértelmezett tárgy",
      body: "Alapértelmezett törzs: {{jegy_targya}}",
    });

    expect(
      screen.queryByRole("button", { name: "Alapértelmezés visszatöltése" }),
    ).toBeNull();
  });
});
