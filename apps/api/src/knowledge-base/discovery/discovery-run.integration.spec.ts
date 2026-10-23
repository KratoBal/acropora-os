import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import type { DiscoveryInput, DiscoveryResult } from "./discovery-run.js";
import { PrismaDiscoveryStore } from "./discovery-run.store.js";
import type { SourceCandidate, VersionCandidate } from "./records.js";

/**
 * THE DISCOVERY STORE ON A DATABASE (S2 acceptance 2-4).
 *
 *   - the same work stored twice stays ONE row, and a second run with more
 *     identifiers fills them in instead of adding a row (duplicates 0);
 *   - every stored source has a licence value (UNKNOWN is one);
 *   - a retraction notice on a known DOI becomes a `KnowledgeSourceVersion`,
 *     once, and turns the claims built on that work DISPUTED.
 *
 * Invented works under the `10.5555` test prefix; nothing goes on the network.
 */
const gate = integrationDatabaseGate(process.env);
const DOI_PREFIX = "10.5555/kb-int-";
const EMAIL_DOMAIN = "knowledge-discovery-integration.invalid";
const CLAIM_SUBJECT = "KB_INT_DISCOVERY";

const INPUT: DiscoveryInput = {
  label: "integracios-teszt",
  openalex: [],
  europePmc: [],
  dois: [],
  citations: [],
};

function candidate(over: Partial<SourceCandidate>): SourceCandidate {
  return {
    doi: null,
    openalexId: null,
    pmid: null,
    pmcid: null,
    kind: "PEER_REVIEWED",
    title: "Kitalált cím",
    authors: [{ name: "Kitalált Szerző", orcid: null }],
    year: 2013,
    venue: null,
    url: null,
    licence: "UNKNOWN",
    oaUrl: null,
    discoveredVia: "OPENALEX",
    retractedFlag: false,
    referencedWorks: [],
    ...over,
  };
}

function result(
  candidates: SourceCandidate[],
  notices: VersionCandidate[] = [],
): DiscoveryResult {
  return {
    status: "FINISHED",
    queries: [],
    candidates,
    notices,
    checkedDois: candidates.flatMap((c) => (c.doi ? [c.doi] : [])),
    crossrefUnknownDois: [],
    notFoundDois: [],
    skipped: {},
    conflicts: [],
    unavailable: {},
    requestCount: 0,
  };
}

describe(
  "knowledge source discovery, stored, on a database",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = Date.now() % 1_000_000;
    const doiA = `${DOI_PREFIX}${suffix}-a`;
    const doiB = `${DOI_PREFIX}${suffix}-b`;
    const store = new PrismaDiscoveryStore();
    let userId = "";

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      const user = await prisma.user.create({
        data: {
          email: `kutato-${suffix}@${EMAIL_DOMAIN}`,
          displayName: "Kitalált Kutató",
          role: "OWNER",
          isActive: true,
        },
      });
      userId = user.id;
    });

    after(removeLeftovers);

    async function removeLeftovers() {
      const where = { source: { doi: { startsWith: DOI_PREFIX } } };
      await prisma.knowledgeClaimEvidence.deleteMany({
        where: { passage: { sourceVersion: where } },
      });
      await prisma.knowledgeClaim.deleteMany({
        where: { subject: CLAIM_SUBJECT },
      });
      await prisma.knowledgePassage.deleteMany({
        where: { sourceVersion: where },
      });
      await prisma.knowledgeSourceVersion.deleteMany({ where });
      await prisma.knowledgeSource.deleteMany({
        where: { doi: { startsWith: DOI_PREFIX } },
      });
      await prisma.knowledgeDiscoveryRun.deleteMany({
        where: { requestedBy: { email: { endsWith: `@${EMAIL_DOMAIN}` } } },
      });
      await prisma.user.deleteMany({
        where: { email: { endsWith: `@${EMAIL_DOMAIN}` } },
      });
      nincsMaradek([
        {
          nev: "KnowledgeSource (doi elotag)",
          darab: await prisma.knowledgeSource.count({
            where: { doi: { startsWith: DOI_PREFIX } },
          }),
        },
        {
          nev: "KnowledgeClaim (teszt-tema)",
          darab: await prisma.knowledgeClaim.count({
            where: { subject: CLAIM_SUBJECT },
          }),
        },
        {
          nev: "KnowledgeDiscoveryRun (teszt-felhasznalo)",
          darab: await prisma.knowledgeDiscoveryRun.count({
            where: { requestedBy: { email: { endsWith: `@${EMAIL_DOMAIN}` } } },
          }),
        },
        {
          nev: "User (teszt-domain)",
          darab: await prisma.user.count({
            where: { email: { endsWith: `@${EMAIL_DOMAIN}` } },
          }),
        },
      ]);
    }

    it("stores new works with an ORIGINAL version, a licence value, and the run", async () => {
      const summary = await store.save({
        input: INPUT,
        result: result([
          candidate({ doi: doiA, openalexId: `W${suffix}1` }),
          candidate({
            doi: doiB,
            licence: "CC-BY",
            oaUrl: "https://example.invalid/b",
          }),
        ]),
        requestedById: userId,
        startedAt: new Date(),
      });
      assert.equal(summary.created, 2);
      assert.equal(summary.matched, 0);
      const rows = await prisma.knowledgeSource.findMany({
        where: { doi: { in: [doiA, doiB] } },
        select: {
          license: true,
          discoveryRunId: true,
          versions: { select: { versionKind: true } },
        },
        orderBy: { doi: "asc" },
      });
      assert.deepEqual(
        rows.map((r) => [
          r.license,
          r.versions.map((v) => v.versionKind),
          r.discoveryRunId,
        ]),
        [
          ["UNKNOWN", ["ORIGINAL"], summary.runId],
          ["CC-BY", ["ORIGINAL"], summary.runId],
        ],
      );
      const run = await prisma.knowledgeDiscoveryRun.findUniqueOrThrow({
        where: { id: summary.runId! },
      });
      assert.equal(run.sourcesCreated, 2);
      assert.equal(run.label, "integracios-teszt");
    });

    it("a second run of the same works adds no row, fills empty fields, keeps the editor's", async () => {
      await prisma.knowledgeSource.update({
        where: { doi: doiA },
        data: { venue: "Szerkesztő írta" },
      });
      const preview = await store.preview(
        result([
          candidate({ doi: doiA, pmid: `${suffix}7`, venue: "API szerint" }),
        ]),
      );
      assert.deepEqual([preview.created, preview.matched], [0, 1]);
      const summary = await store.save({
        input: INPUT,
        result: result([
          // found again by the OpenAlex id only, now with a PMID and a stricter licence
          candidate({
            openalexId: `W${suffix}1`,
            pmid: `${suffix}7`,
            venue: "API szerint",
            licence: "CC-BY-NC",
          }),
          candidate({ doi: doiB, licence: "UNKNOWN" }),
        ]),
        requestedById: userId,
        startedAt: new Date(),
      });
      assert.deepEqual([summary.created, summary.matched], [0, 2]);
      assert.equal(
        await prisma.knowledgeSource.count({
          where: { doi: { startsWith: DOI_PREFIX } },
        }),
        2,
        "duplicates 0",
      );
      const a = await prisma.knowledgeSource.findUniqueOrThrow({
        where: { doi: doiA },
      });
      assert.equal(a.pmid, `${suffix}7`);
      assert.equal(a.venue, "Szerkesztő írta");
      assert.equal(a.license, "CC-BY-NC");
      const b = await prisma.knowledgeSource.findUniqueOrThrow({
        where: { doi: doiB },
      });
      assert.equal(
        b.license,
        "CC-BY",
        "UNKNOWN never loosens a stated licence",
      );
    });

    it("a retraction on a known DOI is one version, and its claims become DISPUTED", async () => {
      const original = await prisma.knowledgeSourceVersion.findFirstOrThrow({
        where: { source: { doi: doiB }, versionKind: "ORIGINAL" },
      });
      const passage = await prisma.knowledgePassage.create({
        data: {
          sourceVersionId: original.id,
          locator: "p. 1",
          text: "Kitalált kivonat.",
          textHash: "0".repeat(64),
        },
      });
      const claim = await prisma.knowledgeClaim.create({
        data: {
          layer: "SCIENTIFIC",
          subject: CLAIM_SUBJECT,
          status: "VERIFIED",
        },
      });
      await prisma.knowledgeClaimEvidence.create({
        data: { claimId: claim.id, passageId: passage.id, stance: "SUPPORTS" },
      });
      const notice: VersionCandidate = {
        doi: doiB,
        versionKind: "RETRACTION",
        relatedDoi: `${DOI_PREFIX}${suffix}-notice`,
        noticeDate: new Date("2021-12-14T00:00:00Z"),
        detectedVia: "CROSSREF_UPDATE_TO",
      };
      const first = await store.save({
        input: INPUT,
        result: result([candidate({ doi: doiB })], [notice]),
        requestedById: userId,
        startedAt: new Date(),
      });
      assert.equal(first.versionsCreated, 1);
      assert.equal(first.claimsDisputed, 1);
      const again = await store.save({
        input: INPUT,
        result: result([candidate({ doi: doiB })], [notice]),
        requestedById: userId,
        startedAt: new Date(),
      });
      assert.equal(
        again.versionsCreated,
        0,
        "the same notice is not stored twice",
      );
      const versions = await prisma.knowledgeSourceVersion.findMany({
        where: { source: { doi: doiB } },
        select: { versionKind: true, relatedDoi: true, detectedVia: true },
        orderBy: { createdAt: "asc" },
      });
      assert.deepEqual(
        versions.map((v) => v.versionKind),
        ["ORIGINAL", "RETRACTION"],
      );
      assert.equal(versions[1]?.relatedDoi, notice.relatedDoi);
      const disputedClaim = await prisma.knowledgeClaim.findUniqueOrThrow({
        where: { id: claim.id },
      });
      assert.equal(disputedClaim.status, "DISPUTED");
    });

    it("a work matching two rows, or one row with another DOI, is left alone and reported", async () => {
      // its PMID is row A's, its DOI is new: "one work" with two DOIs
      const otherDoi = await store.save({
        input: INPUT,
        result: result([
          candidate({ doi: `${DOI_PREFIX}${suffix}-c`, pmid: `${suffix}7` }),
        ]),
        requestedById: userId,
        startedAt: new Date(),
      });
      assert.equal(otherDoi.ambiguous.length, 1);
      assert.equal(otherDoi.created + otherDoi.matched, 0);
      // its DOI is row B's, its PMID is row A's
      const twoRows = await store.save({
        input: INPUT,
        result: result([candidate({ doi: doiB, pmid: `${suffix}7` })]),
        requestedById: userId,
        startedAt: new Date(),
      });
      assert.equal(twoRows.ambiguous.length, 1);
      assert.equal(twoRows.ambiguous[0]?.rowIds.length, 2);
      const b = await prisma.knowledgeSource.findUniqueOrThrow({
        where: { doi: doiB },
      });
      assert.equal(b.pmid, null, "an ambiguous match changes nothing");
      assert.equal(
        await prisma.knowledgeSource.count({
          where: { doi: { startsWith: DOI_PREFIX } },
        }),
        2,
      );
    });
  },
);
