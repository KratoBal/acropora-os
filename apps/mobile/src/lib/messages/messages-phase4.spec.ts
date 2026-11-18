import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  canManageMembers,
  contextCardParts,
  contextCardTitle,
  contextDateLabel,
  contextRoute,
  contextStatusLabel,
  contextSubtitle,
  isSystemMessage,
  LINK_COPY,
} from "./phase4";
import type { ConversationContextCard } from "./types";

/*
  AZ ÜZENETEK 4. FÁZISÁNAK TISZTA SZABÁLYAI A TELEFONON (terv 2.4; Figma
  450:697, 450:710). Ami pirosít: korlátozott kártyán „Megnyitás”, partner
  vagy állapot (kiskapu a szerviz-adatokhoz); a hibajegy a munkalap
  képernyőjére visz; egy ismeretlen állapot nyers kódként látszik; a dátum nem
  budapesti nap; a direkt beszélgetésben tagkezelés.
*/
const card: ConversationContextCard = {
  type: "SERVICE_JOB",
  id: "job1",
  number: "SZ-2026-014",
  partnerName: "Fővárosi Állatkert",
  status: "IN_PROGRESS",
  createdAt: "2026-10-04T22:30:00.000Z",
  restricted: false,
};

describe("messages phase 4 on the phone", () => {
  it("the card line: number, partner, status, Budapest day; restricted only the number", () => {
    assert.deepEqual(contextCardParts(card), [
      "SZ-2026-014",
      "Fővárosi Állatkert",
      "Folyamatban",
      "2026. okt. 5.",
    ]);
    assert.deepEqual(contextCardParts({ ...card, restricted: true }), [
      "SZ-2026-014",
    ]);
    assert.deepEqual(
      contextCardParts({ ...card, number: null, restricted: true }),
      ["szám nélkül"],
    );
  });

  it("the day is Budapest's, on both sides of midnight", () => {
    assert.equal(contextDateLabel("2026-10-04T21:59:00.000Z"), "2026. okt. 4.");
    assert.equal(contextDateLabel("2026-10-04T22:00:00.000Z"), "2026. okt. 5.");
    assert.equal(contextDateLabel(null), null);
    assert.equal(contextDateLabel("nem dátum"), null);
  });

  it("Megnyitás goes to the object's own screen, and not for a restricted card", () => {
    assert.deepEqual(contextRoute(card), {
      pathname: "/service-jobs/[id]",
      params: { id: "job1" },
    });
    assert.deepEqual(contextRoute({ ...card, type: "WORKSHEET" }), {
      pathname: "/worksheets/[id]",
      params: { id: "job1" },
    });
    assert.equal(contextRoute({ ...card, restricted: true }), null);
  });

  it("status labels by kind; an unknown status is not shown raw", () => {
    assert.equal(
      contextStatusLabel({ ...card, type: "WORKSHEET", status: "COMPLETED" }),
      "Elkészült",
    );
    assert.equal(
      contextStatusLabel({ ...card, status: "CANCELLED" }),
      "Meghiúsult",
    );
    assert.equal(contextStatusLabel({ ...card, status: "NO_SUCH" }), null);
    assert.equal(contextStatusLabel({ ...card, status: null }), null);
  });

  it("titles, subtitles, system events, members only in groups", () => {
    assert.equal(contextCardTitle("WORKSHEET"), "KAPCSOLT MUNKALAP");
    assert.equal(contextCardTitle("SERVICE_JOB"), "KAPCSOLT HIBAJEGY");
    assert.equal(contextSubtitle("WORKSHEET"), "Munkalaphoz kapcsolva");
    assert.equal(contextSubtitle("SERVICE_JOB"), "Hibajegyhez kapcsolva");
    assert.equal(isSystemMessage({ type: "SYSTEM" }), true);
    assert.equal(isSystemMessage({ type: "TEXT" }), false);
    assert.equal(canManageMembers("GROUP"), true);
    assert.equal(canManageMembers("DIRECT"), false);
  });
});

/*
  A KAPCSOLT KARBANTARTÁSI LAP A SAJÁT NEVÉN SZEREPEL AZ ÜZENETEKBEN (hibajegy-maradek lista, 4. fejezet, acrobot 56196; a szerver a kártyán `jobKind`-ot küld): a kártya címe, az alcím és a kapcsolás
  képernyőjének szövegei. A lista soron a szerver `contextJobKind`-ot küld (barracuda, #2712), ezért ott is pontos a felirat. MI PIROSÍT: ha a karbantartási lap kártyája újra "KAPCSOLT HIBAJEGY" / "Hibajegyhez kapcsolva"; ha a
  hibajegyé (és a fajta nélkülié) megváltozik; ha a lista alcíme a karbantartási lapot hibajegynek mondja; ha a kapcsolás szövegei újra csak a hibajegyet nevezik meg.
*/
describe("a kapcsolt lap neve az üzenetekben a lap fajtája szerint", () => {
  it("a karbantartási lap kártyája és alcíme a karbantartási lapot nevezi meg", () => {
    assert.equal(
      contextCardTitle("SERVICE_JOB", "MAINTENANCE"),
      "KAPCSOLT KARBANTARTÁSI LAP",
    );
    assert.equal(
      contextSubtitle("SERVICE_JOB", "MAINTENANCE"),
      "Karbantartási laphoz kapcsolva",
    );
  });

  it("a hibajegy, a fajta nélküli és a munkalap szövege nem változik", () => {
    for (const kind of ["REPAIR", null, undefined] as const) {
      assert.equal(contextCardTitle("SERVICE_JOB", kind), "KAPCSOLT HIBAJEGY");
      assert.equal(
        contextSubtitle("SERVICE_JOB", kind),
        "Hibajegyhez kapcsolva",
      );
    }
    assert.equal(
      contextCardTitle("WORKSHEET", "MAINTENANCE"),
      "KAPCSOLT MUNKALAP",
    );
    assert.equal(
      contextSubtitle("WORKSHEET", "MAINTENANCE"),
      "Munkalaphoz kapcsolva",
    );
  });

  it("a kapcsolás szövegei a karbantartási lapot is megnevezik", () => {
    for (const szoveg of [
      LINK_COPY.lead,
      LINK_COPY.serviceJobTab,
      LINK_COPY.serviceJobPlaceholder,
      LINK_COPY.dataScreenLink,
    ]) {
      assert.match(szoveg, /hibajegy/i);
      assert.match(szoveg, /karbantart/i);
    }
  });

  it("a képernyők a fajtával és a szövegtáblával hívják", () => {
    const olvas = (...ut: string[]) =>
      readFileSync(join(__dirname, "..", "..", "..", "src", ...ut), "utf8");
    assert.match(
      olvas("components", "messages", "Phase4Parts.tsx"),
      /contextCardTitle\(card\.type, card\.jobKind\)/,
    );
    assert.match(
      olvas("app", "uzenetek", "[id].tsx"),
      /contextSubtitle\(\s*conversation\.context\.type,\s*conversation\.context\.jobKind/,
    );
    assert.match(
      olvas("app", "uzenetek", "adatok.tsx"),
      /contextCardTitle\(\s*conversation\.context\.type,\s*conversation\.context\.jobKind/,
    );
    assert.match(
      olvas("components", "messages", "MessageParts.tsx"),
      /contextSubtitle\(item\.contextType, item\.contextJobKind\)/,
    );
    const kapcsolas = olvas("app", "uzenetek", "kapcsolas.tsx");
    for (const kulcs of ["lead", "serviceJobTab", "serviceJobPlaceholder"])
      assert.match(kapcsolas, new RegExp(`LINK_COPY\\.${kulcs}`));
    assert.match(
      olvas("app", "uzenetek", "adatok.tsx"),
      /LINK_COPY\.dataScreenLink/,
    );
  });
});
