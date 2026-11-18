import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";

import type {
  AuthenticatedUser,
  WorksheetDeletePreview,
  WorksheetDeleteResult,
} from "@acropora/types";

import { partnerScopeOf } from "../auth/partner-scope.util.js";
import { discardStoredDocument } from "../documents/document-intake.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import { DOCUMENT_STORE } from "../service-assets/document-store/document-store.provider.js";
import {
  WorksheetDeleteRefused,
  WorksheetDeleteRepository,
} from "./worksheet-delete.repository.js";
import {
  worksheetDeleteRefusal,
  worksheetDeleteWarnings,
} from "./worksheet-delete.rules.js";

/**
 * AZ ÖNÁLLÓ, NEM LEZÁRT MUNKALAP VÉGLEGES TÖRLÉSE (a hibajegy-törlés 2. szelete; acrobot 55770). Ugyanaz a két út és ugyanaz a rend, mint a jegynél: az előnézet tájékoztat, a törlés a
 * tranzakción belül újraolvasott tényekből dönt; a tiltás 409, a hiányzó lap 404, a partner nem tud róla (404); a tárolóba írt csatolmányok a SIKERES törlés után mennek ki a tárolóból.
 */
@Injectable()
export class WorksheetDeleteService {
  constructor(
    private readonly repository: WorksheetDeleteRepository,
    @Optional()
    @Inject(DOCUMENT_STORE)
    private readonly documentStore?: DocumentStore,
  ) {}

  async preview(
    id: string,
    user: AuthenticatedUser,
  ): Promise<WorksheetDeletePreview> {
    this.requireInternal(user);
    const snapshot = await this.repository.snapshot(id);
    if (!snapshot) throw new NotFoundException("A munkalap nem található.");
    const refusal = worksheetDeleteRefusal(snapshot.facts);
    return {
      label: snapshot.label,
      deletable: refusal === null,
      refusal,
      counts: snapshot.counts,
      warnings: worksheetDeleteWarnings(snapshot.facts),
    };
  }

  async delete(
    id: string,
    user: AuthenticatedUser,
  ): Promise<WorksheetDeleteResult> {
    this.requireInternal(user);
    let removed;
    try {
      removed = await this.repository.remove({
        id,
        actorUserId: user.id,
        refusal: worksheetDeleteRefusal,
      });
    } catch (error) {
      if (error instanceof WorksheetDeleteRefused)
        throw new ConflictException(error.message);
      // sorosítási hiba (P2034): egy egyidejű írás (aláírás, folytatás, beszerzés) a törlés olvasott soraihoz ért; a törlés elmaradt, újrapróbálható
      if ((error as { code?: string } | null)?.code === "P2034")
        throw new ConflictException(
          "A munkalap közben megváltozott, ezért a törlés elmaradt. Próbáld újra.",
        );
      throw error;
    }
    if (!removed) throw new NotFoundException("A munkalap nem található.");
    if (this.documentStore)
      for (const ref of removed.stored)
        await discardStoredDocument(ref, { store: this.documentStore });
    return { deleted: true };
  }

  private requireInternal(user: AuthenticatedUser): void {
    if (partnerScopeOf(user).kind !== "internal")
      throw new NotFoundException("A munkalap nem található.");
  }
}
