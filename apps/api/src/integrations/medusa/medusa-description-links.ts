import type { prisma } from "@acropora/database";

import {
  isOwnPath,
  normalizeRedirectPath,
  redirectPathLower,
} from "../../products/redirect/redirect-path.js";

/**
 * A LEÍRÁSOKBAN A RÉGI BOLTRA MUTATÓ BELSŐ LINKEK ÁTÍRÁSA A VETÍTÉSKOR (card aaf002d3).
 *
 * A UNAS-ból jövő leírások `href`-jei a régi bolt (shop.acropora.hu, acropora.unas.hu) címére mutatnak. A vetítés, amikor a
 * leírást a boltba írja, ezeket az átirányítás-tábla AKTÍV szabályai alapján a Commerce-cím relatív útjára cseréli:
 * `https://shop.acropora.hu/Valenciennea-bella` -> `/hu/termek/valenciennea-bella`.
 *
 * MIÉRT A VETÍTÉSKOR, ÉS NEM AZ OS ADATBAN: a leírást a UNAS szinkron írja, és ha egy termék forrása változik, felülírja; az OS
 * adatban átírt link a következő UNAS-változásnál visszajönne. A vetítéskori átírás a forráshoz nem nyúl, és mindig a mai
 * szabályokból dolgozik. A termékismeret jóváhagyott szövegét (`knowledgeCopy`) NEM érinti: azt ember írta és hagyta jóvá.
 *
 * MIT ÍR ÁT, ÉS MIT NEM: csak a `href` attribútumot, csak a két régi hostra, csak ha van AKTÍV szabály a (kisbetűs, normalizált) útra,
 * és a szabály célja saját út (`/...`, nem `//...`). A lekérdezés-szöveges link (`?...`) érintetlen marad (az átirányítás az útra
 * szól, a lekérdezés jelentését nem tudjuk), a `#` töredék megmarad. Ami nem képződik le, érintetlen, és a jelentésben névvel áll.
 * Az átírás idempotens: az átírt link már nem régi hostú.
 */

export const OLD_SHOP_HOSTS: readonly string[] = [
  "shop.acropora.hu",
  "www.shop.acropora.hu",
  "acropora.unas.hu",
  "www.acropora.unas.hu",
];

/** Kisbetűs, normalizált forrás-út -> a szabály célja. */
export type OldShopLinkRules = ReadonlyMap<string, string>;

export interface OldShopLinkResult {
  text: string | null;
  /** Hány linket írtunk át. */
  rewritten: number;
  /** A régi hostú linkek, amelyekhez nincs (használható) szabály: az út, ahogy a szövegben áll. */
  unmapped: string[];
}

const HREF = /(\bhref\s*=\s*)(["'])([^"']*)\2/gi;
const URL_PARTS = /^(?:https?:)?\/\/([^/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/i;

/**
 * A CÉL, AMI A LEÍRÁS HTML-JÉBE KERÜLHET (barracuda, #2619). A szabály célja eddig csak a 301 `Location` fejlécébe ment; itt a vetített
 * leírás HTML-jébe kerül, amit a kirakat nyersen renderel. Egy kézzel megadott cél (`repoint`, `MANUAL`) a normalizálás
 * dekódolása miatt idézőjelet is tartalmazhat (`%22`), és kitörne az attribútumból. Ezért a cél csak a KÖZÖS saját-út ellenőrzésen
 * (`isOwnPath`: a `//x` és a `/\x` sem, mert a böngésző másik domainnek veszi) és egy karakter-ellenőrzésen megy át: a `" ' < > &` és a
 * szóköz/vezérlő karakter kizárja. Ami kimarad, leképezetlenként számol, és a jelentés megnevezi; escape-elés helyett a kihagyás, mert egyszerűbb.
 */
function safeTarget(target: string): boolean {
  return isOwnPath(target) && !/["'<>&\s\u0000-\u001f\u007f]/.test(target);
}

export function rewriteOldShopLinks(
  html: string | null,
  rules: OldShopLinkRules,
): OldShopLinkResult {
  if (html === null) return { text: null, rewritten: 0, unmapped: [] };
  let rewritten = 0;
  const unmapped: string[] = [];
  const text = html.replace(
    HREF,
    (whole, head: string, quote: string, value: string) => {
      const parts = URL_PARTS.exec(value.trim());
      if (!parts || !OLD_SHOP_HOSTS.includes(parts[1]!.toLowerCase()))
        return whole;
      // a normalizálás maga dekódol (egyszer): itt nincs előzetes dekódolás, különben a `%2541` kétszer dekódolódna
      const raw = parts[2] || "/";
      const normalized = normalizeRedirectPath(raw);
      const path = normalized ?? raw;
      const target = normalized
        ? rules.get(redirectPathLower(normalized))
        : undefined;
      // lekérdezés-szöveges link: az átirányítás az útra szól, nem írjuk át
      if (!target || parts[3] || !safeTarget(target)) {
        unmapped.push(path);
        return whole;
      }
      rewritten += 1;
      return `${head}${quote}${target}${parts[4] ?? ""}${quote}`;
    },
  );
  return { text, rewritten, unmapped };
}

type RulesDb = Pick<typeof prisma, "urlRedirect">;

/** Az AKTÍV szabályok egy lekérdezéssel: kisbetűs forrás-út -> cél. */
export async function loadOldShopLinkRules(
  db: RulesDb,
): Promise<OldShopLinkRules> {
  const rows = await db.urlRedirect.findMany({
    where: { isActive: true },
    select: { sourcePathLower: true, destinationPath: true },
  });
  return new Map(rows.map((r) => [r.sourcePathLower, r.destinationPath]));
}
