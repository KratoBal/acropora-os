import "reflect-metadata";
import assert from "node:assert/strict";
import { before, beforeEach, after, describe, it } from "node:test";
import {
  Controller,
  Get,
  Post,
  Module,
  type MiddlewareConsumer,
  type NestModule,
  Req,
} from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import { type AuthenticatedUser, PERMISSIONS } from "@acropora/types";
import { AuthService } from "./auth.service.js";
import { AuthController } from "./auth.controller.js";
import { AuthUserResolver } from "./auth-user-resolver.js";
import type { AuthenticatedRequest } from "./auth.types.js";
import { SessionRepository } from "./session.repository.js";
import {
  AssistantAuditRepository,
  type AssistantAuditRequest,
} from "./assistant-audit.repository.js";
import { AssistantAuditMiddleware } from "./assistant-audit.middleware.js";
import { ASSISTANT_SIDE_EFFECT_GETS } from "./assistant-readonly.policy.js";
import { AuthGuard } from "./guards/auth.guard.js";
import { AssistantReadonlyGuard } from "./guards/assistant-readonly.guard.js";
import { PermissionGuard } from "./guards/permission.guard.js";
import { RequirePermissions } from "./decorators/require-permissions.decorator.js";
import { Public } from "./decorators/public.decorator.js";
import { NavIncomingInvoiceController } from "../purchasing/nav-incoming-invoices/nav-incoming-invoice.controller.js";
import { NavIncomingInvoiceService } from "../purchasing/nav-incoming-invoices/nav-incoming-invoice.service.js";

const owner: AuthenticatedUser = {
  id: "owner",
  role: "OWNER",
  email: "test@example.invalid",
  displayName: "Test",
  customerId: null,
  supplierId: null,
};
const worker: AuthenticatedUser = { ...owner, id: "worker", role: "SERVICE" };
const customer: AuthenticatedUser = {
  ...owner,
  id: "customer",
  customerId: "customer-1",
};
const supplier: AuthenticatedUser = {
  ...owner,
  id: "supplier",
  supplierId: "supplier-1",
};
const users = new Map(
  [owner, worker, customer, supplier].map((user) => [user.id, user]),
);
let writes = 0;
@Controller("calibration")
class CalibrationController {
  @Get("read") read(@Req() request: AuthenticatedRequest) {
    return request.user;
  }
  @Post("write") write() {
    writes++;
    return {};
  }
  @Get("restricted")
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  restricted() {
    return {};
  }
  @Get("public") @Public() publicRead() {
    return {};
  }
  @Get("failure") failure() {
    throw new Error("controlled test failure");
  }
}

/** Only the database boundary is fake: real repository, services, middleware, guards and HTTP routing. */
type TestSessionRow = {
  id: string;
  userId: string;
  tokenHash: string;
  kind: "USER" | "ASSISTANT_READONLY";
  expiresAt: Date;
};
const rows = new Map<string, TestSessionRow>();
let sequence = 0,
  updates = 0,
  deletes = 0;
const table = {
  async create({
    data,
  }: {
    data: Omit<TestSessionRow, "id" | "kind"> & {
      kind?: TestSessionRow["kind"];
    };
  }) {
    const row: TestSessionRow = {
      kind: "USER",
      ...data,
      id: `session-${++sequence}`,
    };
    rows.set(row.tokenHash, row);
    return row;
  },
  async findUnique({ where }: { where: { tokenHash: string } }) {
    return rows.get(where.tokenHash) ?? null;
  },
  async count({
    where,
  }: {
    where: { userId: string; expiresAt: { gt: Date } };
  }) {
    return [...rows.values()].filter(
      (row) =>
        row.userId === where.userId &&
        row.kind === "ASSISTANT_READONLY" &&
        row.expiresAt > where.expiresAt.gt,
    ).length;
  },
  async update({
    where,
    data,
  }: {
    where: { id: string };
    data: { expiresAt: Date };
  }) {
    updates++;
    const row = [...rows.values()].find((row) => row.id === where.id)!;
    Object.assign(row, data);
    return row;
  },
  async delete() {
    deletes++;
  },
  async deleteMany() {
    deletes++;
  },
};
const sessions = new SessionRepository();
Object.defineProperty(sessions, "database", {
  value: {
    session: table,
    $transaction: async (run: (tx: unknown) => unknown) =>
      run({ session: table, $queryRaw: async () => [] }),
  },
});
const audits = new Map<
  string,
  AssistantAuditRequest & { status?: number; result?: string }
>();
const audit = {
  async begin(entry: AssistantAuditRequest) {
    const id = `audit-${audits.size}`;
    audits.set(id, entry);
    return id;
  },
  async complete(
    id: string,
    entry: AssistantAuditRequest,
    status: number,
    result: string,
  ) {
    audits.set(id, { ...entry, status, result });
  },
};
@Module({
  controllers: [
    AuthController,
    CalibrationController,
    NavIncomingInvoiceController,
  ],
  providers: [
    AuthService,
    AssistantAuditMiddleware,
    { provide: SessionRepository, useValue: sessions },
    {
      provide: AuthUserResolver,
      useValue: { resolveById: async (id: string) => users.get(id)! },
    },
    { provide: AssistantAuditRepository, useValue: audit },
    {
      provide: NavIncomingInvoiceService,
      useValue: {
        detail: () => {
          writes++;
          return {};
        },
      },
    },
    // This controller's other routes do not take part in the fixture.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: AssistantReadonlyGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
class CalibrationModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AssistantAuditMiddleware).forRoutes("{*path}");
  }
}

// NavIncomingInvoiceController also receives a repository for read-only sync state.
import { NavIncomingInvoiceRepository } from "../purchasing/nav-incoming-invoices/nav-incoming-invoice.repository.js";
const providers = Reflect.getMetadata("providers", CalibrationModule);
Reflect.defineMetadata(
  "providers",
  [...providers, { provide: NavIncomingInvoiceRepository, useValue: {} }],
  CalibrationModule,
);

let app: Awaited<ReturnType<typeof NestFactory.create>>;
let base: string;
async function request(
  token: string,
  path: string,
  method = "GET",
  cookie = false,
) {
  return fetch(`${base}/${path}`, {
    method,
    headers: cookie
      ? { cookie: `acropora_session=${token}` }
      : { authorization: `Bearer ${token}` },
  });
}
async function issue(user: AuthenticatedUser) {
  const token = `user-${user.id}`;
  await sessions.create(user.id, token, 60 * 60 * 1000);
  const response = await request(token, "auth/assistant-sessions", "POST");
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  return response.json() as Promise<{ token: string; expiresAt: string }>;
}

before(async () => {
  app = await NestFactory.create(CalibrationModule, { logger: false });
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
});
after(async () => {
  await app?.close();
});

describe("Sutyerák calibration over HTTP", () => {
  beforeEach(() => {
    rows.clear();
    audits.clear();
    writes = 0;
    updates = 0;
    deletes = 0;
  });
  it("POST with an assistant is 403 and never reaches the write", async () => {
    const assistant = await issue(owner);
    const before = writes;
    assert.equal(
      (await request(assistant.token, "calibration/write", "POST")).status,
      403,
    );
    assert.equal(writes, before);
    for (const method of ["PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      assert.equal(
        (await request(assistant.token, "calibration/read", method)).status,
        403,
        method,
      );
    }
    assert.equal(
      (await request(assistant.token, "calibration/write", "POST", true))
        .status,
      403,
    );
  });
  it("a side-effect GET is 403 before lazy NAV data can be saved", async () => {
    const assistant = await issue(owner);
    const before = writes;
    assert.equal(
      (await request(assistant.token, "integrations/nav/invoices/invoice-1"))
        .status,
      403,
    );
    assert.equal(writes, before);
    assert.equal(
      (await request("user-owner", "integrations/nav/invoices/invoice-1"))
        .status,
      200,
    );
    assert.equal(writes, before + 1);
  });
  it("partners requesting issuance get 403 (customer and supplier, regardless of role)", async () => {
    for (const partner of [customer, supplier]) {
      await sessions.create(partner.id, `user-${partner.id}`, 60_000);
      assert.equal(
        (await request(`user-${partner.id}`, "auth/assistant-sessions", "POST"))
          .status,
        403,
      );
      assert.equal(
        [...rows.values()].filter(
          (row) =>
            row.userId === partner.id && row.kind === "ASSISTANT_READONLY",
        ).length,
        0,
      );
    }
  });
  it("expired assistant gets 401, is audited and is never extended or deleted", async () => {
    const assistant = await issue(worker);
    const row = [...rows.values()].find(
      (row) => row.userId === worker.id && row.kind === "ASSISTANT_READONLY",
    )!;
    row.expiresAt = new Date(Date.now() - 1);
    const previous = { updates, deletes };
    const expiresAt = row.expiresAt;
    assert.equal(
      (await request(assistant.token, "calibration/read")).status,
      401,
    );
    assert.equal(
      await sessions.findActive(assistant.token, 8 * 60 * 60 * 1000),
      null,
    );
    assert.deepEqual({ updates, deletes }, previous);
    assert.equal(row.expiresAt, expiresAt);
    assert.ok(
      [...audits.values()].some(
        (entry) => entry.sessionId === row.id && entry.status === 401,
      ),
    );
  });
  it("restricted employee and assistant receive the same permission 403 and identity/scope", async () => {
    const assistant = await issue(worker);
    assert.equal(
      (await request("user-worker", "calibration/restricted")).status,
      403,
    );
    assert.equal(
      (await request(assistant.token, "calibration/restricted")).status,
      403,
    );
    assert.deepEqual(
      await (await request(assistant.token, "calibration/read")).json(),
      worker,
    );
    // The employee's CURRENT role/partner fields are resolved on every call.
    const current = { ...worker, customerId: "now-partner" };
    users.set(worker.id, current);
    assert.deepEqual(
      await (await request(assistant.token, "calibration/read")).json(),
      current,
    );
    users.set(worker.id, worker);
  });
  it("fixed ten-minute expiry survives repeated resolution without session writes", async () => {
    const token = "fixed-expiry";
    const stored = await sessions.createAssistant(worker.id, token);
    assert.ok(
      Math.abs(stored.expiresAt.getTime() - Date.now() - 600_000) < 2000,
    );
    const previous = { updates, deletes };
    for (let i = 0; i < 3; i++)
      assert.equal(
        (await sessions.findActive(token, 8 * 60 * 60 * 1000))?.extended,
        false,
      );
    assert.deepEqual({ updates, deletes }, previous);
  });
  it("fourth live issuance is 429; expired assistants do not count", async () => {
    await issue(owner);
    await issue(owner);
    await issue(owner);
    assert.equal(
      (await request("user-owner", "auth/assistant-sessions", "POST")).status,
      429,
    );
    const first = [...rows.values()].find(
      (row) => row.userId === owner.id && row.kind === "ASSISTANT_READONLY",
    )!;
    first.expiresAt = new Date(Date.now() - 1);
    await issue(owner);
    assert.equal(
      [...rows.values()].filter(
        (row) =>
          row.userId === owner.id &&
          row.kind === "ASSISTANT_READONLY" &&
          row.expiresAt.getTime() > Date.now(),
      ).length,
      3,
    );
  });
  it("auth, issuance, public login and session/password management cannot be used by an assistant", async () => {
    const token = "blocked-auth";
    // Make room in worker's sessions without touching the HTTP assertions above.
    for (const row of rows.values())
      if (row.userId === worker.id) row.expiresAt = new Date(0);
    await sessions.createAssistant(worker.id, token);
    for (const [path, method] of [
      ["auth/me", "GET"],
      ["auth/logout", "POST"],
      ["auth/assistant-sessions", "POST"],
      ["auth/login/password", "POST"],
      ["auth/mobile/login/password", "POST"],
    ]) {
      assert.equal((await request(token, path!, method!)).status, 403);
    }
    assert.equal((await request(token, "calibration/public")).status, 200);
  });
  it("audits actor, endpoint, timestamp and success/403/401/404/500 without token or query data", async () => {
    const { token } = await issue(worker);
    assert.equal(
      (await request(token, "calibration/read?secret=must-not-be-logged"))
        .status,
      200,
    );
    assert.equal((await request(token, "does-not-exist")).status, 404);
    assert.equal((await request(token, "calibration/failure")).status, 500);
    const entries = [...audits.values()];
    assert.equal(
      (await request(token, "calibration/write", "POST")).status,
      403,
    );
    const row = [...rows.values()].find(
      (row) => row.kind === "ASSISTANT_READONLY",
    )!;
    row.expiresAt = new Date(0);
    assert.equal((await request(token, "calibration/read")).status, 401);
    entries.push(...[...audits.values()].slice(entries.length));
    for (const status of [200, 403, 401, 404, 500])
      assert.ok(
        entries.some((entry) => entry.status === status),
        `audit status ${status}`,
      );
    for (const entry of entries) {
      assert.ok(entry.actorUserId);
      assert.ok(entry.endpoint);
      assert.ok(!Number.isNaN(Date.parse(entry.timestamp)));
      assert.ok(entry.result);
    }
    assert.ok(!JSON.stringify(entries).includes(token));
    assert.ok(!JSON.stringify(entries).includes("must-not-be-logged"));
  });
});

it("lists every audited side-effect GET explicitly, including indirect dashboard loader", () => {
  assert.deepEqual(
    ASSISTANT_SIDE_EFFECT_GETS.map((route) => route.endpoint).sort(),
    [
      "billing/incoming-documents",
      "billing/incoming-documents/:id",
      "dashboard/widgets",
      "integrations/nav/invoices/:id",
      "missing-invoices/items/:id",
      "missing-invoices/items/:id/jev-suggestion",
      "missing-invoices/months",
      "missing-invoices/months/:month",
      "missing-invoices/months/:month/accountant-package.pdf",
      "missing-invoices/months/:month/missing.xlsx",
    ].sort(),
  );
});

import { PATH_METADATA } from "@nestjs/common/constants.js";
import { type ExecutionContext, ForbiddenException } from "@nestjs/common";
import { MissingInvoicesController } from "../missing-invoices/missing-invoices.controller.js";
import { IncomingBillingDocumentsController } from "../billing/incoming-billing-documents.controller.js";
import { DashboardController } from "../dashboard/dashboard.controller.js";

it("every denylisted GET resolves to an actual handler and is blocked before execution", () => {
  const controllers = [
    MissingInvoicesController,
    IncomingBillingDocumentsController,
    NavIncomingInvoiceController,
    DashboardController,
  ];
  for (const route of ASSISTANT_SIDE_EFFECT_GETS) {
    const controller = controllers.find(
      (c) =>
        route.endpoint.startsWith(
          `${Reflect.getMetadata(PATH_METADATA, c)}/`,
        ) || route.endpoint === Reflect.getMetadata(PATH_METADATA, c),
    );
    assert.ok(controller, route.endpoint);
    const prefix = Reflect.getMetadata(PATH_METADATA, controller);
    const method = Object.getOwnPropertyNames(controller.prototype)
      .filter((name) => name !== "constructor")
      .find((name) => {
        const handler =
          controller.prototype[name as keyof typeof controller.prototype];
        const routePath = Reflect.getMetadata(PATH_METADATA, handler);
        return [prefix, routePath].filter(Boolean).join("/") === route.endpoint;
      });
    assert.ok(method, route.endpoint);
    const request: AuthenticatedRequest = {
      headers: {},
      method: "GET",
      sessionKind: "ASSISTANT_READONLY",
    };
    const context = {
      getClass: () => controller,
      getHandler: () =>
        controller.prototype[method as keyof typeof controller.prototype],
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    assert.throws(
      () => new AssistantReadonlyGuard().canActivate(context),
      ForbiddenException,
      route.endpoint,
    );
    request.sessionKind = "USER";
    assert.equal(new AssistantReadonlyGuard().canActivate(context), true);
  }
});

it("audit start failure prevents the request, and abort/finish completes at most once", async () => {
  const stored = {
    id: "assistant",
    userId: "actor",
    kind: "ASSISTANT_READONLY" as const,
    expiresAt: new Date(Date.now() + 60_000),
  };
  const repo = {
    findAssistant: async () => stored,
  } as unknown as SessionRepository;
  const callbacks: Record<string, () => void> = {};
  const response = {
    statusCode: 200,
    once: (event: string, callback: () => void) => {
      callbacks[event] = callback;
    },
  };
  const request = {
    headers: { authorization: "Bearer not-logged" },
    method: "GET",
    originalUrl: "/read",
  };
  let called = false;
  await assert.rejects(
    new AssistantAuditMiddleware(repo, {
      begin: async () => {
        throw new Error("audit unavailable");
      },
    } as unknown as AssistantAuditRepository).use(request, response, () => {
      called = true;
    }),
    /audit unavailable/,
  );
  assert.equal(called, false);
  const results: Array<{ status: number; result: string }> = [];
  const audit = {
    begin: async () => "audit-1",
    complete: async (
      _id: string,
      _entry: AssistantAuditRequest,
      status: number,
      result: string,
    ) => {
      results.push({ status, result });
    },
  };
  await new AssistantAuditMiddleware(
    repo,
    audit as unknown as AssistantAuditRepository,
  ).use(request, response, () => {
    called = true;
  });
  assert.equal(called, true);
  callbacks.close!();
  callbacks.finish!();
  assert.deepEqual(results, [{ status: 499, result: "ABORTED" }]);
});
