import { Injectable } from "@nestjs/common";

import type { CreateServiceJobDto, ServiceJobListQueryDto } from "./dto.js";
import {
  nextServiceJobNumber,
  serviceJobNumberPrefix,
} from "./service-job-number.js";
import {
  partnerStatusLabel,
  partnerVisibleStatus,
} from "./service-job-status.js";
import { ServiceJobsRepository } from "./service-jobs.repository.js";

@Injectable()
export class ServiceJobsService {
  constructor(private readonly repository: ServiceJobsRepository) {}

  async create(input: CreateServiceJobDto, now: Date = new Date()) {
    const year = now.getFullYear();
    const last = await this.repository.lastNumberOfYear(
      serviceJobNumberPrefix(year),
    );
    return this.repository.create({
      jobNumber: nextServiceJobNumber({ year, lastNumber: last }),
      title: input.title.trim(),
      description: input.description?.trim() || null,
      customerId: input.customerId?.trim() || null,
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
}
