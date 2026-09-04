import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthenticatedUser } from "@acropora/types";

import { ContentAgentController } from "./content-agent.controller.js";
import type { ContentService } from "./content.service.js";
import type { ContentCreateDto } from "./dto/content.dto.js";

/**
 * A GEPI BEJARAT BEKOTESE, ES EZ NEM UGYANAZ, MINT A SZOLGALTATAS ALLAPOTA.
 *
 * A `content.service.spec.ts` azt meri, hogy a `createForReview` AWAITING_REVIEW
 * allapotba tesz. Amit NEM mer -- es a szeletnek epp ez a fele --, hogy az
 * agens-vegpont TENYLEG azt hivja.
 *
 * A KET ALLITAS KULONBSEGE A SZAKADAS: a kepesseg megvan es helyes, a felulet
 * megvan es helyes, csak senki nem koti ossze oket. Egy ilyen visszaallitas
 * (`createForReview` -> `create`) semmilyen tipushibat nem adna, mert a ket
 * metodus ugyanazt a bemenetet veszi -- es a szolgaltatas tesztjei tovabbra is
 * zoldek maradnanak, mert azok a szolgaltatast merik, nem a hivot.
 */
function controllerWith() {
  const calls: { method: string; input: unknown }[] = [];
  const service = {
    create: async (input: unknown) => {
      calls.push({ method: "create", input });
      return { id: "uj" };
    },
    createForReview: async (input: unknown) => {
      calls.push({ method: "createForReview", input });
      return { id: "uj" };
    },
    reviseFromAgent: async (input: unknown) => {
      calls.push({ method: "reviseFromAgent", input });
      return { id: "c1" };
    },
  } as unknown as ContentService;
  return { controller: new ContentAgentController(service), calls };
}

const AGENT: AuthenticatedUser = {
  id: "agent-1",
} as unknown as AuthenticatedUser;

const INPUT: ContentCreateDto = {
  title: "Gepi vazlat",
  channel: "FACEBOOK_POST",
} as unknown as ContentCreateDto;

describe("the machine entry point's wiring", () => {
  it("calls the review step, not the draft step", async () => {
    const { controller, calls } = controllerWith();

    await controller.create(INPUT, AGENT);

    assert.deepEqual(
      calls.map((call) => call.method),
      ["createForReview"],
    );
  });

  /**
   * ES A SZERZO A HIVO MARAD. Az orzo a tokenbol oldja fel, es a vezerlo nem
   * valaszthat mast: egy tetel, aminek a szerzoje valaki mas, azonnal az O
   * listajaban allna anelkul, hogy tudna rola.
   */
  it("keeps the caller as the author", async () => {
    const { controller, calls } = controllerWith();

    await controller.create(INPUT, AGENT);

    assert.equal((calls[0]!.input as { authorId: string }).authorId, "agent-1");
  });

  /**
   * A JAVITO UT UGYANEZT A SZAKADAST ZARJA BE, ES ITT NAGYOBB A TET.
   *
   * Ha a `PATCH` valaha a `createForReview` metodusra kotne (elgepeles, masolt
   * sor), a hivas SIKERES lenne, es UJ tetelt szulne -- pontosan azt a
   * duplikatumot, ami miatt ez az ut megepult. Semmilyen tipushiba nem jonne:
   * a ket metodus bemenete atfed.
   */
  it("a javito ut a JAVITO szolgaltatas-metodust hivja, nem a letrehozot", async () => {
    const { controller, calls } = controllerWith();

    await controller.revise("c1", { body: "javitott" }, AGENT);

    assert.deepEqual(
      calls.map((call) => call.method),
      ["reviseFromAgent"],
    );
  });

  it("a javitas az UTVONALBOL veszi a tetel azonositojat, a szerzot a hivobol", async () => {
    const { controller, calls } = controllerWith();

    await controller.revise("c1", { body: "javitott" }, AGENT);

    const input = calls[0]!.input as { contentId: string; authorId: string };
    assert.equal(input.contentId, "c1");
    assert.equal(input.authorId, "agent-1");
  });
});
