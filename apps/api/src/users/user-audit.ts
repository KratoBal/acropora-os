/**
 * MI KERUL AZ AUDITNAPLOBA EGY FELHASZNALO-MODOSITASNAL.
 *
 * === MIERT KULON, TISZTA FUGGVENY ===
 *
 * A repository a Prisma klienst importalja, tehat barmi, ami ott all, csak elo
 * adatbazissal merheto -- es a felhasznaloi modositas naplozasa NEM
 * adatbazis-kerdes, hanem dontes: mit ir le a nyom, es mit hagy ki.
 *
 * === A KET ALAK, ES MIERT NEM UGYANAZ ===
 *
 * Minden mezot a NEVEVEL naplozunk (`changedFields`), es egy becenevnel ez
 * eleg: az erteke nem ad jogot senkinek.
 *
 * A `customerId` MAS FAJTA. Abbol szamolja a `partnerScopeOf`, hogy az illeto
 * mit lat: aki kap egy vevot, az annak a vevonek a sorait latja es csak azokat;
 * aki elveszti, az BELSOSSE valik es MINDENT lat. Egy "customerId megvaltozott"
 * bejegyzes epp arra a kerdesre nem valaszol, amiert az auditnaplot kinyitjak:
 * MELYIK vevorol MELYIKRE, es kulonosen azt, hogy a kotes MEGSZUNT-e.
 *
 * AZ ASZIMMETRIA SZANDEKOS, ES KIMONDOM: a `role` mezonek ma UGYANEZ a
 * gyengesege, es ez a valtozas NEM javitja meg. Minden mezo elotti-utani
 * ertekenek naplozasa kulon dontes, sajat indokkal. Ami viszont NEM
 * elfogadhato: egy JOGOT ADO mezot a vekonyabb alakkal felvenni, es
 * kovetkezetesnek nevezni.
 */

/**
 * `type`, ES NEM `interface` -- ES EZ NEM STILUS.
 *
 * A napló mezoje a Prisma `JsonObject` tipusat varja, aminek INDEX-SZIGNATURAJA
 * van. A TypeScript egy `type` alias objektum-alakjahoz ad implicit
 * index-szignaturat, egy `interface`-hez NEM (az utolag bovithetо, tehat a
 * fordito nem tudja garantalni, hogy minden kulcsa JSON marad).
 *
 * A kezenfekvo megoldas egy `as Prisma.JsonObject` kaszt lett volna. Az
 * ugyanazt a kenyelmet adja, es ugyanazt veszi el: a fordito tobbe nem
 * mondana meg, ha a naplo alakja elcsuszik attol, amit a Prisma elfogad.
 */
export type UserAuditMetadata = {
  changedFields: string[];
  customerId?: { from: string | null; to: string | null };
};

/**
 * A NAPLO-BEJEGYZES EGY MODOSITASHOZ.
 *
 * A `changedFields` a beerkezett mezok neve, az `expectedUpdatedAt` NELKUL: az
 * a versenyhelyzet-vedelem parametere, nem valtoztatott mezo. Ha bekerulne,
 * MINDEN modositas ugy nezne ki, mintha valtoztatott volna rajta valamit.
 *
 * A `customerId` elotti-utani erteke CSAK akkor kerul be, ha a hivo egyaltalan
 * KULDTE a mezot. Enelkul minden modositas azt allitana, hogy a kotes
 * "valtozott null-rol null-ra" -- egy nyom, ami minden soron ott van, ugyanannyit
 * mond, mint a semmi.
 */
export function userAuditMetadata(input: {
  fields: Record<string, unknown>;
  before: { customerId: string | null };
  after: { customerId: string | null };
}): UserAuditMetadata {
  const changedFields = Object.keys(input.fields).filter(
    (key) => key !== "expectedUpdatedAt",
  );
  if (input.fields.customerId === undefined) return { changedFields };
  return {
    changedFields,
    customerId: { from: input.before.customerId, to: input.after.customerId },
  };
}
