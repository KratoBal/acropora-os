import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  ROLES_THIS_VIEW_CANNOT_COVER,
  STATES_THAT_CAN_WAIT_FOR_IMAGE,
  waitingFor,
  waitingOnMe,
} from "./content-filter.js";

describe("what the default list shows", () => {
  /**
   * A SZERZŐ KÉT ÁLLAPOTBAN VAN SORON: az induló vázlatnál és a visszakörnél.
   * Ha csak a `DRAFTING` szerepelne, a javításra visszaküldött tételek
   * eltűnnének a listájáról -- és pont azok a legrégebben állók.
   */
  it("puts both the first draft and the send-backs on the author's list", () => {
    assert.deepEqual(waitingFor("author").states, [
      "DRAFTING",
      "AWAITING_REVISION",
    ]);
  });

  it("shows a reviewer only what is waiting for review", () => {
    assert.deepEqual(waitingFor("reviewer").states, ["AWAITING_REVIEW"]);
  });

  it("shows an approver only what is waiting for approval", () => {
    assert.deepEqual(waitingFor("approver").states, ["AWAITING_APPROVAL"]);
  });

  /**
   * A JÓVÁHAGYÓ ÉS A KIKÜLDŐ MINDENT LÁT, AMI RÁJUK VÁR, akárki írta. Ez a két
   * szerep nevesített embereké, és az egész felület azért készül, mert ma nem
   * látják, mi vár rájuk -- egy saját-tételekre szűkítés pont ezt hozná vissza.
   *
   * A szerző és a lektor viszont szűkül: az ő listájuk ne teljen meg mások
   * vázlataival.
   */
  it("does not narrow the approver or the sender to their own pieces", () => {
    assert.equal(waitingFor("approver").ownOnly, false);
    assert.equal(waitingFor("sender").ownOnly, false);
    assert.equal(waitingFor("author").ownOnly, true);
    assert.equal(waitingFor("reviewer").ownOnly, true);
  });

  /**
   * A KOZOS SOR: a lektor sora a GAZDATLAN teteleket is tartalmazza.
   *
   * Balazs dontese, szo szerint: "B" (Discord, 2026-09-02 23:31). A gepi
   * agensek beadta tetelnek nincs lektora, es nem is osztunk ki egyet
   * mindegyikhez -- aki raer, elviszi.
   */
  it("puts the unassigned items into the reviewer's queue", () => {
    assert.equal(waitingFor("reviewer").includeUnassignedReviews, true);
  });

  /**
   * ES A TOBBI SZEREP SORA NEM LETT BOVEBB. Ez a fontosabb allitas: az
   * `ownOnly` KOZOS a szerzore es a lektorra, tehat egy kozos agon vitt javitas
   * CSENDBEN megtoltene a szerzo listajat mas gazdatlan teteleivel.
   */
  it("leaves every other role's queue exactly as it was", () => {
    assert.equal(waitingFor("author").includeUnassignedReviews, false);
    assert.equal(waitingFor("approver").includeUnassignedReviews, false);
    assert.equal(waitingFor("sender").includeUnassignedReviews, false);
  });
});

describe("which pieces can still be waiting for an image", () => {
  /**
   * A KIKÜLDÖTT ÉS AZ ELVETETT KIMARAD, és ez nem részletkérdés: egy
   * kiküldött poszt képe már nem hiányzik, akkor sem, ha a mező üresen maradt.
   * Ha benne lennének, a „képre vár" lista minden régi tétellel megtelne, és
   * három ilyen után senki nem nézné meg.
   */
  it("leaves out what has already gone out or been dropped", () => {
    assert.equal(STATES_THAT_CAN_WAIT_FOR_IMAGE.includes("SENT"), false);
    assert.equal(STATES_THAT_CAN_WAIT_FOR_IMAGE.includes("DISCARDED"), false);
  });

  /**
   * A SCHEDULED BENNE VAN, és ez az az eset, ami elsőre furcsa: egy ütemezett
   * posztnak elvileg már van képe. De a képet a Facebookon is lehet cserélni,
   * és a mi táblánk attól még hiányosnak látszana -- a lista feladata
   * megmutatni, nem eldönteni, hogy baj-e.
   */
  it("still counts a scheduled piece, because ours may be the incomplete one", () => {
    assert.equal(STATES_THAT_CAN_WAIT_FOR_IMAGE.includes("SCHEDULED"), true);
  });
});

describe("what waits on me, without picking a role", () => {
  /**
   * A SAJÁT MUNKA MINDIG BENNE VAN, a jog kérdésétől függetlenül: bárki lehet
   * szerző vagy lektor egy tételen, ahhoz nem kell külön jogosultság.
   */
  it("always covers my own drafts and reviews", () => {
    const shards = waitingOnMe({ userId: "u1", canApprove: false });

    assert.deepEqual(
      shards.map((shard) => shard.scope),
      ["own-author", "own-reviewer"],
    );
  });

  /**
   * A JÓVÁHAGYÓI RÉSZ CSAK JOGGAL KERÜL BE. E nélkül minden felhasználó
   * listájában ott állna az összes jóváhagyásra váró tétel: olyan sorok,
   * amikkel nem tud mit kezdeni, és amik elfednék azt, ami tényleg rá vár.
   */
  it("adds the approval queue only for someone who can approve", () => {
    const withRight = waitingOnMe({ userId: "u1", canApprove: true });
    const without = waitingOnMe({ userId: "u1", canApprove: false });

    assert.equal(withRight.length, 3);
    assert.equal(without.length, 2);
    assert.deepEqual(withRight[2], {
      states: ["AWAITING_APPROVAL"],
      scope: "everyone",
    });
  });

  /**
   * ÉS A JÓVÁHAGYÓI RÉSZ NEM SZŰKÜL SAJÁT TÉTELEKRE, a másik kettő igen. Ez a
   * különbség az egész nézet lényege: a jóváhagyóra MINDEN rá váró tétel vár,
   * akárki írta, a szerzőre viszont csak a sajátja.
   */
  it("narrows my own work but not the approval queue", () => {
    const shards = waitingOnMe({ userId: "u1", canApprove: true });

    assert.deepEqual(
      shards.map((shard) => shard.scope),
      ["own-author", "own-reviewer", "everyone"],
    );
  });

  /**
   * AMIT A NÉZET NEM FED LE, AZ MEG VAN NEVEZVE, NEM HALLGATVA.
   *
   * Egy „mi vár rám" nézet, ami egy negyedét kihagyja és erről nem szól,
   * pontosan azt a hamis megnyugvást adja, amit kerülni akarunk: aki nem tudja,
   * hogy hiányzik valami, a hiányzót nem létezőnek hiszi.
   */
  it("names the quarter it cannot cover, with a reason", () => {
    assert.equal(ROLES_THIS_VIEW_CANNOT_COVER.length, 1);
    assert.equal(ROLES_THIS_VIEW_CANNOT_COVER[0]!.role, "sender");
    // AZ INDOK NEM DÍSZ: abból tudja meg az olvasó, HOL nézze meg helyette.
    assert.match(ROLES_THIS_VIEW_CANNOT_COVER[0]!.reason, /szerep-választóval/);
  });
});

/**
 * A CIMKE AKKOR ES CSAK AKKOR NEVEZHET TULAJDONOST, HA A NEZET KIZAROLAG A
 * SAJATOT MUTATJA.
 *
 * Ez a szabaly HAROM cimke-javitast dontott el egymas utan (a lektor a #401-ben,
 * a jovahagyo es a kikuldo ezutan), es mindannyiszor UTOLAG vettuk eszre, hogy
 * a szoveg tobbet allit a szurojenél. Ezert nem harom kulon allitas all itt,
 * hanem MAGA A SZABALY, vegigfuttatva mind a negy szerepen.
 *
 * A HASZNA: ha valaki holnap atirja az `ownOnly` sort vagy a gazdatlan agat, ez
 * MAGATOL pirosodik ki -- nem attol, hogy valakinek eszebe jut megnezni a
 * cimkeket is.
 *
 * MIERT ITT ES NEM A WEBES TESZTBEN: a `waitingFor` ebben a csomagban lakik, a
 * cimkek a webesben, es a web NEM fugg az api-tol. Ha a webes oldalon irnank, a
 * SZABALY jonne szovegbol (egy regex az `ownOnly` sorra), es az torekeny. Igy
 * forditva van: a szabaly VALODI HIVAS, es csak a cimke-szoveg jon fajlbol.
 *
 * A `reviewer` mutatja meg, miert nem eleg az `ownOnly`-t nezni: az IGAZ, es a
 * cimke megis rossz volt, mert a #398 gazdatlan aga kinyitotta a halmazt.
 */
const LABELS_FILE = "../web/src/components/content/content-labels.ts";
const OWNERSHIP_CLAIM = /^amit /;

function roleLabels(): Record<string, string> {
  const source = readFileSync(LABELS_FILE, "utf8");
  const block = source.slice(
    source.indexOf(
      "CONTENT_ROLE_LABELS: Record<ContentViewerRole, string> = {",
    ),
  );
  const labels: Record<string, string> = {};
  for (const match of block
    .slice(0, block.indexOf("};"))
    .matchAll(/^\s*(author|reviewer|approver|sender):\s*"([^"]+)"/gm))
    labels[match[1]!] = match[2]!;
  return labels;
}

describe("when a role label may name an owner", () => {
  /**
   * A KONTROLL A KIOLVASASRA. Enelkul egy elrontott minta URES objektumot adna,
   * es a szabaly-ellenorzes nulla szerepen futna le -- zolden, es semmit nem
   * merve. A nevezot tehat allitjuk, nem csak a tartalmat.
   */
  it("reads all four labels from the web package", () => {
    const labels = roleLabels();

    assert.deepEqual(Object.keys(labels).sort(), [
      "approver",
      "author",
      "reviewer",
      "sender",
    ]);
    // Es a minta MEG TUDJA kulonboztetni a ket alakot, kulonben a fo allitas
    // barmit elfogadna.
    assert.equal(OWNERSHIP_CLAIM.test("amit írok"), true);
    assert.equal(OWNERSHIP_CLAIM.test("lektorálásra vár"), false);
  });

  it("only lets a label claim ownership when the view narrows to it", () => {
    const labels = roleLabels();

    for (const role of ["author", "reviewer", "approver", "sender"] as const) {
      const filter = waitingFor(role);
      const csakSajat = filter.ownOnly && !filter.includeUnassignedReviews;

      assert.equal(
        OWNERSHIP_CLAIM.test(labels[role]!),
        csakSajat,
        `A(z) "${labels[role]}" címke ${csakSajat ? "nevezhetne" : "NEM nevezhet"} tulajdonost: ownOnly=${filter.ownOnly}, gazdátlan ág=${filter.includeUnassignedReviews}.`,
      );
    }
  });
});
