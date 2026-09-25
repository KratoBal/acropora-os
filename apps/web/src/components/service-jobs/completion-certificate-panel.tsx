"use client";

import { Alert, Button } from "@acropora/ui";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  ServicePanel,
  ServicePanelHeading,
} from "@/components/service/service-detail-chrome";
import {
  completionCertificatesApi,
  type CompletionCertificateSummary,
} from "@/lib/api/completion-certificates";

/**
 * "GOMB A KARBANTARTÁSI LAPON" -- 679d4c04 kanban-kártya.
 *
 * SAJÁT, KÜLÖN KOMPONENS, NEM A `service-job-detail-page.tsx` RÉSZE: az a
 * fájl már 1471 sor, saját, 1382 soros teszttel -- egy különálló panel nem
 * kockáztatja azt a meglévő, nagy felületet, és a beillesztés a hívó oldalon
 * egyetlen feltételes sor.
 *
 * A SZERVER MÁR ELUTASÍTJA A NEM-MAINTENANCE LAPOT (`CompletionCertificatesService.
 * issue`), ez a komponens csak azért nem jelenik meg REPAIR lapon, hogy a
 * gomb ne kínáljon fel olyat, amit a szerver úgyis visszadobna -- a hívó
 * oldal dönti el a `job.kind` alapján, ez a fájl nem ismétli meg azt a
 * feltételt.
 */
export function CompletionCertificatePanel({
  serviceJobId,
}: {
  serviceJobId: string;
}) {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const [certificates, setCertificates] = useState<
    CompletionCertificateSummary[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);

  const load = async () => {
    try {
      setCertificates(
        await completionCertificatesApi.list(token, serviceJobId),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A teljesítési igazolások nem tölthetők be.",
      );
    }
  };
  /**
   * NEM `if (token)` -- ugyanaz a hibaosztály, mint a
   * `pilot-contract-detail-page.tsx`-en (Balázs éles hibája, 2026-09-24 17:39):
   * éles (jelszavas) bejelentkezésnél a `Session.token` üres (a httpOnly
   * süti hitelesít), tehát a feltétel a `load()`-ot SOHA nem futtatná le.
   */
  useEffect(() => {
    void load();
  }, [serviceJobId, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const issue = async () => {
    setIssuing(true);
    setError(null);
    try {
      await completionCertificatesApi.issue(token, serviceJobId);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A teljesítési igazolás nem állítható ki.",
      );
    } finally {
      setIssuing(false);
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
    <ServicePanel>
      <ServicePanelHeading title="Teljesítési igazolás" />
      {error ? (
        <Alert variant="danger" title="Hiba" description={error} />
      ) : null}
      {certificates === null ? (
        <p className="text-sm text-muted">Betöltés…</p>
      ) : certificates.length === 0 ? (
        <Button disabled={issuing} onClick={() => void issue()}>
          {issuing ? "Kiállítás…" : "Teljesítési igazolás kiállítása"}
        </Button>
      ) : (
        certificates.map((certificate) => (
          <div key={certificate.id} className="rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{certificate.number}</span>
              <label className="cursor-pointer text-brand-700 underline">
                Aláírt PDF feltöltése
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
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
                    className="text-brand-700 underline"
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
        ))
      )}
    </ServicePanel>
  );
}
