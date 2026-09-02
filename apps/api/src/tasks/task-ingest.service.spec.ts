import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  HttpException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Prisma, type ServiceToken } from "@acropora/database";

import type { ServiceTokenRepository } from "./service-token.repository.js";
import type { TaskIngestRepository } from "./task-ingest.repository.js";
import { TaskIngestService } from "./task-ingest.service.js";

const token: ServiceToken = {
  id: "token-1",
  name: "Flotta - polip",
  slug: "polip",
  tokenHash: "hash",
  userId: null,
  dailyLimit: 200,
  lastUsedAt: null,
  revokedAt: null,
  createdAt: new Date("2026-08-16T10:00:00.000Z"),
};

const payload = {
  title: "Nyers termékexport",
  assigneeEmail: "balazs@acropora.hu",
  reference: "required-inputs#1.2",
};

const repository = (overrides: Record<string, unknown> = {}) =>
  ({
    activeUserByEmail: async () => ({ id: "user-balazs" }),
    findBySourceRef: async () => null,
    countIngestedSince: async () => 0,
    ingest: async (data: Record<string, unknown>) => ({
      id: "task-new",
      status: "OPEN",
      created: true,
      ...data,
    }),
    ...overrides,
  }) as unknown as TaskIngestRepository;

const tokens = (overrides: Record<string, unknown> = {}) =>
  ({
    touch: async () => undefined,
    ...overrides,
  }) as unknown as ServiceTokenRepository;

const service = (
  repositoryOverrides: Record<string, unknown> = {},
  tokenOverrides: Record<string, unknown> = {},
) =>
  new TaskIngestService(
    repository(repositoryOverrides),
    tokens(tokenOverrides),
  );

describe("TaskIngestService", () => {
  it("namespaces the reference with the token's slug, not with anything the caller sent", async () => {
    let written: string | undefined;
    await service({
      ingest: async (data: { sourceRef: string }) => {
        written = data.sourceRef;
        return { id: "task-new", status: "OPEN", created: true };
      },
    }).ingest(payload, token);

    assert.equal(written, "polip:required-inputs#1.2");
  });

  it("cannot be tricked into writing under another caller's namespace", async () => {
    let written: string | undefined;
    await service({
      ingest: async (data: { sourceRef: string }) => {
        written = data.sourceRef;
        return { id: "task-new", status: "OPEN", created: true };
      },
    }).ingest({ ...payload, reference: "korall:sajat-tetel" }, token);

    // The caller's colon does not escape the prefix - the stored ref still
    // begins with this token's own slug.
    assert.ok(written?.startsWith("polip:"));
  });

  it("returns the existing task on a replay instead of creating a second one", async () => {
    let created = false;
    const result = await service({
      findBySourceRef: async () => ({
        id: "task-existing",
        status: "OPEN",
        created: false,
      }),
      ingest: async () => {
        created = true;
        return { id: "task-new", status: "OPEN", created: true };
      },
    }).ingest(payload, token);

    assert.equal(created, false);
    assert.deepEqual(result, {
      id: "task-existing",
      status: "OPEN",
      created: false,
    });
  });

  it("does not spend daily quota on a replay", async () => {
    let counted = false;
    await service({
      findBySourceRef: async () => ({
        id: "task-existing",
        status: "OPEN",
        created: false,
      }),
      countIngestedSince: async () => {
        counted = true;
        return 0;
      },
    }).ingest(payload, token);

    assert.equal(counted, false);
  });

  it("resolves a concurrent duplicate to the winner's row rather than failing", async () => {
    let lookups = 0;
    const result = await service({
      findBySourceRef: async () => {
        lookups += 1;
        return lookups === 1
          ? null
          : { id: "task-winner", status: "OPEN", created: false };
      },
      ingest: async () => {
        throw new Prisma.PrismaClientKnownRequestError("duplicate", {
          code: "P2002",
          clientVersion: "6.19.3",
        });
      },
    }).ingest(payload, token);

    assert.deepEqual(result, {
      id: "task-winner",
      status: "OPEN",
      created: false,
    });
  });

  it("rethrows a unique violation that does not resolve to an existing row", async () =>
    assert.rejects(() =>
      service({
        ingest: async () => {
          throw new Prisma.PrismaClientKnownRequestError("duplicate", {
            code: "P2002",
            clientVersion: "6.19.3",
          });
        },
      }).ingest(payload, token),
    ));

  it("rejects an unknown or inactive assignee with 422", async () =>
    assert.rejects(
      () =>
        service({ activeUserByEmail: async () => null }).ingest(payload, token),
      UnprocessableEntityException,
    ));

  it("rejects a link that is not an absolute http(s) URL", async () =>
    assert.rejects(
      () =>
        service().ingest({ ...payload, linkUrl: "javascript:alert(1)" }, token),
      BadRequestException,
    ));

  it("refuses once the token's daily allowance is used up", async () => {
    await assert.rejects(
      () =>
        service({ countIngestedSince: async () => 200 }).ingest(payload, token),
      (error: unknown) =>
        error instanceof HttpException && error.getStatus() === 429,
    );
  });

  it("counts the allowance against this token only", async () => {
    let scope: string | undefined;
    await service({
      countIngestedSince: async (slug: string) => {
        scope = slug;
        return 0;
      },
    }).ingest(payload, token);

    assert.equal(scope, "polip");
  });

  it("records the acting token, never a user, on the written task", async () => {
    let data: Record<string, unknown> | undefined;
    await service({
      ingest: async (input: Record<string, unknown>) => {
        data = input;
        return { id: "task-new", status: "OPEN", created: true };
      },
    }).ingest(payload, token);

    assert.equal(data?.tokenSlug, "polip");
    assert.equal("createdById" in (data ?? {}), false);
  });

  it("still returns the task when recording token usage fails", async () => {
    const result = await service(
      {},
      {
        touch: async () => {
          throw new Error("adatbázis elérhetetlen");
        },
      },
    ).ingest(payload, token);

    assert.equal(result.created, true);
  });
});
