import {
  isNavigationEntryVisible,
  type AuthenticatedUser,
  type SearchResponse,
} from "@acropora/types";
import { Injectable } from "@nestjs/common";

import { partnerScopeOf } from "../auth/partner-scope.util.js";
import { AquariumsService } from "../aquariums/aquariums.service.js";
import { ServiceAssetsService } from "../service-assets/service-assets.service.js";
import { ServiceJobsService } from "../service-jobs/service-jobs.service.js";
import { SuppliersService } from "../suppliers/suppliers.service.js";
import { WorksheetsService } from "../worksheets/worksheets.service.js";

const LIMIT = 5;

const subtitle = (...parts: Array<string | null | undefined>) =>
  parts.filter((part): part is string => Boolean(part)).join(" · ");

@Injectable()
export class SearchService {
  constructor(
    private readonly serviceJobs: ServiceJobsService,
    private readonly worksheets: WorksheetsService,
    private readonly assets: ServiceAssetsService,
    private readonly suppliers: SuppliersService,
    private readonly aquariums: AquariumsService,
  ) {}

  async search(input: string | undefined, user: AuthenticatedUser) {
    const query = input?.trim();
    if (!query || query.length < 2) return {} satisfies SearchResponse;

    const canSee = (entryId: string) =>
      isNavigationEntryVisible(entryId, user.role);

    const [tickets, worksheets, assets, partners, aquariums] =
      await Promise.all([
        canSee("service-jobs")
          ? this.serviceJobs.list({ search: query }, user)
          : undefined,
        canSee("worksheets")
          ? this.worksheets.list({ page: 1, pageSize: 10, search: query }, user)
          : undefined,
        canSee("service-assets")
          ? this.assets.list(
              { page: 1, pageSize: 10, search: query, status: "ACTIVE" },
              user,
            )
          : undefined,
        canSee("partners")
          ? this.suppliers.list(
              { page: 1, pageSize: LIMIT, search: query, status: "ACTIVE" },
              partnerScopeOf(user),
            )
          : undefined,
        canSee("aquariums")
          ? this.aquariums.list({ page: 1, pageSize: 10, search: query }, user)
          : undefined,
      ]);

    return {
      ...(tickets === undefined
        ? {}
        : {
            tickets: tickets.items.slice(0, LIMIT).map((ticket) => ({
              id: ticket.id,
              title: ticket.title,
              subtitle: subtitle(
                ticket.jobNumber,
                ticket.customerName,
                ticket.departmentPath?.join(" / "),
              ),
              path: `/szerviz/hibajegyek/${ticket.id}`,
            })),
          }),
      ...(worksheets === undefined
        ? {}
        : {
            worksheets: worksheets.items.slice(0, LIMIT).map((worksheet) => ({
              id: worksheet.id,
              title: worksheet.subject,
              subtitle: subtitle(
                worksheet.number,
                worksheet.customerName,
                worksheet.departmentPath?.join(" / ") ??
                  worksheet.departmentCode,
              ),
              path: `/szerviz/munkalapok/${worksheet.id}`,
            })),
          }),
      ...(assets === undefined
        ? {}
        : {
            assets: assets.items.slice(0, LIMIT).map((asset) => ({
              id: asset.id,
              title: asset.name,
              subtitle: subtitle(
                asset.assetNumber,
                asset.owner.displayName,
                asset.unit?.path.join(" / ") ?? asset.address?.formatted,
              ),
              path: `/szerviz/eszkozok/${asset.id}`,
            })),
          }),
      ...(partners === undefined
        ? {}
        : {
            partners: partners.items.slice(0, LIMIT).map((partner) => ({
              id: partner.id,
              title: partner.name,
              subtitle: subtitle(partner.code, partner.city),
              path: `/partnerek/${partner.id}`,
            })),
          }),
      ...(aquariums === undefined
        ? {}
        : {
            aquariums: aquariums.items.slice(0, LIMIT).map((aquarium) => ({
              id: aquarium.id,
              title: aquarium.name,
              subtitle: subtitle(
                aquarium.aquariumNumber,
                aquarium.customerName,
                aquarium.departmentName,
              ),
              path: `/akvariumok/${aquarium.id}`,
            })),
          }),
    } satisfies SearchResponse;
  }
}
