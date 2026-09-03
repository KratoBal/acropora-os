import { describe, expect, it } from "vitest";
import { navigationEntry } from "@acropora/types";

import {
  CONTENT_ROLE_LABELS,
  CONTENT_STALE_DAYS,
  CONTENT_STATE_LABELS,
  CONTENT_WAITS_ON_LABELS,
  contentAgeLabel,
  contentImageLabel,
  oldestAge,
  oldestFirst,
} from "./content-labels";
import { contentNavigation } from "../navigation";

describe("what the content list says about an image", () => {
  /**
   * HÁROM ESET, NEM KETTŐ. A „nem kell kép" és a „megvan a kép" mindkettő
   * rendben van, de MÁS: az elsőnél nincs is mit várni.
   *
   * Ha a címke csak azt mondaná meg, hogy hiányzik-e, minden szöveges tétel
   * örökre „rendben"-ként állna, és a különbség eltűnne -- épp az, ami miatt a
   * kép külön feltétel lett, nem állapot.
   */
  it("tells 'no image needed' apart from 'image is here'", () => {
    expect(
      contentImageLabel({ imageRequired: false, imageAttachedAt: null }),
    ).toEqual({ text: "nem kell kép", waiting: false });

    expect(
      contentImageLabel({
        imageRequired: true,
        imageAttachedAt: "2026-09-01T10:00:00.000Z",
      }),
    ).toEqual({ text: "kép megvan", waiting: false });
  });

  it("marks a needed but missing image as waiting", () => {
    expect(
      contentImageLabel({ imageRequired: true, imageAttachedAt: null }),
    ).toEqual({ text: "képre vár", waiting: true });
  });
});

describe("what the list tells about each state", () => {
  /**
   * MINDEN ÁLLAPOTNAK VAN MAGYAR NEVE ÉS „KIRE VÁR" FELIRATA. Egy hiányzó
   * bejegyzés a felületen `undefined`-ként jelenne meg, és pont azon a soron,
   * amit senki nem ért -- a lista értéke az, hogy nem kell fejben fordítani.
   */
  it("has a label and a waits-on line for every state", () => {
    const states = Object.keys(CONTENT_STATE_LABELS);
    expect(states.length).toBe(9);
    for (const state of states) {
      expect(CONTENT_STATE_LABELS[state as never]).toBeTruthy();
      expect(CONTENT_WAITS_ON_LABELS[state as never]).toBeTruthy();
    }
  });

  /**
   * AZ „ÜTEMEZVE" NEM SENKIRE VÁR, HANEM A HATÁRIDŐRE, és ez nem szójáték: ez
   * az egyetlen állapotunk, amiben a semmittevésnek határideje van (a 25. napon
   * a poszt törlődik, ha a dátum változatlan). Egy „senkire" felirat itt épp
   * azt sugallná, hogy nincs teendő.
   */
  it("does not say a scheduled piece waits on nobody", () => {
    expect(CONTENT_WAITS_ON_LABELS.SCHEDULED).not.toBe("senkire");
  });
});

describe("where the content list lives in the menu", () => {
  /**
   * SAJÁT MENÜPONT, SAJÁT JOGGAL. A panasz épp az volt, hogy a dolgok sok
   * felületen keletkeznek és nem látszik, mi vár kire -- egy almenü valami más
   * alatt ugyanezt csinálná.
   */
  it("is a single entry gated on content.view", () => {
    expect(contentNavigation).toHaveLength(1);
    expect(contentNavigation[0]?.href).toBe("/tartalom");
    // A JOG MOSTANTOL A KOZOS FORRASBAN all, nem a menusorban. Az allitas
    // celja valtozatlan (sajat menupont, sajat joggal), csak a helye mas.
    expect(contentNavigation[0]?.entryId).toBe("content");
    expect(navigationEntry("content")?.visibility).toEqual({
      kind: "permission",
      permission: "content.view",
    });
  });
});

const NOW = new Date("2026-09-01T12:00:00.000Z");
const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

describe("how old a piece looks on the list", () => {
  /**
   * A KOR-CÍMKE AZÉRT VAN, MERT A SZEKCIÓ NEM ELÉG: enélkül a hét hete álló és
   * a két napja készült tétel egyforma jelvénnyel áll egymás mellett, és az
   * egymáshoz képesti sürgősséget megint soronként kell kiolvasni.
   */
  it("says days under a week and weeks above it", () => {
    expect(contentAgeLabel(daysAgo(2), NOW).text).toBe("2 napja");
    expect(contentAgeLabel(daysAgo(1), NOW).text).toBe("1 napja");
    expect(contentAgeLabel(daysAgo(7), NOW).text).toBe("1 hete");
    expect(contentAgeLabel(daysAgo(49), NOW).text).toBe("7 hete");
  });

  /**
   * A HATÁR PONTOS ELÉRÉSE MÁR RÉGI. A `>=` és a `>` közti választás itt dől
   * el, és csak az egyik hibázik ezen a bemeneten.
   */
  it("marks the seventh day as stale, not the eighth", () => {
    expect(contentAgeLabel(daysAgo(6), NOW).stale).toBe(false);
    expect(contentAgeLabel(daysAgo(CONTENT_STALE_DAYS), NOW).stale).toBe(true);
  });

  /**
   * A JÖVŐBELI DÁTUM NEM HIBA, HANEM ÓRAELTÉRÉS. Egy „-2 napja" felirat a
   * felületen bizalmat visz el a többi számtól is.
   */
  it("says 'ma' rather than a negative number", () => {
    expect(contentAgeLabel(daysAgo(-3), NOW).text).toBe("ma");
  });
});

describe("the summary strip and the ordering", () => {
  /**
   * ÜRES LISTÁRA NINCS KOR. A „0 napja" azt állítaná, hogy van egy tétel, ami
   * ma keletkezett -- holott nincs egy sem, és a csík ilyenkor meg sem jelenik.
   */
  it("has no age for an empty list", () => {
    expect(oldestAge([], NOW)).toBeNull();
  });

  it("reports the oldest, not the first", () => {
    const oldest = oldestAge(
      [{ updatedAt: daysAgo(2) }, { updatedAt: daysAgo(49) }],
      NOW,
    );
    expect(oldest?.text).toBe("7 hete");
  });

  /**
   * A LEGRÉGEBBI ELÖL: a képre váró listában a sorrend maga az információ. Ha
   * a hét hete álló tétel a tegnapiak közé keveredne, a szekció megint csak
   * annyit mondana, hogy „van itt hat dolog".
   */
  it("puts the oldest first", () => {
    const sorted = oldestFirst([
      { id: "friss", updatedAt: daysAgo(1) },
      { id: "regi", updatedAt: daysAgo(49) },
      { id: "kozepes", updatedAt: daysAgo(10) },
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["regi", "kozepes", "friss"]);
  });
});

/**
 * A SZEREP-VALASZTO CIMKEI: A HALMAZT NEVEZIK MEG, NEM A TULAJDONLAST.
 *
 * A `reviewer` nezete a #398 ota a GAZDATLAN teteleket is behozza, tehat
 * olyanokat, amiket senki nem lektoral. A regi "amit lektorálok" TULAJDONLAST
 * allitott, es ettol tobbet mondott, mint a valosag.
 *
 * KET ALLITAS KELL, NEM EGY, es a masodik a fontosabb: egy cimke-csere jellemzo
 * hibaja, hogy a REGI szoveg valahol ottmarad, es csak az egyik peldany
 * cserelodik. Az elso allitas ezt nem venne eszre.
 */
describe("what the role picker calls each view", () => {
  it("names the set the reviewer view actually shows", () => {
    expect(CONTENT_ROLE_LABELS.reviewer).toBe("lektorálásra vár");
  });

  it("has no ownership claim left in the reviewer label", () => {
    // A REGI SZOVEG SEHOL. Nem elég, hogy az uj ott van: ha a regi barhol
    // megmaradna, ket kulonbozo nevet adnank ugyanannak a nezetnek.
    expect(Object.values(CONTENT_ROLE_LABELS)).not.toContain("amit lektorálok");
  });

  /**
   * A MASIK HAROM CIMKE, A DONTES UTAN.
   *
   * Ez az allitas a #401-ben azt rogzitette, hogy a masik harom VALTOZATLAN --
   * es akkor helyesen, mert az `approver` es a `sender` cimkejenek javitasa NEM
   * a #398 kovetkezmenye volt, tehat kulon dontest igenyelt.
   *
   * A DONTES MEGSZULETETT (acrobot, 2026-09-03): a cimke akkor es csak akkor
   * nevezhet tulajdonost, ha a nezet KIZAROLAG a sajatot mutatja. Az `approver`
   * es a `sender` nezete nem ilyen, ezert a szovegek is a halmazt nevezik meg.
   *
   * Az `author` MARAD tulajdonlo alakban, es ez nem kivetel, hanem a szabaly
   * masik iranya: az a nezet tenyleg csak a sajat vazlatokat mutatja.
   *
   * MAGAT A SZABALYT nem itt allitjuk, hanem ott, ahol a szuro lakik:
   * `apps/api/src/content/content-filter.spec.ts` vegigfuttatja mind a negy
   * szerepen. Ez itt a szoveg-oldali rogzites, hogy egy veletlen atiras is
   * pirosodjon.
   */
  it("keeps ownership only where the view narrows to it", () => {
    expect(CONTENT_ROLE_LABELS.author).toBe("amit írok");
    expect(CONTENT_ROLE_LABELS.approver).toBe("jóváhagyásra vár");
    expect(CONTENT_ROLE_LABELS.sender).toBe("kiküldésre vár");
  });
});
