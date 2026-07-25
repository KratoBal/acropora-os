var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var AuthUserResolver_1;
import { Injectable, Logger, ServiceUnavailableException, UnauthorizedException, } from "@nestjs/common";
import { prisma } from "@acropora/database";
import { createHash } from "node:crypto";
let AuthUserResolver = AuthUserResolver_1 = class AuthUserResolver {
    logger = new Logger(AuthUserResolver_1.name);
    async resolveDevelopmentIdentity(identity) {
        try {
            const user = await prisma.user.upsert({
                where: { email: identity.email.trim().toLowerCase() },
                update: {
                    displayName: identity.displayName,
                    role: identity.role,
                    isActive: true,
                },
                create: {
                    email: identity.email.trim().toLowerCase(),
                    displayName: identity.displayName,
                    role: identity.role,
                    isActive: true,
                },
            });
            return this.toAuthenticatedUser(user);
        }
        catch (error) {
            this.logger.error(`A development identity nem oldható fel belső User rekordra: subject=${identity.id}, emailHash=${this.emailHash(identity.email)}`, error instanceof Error ? error.stack : undefined);
            throw new ServiceUnavailableException("A development felhasználó adatbázis-rekordja nem készíthető el.");
        }
    }
    async resolveExistingIdentity(identity) {
        const normalizedEmail = identity.email.trim().toLowerCase();
        const user = (await prisma.user.findUnique({ where: { id: identity.id } })) ??
            (await prisma.user.findUnique({ where: { email: normalizedEmail } }));
        if (!user || !user.isActive) {
            this.logger.warn(`Az autentikált identityhez nincs aktív belső User: subject=${identity.id}, emailHash=${this.emailHash(normalizedEmail)}`);
            throw new UnauthorizedException("Az autentikált felhasználóhoz nem tartozik aktív belső User rekord.");
        }
        return this.toAuthenticatedUser(user);
    }
    toAuthenticatedUser(user) {
        return {
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            role: user.role,
            avatarUrl: user.avatarUrl,
        };
    }
    emailHash(email) {
        return createHash("sha256")
            .update(email.trim().toLowerCase())
            .digest("hex")
            .slice(0, 12);
    }
};
AuthUserResolver = AuthUserResolver_1 = __decorate([
    Injectable()
], AuthUserResolver);
export { AuthUserResolver };
//# sourceMappingURL=auth-user-resolver.js.map