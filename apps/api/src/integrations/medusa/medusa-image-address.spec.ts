import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyImageAddress,
  internalHost,
  UNREADABLE_ORIGIN,
} from "./medusa-image-address.js";

/**
 * A KET ISMERT POZITIV, ES AMI BELOLUK MERT.
 *
 * A bolt `file-local` szolgaltatojanak tartaleka `http://localhost:9000/static`
 * (merve a telepitett `@medusajs/file-local` `services/local-file.js`
 * fajljabol, es ez all a kereskedelmi oldal `verify-file-backend-url`
 * fajljanak fejleceben is). A fajl-KULCS resze innen illusztracio: a kulcsot a
 * szolgalato general, es a besorolas nem is fugg tole -- a HOSZT dont.
 *
 * A helyes, kivulrol elerheto alak ugyanarra a fajlra viszont MERT ertek:
 *   https://commerce-stage.acropora.hu/static/1788516704783-156161  ->  HTTP 200
 */
const BELSO_156161 = "http://localhost:9000/static/1788516704783-156161.jpg";
const BELSO_WYSIWYG = "http://localhost:9000/static/1788516704999-195.jpg";
const NYILVANOS =
  "https://commerce-stage.acropora.hu/static/1788516704783-156161";

describe("a bolti kép-cím besorolása", () => {
  /**
   * AZ ELSO ALLITAS A KONTROLL, NEM A LELET: ha ez a ketto nem esik `internal`
   * besorolasba, akkor a szamlalo rossz, nem az adat tiszta.
   */
  it("megtalálja mind a két ismert rossz címet", () => {
    assert.equal(classifyImageAddress(BELSO_156161).kind, "internal");
    assert.equal(classifyImageAddress(BELSO_WYSIWYG).kind, "internal");
  });

  /**
   * ES A MASIK IRANY, UGYANOLYAN FONTOS: egy "nem talalok belso cimet"
   * eredmenyt egy MINDENT elutasito besorolo is eloallit. Ez az allitas
   * bizonyitja, hogy a szabaly meg tud kulonboztetni.
   */
  it("a mért nyilvános címet NEM sorolja belsőnek", () => {
    const verdict = classifyImageAddress(NYILVANOS);
    assert.equal(verdict.kind, "public");
    assert.equal(verdict.origin, "https://commerce-stage.acropora.hu");
  });

  it("a hurok- és magánhálózati címeket belsőnek látja", () => {
    for (const host of [
      "localhost",
      "127.0.0.1",
      "127.1.2.3",
      "0.0.0.0",
      "10.0.0.7",
      "192.168.1.10",
      "172.16.0.1",
      "172.31.255.254",
      "169.254.10.1",
      "medusa.local",
      "backend.internal",
      "medusa",
    ])
      assert.equal(internalHost(host), true, host);
  });

  /**
   * A HATAROK KIFELE IS: a 172-es tartomany CSAK 16 es 31 kozott magan, es egy
   * pontot tartalmazo nyilvanos nev nem lehet konteneres nev. Egy tul TAG
   * szabaly hamis leletet gyartana, es azon egy javitasi kor indulna el.
   */
  it("a szomszédos, NYILVÁNOS tartományokat nem sorolja belsőnek", () => {
    for (const host of [
      "172.15.0.1",
      "172.32.0.1",
      "11.0.0.1",
      "192.169.1.1",
      "shop.acropora.hu",
      "acropora.hu",
    ])
      assert.equal(internalHost(host), false, host);
  });

  it("az értelmezhetetlen címet külön névvel jelöli, nem sorolja egyik oldalra sem", () => {
    for (const rossz of [
      "",
      "nem-egy-url",
      "/static/kep.jpg",
      "data:image/png;base64,AAAA",
    ]) {
      const verdict = classifyImageAddress(rossz);
      assert.equal(verdict.kind, "unreadable", rossz);
      assert.equal(verdict.origin, UNREADABLE_ORIGIN);
    }
  });

  it("a portot a hoszt-bontás megtartja", () => {
    assert.equal(
      classifyImageAddress("http://localhost:9000/static/a.jpg").origin,
      "http://localhost:9000",
    );
  });
});
