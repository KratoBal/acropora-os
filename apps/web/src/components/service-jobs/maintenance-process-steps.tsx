"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  completionCertificatesApi,
  type CompletionCertificateSummary,
} from "@/lib/api/completion-certificates";
import { maintenanceInvoiceApi } from "@/lib/api/maintenance-invoice";
import type { MaintenanceInvoiceSummary } from "@acropora/types";

/**
 * A KARBANTARTÁSI LAP FOLYAMATÁNAK LÉPÉSSORA (Picasso 3.3, acrobot 62058): munkalapok, teljesítési igazolás, számla, dokumentumcsomag. A lap négy külön panelből áll,
 * és egyik sem mondja meg, hol tart a folyamat. A lépéssor CSAK MEGJELENÍT: a panelek mostani adatából olvassa az állapotot (ugyanabból a két lekérdezésből, amit a panelek
 * maguk is használnak), és megjelöli az első teendőt. A gombok kapuja NEM ide került: az a szerveren marad, egy kapu két helyen két igazság lenne (acrobot döntése).
 *
 * Ahol az állapot nem ismert (betöltés, hiba), a lépés ezt mondja ki, nem találgat. A dokumentumcsomagnak nincs nyilvántartott állapota, ezért nincs állapot-jelzése.
 */
export type StepTone = "done" | "open" | "waiting" | "unknown";

export type ProcessStep = {
  key: "worksheets" | "certificate" | "invoice" | "package";
  title: string;
  /** Egy rövid mondat arról, hol tart a lépés. */
  state: string;
  tone: StepTone;
  /** Az első teendő (az első lépés, amelyik még nyitott): kiemelve áll. */
  next: boolean;
};

type WorksheetLike = { status: string };

export type StepInputs = {
  worksheets: readonly WorksheetLike[];
  /** `null`: betöltés; `"error"`: nem tölthető be; egyébként a TIG-ok (a legújabb elöl). */
  certificates: readonly CompletionCertificateSummary[] | null | "error";
  /** `undefined`: betöltés vagy nincs igazolás; `null`: nincs számla; `"error"`: nem tölthető be. */
  invoice: MaintenanceInvoiceSummary | null | "error" | undefined;
  /** Ha ennél a lapnál nem állítható ki teljesítési igazolás, az ok (a lap forrása miatt). */
  certificateBlockedReason?: string | null;
};

/** A négy lépés és az állapotuk a megadott adatból (tiszta függvény: a komponens csak kirajzolja). */
export function maintenanceProcessSteps(input: StepInputs): ProcessStep[] {
  const steps: Omit<ProcessStep, "next">[] = [];

  // 1. munkalapok
  const total = input.worksheets.length;
  const signed = input.worksheets.filter(
    (sheet) => sheet.status === "SIGNED",
  ).length;
  steps.push({
    key: "worksheets",
    title: "Munkalapok",
    state:
      total === 0
        ? "Még nincs munkalap"
        : signed === total
          ? `Mind aláírva (${total})`
          : `${signed} / ${total} aláírva`,
    tone: total > 0 && signed === total ? "done" : "open",
  });

  // 2. teljesítési igazolás
  const certificates = input.certificates;
  let certificate: Omit<ProcessStep, "next">;
  if (input.certificateBlockedReason) {
    certificate = {
      key: "certificate",
      title: "Teljesítési igazolás",
      state: "Ehhez a laphoz nem állítható ki",
      tone: "waiting",
    };
  } else if (certificates === null) {
    certificate = {
      key: "certificate",
      title: "Teljesítési igazolás",
      state: "Betöltés…",
      tone: "unknown",
    };
  } else if (certificates === "error") {
    certificate = {
      key: "certificate",
      title: "Teljesítési igazolás",
      state: "Az állapota nem tölthető be",
      tone: "unknown",
    };
  } else if (certificates.length === 0) {
    certificate = {
      key: "certificate",
      title: "Teljesítési igazolás",
      state: "Még nincs kiállítva",
      tone: "open",
    };
  } else {
    const latest = certificates[0]!;
    const hasSigned = latest.documents.some(
      (doc) => doc.type === "SIGNED_FORM",
    );
    certificate = {
      key: "certificate",
      title: "Teljesítési igazolás",
      state: hasSigned
        ? `${latest.number}: aláírt példány feltöltve`
        : `${latest.number}: aláírt példány még nincs`,
      tone: hasSigned ? "done" : "open",
    };
  }
  steps.push(certificate);

  // 3. számla
  const hasCertificate = Array.isArray(certificates) && certificates.length > 0;
  const invoice = input.invoice;
  if (!hasCertificate) {
    steps.push({
      key: "invoice",
      title: "Számla",
      state:
        certificates === null || certificates === "error"
          ? "Az állapota még nem ismert"
          : "A teljesítési igazolás után",
      tone:
        certificates === null || certificates === "error"
          ? "unknown"
          : "waiting",
    });
  } else if (invoice === "error") {
    steps.push({
      key: "invoice",
      title: "Számla",
      state: "Az állapota nem tölthető be",
      tone: "unknown",
    });
  } else if (invoice === undefined) {
    steps.push({
      key: "invoice",
      title: "Számla",
      state: "Betöltés…",
      tone: "unknown",
    });
  } else if (invoice === null) {
    steps.push({
      key: "invoice",
      title: "Számla",
      state: "Még nincs számla-piszkozat",
      tone: "open",
    });
  } else if (invoice.status === "ISSUED") {
    steps.push({
      key: "invoice",
      title: "Számla",
      state: invoice.invoiceNumber
        ? `Kiállítva: ${invoice.invoiceNumber}`
        : "Kiállítva",
      tone: "done",
    });
  } else if (invoice.status === "ISSUING") {
    steps.push({
      key: "invoice",
      title: "Számla",
      state: "Kiállítás folyamatban: kézi ellenőrzés kell",
      tone: "open",
    });
  } else {
    steps.push({
      key: "invoice",
      title: "Számla",
      state: "Piszkozat, még nincs kiállítva",
      tone: "open",
    });
  }

  // 4. dokumentumcsomag: nincs nyilvántartott állapota, csak a hely
  steps.push({
    key: "package",
    title: "Dokumentumcsomag",
    state: "Letöltés és kiküldés lent",
    tone: "waiting",
  });

  const nextIndex = steps.findIndex((step) => step.tone === "open");
  return steps.map((step, index) => ({ ...step, next: index === nextIndex }));
}

const TONE_CLASS: Record<StepTone, string> = {
  done: "bg-pilot-aqua-600 text-white",
  open: "bg-white text-pilot-grey-700 ring-1 ring-pilot-grey-300",
  waiting: "bg-pilot-grey-100 text-pilot-grey-400",
  unknown: "bg-pilot-grey-100 text-pilot-grey-400",
};

/** A lépéssor a karbantartási lap tetején; a `refreshKey` változására újraolvas (a panelek változtatnak). */
export function MaintenanceProcessSteps({
  serviceJobId,
  worksheets,
  certificateBlockedReason,
  refreshKey,
}: {
  serviceJobId: string;
  worksheets: readonly WorksheetLike[];
  certificateBlockedReason?: string | null;
  refreshKey: number;
}) {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const [certificates, setCertificates] =
    useState<StepInputs["certificates"]>(null);
  const [invoice, setInvoice] = useState<StepInputs["invoice"]>(undefined);

  // NEM `if (token)`: éles bejelentkezésnél a token üres (a süti hitelesít), mint a testvérpaneleken
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const list = await completionCertificatesApi.list(token, serviceJobId);
        if (!live) return;
        setCertificates(list);
        if (list[0]) {
          const found = await maintenanceInvoiceApi.byCertificate(
            token,
            list[0].id,
          );
          if (live) setInvoice(found);
        } else {
          setInvoice(undefined);
        }
      } catch {
        if (live) {
          setCertificates((current) => current ?? "error");
          setInvoice((current) => current ?? "error");
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [serviceJobId, token, refreshKey]);

  const steps = maintenanceProcessSteps({
    worksheets,
    certificates,
    invoice,
    certificateBlockedReason,
  });
  return (
    <ol
      aria-label="A karbantartás lépései"
      className="grid grid-cols-1 gap-3 rounded-2xl border border-pilot-grey-200 bg-white p-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      {steps.map((step, index) => (
        <li
          key={step.key}
          aria-current={step.next ? "step" : undefined}
          className={`flex items-start gap-3 rounded-xl p-3 ${
            step.next
              ? "bg-pilot-aqua-50 ring-1 ring-pilot-aqua-200"
              : "bg-transparent"
          }`}
        >
          <span
            aria-hidden="true"
            className={`mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${TONE_CLASS[step.tone]}`}
          >
            {step.tone === "done" ? "✓" : index + 1}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-pilot-grey-900">
              {step.title}
              {step.next ? (
                <span className="ml-2 text-xs font-medium text-pilot-aqua-700">
                  Következő
                </span>
              ) : null}
            </span>
            <span className="block text-xs text-pilot-grey-600">
              {step.state}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
