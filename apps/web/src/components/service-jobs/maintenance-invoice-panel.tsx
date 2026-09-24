"use client";

import { Alert, Button } from "@acropora/ui";
import type { MaintenanceInvoiceSummary } from "@acropora/types";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  ServicePanel,
  ServicePanelHeading,
} from "@/components/service/service-detail-chrome";
import { completionCertificatesApi } from "@/lib/api/completion-certificates";
import { maintenanceInvoiceApi } from "@/lib/api/maintenance-invoice";

/**
 * "SZÁMLA" PANEL A KARBANTARTÁSI LAPON (ADR-014, 4. szelet), a
 * `CompletionCertificatePanel` mellett -- acrobot kérése, 2026-09-24 (msg
 * 23143).
 *
 * SAJÁT, KÜLÖN KOMPONENS, ugyanazért, amiért a testvérpaneljei: a
 * `service-job-detail-page.tsx` már nagy.
 *
 * A CERTIFICATE-ET IS EZ A PANEL KÉRDEZI LE, nem prop-ként kapja: egy
 * `ServiceJob`-hoz legfeljebb egy `CompletionCertificate` tartozik
 * (`serviceJobId @unique` a sémán), és ez a lekérdezés már megvan, éles,
 * tesztelt (`completionCertificatesApi.list`, amit a testvérpanel is
 * használ) -- nem érdemes a szülőn átvezetni egy második másolatot.
 *
 * A "KIÁLLÍTÁS" GOMB LÁTSZIK, DE TILTOTT: acrobot kifejezetten ezt kérte,
 * hogy a felhasználó lássa, a képesség úton van, ne találgasson.
 */
export function MaintenanceInvoicePanel({
  serviceJobId,
}: {
  serviceJobId: string;
}) {
  const { session } = useAuth();
  const token = session?.token ?? "";

  const [certificateId, setCertificateId] = useState<string | null | undefined>(
    undefined,
  );
  const [signed, setSigned] = useState(false);
  const [invoice, setInvoice] = useState<MaintenanceInvoiceSummary | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const load = async () => {
    try {
      const certificates = await completionCertificatesApi.list(
        token,
        serviceJobId,
      );
      const certificate = certificates[0] ?? null;
      setCertificateId(certificate?.id ?? null);
      setSigned(
        certificate?.documents.some((doc) => doc.type === "SIGNED_FORM") ??
          false,
      );
      if (certificate) {
        setInvoice(
          await maintenanceInvoiceApi.byCertificate(token, certificate.id),
        );
      } else {
        setInvoice(null);
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A számla-adatok nem tölthetők be.",
      );
    }
  };

  // NEM `if (token)` -- ugyanaz a hibaosztály, mint a testvérpaneleken
  // (Balázs éles hibája, 2026-09-24 17:39): éles bejelentkezésnél a
  // `Session.token` üres (a httpOnly süti hitelesít), tehát a feltétel a
  // `load()`-ot SOHA nem futtatná le.
  useEffect(() => {
    void load();
  }, [serviceJobId, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const createDraft = async () => {
    if (!certificateId) return;
    setCreating(true);
    setError(null);
    try {
      setInvoice(await maintenanceInvoiceApi.draft(token, certificateId));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A piszkozat-számla nem készíthető el.",
      );
    } finally {
      setCreating(false);
    }
  };

  const downloadPreview = async () => {
    if (!invoice) return;
    setDownloading(true);
    setError(null);
    try {
      const blob = await maintenanceInvoiceApi.downloadPdf(token, invoice.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "szamla-elonezet.pdf";
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Az előnézeti PDF nem tölthető le.",
      );
    } finally {
      setDownloading(false);
    }
  };

  return (
    <ServicePanel>
      <ServicePanelHeading title="Számla" />
      {error ? (
        <Alert variant="danger" title="Hiba" description={error} />
      ) : null}

      {certificateId === undefined ? (
        <p className="text-sm text-muted">Betöltés…</p>
      ) : certificateId === null ? (
        <p className="text-sm text-muted">
          Nincs kiállítva teljesítési igazolás -- piszkozat-számla enélkül nem
          készíthető.
        </p>
      ) : !signed ? (
        <p className="text-sm text-muted">
          A teljesítési igazolás aláírt példánya hiányzik -- piszkozat-számla
          enélkül nem készíthető.
        </p>
      ) : invoice === null ? (
        <Button disabled={creating} onClick={() => void createDraft()}>
          {creating ? "Piszkozat készítése…" : "Piszkozat készítése"}
        </Button>
      ) : (
        <div className="space-y-3">
          <dl className="grid gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Bruttó összeg</dt>
              <dd>
                {invoice.grossAmount} {invoice.currency}
              </dd>
            </div>
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              disabled={downloading}
              onClick={() => void downloadPreview()}
            >
              {downloading ? "Letöltés…" : "Előnézet letöltése"}
            </Button>
            <Button disabled title="A kiállítás még nincs bekapcsolva">
              Kiállítás
            </Button>
            {/*
              LÁTHATÓ FELIRAT, NEM CSAK `title`: egy tiltott gomb
              `pointer-events: none` szabállyal jár (lásd a `Button`
              stílusát), ami a böngésző hover-buborékát is megakadályozhatja
              -- a felirat így akkor is olvasható, ha az egérrel nem lehet a
              gomb fölé állni.
            */}
            <span className="text-sm text-muted">
              A kiállítás még nincs bekapcsolva.
            </span>
          </div>
        </div>
      )}
    </ServicePanel>
  );
}
