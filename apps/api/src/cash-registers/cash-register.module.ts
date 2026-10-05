import { Module } from "@nestjs/common";
import { NavOnlineInvoiceModule } from "../integrations/nav/nav-online-invoice.module.js";
import { CashRegisterController } from "./cash-register.controller.js";
import { CashRegisterService } from "./cash-register.service.js";
import { CashRegisterRepository } from "./cash-register.repository.js";
import { CashRegisterScheduler } from "./cash-register.scheduler.js";
import { OpgClient } from "./opg-client.js";
@Module({
  imports: [NavOnlineInvoiceModule],
  controllers: [CashRegisterController],
  providers: [
    { provide: OpgClient, useFactory: () => new OpgClient() },
    CashRegisterRepository,
    CashRegisterService,
    CashRegisterScheduler,
  ],
})
export class CashRegisterModule {}
