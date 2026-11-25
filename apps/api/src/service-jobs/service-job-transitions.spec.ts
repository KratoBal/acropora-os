import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ServiceJobStatus } from "@acropora/database";

import {
  allowedServiceJobSteps,
  isServiceJobFinished,
  isServiceJobStepAllowed,
} from "./service-job-transitions.js";

const ALLAPOTOK: readonly ServiceJobStatus[] = [
  "NEW",
  "TRIAGED",
  "SCHEDULED",
  "IN_PROGRESS",
  "WAITING_FOR_PARTS",
  "WAITING_FOR_CUSTOMER",
  "COMPLETED",
  "CANCELLED",
];

describe("melyik lépés engedélyezett egy hibajegyen", () => {
  it("a megszokott menet végigmegy", () => {
    assert.ok(isServiceJobStepAllowed("NEW", "IN_PROGRESS"));
    assert.ok(isServiceJobStepAllowed("IN_PROGRESS", "WAITING_FOR_PARTS"));
    assert.ok(isServiceJobStepAllowed("WAITING_FOR_PARTS", "IN_PROGRESS"));
    assert.ok(isServiceJobStepAllowed("IN_PROGRESS", "COMPLETED"));
  });

  /**
   * A FELMÉRVE ÉS AZ ÜTEMEZVE NEM CÉL (közös állapot-lista, 2026-11-25): egyik
   * állapotból sem lehet beléjük lépni, de a meglévő ilyen jegyek nem ragadnak
   * be, ugyanoda léphetnek, ahova egy Új.
   */
  it("TRIAGED és SCHEDULED nem cél, de belőlük tovább lehet lépni", () => {
    for (const honnan of ALLAPOTOK) {
      assert.ok(!isServiceJobStepAllowed(honnan, "TRIAGED"), honnan);
      assert.ok(!isServiceJobStepAllowed(honnan, "SCHEDULED"), honnan);
    }
    for (const regi of ["TRIAGED", "SCHEDULED"] as const)
      assert.deepEqual(
        allowedServiceJobSteps(regi),
        allowedServiceJobSteps("NEW"),
      );
  });

  it("a két várakozás egymás közt átjárható", () => {
    assert.ok(
      isServiceJobStepAllowed("WAITING_FOR_PARTS", "WAITING_FOR_CUSTOMER"),
    );
    assert.ok(
      isServiceJobStepAllowed("WAITING_FOR_CUSTOMER", "WAITING_FOR_PARTS"),
    );
  });

  /**
   * A LEZÁRT ÉS AZ ELÁLLT VÉGLEGES. Egy újraélesztett jegyen nem lehetne
   * megmondani, melyik munkalap melyik körhöz tartozott - a számlázásnál ez
   * visszamenőleg kétértelmű. Ha kell a munka, az ÚJ jegy.
   */
  it("a kész és az elállt jegyből nincs út vissza", () => {
    assert.deepEqual(allowedServiceJobSteps("COMPLETED"), []);
    assert.deepEqual(allowedServiceJobSteps("CANCELLED"), []);
    assert.ok(isServiceJobFinished("COMPLETED"));
    assert.ok(isServiceJobFinished("CANCELLED"));
  });

  /**
   * ÉS AMI NEM MEHET, NÉV SZERINT. Egy tábla, amit csak a megengedett
   * irányból mérünk, akkor is zöld volna, ha MINDENT engedne - ez az
   * állítás az, ami a tábla SZŰKÍTŐ erejét méri.
   */
  it("a végállapotokba nem lehet visszalépni, és a kész nem folytatható", () => {
    assert.ok(!isServiceJobStepAllowed("COMPLETED", "IN_PROGRESS"));
    assert.ok(!isServiceJobStepAllowed("CANCELLED", "NEW"));
    assert.ok(!isServiceJobStepAllowed("NEW", "COMPLETED"));
    assert.ok(!isServiceJobStepAllowed("IN_PROGRESS", "CANCELLED"));
  });

  /**
   * MINDEN ÁLLAPOTNAK VAN SORA. Egy hiányzó kulcs futásidőben dobna, és a
   * hiba az első olyan jegynél derülne ki, ami abba az állapotba kerül.
   */
  it("nincs olyan állapot, aminek ne lenne sora", () => {
    for (const status of ALLAPOTOK)
      assert.ok(Array.isArray(allowedServiceJobSteps(status)), status);
  });
});

/**
 * A RÉGI ÉS AZ ÚJ TÁBLA, SORONKÉNT (terv 8/d pont, barracuda 61809).
 *
 * A régi tábla itt szó szerint áll (2026-09-02, Balázs menete). A szándékos
 * eltérések név szerint, minden más eltérés piros: így egy véletlenül elvett
 * vagy hozzáadott lépés nem bújik el a nagy átírás mögött.
 */
describe("a közös állapot-lista átmenet-táblája a régihez képest", () => {
  const REGI: Record<ServiceJobStatus, readonly ServiceJobStatus[]> = {
    NEW: ["TRIAGED", "SCHEDULED", "CANCELLED"],
    TRIAGED: [
      "SCHEDULED",
      "WAITING_FOR_PARTS",
      "WAITING_FOR_CUSTOMER",
      "CANCELLED",
    ],
    SCHEDULED: ["IN_PROGRESS", "WAITING_FOR_CUSTOMER", "CANCELLED"],
    IN_PROGRESS: ["COMPLETED", "WAITING_FOR_PARTS", "WAITING_FOR_CUSTOMER"],
    WAITING_FOR_PARTS: ["SCHEDULED", "IN_PROGRESS", "CANCELLED"],
    WAITING_FOR_CUSTOMER: ["SCHEDULED", "IN_PROGRESS", "CANCELLED"],
    COMPLETED: [],
    CANCELLED: [],
  };

  /** honnan -> hova, ahol a régi és az új tábla eltér, az eltérés okával. */
  const SZANDEKOS: Record<string, "ki" | "be"> = {
    // a TRIAGED és a SCHEDULED mint cél kivezetve
    "NEW->TRIAGED": "ki",
    "NEW->SCHEDULED": "ki",
    "TRIAGED->SCHEDULED": "ki",
    "WAITING_FOR_PARTS->SCHEDULED": "ki",
    "WAITING_FOR_CUSTOMER->SCHEDULED": "ki",
    // az Új és a régi köztes állapotok egyenesen munkába vagy várakozásba
    "NEW->IN_PROGRESS": "be",
    "NEW->WAITING_FOR_PARTS": "be",
    "NEW->WAITING_FOR_CUSTOMER": "be",
    "TRIAGED->IN_PROGRESS": "be",
    "SCHEDULED->WAITING_FOR_PARTS": "be",
    // a két várakozás egymás közt
    "WAITING_FOR_PARTS->WAITING_FOR_CUSTOMER": "be",
    "WAITING_FOR_CUSTOMER->WAITING_FOR_PARTS": "be",
  };

  it("csak a név szerint felsorolt lépések térnek el", () => {
    const elteres: Record<string, "ki" | "be"> = {};
    for (const honnan of ALLAPOTOK)
      for (const hova of ALLAPOTOK) {
        const regi = REGI[honnan].includes(hova);
        const uj = isServiceJobStepAllowed(honnan, hova);
        if (regi !== uj) elteres[`${honnan}->${hova}`] = uj ? "be" : "ki";
      }
    assert.deepEqual(elteres, SZANDEKOS);
  });
});
