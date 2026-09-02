import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import {
  serviceJobTimeline,
  type ServiceJobDetail,
  type ServiceJobListResponse,
} from "@acropora/types";

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
   *
   * A VISSZATÉRÉSI TÍPUS KI VAN ÍRVA, és ez nem díszítés: a felület ugyanezt a
   * típust importálja a közös csomagból. Kiírás nélkül a szerver alakja
   * elmozdulhatna (egy átnevezett mező mindkét oldalon lefordul), és a
   * képernyőn `undefined` jelenne meg, hibaüzenet nélkül.
   */
  async list(query: ServiceJobListQueryDto): Promise<ServiceJobListResponse> {
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
   * A RÉSZLETLAP: A JEGY, ÉS AMI TÖRTÉNT VELE.
   *
   * HÁROM KÜLÖN LISTÁT AD VISSZA, nem egy összefésült sort. Ez a ház mintája
   * (a munkalap részletlapja is így teszi), az összefésülés viszont NEM a
   * kliensé: a `serviceJobTimeline` a közös csomagban áll, mert a web és a
   * mobil külön fésülve két helyen tartaná ugyanazt a sorrend-szabályt.
   *
   * AZ IDŐPONTOK A NAPLÓBÓL JÖNNEK. A jegyen ott van `startedAt` és
   * `completedAt` is, de azokat ma semmi nem írja, és ha ez a metódus írná
   * őket, két írónk lenne egy tényre. Az elcsúszásuk néma hiba volna.
   */
  async detail(id: string): Promise<ServiceJobDetail> {
    const row = await this.repository.detail(id);
    if (row === null) throw new NotFoundException("A hibajegy nem található.");

    return {
      id: row.id,
      jobNumber: row.jobNumber,
      title: row.title,
      description: row.description,
      status: row.status,
      partnerStatus: partnerVisibleStatus(row.status),
      partnerStatusLabel: partnerStatusLabel(row.status),
      customerName: row.customer?.displayName ?? null,
      createdAt: row.createdAt.toISOString(),
      // A tábla `readonly` tömböt ad (nem írható felül kívülről); a válasz
      // sima tömb, ezért itt másolat készül róla.
      scheduledAt: row.scheduledAt?.toISOString() ?? null,
      startedAt: row.startedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      allowedSteps: [...allowedServiceJobSteps(row.status)],
      // AZ ÖSSZEFÉSÜLÉS ITT TÖRTÉNIK, NEM A KLIENSBEN. A sorrend szabály, és a
      // mobil csomag nem is éri el ezt a közös függvényt (nem függ a
      // `@acropora/types`-tól), tehát ott újraíródna - két kliens, két
      // sorrend, és a különbség néma, mert mindkettő hihetően néz ki.
      timeline: serviceJobTimeline({
        events: row.events.map((event) => ({
          id: event.id,
          fromStatus: event.fromStatus,
          toStatus: event.toStatus,
          note: event.note,
          actorName: event.actor?.displayName ?? null,
          createdAt: event.createdAt.toISOString(),
        })),
        worksheets: row.worksheets.map((worksheet) => ({
          id: worksheet.id,
          number: worksheet.number,
          createdAt: worksheet.createdAt.toISOString(),
          handedOverAt: worksheet.handedOverAt?.toISOString() ?? null,
        })),
        assets: row.assets.map((link) => ({
          id: link.id,
          assetId: link.assetId,
          assetNumber: link.asset.assetNumber,
          assetName: link.asset.name,
          attachedAt: link.createdAt.toISOString(),
        })),
      }),
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
  async move(
    id: string,
    input: MoveServiceJobDto,
    actorUserId: string,
    now: Date = new Date(),
  ) {
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
      now,
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
