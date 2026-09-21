import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  letoltHelyszin,
  RESZLET_HATAR,
  type HelyszinLetoltesFuggosegek,
} from "./helyszin-letoltes-futtato";

/**
 * A HELYSZIN LETOLTESENEK MENETE -- HALOZAT ES ADATBAZIS NELKUL.
 *
 * A hivasok befecskendezve jonnek, tehat a sorrend, a lapozas es a HIBAKEZELES
 * valodi allitasokkal merheto. A hangsuly a HIANYON van: a kartya legfontosabb
 * kikotese az, hogy a RESZLEGES letoltes ne latsszon teljesnek.
 *
 * A GYARTOK NEM A MOBIL VALODI TIPUSAIT HASZNALJAK, ES EZ NEM KENYELEM: a
 * `tsconfig.test.json` szandekosan nem hordoz `paths` bejegyzest, a valodi
 * tipusok modulja pedig `@/` alakkal importal tovabb -- egy ilyen import itt
 * `TS2307`-tel elhasalna, negy fajlra. A menet ezert SZERKEZETI alakokat var,
 * es a valodi tipusokkal a HIVO oldalan talalkozik a fordito.
 */
const eszkozSor = (id: string) => ({ id });
const eszkozLap = (sorok: { id: string }[], totalPages: number) => ({
  items: sorok,
  pagination: { page: 1, pageSize: 50, totalItems: sorok.length, totalPages },
});
const jegySor = (id: string, ut: string[] | null) => ({
  id,
  departmentPath: ut,
});
const munkalapLap = (darab: number, totalPages = 1) => ({
  items: Array.from({ length: darab }, (_, i) => ({ id: `w${i}` })),
  pagination: { page: 1, pageSize: 100, totalItems: darab, totalPages },
});

function fuggosegek(
  felulir: Partial<HelyszinLetoltesFuggosegek> = {},
): HelyszinLetoltesFuggosegek {
  return {
    eszkozLista: async () => eszkozLap([eszkozSor("a1"), eszkozSor("a2")], 1),
    /*
      A RESZLETLAP CSATOLMANY-LISTAT IS HORDOZ: a belyegkepek ebbol jonnek,
      kulon hivas nelkul. Alapban URES, hogy a mai allitasok valtozatlanul azt
      merjek, amit eddig -- a kepes agat ott kapcsoljuk be, ahol epp az a
      kerdes.
    */
    eszkozReszlet: async (id: string) => ({
      id,
      documents: [] as { id: string; contentType: string }[],
    }),
    belyegkepLetoltese: async () => {},
    eszkozokMentese: async () => {},
    eszkozReszletMentese: async () => {},
    jegyLista: async () => ({
      items: [jegySor("j1", ["Biodóm"])],
      truncated: false,
    }),
    jegyReszlet: async (id: string) => ({ id }),
    jegyekMentese: async () => {},
    jegyReszletMentese: async () => {},
    munkalapLista: async () => munkalapLap(2),
    munkalapReszlet: async (id: string) => ({ id }),
    munkalapMentese: async () => {},
    ...felulir,
  } as HelyszinLetoltesFuggosegek;
}

/**
 * EGY ZARO SOR A TARTALMA ALAPJAN, NEM A HELYE ALAPJAN.
 *
 * A sorok sorrendje VALTOZOTT, amikor a belyegkepek resze bekerult -- es
 * harom allitas azonnal pirosra ment, holott a MERT dolog valtozatlan volt.
 * Egy index a listaban nem a szandekot rogziti, hanem a mai elrendezest.
 */
const sorAmi = (sorok: readonly string[], minta: RegExp) => {
  const talalt = sorok.find((sor) => minta.test(sor));
  assert.ok(talalt, `nincs ilyen záró sor: ${minta}`);
  return talalt;
};

const futtat = (felulir: Partial<HelyszinLetoltesFuggosegek> = {}) =>
  letoltHelyszin(
    { helyszinNeve: "Biodóm", helyszinUt: ["Biodóm"] },
    fuggosegek(felulir),
  );

describe("a helyszín letöltésének menete", () => {
  it("minden lejön: a zárómondat kész", async () => {
    const eredmeny = await futtat();
    assert.equal(eredmeny.teljes, true);
    assert.match(eredmeny.cim, /kész/);
  });

  /**
   * EZ A KARTYA LEGFONTOSABB KIKOTESE. Ha otven eszkozbol harminc jott le, azt
   * KI KELL MONDANI: a szerelo a pinceben abbol indul ki, hogy megvan minden.
   *
   * MI PIROSIT: ha egy elhasalt reszletlap utan a zaro mondat "kesz" marad.
   */
  it("egyetlen elhasalt eszköz-adatlaptól HIÁNYOS lesz az egész", async () => {
    const eredmeny = await futtat({
      eszkozReszlet: async (id: string) => {
        if (id === "a2") throw new Error("nincs térerő");
        return { id, documents: [] as { id: string; contentType: string }[] };
      },
    });
    assert.equal(eredmeny.teljes, false);
    assert.match(eredmeny.cim, /HIÁNYOS/);
    assert.match(sorAmi(eredmeny.sorok, /eszköz/), /1 eszköz jött le/);
  });

  /**
   * A LAPOZAS VEGIGMEGY, ES A HIANYZO LAP IS HIANY.
   *
   * MI PIROSIT: egy olyan valtozat, ami csak az ELSO lapot keri le. A mai
   * meres szerint a legnagyobb reszfa 49 eszkoz az 50-es lapmeret mellett --
   * vagyis a hiba MA MEG nem latszana eles adaton, es egy uj eszkoz utan
   * csendben jelenne meg.
   */
  it("a lapozás végigmegy minden lapon", async () => {
    const kertLapok: number[] = [];
    const eredmeny = await futtat({
      eszkozLista: async (oldal) => {
        kertLapok.push(oldal);
        return eszkozLap([eszkozSor(`a${oldal}`)], 3);
      },
    });
    assert.deepEqual(kertLapok, [1, 2, 3]);
    assert.equal(eredmeny.teljes, true);
  });

  it("egy hiányzó lap HIÁNYOSSÁ teszi az eszköz-részt", async () => {
    const eredmeny = await futtat({
      eszkozLista: async (oldal) => {
        if (oldal === 2) throw new Error("megszakadt");
        return eszkozLap([eszkozSor(`a${oldal}`)], 3);
      },
    });
    assert.equal(eredmeny.teljes, false);
  });

  /**
   * A SZERVER VAGASA ATJON A ZARO MONDATBA. A jegylista ketszaz sornal
   * vagodik, es a valasz `truncated` mezoje errol szol -- ezt a mobil tukor
   * 2026-09-21-ig NEM IS DEKLARALTA, tehat a telefon nem tudott rola.
   */
  it("a szerver vágott jegylistája hiányként jelenik meg", async () => {
    const eredmeny = await futtat({
      jegyLista: async () => ({
        items: [jegySor("j1", ["Biodóm"])],
        truncated: true,
      }),
    });
    assert.equal(eredmeny.teljes, false);
    assert.match(sorAmi(eredmeny.sorok, /hibajegy/), /NEM került a készülékre/);
  });

  /**
   * A JEGY-RESZLETLAPOK A HELYSZIN UTJARA SZURNEK, es a rossz egyezes
   * BIZTONSAGOSAN romlik el: kevesebb reszletlap jon le, nem rossz adat.
   *
   * A LISTA VISZONT TELJESEN MENTODIK, mert az mar a szerver lathatosagi
   * szurese utan all -- idegen partner adata igy sem kerul a keszulekre.
   */
  it("a részletlapok a helyszínre szűrnek, a lista teljesen mentődik", async () => {
    const mentettLista: { id: string }[][] = [];
    const kertReszletek: string[] = [];
    await futtat({
      jegyLista: async () => ({
        items: [
          jegySor("j1", ["Biodóm"]),
          jegySor("j2", ["Kültér"]),
          jegySor("j3", null),
        ],
        truncated: false,
      }),
      jegyekMentese: async (items) => {
        mentettLista.push(items);
      },
      jegyReszlet: async (id) => {
        kertReszletek.push(id);
        return { id };
      },
    });
    assert.deepEqual(kertReszletek, ["j1"]);
    assert.equal(mentettLista[0]?.length, 3);
  });

  /**
   * A HATAR FELETT A LETOLTES ABBAHAGYJA, ES KIMONDJA. A hatar nem
   * optimalizacio, hanem OR: egy csendben lerovidult letoltes pont az a hiba,
   * ami ellen ez az egesz funkcio szol.
   */
  it("a részlet-határ fölött a záró mondat HIÁNYOS", async () => {
    const sok = Array.from({ length: RESZLET_HATAR + 1 }, (_, i) =>
      eszkozSor(`a${i}`),
    );
    const eredmeny = await futtat({
      eszkozLista: async () => eszkozLap(sok, 1),
    });
    assert.equal(eredmeny.teljes, false);
    assert.match(sorAmi(eredmeny.sorok, /eszköz/), /NEM került a készülékre/);
  });

  /**
   * POZITIV KONTROLL A MENTESRE: a menet TENYLEG ir a masolatba. Enelkul a
   * fenti allitasok egy olyan valtozatot is zolden hagynanak, ami mindent
   * lekér, es semmit nem ment el -- a szerelo pedig ures keszulekkel menne le.
   */
  it("POZITÍV KONTROLL: minden rész ír a másolatba", async () => {
    const irasok: string[] = [];
    await futtat({
      eszkozokMentese: async () => {
        irasok.push("eszkoz-lista");
      },
      eszkozReszletMentese: async () => {
        irasok.push("eszkoz-reszlet");
      },
      jegyekMentese: async () => {
        irasok.push("jegy-lista");
      },
      jegyReszletMentese: async () => {
        irasok.push("jegy-reszlet");
      },
      munkalapMentese: async () => {
        irasok.push("munkalap");
      },
    });
    for (const vart of [
      "eszkoz-lista",
      "eszkoz-reszlet",
      "jegy-lista",
      "jegy-reszlet",
      "munkalap",
    ])
      assert.ok(irasok.includes(vart), `nem irt a masolatba: ${vart}`);
  });
});

/**
 * A BELYEGKEPEK (d1cd720a, 2026-09-21).
 *
 * Balazs merese: „kepeket nem hozza be UnableToDownloadException". A letolto
 * EGYETLEN sort sem tartalmazott keprol -- nem hiba volt, hanem HIANY.
 */
describe("a helyszín bélyegképei", () => {
  const kepesReszlet = (id: string) => ({
    id,
    documents: [
      { id: `${id}-kep`, contentType: "image/jpeg" },
      { id: `${id}-pdf`, contentType: "application/pdf" },
    ],
  });

  it("csak a KÉPEKET tölti le, a többi csatolmányt nem", async () => {
    const kertek: string[] = [];
    const eredmeny = await futtat({
      eszkozLista: async () => eszkozLap([eszkozSor("a1")], 1),
      eszkozReszlet: async (id: string) => kepesReszlet(id),
      belyegkepLetoltese: async ({ documentId }) => {
        kertek.push(documentId);
      },
    });
    assert.deepEqual(kertek, ["a1-kep"]);
    assert.match(sorAmi(eredmeny.sorok, /bélyegkép/), /1 bélyegkép letöltve/);
  });

  /**
   * A KEP A `contentType`-BOL DOL EL, nem a fajlnev vegebol: egy `.pdf`
   * lehet szkennelt fenykep, es egy kiterjesztes nelkuli fajl is lehet kep.
   */
  it("a bélyegkép hibája HIÁNYOSSÁ teszi az egészet", async () => {
    const eredmeny = await futtat({
      eszkozLista: async () => eszkozLap([eszkozSor("a1")], 1),
      eszkozReszlet: async (id: string) => kepesReszlet(id),
      belyegkepLetoltese: async () => {
        throw new Error("nincs térerő");
      },
    });
    assert.equal(eredmeny.teljes, false);
    assert.match(eredmeny.cim, /HIÁNYOS/);
  });

  /**
   * POZITIV KONTROLL: kep nelkuli helyszinen a resz KESZ, nem elhasalt.
   *
   * Enelkul a fenti allitas egy olyan valtozatot is zolden hagyna, ami MINDEN
   * helyszint hianyosnak mond -- es akkor a zaro mondat elveszti a jelenteset.
   */
  it("kép nélküli helyszínen a rész KÉSZ", async () => {
    const eredmeny = await futtat();
    assert.equal(eredmeny.teljes, true);
    assert.match(sorAmi(eredmeny.sorok, /bélyegkép/), /0 bélyegkép letöltve/);
  });
});
