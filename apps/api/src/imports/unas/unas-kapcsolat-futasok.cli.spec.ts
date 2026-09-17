import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  runKapcsolatFutasokCli,
  type FutasSor,
} from "./unas-kapcsolat-futasok.cli.js";

function kimenet() {
  const sorok: string[] = [];
  const hibak: string[] = [];
  return {
    sorok,
    hibak,
    out: {
      stdout: (v: string) => sorok.push(v),
      stderr: (v: string) => hibak.push(v),
    },
  };
}

function futas(reszlet: Partial<FutasSor> = {}): FutasSor {
  return {
    id: "f-1",
    startedAt: new Date(2026, 8, 17, 3, 0, 0),
    completedAt: new Date(2026, 8, 17, 3, 2, 0),
    applied: false,
    stopped: false,
    errorCode: null,
    rowsBefore: 100,
    rowsPlanned: 120,
    similarRelationsPlanned: 12,
    similarRelationsWritten: 0,
    similarRelationsRemoved: 0,
    similarReferencesUnresolved: 3,
    accessoryRelationsPlanned: 8,
    accessoryRelationsWritten: 0,
    accessoryRelationsRemoved: 0,
    accessoryReferencesUnresolved: 1,
    unreadableSnapshots: 2,
    withoutExternalId: 5,
    ...reszlet,
  };
}

describe("kapcsolat-újraépítés futásainak olvasása", () => {
  it("a terv-futást tervnek nevezi, és kiírja a változást", async () => {
    const { out, sorok } = kimenet();
    const kod = await runKapcsolatFutasokCli([], out, {
      futasok: async () => [futas()],
    });

    assert.equal(kod, 0);
    const szoveg = sorok.join("");
    assert.match(szoveg, /tervet készített/);
    assert.match(szoveg, /sorok: 100 -> 120 \(\+20\)/);
  });

  /**
   * A MEGALLT FUTAS SAJAT SZOT KAP, ES EZ NEM STILUS.
   *
   * Egy megallt futas `applied: false`, tehat a mezokbol ugyanugy nez ki, mint
   * egy terv. Ha a kimenet is ugyanazt mondana rola, a tabla legerdekesebb sora
   * lenne olvashatatlan.
   */
  it("a megállt futást megkülönbözteti a tervtől", async () => {
    const { out, sorok } = kimenet();
    await runKapcsolatFutasokCli([], out, {
      futasok: async () => [futas({ stopped: true })],
    });

    const szoveg = sorok.join("");
    assert.match(szoveg, /MEGALLT a nagy változás határán/);
    assert.doesNotMatch(szoveg, /tervet készített/);
  });

  it("az író futást írónak nevezi", async () => {
    const { out, sorok } = kimenet();
    await runKapcsolatFutasokCli([], out, {
      futasok: async () => [futas({ applied: true })],
    });
    assert.match(sorok.join(""), /ÍRT/);
  });

  it("a hibás futás hibakódját kiírja", async () => {
    const { out, sorok } = kimenet();
    await runKapcsolatFutasokCli([], out, {
      futasok: async () => [
        futas({ errorCode: "UNAS_RELATION_REBUILD_FAILED" }),
      ],
    });
    assert.match(sorok.join(""), /HIBA \(UNAS_RELATION_REBUILD_FAILED\)/);
  });

  /**
   * AZ URES EREDMENY IS VALASZ. Egy ures kimenet megkulonboztethetetlen attol,
   * mintha a parancs el sem indult volna.
   */
  it("az üres eredményt kimondja", async () => {
    const { out, sorok } = kimenet();
    const kod = await runKapcsolatFutasokCli([], out, {
      futasok: async () => [],
    });

    assert.equal(kod, 0);
    assert.match(sorok.join(""), /Egyetlen futás sincs feljegyezve/);
  });

  /**
   * AZ ATLAG CSAK A TERV-FUTASOKBOL SZAMOL, es ezt kulon kell merni: egy IRO
   * futas utan a kovetkezo mar a sajat eredmenyet latja kiindulasnak, tehat a
   * valtozasa nem az elsodrast meri.
   */
  it("az átlagba csak a terv-futások számítanak bele", async () => {
    const { out, sorok } = kimenet();
    await runKapcsolatFutasokCli([], out, {
      futasok: async () => [
        futas({ rowsBefore: 100, rowsPlanned: 110 }),
        futas({ rowsBefore: 200, rowsPlanned: 210 }),
        futas({ applied: true, rowsBefore: 100, rowsPlanned: 900 }),
        futas({ errorCode: "X", rowsBefore: 100, rowsPlanned: 900 }),
      ],
    });

    // KET terv-futas van, a valtozasuk 10 es 10 -- az iro futas 800-a nem szamit.
    assert.match(
      sorok.join(""),
      /2 terv-futás alapján a változás átlaga 10 sor/,
    );
  });

  it("a rossz --limit értéket elutasítja, és nem kérdez le", async () => {
    const { out, hibak } = kimenet();
    let hivas = 0;
    const kod = await runKapcsolatFutasokCli(["--limit", "0"], out, {
      futasok: async () => {
        hivas += 1;
        return [];
      },
    });

    assert.equal(kod, 1);
    assert.equal(hivas, 0);
    assert.match(hibak.join(""), /1 és 500 közötti/);
  });

  it("a --limit értékét átadja a lekérdezésnek", async () => {
    const { out } = kimenet();
    const kapott: number[] = [];
    await runKapcsolatFutasokCli(["--limit", "3"], out, {
      futasok: async (limit) => {
        kapott.push(limit);
        return [];
      },
    });
    assert.deepEqual(kapott, [3]);
  });

  it("a hibát megnevezi, és nem nulla kóddal tér vissza", async () => {
    const { out, hibak } = kimenet();
    const kod = await runKapcsolatFutasokCli([], out, {
      futasok: async () => {
        throw new Error("a tábla nem olvasható");
      },
    });

    assert.equal(kod, 1);
    assert.match(hibak.join(""), /a tábla nem olvasható/);
  });
});
