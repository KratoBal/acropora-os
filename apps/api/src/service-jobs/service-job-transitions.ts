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

/**
 * MELYIK LEPESHEZ KELL INDOK.
 *
 * KULON ALL A TABLATOL, ES EZ UGYANAZ A MEGKULONBOZTETES, amit a tabla mar
 * kimond a jogosultsagrol: az ATMENET azt mondja meg, mi MEHET, ez pedig azt,
 * mi KELL HOZZA. Egy tabla, ami a kettot osszevonja, ket kulonbozo dontest
 * rogzitene egy helyen.
 *
 * A CEL-ALLAPOTHOZ KOTVE, NEM A PARHOZ. A tabla tizenkilenc atmenetet enged;
 * parra kotve tizenkilenc dontes lenne, celra nyolc. Es az indok mindig a
 * CELROL szol (miert alltunk el, mire varunk), nem arrol, honnan jottunk.
 *
 * A HAROM ALLAPOT, ES MIERT EPP EZ A HAROM:
 *
 *   CANCELLED             vegallapot, nincs visszaut, es SEMMI MAS nem hordozza
 *                         az okot. Ha most nem irjak le, miert nem lett belole
 *                         munka, azt kesobb senki nem tudja megmondani.
 *   WAITING_FOR_PARTS     a tabla sajat kommentje adja az ervet: egy jegy, ami
 *   WAITING_FOR_CUSTOMER  ket hete all, MAST jelent, ha mi kesunk, es mast, ha
 *                         alkatreszre var. A "kin mulik" kerdesre a jegyen ez az
 *                         EGYETLEN hely, ahol valasz all.
 *
 * A RENDES MENET VEGIG SZABAD: a NEW, TRIAGED, SCHEDULED, IN_PROGRESS,
 * COMPLETED lanc negy lepese kozul EGYIK SEM koveteli meg. Aki a jegyet a
 * szokasos uton viszi vegig, soha nem kell szoveget irjon -- a kovetelmeny
 * pontosan akkor csap le, amikor a jegy KILEP a rendes menetbol.
 *
 * MIERT A SZERVEREN, ES NEM CSAK A KEPERNYON: kulonben a szabaly ket helyen
 * elne, es csak az egyik javulna. A kepernyo elrejtheti a gombot, de a
 * vegpont az, ami nem engedi at.
 *
 * ES MIERT KOTELEZO, HOLOTT SURLODAST OKOZ: a ket tevedes ara nem egyforma. Egy
 * folosleges kovetelmeny HANGOS (valaki szol, hogy nem tud lepni), egy hianyzo
 * indok NEMA -- a jegy tortenetebol hianyzik, es azt senki nem fogja keresni.
 */
const NOTE_REQUIRED: ReadonlySet<ServiceJobStatus> = new Set([
  "CANCELLED",
  "WAITING_FOR_PARTS",
  "WAITING_FOR_CUSTOMER",
]);

export function serviceJobStepRequiresNote(to: ServiceJobStatus): boolean {
  return NOTE_REQUIRED.has(to);
}

/**
 * A HAROM ESET HAROM KULONBOZO MONDATOT KAP, MERT HAROM KULONBOZO DOLGOT KELL
 * LEIRNI. Egy kozos "add meg az indokot" mindharomra ranezne, es egyikre sem
 * mondana meg, MIT irjon oda a felhasznalo.
 */
export const SERVICE_JOB_NOTE_REQUIRED_MESSAGES: Record<string, string> = {
  CANCELLED:
    "Az elállás indoka kötelező: írd le, miért nem lesz ebből munka. A lezárt jegyre nincs visszaút, és később ez az egyetlen nyoma.",
  WAITING_FOR_PARTS:
    "Írd le, mire várunk: milyen alkatrész, honnan, mikorra. Enélkül két hét múlva senki nem tudja, min múlik a jegy.",
  WAITING_FOR_CUSTOMER:
    "Írd le, kire és mire várunk: mit kérdeztünk az ügyféltől, és mikor. Enélkül két hét múlva senki nem tudja, min múlik a jegy.",
};
