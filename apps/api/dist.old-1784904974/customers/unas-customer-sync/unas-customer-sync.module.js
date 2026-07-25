var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from "@nestjs/common";
import { UnasImportModule } from "../../imports/unas/unas-import.module.js";
import { UnasCustomerSyncController } from "./unas-customer-sync.controller.js";
import { UnasCustomerSyncRepository } from "./unas-customer-sync.repository.js";
import { UnasCustomerSyncScheduler } from "./unas-customer-sync.scheduler.js";
import { UnasCustomerSyncService } from "./unas-customer-sync.service.js";
let UnasCustomerSyncModule = class UnasCustomerSyncModule {
};
UnasCustomerSyncModule = __decorate([
    Module({
        imports: [UnasImportModule],
        controllers: [UnasCustomerSyncController],
        providers: [
            UnasCustomerSyncRepository,
            UnasCustomerSyncService,
            UnasCustomerSyncScheduler,
        ],
    })
], UnasCustomerSyncModule);
export { UnasCustomerSyncModule };
//# sourceMappingURL=unas-customer-sync.module.js.map