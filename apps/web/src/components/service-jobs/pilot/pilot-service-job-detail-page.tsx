"use client";

import { Alert, ConfirmDialog, EmptyState, Icon, Skeleton } from "@acropora/ui";
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
import { useListHref } from "@/components/navigation-history";
import { serviceJobsApi } from "@/lib/api/service-jobs";
import { worksheetsApi } from "@/lib/api/worksheets";
import {
  formatDateTime,
  formatLaborHours,
  worksheetDisplayLabel,
  worksheetDisplayPilotVariant,
} from "@/components/worksheets/worksheet-labels";
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
import {
  assigneeNames,
  NO_ASSIGNEE,
  STATUS_BADGE_VARIANT,
} from "./pilot-service-job-list-view";
import {
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotDataRow,
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
 * === THE SERVICE REDESIGN (Figma 423:234, Balázs, 2026-10-04) ===
 *
 * The page follows the redesign's two columns. Left: the report, photos and
 * files, the worksheets behind the job, the asset card and "Ami történt".
 * Right: the next step as its own strong panel, the case data, the
 * assignees' card and "Kezelés". The assignees' card moved from the top of
 * the left column (its 2026-09-24 place) to the right, where the design keeps
 * the people; it is the same card inside. Nothing the page did before is
 * gone: the duplicate "Lezárás és átadás" card was dropped because its two
 * buttons stay in the header, where they already were.
 *
 * === "DELEGÁLTA: X" -- ÚJ MEZŐ, MEGLÉVŐ ADATBÓL ===
 *
 * A teljes Figma-hűséghez a delegálás-kártya soronként kiírja, ki és
 * mikor delegált. Ehhez a `ServiceJobAssignee.assignedByName` mező
 * felvéve (2026-09-24), a részletlap lekérdezése kibővítve -- lásd
 * `pilot-delegated-colleagues-card.tsx` fejlécét.
 *
 * === MUNKALAP-SOR: ÁLLAPOT ÉS MUNKAÓRA, 2026-10-04 ÓTA ===
 *
 * The link carries the sheet's current status, line count and labour hours
 * since the redesign's API change (E3), so each row shows the same display
 * status as the worksheet list and its hours. A technician per sheet is
 * still not shown: the link does not carry one, and nothing is invented.
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
  const listHref = useListHref("/szerviz/hibajegyek");
  const [job, setJob] = useState<ServiceJobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /*
    A KET SZERKESZTO-VALTO (Figma-igazitas, 2026-09-25): a "Mi a baj?" es az
    "Eszköz" kartya fejleceben all egy "Szerkesztés"/"Bezárás" hivatkozas,
    nem a kartya torzseben egy sajat gomb -- lasd a `ServiceJobFieldsEditor`
    `open`/`onOpenChange` fejlecet a masodikhoz, es az uj, olvaso "Eszköz"
    osszefoglalot a harmadikhoz.
  */
  const [editingDescription, setEditingDescription] = useState(false);
  const [editingPlacement, setEditingPlacement] = useState(false);
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

  /*
    A FELIRAT MEZO ELTUNT INNEN (Figma-igazitas, 2026-09-25): a feltoltes a
    "+ fotó" csempere kerul, felirat nelkul -- Balazs kerese szerint a
    felirat a feltoltes UTANI lepesbe kerult, ami mar MEGVAN es MUKODIK (lasd
    a `ServiceDocumentGallery` `onSaveCaption`/"Felirat" gombjat lejjebb). A
    hivas ezert innentol kozvetlenul a kivalasztott fajlokat kapja, nem egy
    kozbenso `documentFiles` allapotot -- a valasztas es a feltoltes EGY
    lepes, a felhasznalo nem kattint kulon "Feltöltés" gombra.
  */
  const uploadDocuments = async (files: File[]) => {
    if (files.length === 0 || uploading) return;
    setUploading(true);
    setDocumentsError(null);
    try {
      const kepek = files.filter((file) => file.type.startsWith("image/"));
      const egyeb = files.filter((file) => !file.type.startsWith("image/"));
      if (kepek.length)
        await serviceJobsApi.uploadDocument(token, jobId, "PHOTO", kepek);
      if (egyeb.length)
        await serviceJobsApi.uploadDocument(token, jobId, "OTHER", egyeb);
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
      pilot
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

  const creation = job.timeline.find(
    (entry) => entry.kind === "status" && entry.event.fromStatus === null,
  );
  const reporter =
    creation?.kind === "status" ? creation.event.actorName : null;
  const photoCount = documents.filter((item) => item.type === "PHOTO").length;
  const fileCount = documents.length - photoCount;
  const names = assigneeNames(job.assignees);

  return (
    <PilotThemeRoot className="-m-6 flex min-h-screen flex-col gap-6 bg-pilot-grey-50 px-8 py-8">
      {offlineSav}
      {/*
        THE HEADER OF THE SERVICE REDESIGN (Figma 423:234): back to the list
        (with its last filters), the number, the title, and the internal and
        the partner's status as two separate badges (the brief, point 3).
      */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href={listHref}
            className="text-sm text-pilot-aqua-700 transition-colors hover:text-pilot-aqua-800"
          >
            <span aria-hidden="true">← </span>
            Hibajegyek
          </Link>
          <p className="mt-4 font-mono text-sm text-pilot-grey-500">
            {job.jobNumber}
          </p>
          <h1 className="mt-1 break-words text-3xl font-semibold text-pilot-grey-900">
            {job.title}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <PilotBadge variant={STATUS_BADGE_VARIANT[job.status]}>
              {serviceJobStatusLabel[job.status]}
            </PilotBadge>
            <PilotBadge variant="blue">
              Partner: {job.partnerStatusLabel}
            </PilotBadge>
            {job.hidden ? (
              <PilotBadge variant="amber">Rejtett</PilotBadge>
            ) : null}
          </div>
        </div>
        {job.partnerStatus === "COMPLETED" ? (
          <div className="flex flex-wrap gap-2">
            <PilotButton
              variant="secondary"
              size="regular"
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
                size="regular"
                onClick={() => void openHandoverMail()}
              >
                Küldés e-mailben
              </PilotButton>
            ) : null}
          </div>
        ) : null}
      </div>

      {packageError ? (
        <Alert
          variant="danger"
          title="Letöltési hiba"
          description={packageError}
        />
      ) : null}
      {mailResult ? (
        <Alert variant="info" title="Kiküldés" description={mailResult} />
      ) : null}
      {error ? (
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

      <div className="grid flex-1 grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_368px]">
        <div className="flex min-w-0 flex-col gap-5">
          <PilotCard>
            <PilotCardHeader
              title="A bejelentés"
              action={
                finished ? (
                  <span className="text-xs italic text-pilot-grey-400">
                    Lezárt hibajegy nem szerkeszthető
                  </span>
                ) : canManage ? (
                  <button
                    type="button"
                    onClick={() => setEditingDescription((v) => !v)}
                    className="cursor-pointer text-xs font-medium text-pilot-aqua-600 transition-colors hover:text-pilot-aqua-800"
                  >
                    {editingDescription ? "Bezárás" : "Szerkesztés"}
                  </button>
                ) : undefined
              }
            />
            <div className="space-y-3 px-5 py-4">
              {job.description ? (
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-pilot-grey-800">
                  {job.description}
                </p>
              ) : (
                <p className="text-sm italic text-pilot-grey-400">
                  A bejelentéshez nem írtak leírást.
                </p>
              )}
              {/*
                WHO REPORTED IT AND WHEN: the creation entry of the job's own
                log, not a new field. The design's "Sürgős" badge is left out
                (decision E1): a job has no priority.
              */}
              <p className="text-xs text-pilot-grey-500">
                Bejelentette: {reporter ?? "ismeretlen"} ·{" "}
                {formatDateTime(job.createdAt)}
              </p>
              {canManage && !finished ? (
                <ServiceJobFieldsEditor
                  jobId={jobId}
                  token={token}
                  title={job.title}
                  description={job.description}
                  onSaved={() => load()}
                  open={editingDescription}
                  onOpenChange={setEditingDescription}
                />
              ) : null}
            </div>
          </PilotCard>

          <PilotCard>
            <PilotCardHeader title="Fényképek és fájlok" />
            <div className="space-y-3 px-5 py-4">
              <p className="text-xs text-pilot-grey-500">
                {photoCount} fénykép · {fileCount} fájl. JPEG, PNG vagy PDF,
                fájlonként legfeljebb 10 MB.
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
              {/*
                THE "+ FOTÓ" TILE STAYS THE UPLOAD TRIGGER (Balázs, 2026-09-25:
                its size, border and type are the design's, exactly): a click
                uploads at once, and the caption is the gallery's own later
                step (`onSaveCaption` above).
              */}
              {canManage ? (
                <label
                  className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-pilot-grey-200 text-xs text-pilot-grey-300 transition-all hover:border-pilot-aqua-400 hover:text-pilot-aqua-500"
                  aria-disabled={uploading}
                >
                  {uploading ? "Feltöltés…" : "+ fotó"}
                  <input
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,application/pdf"
                    className="sr-only"
                    disabled={uploading}
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? []);
                      event.target.value = "";
                      if (files.length) void uploadDocuments(files);
                    }}
                  />
                </label>
              ) : null}
            </div>
          </PilotCard>

          <PilotCard>
            <PilotCardHeader
              title="Munkalapok a jegy mögött"
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
                    className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/szerviz/munkalapok/${worksheet.id}`}
                        className="font-mono text-sm font-semibold text-pilot-grey-900 hover:text-pilot-aqua-700"
                      >
                        {worksheet.number ?? "Még nincs száma"}
                      </Link>
                      <p className="break-words text-xs text-pilot-grey-500">
                        {serviceJobWorksheetLabel(worksheet)}
                      </p>
                    </div>
                    {/*
                      THE SHEET'S STATE AND HOURS (redesign E3): the same
                      display status as the worksheet list, from the
                      server's status and line count, and its total hours.
                    */}
                    <PilotBadge
                      variant={worksheetDisplayPilotVariant(
                        worksheet.status,
                        worksheet.lineCount,
                      )}
                    >
                      {worksheetDisplayLabel(
                        worksheet.status,
                        worksheet.lineCount,
                      )}
                    </PilotBadge>
                    <span className="text-xs text-pilot-grey-600">
                      {formatLaborHours(worksheet.laborHours)} munkaóra
                    </span>
                    <div className="flex items-center gap-3 text-xs text-pilot-grey-400">
                      {worksheet.handedOverAt ? (
                        <span>
                          Átadva: {formatDateTime(worksheet.handedOverAt)}
                        </span>
                      ) : null}
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

          <div id="hibajegy-eszkoz" className="scroll-mt-6">
            <PilotCard>
              <PilotCardHeader
                title="Eszköz"
                action={
                  canManage ? (
                    <button
                      type="button"
                      onClick={() => setEditingPlacement((v) => !v)}
                      className="cursor-pointer text-xs font-medium text-pilot-aqua-600 transition-colors hover:text-pilot-aqua-800"
                    >
                      {editingPlacement ? "Bezárás" : "Szerkesztés"}
                    </button>
                  ) : undefined
                }
              />
              {editingPlacement ? (
                <div className="px-5 py-4">
                  <ServiceJobPlacementEditor
                    jobId={jobId}
                    token={token}
                    customerId={job.customerId}
                    departmentId={job.departmentId}
                    departmentPath={job.departmentPath}
                    assets={job.assets}
                    worksheets={worksheets}
                    canManage={canManage}
                    onSaved={(updated) => {
                      setJob(updated);
                      setEditingPlacement(false);
                    }}
                  />
                </div>
              ) : job.assets.length === 0 ? (
                <p className="px-5 py-4 text-sm italic text-pilot-grey-400">
                  Ehhez a jegyhez nincs eszköz rendelve.
                </p>
              ) : (
                <div className="divide-y divide-pilot-grey-50">
                  {job.assets.map((asset) => (
                    <div
                      key={asset.id}
                      className="flex items-center gap-4 px-5 py-4"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pilot-grey-100">
                        <Icon
                          name="box"
                          size={18}
                          className="text-pilot-grey-500"
                        />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-pilot-grey-800">
                          {asset.assetName}
                        </p>
                        <p className="mt-0.5 font-mono text-xs text-pilot-grey-400">
                          {asset.assetNumber}
                        </p>
                        {asset.assetCategoryName ? (
                          <p className="text-xs text-pilot-grey-400">
                            {asset.assetCategoryName}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </PilotCard>
          </div>

          {/*
            "AMI TÖRTÉNT": the job's log, newest first, as the server orders
            it. It holds the four real sources (status steps with their note,
            worksheets, assets, removed attachments); the design's e-mail and
            comment rows have no source and are not drawn.
          */}
          <PilotCard>
            <PilotCardHeader title="Ami történt" />
            <div className="px-5 py-4">
              <p className="mb-2 text-xs text-pilot-grey-500">
                A jegy, a munkalapok és a csatolmányok közös naplója.
              </p>
              {job.timeline.length ? (
                <ol className="flex flex-col">
                  {job.timeline.map((entry) => (
                    <li
                      key={`${entry.kind}-${entry.sortKey}`}
                      className="grid grid-cols-[24px_96px_minmax(0,1fr)] gap-x-3 border-b border-pilot-grey-50 py-3 last:border-0 xl:grid-cols-[24px_96px_minmax(0,1fr)_minmax(0,1fr)]"
                    >
                      <TimelineIcon kind={entry.kind} />
                      <span className="pt-1 text-xs text-pilot-grey-500">
                        {formatDateTime(entry.at)}
                      </span>
                      <span className="text-sm font-medium text-pilot-grey-900">
                        {timelineLine(entry)}
                      </span>
                      <span className="col-start-3 text-xs text-pilot-grey-600 xl:col-start-4">
                        {entry.kind === "status" && entry.event.actorName
                          ? entry.event.actorName
                          : ""}
                        {entry.kind === "status" && entry.event.note ? (
                          <span className="block whitespace-pre-wrap break-words text-sm text-pilot-grey-700">
                            {entry.event.note}
                          </span>
                        ) : null}
                        {entry.kind === "document" &&
                        entry.removal.uploadedAt !== null ? (
                          <span className="block">
                            Feltöltve:{" "}
                            {formatDateTime(entry.removal.uploadedAt)}
                            {entry.removal.uploadedByName
                              ? ` · ${entry.removal.uploadedByName}`
                              : ""}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyState
                  title="Nincs bejegyzés"
                  description="Ezen a jegyen még nem történt semmi."
                />
              )}
            </div>
          </PilotCard>
        </div>

        <div className="flex flex-col gap-5">
          {/*
            THE NEXT STEP, AS ITS OWN STRONG PANEL (the brief, point 3). Only
            the steps the server allows are drawn (`allowedSteps`); the page
            decides nothing about which step comes next.
          */}
          {canManage ? (
            <section
              aria-label="Következő lépés"
              className="rounded-xl bg-pilot-aqua-50 px-5 py-5 ring-1 ring-pilot-aqua-200"
            >
              <h2 className="text-base font-semibold text-pilot-grey-900">
                Következő lépés
              </h2>
              <p className="mt-1 text-xs text-pilot-grey-600">
                Csak a megengedett átmenetek jelennek meg.
              </p>
              <p className="mt-3 text-sm text-pilot-grey-900">
                Jelenleg:{" "}
                <span className="font-semibold">
                  {serviceJobStatusLabel[job.status]}
                </span>
              </p>
              <div className="mt-4 space-y-3">
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
                        placeholder="Mi érkezett meg, mi változott?"
                        onChange={(event) => setNote(event.target.value)}
                        maxLength={2000}
                        className="w-full resize-none rounded-md bg-white px-3 py-2 text-sm text-pilot-grey-800 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
                      />
                      <p className="text-xs text-pilot-grey-500">
                        {serviceJobNoteDescription(job.allowedSteps)}
                      </p>
                    </div>
                    <div className="flex flex-col gap-2">
                      {job.allowedSteps.map((to) => (
                        <PilotButton
                          key={to}
                          variant="primary"
                          size="regular"
                          fullWidth
                          disabled={stepping}
                          onClick={() => void step(to)}
                        >
                          Tovább → {serviceJobStatusLabel[to]}
                        </PilotButton>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-pilot-grey-600">
                    Ez a hibajegy lezárult, nincs több lépése.
                  </p>
                )}
              </div>
            </section>
          ) : null}

          <PilotCard>
            <PilotCardHeader title="Az ügy adatai" />
            <div className="px-5 py-2">
              <PilotDataRow
                label="Partner"
                labelWidth="110px"
                value={job.customerName}
              />
              <PilotDataRow
                label="Helyszín"
                labelWidth="110px"
                value={
                  job.departmentPath?.length
                    ? job.departmentPath.join(" / ")
                    : job.departmentName
                }
              />
              <PilotDataRow
                label="Felelősök"
                labelWidth="110px"
                value={names ?? NO_ASSIGNEE}
              />
              <PilotDataRow
                label="Létrehozva"
                labelWidth="110px"
                value={formatDateTime(job.createdAt)}
              />
              <PilotDataRow
                label="A partner ezt látja"
                labelWidth="110px"
                value={job.partnerStatusLabel}
              />
            </div>
          </PilotCard>

          {/*
            THE ASSIGNEES' OWN CARD, unchanged inside (Balázs asked for it in
            the pilot style, 2026-09-24): it moved from the top of the left
            column to the right, under the case data, where the design keeps
            the people.
          */}
          <PilotDelegatedColleaguesCard
            jobId={jobId}
            token={token}
            assignees={job.assignees}
            canManage={canManage}
            onSaved={setJob}
          />

          {/*
            KEZELÉS: what the design folds under "Helyszín" and "…": the
            location and assets editor, hiding and restoring, and setting a
            partner on a job without one. Each keeps its own permission.
          */}
          {canManage || canHide ? (
            <PilotCard>
              <PilotCardHeader title="Kezelés" />
              <div className="space-y-4 px-5 py-4">
                <div className="flex flex-wrap gap-2">
                  {canManage ? (
                    <PilotButton
                      variant="secondary"
                      size="regular"
                      onClick={() => {
                        setEditingPlacement(true);
                        document
                          .getElementById("hibajegy-eszkoz")
                          ?.scrollIntoView?.({ behavior: "smooth" });
                      }}
                    >
                      Helyszín
                    </PilotButton>
                  ) : null}
                  {canHide ? (
                    <PilotButton
                      variant="secondary"
                      size="regular"
                      onClick={() =>
                        void serviceJobsApi
                          .setHidden(token, jobId, !job.hidden)
                          .then(() => load())
                      }
                    >
                      {job.hidden ? "Visszaállítás" : "Elrejtés"}
                    </PilotButton>
                  ) : null}
                </div>
                {canHide ? (
                  <p className="text-xs text-pilot-grey-400">
                    {job.hidden
                      ? "Ez a jegy nincs benne a listákban. A visszaállítás után újra megjelenik."
                      : "Az elrejtett jegy kikerül a listákból, de megmarad, és a munkalapjai változatlanul látszanak."}
                  </p>
                ) : null}
                {canManage && job.customerName === null ? (
                  <div className="space-y-2 border-t border-pilot-grey-100 pt-4">
                    <label
                      className="block text-sm font-semibold text-pilot-grey-900"
                      htmlFor="pilot-jegy-partner"
                    >
                      Partner beállítása
                    </label>
                    <p className="text-xs text-pilot-grey-400">
                      Ehhez a hibajegyhez még nincs partner, ezért munkalapot
                      sem lehet alá csatolni.
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
                ) : null}
              </div>
            </PilotCard>
          ) : null}

          {/*
            A KARBANTARTÁS-PANELEK, MERT EZ A ROUTE MAINTENANCE JEGYET IS
            KISZOLGÁL -- lásd a fejléc "A ROUTE MAINTENANCE JEGYET IS
            KISZOLGÁL" szakaszát.
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
