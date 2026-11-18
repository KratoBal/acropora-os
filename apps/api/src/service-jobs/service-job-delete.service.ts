import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";

import type {
  AuthenticatedUser,
  ServiceJobDeletePreview,
  ServiceJobDeleteResult,
} from "@acropora/types";

import { partnerScopeOf } from "../auth/partner-scope.util.js";
import { discardStoredDocument } from "../documents/document-intake.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import { DOCUMENT_STORE } from "../service-assets/document-store/document-store.provider.js";
import {
  ServiceJobDeleteRefused,
  ServiceJobDeleteRepository,
} from "./service-job-delete.repository.js";
import {
  serviceJobDeleteRefusal,
  serviceJobDeleteWarnings,
} from "./service-job-delete.rules.js";
import { mayWriteServiceJob } from "./service-job-write-scope.js";

/**
 * A HIBAJEGY VÉGLEGES TÖRLÉSE (Balázs, 2026-11-18; acrobot 55766, 55770). Két út: az ELŐNÉZET (mit töröl, szabad-e) és a TÖRLÉS. A kettő ugyanazt a tiszta szabályt
 * futtatja, de a törlés a tényeket a tranzakción belül újraolvassa: az előnézet tájékoztat, a törlés dönt. Belső fiók kell hozzá (a partner a jegy létezéséről
 * sem tud: 404), a jogot (`service.job.delete`) a kontroller kapuja kéri.
 *
 * A TÁROLÓBA ÍRT CSATOLMÁNYOK a tranzakció UTÁN törlődnek a tárolóból. Ha egy törlés elbukik, a fájl marad (szemét, nem adatvesztés): a sorrend nem fordítható, mert egy
 * visszagörgetett törlés után a sor megmaradna fájl nélkül.
 */
@Injectable()
export class ServiceJobDeleteService {
  constructor(
    private readonly repository: ServiceJobDeleteRepository,
    @Optional()
    @Inject(DOCUMENT_STORE)
    private readonly documentStore?: DocumentStore,
  ) {}

  async preview(
    id: string,
    user: AuthenticatedUser,
  ): Promise<ServiceJobDeletePreview> {
    this.requireInternal(user);
    const snapshot = await this.repository.snapshot(id);
    if (!snapshot) throw new NotFoundException("A hibajegy nem található.");
    const refusal = serviceJobDeleteRefusal(snapshot.facts);
    return {
      jobNumber: snapshot.jobNumber,
      kind: snapshot.facts.kind,
      title: snapshot.title,
      deletable: refusal === null,
      refusal,
      counts: snapshot.counts,
      warnings: serviceJobDeleteWarnings(snapshot.facts),
    };
  }

  async delete(
    id: string,
    user: AuthenticatedUser,
  ): Promise<ServiceJobDeleteResult> {
    this.requireInternal(user);
    let removed;
    try {
      removed = await this.repository.remove({
        id,
        actorUserId: user.id,
        refusal: serviceJobDeleteRefusal,
      });
    } catch (error) {
      if (error instanceof ServiceJobDeleteRefused)
        throw new ConflictException(error.message);
      throw error;
    }
    if (!removed) throw new NotFoundException("A hibajegy nem található.");
    if (this.documentStore)
      for (const ref of removed.stored)
        await discardStoredDocument(ref, { store: this.documentStore });
    return { deleted: true, jobNumber: removed.jobNumber };
  }

  private requireInternal(user: AuthenticatedUser): void {
    if (!mayWriteServiceJob(partnerScopeOf(user)))
      throw new NotFoundException("A hibajegy nem található.");
  }
}
