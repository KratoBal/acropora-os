import { describe, expect, it } from "vitest";

import {
  fileTypeLabel,
  messageActions,
  notificationLabel,
  notificationOptions,
  pinnedMeta,
  searchCountLabel,
  searchHitMeta,
  shortWhen,
} from "./phase3";

/*
  A 3. FÁZIS TISZTA SZABÁLYAI A WEBEN. Ami pirosít:
  - az idő nem a Figma alakja („ma 14:37”, „tegnap 16:12”, „péntek”);
  - a kitűzött elemnél nem az ÜZENET szerzője és ideje áll;
  - a „Csak említések” választható (Balázs: most nem), vagy a némítás
    feloldása akkor is ott van, amikor nincs mit feloldani;
  - a lejárt némítás némításnak látszik;
  - más üzenetén Szerkesztés vagy Törlés van, a Továbbítás vagy a Kitűzés
    hiányzik, a kitűzött üzeneten nem a levétel áll.
*/

// helyi idő szerint, mert a felület is a böngésző helyi idejét mutatja
const local = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min).toISOString();
const now = new Date(2026, 9, 5, 18, 0); // 2026. október 5., hétfő, 18:00

describe("the Figma time", () => {
  it("today, yesterday, this week, and further back", () => {
    expect(shortWhen(local(2026, 10, 5, 14, 37), now)).toBe("ma 14:37");
    expect(shortWhen(local(2026, 10, 4, 16, 12), now)).toBe("tegnap 16:12");
    expect(shortWhen(local(2026, 10, 2), now)).toBe("péntek");
    expect(shortWhen(local(2026, 9, 20), now)).toBe("szept. 20.");
  });

  it("the search hit and the pinned item", () => {
    expect(
      searchHitMeta(
        { senderName: "Kovács Anna", createdAt: local(2026, 10, 5, 14, 37) },
        now,
      ),
    ).toBe("Kovács Anna · ma 14:37");
    expect(
      pinnedMeta(
        { senderName: "Balázs", messageCreatedAt: local(2026, 10, 4, 9, 5) },
        now,
      ),
    ).toBe("Üzenet · Balázs · tegnap 09:05");
  });

  it("the count", () => {
    expect(searchCountLabel(3, false)).toBe("3 találat");
    expect(searchCountLabel(1000, true)).toBe("1000+ találat");
  });
});

describe("the notification setting", () => {
  it("no 'Csak említések'; the unmute only while muted", () => {
    const off = notificationOptions(
      { notify: "ALL", mutedUntil: null },
      now,
    ).map((o) => o.label);
    expect(off).toEqual([
      "Minden új üzenet",
      "Némítás 1 órára",
      "Némítás holnapig",
    ]);
    const muted = notificationOptions(
      {
        notify: "ALL",
        mutedUntil: new Date(now.getTime() + 3_600_000).toISOString(),
      },
      now,
    ).map((o) => o.mode);
    expect(muted).toContain("UNMUTE");
    expect(muted).not.toContain("MENTIONS");
  });

  it("the label: all, muted today, muted until tomorrow, and a mute that has passed", () => {
    expect(notificationLabel({ notify: "ALL", mutedUntil: null }, now)).toBe(
      "Minden új üzenetről",
    );
    expect(
      notificationLabel(
        { notify: "ALL", mutedUntil: local(2026, 10, 5, 19, 0) },
        now,
      ),
    ).toBe("Némítva 19:00-ig");
    expect(
      notificationLabel(
        { notify: "ALL", mutedUntil: local(2026, 10, 6, 8, 0) },
        now,
      ),
    ).toBe("Némítva holnap 08:00-ig");
    expect(
      notificationLabel(
        { notify: "ALL", mutedUntil: local(2026, 10, 5, 17, 0) },
        now,
      ),
    ).toBe("Minden új üzenetről");
    expect(notificationLabel(undefined, now)).toBe("Minden új üzenetről");
  });
});

describe("the message menu", () => {
  it("anyone forwards and pins; only the author edits and deletes", () => {
    expect(
      messageActions({
        own: false,
        deleted: false,
        pinned: false,
        hasText: true,
      }),
    ).toEqual(["reply", "copy", "forward", "pin"]);
    expect(
      messageActions({
        own: true,
        deleted: false,
        pinned: true,
        hasText: false,
      }),
    ).toEqual(["reply", "forward", "unpin", "edit", "delete"]);
    expect(
      messageActions({ own: true, deleted: true, pinned: true, hasText: true }),
    ).toEqual([]);
  });

  it("the file type", () => {
    expect(fileTypeLabel("meresek.xlsx")).toBe("XLSX");
    expect(fileTypeLabel("munkalap-WO1842.pdf")).toBe("PDF");
    expect(fileTypeLabel("nevtelen")).toBe("Fájl");
    expect(fileTypeLabel("vege.")).toBe("Fájl");
  });
});
