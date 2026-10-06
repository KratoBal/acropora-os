import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { MortalityPhoto } from "@acropora/types";

import {
  discardStoredDocument,
  DocumentOverQuota,
  DocumentRejected,
  prepareDocument,
} from "../documents/document-intake.js";
import { sumDocumentBytesInUse } from "../documents/document-bytes-in-use.js";
import { normalizeDocumentCaption } from "../documents/document-caption.js";
import {
  thumbnailResponse,
  wantsThumbnail,
} from "../documents/document-thumbnail.js";
import { assertStorageKeyMatches } from "../service-assets/document-store/document-storage-key.js";
import {
  documentUnavailableMessage,
  type DocumentStore,
} from "../service-assets/document-store/document-store.js";
import { DOCUMENT_STORE } from "../service-assets/document-store/document-store.provider.js";
import { detectUploadedFileKind } from "../service-assets/uploaded-file-type.js";
import { MortalityRepository } from "./mortality.repository.js";
import { RECORD_NOT_FOUND_MESSAGE } from "./mortality.service.js";

const OWNER = "mortality" as const;

export const PHOTO_ONLY_MESSAGE =
  "Az elhullási bejegyzéshez csak fénykép (JPEG vagy PNG) csatolható.";

/**
 * AZ ELHULLÁSI BEJEGYZÉS FÉNYKÉPEI (kártya 115c9740).
 *
 * A feltöltés szabályai (tartalom-felismerés, fájlnév, sha256, keret, tároló,
 * bélyegkép) a közös magban állnak (`documents/document-intake.ts`); ez a
 * hibajegy csatolmányainak mintája, két eltéréssel:
 * - CSAK KÉP: a prompt fényképet kér, a PDF-et 400-zal elutasítjuk, még a
 *   keret-ellenőrzés előtt;
 * - NINCS TÖRLÉS: a bejegyzésnek sincs (acrobot döntése, 27141), és a fénykép a
 *   bizonyítéka.
 */
@Injectable()
export class MortalityPhotosService {
  private readonly logger = new Logger(MortalityPhotosService.name);

  constructor(
    private readonly repository: MortalityRepository,
    @Optional()
    @Inject(DOCUMENT_STORE)
    private readonly documentStore?: DocumentStore,
  ) {}

  private async requireRecord(id: string) {
    if (!(await this.repository.exists(id)))
      throw new NotFoundException(RECORD_NOT_FOUND_MESSAGE);
  }

  async addPhoto(
    id: string,
    file: Express.Multer.File,
    actorUserId: string,
    caption?: string | null,
  ): Promise<MortalityPhoto> {
    await this.requireRecord(id);
    const kind = detectUploadedFileKind(file.mimetype, file.buffer);
    if (kind !== "jpeg" && kind !== "png")
      throw new BadRequestException(PHOTO_ONLY_MESSAGE);
    const felirat = normalizeDocumentCaption(caption);

    if (!this.documentStore)
      throw new ServiceUnavailableException(
        "A dokumentum-tároló nincs beállítva ebben a példányban.",
      );

    const documentId = randomUUID();
    let prepared;
    try {
      prepared = await prepareDocument(
        { owner: OWNER, ownerId: id, documentId, file },
        {
          store: this.documentStore,
          usedBytes: () => sumDocumentBytesInUse(),
          logger: this.logger,
        },
      );
    } catch (error) {
      if (error instanceof DocumentRejected)
        throw new BadRequestException(error.message);
      if (error instanceof DocumentOverQuota)
        throw new ConflictException(error.message);
      throw error;
    }

    if (prepared.placement === "database")
      return this.repository.addPhoto({
        ...prepared.common,
        mortalityRecordId: id,
        caption: felirat,
        actorUserId,
        content: prepared.content,
      });

    try {
      return await this.repository.addPhoto({
        ...prepared.common,
        mortalityRecordId: id,
        caption: felirat,
        actorUserId,
        content: null,
        storageKey: prepared.storageKey,
      });
    } catch (error) {
      // a sor nem jött létre, tehát a fájl sem maradhat
      await discardStoredDocument(
        { owner: OWNER, ownerId: id, documentId },
        { store: this.documentStore },
      );
      throw error;
    }
  }

  /** Egy fénykép bájtjai; `variant=thumbnail` esetén a bélyegkép, ha van. */
  async photoBytes(id: string, documentId: string, variant?: string) {
    await this.requireRecord(id);

    if (wantsThumbnail(variant)) {
      const kicsi = await this.repository.photoThumbnail(id, documentId);
      if (kicsi) return thumbnailResponse(kicsi);
    }

    const photo = await this.repository.photo(id, documentId);
    if (!photo) throw new NotFoundException("A fénykép nem található.");
    if (photo.content)
      return {
        fileName: photo.fileName,
        contentType: photo.contentType,
        bytes: Buffer.from(photo.content),
      };

    if (!this.documentStore)
      throw new ServiceUnavailableException(
        "A dokumentum-tároló nincs beállítva ebben a példányban.",
      );
    if (!photo.storageKey)
      throw new ServiceUnavailableException(
        "A fényképnek nincs tartalma egyik forrásban sem.",
      );

    const key = { owner: OWNER, ownerId: id, documentId };
    assertStorageKeyMatches(photo.storageKey, key);
    const bytes = await this.documentStore.get(key);
    if (!bytes)
      throw new ServiceUnavailableException(documentUnavailableMessage());
    return {
      fileName: photo.fileName,
      contentType: photo.contentType,
      bytes: Buffer.from(bytes),
    };
  }
}
