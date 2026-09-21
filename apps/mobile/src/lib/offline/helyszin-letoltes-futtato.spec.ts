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
    eszkozReszlet: async (id: string) => ({ id }),
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
      eszkozReszlet: async (id) => {
        if (id === "a2") throw new Error("nincs térerő");
        return { id };
      },
    });
    assert.equal(eredmeny.teljes, false);
    assert.match(eredmeny.cim, /HIÁNYOS/);
    assert.match(eredmeny.sorok[0]!, /1 eszköz jött le/);
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
    assert.match(eredmeny.sorok[1]!, /NEM került a készülékre/);
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
    assert.match(eredmeny.sorok[0]!, /NEM került a készülékre/);
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
