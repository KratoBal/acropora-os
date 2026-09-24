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
 * === AZ ÉRTELMEZÉS, KIMONDVA (mert a mondat két feltételt egy mondatba von
 * össze `SEND`-hez, de csak az egyiket nevezi meg letöltésnél kivételként) ===
 *
 * A mondat SZÁMLA NÉLKÜL menti fel a letöltést -- az ALÁÍRT IGAZOLÁS
 * követelményét nem nevezi meg kivételként. Ebből az következik, hogy az
 * aláírt igazolás MINDKÉT műveletnél kell (ugyanúgy, ahogy a munkalapok
 * lezárt/kiadott állapota is mindkettőnél kell -- azt a hibajegyes minta
 * sem engedi el letöltésnél), és EGYEDÜL a számla az, ami a kettőt
 * megkülönbözteti. Ha ez az értelmezés téves, egyetlen sor változik:
 * a `purpose === "send"` feltétel a `certificate` ágakra is kiterjed.
 */
export type MaintenancePackageJobBlockReason =
  "no-certificate" | "certificate-not-signed" | "no-invoice";

export interface MaintenancePackageBlockers {
  worksheets: readonly BlockingPackageWorksheet[];
  job: readonly MaintenancePackageJobBlockReason[];
}

export function maintenancePackageBlockers(input: {
  worksheets: readonly PackageWorksheetState[];
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

  const job: MaintenancePackageJobBlockReason[] = [];
  if (!input.hasCertificate) job.push("no-certificate");
  else if (!input.certificateSigned) job.push("certificate-not-signed");
  if (input.purpose === "send" && !input.invoicePresent) job.push("no-invoice");

  return { worksheets, job };
}

export function maintenancePackageIsBlocked(
  blockers: MaintenancePackageBlockers,
): boolean {
  return blockers.worksheets.length > 0 || blockers.job.length > 0;
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
    const alap = sheet.number ?? "szám nélküli munkalap";
    return sheet.hidden ? `${alap} (rejtett)` : alap;
  };
  const nevekAhol = (ok: "not-closed" | "no-issued-sheet"): string =>
    blockers.worksheets
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
