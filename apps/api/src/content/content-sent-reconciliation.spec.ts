import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { reconcileSent } from "./content-sent-reconciliation.js";

const post = (id: string, iso: string) => ({ id, createdAt: new Date(iso) });

describe("bringing the sending fact back in", () => {
  /**
   * A LEGFONTOSABB ÁLLÍTÁS, ÉS EGY MÉRT VESZÉLYRE ÉPÜL: a külső lekérdezés
   * alapértelmezett limitje TÍZ (mérve 2026-09-01). Aki a lapozót nem járja
   * végig, csendben az utolsó tízet kapja -- a hívás nem hibázik.
   *
   * Egy hiányzó poszt pontosan úgy néz ki, mint egy ki nem küldött. Ha hiányos
   * listából jelölnénk, a hiba nem abban állna, hogy rosszat írunk, hanem hogy
   * NEM írunk -- és az láthatatlan.
   */
  it("refuses to mark anything from a list that may be truncated", () => {
    const result = reconcileSent({
      posts: [post("p1", "2026-08-28T10:00:00Z")],
      complete: false,
      pairings: [{ itemId: "c1", postId: "p1" }],
      known: [{ id: "c1", externalPostId: null }],
    });

    assert.equal(result.kind, "incomplete");
  });

  it("marks a paired post as sent once the list is complete", () => {
    const result = reconcileSent({
      posts: [post("p1", "2026-08-28T10:00:00Z")],
      complete: true,
      pairings: [{ itemId: "c1", postId: "p1" }],
      known: [{ id: "c1", externalPostId: null }],
    });

    assert.equal(result.kind, "ready");
    if (result.kind !== "ready") return;
    assert.equal(result.toMarkSent.length, 1);
    assert.equal(result.toMarkSent[0]?.itemId, "c1");
  });

  /**
   * AMI MÁR MEG VAN JELÖLVE, AZT NEM JELÖLJÜK ÚJRA. A `sentAt` a KIKÜLDÉS
   * ideje, nem a legutóbbi lekérdezésé -- egy ismételt írás minden futásnál
   * odébb tolná, és a lista sorrendje a lekérdezéseinket mutatná a valóság
   * helyett.
   */
  it("leaves an already marked item alone", () => {
    const result = reconcileSent({
      posts: [post("p1", "2026-08-28T10:00:00Z")],
      complete: true,
      pairings: [{ itemId: "c1", postId: "p1" }],
      known: [{ id: "c1", externalPostId: "p1" }],
    });

    assert.equal(result.kind, "ready");
    if (result.kind !== "ready") return;
    assert.deepEqual(result.toMarkSent, []);
  });

  /**
   * A PÁROSÍTATLAN KÜLSŐ POSZT NEM HIBA. A Page-en huszonöt poszt áll
   * 2026-03-18 óta, és a legtöbb még azelőttről való, hogy ez a tábla létezett
   * volna. Ha ezeket hibaként jelentenénk, az első futás huszonhárom „leletet"
   * adna, és utána senki nem nézné meg a listát.
   */
  it("reports an unknown post as unmatched, not as a fault", () => {
    const result = reconcileSent({
      posts: [post("regi", "2026-03-18T10:00:00Z")],
      complete: true,
      pairings: [],
      known: [],
    });

    assert.equal(result.kind, "ready");
    if (result.kind !== "ready") return;
    assert.deepEqual(result.toMarkSent, []);
    assert.equal(result.unmatched.length, 1);
  });

  /**
   * NEM TALÁLGAT PÁRT. Egy „valószínűleg ez az" párosítás egy kiküldött posztot
   * jelölne meg egy MÁSIK tételen, és azt utólag senki nem venné észre: a tábla
   * késznek mutatna valamit, ami el sem ment.
   *
   * A bemenet olyan, ahol a találgatás kézenfekvő lenne: egy tétel, egy poszt,
   * és semmi más -- csak épp a hívó nem mondta meg, hogy összetartoznak.
   */
  it("does not pair a lone item with a lone post on its own", () => {
    const result = reconcileSent({
      posts: [post("p1", "2026-08-28T10:00:00Z")],
      complete: true,
      pairings: [],
      known: [{ id: "c1", externalPostId: null }],
    });

    assert.equal(result.kind, "ready");
    if (result.kind !== "ready") return;
    assert.deepEqual(result.toMarkSent, []);
    assert.equal(result.unmatched.length, 1);
  });
});
