import type { ServiceJobStatus } from "@acropora/database";

/**
 * MELYIK ÁLLAPOTBÓL MELYIKBE LÉPHET EGY HIBAJEGY.
 *
 * A séma nyolc értéket sorol fel, sorrendet nem mond. Ez a tábla a MENET, amit
 * Balázs 2026-09-02-án jóváhagyott: bejön, megnézzük, időpontot kap,
 * kimegyünk, kész - közben megállhat alkatrészre vagy az ügyfélre várva.
 *
 * CSAK AZ VAN BENNE, AMI NÁLUNK ELŐFORDUL. Egy elméletileg teljes gráf minden
 * állapotot mindegyikbe engedne, és akkor a szabály nem védene semmit.
 *
 * A KÉT VÁRAKOZÓ ÁLLAPOT KIFELÉ MUTAT, és ezért marad külön: egyik sem a mi
 * mulasztásunk. Egy jegy, ami két hete áll, MÁST jelent, ha mi késünk, és
 * mást, ha alkatrészre vár - a kettőt egy „függőben" állapotba vonni azt
 * jelentené, hogy a legfontosabb kérdésre (kin múlik) nem tudunk válaszolni.
 *
 * ÉS A VISSZATÉRÉS BELŐLÜK NEM SIMA FOLYTATÁS: mire az alkatrész megjön vagy
 * az ügyfél válaszol, az EREDETI IDŐPONT MÁR ELMÚLT. Ezért enged a tábla
 * `SCHEDULED`-re is, nem csak `IN_PROGRESS`-re - az utóbbi akkor helyes, ha a
 * szerelő ott van, és a válasz azonnal megérkezett.
 *
 * A SÜRGŐS ESET KIHAGYJA A MÉRLEGELÉST: `NEW` -> `SCHEDULED` (Balázs,
 * 2026-09-02: „Igen előfordul"). Hogy KI hagyhatja ki, az jogosultsági kérdés,
 * és NEM ez a tábla dönti el - az átmenet és a feltétele két külön dolog. Egy
 * tábla, ami a kettőt összevonja, egy meg nem hozott döntést látszana
 * rögzíteni.
 *
 * A LEZÁRT ÉS AZ ELÁLLT VÉGÁLLAPOT. Nincs út vissza egyikből sem, és az indok
 * nem elvi: a lánc hibajegy -> munkalap -> teljesítési igazolás -> számla, és
 * egy újraélesztett jegyen nem lehetne megmondani, melyik munkalap melyik
 * körhöz tartozott - a számlázásnál ez visszamenőleg kétértelmű. Ha mégis kell
 * a munka, az ÚJ jegy, saját számmal: egy új jegy olcsóbb, mint egy
 * kétértelmű előzmény.
 */
const ALLOWED: Record<ServiceJobStatus, readonly ServiceJobStatus[]> = {
  NEW: ["TRIAGED", "SCHEDULED", "CANCELLED"],
  TRIAGED: [
    "SCHEDULED",
    "WAITING_FOR_PARTS",
    "WAITING_FOR_CUSTOMER",
    "CANCELLED",
  ],
  SCHEDULED: ["IN_PROGRESS", "WAITING_FOR_CUSTOMER", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "WAITING_FOR_PARTS", "WAITING_FOR_CUSTOMER"],
  WAITING_FOR_PARTS: ["SCHEDULED", "IN_PROGRESS", "CANCELLED"],
  WAITING_FOR_CUSTOMER: ["SCHEDULED", "IN_PROGRESS", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function allowedServiceJobSteps(
  from: ServiceJobStatus,
): readonly ServiceJobStatus[] {
  return ALLOWED[from]!;
}

export function isServiceJobStepAllowed(
  from: ServiceJobStatus,
  to: ServiceJobStatus,
): boolean {
  return ALLOWED[from]!.includes(to);
}

/**
 * Végállapot-e: nincs belőle lépés.
 *
 * SZÁMOLVA, NEM KÜLÖN FELSOROLVA. Egy második lista ugyanerről egyszer
 * elcsúszna a táblától, és akkor egy állapot egyszerre volna végleges és
 * továbbléptethető.
 */
export function isServiceJobFinished(status: ServiceJobStatus): boolean {
  return ALLOWED[status]!.length === 0;
}
