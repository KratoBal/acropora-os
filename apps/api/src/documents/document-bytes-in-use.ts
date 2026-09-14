import { prisma } from "@acropora/database";

/**
 * A FELHASZNALT HELY, EGY HELYEN OSSZEGEZVE.
 *
 * === MIERT KOZOS FUGGVENY, ES MIERT NEM HAROM REPOSITORY-METODUS ===
 *
 * A keret EGY KOTETROL szol, tehat mindharom dokumentum-tablat ugyanannak az
 * osszegnek kell tartalmaznia. 2026-09-14-ig ez az osszeg KET helyen allt
 * (`service-assets.repository.ts` es `worksheets.repository.ts`), ugyanazzal a
 * ket taggal -- es a harmadik gazda (a hibajegy) felvetelekor MINDKETTOT
 * boviteni kellett volna. Ha az egyik lemarad, a hiba NEMA: az az ut a sajat,
 * kisebb osszeget latja a hatar alatt, es a keret CSENDBEN lepodik at.
 *
 * Ez pontosan az az alak, amit a `document-intake.ts` fejlece mar egyszer
 * megnevez a feltoltesi szabalyokra: egy szabaly ket helyen egyszer
 * szetcsuszik. A szam ugyanaz a fajta szabaly.
 *
 * === AMI EBBOL NEM KOVETKEZIK ===
 *
 * A fuggveny nem mondja meg, MEKKORA a keret -- azt a `document-quota.ts`
 * dontesi fuggvenye tudja. Ez csak a FELHASZNALT oldal, es szandekosan nem
 * tobb: a ket kerdes kulon romolhat el.
 */
export async function sumDocumentBytesInUse(): Promise<number> {
  const [eszkoz, munkalap, hibajegy] = await Promise.all([
    prisma.assetDocument.aggregate({ _sum: { sizeBytes: true } }),
    prisma.worksheetDocument.aggregate({ _sum: { sizeBytes: true } }),
    prisma.serviceJobDocument.aggregate({ _sum: { sizeBytes: true } }),
  ]);
  return (
    (eszkoz._sum.sizeBytes ?? 0) +
    (munkalap._sum.sizeBytes ?? 0) +
    (hibajegy._sum.sizeBytes ?? 0)
  );
}
