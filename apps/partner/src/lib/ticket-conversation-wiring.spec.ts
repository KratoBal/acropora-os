import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * A HIBAJEGY BESZÉLGETÉSÉNEK BEKÖTÉSE (kártya 084e2c24) -- a kódra mérve, a
 * kommentek nélkül (lásd `ticket-fields-edit-wiring.spec.ts`). Renderelő
 * nincs ebben a csomagban: azt mérjük, hogy a lap a helyes hívásokat írja le,
 * nem azt, hogy a partner látja.
 *
 * MI PIROSÍT:
 * - a hibajegy oldala nem mutatja a beszélgetést, vagy nem a saját azonosítójával;
 * - a kliens nem a partneres útvonalat hívja (például a belső `/messages`-t),
 *   vagy a küldés nem POST, vagy nem viszi az újraküldés azonosítóját;
 * - egy sikertelen küldés után az azonosító elvész (a második kattintás új
 *   üzenetet hozna létre), vagy a megváltozott szöveg a régi azonosítóval megy.
 */
const GYOKER = join(process.cwd(), "src");
const LAP = join(GYOKER, "components", "ticket-detail.tsx");
const DOBOZ = join(GYOKER, "components", "ticket-conversation.tsx");
const KLIENS = join(GYOKER, "lib", "api.ts");

const kod = (ut: string) =>
  readFileSync(ut, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the ticket conversation's wiring", () => {
  it("POSITIVE CONTROL: the three files are readable and not empty", () => {
    for (const ut of [LAP, DOBOZ, KLIENS])
      assert.ok(kod(ut).length > 500, `${ut}: empty or suspiciously short`);
  });

  it("the ticket page shows the conversation with its own id", () => {
    assert.match(kod(LAP), /<TicketConversation ticketId=\{id\} \/>/);
  });

  it("the client reads and posts on the partner route, never on /messages", () => {
    const kliens = kod(KLIENS);
    assert.match(
      kliens,
      /ticketConversation:[\s\S]*?\/service\/jobs\/\$\{encodeURIComponent\(id\)\}\/partner-conversation/,
    );
    assert.match(
      kliens,
      /sendTicketMessage:[\s\S]*?\/partner-conversation\/messages`,\s*\{\s*method: "POST",\s*body: JSON\.stringify\(\{ text, clientMessageId \}\)/,
    );
    assert.doesNotMatch(kliens, /["`]\/messages/);
  });

  it("a failed send keeps its resend id, a changed text drops it, a sent one clears it", () => {
    const doboz = kod(DOBOZ);
    assert.match(doboz, /pendingId\.current \?\?= newClientMessageId\(\)/);
    assert.match(
      doboz,
      /setText\(event\.target\.value\);\s*pendingId\.current = null;/,
    );
    const siker = doboz.slice(
      doboz.indexOf("const sent = await"),
      doboz.indexOf("} catch", doboz.indexOf("const sent = await")),
    );
    assert.match(siker, /pendingId\.current = null;/);
    const hiba = doboz.slice(
      doboz.indexOf("} catch", doboz.indexOf("const sent = await")),
      doboz.indexOf("} finally", doboz.indexOf("const sent = await")),
    );
    assert.doesNotMatch(hiba, /pendingId/);
  });
});
