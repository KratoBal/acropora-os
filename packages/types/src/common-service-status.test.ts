import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMMON_SERVICE_STATUSES,
  commonJobStatus,
  commonServiceStateText,
  commonServiceStateTone,
  commonWorksheetStatus,
  partnerClosedReasonLabel,
  partnerStatusFromCommon,
  partnerWorksheetState,
  partnerWorksheetVersionLabel,
  type CommonJobWorksheetFacts,
  type CommonServiceState,
} from "./common-service-status.js";
import {
  ALL_SERVICE_JOB_STATUS_VALUES,
  partnerVisibleStatus,
  type ServiceJobStatusValue,
} from "./service-job-management.js";
import type { WorksheetVersionStatus } from "./worksheet-management.js";

const lap = (
  currentVersionStatus: WorksheetVersionStatus | null,
  handedOver = false,
): CommonJobWorksheetFacts => ({ currentVersionStatus, handedOver });

/**
 * A MUNKALAP-TÉNYEK MINDEN MA ELŐFORDULÓ ALAKJA, NÉVVEL. Egy lapos és vegyes
 * esetek: a levezetés a „mindegyik" feltételen és az okok sorrendjén múlik,
 * tehát a vegyes sorok a lényeg.
 */
const LAPOK: Record<string, readonly CommonJobWorksheetFacts[]> = {
  "nincs lap": [],
  piszkozat: [lap("DRAFT")],
  "verzió nélküli": [lap(null)],
  elutasított: [lap("REJECTED")],
  "aláírásra vár": [lap("AWAITING_SIGNATURE")],
  "aláírva, nincs átadva": [lap("SIGNED")],
  "aláírva és átadva": [lap("SIGNED", true)],
  "aláírásra vár + aláírva és átadva": [
    lap("AWAITING_SIGNATURE"),
    lap("SIGNED", true),
  ],
  "aláírva és átadva + aláírva, nincs átadva": [
    lap("SIGNED", true),
    lap("SIGNED"),
  ],
  "aláírva és átadva + piszkozat": [lap("SIGNED", true), lap("DRAFT")],
  "aláírásra vár + elutasított": [lap("AWAITING_SIGNATURE"), lap("REJECTED")],
  "aláírva és átadva + verzió nélküli": [lap("SIGNED", true), lap(null)],
};

const ALLAPOT = (
  status: CommonServiceState["status"],
  reason: CommonServiceState["reason"] = null,
): CommonServiceState => ({ status, reason });

/** Az IN_PROGRESS jegy: az egyetlen, ahol a lapok számítanak. */
const FOLYAMATBAN_VART: Record<keyof typeof LAPOK, CommonServiceState> = {
  "nincs lap": ALLAPOT("IN_PROGRESS"),
  piszkozat: ALLAPOT("IN_PROGRESS"),
  "verzió nélküli": ALLAPOT("IN_PROGRESS"),
  elutasított: ALLAPOT("IN_PROGRESS"),
  "aláírásra vár": ALLAPOT("DONE", "AWAITING_SIGNATURE"),
  "aláírva, nincs átadva": ALLAPOT("DONE", "AWAITING_HANDOVER"),
  "aláírva és átadva": ALLAPOT("DONE", "READY_TO_CLOSE"),
  "aláírásra vár + aláírva és átadva": ALLAPOT("DONE", "AWAITING_SIGNATURE"),
  "aláírva és átadva + aláírva, nincs átadva": ALLAPOT(
    "DONE",
    "AWAITING_HANDOVER",
  ),
  "aláírva és átadva + piszkozat": ALLAPOT("IN_PROGRESS"),
  "aláírásra vár + elutasított": ALLAPOT("IN_PROGRESS"),
  "aláírva és átadva + verzió nélküli": ALLAPOT("IN_PROGRESS"),
};

/**
 * A TÖBBI HÉT ÁLLAPOT: a lapoktól FÜGGETLEN eredmény. `Record`, tehát egy új
 * tárolt állapot a fordításnál hiányzik innen, nem a felületen.
 */
const LAPTOL_FUGGETLEN: Record<
  Exclude<ServiceJobStatusValue, "IN_PROGRESS">,
  CommonServiceState
> = {
  NEW: ALLAPOT("NEW"),
  TRIAGED: ALLAPOT("IN_PROGRESS"),
  SCHEDULED: ALLAPOT("IN_PROGRESS"),
  WAITING_FOR_PARTS: ALLAPOT("WAITING", "PARTS"),
  WAITING_FOR_CUSTOMER: ALLAPOT("WAITING", "CUSTOMER"),
  COMPLETED: ALLAPOT("CLOSED"),
  CANCELLED: ALLAPOT("CLOSED", "CANCELLED"),
};

describe("hibajegy közös állapota", () => {
  for (const [nev, lapok] of Object.entries(LAPOK)) {
    it(`IN_PROGRESS, ${nev}`, () => {
      assert.deepEqual(
        commonJobStatus("IN_PROGRESS", lapok),
        FOLYAMATBAN_VART[nev],
      );
    });
  }

  for (const [status, vart] of Object.entries(LAPTOL_FUGGETLEN)) {
    it(`${status}: minden lap-alakon ugyanaz`, () => {
      for (const [nev, lapok] of Object.entries(LAPOK)) {
        assert.deepEqual(
          commonJobStatus(status as ServiceJobStatusValue, lapok),
          vart,
          `${status}, ${nev}`,
        );
      }
    });
  }

  it("a két tábla együtt minden tárolt állapotot lefed", () => {
    const lefedett = new Set([...Object.keys(LAPTOL_FUGGETLEN), "IN_PROGRESS"]);
    assert.deepEqual(
      [...ALL_SERVICE_JOB_STATUS_VALUES].sort(),
      [...lefedett].sort(),
    );
  });

  // Terv 8/a: a lezárt lap egy Új jegyen NEM Elkészült. NEW alól nincs
  // COMPLETED, tehát a Lezárás gomb zsákutca lenne; a csatolás a 2. szeletben
  // lépteti IN_PROGRESS-be a jegyet.
  it("8/a: Új jegy lezárt lappal Új marad", () => {
    assert.deepEqual(
      commonJobStatus("NEW", [lap("SIGNED", true)]),
      ALLAPOT("NEW"),
    );
  });

  // Terv 8/b: a várakozás oka erősebb jel, mint a kész lap.
  it("8/b: ügyfélre váró jegy aláírásra váró lappal Vár valamire marad", () => {
    assert.deepEqual(
      commonJobStatus("WAITING_FOR_CUSTOMER", [
        lap("AWAITING_SIGNATURE"),
        lap("AWAITING_SIGNATURE"),
      ]),
      ALLAPOT("WAITING", "CUSTOMER"),
    );
  });
});

/**
 * A KARBANTARTÁS: a jelvény szabálya (minden lap aláírt = Lezárt), a tárolt
 * állapottól függetlenül. Minden tárolt állapoton végigmegy, hogy egy
 * véletlenül átfolyó hibajegy-ág (Új, Elkészült, Vár valamire) piros legyen.
 */
describe("karbantartási lap közös állapota", () => {
  const KARBANTARTAS_VART: Record<keyof typeof LAPOK, CommonServiceState> = {
    "nincs lap": ALLAPOT("IN_PROGRESS"),
    piszkozat: ALLAPOT("IN_PROGRESS"),
    "verzió nélküli": ALLAPOT("IN_PROGRESS"),
    elutasított: ALLAPOT("IN_PROGRESS"),
    "aláírásra vár": ALLAPOT("IN_PROGRESS"),
    "aláírva, nincs átadva": ALLAPOT("CLOSED"),
    "aláírva és átadva": ALLAPOT("CLOSED"),
    "aláírásra vár + aláírva és átadva": ALLAPOT("IN_PROGRESS"),
    "aláírva és átadva + aláírva, nincs átadva": ALLAPOT("CLOSED"),
    "aláírva és átadva + piszkozat": ALLAPOT("IN_PROGRESS"),
    "aláírásra vár + elutasított": ALLAPOT("IN_PROGRESS"),
    "aláírva és átadva + verzió nélküli": ALLAPOT("IN_PROGRESS"),
  };
  for (const [nev, lapok] of Object.entries(LAPOK)) {
    it(`${nev}, minden tárolt állapoton`, () => {
      for (const status of ALL_SERVICE_JOB_STATUS_VALUES)
        assert.deepEqual(
          commonJobStatus(status, lapok, "MAINTENANCE"),
          KARBANTARTAS_VART[nev],
          status,
        );
    });
  }

  it("a fajta nélküli hívás a hibajegy szabálya", () => {
    const lapok = [lap("AWAITING_SIGNATURE")];
    assert.deepEqual(
      commonJobStatus("IN_PROGRESS", lapok),
      commonJobStatus("IN_PROGRESS", lapok, "REPAIR"),
    );
  });
});

describe("munkalap közös állapota", () => {
  const SOROK: [WorksheetVersionStatus, number, CommonServiceState][] = [
    ["DRAFT", 0, ALLAPOT("NEW")],
    ["DRAFT", 3, ALLAPOT("IN_PROGRESS")],
    ["REJECTED", 0, ALLAPOT("IN_PROGRESS", "REJECTED")],
    ["REJECTED", 3, ALLAPOT("IN_PROGRESS", "REJECTED")],
    ["AWAITING_SIGNATURE", 0, ALLAPOT("DONE", "AWAITING_SIGNATURE")],
    ["AWAITING_SIGNATURE", 3, ALLAPOT("DONE", "AWAITING_SIGNATURE")],
    ["SIGNED", 0, ALLAPOT("CLOSED")],
    ["SIGNED", 3, ALLAPOT("CLOSED")],
  ];
  for (const [status, sorok, vart] of SOROK) {
    it(`${status}, ${sorok} sor`, () => {
      assert.deepEqual(commonWorksheetStatus(status, sorok), vart);
    });
  }
});

describe("felirat és szín", () => {
  it("az öt állapot a folyamat sorrendjében", () => {
    assert.deepEqual(COMMON_SERVICE_STATUSES, [
      "NEW",
      "IN_PROGRESS",
      "WAITING",
      "DONE",
      "CLOSED",
    ]);
  });

  it("a jelvény szövege az ok mellé", () => {
    assert.equal(commonServiceStateText(ALLAPOT("NEW")), "Új");
    assert.equal(
      commonServiceStateText(ALLAPOT("WAITING", "PARTS")),
      "Vár valamire · alkatrészre",
    );
    assert.equal(
      commonServiceStateText(ALLAPOT("DONE", "AWAITING_SIGNATURE")),
      "Elkészült · aláírásra vár",
    );
    assert.equal(
      commonServiceStateText(ALLAPOT("CLOSED", "CANCELLED")),
      "Lezárt · meghiúsult",
    );
    assert.equal(
      commonServiceStateText(ALLAPOT("IN_PROGRESS", "REJECTED")),
      "Folyamatban · elutasítva",
    );
  });

  it("az elutasított munkalap piros, a többi az állapot színe", () => {
    assert.equal(
      commonServiceStateTone(ALLAPOT("IN_PROGRESS", "REJECTED")),
      "red",
    );
    assert.equal(commonServiceStateTone(ALLAPOT("IN_PROGRESS")), "purple");
    assert.equal(commonServiceStateTone(ALLAPOT("WAITING", "PARTS")), "amber");
    assert.equal(
      commonServiceStateTone(ALLAPOT("DONE", "READY_TO_CLOSE")),
      "green",
    );
    assert.equal(
      commonServiceStateTone(ALLAPOT("CLOSED", "CANCELLED")),
      "neutral",
    );
  });
});

/**
 * A PARTNER RÖVIDÍTÉSE ÉS A TÉNYEK NÉLKÜLI `partnerVisibleStatus`. A 3. szeletig
 * egy szándékos eltérés állt itt (a COMPLETED: ma Elkészült, a közösből
 * Lezárva); a 4. szelet a `partnerVisibleStatus` tábláját is erre állította,
 * mert a napló-esemény, a kimutatás és a csomag-napló ugyanazt a jegyet
 * nevezi meg, mint a lista. Lap nélkül tehát a kettő soronként azonos; minden
 * eltérés piros.
 */
describe("partner-rövidítés a közösből", () => {
  it("lap nélkül a közös rövidítés és a partnerVisibleStatus soronként azonos", () => {
    const elteres: Record<string, [string, string]> = {};
    for (const status of ALL_SERVICE_JOB_STATUS_VALUES) {
      const ma = partnerVisibleStatus(status);
      const uj = partnerStatusFromCommon(commonJobStatus(status, [])).status;
      if (ma !== uj) elteres[status] = [ma, uj];
    }
    assert.deepEqual(elteres, {});
    // a lezárt jegy Lezárva, akár teljesült, akár meghiúsult (emlék 890)
    assert.equal(partnerVisibleStatus("COMPLETED"), "CLOSED");
  });

  it("a kész lapú IN_PROGRESS jegy a partnernek Elkészült (ma Feldolgozás alatt)", () => {
    assert.equal(partnerVisibleStatus("IN_PROGRESS"), "IN_PROGRESS");
    assert.equal(
      partnerStatusFromCommon(
        commonJobStatus("IN_PROGRESS", [lap("AWAITING_SIGNATURE")]),
      ).status,
      "COMPLETED",
    );
  });

  it("a Vár valamire a partnernek Feldolgozás alatt", () => {
    assert.equal(
      partnerStatusFromCommon(ALLAPOT("WAITING", "PARTS")).status,
      "IN_PROGRESS",
    );
  });

  // acrobot 61894: a felirat Lezárva marad, a meghiúsulás második sorként él tovább
  it("a meghiúsult ok a partnernél is megmarad, csak a lezárt jegyen", () => {
    const vart: Record<string, string | null> = {};
    const kapott: Record<string, string | null> = {};
    for (const status of ALL_SERVICE_JOB_STATUS_VALUES) {
      vart[status] = status === "CANCELLED" ? "CANCELLED" : null;
      kapott[status] = partnerStatusFromCommon(
        commonJobStatus(status, []),
      ).closedReason;
    }
    assert.deepEqual(kapott, vart);
    assert.equal(partnerClosedReasonLabel.CANCELLED, "Nem teljesült");
  });
});

/*
  A PARTNER MUNKALAPJA (kártya 7f23785c; acrobot 62704). MI PIROSÍT: ha a lap a
  belső Folyamatban-t vagy egy ötödik, Elutasítva jelvényt kap a partner négy
  szava helyett; ha az elutasítás jelzése elvész vagy más lapra is ráül; ha a
  verzió-felirat nem a partner szavait mondja.
*/
describe("partner munkalapja a közösből", () => {
  it("minden verzió-állapot és tételszám a négy partner-szó egyikére, az elutasított jelölve", () => {
    const kapott: Record<string, string> = {};
    for (const status of [
      "DRAFT",
      "REJECTED",
      "AWAITING_SIGNATURE",
      "SIGNED",
    ] as WorksheetVersionStatus[])
      for (const lines of [0, 3]) {
        const state = partnerWorksheetState(status, lines);
        kapott[`${status}/${lines}`] =
          `${state.status}${state.rejected ? " elutasítva" : ""}`;
      }
    assert.deepEqual(kapott, {
      "DRAFT/0": "NEW",
      "DRAFT/3": "IN_PROGRESS",
      "REJECTED/0": "IN_PROGRESS elutasítva",
      "REJECTED/3": "IN_PROGRESS elutasítva",
      "AWAITING_SIGNATURE/0": "COMPLETED",
      "AWAITING_SIGNATURE/3": "COMPLETED",
      "SIGNED/0": "CLOSED",
      "SIGNED/3": "CLOSED",
    });
  });

  it("a verzió-felirat a partner szavaival", () => {
    assert.deepEqual(partnerWorksheetVersionLabel, {
      DRAFT: "Új és feldolgozás alatt",
      AWAITING_SIGNATURE: "Elkészült",
      SIGNED: "Lezárva",
      REJECTED: "Elutasítva",
    });
  });
});
