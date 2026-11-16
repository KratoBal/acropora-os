import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  AuthenticatedUser,
  OperationsReportResponse,
} from "@acropora/types";

import { partnerScopeOf } from "../auth/partner-scope.util.js";
import type { UnitRow } from "../service-assets/unit-path.js";
import { collectUnitSubtreeIds } from "../service-assets/unit-subtree.js";
import { OperationsReportRepository } from "./operations-report.repository.js";
import { OperationsReportService } from "./operations-report.service.js";

export interface OperationsPartnerSite {
  id: string;
  parentId: string | null;
  name: string;
}

/**
 * A HELYSZÍNEK, AMELYEKNEK A KIMUTATÁSA NEM ÜRES (kártya f6694b49, Balázs 2026-11-15 15:21 UTC: a partner az ÖSSZES helyszínét
 * látta): egy helyszín akkor marad, ha a RÉSZFÁJÁBAN van aktív egység (sablonos élő eszköz vagy bejegyzés). Ugyanaz a részfa,
 * amire a kimutatás készül (`scope`), tehát egy szülő akkor is marad, ha csak a gyerekén van mit mutatni; és a fa nem szakad
 * szét: ha egy gyerek marad, a szülője is.
 */
export function sitesWithActivity(
  sites: readonly OperationsPartnerSite[],
  units: readonly UnitRow[],
  active: ReadonlySet<string>,
): OperationsPartnerSite[] {
  return sites.filter((site) =>
    collectUnitSubtreeIds(units, site.id).some((id) => active.has(id)),
  );
}

/**
 * AZ ÜZEMELTETÉSI NAPLÓ A PARTNER SZEMÉVEL (task os-uzemeltetesi-naplo, S5): a partner-fiók a SAJÁT helyszíneinek havi kimutatását
 * látja, olvasva. Ugyanazt a számítást kapja, mint a belső nézet (`buildOperationsReport`), `PARTNER` nézővel: a kollégák neve
 * „Acropora", a szabad szövegű értékek és a belső megjegyzés nincs benne.
 *
 * A LÁTHATÓSÁG A MEGLÉVŐ HELYSZÍN-SZABÁLY (ugyanaz, mint az akváriumnál és a hibajegynél): a partner-fiók a saját ügyfelének azokat
 * a helyszíneit látja, amelyek a felhasználóhoz HOZZÁ vannak rendelve (a részfájukkal együtt). Hozzárendelés nélkül a lista üres:
 * az üres válasz a szándék (a hiány nem nyit meg semmit). Belső felhasználó (és a szállító-hatókör) ezen az úton nem jut semmihez.
 */
@Injectable()
export class OperationsPartnerService {
  constructor(
    private readonly repository: OperationsReportRepository,
    private readonly reports: OperationsReportService,
  ) {}

  /** A partner látható helyszínei; `null` hatókörnél a felhasználó nem partner-fiók. */
  private async visibleSites(
    user: AuthenticatedUser,
  ): Promise<OperationsPartnerSite[]> {
    const scope = partnerScopeOf(user);
    if (scope.kind !== "customer")
      throw new ForbiddenException(
        "Ez a nézet a partner-fiókoké: a belső felhasználók az üzemeltetési napló belső nézetét használják.",
      );
    const unitIds = await this.repository.assignedUnitIds(user.id);
    return this.repository.partnerSites(scope.customerId, unitIds);
  }

  /**
   * A HELYSZÍN-VÁLASZTÓ LISTÁJA: a látható helyszínek közül azok, amelyeknek a kimutatása nem üres (`sitesWithActivity`). A
   * kimaradtak SZÁMA is megy (`withoutActivity`): a portál így meg tudja különböztetni a „nincs hozzád rendelt helyszín" és a „van,
   * de még nincs mit mutatni" állapotot. A SZŰRÉS A LISTÁRA SZÓL, NEM A LÁTHATÓSÁGRA: a `report` a szűretlen helyszínekkel dönt, egy
   * könyvjelzőzött, még tevékenység nélküli helyszín kimutatása tehát megnyílik (üresen).
   */
  async sites(
    user: AuthenticatedUser,
  ): Promise<{ items: OperationsPartnerSite[]; withoutActivity: number }> {
    const visible = await this.visibleSites(user);
    if (visible.length === 0) return { items: [], withoutActivity: 0 };
    const scope = partnerScopeOf(user);
    const units =
      scope.kind === "customer"
        ? await this.repository.customerUnits(scope.customerId)
        : [];
    const subtreeIds = [
      ...new Set(
        visible.flatMap((site) => collectUnitSubtreeIds(units, site.id)),
      ),
    ];
    const active = await this.repository.departmentsWithActivity(subtreeIds);
    const items = sitesWithActivity(visible, units, active);
    return { items, withoutActivity: visible.length - items.length };
  }

  /**
   * A KIMUTATÁS EGY LÁTHATÓ HELYSZÍNRE. A nem látható (idegen vagy hozzá nem rendelt) helyszín ugyanazt a 404-et adja, mint a nem
   * létező: a válasz nem árulja el, hogy a helyszín létezik-e.
   */
  async report(
    user: AuthenticatedUser,
    query: { month: string; departmentId?: string },
    now?: Date,
  ): Promise<OperationsReportResponse> {
    const sites = await this.visibleSites(user);
    const departmentId = query.departmentId?.trim();
    if (!departmentId || !sites.some((site) => site.id === departmentId))
      throw new NotFoundException("A helyszín nem található.");
    return this.reports.build(
      { month: query.month, departmentId },
      "PARTNER",
      now,
    );
  }
}
