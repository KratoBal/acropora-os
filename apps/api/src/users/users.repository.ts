import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { Prisma, Repository, prisma, type User } from "@acropora/database";
import type { UserDetail, UserListResponse, UserSummary } from "@acropora/types";

import { hashPassword } from "./password.util.js";
import type {
  CreateUserDto,
  SetUserPasswordDto,
  UpdateUserDto,
  UserListQueryDto,
} from "./dto/user.dto.js";

const displayNameOf = (firstName: string, lastName: string) =>
  `${lastName} ${firstName}`.trim();

@Injectable()
export class UsersRepository extends Repository {
  constructor() {
    super(prisma);
  }

  async list(query: UserListQueryDto): Promise<UserListResponse> {
    const where: Prisma.UserWhereInput = {
      ...(query.status === "ALL" ? {} : { isActive: query.status === "ACTIVE" }),
      ...(query.role ? { role: query.role } : {}),
      ...(query.search
        ? {
            OR: [
              { displayName: { contains: query.search, mode: "insensitive" } },
              { firstName: { contains: query.search, mode: "insensitive" } },
              { lastName: { contains: query.search, mode: "insensitive" } },
              { email: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [users, totalItems] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.user.count({ where }),
    ]);
    return {
      items: users.map((user) => this.toSummary(user)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    };
  }

  async detail(id: string): Promise<UserDetail | null> {
    const user = await prisma.user.findUnique({ where: { id } });
    return user ? this.toDetail(user) : null;
  }

  create(input: CreateUserDto, actorId: string) {
    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();
    const email = input.email.trim().toLowerCase();
    return prisma.$transaction(
      async (tx) => {
        const passwordHash = input.password
          ? await hashPassword(input.password)
          : null;
        const user = await tx.user.create({
          data: {
            email,
            firstName,
            lastName,
            displayName: displayNameOf(firstName, lastName),
            role: input.role,
            passwordHash,
            passwordUpdatedAt: passwordHash ? new Date() : null,
          },
        });
        await this.event(tx, "user.created", user.id, actorId, {
          email,
          role: input.role,
        });
        await tx.auditLog.create({
          data: {
            userId: actorId,
            action: "user.created",
            entityType: "User",
            entityId: user.id,
            metadata: {
              email,
              role: input.role,
              passwordSet: Boolean(passwordHash),
            } satisfies Prisma.JsonObject,
          },
        });
        return this.toDetail(user);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  update(id: string, input: UpdateUserDto, actorId: string) {
    return prisma.$transaction(
      async (tx) => {
        const existing = await tx.user.findUniqueOrThrow({ where: { id } });
        const firstName = input.firstName?.trim() ?? existing.firstName;
        const lastName = input.lastName?.trim() ?? existing.lastName;
        const email = input.email?.trim().toLowerCase();
        const changed = await tx.user.updateMany({
          where: { id, updatedAt: new Date(input.expectedUpdatedAt) },
          data: {
            firstName,
            lastName,
            displayName: displayNameOf(firstName, lastName),
            ...(email ? { email } : {}),
            ...(input.role ? { role: input.role } : {}),
          },
        });
        if (changed.count !== 1) throw new Error("STALE_UPDATE");
        const user = await tx.user.findUniqueOrThrow({ where: { id } });
        await this.event(tx, "user.updated", id, actorId, {
          changedFields: Object.keys(input).filter(
            (key) => key !== "expectedUpdatedAt",
          ),
        });
        await tx.auditLog.create({
          data: {
            userId: actorId,
            action: "user.updated",
            entityType: "User",
            entityId: id,
            metadata: {
              changedFields: Object.keys(input).filter(
                (key) => key !== "expectedUpdatedAt",
              ),
            } satisfies Prisma.JsonObject,
          },
        });
        return this.toDetail(user);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  setPassword(id: string, input: SetUserPasswordDto, actorId: string) {
    return prisma.$transaction(
      async (tx) => {
        await tx.user.findUniqueOrThrow({ where: { id } });
        const passwordHash = await hashPassword(input.password);
        const user = await tx.user.update({
          where: { id },
          data: { passwordHash, passwordUpdatedAt: new Date() },
        });
        await this.event(tx, "user.password-changed", id, actorId, {});
        await tx.auditLog.create({
          data: {
            userId: actorId,
            action: "user.password-changed",
            entityType: "User",
            entityId: id,
            metadata: {
              changedFields: ["password"],
              targetUserId: id,
            } satisfies Prisma.JsonObject,
          },
        });
        return this.toDetail(user);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  setActive(id: string, isActive: boolean, actorId: string) {
    return prisma.$transaction(
      async (tx) => {
        const user = await tx.user.update({
          where: { id },
          data: { isActive },
        });
        const eventType = isActive ? "user.activated" : "user.deactivated";
        await this.event(tx, eventType, id, actorId, { email: user.email });
        await tx.auditLog.create({
          data: {
            userId: actorId,
            action: eventType,
            entityType: "User",
            entityId: id,
            metadata: { email: user.email } satisfies Prisma.JsonObject,
          },
        });
        return this.toDetail(user);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private toSummary(user: User): UserSummary {
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      hasPassword: Boolean(user.passwordHash),
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  private toDetail(user: User): UserDetail {
    return {
      ...this.toSummary(user),
      avatarUrl: user.avatarUrl ?? undefined,
      passwordUpdatedAt: user.passwordUpdatedAt?.toISOString(),
    };
  }

  private event(
    tx: Prisma.TransactionClient,
    eventType: string,
    aggregateId: string,
    actorUserId: string,
    payload: Prisma.JsonObject,
  ) {
    return tx.domainEvent.create({
      data: {
        id: randomUUID(),
        eventType,
        aggregateType: "User",
        aggregateId,
        actorUserId,
        payload,
        occurredAt: new Date(),
        schemaVersion: 1,
      },
    });
  }
}
