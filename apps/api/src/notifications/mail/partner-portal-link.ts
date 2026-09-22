/**
 * A MUNKALAP LINKJE A PARTNER-PORTALON -- TISZTA FUGGVENYBEN.
 *
 * === MIERT NEM A `ticket-link.ts` `internalTicketLink`-JE ===
 *
 * Az a fuggveny a BELSO feluletre mutat (`WEB_URL` + `/szerviz/hibajegyek`).
 * A munkalap alairasra kuldese a PARTNER sajat portaljara viszi a cimzettet
 * (`apps/partner/src/app/(portal)/munkalapok/[id]/page.tsx`), ami egy
 * KULON alkalmazas, kulon eredettel. Egy kozos fuggveny ket kulon alap-URL-t
 * es ket kulon utvonal-mintat rejtene el egymas mogott.
 *
 * === MIERT NEM UTKOZIK ACROBOT 00:57-ES DONTESEBE ===
 *
 * Az a dontes egy MASIK levelre (az atadasi/kezelo-irta levelre) es egy
 * MASIK linkfajtara (dokumentum-letoltes) vonatkozott, olyan vegpontra, amit
 * a partner-portal nem hiv. Ez a link a partner SAJAT, MAR LETEZO
 * bejelentkezett feluletere mutat, ahol az alairo felulete mar all
 * (`worksheet-detail.tsx`, alairo-valasztoval es kod-mezovel).
 *
 * === MIERT URES STRING, HA A `PARTNER_URL` HIANYZIK ===
 *
 * Ugyanaz a szabaly, mint a `internalTicketLink`-nel: a hianyzo link nem
 * allithatja meg a kuldest. A `PARTNER_URL` UJ kornyezeti valtozo -- a
 * `WEB_URL`-lel ellentetben ez MEG NINCS beallitva sehol (mert eddig semmi
 * nem hivatkozott ra), tehat elesben az ELSO bekapcsolasig ez a valtozo
 * URESEN fog megjelenni a levelben, es ezt a kartyan is jelezni kell.
 */
export function partnerWorksheetLink(input: {
  readonly partnerUrl: string | undefined;
  readonly worksheetId: string;
}): string {
  const alap = input.partnerUrl?.trim();
  if (!alap) return "";
  return `${alap.replace(/\/+$/, "")}/munkalapok/${input.worksheetId}`;
}
