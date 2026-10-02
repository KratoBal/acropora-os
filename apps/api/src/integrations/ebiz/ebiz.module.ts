import { Module } from "@nestjs/common";

import { documentStoreProvider } from "../../service-assets/document-store/document-store.provider.js";
import { EbizClient } from "./ebiz.client.js";
import { EbizSyncScheduler } from "./ebiz-sync.scheduler.js";
import {
  EBIZ_SYNC_STORE,
  EbizSyncService,
  PrismaEbizSyncStore,
} from "./ebiz-sync.service.js";

/** OTP eBIZ, read only: the client, the daily sync and its scheduler. */
@Module({
  providers: [
    EbizClient,
    EbizSyncService,
    EbizSyncScheduler,
    { provide: EBIZ_SYNC_STORE, useClass: PrismaEbizSyncStore },
    documentStoreProvider,
  ],
  exports: [EbizSyncService],
})
export class EbizModule {}
