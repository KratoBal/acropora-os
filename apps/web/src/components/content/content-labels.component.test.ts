import { describe, expect, it } from "vitest";

import {
  CONTENT_STATE_LABELS,
  CONTENT_WAITS_ON_LABELS,
  contentImageLabel,
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
    expect(contentNavigation[0]?.permission).toBe("content.view");
  });
});
