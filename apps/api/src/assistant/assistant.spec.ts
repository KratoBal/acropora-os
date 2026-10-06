import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import {
  Module,
  ValidationPipe,
  type MiddlewareConsumer,
  type NestModule,
} from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import type { AuthenticatedUser } from "@acropora/types";
import { AuthService } from "../auth/auth.service.js";
import { SessionRepository } from "../auth/session.repository.js";
import { AssistantAuditRepository } from "../auth/assistant-audit.repository.js";
import { AssistantAuditMiddleware } from "../auth/assistant-audit.middleware.js";
import { AuthGuard } from "../auth/guards/auth.guard.js";
import { AssistantReadonlyGuard } from "../auth/guards/assistant-readonly.guard.js";
import { PermissionGuard } from "../auth/guards/permission.guard.js";
import { AssistantController } from "./assistant.controller.js";
import { AssistantService } from "./assistant.service.js";
import { AssistantBudgetRepository } from "./assistant-budget.repository.js";

const user: AuthenticatedUser = {
  id: "pilot",
  displayName: "Dolgozó",
  email: "pilot@example.invalid",
  role: "SERVICE",
  customerId: null,
  supplierId: null,
};
let releaseStream: (() => void) | undefined;
let issued = 0;
let mode = "ok";
let gatewayCalls = 0;
let budgetTimes: Date[] = [];
const gatewayBodies: Record<string, any>[] = [];
const token = "server-only-assistant-token";
const sessions = {
  findAssistant: async (raw: string) =>
    raw === token
      ? {
          id: "assistant",
          userId: user.id,
          kind: "ASSISTANT_READONLY",
          expiresAt: new Date(Date.now() + 600_000),
        }
      : null,
};
const auth = {
  resolveToken: async (raw: string) => ({
    user: raw === "partner" ? { ...user, customerId: "customer-1" } : user,
    kind: raw === token ? "ASSISTANT_READONLY" : "USER",
    extended: false,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  }),
  issueAssistantSession: async () => {
    issued++;
    return {
      id: "assistant",
      user,
      token,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    };
  },
};
const budget = new AssistantBudgetRepository();
Object.defineProperty(budget, "database", {
  value: {
    $transaction: async (run: (tx: unknown) => unknown) =>
      run({
        $queryRaw: async () => [],
        auditLog: {
          count: async ({ where }: { where: { createdAt: { gt: Date } } }) =>
            budgetTimes.filter((time) => time > where.createdAt.gt).length,
          create: async ({ data }: { data: { createdAt: Date } }) => {
            budgetTimes.push(data.createdAt);
            return {};
          },
        },
      }),
  },
});
@Module({
  controllers: [AssistantController],
  providers: [
    AssistantService,
    AssistantAuditMiddleware,
    { provide: AuthService, useValue: auth },
    { provide: SessionRepository, useValue: sessions },
    { provide: AssistantBudgetRepository, useValue: budget },
    {
      provide: AssistantAuditRepository,
      useValue: { begin: async () => "audit", complete: async () => {} },
    },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: AssistantReadonlyGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
class Fixture implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AssistantAuditMiddleware).forRoutes("{*path}");
  }
}
let app: Awaited<ReturnType<typeof NestFactory.create>>;
let gateway: Server;
let base: string;
let gatewayUrl: string;
const savedEnv = { ...process.env };
const body = {
  question: "Mi van ezen a munkalapon?",
  context: {
    page: "/szerviz/munkalapok/worksheet-1",
    entity: "Munkalap: 2026/123 (id: worksheet-1)",
  },
};
const ask = (raw = "user", input: unknown = body) =>
  fetch(`${base}/assistant/ask`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${raw}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

before(async () => {
  gateway = createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) text += String(chunk);
    gatewayCalls++;
    gatewayBodies.push(JSON.parse(text));
    assert.equal(request.headers.authorization, "Bearer gateway-test-secret");
    if (mode === "5xx") {
      response.writeHead(503);
      response.end(token);
      return;
    }
    if (gatewayBodies.at(-1)?.threadId === "foreign") {
      response.writeHead(403);
      response.end("foreign thread");
      return;
    }
    response.writeHead(200, { "Content-Type": "application/x-ndjson" });
    if (mode === "empty") {
      response.end();
      return;
    }
    response.write('{"type":"thread","threadId":"thread-1","new":true}\n');
    const complete = () => {
      response.write('{"type":"text","delta":"Válasz"}\n');
      response.end(
        '{"type":"done","answer":"Válasz","durationMs":25,"toolCalls":1}\n',
      );
    };
    if (mode === "hold") releaseStream = complete;
    else setTimeout(complete, 25);
  });
  gateway.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  const address = gateway.address();
  assert.ok(address && typeof address !== "string");
  gatewayUrl = `http://127.0.0.1:${address.port}`;
  app = await NestFactory.create(Fixture, { logger: false });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
});
after(async () => {
  await app.close();
  gateway.close();
  await once(gateway, "close");
  for (const name of Object.keys(process.env))
    if (!(name in savedEnv)) delete process.env[name];
  Object.assign(process.env, savedEnv);
});
beforeEach(() => {
  process.env.SUTYERAK_ENABLED = "true";
  process.env.SUTYERAK_PILOT_USER_IDS = user.id;
  process.env.SUTYERAK_GATEWAY_URL = gatewayUrl;
  process.env.SUTYERAK_GATEWAY_SECRET = "gateway-test-secret";
  mode = "ok";
  budgetTimes = [];
  gatewayBodies.length = 0;
  gatewayCalls = 0;
});

describe("Sutyerák gateway HTTP calibration", () => {
  it("partner requests are 403", async () => {
    assert.equal((await ask("partner")).status, 403);
    assert.equal(gatewayCalls, 0);
  });
  it("assistant token cannot call POST /assistant/ask (403 before gateway)", async () => {
    assert.equal((await ask(token)).status, 403);
    assert.equal(gatewayCalls, 0);
  });
  it("disabled or non-pilot employee gets 403 and config hides the widget", async () => {
    for (const [enabled, pilots] of [
      ["false", user.id],
      ["true", "other-user"],
    ]) {
      process.env.SUTYERAK_ENABLED = enabled;
      process.env.SUTYERAK_PILOT_USER_IDS = pilots;
      assert.equal((await ask()).status, 403);
      const config = await fetch(`${base}/assistant/config`, {
        headers: { Authorization: "Bearer user" },
      });
      assert.deepEqual(await config.json(), { enabled: false });
    }
    assert.equal(gatewayCalls, 0);
  });
  it("'*' opens it to every employee, and still not to a partner or an assistant token", async () => {
    process.env.SUTYERAK_PILOT_USER_IDS = "*";
    const response = await ask();
    assert.equal(response.status, 200);
    await response.text();
    const config = await fetch(`${base}/assistant/config`, {
      headers: { Authorization: "Bearer user" },
    });
    assert.deepEqual(await config.json(), { enabled: true });
    assert.equal(gatewayCalls, 1);
    assert.equal((await ask("partner")).status, 403);
    assert.equal((await ask(token)).status, 403);
    assert.equal(gatewayCalls, 1);
  });
  it("a '*' inside a list counts as everyone too; a mere prefix of an id does not", async () => {
    process.env.SUTYERAK_PILOT_USER_IDS = "other-user, *";
    const open = await ask();
    assert.equal(open.status, 200);
    await open.text();
    process.env.SUTYERAK_PILOT_USER_IDS = `${user.id.slice(0, -1)}`;
    assert.equal((await ask()).status, 403);
  });
  it("five consecutive questions issue at most one live assistant token", async () => {
    const before = issued;
    for (let i = 0; i < 5; i++) {
      const response = await ask();
      assert.equal(response.status, 200);
      await response.text();
    }
    assert.ok(issued - before <= 1);
    assert.equal(gatewayCalls, 5);
  });
  it("unreachable gateway and 5xx both become browser error events", async () => {
    process.env.SUTYERAK_GATEWAY_URL = "http://127.0.0.1:1";
    let response = await ask();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).type, "error");
    process.env.SUTYERAK_GATEWAY_URL = gatewayUrl;
    mode = "5xx";
    response = await ask();
    const text = await response.text();
    assert.equal(JSON.parse(text).type, "error");
    assert.ok(!text.includes(token));
  });
  it("browser stream never includes the server-only token; forwards identity and context", async () => {
    mode = "hold";
    const response = await ask("user", { ...body, threadId: "thread-1" });
    assert.equal(response.headers.get("x-accel-buffering"), "no");
    assert.equal(response.headers.get("content-encoding"), "identity");
    const reader = response.body!.getReader();
    const first = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        setTimeout(() => {
          releaseStream?.();
          reject(new Error("Stream was buffered"));
        }, 1000),
      ),
    ]);
    releaseStream?.();
    assert.match(new TextDecoder().decode(first.value), /"type":"thread"/);
    let text = new TextDecoder().decode(first.value);
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += new TextDecoder().decode(chunk.value);
    }
    assert.ok(!text.includes(token));
    assert.ok(!text.includes("gateway-test-secret"));
    assert.equal(gatewayBodies[0]!.token, token);
    assert.deepEqual(gatewayBodies[0]!.user, {
      id: user.id,
      name: user.displayName,
    });
    assert.deepEqual(gatewayBodies[0]!.context, body.context);
    assert.equal(gatewayBodies[0]!.threadId, "thread-1");
  });
  it("empty gateway stream becomes a readable error event", async () => {
    mode = "empty";
    assert.equal((await (await ask()).json()).type, "error");
  });
  it("production USER cookie calls still require a matching CSRF header", async () => {
    const call = (csrf?: string) =>
      fetch(`${base}/assistant/ask`, {
        method: "POST",
        headers: {
          cookie: "acropora_session=user; acropora_csrf=csrf",
          "Content-Type": "application/json",
          ...(csrf ? { "x-csrf-token": csrf } : {}),
        },
        body: JSON.stringify(body),
      });
    assert.equal((await call()).status, 403);
    assert.equal((await call("wrong")).status, 403);
    const response = await call("csrf");
    assert.equal(response.status, 200);
    await response.text();
    assert.equal(gatewayCalls, 1);
  });
  it("foreign thread remains a 403 so the UI can reset it", async () => {
    const response = await ask("user", { ...body, threadId: "foreign" });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).type, "error");
  });
  it("validates question length, path-only context and client identity injection", async () => {
    for (const invalid of [
      { question: "x" },
      { ...body, question: " " },
      { ...body, question: "x".repeat(4001) },
      { ...body, context: { page: "https://example.invalid" } },
      { ...body, context: { page: "/page?token=secret" } },
      { ...body, token: "injected" },
    ])
      assert.equal((await ask("user", invalid)).status, 400);
    assert.equal(gatewayCalls, 0);
  });
  it("seventh question in a minute is 429 before gateway", async () => {
    for (let i = 0; i < 6; i++) await (await ask()).text();
    const response = await ask();
    assert.equal(response.status, 429);
    assert.match(await response.text(), /percenként/);
    assert.equal(gatewayCalls, 6);
  });
  it("sixty-first question in a rolling hour is 429 even with a free minute", async () => {
    budgetTimes = Array.from(
      { length: 60 },
      () => new Date(Date.now() - 65_000),
    );
    assert.equal((await ask()).status, 429);
    assert.equal(gatewayCalls, 0);
  });
});
