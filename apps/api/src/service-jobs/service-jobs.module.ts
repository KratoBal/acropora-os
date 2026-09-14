import { Module } from "@nestjs/common";

import { NotificationsModule } from "../notifications/notifications.module.js";
import { documentStoreProvider } from "../service-assets/document-store/document-store.provider.js";
import { ServiceJobDocumentsController } from "./service-job-documents.controller.js";
import { ServiceJobDocumentsRepository } from "./service-job-documents.repository.js";
import { ServiceJobDocumentsService } from "./service-job-documents.service.js";
import { ServiceJobsController } from "./service-jobs.controller.js";
import { ServiceJobsRepository } from "./service-jobs.repository.js";
import { ServiceJobsService } from "./service-jobs.service.js";

/**
 * A `documentStoreProvider` ITT IS SZEREPEL, ES EZ NEM MASOLASI HIBA.
 *
 * A `DOCUMENT_STORE` jelzot ma az `ServiceAssetsModule` allitja elo, es NEM
 * exportalja -- es egyetlen modul sem `@Global` ebben az alkalmazasban (merve
 * 2026-09-14: nulla `@Global` az `apps/api/src` fan). Egy modul tehat CSAK
 * akkor kapja meg, ha maga is felveszi a providerei koze.
 *
 * AMI ENELKUL TORTENIK, ES AMIERT NEM ELEG AZ `@Optional()`: a szolgaltatas
 * `undefined`-ot kap, es a feltoltesi ut 503-at ad, sajat uzenettel. Az uzenet
 * a KORNYEZETET nevezi meg ("a dokumentum-tarolo nincs beallitva"), holott a
 * kornyezet rendben van -- a BEKOTES hianyzik. Aki ezt latja, a hoszton fogja
 * keresni a kotetet.
 *
 * ES UGYANEZ A HIBAFAJTA ALL AZ `imports` SORBAN IS, csak masik jelzovel: az
 * ertesito is `@Optional()` fuggoseg. A ketto egymas melle kerulve mondja meg
 * a szabalyt: EBBEN a modulban KET olyan fuggoseg van, aminek a hianya nem
 * indulasi hiba, hanem CSENDES viselkedes-valtozas.
 */
@Module({
  // AZ ERTESITO BEKOTESE. A szolgaltatas `@Optional()` fuggosegkent veszi at
  // (a modul hat specje nem allitja elo), tehat ez a sor az EGYETLEN hely,
  // ahol a valodi kuldo a helyere kerul -- es a hianya NEMA volna: a delegalas
  // lefutna, csak nem szolna senkinek. Ezert all ra kulon allitas.
  imports: [NotificationsModule],
  controllers: [ServiceJobsController, ServiceJobDocumentsController],
  providers: [
    documentStoreProvider,
    ServiceJobsRepository,
    ServiceJobsService,
    ServiceJobDocumentsRepository,
    ServiceJobDocumentsService,
  ],
  exports: [ServiceJobsRepository, ServiceJobsService],
})
export class ServiceJobsModule {}
