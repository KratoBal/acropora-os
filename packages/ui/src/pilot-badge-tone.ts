import type { ServiceJobPartnerStatus } from "@acropora/types";
import { partnerStatusTone } from "@acropora/types";

import type { ServiceTone } from "./service-theme";
import type { PilotBadgeVariant } from "./pilot-ui";

/**
 * A KÖZÖS TONE -> PILOT VARIANS LEKÉPEZÉS -- ACROBOT DÖNTÉSE, 2026-09-25
 * (Partner Portál Figma-kör, msg 23529).
 *
 * A `partnerStatusTone`/`worksheetStatusTone`/`assetStatusTone` mindegyike a
 * hatértékű `ServiceTone`-t adja (`neutral`/`purple`/`green`/`amber`/`red`/
 * `blue`), a `PilotBadge` viszont MÁS néven és MÁS fedéssel ismeri a saját
 * variánsait (`teal`/`grey`/`amber`/`blue`/`danger`/`default`). A Make-terv
 * (`PartnerPortalScreen.tsx:159-204`) öt statusz-színt használ szándékosan
 * (teal, grey, amber, red, blue) -- a violet/lila csak a "Javaslat/Új"
 * jelölésre van fenntartva, sosem statuszra --, EZÉRT NEM kap a `PilotBadge`
 * új színt: a hiányzó `purple`/`green`/`neutral` a MEGLÉVŐ öt variánsra
 * képződik le, ez az ALAPSZABÁLY:
 *
 *   green   -> teal    (pozitív/lezárt-jó allapot, lasd worksheetBadge "Aláírva")
 *   purple  -> blue    (a "purple" a regi rendszerben csak a partnerStatusTone
 *                        IN_PROGRESS-jenek sajat szine volt, nem onallo terv-szin)
 *   amber   -> amber   (nev szerint azonos)
 *   red     -> danger  (a PilotBadge variansneve "danger", nem "red")
 *   blue    -> blue    (nev szerint azonos)
 *   neutral -> default (a PilotBadge nem ismer kulon "neutral"-t, a "default"
 *                        UGYANAZT a szurke tokent adja, mint a "grey")
 *
 * EZ A FÜGGVÉNY CSAK AZ ALAPSZABÁLYT ADJA. Ahol egy tone-készleten belül két
 * KÜLÖNBÖZŐ állapot ettől ugyanazt a variánst kapná (mert az eredeti
 * hatértékű készlet két állapotnak SZÁNDÉKOSAN külön tónust adott, lásd az
 * adott `*StatusTone` fejlécét), ott NEM ezt kell hívni -- lásd lejjebb
 * `partnerStatusBadgeVariant`-ot a konkrét kivételre.
 */
export function pilotBadgeVariantForTone(tone: ServiceTone): PilotBadgeVariant {
  switch (tone) {
    case "green":
      return "teal";
    case "purple":
      return "blue";
    case "amber":
      return "amber";
    case "red":
      return "danger";
    case "blue":
      return "blue";
    case "neutral":
      return "default";
  }
}

/**
 * A JEGY-ÁLLAPOT (`ServiceJobPartnerStatus`) KIVÉTELE.
 *
 * A `partnerStatusTone` a négy állapotnak (NEW/IN_PROGRESS/COMPLETED/CLOSED)
 * SZÁNDÉKOSAN négy KÜLÖNBÖZŐ tónust ad (blue/purple/green/neutral -- lásd
 * `service-job-management.ts` `PARTNER_STATUS_TONE` fejlécét: "a nyolc
 * allapotanak a tobbsegi hangulatat kovetik"). A fenti alapszabály viszont
 * `purple`-t is `blue`-ra képezné, ami itt ÜTKÖZNE a NEW saját kékjével --
 * a négy közül kettő ugyanazt a színt kapná, holott a rendszer mind a
 * négyet szándékosan megkülönbözteti.
 *
 * KIVÉTEL (acrobot döntése, msg 23529, PR #1115): az IN_PROGRESS a
 * `deviceBadge` "Javítás alatt" -> amber mintáját kapja a `purple` -> `blue`
 * alapszabály helyett -- ezzel mind a négy jegy-állapot külön pilot variánst
 * kap: NEW=blue, IN_PROGRESS=amber, COMPLETED=teal, CLOSED=default.
 */
export function partnerStatusBadgeVariant(
  status: ServiceJobPartnerStatus,
): PilotBadgeVariant {
  if (status === "IN_PROGRESS") return "amber";
  return pilotBadgeVariantForTone(partnerStatusTone(status));
}
