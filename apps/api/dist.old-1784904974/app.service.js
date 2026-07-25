var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { checkDatabaseHealth } from "@acropora/database";
import { Injectable } from "@nestjs/common";
import { checkRedisHealth } from "./health/redis-health.js";
let AppService = class AppService {
    getWelcome() {
        return {
            name: "Acropora OS API",
            message: "A magyar nyelvű vállalatirányítási rendszer API-ja működik.",
        };
    }
    async getHealth() {
        const [database, redis] = await Promise.all([
            checkDatabaseHealth(),
            checkRedisHealth(),
        ]);
        return {
            application: {
                status: "ok",
                version: "0.1.0",
            },
            database,
            redis,
            uptime: Math.round(process.uptime()),
            timestamp: new Date().toISOString(),
        };
    }
};
AppService = __decorate([
    Injectable()
], AppService);
export { AppService };
//# sourceMappingURL=app.service.js.map