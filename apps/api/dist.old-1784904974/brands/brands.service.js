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
import { BrandsRepository } from "./brands.repository.js";
let BrandsService = class BrandsService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    list(query) {
        return this.repository.list(query);
    }
    async detail(id) {
        const brand = await this.repository.detail(id);
        if (!brand)
            throw new NotFoundException("A márka nem található.");
        return brand;
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
    async archive(id, actorId) {
        const brand = await this.detail(id);
        if (!brand.isActive)
            return brand;
        try {
            return await this.repository.setArchived(id, true, actorId);
        }
        catch (error) {
            this.map(error);
        }
    }
    async restore(id, actorId) {
        const brand = await this.detail(id);
        if (brand.isActive)
            return brand;
        try {
            return await this.repository.setArchived(id, false, actorId);
        }
        catch (error) {
            this.map(error);
        }
    }
    async addAlias(id, input, actorId) {
        await this.detail(id);
        try {
            return await this.repository.addAlias(id, input, actorId);
        }
        catch (error) {
            this.map(error);
        }
    }
    async updateAlias(id, aliasId, input, actorId) {
        await this.detail(id);
        try {
            return await this.repository.updateAlias(id, aliasId, input, actorId);
        }
        catch (error) {
            this.map(error);
        }
    }
    async removeAlias(id, aliasId, actorId) {
        await this.detail(id);
        try {
            return await this.repository.removeAlias(id, aliasId, actorId);
        }
        catch (error) {
            this.map(error);
        }
    }
    map(error) {
        if (error instanceof Error && error.message === "STALE_UPDATE")
            throw new ConflictException("A márkát másik felhasználó módosította. Frissítsd az oldalt.");
        if (error instanceof Error && error.message === "CANONICAL_ALIAS")
            throw new BadRequestException("A kanonikus név nem szükséges aliasként.");
        if (error instanceof Error && error.message === "IDENTITY_CONFLICT")
            throw new ConflictException("A normalizált identitást már egy másik kanonikus név vagy alias használja.");
        if (error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002")
            throw new ConflictException("A normalizált márkanév, slug, alias vagy külső mapping már használatban van.");
        if (error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2025")
            throw new NotFoundException("A márka vagy alias nem található.");
        throw error;
    }
};
BrandsService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [BrandsRepository])
], BrandsService);
export { BrandsService };
//# sourceMappingURL=brands.service.js.map