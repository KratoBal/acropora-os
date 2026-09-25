import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { AquariumMeasurementMailService } from "../notifications/mail/aquarium-measurement-mail.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { AquariumMeasurementXlsx } from "./aquarium-measurement-xlsx.js";
import { AquariumMeasurementsRepository } from "./aquarium-measurements.repository.js";
import { AquariumsRepository } from "./aquariums.repository.js";
import type { CreateAquariumMeasurementDto } from "./dto/aquarium-measurement.dto.js";

@Injectable()
export class AquariumMeasurementsService {
  constructor(
    private readonly repository: AquariumMeasurementsRepository,
    private readonly aquariums: AquariumsRepository,
    private readonly notifications: NotificationsService,
    private readonly mail: AquariumMeasurementMailService,
    private readonly xlsx: AquariumMeasurementXlsx,
  ) {}

  async list(aquariumId: string) {
    await this.requireAquarium(aquariumId);
    return this.repository.list(aquariumId);
  }

  /**
   * A PUSH-ÉRTESÍTÉS A MENTÉS UTÁN, DE A HÍVÓ VÁLASZÁT NEM VÁRAKOZTATJA --
   * ugyanaz a szabály, mint minden más értesítésnél ebben a rendszerben
   * (lásd `NotificationsService` fejlécét): nincs sor, tehát a küldés a
   * mentés UTÁN, BEVÁRÁS NÉLKÜL indul (`notify...`, nem `deliver...`).
   *
   * A `created === false` ÁGON NEM KÜLDÜNK: ez a klienskulcs miatt
   * VISSZAADOTT, MÁR LÉTEZŐ alkalom -- egy offline sorból megismételt
   * kérés, aminek a válasza korábban elveszett. Balázs kérése kimondottan
   * EGYSZERI értesítést kér erre az esetre is; lásd
   * `aquarium-measurements.repository.ts` `AquariumMeasurementCreateResult`
   * fejlécét, miért nem lehetne ezt itt, a `create` eredményéből kitalálni.
   */
  async create(
    aquariumId: string,
    input: CreateAquariumMeasurementDto,
    actorUserId: string,
  ) {
    const aquarium = await this.requireAquarium(aquariumId);
    this.rejectFutureMeasuredAt(input.measuredAt);
    const result = await this.repository.create(aquariumId, input, actorUserId);

    if (result.created) {
      /**
       * A CÍMZETT-KÖR: A KARBANTARTÓK, AZ ÉRTESÍTŐ NÉLKÜL.
       *
       * Balázs kérése, szó szerint: "push üzenetet, hogy új vízmérés
       * eredménye van" -- de aki épp MOST rögzítette, az tudja, hogy
       * rögzítette. A `detail()`-ből kapott `maintainers` lista már a mai
       * állapotot tükrözi, tehát nem kell külön lekérdezés.
       */
      const recipientIds = aquarium.maintainers
        .map((maintainer) => maintainer.userId)
        .filter((userId) => userId !== actorUserId);
      this.notifications.notifyAquariumMeasurementRecorded({
        aquariumId,
        aquariumName: aquarium.name,
        userIds: recipientIds,
      });
    }

    return result.occasion;
  }

  async delete(aquariumId: string, occasionId: string): Promise<void> {
    await this.requireAquarium(aquariumId);
    const removed = await this.repository.delete(aquariumId, occasionId);
    if (removed === 0)
      throw new NotFoundException("A mérési alkalom nem található.");
  }

  /**
   * "EREDMÉNY KÜLDÉSE E-MAILBEN" -- GOMBRA, NEM AUTOMATIKUS.
   *
   * Balázs kérése: csak akkor ajánljuk fel, ha az ügyfélnek van e-mail
   * címe -- ez a web felületen a gomb feltétele, ITT pedig kikényszerítve
   * is áll, mert a hívó (más kliens, script) nem hagyatkozhat a felület
   * rejtésére.
   */
  async sendEmail(
    aquariumId: string,
    occasionId: string,
    actorUserId: string,
  ): Promise<void> {
    const aquarium = await this.requireAquarium(aquariumId);
    if (!aquarium.customerEmail)
      throw new BadRequestException(
        "Az ügyfélnek nincs e-mail címe, ezért nem küldhető el az eredmény.",
      );
    const occasions = await this.repository.list(aquariumId);
    const occasion = occasions.occasions.find((o) => o.id === occasionId);
    if (!occasion)
      throw new NotFoundException("A mérési alkalom nem található.");

    await this.mail.send({
      aquariumId,
      aquariumName: aquarium.name,
      occasion,
      customerEmail: aquarium.customerEmail,
      customerName: aquarium.customerName ?? "Ügyfél",
      actorUserId,
    });
  }

  /** A "Letöltés Excelben" gomb kiszolgálója -- lásd `AquariumMeasurementXlsx` fejlécét. */
  async exportXlsx(
    aquariumId: string,
  ): Promise<{ filename: string; buffer: Buffer }> {
    const aquarium = await this.requireAquarium(aquariumId);
    const measurements = await this.repository.list(aquariumId);
    const buffer = await this.xlsx.build({
      aquariumName: aquarium.name,
      waterType: aquarium.waterType,
      measurements,
    });
    return { filename: this.xlsx.filename(aquarium.name), buffer };
  }

  /**
   * A "MÉRÉS IDEJE" MEZŐ MOSTANTÓL SZERKESZTHETŐ (Balázs kérése,
   * 2026-09-25: "elofordulhat, hogy nem akkor mertuk, amikor rogzitjuk"),
   * DE A JÖVŐBE NEM MUTATHAT: az akvárium ma nem tud olyan mérést, amit
   * még nem végeztek el. Csak akkor ellenőrizzük, ha a hívó egyáltalán
   * küldött `measuredAt`-et -- a mező hiányában a repository a mentés
   * pillanatát írja, ami definíció szerint nem lehet jövőbeli.
   */
  private rejectFutureMeasuredAt(measuredAt: string | undefined): void {
    if (!measuredAt) return;
    if (new Date(measuredAt).getTime() > Date.now())
      throw new BadRequestException("A mérés ideje nem lehet a jövőben.");
  }

  private async requireAquarium(id: string) {
    const aquarium = await this.aquariums.detail(id);
    if (!aquarium) throw new NotFoundException("Az akvárium nem található.");
    return aquarium;
  }
}
