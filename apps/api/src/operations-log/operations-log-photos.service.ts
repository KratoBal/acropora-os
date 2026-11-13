import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  OPERATIONS_ENTRY_LIMITS,
  type OperationsLogEntryPhotoDto,
} from "@acropora/types";

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
import { isPrismaUniqueConstraintViolation } from "../common/prisma-error.util.js";
import { OperationsLogEntriesRepository } from "./operations-log-entries.repository.js";
import { OperationsLogRepository } from "./operations-log.repository.js";

const OWNER = "operations-log" as const;

export const ENTRY_NOT_FOUND_MESSAGE = "A bejegyzés nem található.";
export const PHOTO_ONLY_MESSAGE =
  "A bejegyzéshez csak fénykép (JPEG vagy PNG) csatolható.";

/**
 * AZ ÜZEMELTETÉSI NAPLÓ BEJEGYZÉSÉNEK KÉPEI (task os-uzemeltetesi-naplo, S2b), az elhullási napló fényképeinek mintájára: a
 * feltöltés szabályai (tartalom-felismerés, fájlnév, sha256, keret, tároló, bélyegkép) a közös magban állnak
 * (`documents/document-intake.ts`). Eltérések:
 *
 * - A KÉP EGY FÉNYKÉP MEZŐHÖZ KÖTÖTT: a mező kulcsának a bejegyzés sablonjában fénykép típusú mezőre kell mutatnia (a kivezetett
 *   mezőre is: egy offline sorban várt kép nem veszhet el a közben történt kivezetés miatt). A mező címkéje a kép mellett
 *   pillanatfelvételként tárolódik.
 * - CSAK A RÖGZÍTŐ csatolhat: a kép a telefonról jön, amelyik a bejegyzést is rögzítette.
 * - IDEMPOTENS: a kliens-azonosító az offline sor újraküldésénél ugyanazt a képet adja vissza, nem másodikat; más rögzítő
 *   ugyanazzal a kulccsal 409-et kap.
 * - Nincs törlés: a kép a naplóbejegyzés bizonyítéka.
 */
@Injectable()
export class OperationsLogPhotosService {
  private readonly logger = new Logger(OperationsLogPhotosService.name);

  constructor(
    private readonly entries: OperationsLogEntriesRepository,
    private readonly templates: OperationsLogRepository,
    @Optional()
    @Inject(DOCUMENT_STORE)
    private readonly documentStore?: DocumentStore,
  ) {}

  async addPhoto(
    entryId: string,
    file: Express.Multer.File,
    actorUserId: string,
    input: {
      fieldKey: string;
      clientOperationId?: string | null;
      caption?: string | null;
    },
  ): Promise<{ photo: OperationsLogEntryPhotoDto; created: boolean }> {
    const clientOperationId = input.clientOperationId?.trim() || null;
    if (clientOperationId) {
      const existing =
        await this.entries.photoByClientOperationId(clientOperationId);
      if (existing) return this.replay(existing, entryId, actorUserId);
    }

    const entry = await this.entries.entryRef(entryId);
    if (!entry) throw new NotFoundException(ENTRY_NOT_FOUND_MESSAGE);
    if (entry.recordedById !== actorUserId)
      throw new ForbiddenException(
        "Fényképet csak a bejegyzés rögzítője csatolhat.",
      );

    const template = await this.templates.templateById(entry.templateId);
    const field = template
      ? [...template.fields, ...template.retiredFields].find(
          (candidate) => candidate.key === input.fieldKey,
        )
      : undefined;
    if (!field || field.type !== "PHOTO")
      throw new BadRequestException(
        "A megadott mező nem fénykép mező ezen a bejegyzésen.",
      );
    if (
      (await this.entries.photoCount(entryId, field.key)) >=
      OPERATIONS_ENTRY_LIMITS.photosPerFieldMax
    )
      throw new ConflictException(
        `Egy fénykép mezőhöz legfeljebb ${OPERATIONS_ENTRY_LIMITS.photosPerFieldMax} kép csatolható.`,
      );

    const kind = detectUploadedFileKind(file.mimetype, file.buffer);
    if (kind !== "jpeg" && kind !== "png")
      throw new BadRequestException(PHOTO_ONLY_MESSAGE);
    const caption = normalizeDocumentCaption(input.caption);

    if (!this.documentStore)
      throw new ServiceUnavailableException(
        "A dokumentum-tároló nincs beállítva ebben a példányban.",
      );

    const documentId = randomUUID();
    let prepared;
    try {
      prepared = await prepareDocument(
        { owner: OWNER, ownerId: entryId, documentId, file },
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

    const row = {
      ...prepared.common,
      entryId,
      fieldKey: field.key,
      fieldLabel: field.label,
      clientOperationId,
      caption,
      actorUserId,
    };
    try {
      const photo =
        prepared.placement === "database"
          ? await this.entries.addPhoto({ ...row, content: prepared.content })
          : await this.entries.addPhoto({
              ...row,
              content: null,
              storageKey: prepared.storageKey,
            });
      return { photo, created: true };
    } catch (error) {
      // a sor nem jött létre, tehát a fájl sem maradhat
      if (prepared.placement !== "database")
        await discardStoredDocument(
          { owner: OWNER, ownerId: entryId, documentId },
          { store: this.documentStore },
        );
      // két párhuzamos újraküldés: a vesztes a nyertes képét kapja
      if (
        clientOperationId &&
        isPrismaUniqueConstraintViolation(error, "clientOperationId")
      ) {
        const winner =
          await this.entries.photoByClientOperationId(clientOperationId);
        if (winner) return this.replay(winner, entryId, actorUserId);
      }
      throw error;
    }
  }

  private replay(
    existing: {
      photo: OperationsLogEntryPhotoDto;
      entryId: string;
      uploadedById: string | null;
    },
    entryId: string,
    actorUserId: string,
  ) {
    if (existing.entryId !== entryId || existing.uploadedById !== actorUserId)
      throw new ConflictException(
        "Ez a művelet-azonosító már egy másik feltöltésé.",
      );
    return { photo: existing.photo, created: false };
  }

  /** Egy kép bájtjai; `variant=thumbnail` esetén a bélyegkép, ha van. */
  async photoBytes(entryId: string, documentId: string, variant?: string) {
    if (!(await this.entries.entryRef(entryId)))
      throw new NotFoundException(ENTRY_NOT_FOUND_MESSAGE);

    if (wantsThumbnail(variant)) {
      const small = await this.entries.photoThumbnail(entryId, documentId);
      if (small) return thumbnailResponse(small);
    }

    const photo = await this.entries.photo(entryId, documentId);
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

    const key = { owner: OWNER, ownerId: entryId, documentId };
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
