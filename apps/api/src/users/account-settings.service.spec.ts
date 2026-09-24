import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { AccountSettingsService } from "./account-settings.service.js";
import { hashPassword } from "./password.util.js";
import type { UsersRepository } from "./users.repository.js";

describe("a saját fiók beállításai", () => {
  it("a beállítási végpont figyelmen kívül hagyja a becsempészett idegen userId-t", () => {
    const apiRoot = existsSync(join(process.cwd(), "src/users"))
      ? process.cwd()
      : join(process.cwd(), "apps/api");
    const controller = readFileSync(
      join(apiRoot, "src/users/account-settings.controller.ts"),
      "utf8",
    );
    const dto = readFileSync(
      join(apiRoot, "src/users/dto/account-settings.dto.ts"),
      "utf8",
    );

    assert.equal(
      /\buserId\b/.test(dto),
      false,
      "a saját-fiók DTO nem vehet át userId-t",
    );
    assert.match(
      controller,
      /@CurrentUser\(\) user: AuthenticatedUser[\s\S]*?this\.service\.changePassword\(input, user\.id\)/,
    );
    assert.match(
      controller,
      /@CurrentUser\(\) user: AuthenticatedUser[\s\S]*?this\.service\.changeSigningCode\(input, user\.id\)/,
    );
  });

  it("a beállítási végpont nem módosít más fiókot becsempészett azonosítóval", async () => {
    const writes: string[] = [];
    const repository = {
      passwordHash: async () => hashPassword("Jelenlegi-jelszo"),
      changeOwnPassword: async (id: string) => writes.push(id),
    } as unknown as UsersRepository;
    const service = new AccountSettingsService(repository);
    const maliciousInput = {
      currentPassword: "Jelenlegi-jelszo",
      newPassword: "Uj-jelszo-123",
      userId: "other-user",
    };

    await service.changePassword(maliciousInput, "calling-user");

    assert.deepEqual(writes, ["calling-user"]);
  });
});
