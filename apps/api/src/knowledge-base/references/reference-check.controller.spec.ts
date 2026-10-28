import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../../auth/decorators/require-permissions.decorator.js";

import {
  KnowledgeReferenceController,
  KnowledgeReferenceService,
  MAX_SYNC_SOURCES,
  type ReferenceServiceDeps,
} from "./reference-check.controller.js";
import type { ReferenceSource } from "./reference-check.js";

/**
 * T1 behind a signed-in call (acrobot 37232). WHAT TURNS IT RED: the check
 * runs with the switch off, while a discovery or a draft uses the budget, or
 * over the synchronous cap; the endpoint without `knowledge.manage`.
 */
const SOURCE: ReferenceSource = {
  id: "s1",
  doi: "10.5555/kitalalt.2001.1",
  pmid: null,
  title: "Kitalált foszfát-dúsítás és az Acropora kalcifikációja",
  year: 2001,
};

function service(over: Partial<ReferenceServiceDeps> = {}) {
  const urls: string[] = [];
  const deps: ReferenceServiceDeps = {
    env: { KNOWLEDGE_DISCOVERY: "on" },
    sources: async () => ({ checkable: [SOURCE], withoutId: ["s8", "s9"] }),
    busy: async () => false,
    fetch: async (url) => {
      urls.push(url);
      return new Response(
        JSON.stringify({
          message: { DOI: SOURCE.doi, title: [SOURCE.title] },
        }),
        { status: 200 },
      );
    },
    sleep: async () => undefined,
    now: () => new Date("2026-10-28T05:00:00Z"),
    ...over,
  };
  return { svc: new KnowledgeReferenceService(deps), urls };
}

describe("the reference check behind a call", () => {
  it("answers the report, with the unmeasurable count and the requests", async () => {
    const { svc, urls } = service();
    const r = await svc.check();
    assert.equal(r.met, true);
    assert.equal(r.resolved, 1);
    assert.equal(r.withoutIdentifier, 2);
    assert.deepEqual(r.withoutIdentifierIds, ["s8", "s9"]);
    assert.equal(r.requests, 1);
    assert.match(urls[0]!, /api\.crossref\.org\/works\/10\.5555\/kitalalt/);
  });
  it("refuses with the switch off, and calls nobody", async () => {
    const { svc, urls } = service({ env: {} });
    await assert.rejects(svc.check(), ForbiddenException);
    assert.equal(urls.length, 0);
  });
  it("refuses while a discovery or a draft uses the budget", async () => {
    const { svc, urls } = service({ busy: async () => true });
    await assert.rejects(svc.check(), ConflictException);
    assert.equal(urls.length, 0);
  });
  it("refuses nothing to check, and more than the synchronous cap", async () => {
    await assert.rejects(
      service({
        sources: async () => ({ checkable: [], withoutId: [] }),
      }).svc.check(),
      BadRequestException,
    );
    const many = Array.from({ length: MAX_SYNC_SOURCES + 1 }, (_, i) => ({
      ...SOURCE,
      id: `s${i}`,
    }));
    const { svc, urls } = service({
      sources: async () => ({ checkable: many, withoutId: [] }),
    });
    await assert.rejects(svc.check(), BadRequestException);
    assert.equal(urls.length, 0);
  });
  it("the endpoint needs knowledge.manage", () => {
    const required = Reflect.getMetadata(
      REQUIRED_PERMISSIONS_KEY,
      KnowledgeReferenceController.prototype.check,
    );
    assert.deepEqual(required, [PERMISSIONS.KNOWLEDGE_MANAGE]);
  });
});
