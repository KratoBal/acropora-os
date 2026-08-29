import "reflect-metadata";
import "./service-assets/qr-svg.spec.js";
import "./service-assets/service-assets.service.spec.js";

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { prisma } from "@acropora/database";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";
import { AuthService } from "./auth/auth.service.js";
import { AuthUserResolver } from "./auth/auth-user-resolver.js";
import { configureApp } from "./app.configuration.js";
import {
  DEFAULT_KEEP_ALIVE_TIMEOUT_MS,
  HEADERS_TIMEOUT_MARGIN_MS,
} from "./http-timeouts.js";

describe("Nest AppModule bootstrap", () => {
  after(async () => {
    await prisma.$disconnect();
  });

  it("compiles the complete runtime dependency graph", async () => {
    const moduleRef = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });

    try {
      assert.ok(moduleRef.get(AuthService));
      assert.ok(moduleRef.get(AuthUserResolver));
    } finally {
      await moduleRef.close();
    }
  });

  it("configures the running server, not just a constant somewhere", async () => {
    /**
     * Goes through the real `configureApp`, the same call the entry point
     * makes, and reads the values off the HTTP server it configured.
     *
     * The reason it is here rather than in http-timeouts.spec.ts: that file
     * proves the function sets what it is asked to set. This proves the
     * function is CALLED, on the server the API actually serves from. The two
     * defects this codebase has paid for were both of the second kind - a
     * correct piece nothing wired up - and a unit test cannot see either.
     *
     * It also explains why the configuration does not live in `main.ts` any
     * more: importing an entry point runs it, so this test would have started
     * the real server on the real port just by loading the module.
     */
    const app = await NestFactory.create(AppModule, { logger: false });

    try {
      configureApp(app);

      const server = app.getHttpServer();

      assert.equal(server.keepAliveTimeout, DEFAULT_KEEP_ALIVE_TIMEOUT_MS);
      assert.equal(
        server.headersTimeout,
        DEFAULT_KEEP_ALIVE_TIMEOUT_MS + HEADERS_TIMEOUT_MARGIN_MS,
      );
      assert.ok(
        server.keepAliveTimeout > 60_000,
        "the server would close idle sockets before the proxy stops reusing them",
      );
    } finally {
      await app.close();
    }
  });
});
