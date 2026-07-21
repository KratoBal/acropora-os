import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";
import type { UsersRepository } from "./users.repository.js";
import { UsersService } from "./users.service.js";

const user = {
  id: "user-1",
  firstName: "Réka",
  lastName: "Kovács",
  displayName: "Kovács Réka",
  email: "reka.kovacs@acropora.hu",
  role: "SALES" as const,
  isActive: true,
  hasPassword: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};
const repository = (overrides: Record<string, unknown> = {}) =>
  ({
    list: async () => ({
      items: [user],
      pagination: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
    }),
    detail: async () => user,
    create: async () => user,
    update: async () => user,
    setPassword: async () => user,
    setActive: async (_id: string, isActive: boolean) => ({
      ...user,
      isActive,
    }),
    ...overrides,
  }) as unknown as UsersRepository;

describe("UsersService", () => {
  it("creates a valid user", async () =>
    assert.equal(
      (
        await new UsersService(repository()).create(
          {
            firstName: "Réka",
            lastName: "Kovács",
            email: "reka.kovacs@acropora.hu",
            role: "SALES",
            password: "correct-horse-battery",
          },
          "owner",
        )
      ).id,
      "user-1",
    ));

  it("maps duplicate email conflicts", async () => {
    const error = new Prisma.PrismaClientKnownRequestError("duplicate", {
      code: "P2002",
      clientVersion: "6",
    });
    await assert.rejects(
      () =>
        new UsersService(
          repository({
            create: async () => {
              throw error;
            },
          }),
        ).create(
          {
            firstName: "Réka",
            lastName: "Kovács",
            email: "reka.kovacs@acropora.hu",
            role: "SALES",
          },
          "owner",
        ),
      ConflictException,
    );
  });

  it("updates with optimistic concurrency", async () =>
    assert.equal(
      (
        await new UsersService(repository()).update(
          "user-1",
          { lastName: "Kovács", expectedUpdatedAt: user.updatedAt },
          "owner",
        )
      ).lastName,
      "Kovács",
    ));

  it("maps stale updates to conflict", async () =>
    await assert.rejects(
      () =>
        new UsersService(
          repository({
            update: async () => {
              throw new Error("STALE_UPDATE");
            },
          }),
        ).update("user-1", { expectedUpdatedAt: user.updatedAt }, "owner"),
      ConflictException,
    ));

  it("sets a new password for an existing user", async () => {
    const result = await new UsersService(repository()).setPassword(
      "user-1",
      { password: "another-strong-password" },
      "owner",
    );
    assert.equal(result.id, "user-1");
  });

  it("rejects missing users", async () =>
    await assert.rejects(
      () =>
        new UsersService(repository({ detail: async () => null })).detail(
          "missing",
        ),
      NotFoundException,
    ));

  it("activates and deactivates users", async () => {
    const service = new UsersService(repository());
    assert.equal(
      (await service.deactivate("user-1", "owner")).isActive,
      false,
    );
    assert.equal((await service.activate("user-1", "owner")).isActive, true);
  });

  it("prevents an admin from deactivating themselves", async () =>
    await assert.rejects(
      () => new UsersService(repository()).deactivate("owner", "owner"),
      BadRequestException,
    ));

  it("returns deterministic repository pagination", async () => {
    const result = await new UsersService(repository()).list({
      page: 1,
      pageSize: 25,
      status: "ACTIVE",
    });
    assert.deepEqual(
      result.items.map((item) => item.email),
      ["reka.kovacs@acropora.hu"],
    );
  });
});
