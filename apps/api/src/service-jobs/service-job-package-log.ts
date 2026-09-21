import { partnerStatusLabel } from "./service-job-status.js";
import type { ServiceJobStatus } from "@acropora/database";

/**
 * A DOKUMENTUMCSOMAG NAPLOSORA -- ES AMI KIMARAD BELOLE A PARTNERNEK.
 *
 * === BALAZS DONTESE, 2026-09-21 10:5x UTC (Discord) ===
 *
 * Ket mondat: "a megjegyzes nem kell a nev igen", majd "keruljon ki onnan is".
 * Az elso a partnerportal naplosorarol szolt, a MASODIK errol a PDF-rol.
 *
 * === A NEV MARAD, ES EZT KULON KIMONDTA ===
 *
 * Nem az egesz sor tunik el, hanem a MEGJEGYZES. Az allapot partneri felirata
 * es a rogzito kollega neve tovabbra is ott all.
 *
 * === MIERT PARAMETER VALASZTJA SZET A KET OLVASOT ===
 *
 * Ugyanez a szolgaltatas fut a BELSO olvasonak is. A belso csomagban a
 * megjegyzes TOVABBRA IS jar -- es ha a kulonbseget az dontene el, hogy melyik
 * hivo felejti el atadni, akkor egy kesobbi "egyszerusites" csendben mind a
 * kettobol kivenne. A `belso` kapcsolo KOTELEZO, tehat a hivonak alkalmanként
 * ki kell mondania, kinek keszul a csomag.
 */
export interface JegyNaploBejegyzes {
  at: Date;
  text: string;
  authorName: string | null;
}

export function jegyNaploSora(input: {
  at: Date;
  toStatus: ServiceJobStatus | null;
  note: string | null;
  authorName: string | null;
  /** IGAZ, ha a csomag a MI olvasonknak keszul. Kotelezo, lasd a fejlecet. */
  belso: boolean;
}): JegyNaploBejegyzes {
  const allapot = input.toStatus
    ? partnerStatusLabel(input.toStatus)
    : "nincs megadva";
  /*
    A MEGJEGYZES CSAK A BELSO CSOMAGBA KERUL. A `null` es az ures szoveg
    ugyanugy viselkedik, mint eddig: nem hagy maga utan egy logo gondolatjelet.
  */
  const megjegyzes = input.belso && input.note ? ` — ${input.note}` : "";
  return {
    at: input.at,
    text: `Állapot módosítva: ${allapot}${megjegyzes}`,
    authorName: input.authorName,
  };
}
