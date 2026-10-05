import { Injectable } from "@nestjs/common";
import { NavCredentialsService } from "../integrations/nav/nav-credentials.service.js";
import { OpgClient } from "./opg-client.js";
import { CashRegisterRepository } from "./cash-register.repository.js";
import { OpgError } from "./opg-xml.js";
export const opgErrorCode = (e: unknown) =>
  e instanceof OpgError ? e.code : "OPG_SYNC_FAILED";
@Injectable()
export class CashRegisterService {
  constructor(
    private readonly client: OpgClient,
    private readonly credentials: NavCredentialsService,
    private readonly repository: CashRegisterRepository,
  ) {}
  async plan() {
    const credentials = await this.credentials.resolve();
    const registers = await this.client.status(credentials);
    return Promise.all(
      registers.map(async (r) => {
        const existing = await this.repository.existing(
          r.apNumber,
          r.min,
          r.max,
        );
        const numbers: number[] = [];
        for (let n = Math.max(1, r.min); n <= r.max; n++)
          if (!existing.has(n)) numbers.push(n);
        return { ...r, fileNumbers: numbers };
      }),
    );
  }
  async sync(trigger = "SCHEDULED", backfill = false) {
    const run = await this.repository.startRun(trigger),
      counts = { filesFetched: 0, receiptsCreated: 0, gapsRecorded: 0 };
    try {
      const credentials = await this.credentials.resolve();
      const registers = await this.client.status(credentials);
      for (const status of registers) {
        await this.repository.heartbeat(run.id);
        const prepared = await this.repository.prepare(status);
        counts.gapsRecorded += prepared.gap;
        let next = backfill ? Math.max(1, status.min) : prepared.next,
          max = status.max;
        const existing = backfill
          ? await this.repository.existing(
              status.apNumber,
              status.min,
              status.max,
            )
          : new Set<number>();
        while (next <= max) {
          if (existing.has(next)) {
            next++;
            continue;
          }
          await this.repository.heartbeat(run.id);
          let end = Math.min(max, next + 19);
          if (backfill)
            for (let n = next + 1; n <= end; n++)
              if (existing.has(n)) {
                end = n - 1;
                break;
              }
          const page = await this.client.files(
            credentials,
            status.apNumber,
            next,
            end,
          );
          if (
            page.files.length === 0 &&
            page.reason === "NOT_AVAILABLE" &&
            page.min > next
          ) {
            const refreshed = (await this.client.status(credentials)).find(
              (r) => r.apNumber === status.apNumber,
            );
            if (!refreshed || refreshed.min <= next)
              throw new OpgError("OPG_FILE_UNAVAILABLE");
            const recovery = await this.repository.prepare(refreshed);
            counts.gapsRecorded += recovery.gap;
            next = Math.max(next, refreshed.min);
            max = refreshed.max;
            continue;
          }
          const files = [...page.files].sort((a, b) => a.number - b.number);
          if (
            !files.length ||
            files.some((file, i) => file.number !== next + i)
          )
            throw new OpgError("OPG_FILE_GAP");
          if (!page.allFilesSent && page.reason !== "SIZE")
            throw new OpgError("OPG_FILE_UNAVAILABLE");
          if (page.allFilesSent && files.at(-1)!.number !== end)
            throw new OpgError("OPG_FILE_GAP");
          for (const file of files) {
            counts.receiptsCreated += await this.repository.save(file, run.id);
            counts.filesFetched++;
          }
          next = files.at(-1)!.number + 1;
        }
      }
      await this.repository.finish(run.id, counts);
      return counts;
    } catch (e) {
      await this.repository.finish(run.id, counts, opgErrorCode(e));
      throw new OpgError(opgErrorCode(e));
    }
  }
}
