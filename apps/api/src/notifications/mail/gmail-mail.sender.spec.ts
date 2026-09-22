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
