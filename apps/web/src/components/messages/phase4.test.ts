import { describe, expect, it } from "vitest";

import {
  canManageMembers,
  contextCardParts,
  contextCardTitle,
  contextHref,
  contextStatusLabel,
  contextSubtitle,
  isSystemMessage,
} from "./phase4";

/*
  A 4. FÁZIS TISZTA SZABÁLYAI. Ami pirosít: korlátozott kártyán cím vagy a
  partner és az állapot; a hibajegy a munkalap útjára mutat; egy ismeretlen
  állapot nyers kódként látszik; a dátum nem budapesti nap; a direkt
  beszélgetésben tagkezelés.
*/
const card = {
  type: "SERVICE_JOB" as const,
  id: "job 1",
  number: "SZ-2026-014",
  partnerName: "Fővárosi Állatkert",
  status: "IN_PROGRESS",
  createdAt: "2026-10-04T22:30:00.000Z",
  restricted: false,
};

describe("phase 4 helpers", () => {
  it("the card's line: number, partner, status, Budapest day; restricted only the number", () => {
    const parts = contextCardParts(card);
    expect(parts[0]).toBe("SZ-2026-014");
    expect(parts[1]).toBe("Fővárosi Állatkert");
    expect(parts[3]).toBe("2026. okt. 5.");
    expect(contextCardParts({ ...card, restricted: true })).toEqual([
      "SZ-2026-014",
    ]);
    expect(
      contextCardParts({ ...card, number: null, restricted: true }),
    ).toEqual(["szám nélkül"]);
  });

  it("Megnyitás goes to the object's own page, and not for a restricted card", () => {
    expect(contextHref(card)).toBe("/szerviz/hibajegyek/job%201");
    expect(contextHref({ ...card, type: "WORKSHEET" })).toBe(
      "/szerviz/munkalapok/job%201",
    );
    expect(contextHref({ ...card, restricted: true })).toBeNull();
    // a karbantartási lap a saját oldalára visz, nem a hibajegyekhez (acrobot 56118)
    expect(contextHref({ ...card, jobKind: "MAINTENANCE" })).toBe(
      "/szerviz/karbantartas/job%201",
    );
  });

  it("a maintenance sheet is named as one, with no ticket state; a ticket is unchanged", () => {
    const sheet = { ...card, jobKind: "MAINTENANCE" as const, status: "NEW" };
    expect(contextCardTitle("SERVICE_JOB", "MAINTENANCE")).toBe(
      "KAPCSOLT KARBANTARTÁSI LAP",
    );
    expect(contextSubtitle("SERVICE_JOB", "MAINTENANCE")).toBe(
      "Karbantartási laphoz kapcsolva",
    );
    expect(contextStatusLabel(sheet)).toBeNull();
    expect(contextCardParts(sheet).join(" ")).not.toMatch(/Új/);
    expect(contextCardTitle("SERVICE_JOB", "REPAIR")).toBe("KAPCSOLT HIBAJEGY");
    expect(contextCardTitle("SERVICE_JOB")).toBe("KAPCSOLT HIBAJEGY");
    expect(contextSubtitle("SERVICE_JOB", null)).toBe("Hibajegyhez kapcsolva");
  });

  /*
    THE SHARED STATE (card 7f23785c): when the server sends it, the card says what the ticket list says; the stored IN_PROGRESS alone
    would read Folyamatban. A maintenance sheet gets its own shared word too.
  */
  it("the server's shared state wins over the stored status, also on a maintenance sheet", () => {
    expect(
      contextStatusLabel({
        ...card,
        commonStatus: "DONE",
        commonReason: "AWAITING_SIGNATURE",
      }),
    ).toBe("Elkészült · aláírásra vár");
    expect(
      contextStatusLabel({
        ...card,
        jobKind: "MAINTENANCE",
        commonStatus: "CLOSED",
        commonReason: null,
      }),
    ).toBe("Lezárt");
  });

  it("status labels by kind; an unknown status is not shown raw", () => {
    expect(
      contextStatusLabel({ ...card, type: "WORKSHEET", status: "COMPLETED" }),
    ).toBe("Elkészült");
    expect(contextStatusLabel({ ...card, status: "NO_SUCH" })).toBeNull();
    expect(contextStatusLabel({ ...card, status: null })).toBeNull();
  });

  it("subtitles, system events, members only in groups", () => {
    expect(contextSubtitle("WORKSHEET")).toBe("Munkalaphoz kapcsolva");
    expect(contextSubtitle("SERVICE_JOB")).toBe("Hibajegyhez kapcsolva");
    expect(isSystemMessage({ type: "SYSTEM" })).toBe(true);
    expect(isSystemMessage({ type: "TEXT" })).toBe(false);
    expect(canManageMembers("GROUP")).toBe(true);
    expect(canManageMembers("DIRECT")).toBe(false);
  });
});
