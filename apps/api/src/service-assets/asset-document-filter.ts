import type { Prisma } from "@acropora/database";

import {
  scopeVisibleDocumentTypes,
  type AssetDocumentTypeValue,
  type PartnerScope,
} from "../auth/partner-scope.util.js";

/**
 * VAN-E / NINCS-E ADOTT FAJTÁJÚ CSATOLMÁNY AZ ESZKÖZÖN (kártya 1277394e).
 *
 * A kiváltó eset (2026-10-06 14:53): Feri Sutyeráktól kérdezte, hány Astral
 * Pool szivattyúnak nincs kézikönyve. Sutyerák eszközönként nézte a
 * csatolmány-listát, és a 36-ból 3 után kifutott a keretéből; élesen egy
 * lekérdezéssel 6 jött ki. Ezzel egyetlen lapozott listahívás a válasz.
 *
 * `document` nélkül nincs feltétel. `documentType` nélkül BÁRMELY fajta számít.
 *
 * A PARTNER CSAK A NEKI LÁTHATÓ FAJTÁKAT SZÁMOLJA (`scopeVisibleDocumentTypes`):
 * egy számla vagy egy „egyéb” csatolmány neki nem létezik, tehát egy
 * „nincs számlája” szűrés sem árulhatja el, hogy van-e. Láthatatlan fajtára
 * kérdezve a „van” üres halmazt ad, a „nincs” mindent -- pontosan azt, amit a
 * listán látna.
 */
export function assetDocumentWhere(
  document: "with" | "without" | undefined,
  documentType: AssetDocumentTypeValue | undefined,
  scope: PartnerScope,
): Prisma.AssetWhereInput {
  if (!document) return {};
  const visible = scopeVisibleDocumentTypes(scope);
  const types = documentType
    ? visible.filter((type) => type === documentType)
    : visible;
  const some: Prisma.AssetDocumentWhereInput = { type: { in: types } };
  return document === "with"
    ? { documents: { some } }
    : { documents: { none: some } };
}
