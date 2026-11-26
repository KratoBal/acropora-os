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
 *
 * A SZERVER HÁROM KAPUJÁT A LÉPÉSSOR KIMONDJA (Picasso 3.3, acrobot 62195): a teljesítési igazolás csak akkor állítható ki, ha minden munkalap alá van írva
 * (`CompletionCertificatesService.issue`), a piszkozat-számla csak az aláírt igazolás után készül, és a csomag KIKÜLDÉSE aláírt igazolást és kiállított számlát kér
 * (`maintenance-package-gate.ts`). A csomag LETÖLTÉSE szándékosan nem vár rájuk (Luca, 2026-11-18: csak a lezárt munkalap a feltétel). A lap a "még nem lehetséges"
 * paneleket ezek alapján nem rajzolja ki (`MaintenanceProcessSteps` `onData`), a kapu maga a szerveren marad.
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
    // the panel is not drawn for a waiting step (Picasso 3.3): the strip says the reason the panel used to say
    certificate = {
      key: "certificate",
      title: "Teljesítési igazolás",
      state: input.certificateBlockedReason,
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
  } else if (certificates.length === 0 && signed < total) {
    // the server issues a certificate only from signed worksheets (Balázs's rule: a signed sheet is done)
    certificate = {
      key: "certificate",
      title: "Teljesítési igazolás",
      state: "Előbb minden munkalap legyen aláírva",
      tone: "waiting",
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
    const hasSigned = certificateHasSignedForm(latest);
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
  const certificateSigned =
    hasCertificate && certificateHasSignedForm(certificates[0]!);
  const invoice = input.invoice;
  if (hasCertificate && !certificateSigned) {
    // the draft invoice needs the signed copy of the certificate (the invoice panel says the same)
    steps.push({
      key: "invoice",
      title: "Számla",
      state: "Az aláírt teljesítési igazolás után",
      tone: "waiting",
    });
  } else if (!hasCertificate) {
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
  } else if (invoice.status === "ISSUED" && invoice.cancelled) {
    // a sztornózott számla nem "kész": a lap számlázása újra nyitott (kártya 2cd1ed80), és ez az első teendő
    steps.push({
      key: "invoice",
      title: "Számla",
      state: invoice.invoiceNumber
        ? `Sztornózva: ${invoice.invoiceNumber}`
        : "Sztornózva",
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

  // 4. dokumentumcsomag: nincs nyilvántartott állapota (soha nem "következő"), a mondata a kiküldés kapuját mondja ki
  steps.push({
    key: "package",
    title: "Dokumentumcsomag",
    state: {
      unknown: "Letöltés és kiküldés lent",
      blocked:
        "Kiküldés az aláírt igazolás és a kiállított számla után; letölteni most is lehet",
      ready: "Kiküldhető; letölteni bármikor lehet",
    }[packageSendState(input).state],
    tone: "waiting",
  });

  const nextIndex = steps.findIndex((step) => step.tone === "open");
  return steps.map((step, index) => ({ ...step, next: index === nextIndex }));
}

function certificateHasSignedForm(
  certificate: CompletionCertificateSummary,
): boolean {
  return certificate.documents.some((doc) => doc.type === "SIGNED_FORM");
}

/**
 * MIÉRT NEM KÜLDHETŐ KI A CSOMAG (a szerver kiküldési kapuja, `maintenance-package-gate.ts`): aláírt teljesítési igazolás és kiállított, nem sztornózott számla
 * kell. `null`: kiküldhető, VAGY az állapot nem ismert (betöltés, hiba): ott a gomb él, és a szerver mondja meg az okot, a felület nem találgat.
 */
export function packageSendBlockedReason(input: StepInputs): string | null {
  return packageSendState(input).reason;
}

function packageSendState(input: StepInputs): {
  state: "unknown" | "blocked" | "ready";
  reason: string | null;
} {
  const { certificates, invoice } = input;
  const blocked = (reason: string) => ({ state: "blocked" as const, reason });
  if (certificates === null || certificates === "error")
    return { state: "unknown", reason: null };
  if (certificates.length === 0)
    return blocked("A kiküldéshez teljesítési igazolás kell.");
  if (!certificateHasSignedForm(certificates[0]!))
    return blocked(
      "A kiküldéshez a teljesítési igazolás aláírt példánya kell.",
    );
  if (invoice === undefined || invoice === "error")
    return { state: "unknown", reason: null };
  if (invoice === null || invoice.status !== "ISSUED" || invoice.cancelled)
    return blocked("A kiküldéshez kiállított számla kell.");
  return { state: "ready", reason: null };
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
  onData,
}: {
  serviceJobId: string;
  worksheets: readonly WorksheetLike[];
  certificateBlockedReason?: string | null;
  refreshKey: number;
  /** The certificates and the invoice the strip read: the page decides from the same data which panels can act (one read, one truth). */
  onData?: (data: Pick<StepInputs, "certificates" | "invoice">) => void;
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

  useEffect(() => {
    onData?.({ certificates, invoice });
    // the callback is the parent's setter; the data is what changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [certificates, invoice]);

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
