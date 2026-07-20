import "reflect-metadata";

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { prisma } from "@acropora/database";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";
import { AuthService } from "./auth/auth.service.js";
import { AuthUserResolver } from "./auth/auth-user-resolver.js";

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
});
