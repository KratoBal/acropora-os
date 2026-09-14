import { Module } from "@nestjs/common";

import { documentStoreProvider } from "../service-assets/document-store/document-store.provider.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { WorksheetsController } from "./worksheets.controller.js";
import { WorksheetsRepository } from "./worksheets.repository.js";
import { WorksheetsService } from "./worksheets.service.js";

@Module({
  imports: [NotificationsModule],
  controllers: [WorksheetsController],
  /**
   * A `documentStoreProvider` 2026-09-14 OTA ALL ITT, ES EZ JAVITAS.
   *
   * A `WorksheetsService` `@Optional() @Inject(DOCUMENT_STORE)` alakban keri a
   * tarolot, es ezt a jelzot ma csak az `ServiceAssetsModule` allitja elo --
   * exportalas nelkul, es egyetlen modul sem `@Global` (merve: nulla `@Global`
   * az `apps/api/src` fan). A munkalap-fenykep feltoltese tehat ELESBEN
   * `undefined` tarolot kapott, es 503-at adott: „a dokumentum-tarolo nincs
   * beallitva ebben a peldanyban".
   *
   * A HIBA NEMASAGA A LENYEG: az uzenet a KORNYEZETET nevezi meg, holott a
   * bekotes hianyzott. Aki ezt latja, a hoszton keresi a kotetet, es nem
   * talal semmit -- mert ott minden rendben van.
   */
  providers: [documentStoreProvider, WorksheetsRepository, WorksheetsService],
  exports: [WorksheetsRepository, WorksheetsService],
})
export class WorksheetsModule {}
