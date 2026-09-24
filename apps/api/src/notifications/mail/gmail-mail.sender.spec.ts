import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GmailMailSender, TicketMailError } from "./gmail-mail.sender.js";
import type { OutgoingMail } from "./mail.port.js";

/**
 * AMIT EZ A SPEC MER: A BUROK HELYET, NEM A VISELKEDESET.
 *
 * A `send()` egy burkot tesz a KULDES-keres köré, es a `request` sajat try-ja ettol
 * KULON all. A hely maga a megkulonbozteto jel: ha valaki a burkot "egyszerusitesbol"
 * beljebb tolja a `request`-be, akkor a TOKEN-fazis halozati hibaja is
 * `TICKET_MAIL_SEND_INDETERMINATE` lenne -- holott ott TUDJUK, hogy semmi nem ment ki.
 *
 * ES AMIERT EZ NEM ELMELETI: az indeterminate allapotbol ujrakuldes lesz, es ket
 * egyforma level megy ki a partnernek. A kulonbseg tehat nem cimke-kerdes.
 *
 * MIERT NEM ELEG A SZOLGALTATAS SPECJE, ami mar letezik: az a hibakodot BEMENETKENT
 * kapja (`kuldesHiba: new TicketMailError(...)`), tehat a kuldo DONTESET nem meri. Egy
 * beljebb tolt burok mellett is zold maradna. (nautilus merese, 2026-09-22, 77edf49a)
 *
 * HALOZAT NELKUL FUT: a `fetchImpl` es a kornyezet is injektalt, tehat a ket fazist egy
 * URL-re dontő dupla valasztja szet. ELES KULDES NEM INDUL.
 */

/** Kitalalt ertekek. A ket URL SZANDEKOSAN kulonbozo, ezen mulik a szetvalasztas. */
const TOKEN_URL = "https://token.pelda.teszt/oauth";
const API_URL = "https://gmail.pelda.teszt";

const KORNYEZET = {
  GMAIL_TICKET_CLIENT_ID: "kitalalt-client-id",
  GMAIL_TICKET_CLIENT_SECRET: "kitalalt-client-secret",
  GMAIL_TICKET_REFRESH_TOKEN: "kitalalt-refresh-token",
  GMAIL_TICKET_USER: "ticket@pelda.teszt",
  GMAIL_API_URL: API_URL,
  GOOGLE_OAUTH_TOKEN_URL: TOKEN_URL,
} as NodeJS.ProcessEnv;

const LEVEL: OutgoingMail = {
  to: ["partner@pelda.teszt"],
  subject: "Lezárt hibajegy",
  text: "A munkalap elkészült.",
};

/**
 * A DUPLA URL SZERINT DONT, es ez nem kenyelmi: a ket fazis kozotti kulonbseg AZ, amit
 * ez a spec mer. Egy hivas-szamlalo alapu dupla ugyanezt adna, csak a SORRENDRE epitve
 * -- es akkor egy atrendezes csendben mast merne.
 */
function fetchDupla(viselkedes: {
  token: "ok" | "elutasit" | "nem-ok";
  kuldes?: "ok" | "elutasit";
}): typeof fetch {
  return (async (bemenet: string | URL | Request) => {
    const url = String(bemenet);

    if (url.startsWith(TOKEN_URL)) {
      if (viselkedes.token === "elutasit")
        throw new DOMException("megszakítva", "AbortError");
      if (viselkedes.token === "nem-ok")
        return new Response("nem jo", { status: 401 });
      return Response.json({
        access_token: "kitalalt-token",
        expires_in: 3600,
      });
    }

    if (url.startsWith(API_URL)) {
      if (viselkedes.kuldes === "elutasit")
        throw new DOMException("megszakítva", "AbortError");
      return Response.json({ id: "kitalalt-uzenet" });
    }

    throw new Error(`a dupla nem ismeri ezt a cimet: ${url}`);
  }) as typeof fetch;
}

function kuldo(viselkedes: Parameters<typeof fetchDupla>[0]) {
  return new GmailMailSender(fetchDupla(viselkedes), KORNYEZET);
}

async function hibaja(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (hiba) {
    return hiba;
  }
  return null;
}

describe("a kuldes-burok HELYE", () => {
  /**
   * EZ AZ AZ ALLITAS, AMI A HELYET MERI. Ha a burok a `request`-be kerul, ez pirosodik
   * ki -- a masik ketto nem.
   */
  it("a TOKEN-fazis halozati hibaja NEM indeterminate", async () => {
    const hiba = await hibaja(kuldo({ token: "elutasit" }).send(LEVEL));

    assert.notEqual(
      hiba instanceof TicketMailError ? hiba.code : null,
      "TICKET_MAIL_SEND_INDETERMINATE",
      "a token-fazis bukasakor TUDJUK, hogy semmi nem ment ki",
    );
  });

  /** A POZITIV OLDAL. Enelkul a fenti allitast egy mindent elnyelo kod is kielegitene. */
  it("a KULDES-fazis halozati hibaja indeterminate", async () => {
    const hiba = await hibaja(
      kuldo({ token: "ok", kuldes: "elutasit" }).send(LEVEL),
    );

    assert.ok(hiba instanceof TicketMailError);
    assert.equal(hiba.code, "TICKET_MAIL_SEND_INDETERMINATE");
  });

  /**
   * KONTROLL, ES A LEGKOZELEBBI TEVESZTES: a token-keres VALASZT ad, csak nem jot. Itt
   * a `fetch` nem utasit el, tehat egy beljebb tolt burok sem erinti -- ennek az
   * allitasnak MINDKET rontas mellett zoldnek kell maradnia.
   */
  it("a nem-ok token-valasz tovabbra is TOKEN_FAILED", async () => {
    const hiba = await hibaja(kuldo({ token: "nem-ok" }).send(LEVEL));

    assert.ok(hiba instanceof TicketMailError);
    assert.equal(hiba.code, "TICKET_MAIL_TOKEN_FAILED");
  });
});

/**
 * A FELADO CIME -- Balazs kerese, 2026-09-24 (Akvariumok szal, message_id
 * 1552727165714563153): a vizmeres-level `info@acropora.hu`-rol menjen, a
 * tobbi tovabbra is a kornyezet feladojarol (`GMAIL_TICKET_USER`).
 *
 * ES A FELADO NEVE, 2026-09-24 17:06 UTC (Balazs dontese, emlek 1827):
 * "MINDEN ticket@acropora.hu-rol meno level: 'Acropora Hibajegy kezelő'
 * <ticket@acropora.hu>". Ez a NEVET is a kimeno level reszeve teszi, akkor
 * is, ha a hivo (a legtobb kuldesi ut) `mail.from`-ot nem tolti ki -- lasd
 * `DEFAULT_GMAIL_TICKET_USER_NAME` a `gmail-mail.sender.ts`-ben.
 *
 * A NYERS KIMENO LEVELET MERI, NEM EGY KOZBULSO MEZOT: a `request()` hivas
 * torzse a Gmail API-nak kuldott `{ raw }`, base64url-kodolva. Ez a spec ezt
 * dekodolja vissza, es a `From:` sort olvassa -- ugyanazt latja, amit a Gmail
 * kapna.
 */
describe("a feladó címe", () => {
  function kuldoFeladoMereshez(kornyezet: NodeJS.ProcessEnv = KORNYEZET): {
    sender: GmailMailSender;
    nyersLevelek: () => string[];
  } {
    const nyersLevelek: string[] = [];
    const fetchImpl = (async (
      bemenet: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(bemenet);
      if (url.startsWith(TOKEN_URL))
        return Response.json({
          access_token: "kitalalt-token",
          expires_in: 3600,
        });
      if (url.startsWith(API_URL)) {
        const torzs = JSON.parse(String(init?.body)) as { raw: string };
        nyersLevelek.push(
          Buffer.from(
            torzs.raw.replace(/-/g, "+").replace(/_/g, "/"),
            "base64",
          ).toString("utf8"),
        );
        return Response.json({ id: "kitalalt-uzenet" });
      }
      throw new Error(`a dupla nem ismeri ezt a cimet: ${url}`);
    }) as typeof fetch;

    return {
      sender: new GmailMailSender(fetchImpl, kornyezet),
      nyersLevelek: () => nyersLevelek,
    };
  }

  function fromSor(nyersLevel: string): string | undefined {
    return nyersLevel.split("\r\n").find((sor) => sor.startsWith("From: "));
  }

  /** RFC 2047 kodolt szo dekodolasa -- `=?UTF-8?B?<base64>?=` alak. */
  function dekodoltNev(fromSor: string): string | undefined {
    const talalat = fromSor.match(/=\?UTF-8\?B\?([^?]+)\?=/);
    return talalat?.[1]
      ? Buffer.from(talalat[1], "base64").toString("utf8")
      : undefined;
  }

  /*
    NEGATIV KONTROLL A CIMRE, POZITIV A NEVRE: `mail.from` HIANYZIK, tehat a
    KORNYEZET cime megy -- ez minden olyan hivora igaz, ami ezt a mezot nem
    tolti ki (a hibajegy- es az atadasi levelek is, lasd a
    `ticket-mail.service.spec.ts` es a `handover-mail.service.spec.ts`
    egy-egy allitasat, azok az `OutgoingMail.from` mezot merik, NEM a nyers
    fejlecet). A NEV viszont MAR ITT is megjelenik, mert a `ticket@`
    alapertelmezese 2026-09-24 ota nem nevtelen.
  */
  it("HIÁNYZÓ mail.from mellett a KÖRNYEZET címe és alapértelmezett neve megy", async () => {
    const { sender, nyersLevelek } = kuldoFeladoMereshez();

    await sender.send(LEVEL);

    const sor = fromSor(nyersLevelek()[0] ?? "") ?? "";
    /*
      A "Hibajegy kezelő" MAGA IS EKEZETES (ő), tehat az alapertelmezes
      onmagaban RFC 2047 kodolt szokent megy -- ez a keszlet legkozelebbi
      esete ahhoz, amit a hazban "az elso mert eset" elvnek hivunk: nem
      kulon fixturaval bizonyitjuk az ekezetes kodolast, hanem a VALODI
      alapertelmezessel.
    */
    assert.match(sor, /^From: =\?UTF-8\?B\?/);
    assert.match(sor, / <ticket@pelda\.teszt>$/);
    assert.equal(dekodoltNev(sor), "Acropora Hibajegy kezelő");
  });

  /* POZITIV OLDAL: a hivo feladoja elsobbseget kap a kornyezetevel szemben. */
  it("KITÖLTÖTT mail.from a saját címét viszi, a környezetét nem", async () => {
    const { sender, nyersLevelek } = kuldoFeladoMereshez();

    await sender.send({ ...LEVEL, from: "info@pelda.teszt" });

    assert.equal(fromSor(nyersLevelek()[0] ?? ""), "From: info@pelda.teszt");
  });

  /**
   * EGYEDI, KONFIGURÁLT NÉV -- Balázs kérése: a nevek legyenek
   * konfigurálhatók. ASCII névnél idézőjeles alak, nem kódolt szó.
   */
  it("egyedi GMAIL_TICKET_USER_NAME idézőjeles alakban megy, ASCII névnél", async () => {
    const { sender, nyersLevelek } = kuldoFeladoMereshez({
      ...KORNYEZET,
      GMAIL_TICKET_USER_NAME: "Ugyfelszolgalat",
    });

    await sender.send(LEVEL);

    assert.equal(
      fromSor(nyersLevelek()[0] ?? ""),
      'From: "Ugyfelszolgalat" <ticket@pelda.teszt>',
    );
  });

  /**
   * EGYEDI, ÉKEZETES NÉV -- külön eset az alapértelmezéstől, mert itt a
   * KONFIGURÁLT érték kódolását mérjük, nem a kódba írt alapértelmezését.
   */
  it("egyedi GMAIL_TICKET_USER_NAME ékezetes alakja RFC 2047 kódolt szóként megy", async () => {
    const { sender, nyersLevelek } = kuldoFeladoMereshez({
      ...KORNYEZET,
      GMAIL_TICKET_USER_NAME: "Ügyfélszolgálat",
    });

    await sender.send(LEVEL);

    const sor = fromSor(nyersLevelek()[0] ?? "") ?? "";
    assert.match(sor, /^From: =\?UTF-8\?B\?/);
    assert.match(sor, / <ticket@pelda\.teszt>$/);
    assert.equal(dekodoltNev(sor), "Ügyfélszolgálat");
  });
});
