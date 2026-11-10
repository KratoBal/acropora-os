import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { USER_ROLES } from "@acropora/types";

import { hashSessionToken } from "../auth/session-token.util.js";
import { CreateServiceTokenDto } from "./dto/service-token-admin.dto.js";
import {
  ServiceTokenAdminRepository as AdminRepository,
  type ServiceTokenAdminRepository,
  ServiceTokenAdminView,
} from "./service-token-admin.repository.js";
import { BINDABLE_ROLES, bindingRefusal } from "./service-token-admin.rules.js";
import { ServiceTokenAdminService } from "./service-token-admin.service.js";

const view: ServiceTokenAdminView = {
  id: "tok-1",
  name: "Tartalom ügynök",
  slug: "tartalom-agent",
  dailyLimit: 200,
  lastUsedAt: null,
  revokedAt: null,
  createdAt: "2026-11-10T22:00:00.000Z",
  user: { id: "u-1", email: "agent@example.invalid", role: "CONTENT_AGENT" },
};

const validBody = {
  name: "Tartalom ügynök",
  slug: "tartalom-agent",
  userEmail: "agent@example.invalid",
};

describe("service token admin: which account may carry a token", () => {
  it("lets an active content agent account carry it", () => {
    assert.equal(
      bindingRefusal({ isActive: true, role: "CONTENT_AGENT" }),
      null,
    );
  });

  it("names a missing account", () => {
    assert.match(bindingRefusal(null) ?? "", /Nincs ilyen/);
  });

  it("refuses an inactive account", () => {
    assert.match(
      bindingRefusal({ isActive: false, role: "CONTENT_AGENT" }) ?? "",
      /inaktív/,
    );
  });

  it("refuses every role that is not a bindable machine role", () => {
    for (const role of USER_ROLES) {
      const refusal = bindingRefusal({ isActive: true, role });
      const bindable = (BINDABLE_ROLES as readonly string[]).includes(role);
      assert.equal(
        refusal === null,
        bindable,
        `${role}: ${bindable ? "bindable" : "must be refused"}`,
      );
    }
    assert.deepEqual(
      [...BINDABLE_ROLES],
      ["CONTENT_AGENT", "ASSET_IMPORT_AGENT"],
    );
  });
});

describe("service token admin: the creation's shape", () => {
  async function errorsOf(body: Record<string, unknown>): Promise<string[]> {
    const errors = await validate(plainToInstance(CreateServiceTokenDto, body));
    return errors.map((error) => error.property);
  }

  it("accepts the minimal body", async () => {
    assert.deepEqual(await errorsOf(validBody), []);
  });

  it("requires the account: a token with no account is not made", async () => {
    const { userEmail: _omitted, ...withoutAccount } = validBody;
    assert.deepEqual(await errorsOf(withoutAccount), ["userEmail"]);
  });

  it("refuses a bad slug, a bad email and a bad limit", async () => {
    assert.deepEqual(
      (
        await errorsOf({
          ...validBody,
          slug: "Nagy Betű",
          userEmail: "nem-email",
          dailyLimit: 0,
        })
      ).sort(),
      ["dailyLimit", "slug", "userEmail"],
    );
  });
});

describe("service token admin: the service", () => {
  function fakeRepository(result: unknown) {
    const calls: unknown[][] = [];
    const repository = {
      create: async (...args: unknown[]) => {
        calls.push(args);
        return result;
      },
      revoke: async (...args: unknown[]) => {
        calls.push(args);
        return result;
      },
    } as unknown as ServiceTokenAdminRepository;
    return { repository, calls };
  }

  it("returns the raw key once and hands the repository only the raw key to hash", async () => {
    const { repository, calls } = fakeRepository({
      kind: "created",
      token: view,
    });
    const created = await new ServiceTokenAdminService(repository).create(
      validBody as CreateServiceTokenDto,
      "admin-1",
    );
    assert.match(created.token, /^svc_[A-Za-z0-9_-]{43}$/);
    const [input, actor] = calls[0] as [
      { rawToken: string; dailyLimit: number },
      string,
    ];
    assert.equal(input.rawToken, created.token);
    assert.equal(input.dailyLimit, 200);
    assert.equal(actor, "admin-1");
    assert.ok(created.hint.includes(view.id));
    assert.equal(hashSessionToken(created.token).length, 64);
  });

  it("makes a different key every time", async () => {
    const { repository } = fakeRepository({ kind: "created", token: view });
    const service = new ServiceTokenAdminService(repository);
    const first = await service.create(validBody as CreateServiceTokenDto, "a");
    const second = await service.create(
      validBody as CreateServiceTokenDto,
      "a",
    );
    assert.notEqual(first.token, second.token);
  });

  it("turns a refusal into 400 with the reason, and a taken slug into 409", async () => {
    await assert.rejects(
      new ServiceTokenAdminService(
        fakeRepository({ kind: "refused", reason: "az ok" }).repository,
      ).create(validBody as CreateServiceTokenDto, "a"),
      (error: unknown) =>
        error instanceof BadRequestException && error.message === "az ok",
    );
    await assert.rejects(
      new ServiceTokenAdminService(
        fakeRepository({ kind: "slug-taken" }).repository,
      ).create(validBody as CreateServiceTokenDto, "a"),
      ConflictException,
    );
  });

  it("answers 404 for an unknown slug on revoke", async () => {
    await assert.rejects(
      new ServiceTokenAdminService(
        fakeRepository({ kind: "not-found" }).repository,
      ).revoke("nincs", "a"),
      NotFoundException,
    );
  });
});

describe("service token admin: the wiring", () => {
  const controller = readFileSync(
    new URL("./service-token-admin.controller.ts", import.meta.url),
    "utf8",
  );
  const repository = readFileSync(
    new URL("./service-token-admin.repository.ts", import.meta.url),
    "utf8",
  );
  const module = readFileSync(
    new URL("./tasks.module.ts", import.meta.url),
    "utf8",
  );

  it("puts users.manage on every route and never caches", () => {
    assert.equal(
      (
        controller.match(/@RequirePermissions\(PERMISSIONS\.USERS_MANAGE\)/g) ??
        []
      ).length,
      3,
    );
    assert.equal((controller.match(/@(Get|Post)\(/g) ?? []).length, 3);
    assert.equal((controller.match(/no-store/g) ?? []).length, 3);
  });

  it("is registered in the module", () => {
    assert.match(module, /ServiceTokenAdminController/);
    assert.match(module, /ServiceTokenAdminService/);
    assert.match(module, /ServiceTokenAdminRepository/);
  });

  it("keeps the raw key and the hash out of the audit rows and the views", () => {
    const audit = [
      ...repository.matchAll(/auditLog\.create\(\{[\s\S]*?\n {8,10}\}\);/g),
    ].map((match) => match[0]);
    assert.equal(audit.length, 2);
    for (const block of audit) {
      assert.doesNotMatch(block, /rawToken|tokenHash/);
    }
    const viewFunction = repository.slice(
      repository.indexOf("export function toAdminView"),
    );
    assert.doesNotMatch(viewFunction.slice(0, 500), /tokenHash/);
  });

  it("writes each row's audit in the same transaction", () => {
    assert.equal((repository.match(/\$transaction/g) ?? []).length, 2);
    assert.match(repository, /updated\.count === 1/);
  });
});

describe("service token admin: a racing revocation", () => {
  it("writes no audit row when another revocation won (the conditional update changed nothing)", async () => {
    const audits: unknown[] = [];
    const stored = {
      id: "tok-1",
      name: "n",
      slug: "s",
      tokenHash: "h",
      userId: "u-1",
      dailyLimit: 1,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date("2026-11-10T22:00:00.000Z"),
      user: null,
    };
    const transaction = {
      serviceToken: {
        findUnique: async () => stored,
        updateMany: async () => ({ count: 0 }),
        findUniqueOrThrow: async () => ({ ...stored, revokedAt: new Date() }),
      },
      auditLog: { create: async (args: unknown) => audits.push(args) },
    };
    const database = {
      $transaction: async (work: (tx: typeof transaction) => unknown) =>
        work(transaction),
    };
    const repository = new AdminRepository(database as never);
    const result = await repository.revoke("s", "admin-1");
    assert.equal(result.kind, "revoked");
    assert.equal(result.kind === "revoked" && result.changed, false);
    assert.equal(audits.length, 0);
  });
});
