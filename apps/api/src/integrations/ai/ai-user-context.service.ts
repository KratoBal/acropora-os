import { Injectable, NotFoundException } from "@nestjs/common";

import { AiUserContextRepository } from "./ai-user-context.repository.js";

/**
 * What the AI agent is allowed to know about the person it is talking to.
 *
 * Today that is the identity and nothing more. The brief asked for a plan, a
 * subscriber flag, a message limit and a feature map; none of those exists in
 * the Acropora OS data model, and a value invented here would arrive at the
 * agent indistinguishable from a measured one.
 */
export interface AiUserContext {
  /** Which kind of subject the id belongs to. AI users are customers, never staff. */
  subjectType: "customer";
  customerId: string;
  customerNumber: string;
  /**
   * Always an empty object in this milestone - never `null`, never absent.
   *
   * The type is the point: a caller can already look a key up on it today,
   * and when the entitlement model exists the SHAPE will not change, only the
   * contents. A null or a missing field would force every caller to be
   * rewritten later.
   */
  entitlements: Record<string, never>;
  /**
   * Why `entitlements` is empty, in a form a machine can branch on.
   *
   * An empty object alone reads two opposite ways: "this customer is entitled
   * to nothing" or "entitlements do not exist yet". The two demand opposite
   * behaviour from the caller, and the agent cannot guess which one it is
   * holding. The closed value set answers it: today `not-modelled`, and
   * `resolved` once there is a model to resolve against.
   */
  entitlementsStatus: "not-modelled";
  /** The same answer for a human reader. */
  entitlementsNote: string;
}

const ENTITLEMENTS_NOTE =
  "Az Acropora OS-ben ma nincs előfizetés-, csomag- vagy funkció-jogosultsági " +
  "modell. Ez a mező NEM azt jelenti, hogy a vevőnek nincs jogosultsága, hanem " +
  "hogy a modell még nem létezik. Külön mérföldkő tervezi meg.";

@Injectable()
export class AiUserContextService {
  constructor(private readonly customers: AiUserContextRepository) {}

  async forCustomer(customerId: string): Promise<AiUserContext> {
    const customer = await this.customers.findCustomerIdentity(customerId);
    if (!customer) throw new NotFoundException("Ismeretlen vevő.");

    return {
      subjectType: "customer",
      customerId: customer.id,
      customerNumber: customer.customerNumber,
      entitlements: {},
      entitlementsStatus: "not-modelled",
      entitlementsNote: ENTITLEMENTS_NOTE,
    };
  }
}
