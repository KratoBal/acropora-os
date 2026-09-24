/**
 * A KARBANTARTÁSI CSOMAG KIKÜLDÉSE: KI KAPJA MEG.
 *
 * A hibajegyes `handoverMailDecision` mintája, EGY LÁNCCAL RÖVIDEBB: a
 * karbantartási lap (`ServiceJob`, kind=MAINTENANCE) `customerId` mezője
 * KÖZVETLENÜL a szerződés vevőjére mutat (a lap a megrendelőlap aláírásakor
 * a `Contract.customerId`-ból jön létre, lásd
 * `maintenance-orders.service.ts` `uploadSignedDocument`-je) -- nincs
 * `WorksheetDepartment` közbeeső lépés, mert a karbantartási folyamatnak
 * nincs "helyszín birtokosa" fogalma, csak egy szerződéses vevő.
 *
 * Ezért itt HÁROM kihagyási ok van, nem négy: a `no-department` és a
 * `no-customer` (a hibajegynél két külön lépés hiánya miatt) itt eggyé
 * vonódik `no-customer`-ré -- a lapon vagy áll `customerId`, vagy nem.
 */

import type { MaintenancePackageMailSkipReason } from "@acropora/types";

import {
  mailGate,
  redirectAuditSuffix,
  type MailRedirect,
} from "./ticket-mail.rules.js";

export interface MaintenanceMailRecipient {
  readonly email: string;
  readonly displayName: string;
  readonly isActive: boolean;
}

/**
 * A NEGYEDIK-OTODIK OK LISTAJA A `@acropora/types`-BOL JON, NEM ITT AL --
 * ugyanazert az okert, amiert a hibajegyes `HandoverMailSkipReason` is
 * ALIAS: a felulet ugyanezt az ot okot jeleniti meg, es ket kulon lista
 * elcsuszhatna.
 */
export type MaintenanceMailSkipReason = MaintenancePackageMailSkipReason;

export type MaintenanceMailDecision =
  | {
      readonly kind: "send";
      readonly to: readonly { readonly email: string; readonly name: string }[];
    }
  | { readonly kind: "skip"; readonly reason: MaintenanceMailSkipReason };

export function maintenanceMailDecision(input: {
  mode: "off" | "live";
  pathMode: "off" | "live";
  redirect: MailRedirect;
  customerId: string | null;
  recipients: readonly MaintenanceMailRecipient[];
}): MaintenanceMailDecision {
  const kapu = mailGate(input);
  if (kapu.kind === "closed") return { kind: "skip", reason: kapu.reason };
  if (input.customerId === null) return { kind: "skip", reason: "no-customer" };

  const elok = input.recipients.filter((jelolt) => jelolt.isActive);
  if (elok.length === 0) return { kind: "skip", reason: "no-recipient" };

  return {
    kind: "send",
    to: elok.map((jelolt) => ({
      email: jelolt.email,
      name: jelolt.displayName,
    })),
  };
}

export function maintenanceMailAuditNote(
  decision: MaintenanceMailDecision,
  redirect: MailRedirect,
): string {
  if (decision.kind === "skip")
    return `A karbantartási lap dokumentumcsomagja nem ment ki e-mailben (${decision.reason}).`;
  return `A karbantartási lap dokumentumcsomagja kiküldve e-mailben, ${decision.to.length} címzettnek.${redirectAuditSuffix(redirect)}`;
}
