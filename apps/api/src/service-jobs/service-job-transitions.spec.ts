import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  allowedServiceJobSteps,
  isServiceJobFinished,
  isServiceJobStepAllowed,
  serviceJobStepRequiresNote,
  SERVICE_JOB_NOTE_REQUIRED_MESSAGES,
} from "./service-job-transitions.js";

describe("melyik lépés engedélyezett egy hibajegyen", () => {
  it("a megszokott menet végigmegy", () => {
    assert.ok(isServiceJobStepAllowed("NEW", "TRIAGED"));
    assert.ok(isServiceJobStepAllowed("TRIAGED", "SCHEDULED"));
    assert.ok(isServiceJobStepAllowed("SCHEDULED", "IN_PROGRESS"));
    assert.ok(isServiceJobStepAllowed("IN_PROGRESS", "COMPLETED"));
  });

  /**
   * A SÜRGŐS ESET KIHAGYJA A MÉRLEGELÉST. Balázs 2026-09-02: „Igen
   * előfordul." A tábla az ÁTMENETET engedi; hogy KI teheti meg, az
   * jogosultsági kérdés, és szándékosan nincs itt.
   */
  it("sürgős esetben a mérlegelés kihagyható", () => {
    assert.ok(isServiceJobStepAllowed("NEW", "SCHEDULED"));
  });

  /**
   * A VÁRAKOZÁSBÓL VALÓ VISSZATÉRÉS NEM SIMA FOLYTATÁS, és ez az állítás
   * pontosan azt méri: mire az alkatrész megjön, az eredeti időpont már
   * elmúlt, tehát ÚJ ütemezés kell. Az `IN_PROGRESS` is engedett, de csak
   * arra az esetre, ha a szerelő ott van.
   */
  it("a várakozásból új időpontra is lehet lépni, nem csak folytatásra", () => {
    for (const varakozas of [
      "WAITING_FOR_PARTS",
      "WAITING_FOR_CUSTOMER",
    ] as const) {
      assert.ok(isServiceJobStepAllowed(varakozas, "SCHEDULED"));
      assert.ok(isServiceJobStepAllowed(varakozas, "IN_PROGRESS"));
    }
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
    assert.ok(!isServiceJobStepAllowed("NEW", "IN_PROGRESS"));
  });

  /**
   * MINDEN ÁLLAPOTNAK VAN SORA. Egy hiányzó kulcs futásidőben dobna, és a
   * hiba az első olyan jegynél derülne ki, ami abba az állapotba kerül.
   */
  /**
   * A KOVETELMENY A RENDES MENETET NEM ERINTI, ES EZ AZ ALLITAS FELE.
   *
   * Egy allitas, ami csak azt meri, hogy a harom kijelolt allapot kotelezo,
   * AKKOR IS ZOLD LENNE, ha a fuggveny MINDENRE igazat adna. A negatik ag nelkul
   * nem tudnank, hogy a szukites egyaltalan szukit.
   */
  it("indokot csak a harom kilepo allapot kovetel, a rendes menet nem", () => {
    for (const to of [
      "CANCELLED",
      "WAITING_FOR_PARTS",
      "WAITING_FOR_CUSTOMER",
    ] as const) {
      assert.ok(serviceJobStepRequiresNote(to), to);
    }
    for (const to of [
      "NEW",
      "TRIAGED",
      "SCHEDULED",
      "IN_PROGRESS",
      "COMPLETED",
    ] as const) {
      assert.ok(!serviceJobStepRequiresNote(to), to);
    }
  });

  /**
   * MINDEN KOVETELT ALLAPOTNAK VAN SAJAT MONDATA, ES A HAROM KULONBOZIK.
   *
   * A lista a FUGGVENYBOL jon, nem kezzel irva: ha egy negyedik allapot kerul a
   * kovetelmeny ala uzenet nelkul, ez az allitas pirosodik. Egy kezzel irt
   * felsorolas pontosan az uj esetet hagyna ki.
   */
  it("minden indokot kovetelo allapotnak sajat mondata van", () => {
    const required = (
      [
        "NEW",
        "TRIAGED",
        "SCHEDULED",
        "IN_PROGRESS",
        "WAITING_FOR_PARTS",
        "WAITING_FOR_CUSTOMER",
        "COMPLETED",
        "CANCELLED",
      ] as const
    ).filter((status) => serviceJobStepRequiresNote(status));

    for (const status of required) {
      assert.ok(SERVICE_JOB_NOTE_REQUIRED_MESSAGES[status], status);
    }
    const messages = required.map(
      (status) => SERVICE_JOB_NOTE_REQUIRED_MESSAGES[status],
    );
    assert.equal(new Set(messages).size, required.length);
  });

  it("nincs olyan állapot, aminek ne lenne sora", () => {
    for (const status of [
      "NEW",
      "TRIAGED",
      "SCHEDULED",
      "IN_PROGRESS",
      "WAITING_FOR_PARTS",
      "WAITING_FOR_CUSTOMER",
      "COMPLETED",
      "CANCELLED",
    ] as const) {
      assert.ok(Array.isArray(allowedServiceJobSteps(status)), status);
    }
  });
});
