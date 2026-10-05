import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";

import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import { DOCUMENT_STORE } from "../service-assets/document-store/document-store.provider.js";
import { MessagesRepository } from "./messages.repository.js";
import {
  ORPHAN_ATTACHMENT_TTL_MS,
  thumbnailDocumentId,
} from "./messages.rules.js";

/** Óránként néz körül; a határ 24 óra, tehát egy kör késés nem számít. */
export const ORPHAN_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * A GAZDÁTLAN FELTÖLTÉSEK TAKARÍTÁSA (acrobot döntése, 26242, emlék 2076): egy
 * csatolmány, amit feltöltöttek, de 24 óra alatt nem küldtek el, törölhető a
 * tárolóból és a táblából. Ez NEM üzenet-törlés: az üzenet törlése soft delete,
 * és ott a bájtok megmaradnak.
 *
 * Csak gazdátlant töröl: ha a sort közben egy küldés kötötte, a törlés feltétele
 * (`messageId: null`) nem teljesül, és a fájl is marad. A sor törlése megy
 * ELŐBB, a fájlé utána, így egy közben elküldött csatolmány fájlja nem tűnhet el.
 */
@Injectable()
export class MessageAttachmentCleanup implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessageAttachmentCleanup.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly repository: MessagesRepository,
    @Optional()
    @Inject(DOCUMENT_STORE)
    private readonly store?: DocumentStore,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.sweep(new Date()).catch((error: unknown) =>
        this.logger.warn(
          `A gazdátlan csatolmányok takarítása elbukott: ${error instanceof Error ? error.message : "ismeretlen hiba"}`,
        ),
      );
    }, ORPHAN_SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Egy kör: a határnál régebbi gazdátlanok törlése. A törölt darabszámot adja. */
  async sweep(now: Date): Promise<number> {
    if (!this.store) return 0;
    const orphans = await this.repository.orphanAttachments(
      new Date(now.getTime() - ORPHAN_ATTACHMENT_TTL_MS),
    );
    let removed = 0;
    for (const orphan of orphans) {
      if (!(await this.repository.deleteOrphanAttachment(orphan.id))) continue;
      removed++;
      await this.store.delete({
        owner: "message",
        ownerId: orphan.conversationId,
        documentId: orphan.id,
      });
      if (orphan.thumbnailKey)
        await this.store.delete({
          owner: "message",
          ownerId: orphan.conversationId,
          documentId: thumbnailDocumentId(orphan.id),
        });
    }
    if (removed > 0)
      this.logger.log(`Gazdátlan csatolmány törölve: ${removed} darab.`);
    return removed;
  }
}
