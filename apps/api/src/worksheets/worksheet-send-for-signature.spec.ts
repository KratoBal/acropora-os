import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";

import { hashPassword } from "../users/password.util.js";

import type { WorksheetsRepository } from "./worksheets.repository.js";
import { WorksheetsService } from "./worksheets.service.js";

/**
 * A KIKULDES ALAIRASRA, ES AMIERT EZ KET ALLAPOT, NEM EGY (d49e7df1).
 *
 * 2026-09-21-ig a lezaras MAGA tette alairhatova a lapot: a `close()` a
 * `DRAFT`-ot `AWAITING_SIGNATURE`-re allitja, es az alairas pontosan ezt az
 * egy allapotot kovetelte meg. Ettol a portalon MINDEN lezart lap alairhatonak
 * latszott -- akkor is, ha soha nem kuldtuk ki senkinek.
 *
 * Balazs be is jelentette (2026-09-21 14:25:28 UTC): "van egy nyitott munkalap,
 * amit ala tudna irni ha akarna."
 *
 * A DUPLA A REPOSITORYT HELYETTESITI, tehat ezek az allitasok a SZOLGALTATAS
 * dontesert merik (hatokor, uzenet, hibafajta). Magat a felteteles irast (a ket
 * feltetel a lekerdezesben) az integracios keszlet meri, adatbazissal.
 */

const KOD = "0000";
let KOD_HASH = "";
before(async () => {
  KOD_HASH = await hashPassword(KOD);
});

const BELSOS = { id: "szerelo-1", customerId: null, supplierId: null };
const PARTNER = { id: "kontakt-1", customerId: "customer-1", supplierId: null };

function service(overrides: Record<string, unknown> = {}) {
  return new WorksheetsService({
    detail: async () => ({ id: "worksheet-1", customerId: "customer-1" }),
    sendForSignature: async () => ({ ok: true, signerName: "Vevő Vilmos" }),
    ...overrides,
  } as unknown as WorksheetsRepository);
}

describe("a kikuldes alairasra", () => {
  /**
   * BELSOS LEPES, ES A HATOKOR DONT, NEM A SZEREP.
   *
   * A `PARTNER_SERVICE` viseli a `SERVICE_MANAGE` jogot, tehat a vegpont jog
   * szerint elerheto neki. Ami ertelmetlen: sajat maganak kuldene ki.
   */
  it("partner hatokorrel NEM megy", async () => {
    await assert.rejects(
      () =>
        service().sendForSignature(
          "worksheet-1",
          "kontakt-2",
          PARTNER as never,
        ),
      (error: unknown) => error instanceof ForbiddenException,
    );
  });

  /**
   * ES A MASIK IRANY: a belsos kollega ki TUDJA kuldeni.
   *
   * === MIERT VARRAT-ALLITAS, ES NEM VEGIG-FUTTATAS ===
   *
   * A siker utan a szolgaltatas a TELJES reszletlapot adja vissza
   * (`detailAfterWrite`), es ahhoz egy nyolcvan soros, valodi alaku
   * munkalap-sor kellene a duplaba. Elso alakom egy szuk objektumot adott, es a
   * teszt `Cannot read properties of undefined` hibaval bukott -- vagyis nem a
   * mert szabalyrol szolt, hanem a duplarol.
   *
   * Ezert a `detail` egy NEVESITETT jelzest dob a lekepezes helyett. Az allitas
   * igy KET dolgot mer: hogy a tarolo a helyes bemenetet kapta, ES hogy a
   * szolgaltatas eljutott a valasz osszeallitasaig -- tehat nem allt meg
   * kozben. A lekepezes maga mashol van merve.
   */
  it("belsos hatokorrel MEGY", async () => {
    const kapott: Record<string, unknown>[] = [];
    let elsoHivas = true;
    await assert.rejects(
      () =>
        service({
          sendForSignature: async (input: Record<string, unknown>) => {
            kapott.push(input);
            return { ok: true, signerName: "Vevő Vilmos" };
          },
          detail: async () => {
            if (elsoHivas) {
              elsoHivas = false;
              return { id: "worksheet-1", customerId: "customer-1" };
            }
            throw new Error("ELJUTOTT-A-VALASZIG");
          },
        }).sendForSignature("worksheet-1", "kontakt-2", BELSOS as never),
      (error: unknown) =>
        error instanceof Error && error.message === "ELJUTOTT-A-VALASZIG",
    );
    assert.equal(kapott.length, 1, "a tarolo NEM kapta meg a kikuldest");
    assert.equal(kapott[0]?.signerUserId, "kontakt-2");
    assert.equal(kapott[0]?.actorUserId, "szerelo-1");
  });

  /**
   * IDEGEN CIMZETT NEM MEGY. Ugyanaz a hatar, amit az alairas is oriz: a lap
   * tetejere nem kerulhet egy idegen ember neve ugy, hogy a jelzes szerint a
   * partner munkatarsa varja az alairast.
   */
  it("a lap partnerehez nem tartozo cimzettet elutasitja", async () => {
    await assert.rejects(
      () =>
        service({
          sendForSignature: async () => ({
            ok: false,
            reason: "SIGNER_NOT_IN_PARTNER",
          }),
        }).sendForSignature("worksheet-1", "idegen-9", BELSOS as never),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /nem a munkalap partnerének munkatársa/.test(error.message),
    );
  });

  /** PISZKOZATOT NEM LEHET KIKULDENI: eloszor ki kell allitani. */
  it("nem kiallitott lapot nem kuld ki", async () => {
    await assert.rejects(
      () =>
        service({
          sendForSignature: async () => ({
            ok: false,
            reason: "NOT_AWAITING_SIGNATURE",
          }),
        }).sendForSignature("worksheet-1", "kontakt-2", BELSOS as never),
      (error: unknown) =>
        error instanceof ConflictException &&
        /Csak kiállított munkalap küldhető ki/.test(error.message),
    );
  });
});

/**
 * ES A MASIK OLDAL: AZ ALAIRAS KAPUJA KET OKOT ISMER, ES KET MONDATOT AD.
 *
 * A `NOT_SENT` nem a `NOT_AWAITING_SIGNATURE` finomitasa: KET kulonbozo
 * allapotrol szol, es MAS a teendo. Egy kozos mondat ("vagy piszkozat, vagy mar
 * dontottek") MINDKET olvasot rossz helyre kuldene -- a lap se nem piszkozat,
 * se nem doltek rola, csak nem kuldtuk ki.
 */
describe("az alairas kapuja a kikuldest is nezi", () => {
  /**
   * A KET KERO KET KULONBOZO UTON JUT IDAIG, ES EZ NEM A TESZT KENYELMETLENSEGE.
   *
   * A `signSelf` ag 2026-09-21 ota (#907) KULSOS keronek tiltott: a partner csak
   * SAJAT MAGAT irhatja ala, a listarol valasztva es alairokoddal. Elso alakom
   * mind a ket keronek `signSelf`-fel ment, es a partner-eset NEM a mert
   * kapunal bukott el, hanem a #907 kapujanal -- vagyis egy olyan bemenetet
   * adtam, ami ma nem letezik.
   */
  const alairasra = (reason: string, actor: { id: string }, partner: boolean) =>
    new WorksheetsService({
      detail: async () => ({
        id: "worksheet-1",
        customerId: "customer-1",
        serviceJob: { id: "job-1" },
        versions: [{ id: "v1", status: "AWAITING_SIGNATURE" }],
      }),
      userLegalName: async () => "Szerelő Sándor",
      customerContacts: async () => [{ id: actor.id, name: "Vevő Vilmos" }],
      signingCodeHash: async () => KOD_HASH,
      sign: async () => ({ ok: false, reason }),
    } as unknown as WorksheetsRepository).sign(
      "worksheet-1",
      (partner
        ? {
            decision: "ACCEPTED",
            signerUserId: actor.id,
            signatureCode: KOD,
            note: null,
          }
        : { decision: "ACCEPTED", signSelf: true, note: null }) as never,
      actor as never,
    );

  /**
   * A BELSOS KOLLEGA TEENDOT KAP: o TUD kikuldeni.
   */
  it("belsos kerőnek a mondat a KIKULDESRE mutat", async () => {
    await assert.rejects(
      () => alairasra("NOT_SENT", BELSOS, false),
      (error: unknown) =>
        error instanceof ConflictException &&
        /Küldd ki az aláírónak/.test(error.message),
    );
  });

  /**
   * A PARTNERNEK MAS: o NEM tud kikuldeni, tehat egy "kuldd ki" felszolitas
   * olyan teendot adna neki, amihez nincs joga -- ugyanaz a megfontolas, mint a
   * hibajegy-kapunal.
   */
  it("partner kerőnek a mondat NEM ad neki vegezhetetlen teendot", async () => {
    await assert.rejects(
      () => alairasra("NOT_SENT", PARTNER, true),
      (error: unknown) =>
        error instanceof ConflictException &&
        /Szólj nekünk, és kiküldjük/.test(error.message),
    );
  });

  /**
   * ES A REGI OK VALTOZATLAN -- kulon allitas, mert a ket ag kulon is el tud
   * romlani, es egy kozos mondatra visszaesve ez maradna eszrevetlen.
   */
  it("a piszkozat/eldöntött eset a SAJAT mondatat kapja", async () => {
    await assert.rejects(
      () => alairasra("NOT_AWAITING_SIGNATURE", BELSOS, false),
      (error: unknown) =>
        error instanceof ConflictException &&
        /vagy még piszkozat, vagy már megszületett róla a döntés/.test(
          error.message,
        ),
    );
  });
});
