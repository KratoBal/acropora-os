var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException, } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DEVELOPMENT_USERS } from "./development-users.js";
import { AuthUserResolver } from "./auth-user-resolver.js";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
let AuthService = class AuthService {
    users;
    sessions = new Map();
    constructor(users) {
        this.users = users;
    }
    async loginWithDevelopmentUser(email) {
        if (process.env.NODE_ENV === "production") {
            throw new ForbiddenException("A development login production környezetben nem használható.");
        }
        const normalizedEmail = email.trim().toLowerCase();
        const user = DEVELOPMENT_USERS.find((candidate) => candidate.email === normalizedEmail);
        if (!user) {
            throw new NotFoundException("Ismeretlen development felhasználó.");
        }
        const internalUser = await this.users.resolveDevelopmentIdentity(user);
        const token = `dev_${randomUUID()}`;
        const session = {
            id: randomUUID(),
            user: internalUser,
            token,
            expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
        };
        this.sessions.set(token, session);
        return session;
    }
    async resolveToken(token) {
        const session = this.sessions.get(token);
        if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
            this.sessions.delete(token);
            throw new UnauthorizedException("Érvénytelen vagy lejárt munkamenet.");
        }
        const internalUser = await this.users.resolveExistingIdentity(session.user);
        session.user = internalUser;
        return internalUser;
    }
    logout(token) {
        this.sessions.delete(token);
    }
};
AuthService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [AuthUserResolver])
], AuthService);
export { AuthService };
//# sourceMappingURL=auth.service.js.map