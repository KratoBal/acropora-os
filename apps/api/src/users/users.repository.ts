import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type { UserDetail, UserListResponse } from "@acropora/types";

import { hashPassword } from "./password.util.js";
import { userAuditMetadata } from "./user-audit.js";
import { toUserDetail, toUserSummary } from "./user-view.js";
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
      ...(query.status === "ALL"
        ? {}
        : { isActive: query.status === "ACTIVE" }),
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
      items: users.map((user) => toUserSummary(user)),
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
    return user ? toUserDetail(user) : null;
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
            /**
             * Absent and null both mean "our own colleague". The column is
             * nullable, so writing null is the same as leaving it out - the
             * spread keeps the create payload readable when it is absent.
             */
            ...(input.customerId ? { customerId: input.customerId } : {}),
          },
        });
        await this.event(tx, "user.created", user.id, actorId, {
          email,
          role: input.role,
          /**
           * THE SCOPE GOES INTO THE TRAIL, not just the name of the field.
           * `customerId` decides what this account can see, so an entry saying
           * only that it was set would not answer the one question an audit is
           * read for: set to WHICH customer.
           */
          customerId: input.customerId ?? null,
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
        return toUserDetail(user);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /**
   * LETEZIK-E EZ A VEVO.
   *
   * A SZOLGALTATASBAN allna a legkezenfekvobben, de a Prisma kliens ebben a
   * modulban CSAK itt all: egy szolgaltatas, ami kozvetlenul lekerdez, a sajat
   * tesztjeit is adatbazishoz kotne. Igy a dontes (mit mondunk a
   * felhasznalonak) merheto marad, a lekerdezes pedig ott van, ahol a tobbi.
   */
  async customerExists(id: string): Promise<boolean> {
    const customer = await prisma.customer.findUnique({
      where: { id },
      select: { id: true },
    });
    return customer !== null;
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
            // An empty string clears it, which is why this checks for
            // undefined rather than for truthiness.
            ...(input.nickname === undefined
              ? {}
              : { nickname: input.nickname.trim() || null }),
            ...(email ? { email } : {}),
            ...(input.role ? { role: input.role } : {}),
            /**
             * Absent leaves the tie alone; null cuts it. Same shape as the
             * nickname, different weight: cutting the tie makes the account
             * internal, and an internal account sees everything.
             */
            ...(input.customerId === undefined
              ? {}
              : { customerId: input.customerId || null }),
          },
        });
        if (changed.count !== 1) throw new Error("STALE_UPDATE");
        const user = await tx.user.findUniqueOrThrow({ where: { id } });
        /**
         * A NAPLO ALAKJA A `user-audit.ts`-BEN DOL EL, mert ott MERHETO: ez a
         * fajl a Prisma klienst importalja, tehat barmi, ami itt all, csak elo
         * adatbazissal probalhato ki.
         */
        const metadata = userAuditMetadata({
          fields: input as unknown as Record<string, unknown>,
          before: { customerId: existing.customerId },
          after: { customerId: user.customerId },
        });
        await this.event(tx, "user.updated", id, actorId, metadata);
        await tx.auditLog.create({
          data: {
            userId: actorId,
            action: "user.updated",
            entityType: "User",
            entityId: id,
            metadata: metadata satisfies Prisma.JsonObject,
          },
        });
        return toUserDetail(user);
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
        return toUserDetail(user);
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
        return toUserDetail(user);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
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
