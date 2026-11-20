/**
 * A SZÁMLÁN ÁLLÓ „FIZETVE” (Balázs, 2026-10-01 21:35 UTC, emlék 1994: a SimplePay felől is jelölni a kifizetettet; acrobot 58529, 58530). A SimplePay Zrt. havi díjszámlái
 * (E-P3/E-P4/E-P5-2026-..., 2618, 6895, 7305 Ft) fizetési módja „Fizetve”: a KIÁLLÍTÓ maga állítja, hogy a számla rendezett (a díjat a SimplePay az elszámolásból
 * vonja, nem bankból fizetjük). A Számlázz.hu nem küld kifizetési adatot (`paymentsKnown` hamis), a banki terhelés nincs és nem is lehet, ezért a számla örökre
 * „nincs fizetve” maradt.
 *
 * MÉRVE (acrobot futtatta, 2026-11-20, a bejövő számlák fizetési mód szerinti eloszlása): a „Fizetve” CSAK ezen a három soron áll, máshol sehol; az átutalás
 * (79), a készpénz (12), a bankkártya (21) és az üres (146) más mód.
 *
 * SZABÁLY, SZŰKEN: a fizetési mód PONTOSAN „Fizetve” (ékezet, kisbetű, szóköz és írásjel nélkül mérve), a Számlázz.hu NEM ismer fizetést (`paymentsKnown` hamis), és a
 * sor feed-sor (a postafiókos és a beszerzésből jött soré nem). Ha a Számlázz.hu ismer fizetést (akár nullát), az ő nyilvántartása nyer, mint a többi jelölésnél.
 * A kifizetés NAPJA nem ismert, ezért nincs: nem találgatunk.
 */
export interface IssuerPaidRow {
  readonly source: string;
  readonly paymentsKnown: boolean | null;
  readonly paymentMethod: string | null;
}

const normalized = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");

export function isIssuerPaid(row: IssuerPaidRow): boolean {
  return (
    row.source !== "MAILBOX" &&
    row.source !== "PURCHASE" &&
    !row.paymentsKnown &&
    row.paymentMethod !== null &&
    normalized(row.paymentMethod) === "fizetve"
  );
}
