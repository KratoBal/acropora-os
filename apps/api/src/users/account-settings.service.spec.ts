import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AccountSettingsService } from "./account-settings.service.js";
import { hashPassword } from "./password.util.js";
import type { UsersRepository } from "./users.repository.js";

describe("a saját fiók beállításai", () => {
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
