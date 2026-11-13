import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  buildOperationsReport,
  isMonthKey,
  monthBounds,
  type OperationsReportResponse,
  type OperationsReportAudience,
} from "@acropora/types";

import { OperationsReportRepository } from "./operations-report.repository.js";

export type OperationsReportResult = OperationsReportResponse;

/**
 * A HAVI KIMUTATÁS (task os-uzemeltetesi-naplo, S4). A hatókör KÖTELEZŐ: egy helyszín (a részfájával) vagy egy eszköz: egy „minden
 * helyszín" kimutatás a kategória-sablonok miatt több ezer sort adna, és Balázs kimutatása helyszínenként készül.
 *
 * A bejegyzések a hónap ELŐTTI hét nappal együtt töltődnek be: a hét-határon átnyúló heti feladat azt a hetet a hónap előtti
 * bejegyzéssel is teljesítettnek látja (a számítás a hónapon kívüli sorokat nem sorolja, csak a kimaradásnál használja).
 */
@Injectable()
export class OperationsReportService {
  constructor(private readonly repository: OperationsReportRepository) {}

  async build(
    input: {
      month: string;
      departmentId?: string;
      assetId?: string;
    },
    audience: OperationsReportAudience,
    now: Date = new Date(),
  ): Promise<OperationsReportResult> {
    if (!isMonthKey(input.month))
      throw new BadRequestException("A hónap alakja ÉÉÉÉ-HH legyen.");
    const departmentId = input.departmentId?.trim() || undefined;
    const assetId = input.assetId?.trim() || undefined;
    if (!departmentId && !assetId)
      throw new BadRequestException(
        "Add meg a helyszínt vagy az eszközt, amelyikről a kimutatás készül.",
      );
    if (departmentId && assetId)
      throw new BadRequestException(
        "A kimutatás helyszínre VAGY eszközre készül, a kettő együtt nem adható meg.",
      );

    const scope = await this.repository.scope({ departmentId, assetId });
    if (!scope)
      throw new NotFoundException(
        assetId ? "Az eszköz nem található." : "A helyszín nem található.",
      );
    const { start, end } = monthBounds(input.month);
    // a hét-határ miatt a hónap elé hét nap (a legrosszabb eset hat, a hetedik a nyári időszámítás váltásának tartaléka)
    const from = new Date(start.getTime() - 7 * 24 * 3_600_000);
    const assetIds = scope.assets.map((asset) => asset.id);
    /*
      A SOROK A RÖGZÍTÉSKORI HELYSZÍN SZERINT, a „teljesült-e" kérdés az ÉLŐ eszközök minden bejegyzése szerint: egy áthelyezett eszköz
      heti feladata a régi helyszínen rögzítve is teljesítette a hetet, és nem „maradt ki" az újon.
    */
    const [entries, done, schedules] = await Promise.all([
      this.repository.entries(scope.entryFilter, from, end),
      this.repository.entries({ assetIds }, from, end),
      this.repository.schedules(scope.assets),
    ]);
    return {
      report: buildOperationsReport({
        month: input.month,
        audience,
        entries,
        doneEntries: done,
        schedules,
        now,
      }),
      siteLabel: scope.siteLabel,
      departmentId: departmentId ?? null,
      assetId: assetId ?? null,
      generatedAt: now.toISOString(),
    };
  }
}
