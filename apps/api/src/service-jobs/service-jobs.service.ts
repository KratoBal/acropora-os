import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import type {
  CreateServiceJobDto,
  MoveServiceJobDto,
  ServiceJobListQueryDto,
} from "./dto.js";
import {
  nextServiceJobNumber,
  serviceJobNumberPrefix,
} from "./service-job-number.js";
import {
  partnerStatusLabel,
  partnerVisibleStatus,
} from "./service-job-status.js";
import {
  allowedServiceJobSteps,
  isServiceJobStepAllowed,
} from "./service-job-transitions.js";
import { ServiceJobsRepository } from "./service-jobs.repository.js";

@Injectable()
export class ServiceJobsService {
  constructor(private readonly repository: ServiceJobsRepository) {}

  async create(
    input: CreateServiceJobDto,
    actorUserId: string,
    now: Date = new Date(),
  ) {
    const year = now.getFullYear();
    const last = await this.repository.lastNumberOfYear(
      serviceJobNumberPrefix(year),
    );
    return this.repository.create({
      jobNumber: nextServiceJobNumber({ year, lastNumber: last }),
      title: input.title.trim(),
      description: input.description?.trim() || null,
      customerId: input.customerId?.trim() || null,
      actorUserId,
    });
  }

  /**
   * A LISTA MINDKÉT ÁLLAPOTOT VISZI: a belsőt és a partnernek látszót.
   *
   * Nem redundancia. A belső szerint dolgozunk (egy alkatrészre váró jegyet
   * máshogy kezelünk, mint egy ütemezettet), a látszó pedig az, amit a partner
   * felé bármikor kimondhatunk. Ha csak az egyiket adnánk vissza, a hívó
   * kezdené el képezni a másikat - és a leképezés attól a pillanattól két
   * helyen állna.
   */
  async list(query: ServiceJobListQueryDto) {
    const rows = await this.repository.list(query.scope ?? "open");
    return {
      items: rows.map((row) => ({
        id: row.id,
        jobNumber: row.jobNumber,
        title: row.title,
        status: row.status,
        partnerStatus: partnerVisibleStatus(row.status),
        partnerStatusLabel: partnerStatusLabel(row.status),
        customerName: row.customerName,
        worksheetCount: row.worksheetCount,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  /**
   * EGY LÉPÉS A JEGYEN, A TÁBLA SZERINT.
   *
   * A SZABÁLYT A TISZTA FÜGGVÉNY MONDJA MEG, nem ez a metódus: itt csak az
   * dől el, mi történjen az elutasítással. Így az átmenetek szabálya
   * adatbázis nélkül is mérhető marad.
   *
   * AZ ELUTASÍTÁS MEGNEVEZI, MI MEHETNE HELYETTE. Egy puszta „nem lehet"
   * arra kényszerítené a felhasználót, hogy sorra próbálgassa a gombokat -
   * és a válasz úgyis a szerveren áll, tehát olcsóbb kimondani.
   */
  async move(id: string, input: MoveServiceJobDto, actorUserId: string) {
    const from = await this.repository.statusOf(id);
    if (from === null) throw new NotFoundException("A hibajegy nem található.");

    if (!isServiceJobStepAllowed(from, input.to)) {
      const lehet = allowedServiceJobSteps(from);
      throw new BadRequestException(
        lehet.length === 0
          ? "Ez a hibajegy lezárult, nincs több lépése."
          : `Ebből az állapotból ezek a lépések mehetnek: ${lehet.join(", ")}.`,
      );
    }

    const moved = await this.repository.move({
      id,
      from,
      to: input.to,
      note: input.note?.trim() || null,
      actorUserId,
    });
    // A LÉPÉS FELTÉTELE A `from` VOLT: ha közben más lépett, nem írjuk felül
    // csendben, hanem megmondjuk, hogy elmozdult alattunk.
    if (!moved.ok)
      throw new ConflictException(
        "A hibajegy időközben másik állapotba került. Töltsd újra, és nézd meg, mi történt.",
      );
    return { ok: true };
  }
}
