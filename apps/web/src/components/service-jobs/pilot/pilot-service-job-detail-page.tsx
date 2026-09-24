"use client";

import { Alert, ConfirmDialog, EmptyState, Skeleton } from "@acropora/ui";
import {
  hasPermission,
  isFinishedServiceJob,
  PERMISSIONS,
  type ServiceJobDetail,
  type ServiceJobDocumentSummary,
  type ServiceJobHandoverMailPreview,
  type ServiceJobStatusValue,
  type ServiceJobTimelineEntry,
  type WorksheetAttachableItem,
} from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { serviceJobsApi } from "@/lib/api/service-jobs";
import { worksheetsApi } from "@/lib/api/worksheets";
import { formatDateTime } from "@/components/worksheets/worksheet-labels";
import { megjegyzesKuldheto } from "../megjegyzes-celja";
import { HandoverMailDialog } from "../handover-mail-dialog";
import { KULDES_KIHAGYAS_OKA } from "../handover-mail-skip-reason";
import { PartnerPicker } from "../partner-picker";
import { ServiceDocumentGallery } from "@/components/service/service-document-gallery";
import { ServiceOfflineNotice } from "@/components/service/service-offline-notice";
import { PilotDelegatedColleaguesCard } from "./pilot-delegated-colleagues-card";
import { ServiceJobPlacementEditor } from "../service-job-placement-editor";
import { ServiceJobFieldsEditor } from "../service-job-fields-editor";
import { CompletionCertificatePanel } from "../completion-certificate-panel";
import { MaintenancePackagePanel } from "../maintenance-package-panel";
import {
  serviceJobNoteDescription,
  serviceJobStatusLabel,
  serviceJobWorksheetLabel,
} from "../service-job-labels";
import { STATUS_BADGE_VARIANT } from "./pilot-service-job-list-view";
import {
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";

/**
 * A FIGMA MAKE TERV ÁTÜLTETÉSE -- HIBAJEGY ADATLAP (2. kör a háromból).
 *
 * Acrobot kérése (msg 23137/23138/23139), forrás:
 * `exchange/figma-hibajegyek-make-6/src/HibajegyekScreen.tsx`
 * (`HibajegyDetail`, a delegálás-kártyával egyben, a 6. Make-export).
 *
 * === A VARRAT SZÁNDÉKOS, ÉS MÁR VOLT RÁ PRECEDENS -- EGY KIVÉTELLEL ===
 *
 * A lap SAJÁT kártyái (fejléc, "Mi a baj?", "Munkalapok", "Lezárás és
 * átadás", "Következő lépés", "Előzmények") Figma-stílust kapnak. A
 * legtöbb ÖSSZETETT, ma is működő beágyazott alrendszer (helyszín+eszköz-
 * szerkesztő, fénykép-galéria, átadás e-mail dialógus, partner-választó,
 * törlés-megerősítő) VÁLTOZATLAN kinézettel marad -- ugyanaz a minta, mint
 * a `pilot-aquarium-editor-page.tsx`-en (ott a `ConfirmDialog` és a
 * `CustomerPicker` is a régi `@acropora/ui` stílusban marad). Bejelentve
 * acrobotnak: murena, 2026-09-24 (msg 23166).
 *
 * === A DELEGÁLÁS KÁRTYÁJA KIVÉTEL A VARRAT ALÓL ===
 *
 * A fenti seam-javaslatra acrobot válasza (msg 23168, Balázs kérése
 * alapján): a "Delegált kollégák" kártya és a kollégaválasztó NEM
 * maradhat régi kinézetben, mert ezt Balázs KÜLÖN kérte a Figmában (az 5b
 * kiegészítés: kártya az adatlap tetején, avatar-lista, választó chipekkel
 * -- lásd `exchange/figma-leiras-5b-hibajegy-delegalas-2026-09-24.md`). A
 * régi `ServiceJobAssigneeEditor` helyett ezért a `PilotDelegatedColleaguesCard`
 * fut, ami a Figma `DegalaltKollegakCard`/`DelegalasPicker` mintáját
 * követi, a MEGLÉVŐ `serviceJobsApi.setAssignees` végpontra és
 * `useAssignableUsers` jelölt-listára építve -- ez tehát a VARRAT
 * kivétele, nem az általános szabály megszegése. A többi felsorolt
 * alrendszer (helyszín+eszköz, galéria, átadás, partner, törlés) marad a
 * varrat alatt, régi stílusban.
 *
 * === A DELEGÁLÁS ÁTKERÜLT A JOBB HASÁBBÓL A LAP TETEJÉRE ===
 *
 * A mai (nem-pilot) adatlapon a delegálás-szerkesztő a jobb hasábban áll,
 * a "Következő lépés" alatt -- ez egy KIMONDOTT döntés volt (acrobot,
 * 2026-09-15, lásd a régi `service-job-detail-page.tsx` kommentjét). A
 * Figma-terv (és Balázs 5b kiegészítése) viszont a bal hasáb TETEJÉRE
 * teszi, "Mi a baj?" fölé. Mivel ez a kör kifejezetten a Figma-elrendezést
 * viszi át, és a kiegészítést maga Balázs kérte (acrobot közvetítésével,
 * msg 23138/23139/23168), az ÚJ helyet követjük -- ez nem ellentmond a
 * régi döntésnek, hanem Balázs frissebb, kimondott elrendezése.
 *
 * === "DELEGÁLTA: X" -- ÚJ MEZŐ, MEGLÉVŐ ADATBÓL ===
 *
 * A teljes Figma-hűséghez a delegálás-kártya soronként kiírja, ki és
 * mikor delegált. Ehhez a `ServiceJobAssignee.assignedByName` mező
 * felvéve (2026-09-24), a részletlap lekérdezése kibővítve -- lásd
 * `pilot-delegated-colleagues-card.tsx` fejlécét.
 *
 * === MUNKALAP-SOR: A FIGMA TÖBBET MUTAT, MINT AMIT MA TUDUNK ===
 *
 * A terv soronként technikust és állapot-jelvényt is ígér. A valódi
 * `ServiceJobWorksheetLink` típus ezt NEM hordozza (csak szám, cím,
 * létrehozás és átadás dátuma) -- a részletlap a lapok STÁTUSZÁT és
 * technikusát sosem kérte le, mert a lista ma sem mutatta. Kitalált adatot
 * a ház szabálya szerint nem viszünk fel: a sor a VALÓS mezőket mutatja
 * (szám, cím, létrehozva, átadva), jelvény és technikus nélkül.
 *
 * === AZ IDŐVONAL NÉGY VALÓS FORRÁSBÓL ÁLL, NEM ÖTBŐL ===
 *
 * A Figma minta öt eseménytípust ismer (létrehozás, munkalap, állapot,
 * e-mail, megjegyzés). A valódi `ServiceJobTimelineEntry` csak négyet
 * (status, worksheet, asset, document -- ez utóbbi kizárólag TÖRLÉS,
 * lásd `ServiceJobDocumentRemoval` fejlécét). "E-mail kiküldve" esemény
 * MA nincs a naplóban; a kiküldés ténye a "Lezárás és átadás" kártyán
 * látszik, nem az időrendben.
 *
 * === A ROUTE MAINTENANCE JEGYET IS KISZOLGÁL, NEM CSAK REPAIR-T ===
 *
 * TÉVES FELTEVÉS ÁLLT ITT KORÁBBAN, acrobot javította (msg 23174,
 * 2026-09-24): a `/szerviz/hibajegyek/[id]` útvonal NEM csak hibajegyeket
 * (REPAIR) szolgál ki. A karbantartás-lista (`service-job-list-page.tsx`,
 * `kind="MAINTENANCE"`) MINDEN sorát erre az útvonalra viszi -- a
 * `/szerviz/karbantartas/` alatt NINCS saját `[id]/page.tsx`, csak
 * `page.tsx` (lista) és `uj/` (felvitel). A mai (nem-pilot)
 * `service-job-detail-page.tsx` ezért `job.kind === "MAINTENANCE"`
 * esetén megjeleníti a `CompletionCertificatePanel`-t (teljesítési
 * igazolás kiállítása) és a `MaintenancePackagePanel`-t (karbantartási
 * csomag összeállítás + kiküldés) -- ez a lap éles kiadás esetén
 * LEVETTE VOLNA ezt a két panelt minden karbantartási jegyről, amíg ezt
 * a hibát nem javítottuk. A két panel most a régi kinézetben, a jobb
 * hasábban áll, "Az ügy adatai" alatt -- ugyanott, ahol a mai lapon --,
 * mert mindkettő önálló, ma is működő alrendszer (saját `ServicePanel`,
 * saját adatlekérés), tehát a varrat alá tartozik, nem a lap saját
 * kártyái közé.
 */

function timelineLine(entry: ServiceJobTimelineEntry): string {
  if (entry.kind === "status") {
    const to = serviceJobStatusLabel[entry.event.toStatus];
    if (entry.event.fromStatus === null) return `A hibajegy létrejött (${to}).`;
    const from = serviceJobStatusLabel[entry.event.fromStatus];
    return `${from} → ${to}`;
  }
  if (entry.kind === "worksheet")
    return `Munkalap a jegy alatt: ${serviceJobWorksheetLabel(entry.worksheet)}`;
  if (entry.kind === "document") {
    const mi =
      entry.removal.documentType === "PHOTO"
        ? `fényképet (${entry.removal.fileName})`
        : `csatolmányt (${entry.removal.fileName})`;
    return entry.removal.actorName
      ? `${entry.removal.actorName} törölt egy ${mi}`
      : `Törölt ${mi}`;
  }
  return `Eszköz a jegyen: ${entry.asset.assetNumber} (${entry.asset.assetName})`;
}

/** Az időrend-ikon négy valós forrásra -- ugyanaz a forma, mint a Figma tervé, a saját négy kindünkre igazítva. */
function TimelineIcon({ kind }: { kind: ServiceJobTimelineEntry["kind"] }) {
  const cfg: Record<
    ServiceJobTimelineEntry["kind"],
    { bg: string; stroke: string; path: string }
  > = {
    status: {
      bg: "bg-pilot-amber-100",
      stroke: "#b45309",
      path: "M8 4v4l2.5 2.5",
    },
    worksheet: {
      bg: "bg-pilot-grey-100",
      stroke: "#6b7583",
      path: "M4 8h8M4 5h8M4 11h5",
    },
    asset: {
      bg: "bg-pilot-aqua-100",
      stroke: "#0b7a6e",
      path: "M8 2l5 3v6l-5 3-5-3V5l5-3z",
    },
    document: {
      bg: "bg-pilot-grey-100",
      stroke: "#6b7583",
      path: "M4 6h8M4 9h6",
    },
  };
  const { bg, stroke, path } = cfg[kind];
  return (
    <span
      className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ring-2 ring-white ${bg}`}
    >
      <svg
        width={12}
        height={12}
        viewBox="0 0 16 16"
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={path} />
      </svg>
    </span>
  );
}

export function PilotServiceJobDetailPage({ jobId }: { jobId: string }) {
  const { session } = useAuth();
  const [job, setJob] = useState<ServiceJobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [stepping, setStepping] = useState(false);
  const [note, setNote] = useState("");
  const [noteCelja, setNoteCelja] = useState<ServiceJobStatusValue | null>(
    null,
  );
  const [attachable, setAttachable] = useState<WorksheetAttachableItem[]>([]);
  const [chosenSheet, setChosenSheet] = useState("");
  const [attachError, setAttachError] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [sheetToDetach, setSheetToDetach] = useState<string | null>(null);
  const [partnerError, setPartnerError] = useState<string | null>(null);
  const [documents, setDocuments] = useState<ServiceJobDocumentSummary[]>([]);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [documentFiles, setDocumentFiles] = useState<File[]>([]);
  const [documentCaption, setDocumentCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [documentToDelete, setDocumentToDelete] =
    useState<ServiceJobDocumentSummary | null>(null);
  const [downloadingPackage, setDownloadingPackage] = useState(false);
  const [packageError, setPackageError] = useState<string | null>(null);
  const [mailOpen, setMailOpen] = useState(false);
  const [mailPreview, setMailPreview] =
    useState<ServiceJobHandoverMailPreview | null>(null);
  const [mailPreviewError, setMailPreviewError] = useState<string | null>(null);
  const [mailSendError, setMailSendError] = useState<string | null>(null);
  const [mailSending, setMailSending] = useState(false);
  const [mailResult, setMailResult] = useState<string | null>(null);
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_MANAGE),
  );
  const canHide = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_HIDE),
  );
  const token = session?.token ?? "";

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        setJob(await serviceJobsApi.detail(token, jobId, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A hibajegy nem tölthető be.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [canView, jobId, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const jobCustomerId = job?.customerId ?? null;
  useEffect(() => {
    if (!canManage || jobCustomerId === null) return;
    const controller = new AbortController();
    worksheetsApi
      .attachable(token, jobCustomerId, controller.signal)
      .then((response) => setAttachable(response.items))
      .catch(() => undefined);
    return () => controller.abort();
  }, [canManage, jobCustomerId, token]);

  const step = async (to: ServiceJobStatusValue) => {
    const ellenorzes = megjegyzesKuldheto({
      szoveg: note,
      celzott: noteCelja,
      most: to,
      cimke: (lepes) => serviceJobStatusLabel[lepes],
    });
    if (!ellenorzes.rendben) {
      setStepError(ellenorzes.uzenet);
      return;
    }

    setStepping(true);
    setStepError(null);
    try {
      await serviceJobsApi.move(token, jobId, {
        to,
        note: note.trim() || null,
      });
      setNote("");
      setNoteCelja(null);
      await load();
    } catch (cause) {
      setStepError(
        cause instanceof Error ? cause.message : "A lépés nem sikerült.",
      );
      setNoteCelja(note.trim() === "" ? null : to);
    } finally {
      setStepping(false);
    }
  };

  const refreshAttachable = async () => {
    if (jobCustomerId === null) return;
    const response = await worksheetsApi.attachable(token, jobCustomerId);
    setAttachable(response.items);
  };

  const setPartner = async (customerId: string) => {
    setPartnerError(null);
    try {
      await serviceJobsApi.setPartner(token, jobId, customerId);
      await load();
    } catch (cause) {
      setPartnerError(
        cause instanceof Error
          ? cause.message
          : "A partner beállítása nem sikerült.",
      );
    }
  };

  const loadDocuments = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      try {
        const response = await serviceJobsApi.documents(token, jobId, signal);
        setDocuments(response.items);
        setDocumentsError(null);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setDocumentsError(
          cause instanceof Error
            ? cause.message
            : "A csatolmányok nem tölthetők be.",
        );
      }
    },
    [canView, jobId, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadDocuments(controller.signal);
    return () => controller.abort();
  }, [loadDocuments]);

  const uploadDocuments = async () => {
    if (documentFiles.length === 0 || uploading) return;
    setUploading(true);
    setDocumentsError(null);
    try {
      const kepek = documentFiles.filter((file) =>
        file.type.startsWith("image/"),
      );
      const egyeb = documentFiles.filter(
        (file) => !file.type.startsWith("image/"),
      );
      if (kepek.length)
        await serviceJobsApi.uploadDocument(
          token,
          jobId,
          "PHOTO",
          kepek,
          documentCaption,
        );
      if (egyeb.length)
        await serviceJobsApi.uploadDocument(
          token,
          jobId,
          "OTHER",
          egyeb,
          documentCaption,
        );
      setDocumentFiles([]);
      setDocumentCaption("");
      await loadDocuments();
    } catch (cause) {
      setDocumentsError(
        cause instanceof Error ? cause.message : "A feltöltés nem sikerült.",
      );
    } finally {
      setUploading(false);
    }
  };

  const downloadDocument = async (item: ServiceJobDocumentSummary) => {
    setDocumentsError(null);
    try {
      const blob = await serviceJobsApi.downloadDocument(token, jobId, item.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setDocumentsError(
        cause instanceof Error ? cause.message : "A letöltés nem sikerült.",
      );
    }
  };

  const downloadPackage = async () => {
    setDownloadingPackage(true);
    setPackageError(null);
    try {
      const blob = await serviceJobsApi.downloadPackage(token, jobId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${job?.jobNumber ?? "hibajegy"}-dokumentumcsomag.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setPackageError(
        cause instanceof Error
          ? cause.message
          : "A dokumentumcsomag nem tölthető le.",
      );
    } finally {
      setDownloadingPackage(false);
    }
  };

  const openHandoverMail = async () => {
    setMailOpen(true);
    setMailPreview(null);
    setMailPreviewError(null);
    setMailSendError(null);
    setMailResult(null);
    try {
      setMailPreview(await serviceJobsApi.handoverMailPreview(token, jobId));
    } catch (cause) {
      setMailPreviewError(
        cause instanceof Error
          ? cause.message
          : "A címzettek nem tölthetők be.",
      );
    }
  };

  const sendHandoverMail = async (input: {
    subject: string;
    message: string;
  }) => {
    setMailSending(true);
    setMailSendError(null);
    try {
      const eredmeny = await serviceJobsApi.sendHandoverMail(token, jobId, {
        subject: input.subject.trim() || undefined,
        message: input.message,
      });
      if (eredmeny.kind === "sent") {
        setMailOpen(false);
        setMailResult(`A hibajegy kiküldve ${eredmeny.recipients} címzettnek.`);
        await load();
        return;
      }
      setMailSendError(
        eredmeny.kind === "refused"
          ? eredmeny.message
          : KULDES_KIHAGYAS_OKA[eredmeny.reason],
      );
    } catch (cause) {
      setMailSendError(
        cause instanceof Error ? cause.message : "A kiküldés nem sikerült.",
      );
    } finally {
      setMailSending(false);
    }
  };

  const deleteDocument = async (documentId: string) => {
    setDocumentToDelete(null);
    setDocumentsError(null);
    try {
      await serviceJobsApi.deleteDocument(token, jobId, documentId);
      await loadDocuments();
    } catch (cause) {
      setDocumentsError(
        cause instanceof Error ? cause.message : "A törlés nem sikerült.",
      );
    }
  };

  const detach = async (worksheetId: string) => {
    setSheetToDetach(null);
    setAttaching(true);
    setAttachError(null);
    try {
      await serviceJobsApi.detachWorksheet(token, jobId, worksheetId);
      await Promise.all([load(), refreshAttachable()]);
    } catch (cause) {
      setAttachError(
        cause instanceof Error ? cause.message : "A leválasztás nem sikerült.",
      );
    } finally {
      setAttaching(false);
    }
  };

  const attach = async () => {
    if (!chosenSheet) return;
    setAttaching(true);
    setAttachError(null);
    try {
      await serviceJobsApi.attachWorksheet(token, jobId, chosenSheet);
      setChosenSheet("");
      await Promise.all([load(), refreshAttachable()]);
    } catch (cause) {
      setAttachError(
        cause instanceof Error ? cause.message : "A csatolás nem sikerült.",
      );
    } finally {
      setAttaching(false);
    }
  };

  const offlineSav = (
    <ServiceOfflineNotice
      state={job ? { kind: "loaded" } : { kind: "empty" }}
    />
  );

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a hibajegyekhez"
        description="service.view jogosultság szükséges."
      />
    );

  if (loading && !job)
    return (
      <PilotThemeRoot className="-m-6 min-h-screen bg-pilot-grey-50 p-8">
        {offlineSav}
        <div className="space-y-3" aria-label="Hibajegy betöltése">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      </PilotThemeRoot>
    );

  if (error && !job)
    return (
      <PilotThemeRoot className="-m-6 min-h-screen bg-pilot-grey-50 p-8">
        {offlineSav}
        <Alert
          variant="danger"
          title="Betöltési hiba"
          description={error}
          action={
            <PilotButton variant="secondary" onClick={() => void load()}>
              Újrapróbálás
            </PilotButton>
          }
        />
      </PilotThemeRoot>
    );

  if (!job) return offlineSav;

  const worksheets = job.timeline.flatMap((entry) =>
    entry.kind === "worksheet" ? [entry.worksheet] : [],
  );
  const finished = isFinishedServiceJob(job.status);

  return (
    <PilotThemeRoot className="-m-6 flex min-h-screen flex-col bg-pilot-grey-50">
      {offlineSav}
      <div className="border-b border-pilot-grey-200 bg-white px-8 py-5">
        <nav className="mb-3 flex items-center gap-1.5 text-xs text-pilot-grey-400">
          <Link
            href="/szerviz/hibajegyek"
            className="transition-colors hover:text-pilot-aqua-600"
          >
            Szerviz
          </Link>
          <span>/</span>
          <Link
            href="/szerviz/hibajegyek"
            className="transition-colors hover:text-pilot-aqua-600"
          >
            Hibajegyek
          </Link>
          <span>/</span>
          <span className="font-medium text-pilot-grey-700">
            {job.jobNumber}
          </span>
        </nav>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="font-mono text-xs text-pilot-grey-400">
                {job.jobNumber}
              </span>
              <PilotBadge variant={STATUS_BADGE_VARIANT[job.status]}>
                {serviceJobStatusLabel[job.status]}
              </PilotBadge>
              {job.hidden ? (
                <PilotBadge variant="amber">Rejtett</PilotBadge>
              ) : null}
            </div>
            <h1 className="text-xl font-semibold text-pilot-grey-900">
              {job.title}
            </h1>
            <p className="mt-2 text-xs text-pilot-grey-400">
              {job.customerName ?? "Nincs megadva"}
              {job.departmentPath?.length
                ? ` · ${job.departmentPath.join(" / ")}`
                : ""}{" "}
              · Létrehozva: {formatDateTime(job.createdAt)}
            </p>
          </div>
          {job.partnerStatus === "COMPLETED" ? (
            <div className="flex flex-wrap gap-2">
              <PilotButton
                variant="secondary"
                onClick={() => void downloadPackage()}
                disabled={downloadingPackage}
              >
                {downloadingPackage
                  ? "Dokumentumcsomag letöltése…"
                  : "Csomag letöltése (.zip)"}
              </PilotButton>
              {canManage ? (
                <PilotButton
                  variant="primary"
                  onClick={() => void openHandoverMail()}
                >
                  Küldés e-mailben
                </PilotButton>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {packageError ? (
        <div className="px-8 pt-4">
          <Alert
            variant="danger"
            title="Letöltési hiba"
            description={packageError}
          />
        </div>
      ) : null}
      {mailResult ? (
        <div className="px-8 pt-4">
          <Alert variant="info" title="Kiküldés" description={mailResult} />
        </div>
      ) : null}
      {error ? (
        <div className="px-8 pt-4">
          <Alert
            variant="danger"
            title="Betöltési hiba"
            description={error}
            action={
              <PilotButton variant="secondary" onClick={() => void load()}>
                Újrapróbálás
              </PilotButton>
            }
          />
        </div>
      ) : null}

      <HandoverMailDialog
        open={mailOpen}
        jobNumber={job.jobNumber}
        preview={mailPreview}
        previewError={mailPreviewError}
        sendError={mailSendError}
        busy={mailSending}
        onSend={(input) => void sendHandoverMail(input)}
        onCancel={() => setMailOpen(false)}
      />

      <div className="grid flex-1 grid-cols-1 items-start gap-6 px-8 py-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-5">
          {/*
            A DELEGÁLÁS ITT, A TETEJÉN -- lásd a fejléc "A DELEGÁLÁS
            ÁTKERÜLT" szakaszát. EZ A KÁRTYA FIGMA-STÍLUSÚ (nem a varrat
            része) -- Balázs kifejezetten kérte, lásd a fejléc "A
            DELEGÁLÁS KÁRTYÁJA KIVÉTEL A VARRAT ALÓL" szakaszát.
          */}
          <PilotDelegatedColleaguesCard
            jobId={jobId}
            token={token}
            assignees={job.assignees}
            canManage={canManage}
            onSaved={setJob}
          />

          <PilotCard>
            <PilotCardHeader
              title="Mi a baj?"
              action={
                finished ? (
                  <span className="text-xs italic text-pilot-grey-400">
                    Lezárt hibajegy nem szerkeszthető
                  </span>
                ) : undefined
              }
            />
            <div className="space-y-3 px-5 py-4">
              {job.description ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-pilot-grey-700">
                  {job.description}
                </p>
              ) : (
                <p className="text-sm italic text-pilot-grey-400">
                  A bejelentéshez nem írtak leírást.
                </p>
              )}
              {/*
                A SZERKESZTŐ ÖNÁLLÓ WIDGET (saját "Bejelentés szerkesztése"
                gombbal és saját panellel) -- ide nem kell külön
                szerkesztés-mód, a komponens ezt maga tudja. Régi stílusban,
                lásd a fejléc varrat-szakaszát.
              */}
              {canManage && !finished ? (
                <ServiceJobFieldsEditor
                  jobId={jobId}
                  token={token}
                  title={job.title}
                  description={job.description}
                  onSaved={() => load()}
                />
              ) : null}
            </div>
            {/*
              A FÉNYKÉPEK/FÁJLOK IDE KÖLTÖZTEK, A "MI A BAJ?" KÁRTYÁBA -- a
              Figma-terv is így csoportosítja, és a mai kód komment is ezt
              mondja ("a fénykép a BEJELENTETT hibáról szól").
            */}
            <div className="space-y-3 border-t border-pilot-grey-100 px-5 py-4">
              <p className="text-xs text-pilot-grey-400">
                A bejelentett hibáról. JPEG, PNG vagy PDF, fájlonként legfeljebb
                10 MB.
              </p>
              {documentsError ? (
                <Alert
                  variant="danger"
                  title="A csatolmányokkal baj van"
                  description={documentsError}
                />
              ) : null}
              <ServiceDocumentGallery
                items={documents}
                loadBlob={(documentId) =>
                  serviceJobsApi.downloadDocumentThumbnail(
                    token,
                    jobId,
                    documentId,
                  )
                }
                onDownload={(item) => void downloadDocument(item)}
                onDelete={canManage ? setDocumentToDelete : undefined}
                onSaveCaption={
                  canManage
                    ? async (item, caption) => {
                        await serviceJobsApi.setDocumentCaption(
                          token,
                          jobId,
                          item.id,
                          caption,
                        );
                        await loadDocuments();
                      }
                    : undefined
                }
                emptyText="Ehhez a jegyhez még nincs fénykép vagy fájl csatolva."
              />
              {canManage ? (
                <div className="flex flex-wrap items-end gap-3 border-t border-pilot-grey-100 pt-3">
                  <div className="space-y-1">
                    <label
                      className="block text-xs font-medium text-pilot-grey-700"
                      htmlFor="pilot-hibajegy-csatolmany"
                    >
                      Új csatolmány
                    </label>
                    <input
                      id="pilot-hibajegy-csatolmany"
                      type="file"
                      multiple
                      accept="image/jpeg,image/png,application/pdf"
                      className="text-sm"
                      onChange={(event) =>
                        setDocumentFiles(Array.from(event.target.files ?? []))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label
                      className="block text-xs font-medium text-pilot-grey-700"
                      htmlFor="pilot-hibajegy-csatolmany-felirat"
                    >
                      Felirat (elhagyható)
                    </label>
                    <input
                      id="pilot-hibajegy-csatolmany-felirat"
                      value={documentCaption}
                      maxLength={500}
                      onChange={(event) =>
                        setDocumentCaption(event.target.value)
                      }
                      placeholder="Mit látunk a képeken?"
                      className="rounded-md px-3 py-1.5 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-300 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
                    />
                  </div>
                  <PilotButton
                    variant="secondary"
                    disabled={documentFiles.length === 0 || uploading}
                    onClick={() => void uploadDocuments()}
                  >
                    {documentFiles.length > 1
                      ? `Feltöltés (${documentFiles.length} fájl)`
                      : "Feltöltés"}
                  </PilotButton>
                </div>
              ) : null}
            </div>
          </PilotCard>

          {/*
            HELYSZÍN ÉS ESZKÖZÖK -- a Figma "Eszköz" kártyájának helyén, de
            a valódi (több eszközt, szerkeszthető helyszínt kezelő)
            komponenssel, régi stílusban (lásd a fejléc varrat-szakaszát).
          */}
          <ServiceJobPlacementEditor
            jobId={jobId}
            token={token}
            customerId={job.customerId}
            departmentId={job.departmentId}
            departmentPath={job.departmentPath}
            assets={job.assets}
            worksheets={worksheets}
            canManage={canManage}
            onSaved={setJob}
          />

          <PilotCard>
            <PilotCardHeader
              title="Munkalapok"
              action={
                canManage && job.customerId !== null ? (
                  <Link
                    href={`/szerviz/munkalapok/uj?hibajegy=${encodeURIComponent(jobId)}`}
                  >
                    <PilotButton variant="primary">Új munkalap</PilotButton>
                  </Link>
                ) : undefined
              }
            />
            {worksheets.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-pilot-grey-400">
                Még nincs munkalap ehhez a hibajegyhez.
              </p>
            ) : (
              <div className="divide-y divide-pilot-grey-50">
                {worksheets.map((worksheet) => (
                  <div
                    key={worksheet.id}
                    className="flex items-center justify-between px-5 py-3 transition-colors hover:bg-pilot-grey-50"
                  >
                    <div>
                      <p className="font-mono text-xs text-pilot-grey-400">
                        {worksheet.number ?? "Piszkozat"}
                      </p>
                      <Link
                        href={`/szerviz/munkalapok/${worksheet.id}`}
                        className="text-sm font-medium text-pilot-grey-800 hover:text-pilot-aqua-700"
                      >
                        {serviceJobWorksheetLabel(worksheet)}
                      </Link>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-pilot-grey-400">
                      {worksheet.handedOverAt ? (
                        <span>
                          Átadva: {formatDateTime(worksheet.handedOverAt)}
                        </span>
                      ) : null}
                      <span>{formatDateTime(worksheet.createdAt)}</span>
                      {canManage ? (
                        <button
                          type="button"
                          className="cursor-pointer underline hover:text-pilot-aqua-700"
                          disabled={attaching}
                          onClick={() => setSheetToDetach(worksheet.id)}
                        >
                          Leválasztás
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {canManage ? (
              <div className="space-y-2 border-t border-pilot-grey-100 px-5 py-4">
                <label
                  className="block text-xs font-medium text-pilot-grey-700"
                  htmlFor="pilot-csatolando-munkalap"
                >
                  Meglévő munkalap csatolása
                </label>
                {attachError ? (
                  <Alert
                    variant="danger"
                    title="A csatolás nem ment"
                    description={attachError}
                  />
                ) : null}
                {attachable.length ? (
                  <div className="flex flex-wrap gap-2">
                    <select
                      id="pilot-csatolando-munkalap"
                      className="cursor-pointer appearance-none rounded-md px-2.5 py-1.5 text-sm text-pilot-grey-700 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
                      value={chosenSheet}
                      onChange={(event) => setChosenSheet(event.target.value)}
                    >
                      <option value="">Válassz munkalapot</option>
                      {attachable.map((sheet) => (
                        <option key={sheet.id} value={sheet.id}>
                          {sheet.number ?? "Piszkozat"} - {sheet.customerName} -{" "}
                          {sheet.subject}
                        </option>
                      ))}
                    </select>
                    <PilotButton
                      variant="secondary"
                      disabled={!chosenSheet || attaching}
                      onClick={() => void attach()}
                    >
                      Csatolás
                    </PilotButton>
                  </div>
                ) : (
                  <p className="text-sm text-pilot-grey-400">
                    Ehhez a partnerhez nincs olyan munkalap, ami még egyik
                    hibajegyhez sem tartozik.
                  </p>
                )}
              </div>
            ) : null}
          </PilotCard>

          {job.partnerStatus === "COMPLETED" ? (
            <PilotCard>
              <PilotCardHeader title="Lezárás és átadás" />
              <div className="flex flex-col gap-3 px-5 py-4">
                <p className="text-xs text-pilot-grey-400">
                  A dokumentumcsomag letölthető, vagy kiküldhető e-mailben -- a
                  fenti gombokkal.
                </p>
                <div className="flex items-center gap-3">
                  <PilotButton
                    variant="secondary"
                    onClick={() => void downloadPackage()}
                    disabled={downloadingPackage}
                  >
                    {downloadingPackage
                      ? "Letöltés…"
                      : "Csomag letöltése (.zip)"}
                  </PilotButton>
                  {canManage ? (
                    <PilotButton
                      variant="primary"
                      onClick={() => void openHandoverMail()}
                    >
                      Küldés e-mailben
                    </PilotButton>
                  ) : null}
                </div>
              </div>
            </PilotCard>
          ) : null}

          {canHide ? (
            <PilotCard>
              <div className="space-y-2 px-5 py-4">
                <PilotButton
                  variant="secondary"
                  onClick={() =>
                    void serviceJobsApi
                      .setHidden(token, jobId, !job.hidden)
                      .then(() => load())
                  }
                >
                  {job.hidden ? "Visszaállítás" : "Elrejtés"}
                </PilotButton>
                <p className="text-xs text-pilot-grey-400">
                  {job.hidden
                    ? "Ez a jegy nincs benne a listákban. A visszaállítás után újra megjelenik."
                    : "A jegy kikerül a listákból, de megmarad, és a munkalapjai változatlanul látszanak."}
                </p>
              </div>
            </PilotCard>
          ) : null}

          {canManage && job.customerName === null ? (
            <PilotCard>
              <div className="space-y-2 px-5 py-4">
                <label
                  className="block text-sm font-semibold text-pilot-grey-900"
                  htmlFor="pilot-jegy-partner"
                >
                  Partner beállítása
                </label>
                <p className="text-xs text-pilot-grey-400">
                  Ehhez a hibajegyhez még nincs partner, ezért munkalapot sem
                  lehet alá csatolni.
                </p>
                {partnerError ? (
                  <Alert
                    variant="danger"
                    title="Nem sikerült"
                    description={partnerError}
                  />
                ) : null}
                <PartnerPicker
                  id="pilot-jegy-partner"
                  onPick={(picked) => void setPartner(picked.customerId)}
                />
              </div>
            </PilotCard>
          ) : null}
        </div>

        <div className="flex flex-col gap-5">
          {canManage ? (
            <PilotCard>
              <PilotCardHeader
                title={
                  job.allowedSteps.length
                    ? "Hova lép a jegy?"
                    : "Nincs több lépés"
                }
              />
              <div className="space-y-3 px-5 py-4">
                {stepError ? (
                  <Alert
                    variant="danger"
                    title="A lépés nem ment"
                    description={stepError}
                  />
                ) : null}
                {job.allowedSteps.length ? (
                  <>
                    <div className="space-y-1">
                      <label
                        className="block text-xs font-medium text-pilot-grey-700"
                        htmlFor="pilot-jegy-megjegyzes"
                      >
                        Megjegyzés
                      </label>
                      <textarea
                        id="pilot-jegy-megjegyzes"
                        aria-label="Megjegyzés a lépéshez"
                        rows={3}
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        maxLength={2000}
                        className="w-full resize-none rounded-md px-3 py-2 text-sm text-pilot-grey-800 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
                      />
                      <p className="text-xs text-pilot-grey-400">
                        {serviceJobNoteDescription(job.allowedSteps)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {job.allowedSteps.map((to) => (
                        <PilotButton
                          key={to}
                          variant="secondary"
                          disabled={stepping}
                          onClick={() => void step(to)}
                        >
                          {serviceJobStatusLabel[to]}
                        </PilotButton>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-pilot-grey-400">
                    Ez a hibajegy lezárult, nincs több lépése.
                  </p>
                )}
              </div>
            </PilotCard>
          ) : null}

          <PilotCard>
            <PilotCardHeader title="Az ügy adatai" />
            <div className="space-y-2 px-5 py-4 text-sm">
              <div>
                <p className="text-xs text-pilot-grey-400">Partner</p>
                <p className="text-pilot-grey-800">
                  {job.customerName ?? "Nincs megadva"}
                </p>
              </div>
              {job.departmentName ? (
                <div>
                  <p className="text-xs text-pilot-grey-400">Helyszín</p>
                  <p className="text-pilot-grey-800">
                    {job.departmentPath?.length
                      ? job.departmentPath.join(" / ")
                      : job.departmentName}
                  </p>
                </div>
              ) : null}
              <div>
                <p className="text-xs text-pilot-grey-400">Létrehozva</p>
                <p className="text-pilot-grey-800">
                  {formatDateTime(job.createdAt)}
                </p>
              </div>
              <div>
                <p className="text-xs text-pilot-grey-400">
                  A partner ezt látja
                </p>
                <PilotBadge variant="grey">{job.partnerStatusLabel}</PilotBadge>
              </div>
            </div>
          </PilotCard>

          {/*
            A KARBANTARTÁS-PANELEK, MERT EZ A ROUTE MAINTENANCE JEGYET IS
            KISZOLGÁL -- lásd a fejléc "A ROUTE MAINTENANCE JEGYET IS
            KISZOLGÁL" szakaszát. Régi stílusban maradnak (mindkettő saját
            `ServicePanel`-t rajzol), a varrat része.
          */}
          {job.kind === "MAINTENANCE" ? (
            <CompletionCertificatePanel serviceJobId={job.id} />
          ) : null}
          {job.kind === "MAINTENANCE" ? (
            <MaintenancePackagePanel
              serviceJobId={job.id}
              jobNumber={job.jobNumber}
            />
          ) : null}

          <PilotCard>
            <PilotCardHeader title="Előzmények" />
            <div className="px-5 py-4">
              {job.timeline.length ? (
                <div className="flex flex-col">
                  {job.timeline
                    .slice()
                    .reverse()
                    .map((entry, index, arr) => (
                      <div
                        key={`${entry.kind}-${entry.sortKey}`}
                        className="flex gap-3"
                      >
                        <div className="flex flex-col items-center">
                          <TimelineIcon kind={entry.kind} />
                          {index < arr.length - 1 ? (
                            <div className="my-1 w-px flex-1 bg-pilot-grey-100" />
                          ) : null}
                        </div>
                        <div className="pb-4">
                          <p className="text-xs font-medium text-pilot-grey-700">
                            {timelineLine(entry)}
                          </p>
                          <p className="mt-0.5 text-[10px] text-pilot-grey-400">
                            {formatDateTime(entry.at)}
                            {entry.kind === "status" && entry.event.actorName
                              ? ` · ${entry.event.actorName}`
                              : ""}
                          </p>
                          {entry.kind === "document" &&
                          entry.removal.uploadedAt !== null ? (
                            <p className="mt-0.5 text-[10px] text-pilot-grey-400">
                              Feltöltve:{" "}
                              {formatDateTime(entry.removal.uploadedAt)}
                              {entry.removal.uploadedByName
                                ? ` · ${entry.removal.uploadedByName}`
                                : ""}
                            </p>
                          ) : null}
                          {entry.kind === "status" && entry.event.note ? (
                            <p className="mt-1 whitespace-pre-wrap text-sm text-pilot-grey-700">
                              {entry.event.note}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    ))}
                </div>
              ) : (
                <EmptyState
                  title="Nincs bejegyzés"
                  description="Ezen a jegyen még nem történt semmi."
                />
              )}
            </div>
          </PilotCard>
        </div>
      </div>

      <ConfirmDialog
        open={sheetToDetach !== null}
        title="Leválasztod ezt a munkalapot a hibajegyről?"
        consequence="A lap kikerül a jegy alól, és a jegy naplójából is eltűnik a sora."
        recovery="Visszatehető: a lap újra szabaddá válik, és ugyanitt bármikor visszacsatolható."
        confirmLabel="Leválasztás"
        busy={attaching}
        onConfirm={() => {
          if (sheetToDetach !== null) void detach(sheetToDetach);
        }}
        onCancel={() => setSheetToDetach(null)}
      />
      <ConfirmDialog
        open={documentToDelete !== null}
        title="Törlöd ezt a csatolmányt?"
        consequence={
          documentToDelete
            ? `A(z) ${documentToDelete.fileName} végleg törlődik a hibajegyről.`
            : ""
        }
        recovery="Nem állítható vissza: csak úgy kerül vissza, ha újra feltöltöd."
        confirmLabel="Törlés"
        onConfirm={() => {
          if (documentToDelete) void deleteDocument(documentToDelete.id);
        }}
        onCancel={() => setDocumentToDelete(null)}
      />
    </PilotThemeRoot>
  );
}
