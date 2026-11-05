/**
 * THE LAST MOVEMENT OF EACH ORDER, from the four places the chain moves (S4b-1, barracuda's review of #2230).
 *
 * The rule (`partnerOrderBacklog` in `@acropora/types`) says a movement is the creation, a certificate issued or a
 * document attached: ANY step of the chain. The chain counts the uploaded AND the system made documents together
 * (the list shows it so, acrobot 42589), so the movement reads the same places the chain reads:
 * - a certificate issued (`CompletionCertificate.issuedAt`);
 * - a document attached to the order (`PartnerOrderDocument.createdAt`);
 * - a document of a certificate, for example its signed copy (`CompletionCertificateDocument.createdAt`);
 * - an issued invoice of a certificate (`Invoice.issueDate`).
 * Without the last two an order with a TIG on day 0, its signed copy on day 10 and a part invoice on day 12 would
 * be called back-ordered on day 14, two days after it was invoiced: a false alarm.
 *
 * AN INVOICE'S ISSUE DATE IS A DAY, NOT A MOMENT. In the 24 hour counting it means the whole day, so the movement is
 * the END of that day (the start of the next UTC day): never earlier than it happened, so the alarm can come a day
 * late but not early. An issued storno is not a movement (it takes an invoice out of the chain, the chain does not
 * count it as one); a draft invoice is not either (its date is a plan).
 */
export interface MovementSource {
  orderId: string | null;
  at: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The end of the day an invoice's issue date names: the start of the next UTC day. */
export function endOfIssueDay(issueDate: Date): Date {
  return new Date(
    Date.UTC(
      issueDate.getUTCFullYear(),
      issueDate.getUTCMonth(),
      issueDate.getUTCDate(),
    ) + DAY_MS,
  );
}

/** The newest movement per order over all the sources; an order with none is absent (its creation stands). */
export function latestMovements(
  sources: readonly (readonly MovementSource[])[],
): Map<string, Date> {
  const latest = new Map<string, Date>();
  for (const source of sources)
    for (const { orderId, at } of source) {
      if (!orderId || !at) continue;
      const known = latest.get(orderId);
      if (!known || at > known) latest.set(orderId, at);
    }
  return latest;
}
