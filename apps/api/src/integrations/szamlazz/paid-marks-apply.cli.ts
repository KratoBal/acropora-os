import {
  applyPaidMarks,
  paidMarksReport,
  prismaPaymentMarkStore,
  type PaymentMarkInput,
  type PaymentMarkSource,
  type PaymentMarkStore,
} from "./outgoing-payment-marks.js";
import {
  HttpSzamlazzAgentClient,
  type SzamlazzAgentPaymentClient,
} from "./szamlazz-agent.client.js";
import { SzamlazzConnectionRepository } from "./szamlazz-connection.repository.js";
import { SzamlazzCredentialCryptoService } from "./szamlazz-credential-crypto.service.js";
import { SzamlazzCredentialProvider } from "./szamlazz-credential.provider.js";

/**
 * AZ ÉLES ÍRÁS PARANCSSORI KAPUJA, minden forrásra ugyanaz (GLS, Foxpost;
 * acrobot 25989, 26031). Csak akkor ír, ha MIND A HÁROM áll:
 *
 *   1. a forrás kapcsolója `live`;
 *   2. a parancs `--apply`-jal fut;
 *   3. a `--invoices <szám,szám,...>` lista nem üres: csak a felsorolt,
 *      Balázs által jóváhagyott számlák kapnak jóváírást.
 *
 * A kulcsot a meglévő `SzamlazzCredentialProvider` adja, MIELŐTT bármi
 * naplózódna vagy kimenne: kulcs nélkül a napló érintetlen (élesen mérve
 * 2026-10-02: SZAMLAZZ_CONNECTION_NOT_CONFIGURED, üres tábla).
 *
 * Kilépési kód: 0 rendben; 1 a kapcsoló nem `live`; 2 hiányzó vagy üres
 * `--invoices`; 3 ha valamelyik jelölés FAILED vagy UNKNOWN.
 */
export async function runPaidMarksApply(input: {
  argv: readonly string[];
  mode: "off" | "dry" | "live";
  /** A kapcsoló neve a hibaüzenethez (`FOXPOST_MARK_PAID`). */
  switchName: string;
  source: PaymentMarkSource;
  /** A fejléc tárgya: `Foxpost elszámolások 2026-09-01 óta`. */
  what: string;
  loadMarks: () => Promise<PaymentMarkInput[]>;
  out: (text: string) => void;
  err: (text: string) => void;
  /** A teszt adja; élesen a kulcs, a kliens és a napló a valódi. */
  deps?: {
    credential: () => Promise<{ agentKey: string; revision: string }>;
    client: SzamlazzAgentPaymentClient;
    store: PaymentMarkStore;
  };
}): Promise<number> {
  if (input.mode !== "live") {
    input.err(
      `Az éles íráshoz ${input.switchName}=live kell; most: ${input.mode}.\n`,
    );
    return 1;
  }
  const at = input.argv.indexOf("--invoices");
  const approved = new Set(
    (at >= 0 ? (input.argv[at + 1] ?? "") : "")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean),
  );
  if (approved.size === 0) {
    input.err(
      "Az --apply csak a jóváhagyott számlákra ír: --invoices <szám,szám,...>\n",
    );
    return 2;
  }
  const deps = input.deps ?? {
    credential: () =>
      new SzamlazzCredentialProvider(
        new SzamlazzConnectionRepository(),
        new SzamlazzCredentialCryptoService(),
      ).resolve(),
    client: new HttpSzamlazzAgentClient(),
    store: prismaPaymentMarkStore,
  };
  const credential = await deps.credential();
  const marks = await input.loadMarks();
  input.out(
    `ÉLES írás a Számlázz.hu-ba (kulcs: ${credential.revision}), ${input.what}, ${approved.size} jóváhagyott számla:\n`,
  );
  const lines = await applyPaidMarks({
    source: input.source,
    marks,
    approved,
    agentKey: credential.agentKey,
    client: deps.client,
    store: deps.store,
  });
  input.out(paidMarksReport(lines, approved));
  return lines.some(
    (l) => l.outcome.kind === "FAILED" || l.outcome.kind === "UNKNOWN",
  )
    ? 3
    : 0;
}
