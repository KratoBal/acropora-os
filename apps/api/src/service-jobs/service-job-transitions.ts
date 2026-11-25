import type { ServiceJobStatus } from "@acropora/database";

/**
 * MELYIK ÁLLAPOTBÓL MELYIKBE LÉPHET EGY HIBAJEGY.
 *
 * A séma nyolc értéket sorol fel, sorrendet nem mond. Ez a tábla a MENET: a
 * 2026-09-02-i (bejön, megnézzük, időpontot kap, kimegyünk, kész) a közös
 * állapot-lista óta rövidebb, lásd lent. Közben megállhat alkatrészre vagy az
 * ügyfélre várva.
 *
 * CSAK AZ VAN BENNE, AMI NÁLUNK ELŐFORDUL. Egy elméletileg teljes gráf minden
 * állapotot mindegyikbe engedne, és akkor a szabály nem védene semmit.
 *
 * A KÉT VÁRAKOZÓ ÁLLAPOT KIFELÉ MUTAT, és ezért marad külön: egyik sem a mi
 * mulasztásunk. Egy jegy, ami két hete áll, MÁST jelent, ha mi késünk, és
 * mást, ha alkatrészre vár - a kettőt egy „függőben" állapotba vonni azt
 * jelentené, hogy a legfontosabb kérdésre (kin múlik) nem tudunk válaszolni.
 *
 * A VISSZATÉRÉS BELŐLÜK 2026-11-25-ig `SCHEDULED`-re is mehetett (az eredeti
 * időpont addigra elmúlt). Azóta a Folyamatban a cél, és az új időpont a
 * `scheduledAt` dátuma: az időpont adat, nem állapot.
 *
 * A LEZÁRT ÉS AZ ELÁLLT VÉGÁLLAPOT. Nincs út vissza egyikből sem, és az indok
 * nem elvi: a lánc hibajegy -> munkalap -> teljesítési igazolás -> számla, és
 * egy újraélesztett jegyen nem lehetne megmondani, melyik munkalap melyik
 * körhöz tartozott - a számlázásnál ez visszamenőleg kétértelmű. Ha mégis kell
 * a munka, az ÚJ jegy, saját számmal: egy új jegy olcsóbb, mint egy
 * kétértelmű előzmény.
 *
 * === A KÖZÖS ÁLLAPOT-LISTA ÓTA (2026-11-25) ===
 *
 * Balázs döntése, 2026-11-25 18:08:02 UTC (msg 1575211476678082741, kártya
 * 7f23785c): a hibajegy és a munkalap ugyanazt az öt állapotot mutatja (Új,
 * Folyamatban, Vár valamire, Elkészült, Lezárt; `@acropora/types`
 * `common-service-status.ts`). A Felmérve és az Ütemezve ebben nincs: a
 * felmérés lépése kivezetve, az időpont a `scheduledAt` dátuma, nem állapot.
 * Ezért a TRIAGED és a SCHEDULED NEM CÉL többé, és az Új jegyből egyenesen a
 * Folyamatban (vagy egy várakozás) következik.
 *
 * AZ ENUM NEM VÁLTOZIK (terv 4. pont): a `ServiceJobEvent` előzménye ezeken az
 * értékeken áll, és a régi mobil buildek a nyolc értéket kézzel hordják. A
 * meglévő TRIAGED és SCHEDULED jegyek ugyanoda léphetnek tovább, ahova egy Új.
 *
 * A KÉT VÁRAKOZÁS EGYMÁS KÖZT IS ÁTJÁRHATÓ: az alkatrész megjött, de most az
 * ügyfél nem elérhető, és fordítva. Eddig ez egy kerülőt kért egy
 * köztes állapoton át, ami a naplóban hamis lépésként maradt meg.
 *
 * FOLYAMATBAN JEGY NEM HIÚSULHAT MEG KÖZVETLENÜL (ahogy eddig sem): ez
 * üzemeltetési kérdés, nem a listáé, és a terv kihagyta.
 */
const ALLOWED: Record<ServiceJobStatus, readonly ServiceJobStatus[]> = {
  NEW: [
    "IN_PROGRESS",
    "WAITING_FOR_PARTS",
    "WAITING_FOR_CUSTOMER",
    "CANCELLED",
  ],
  TRIAGED: [
    "IN_PROGRESS",
    "WAITING_FOR_PARTS",
    "WAITING_FOR_CUSTOMER",
    "CANCELLED",
  ],
  SCHEDULED: [
    "IN_PROGRESS",
    "WAITING_FOR_PARTS",
    "WAITING_FOR_CUSTOMER",
    "CANCELLED",
  ],
  IN_PROGRESS: ["COMPLETED", "WAITING_FOR_PARTS", "WAITING_FOR_CUSTOMER"],
  WAITING_FOR_PARTS: ["IN_PROGRESS", "WAITING_FOR_CUSTOMER", "CANCELLED"],
  WAITING_FOR_CUSTOMER: ["IN_PROGRESS", "WAITING_FOR_PARTS", "CANCELLED"],
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
