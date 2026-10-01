import { Prisma, prisma } from "@acropora/database";
import type { KnownRow } from "@acropora/jev";
import { Injectable } from "@nestjs/common";

/**
 * A JEV-JAVASLAT TAROLASA (`DecisionRun`) ES A KNOWN-ENTITY LISTA FORRASA.
 *
 * A domain tablakat CSAK OLVASSA: a javaslat soha nem parosit. A known-entity
 * sorok a folyamat memoriajaba kerulnek, lemezre es naploba nem.
 */

export interface PairRunKey {
  readonly entityType: string;
  readonly entityId: string;
  readonly policyKey: string;
  readonly policyVersion: number;
  readonly projectionHash: string;
  readonly optionsHash: string;
  readonly requestedModel: string;
}

export interface StoredPairRun {
  readonly id: string;
  readonly selectedValue: string | null;
  readonly confidence: number | null;
  readonly exposure: "HIDDEN" | "SHOWN";
  readonly status: "OK" | "ERROR";
}

const RUN = {
  id: true,
  selectedValue: true,
  confidence: true,
  exposure: true,
  status: true,
} as const;

const text = (v: string | null | undefined) => (v ?? "").trim();

@Injectable()
export class MissingInvoiceJevRepository {
  /**
   * A build_known.py SQL-jenek sorai (`KNOWN_SOURCE_FIELDS`), ugyanabban a
   * sorrendben. A NULL ures szoveg, ahogy a psql `-At` is irja.
   */
  async knownRows(): Promise<KnownRow[]> {
    const [users, customers, addresses, suppliers, contracts, signatures] =
      await Promise.all([
        prisma.user.findMany({
          select: {
            firstName: true,
            lastName: true,
            displayName: true,
            nickname: true,
            email: true,
          },
        }),
        prisma.customer.findMany({
          select: { displayName: true, companyName: true, email: true },
        }),
        prisma.customerAddress.findMany({
          select: { name: true, line1: true, line2: true },
        }),
        prisma.supplier.findMany({
          select: {
            name: true,
            contactPersonName: true,
            email: true,
            contactPersonEmail: true,
          },
        }),
        prisma.contract.findMany({
          select: { contactPersonName: true, organizationalUnitName: true },
        }),
        prisma.worksheetVersionSignature.findMany({
          select: { signerName: true },
        }),
      ]);
    const rows: KnownRow[] = [];
    const add = (kind: string, values: (string | null | undefined)[]) => {
      for (const v of values) rows.push([kind, v ?? ""]);
    };
    add(
      "PERSON",
      users.map((u) => text(`${u.firstName} ${u.lastName}`)),
    );
    add(
      "PERSON",
      users.map((u) => text(`${u.lastName} ${u.firstName}`)),
    );
    add(
      "PERSON",
      users.map((u) => u.displayName),
    );
    add(
      "PERSON",
      users.map((u) => u.nickname),
    );
    add(
      "EMAIL",
      users.map((u) => u.email),
    );
    add(
      "ORG",
      customers.map((c) => c.displayName),
    );
    add(
      "ORG",
      customers.map((c) => c.companyName),
    );
    add(
      "EMAIL",
      customers.map((c) => c.email),
    );
    add(
      "ADDRESS",
      addresses.map((a) => a.name),
    );
    add(
      "ADDRESS",
      addresses.map((a) => a.line1),
    );
    add(
      "ADDRESS",
      addresses.map((a) => a.line2),
    );
    add(
      "ORG",
      suppliers.map((s) => s.name),
    );
    add(
      "PERSON",
      suppliers.map((s) => s.contactPersonName),
    );
    add(
      "EMAIL",
      suppliers.map((s) => s.email),
    );
    add(
      "EMAIL",
      suppliers.map((s) => s.contactPersonEmail),
    );
    add(
      "PERSON",
      contracts.map((c) => c.contactPersonName),
    );
    add(
      "ORG",
      contracts.map((c) => c.organizationalUnitName),
    );
    add(
      "PERSON",
      signatures.map((s) => s.signerName),
    );
    return rows;
  }

  async findRun(key: PairRunKey): Promise<StoredPairRun | null> {
    return prisma.decisionRun.findUnique({
      where: {
        entityType_entityId_policyKey_policyVersion_projectionHash_optionsHash_requestedModel:
          key,
      },
      select: RUN,
    });
  }

  async createRun(
    data: Prisma.DecisionRunUncheckedCreateInput,
  ): Promise<StoredPairRun> {
    return prisma.decisionRun.create({ data, select: RUN });
  }

  /** A terheles korabbi, mas vetuletre szolo nyitott futasai: a Jev mast latott (STALE). */
  async markOthersStale(
    key: Pick<
      PairRunKey,
      "entityType" | "entityId" | "policyKey" | "policyVersion"
    >,
    currentRunId: string,
    now: Date,
  ): Promise<void> {
    await prisma.decisionRun.updateMany({
      where: {
        entityType: key.entityType,
        entityId: key.entityId,
        policyKey: key.policyKey,
        policyVersion: key.policyVersion,
        resolution: null,
        NOT: { id: currentRunId },
      },
      data: { resolution: "STALE", resolvedAt: now },
    });
  }

  /** A terheles legutobbi nyitott futasa: a kezi parositas ezt oldja fel. */
  async openRun(
    key: Pick<
      PairRunKey,
      "entityType" | "entityId" | "policyKey" | "policyVersion"
    >,
  ): Promise<StoredPairRun | null> {
    return prisma.decisionRun.findFirst({
      where: { ...key, resolution: null },
      orderBy: { createdAt: "desc" },
      select: RUN,
    });
  }

  async resolveRun(
    id: string,
    data: {
      resolution:
        "ACCEPTED" | "OVERRIDDEN" | "SHADOW_MATCH" | "SHADOW_MISMATCH" | null;
      resolvedValue: string;
      resolvedAt: Date;
    },
  ): Promise<void> {
    await prisma.decisionRun.update({ where: { id }, data });
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
