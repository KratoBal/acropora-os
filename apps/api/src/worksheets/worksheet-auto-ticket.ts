import { randomUUID } from "node:crypto";

import type { Prisma, ServiceJobStatus } from "@acropora/database";

import { lastServiceJobNumber } from "../service-jobs/service-job-last-number.js";
import {
  nextServiceJobNumber,
  serviceJobNumberPrefix,
} from "../service-jobs/service-job-number.js";
import { firstLineStep } from "./first-line-ticket-step.js";

/**
 * HIBAJEGY NÉLKÜLI MUNKALAP ALÁÍRÁSAKOR A RENDSZER NYIT FÖLÉ EGYET.
 *
 * Luca kérése, 2026-11-20 09:39 UTC (közös szál, msg 1573271531809800263), acrobot kérdésére az 1-es választ adta.
 * Balázs kiegészítése, 09:40 UTC: MINDEN aláírási úton nyíljon. Ez a vevőnek kiküldött út, a belső kolléga által
 * beírt névvel rögzített aláírás, és a mobil (ami ugyanazt a végpontot hívja).
 *
 * A SZABÁLY NEM LAZUL: Balázs 2026-09-02-i döntése („jegy nélkül nincs aláírás, TIG, számla") áll, és a kapu
 * (`mayWorksheetBeSigned`) változatlan. Ami változik: a belső kolléga útján a hiányzó jegyet nem a kollégának kell
 * előbb kézzel megnyitnia, hanem a rendszer nyitja meg, UGYANABBAN a tranzakcióban, mint a kiküldés vagy az aláírás.
 * Ha az aláírás elbukik, a jegy sem marad meg.
 *
 * A JEGY:
 *   - REPAIR fajta, HJ-szám a meglévő sorozatból (`lastServiceJobNumber`: az élő és a törölt számok közös maximuma);
 *   - a cím a lap jelenlegi verziójának tárgya, a partner és a helyszín (alegység) a lapé;
 *   - a nyitó az a belső kolléga, aki a lépést tette;
 *   - a lap a jegy alá kerül, és a naplóban három sor áll: a keletkezés, a csatolás és az állapotlépés, mind
 *     „automatikusan a munkalapból" megjegyzéssel, a kolléga nevén.
 *
 * AZ ÁLLAPOT: FOLYAMATBAN (`IN_PROGRESS`). Ugyanaz a szabály, ami egy meglévő jegyet az első tételsornál léptet
 * (`first-line-ticket-step.ts`, Balázs 2026-09-30): egy kiállított lapon a tételsorok már ott vannak, tehát ha a jegy
 * a munka elején megvolt volna, most is ott állna. Utána a jegy a rendes úton zárul (`IN_PROGRESS` → `COMPLETED`),
 * a meglévő kapuval: a lap legyen aláírva ÉS az átadás rögzítve.
 *
 * AMIRE NEM VONATKOZIK:
 *   - a partner (portál) útja: ott a régi mondat marad, jegyet nem nyit (a hívó dönt, nem ez a függvény);
 *   - a karbantartási (KT) lap: a KT alá tartozó lapnak már van jegye, a KT-hoz csak HIVATKOZÁSSAL kötött
 *     (`ServiceJobLinkedWorksheet`) lap pedig NEM kap mellé javítási jegyet, és JEGY NÉLKÜL is aláírható (Balázs, 2026-11-24, KAR-2026-021: a karbantartási lap jegy nélkül él): az aláírás átmegy, az értesítés a KT feladat nyitójához megy.
 *   - értesítés nem megy: a jegyet az nyitja, aki épp a lapot zárja le aláírással, tehát neki nincs miről szólni.
 */

/** Az automatikus jegy naplósorainak közös megjegyzése, a lépés szerint. */
export function autoTicketNote(
  trigger: AutoTicketTrigger,
  worksheetLabel: string,
): string {
  return `Automatikusan a munkalapból (${worksheetLabel}), ${trigger === "send" ? "aláírásra küldéskor" : "aláíráskor"}.`;
}

export type AutoTicketTrigger = "send" | "sign";

/** A lap annyi állapota, amennyiből a döntés születik. */
export interface AutoTicketFacts {
  serviceJobId: string | null;
  /** A karbantartási lap, amihez a lap hivatkozással kötött, vagy `null`. */
  linkedJobId: string | null;
}

/**
 * KELL-E JEGYET NYITNI, ÉS HA NEM, MIÉRT. Tiszta függvény: az adatbázis nélkül mérhető.
 *
 *   has-ticket        a lapnak van jegye: nincs teendő, a kapu átengedi
 *   maintenance-link  KT-hoz kötött lap: javítási jegyet nem kap, de jegy nélkül is aláírható (a kapu átengedi)
 *   open              nyitni kell
 */
export function autoTicketDecision(
  facts: AutoTicketFacts,
): "has-ticket" | "maintenance-link" | "open" {
  if (facts.serviceJobId !== null) return "has-ticket";
  if (facts.linkedJobId !== null) return "maintenance-link";
  return "open";
}

/** A lap ideje alatt egy másik kéz tette jegy alá: a tranzakció visszagörgetendő, és az újrapróba a jegyet már látja. */
export class AutoTicketLost extends Error {
  constructor() {
    super("A munkalap időközben hibajegy alá került.");
  }
}

/**
 * A JEGY MEGNYITÁSA, A HÍVÓ TRANZAKCIÓJÁBAN. Akkor hívandó, amikor a kiküldés vagy az aláírás feltételes írása már
 * sikerült: egy visszaadott (nem dobott) hiba ugyanis a tranzakciót elköti, és egy elbukott aláírás mellett a jegy
 * megmaradna.
 *
 * A csatolás feltételes (`serviceJobId: null` a `where`-ben): ha közben valaki kézzel csatolta, `AutoTicketLost`
 * dob, és a hívó újrapróbája már a meglévő jegyet látja. A számütközés (két egyidejű nyitás ugyanarra a számra) az
 * egyedi indexen bukik, és ugyanígy újrapróba.
 */
export async function openTicketForWorksheet(
  transaction: Prisma.TransactionClient,
  input: {
    worksheetId: string;
    actorUserId: string;
    trigger: AutoTicketTrigger;
    now: Date;
  },
): Promise<{ id: string; jobNumber: string; status: ServiceJobStatus }> {
  const sheet = await transaction.worksheet.findUniqueOrThrow({
    where: { id: input.worksheetId },
    select: {
      number: true,
      customerId: true,
      departmentId: true,
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        select: { subject: true, _count: { select: { lines: true } } },
      },
    },
  });
  const current = sheet.versions[0];
  const label = sheet.number ?? "szám nélküli munkalap";
  const title = current?.subject.trim() || `Munkalap ${label}`;
  const note = autoTicketNote(input.trigger, label);

  const year = input.now.getFullYear();
  const jobNumber = nextServiceJobNumber({
    year,
    lastNumber: await lastServiceJobNumber(
      transaction,
      serviceJobNumberPrefix(year),
    ),
  });
  // a tételsorok már a lapon vannak: ugyanaz a lépés, mint az első tételsornál (`firstLineStep`)
  const status: ServiceJobStatus =
    (current?._count.lines ?? 0) > 0 ? (firstLineStep("NEW") ?? "NEW") : "NEW";

  const job = await transaction.serviceJob.create({
    data: {
      jobNumber,
      /*
        A JEL, NEM A VÉDELEM: az előtag mutatja, hogy a jegyet a rendszer nyitotta, és melyik lapból. A végén EGYEDI tag áll
        (barracuda, #2765): egy lap az életében több automatikus jegyet is kaphat (a jegyről leválasztva, vagy a jegy
        törlése után, egy újra kiküldött vagy új verzióján), és egy lapra szóló kulcs ott az egyedi indexen bukna, minden
        újrapróbán, magyarázat nélkül. A két egyidejű nyitás ellen a feltételes csatolás véd (lent, `AutoTicketLost`).
      */
      clientOperationId: `worksheet-auto-ticket:${input.worksheetId}:${randomUUID()}`,
      title,
      description: null,
      customerId: sheet.customerId,
      departmentId: sheet.departmentId,
      kind: "REPAIR",
      openedById: input.actorUserId,
      status: "NEW",
      events: {
        create: { toStatus: "NEW", actorUserId: input.actorUserId, note },
      },
    },
    select: { id: true, jobNumber: true },
  });

  const attached = await transaction.worksheet.updateMany({
    where: { id: input.worksheetId, serviceJobId: null },
    data: { serviceJobId: job.id },
  });
  if (attached.count !== 1) throw new AutoTicketLost();
  await transaction.serviceJobEvent.create({
    data: {
      serviceJobId: job.id,
      kind: "WORKSHEET_ATTACHED",
      worksheetId: input.worksheetId,
      actorUserId: input.actorUserId,
      note,
    },
  });

  if (status !== "NEW") {
    await transaction.serviceJob.update({
      where: { id: job.id },
      data: { status },
    });
    await transaction.serviceJobEvent.create({
      data: {
        serviceJobId: job.id,
        fromStatus: "NEW",
        toStatus: status,
        actorUserId: input.actorUserId,
        note: `${note} A lapon már vannak tételsorok.`,
      },
    });
  }
  return { id: job.id, jobNumber: job.jobNumber, status };
}
