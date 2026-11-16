import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Optional,
} from "@nestjs/common";

import { runPriceAuditCli } from "./medusa-price-audit.cli.js";

/** Test seam only (the same pattern as the pickup adoption deps): the real runner is the CLI function. */
export const MEDUSA_PRICE_AUDIT_RUNNER = Symbol("MEDUSA_PRICE_AUDIT_RUNNER");

export const PRICE_AUDIT_DEFAULT_LIMIT = 100;
export const PRICE_AUDIT_MAX_LIMIT = 300;

export interface PriceAuditQuery {
  limit: number;
  from: string | null;
  all: boolean;
}

export interface PriceAuditView {
  /** 0 = the audit ran; 1 = argument or credential error (the reason is in `errors`) */
  exitCode: number;
  /** how many OS products this page looked at */
  selected: number;
  /** pass as `from` for the next page; null when this page was the last one */
  nextFrom: string | null;
  /** the CLI's stdout lines (finding lines, `# ` unreadable lines, the summary line) */
  lines: string[];
  errors: string[];
}

/**
 * THE READ-ONLY PRICE AUDIT AS AN ENDPOINT (task t-20261116-ket-forint-ar, acrobot 53851): the fleet cannot read the output of a
 * stage command (a Coolify task only reports success or failed), so the same audit runs inside the API and returns the CLI's own
 * lines. It adds no logic: `runPriceAuditCli` is the one place that decides, and it only reads (see its spec's source scan).
 * One run at a time, because each page makes one admin read per product against the shop.
 */
@Injectable()
export class MedusaPriceAuditService {
  private running = false;
  private readonly runner: typeof runPriceAuditCli;

  constructor(
    @Optional()
    @Inject(MEDUSA_PRICE_AUDIT_RUNNER)
    runner?: typeof runPriceAuditCli,
  ) {
    this.runner = runner ?? runPriceAuditCli;
  }

  async run(query: PriceAuditQuery): Promise<PriceAuditView> {
    if (this.running)
      throw new HttpException(
        "MEDUSA_PRICE_AUDIT_BUSY",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    this.running = true;
    try {
      const stdout: string[] = [];
      const stderr: string[] = [];
      let ids: readonly string[] = [];
      const args = ["--limit", String(query.limit)];
      if (query.from) args.push("--from", query.from);
      if (query.all) args.push("--all");
      const exitCode = await this.runner(
        args,
        {
          stdout: (value) => stdout.push(value),
          stderr: (value) => stderr.push(value),
        },
        undefined,
        undefined,
        (selected) => {
          ids = selected;
        },
      );
      const lines = (parts: string[]) =>
        parts
          .join("")
          .split("\n")
          .filter((line) => line.length > 0);
      return {
        exitCode,
        selected: ids.length,
        nextFrom:
          ids.length === query.limit ? (ids[ids.length - 1] ?? null) : null,
        lines: lines(stdout),
        errors: lines(stderr),
      };
    } finally {
      this.running = false;
    }
  }
}
