import { Module } from "@nestjs/common";

import { NotificationsModule } from "../notifications/notifications.module.js";
import { ServiceJobsController } from "./service-jobs.controller.js";
import { ServiceJobsRepository } from "./service-jobs.repository.js";
import { ServiceJobsService } from "./service-jobs.service.js";

@Module({
  // AZ ERTESITO BEKOTESE. A szolgaltatas `@Optional()` fuggosegkent veszi at
  // (a modul hat specje nem allitja elo), tehat ez a sor az EGYETLEN hely,
  // ahol a valodi kuldo a helyere kerul -- es a hianya NEMA volna: a delegalas
  // lefutna, csak nem szolna senkinek. Ezert all ra kulon allitas.
  imports: [NotificationsModule],
  controllers: [ServiceJobsController],
  providers: [ServiceJobsRepository, ServiceJobsService],
  exports: [ServiceJobsRepository, ServiceJobsService],
})
export class ServiceJobsModule {}
