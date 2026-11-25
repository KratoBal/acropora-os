import {
  worksheetsBlockingPackage,
  type BlockingPackageWorksheet,
  type PackageWorksheetState,
} from "../common/worksheet-signature-gate.js";

/**
 * A KARBANTARTÁSI CSOMAG KAPUJA -- UGYANAZ A SORREND, MINT A HIBAJEGYNÉL
 * (`ServiceJobPackageService.download()`): a KAPU a csomag összeállítása
 * ELŐTT fusson, hogy hiányos állapotban egyetlen PDF se készüljön el
 * feleslegesen.
 *
 * Acrobot döntése (2026-09-24, kanban 679d4c04 utáni "3.5" szelet):
 *
 *   „A kapu ELŐSZÖR fusson, mint a hibajegynél: aláírt teljesítési igazolás
 *    nélkül és számla nélkül a KÜLDÉS elutasít, egyértelmű okkal. A csomag
 *    LETÖLTÉSE számla nélkül mehet (belső ellenőrzéshez), a kiküldés nem."
 *
 * === A LETÖLTÉS KAPUJA 2026-11-18 14:43 UTC ÓTA CSAK A MUNKALAPOKAT KÉRI (Luca) ===
 *
 * Az eredeti értelmezés (az aláírt igazolás MINDKÉT műveletnél kell, csak a számla különbözteti meg a kettőt) ezzel elavult. Luca szó szerint (közös szál, msg
 * 1572623199433269353): „ha le akarom tölteni a csomagot akkor tudjam letölteni. ne legyenek feltételek. egy feltétel maradjon, hogy a munkalap legyen lezárva.” Ezért a
 * LETÖLTÉS (`purpose === "download"`) a teljesítési igazolást nem kéri, se kiállítva, se aláírva: a csomagba bekerül, ha van (az aláírt PDF, ennek hiányában a kiállított).
 * A lezárt, de kiadott példány nélküli munkalap (adathiba) a letöltésnél is hiba marad. A KIKÜLDÉS (`send`) kapuja VÁLTOZATLAN: igazolás, annak aláírt példánya és számla
 * kell hozzá (arról Luca nem döntött).
 */
export type MaintenancePackageJobBlockReason =
  "no-certificate" | "certificate-not-signed" | "no-invoice";

export interface MaintenancePackageBlockers {
  worksheets: readonly BlockingPackageWorksheet[];
  /**
   * A HOZZÁRENDELT (KAPCSOLÓDÓ) MUNKALAPOK (Luca, 2026-11-25, kártya 5afb868a): a csomagba a kiadott PDF-jük kerül, ezért ugyanaz a
   * kapu áll rájuk (lezárt és kiadott példányos), de a mondat más, mert a teendő más: a hozzárendelt lap nem ide tartozik, tehát
   * nem "vedd le a lapról", hanem "zárd le, vagy vedd le a kapcsolatot".
   */
  linkedWorksheets: readonly BlockingPackageWorksheet[];
  job: readonly MaintenancePackageJobBlockReason[];
}

export function maintenancePackageBlockers(input: {
  worksheets: readonly PackageWorksheetState[];
  /** Hiányában nincs hozzárendelt lap (a régi hívók és tesztek változatlanok). */
  linkedWorksheets?: readonly PackageWorksheetState[];
  hasCertificate: boolean;
  certificateSigned: boolean;
  /**
   * MINDIG `false`, AMÍG A 4. SZELET (SZÁMLA) EL NEM KÉSZÜL -- nincs modell,
   * nincs kiállítás, tehát a csomagban erre a helyre ma soha nem kerülhet
   * tartalom. Lásd a modul saját `maintenanceInvoicePresent` helyét lent.
   */
  invoicePresent: boolean;
  purpose: "download" | "send";
}): MaintenancePackageBlockers {
  const worksheets = worksheetsBlockingPackage({
    worksheets: input.worksheets,
    /*
      EZ A FUNKCIÓ MINDIG "internal" HATÓKÖRREL FUT: a karbantartási csomag
      végpontja `PARTNERS_MANAGE`-hez van kötve, amit a `SERVICE` szerepkör
      (a technikus) NEM visel -- lásd a controller fejlécét. A "partner"
      hatókör (rejtett lapok kihagyása) itt ezért értelmezhetetlen bemenet
      volna, nem csak felesleges.
    */
    scope: "internal",
  });

  const linkedWorksheets = worksheetsBlockingPackage({
    worksheets: input.linkedWorksheets ?? [],
    scope: "internal",
  });

  const job: MaintenancePackageJobBlockReason[] = [];
  if (input.purpose === "send") {
    if (!input.hasCertificate) job.push("no-certificate");
    else if (!input.certificateSigned) job.push("certificate-not-signed");
    if (!input.invoicePresent) job.push("no-invoice");
  }

  return { worksheets, linkedWorksheets, job };
}

export function maintenancePackageIsBlocked(
  blockers: MaintenancePackageBlockers,
): boolean {
  return (
    blockers.worksheets.length > 0 ||
    blockers.linkedWorksheets.length > 0 ||
    blockers.job.length > 0
  );
}

/**
 * A VISSZATARTÁS MONDATA -- MINDEN OK EGYSZERRE, EGY MONDATBAN.
 *
 * Ugyanaz az elv, mint a hibajegyes `csomagHiba`-ban: több feltétel esetén a
 * kezelő egy körben csak az elsőt javítaná, aztán visszajönne a másodikra.
 */
export function maintenancePackageBlockMessage(
  blockers: MaintenancePackageBlockers,
): string {
  const nev = (sheet: PackageWorksheetState): string => {
    const alap =
      sheet.number ??
      (sheet.subject
        ? `„${sheet.subject}” (piszkozat)`
        : "szám nélküli munkalap");
    return sheet.hidden ? `${alap} (rejtett)` : alap;
  };
  const nevekAhol = (ok: "not-closed" | "no-issued-sheet"): string =>
    blockers.worksheets
      .filter((tetel) => tetel.reason === ok)
      .map((tetel) => nev(tetel.sheet))
      .join(", ");

  const kapcsolodoNevekAhol = (ok: "not-closed" | "no-issued-sheet"): string =>
    blockers.linkedWorksheets
      .filter((tetel) => tetel.reason === ok)
      .map((tetel) => nev(tetel.sheet))
      .join(", ");

  const reszek: string[] = [];
  const lezaratlan = nevekAhol("not-closed");
  if (lezaratlan)
    reszek.push(
      `Nincs lezárva: ${lezaratlan}. Zárd le a lapot, vagy ha nem ide tartozik, vedd le a karbantartási lapról.`,
    );
  const peldanytalan = nevekAhol("no-issued-sheet");
  if (peldanytalan)
    reszek.push(
      `Le van zárva, de a kiadott munkalap hiányzik: ${peldanytalan}. ` +
        "Ezt lezárással nem lehet pótolni, szólj a fejlesztésnek.",
    );
  const kapcsolodoLezaratlan = kapcsolodoNevekAhol("not-closed");
  if (kapcsolodoLezaratlan)
    reszek.push(
      `A hozzárendelt munkalap nincs lezárva: ${kapcsolodoLezaratlan}. Zárd le, vagy vedd le a kapcsolatot a karbantartási lapról.`,
    );
  const kapcsolodoPeldanytalan = kapcsolodoNevekAhol("no-issued-sheet");
  if (kapcsolodoPeldanytalan)
    reszek.push(
      `A hozzárendelt munkalap le van zárva, de a kiadott példánya hiányzik: ${kapcsolodoPeldanytalan}. ` +
        "Ezt lezárással nem lehet pótolni, szólj a fejlesztésnek.",
    );
  if (blockers.job.includes("no-certificate"))
    reszek.push("Nincs kiállítva teljesítési igazolás.");
  if (blockers.job.includes("certificate-not-signed"))
    reszek.push(
      "A teljesítési igazolás ki van állítva, de az aláírt példánya hiányzik.",
    );
  if (blockers.job.includes("no-invoice"))
    reszek.push("Nincs kiállítva számla.");

  return [
    "A karbantartási lap dokumentumcsomagja nem adható át, amíg ezek nincsenek rendben.",
    ...reszek,
  ].join(" ");
}
