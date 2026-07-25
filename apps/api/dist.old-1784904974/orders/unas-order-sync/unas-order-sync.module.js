var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from "@nestjs/common";
import { UnasImportModule } from "../../imports/unas/unas-import.module.js";
import { UnasOrderSyncController } from "./unas-order-sync.controller.js";
import { UnasOrderSyncRepository } from "./unas-order-sync.repository.js";
import { UnasOrderSyncScheduler } from "./unas-order-sync.scheduler.js";
import { UnasOrderSyncService } from "./unas-order-sync.service.js";
let UnasOrderSyncModule = class UnasOrderSyncModule {
};
UnasOrderSyncModule = __decorate([
    Module({
        imports: [UnasImportModule],
        controllers: [UnasOrderSyncController],
        providers: [
            UnasOrderSyncRepository,
            UnasOrderSyncService,
            UnasOrderSyncScheduler,
        ],
    })
], UnasOrderSyncModule);
export { UnasOrderSyncModule };
//# sourceMappingURL=unas-order-sync.module.js.map