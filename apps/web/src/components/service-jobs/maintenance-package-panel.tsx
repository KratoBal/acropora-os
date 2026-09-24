"use client";

import { Alert, Button } from "@acropora/ui";
import type { MaintenancePackageMailPreview } from "@acropora/types";
import { useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  ServicePanel,
  ServicePanelHeading,
} from "@/components/service/service-detail-chrome";
import { maintenancePackageApi } from "@/lib/api/maintenance-package";

import { MaintenancePackageMailDialog } from "./maintenance-package-mail-dialog";

/**
 * "CSOMAG-ÖSSZEÁLLÍTÁS ÉS KIKÜLDÉS A KARBANTARTÁSI LAPHOZ" -- a hibajegyes
 * `ServiceJobPackageService`/`HandoverMailService` mintájának átvétele
 * (679d4c04 utáni "3.5" szelet, acrobot kérése, 2026-09-24).
 *
 * SAJÁT, KÜLÖN KOMPONENS, UGYANAZÉRT, AMIÉRT A `CompletionCertificatePanel`:
 * a `service-job-detail-page.tsx` már nagy, egy különálló panel nem
 * kockáztatja azt a felületet.
 *
 * A SZÁMLA MA MINDIG HIÁNYZIK (4. szelet, Számlázz.hu-kulcs), ezért a
 * "Kiküldés" a szerver kapuján MA MINDIG elutasít -- ez a helyes, várt
 * állapot. A "Csomag letöltése" (belső ellenőrzéshez) számla nélkül is megy.
 */
export function MaintenancePackagePanel({
  serviceJobId,
  jobNumber,
}: {
  serviceJobId: string;
  jobNumber: string;
}) {
  const { session } = useAuth();
  const token = session?.token ?? "";

  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [preview, setPreview] = useState<MaintenancePackageMailPreview | null>(
    null,
  );
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const download = async () => {
    setDownloadError(null);
    setDownloading(true);
    try {
      const blob = await maintenancePackageApi.download(token, serviceJobId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${jobNumber}-dokumentumcsomag.zip`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setDownloadError(
        cause instanceof Error
          ? cause.message
          : "A karbantartási csomag nem tölthető le.",
      );
    } finally {
      setDownloading(false);
    }
  };

  const openMailDialog = () => {
    setDialogOpen(true);
    setPreview(null);
    setPreviewError(null);
    setSendError(null);
    void maintenancePackageApi
      .mailPreview(token, serviceJobId)
      .then(setPreview)
      .catch((cause: unknown) =>
        setPreviewError(
          cause instanceof Error
            ? cause.message
            : "A címzettek nem tölthetők be.",
        ),
      );
  };

  const send = async (input: { subject: string; message: string }) => {
    setSending(true);
    setSendError(null);
    try {
      const result = await maintenancePackageApi.sendMail(
        token,
        serviceJobId,
        input,
      );
      if (result.kind === "refused") {
        setSendError(result.message);
        return;
      }
      setDialogOpen(false);
    } catch (cause) {
      setSendError(
        cause instanceof Error
          ? cause.message
          : "A karbantartási csomag kiküldése nem sikerült.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <ServicePanel>
      <ServicePanelHeading title="Dokumentumcsomag" />
      {downloadError ? (
        <Alert variant="danger" title="Hiba" description={downloadError} />
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          disabled={downloading}
          onClick={() => void download()}
        >
          {downloading ? "Letöltés…" : "Csomag letöltése"}
        </Button>
        <Button onClick={openMailDialog}>Kiküldés</Button>
      </div>

      <MaintenancePackageMailDialog
        open={dialogOpen}
        jobNumber={jobNumber}
        preview={preview}
        previewError={previewError}
        sendError={sendError}
        busy={sending}
        onSend={(input) => void send(input)}
        onCancel={() => setDialogOpen(false)}
      />
    </ServicePanel>
  );
}
