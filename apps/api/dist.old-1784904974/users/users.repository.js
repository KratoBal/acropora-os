var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import { hashPassword } from "./password.util.js";
const displayNameOf = (firstName, lastName) => `${lastName} ${firstName}`.trim();
let UsersRepository = class UsersRepository extends Repository {
    constructor() {
        super(prisma);
    }
    async list(query) {
        const where = {
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
    async detail(id) {
        const user = await prisma.user.findUnique({ where: { id } });
        return user ? this.toDetail(user) : null;
    }
    create(input, actorId) {
        const firstName = input.firstName.trim();
        const lastName = input.lastName.trim();
        const email = input.email.trim().toLowerCase();
        return prisma.$transaction(async (tx) => {
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
                    },
                },
            });
            return this.toDetail(user);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }
    update(id, input, actorId) {
        return prisma.$transaction(async (tx) => {
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
            if (changed.count !== 1)
                throw new Error("STALE_UPDATE");
            const user = await tx.user.findUniqueOrThrow({ where: { id } });
            await this.event(tx, "user.updated", id, actorId, {
                changedFields: Object.keys(input).filter((key) => key !== "expectedUpdatedAt"),
            });
            await tx.auditLog.create({
                data: {
                    userId: actorId,
                    action: "user.updated",
                    entityType: "User",
                    entityId: id,
                    metadata: {
                        changedFields: Object.keys(input).filter((key) => key !== "expectedUpdatedAt"),
                    },
                },
            });
            return this.toDetail(user);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }
    setPassword(id, input, actorId) {
        return prisma.$transaction(async (tx) => {
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
                    },
                },
            });
            return this.toDetail(user);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }
    setActive(id, isActive, actorId) {
        return prisma.$transaction(async (tx) => {
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
                    metadata: { email: user.email },
                },
            });
            return this.toDetail(user);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }
    toSummary(user) {
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
    toDetail(user) {
        return {
            ...this.toSummary(user),
            avatarUrl: user.avatarUrl ?? undefined,
            passwordUpdatedAt: user.passwordUpdatedAt?.toISOString(),
        };
    }
    event(tx, eventType, aggregateId, actorUserId, payload) {
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
};
UsersRepository = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [])
], UsersRepository);
export { UsersRepository };
//# sourceMappingURL=users.repository.js.map