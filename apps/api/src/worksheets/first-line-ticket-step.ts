import type { Prisma, ServiceJobStatus } from "@acropora/database";

/**
 * AZ ELSŐ TÉTELSOR A HIBAJEGYET FOLYAMATBAN ÁLLAPOTBA LÉPTETI.
 *
 * Balázs kérése, 2026-09-30 12:29:29 UTC (fő csatorna, message_id
 * 1554832557252542506): „ha a munkalapoknál felkerül az első tételsor, akkor
 * kerüljön Folyamatban állapotba. Ezt lássuk mi és az ügyfél is." A hatókör
 * acrobot döntése, ugyanaznap: CSAK `NEW`, `TRIAGED` és `SCHEDULED` állapotból;
 * a várakozó, a kész és az elállt jegyhez nem nyúl.
 *
 * === EZ A TÁBLÁN KÍVÜLI LÉPÉS, ÉS EZT KI KELL MONDANI ===
 *
 * A kézi léptetés táblája (`service-job-transitions.ts`) 2026-11-25-ig
 * `NEW`-ból és `TRIAGED`-ből NEM engedett közvetlenül `IN_PROGRESS`-be; a
 * közös állapot-lista óta enged. Ez a lépés ettől függetlenül nem a táblán
 * megy: nem egy ember választ lépést, hanem a munka maga mutatja, hogy
 * elkezdődött -- a tételsor a munka bizonyítéka. Ez a függvény a táblát nem
 * hívja, és nem is lazítja.
 *
 * === AMI NEM TÖRTÉNIK, ÉS SZÁNDÉKOSAN ===
 *
 * - ÉRTESÍTÉS NEM MEGY. Ma egyetlen állapotlépés sem küld semmit (a kézi sem),
 *   és ezt a kérés kifejezetten így kérte: ha küldene, jelezni kell, nem
 *   bekapcsolni.
 * - A `startedAt` NEM ÍRÓDIK: ma semmi nem írja (lásd a `service-jobs.service`
 *   jegyzetét), egy második író egyetlen tényre néma elcsúszást hozna.
 */
export const FIRST_LINE_ADVANCES_FROM: readonly ServiceJobStatus[] = [
  "NEW",
  "TRIAGED",
  "SCHEDULED",
];

/** A naplósor megjegyzése: a belső naplóban látszik, hogy nem ember léptette. */
export const FIRST_LINE_STEP_NOTE =
  "Automatikus lépés: felkerült az első tételsor a munkalapra.";

/** A cél-állapot, vagy `null`, ha ebből az állapotból a szabály nem léptet. */
export function firstLineStep(from: ServiceJobStatus): ServiceJobStatus | null {
  return FIRST_LINE_ADVANCES_FROM.includes(from) ? "IN_PROGRESS" : null;
}

/** Csak az a négy tábla, amit a lépés olvas és ír: egy teszt-dupla ennyit ad. */
export type FirstLineTransaction = {
  worksheetVersion: Pick<
    Prisma.TransactionClient["worksheetVersion"],
    "findUnique"
  >;
  serviceJob: Pick<
    Prisma.TransactionClient["serviceJob"],
    "findUnique" | "updateMany"
  >;
  serviceJobEvent: Pick<Prisma.TransactionClient["serviceJobEvent"], "create">;
};

/**
 * A LÉPÉS, A TÉTELSORRAL EGY TRANZAKCIÓBAN. A hívó dönti el, hogy ez az ELSŐ
 * sor volt-e (a lap sorai a hívó tranzakciójában látszanak); ez a függvény azt
 * dönti el, hogy a laphoz tartozó jegyet léptetni kell-e, és ha igen, naplóval
 * együtt lépteti.
 *
 * A `from` A WHERE-BEN IS, ugyanúgy, mint a kézi `move`-nál: ha közben valaki
 * más léptette a jegyet, ez a lépés nem írja felül, és naplósor sem keletkezik.
 *
 * A visszatérési érték a megtett lépés, vagy `null`, ha nem történt semmi.
 */
export async function advanceTicketOnFirstLine(
  transaction: FirstLineTransaction,
  input: { versionId: string; actorUserId: string | null },
): Promise<{ from: ServiceJobStatus; to: ServiceJobStatus } | null> {
  const version = await transaction.worksheetVersion.findUnique({
    where: { id: input.versionId },
    select: { worksheet: { select: { serviceJobId: true } } },
  });
  const serviceJobId = version?.worksheet.serviceJobId ?? null;
  if (serviceJobId === null) return null;

  return stepTicket(transaction, {
    serviceJobId,
    note: FIRST_LINE_STEP_NOTE,
    actorUserId: input.actorUserId,
  });
}

/** A jegy léptetése naplósorral: a két automatikus lépés (első sor, csatolás) közös vége. */
async function stepTicket(
  transaction: Pick<FirstLineTransaction, "serviceJob" | "serviceJobEvent">,
  input: { serviceJobId: string; note: string; actorUserId: string | null },
): Promise<{ from: ServiceJobStatus; to: ServiceJobStatus } | null> {
  const job = await transaction.serviceJob.findUnique({
    where: { id: input.serviceJobId },
    select: { status: true },
  });
  if (!job) return null;
  const to = firstLineStep(job.status);
  if (to === null) return null;

  const moved = await transaction.serviceJob.updateMany({
    where: { id: input.serviceJobId, status: job.status },
    data: { status: to },
  });
  if (moved.count !== 1) return null;

  // STATUS_CHANGE sor: a `worksheetId` itt a CHECK szerint NULL marad
  // (`ServiceJobEvent_kind_fields_agree`), a lapot a megjegyzés nevezi meg.
  await transaction.serviceJobEvent.create({
    data: {
      serviceJobId: input.serviceJobId,
      fromStatus: job.status,
      toStatus: to,
      note: input.note,
      actorUserId: input.actorUserId,
    },
  });
  return { from: job.status, to };
}

/**
 * A TÉTELSOROS MUNKALAP CSATOLÁSA IS FOLYAMATBAN ÁLLAPOTBA LÉPTETI A JEGYET.
 *
 * A közös állapot-lista terve, 8/a pont (barracuda 1. javaslata, 61820): egy
 * már lezárt munkalap hozzácsatolható egy Új jegyhez, és a jegy addig Újnak
 * látszana, holott a munka kész. A levezetett Elkészült szándékosan csak a
 * Folyamatban jegyre fut (`commonJobStatus`), mert NEW alól nincs COMPLETED,
 * tehát a csatolás lépteti a jegyet, ugyanúgy, mint az első tételsor: ugyanaz
 * a három kiinduló állapot, ugyanaz a cél, naplósorral.
 *
 * A FELTÉTEL A TÉTELSOR, NEM A LAP ÁLLAPOTA. Ez ugyanaz a bizonyíték, mint az
 * első sornál: van-e munka a lapon. Egy üres piszkozat csatolása nem léptet;
 * ha később kap sort, az első-sor lépés viszi tovább, mert a lap akkor már a
 * jegy alatt áll. A lezárt lap mindig tételsoros (üres lap nem zárható le,
 * `worksheet-close-blockers.ts`, NO_LINES), tehát a 8/a esete ide tartozik.
 *
 * A várakozó, a kész és az elállt jegyhez nem nyúl (8/a: a csatolás egy
 * WAITING_* jegyet NEM léptet).
 */
export const ATTACH_STEP_NOTE =
  "Automatikus lépés: tételsoros munkalap került a jegy alá.";

export type AttachTransaction = Pick<
  FirstLineTransaction,
  "serviceJob" | "serviceJobEvent"
> & {
  worksheetVersion: Pick<
    Prisma.TransactionClient["worksheetVersion"],
    "findFirst"
  >;
};

/** A lépés a csatolással egy tranzakcióban; a visszatérés a megtett lépés, vagy `null`. */
export async function advanceTicketOnAttach(
  transaction: AttachTransaction,
  input: {
    serviceJobId: string;
    worksheetId: string;
    actorUserId: string | null;
  },
): Promise<{ from: ServiceJobStatus; to: ServiceJobStatus } | null> {
  // a legutolsó verzió, ugyanaz a fogalom, mint a modul többi lekérdezésében
  const latest = await transaction.worksheetVersion.findFirst({
    where: { worksheetId: input.worksheetId },
    orderBy: { version: "desc" },
    select: { _count: { select: { lines: true } } },
  });
  if (!latest || latest._count.lines === 0) return null;
  return stepTicket(transaction, {
    serviceJobId: input.serviceJobId,
    note: ATTACH_STEP_NOTE,
    actorUserId: input.actorUserId,
  });
}
