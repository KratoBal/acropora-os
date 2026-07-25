var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { ConflictException, Injectable, NotFoundException, } from "@nestjs/common";
import { Prisma } from "@acropora/database";
import { CustomersRepository } from "./customers.repository.js";
let CustomersService = class CustomersService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    list(query) {
        return this.repository.list(query);
    }
    async detail(id) {
        const customer = await this.repository.detail(id);
        if (!customer)
            throw new NotFoundException("A vevő nem található.");
        return customer;
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
    map(error) {
        if (error instanceof Error && error.message === "STALE_UPDATE")
            throw new ConflictException("A vevőt másik felhasználó módosította. Frissítsd az oldalt.");
        if (error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002")
            throw new ConflictException("A partnerkód vagy egy megadott azonosító már használatban van.");
        if (error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2025")
            throw new NotFoundException("A vevő nem található.");
        throw error;
    }
};
CustomersService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [CustomersRepository])
], CustomersService);
export { CustomersService };
//# sourceMappingURL=customers.service.js.map