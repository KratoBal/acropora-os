"use client";

import { Alert, PilotButton, PilotInput, PilotSection } from "@acropora/ui";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  completionCertificatesApi,
  type CompletionCertificateSummary,
} from "@/lib/api/completion-certificates";

/** A megrendelés egy tétele, amennyi a TIG-hez kell (a megrendelés oldala adja). */
export type PartnerOrderCertificateItem = {
  quoteItemId: string;
  name: string;
  /** a megrendelt mennyiség, a szerver Decimal-szövege ("3", "2.5") */
  quantity: string;
  unit: string;
};

/** Decimal-szöveg összeadás-kivonás hat tizedesig, lebegőpontos hiba nélkül. */
const SCALE = 1_000_000n;
function toMicro(value: string): bigint {
  const [whole, fraction = ""] = value.replace(",", ".").split(".");
  const sign = whole!.startsWith("-") ? -1n : 1n;
  const digits = BigInt(whole!.replace("-", "") || "0") * SCALE;
  return sign * (digits + BigInt((fraction + "000000").slice(0, 6)));
}
function fromMicro(value: bigint): string {
  const whole = value / SCALE;
  const fraction = (value % SCALE)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole},${fraction}` : `${whole}`;
}

/** Tételenként a hátralévő mennyiség a megrendelés eddigi TIG-soraiból (a szerver is így számol). */
export function remainingQuantities(
  items: readonly PartnerOrderCertificateItem[],
  certificates: readonly CompletionCertificateSummary[],
): Map<string, string> {
  const left = new Map(items.map((i) => [i.quoteItemId, toMicro(i.quantity)]));
  for (const certificate of certificates)
    for (const line of certificate.items ?? [])
      if (line.quoteItemId && left.has(line.quoteItemId))
        left.set(
          line.quoteItemId,
          left.get(line.quoteItemId)! - toMicro(line.quantity),
        );
  return new Map([...left].map(([id, micro]) => [id, fromMicro(micro)]));
}

/**
 * A MEGRENDELÉS TELJESÍTÉSI IGAZOLÁSAI (Megrendelések S2). Egy megrendeléshez több
 * TIG is készülhet (részteljesítés, Luca kérése): a táblázat tételenként mutatja a
 * hátralévőt, a mennyiség alapból a teljes hátralévő, és szerkeszthető. A nulla
 * mennyiségű tétel kimarad ebből a TIG-ből. A számolás a szerveren dől el (a
 * megrendelés zárja alatt); ez a lap csak a kérést állítja össze.
 */
export function PartnerOrderCertificatesPanel({
  partnerOrderId,
  items,
}: {
  partnerOrderId: string;
  items: readonly PartnerOrderCertificateItem[];
}) {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const [certificates, setCertificates] = useState<
    CompletionCertificateSummary[] | null
  >(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const remaining = useMemo(
    () => remainingQuantities(items, certificates ?? []),
    [items, certificates],
  );

  const load = async () => {
    try {
      const list = await completionCertificatesApi.listForPartnerOrder(
        token,
        partnerOrderId,
      );
      setCertificates(list);
      const left = remainingQuantities(items, list);
      setQuantities(Object.fromEntries(left));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A teljesítési igazolások nem tölthetők be.",
      );
    }
  };
  // nem `if (token)`: éles bejelentkezésnél a token üres, a süti hitelesít
  useEffect(() => {
    void load();
  }, [partnerOrderId, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = items.filter(
    (i) => toMicro(remaining.get(i.quoteItemId) ?? "0") > 0n,
  );
  const lines = open
    .map((i) => ({
      quoteItemId: i.quoteItemId,
      quantity: (quantities[i.quoteItemId] ?? "").trim(),
    }))
    .filter((line) => line.quantity && toMicro(line.quantity) > 0n);

  const issue = async () => {
    setBusy(true);
    setError(null);
    try {
      await completionCertificatesApi.issueForPartnerOrder(
        token,
        partnerOrderId,
        lines,
      );
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A teljesítési igazolás nem állítható ki.",
      );
    } finally {
      setBusy(false);
    }
  };

  const uploadSigned = async (certificateId: string, file: File) => {
    setError(null);
    try {
      await completionCertificatesApi.uploadSignedDocument(
        token,
        certificateId,
        file,
      );
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Az aláírt PDF nem tölthető fel.",
      );
    }
  };

  const download = async (
    certificateId: string,
    documentId: string,
    fileName: string,
  ) => {
    try {
      const blob = await completionCertificatesApi.downloadDocument(
        token,
        certificateId,
        documentId,
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A PDF nem tölthető le.",
      );
    }
  };

  return (
    <PilotSection title="Teljesítési igazolás">
      <div className="space-y-4">
        {error ? (
          <Alert variant="danger" title="Hiba" description={error} />
        ) : null}
        {certificates === null ? (
          <p className="text-sm text-pilot-grey-500">Betöltés…</p>
        ) : (
          <>
            {open.length ? (
              <div className="space-y-3">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-pilot-grey-500">
                      <th className="py-1 font-medium">Tétel</th>
                      <th className="py-1 font-medium">Hátralévő</th>
                      <th className="py-1 font-medium">Most igazolt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {open.map((item) => (
                      <tr
                        key={item.quoteItemId}
                        className="border-t border-pilot-grey-100"
                      >
                        <td className="py-2 pr-3">{item.name}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {remaining.get(item.quoteItemId)} {item.unit}
                        </td>
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            <PilotInput
                              value={quantities[item.quoteItemId] ?? ""}
                              onChange={(value) =>
                                setQuantities((current) => ({
                                  ...current,
                                  [item.quoteItemId]: value,
                                }))
                              }
                              inputMode="decimal"
                              aria-label={`${item.name}: most igazolt mennyiség`}
                            />
                            <span className="text-pilot-grey-500">
                              {item.unit}
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <PilotButton
                  disabled={busy || lines.length === 0}
                  onClick={() => void issue()}
                >
                  {busy ? "Kiállítás…" : "Teljesítési igazolás kiállítása"}
                </PilotButton>
              </div>
            ) : (
              <p
                className="text-sm text-pilot-grey-500"
                data-testid="tig-minden-kesz"
              >
                A megrendelés minden tétele igazolva.
              </p>
            )}
            {certificates.map((certificate) => (
              <div
                key={certificate.id}
                className="rounded-lg border border-pilot-grey-200 p-3 text-sm"
                data-testid="tig-sor"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{certificate.number}</span>
                  <label className="cursor-pointer text-pilot-blue-700 underline">
                    Aláírt PDF feltöltése
                    <input
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      aria-label={`${certificate.number}: aláírt PDF feltöltése`}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void uploadSigned(certificate.id, file);
                        event.target.value = "";
                      }}
                    />
                  </label>
                </div>
                <ul className="mt-2 space-y-1">
                  {certificate.documents.map((documentSummary) => (
                    <li key={documentSummary.id}>
                      <button
                        type="button"
                        className="text-pilot-blue-700 underline"
                        onClick={() =>
                          void download(
                            certificate.id,
                            documentSummary.id,
                            documentSummary.fileName,
                          )
                        }
                      >
                        {documentSummary.type === "SIGNED_FORM"
                          ? "Aláírt igazolás"
                          : "Generált igazolás"}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </>
        )}
      </div>
    </PilotSection>
  );
}
