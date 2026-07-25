var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { BadRequestException, ConflictException, Injectable, NotFoundException, } from "@nestjs/common";
import { Prisma } from "@acropora/database";
import { UsersRepository } from "./users.repository.js";
let UsersService = class UsersService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    list(query) {
        return this.repository.list(query);
    }
    async detail(id) {
        const user = await this.repository.detail(id);
        if (!user)
            throw new NotFoundException("A felhasználó nem található.");
        return user;
    }
    async create(input, actorId) {
        try {
            return await this.repository.create(input, actorId);
        }
        catch (error) {
            this.map(error);
        }
    }
    async update(id, input, actorId) {
        await this.detail(id);
        try {
            return await this.repository.update(id, input, actorId);
        }
        catch (error) {
            this.map(error);
        }
    }
    async setPassword(id, input, actorId) {
        await this.detail(id);
        try {
            return await this.repository.setPassword(id, input, actorId);
        }
        catch (error) {
            this.map(error);
        }
    }
    async activate(id, actorId) {
        const user = await this.detail(id);
        if (user.isActive)
            return user;
        try {
            return await this.repository.setActive(id, true, actorId);
        }
        catch (error) {
            this.map(error);
        }
    }
    async deactivate(id, actorId) {
        if (id === actorId)
            throw new BadRequestException("Saját magadat nem tudod inaktiválni. Kérj meg egy másik adminisztrátort.");
        const user = await this.detail(id);
        if (!user.isActive)
            return user;
        try {
            return await this.repository.setActive(id, false, actorId);
        }
        catch (error) {
            this.map(error);
        }
    }
    map(error) {
        if (error instanceof Error && error.message === "STALE_UPDATE")
            throw new ConflictException("A felhasználót másik adminisztrátor módosította. Frissítsd az oldalt.");
        if (error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002")
            throw new ConflictException("Ez az e-mail cím már használatban van.");
        if (error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2025")
            throw new NotFoundException("A felhasználó nem található.");
        throw error;
    }
};
UsersService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [UsersRepository])
], UsersService);
export { UsersService };
//# sourceMappingURL=users.service.js.map