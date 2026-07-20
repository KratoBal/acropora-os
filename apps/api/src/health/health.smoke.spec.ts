import "reflect-metadata";

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, describe, it } from "node:test";
import { prisma } from "@acropora/database";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "../app.module.js";

describe("GET /health HTTP smoke", () => {
  after(async () => {
    await prisma.$disconnect();
  });

  it("returns 200 from a real Nest application instance", async () => {
    const app = await NestFactory.create(AppModule, { logger: false });

    try {
      await app.listen(0, "127.0.0.1");
      const address = app.getHttpServer().address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/health`);
      const body = (await response.json()) as {
        application?: { status?: string };
        database?: { status?: string };
        redis?: { status?: string };
      };

      assert.equal(response.status, 200);
      assert.equal(body.application?.status, "ok");
      assert.equal(body.database?.status, "ok");
      assert.equal(body.redis?.status, "ok");
    } finally {
      await app.close();
    }
  });
});
