var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { AppService } from "./app.service.js";
import { Public } from "./auth/decorators/public.decorator.js";
let AppController = class AppController {
    appService;
    constructor(appService) {
        this.appService = appService;
    }
    getWelcome() {
        return this.appService.getWelcome();
    }
    async getHealth() {
        const health = await this.appService.getHealth();
        if (health.database.status !== "ok" || health.redis.status !== "ok") {
            throw new ServiceUnavailableException(health);
        }
        return health;
    }
};
__decorate([
    Get(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AppController.prototype, "getWelcome", null);
__decorate([
    Get("health"),
    Public(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AppController.prototype, "getHealth", null);
AppController = __decorate([
    Controller(),
    __metadata("design:paramtypes", [AppService])
], AppController);
export { AppController };
//# sourceMappingURL=app.controller.js.map