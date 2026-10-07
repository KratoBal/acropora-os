"use client";

import {
  Alert,
  Icon,
  PilotBadge,
  PilotButton,
  PilotDataGrid,
  PilotDataItem,
  PilotPageHeader,
  PilotSection,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  MORTALITY_SOURCE_LABELS,
  PERMISSIONS,
  type MortalityDetail,
} from "@acropora/types";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { ServiceDocumentGallery } from "@/components/service/service-document-gallery";
import { mortalityApi } from "@/lib/api/mortality";
import {
  aquariumLabel,
  livestockSubtitle,
  livestockTitle,
  longDateTime,
  sourceSubtitle,
  sourceTitle,
  stockEffectText,
} from "./mortality-format";
import { MORTALITY_LIST_PATH } from "./mortality-list-page";

/**
 * EGY ELHULLÁSI BEJEGYZÉS (kártya 115c9740; Figma: OS / Elhullási napló /
 * Részlet). Törlés nincs (acrobot 27141), sem a bejegyzésre, sem a fényképre;
 * a módosítás az űrlapon megy, és a „Naplóinformáció” mutatja, ki módosított
 * utoljára.
 */
export function MortalityDetailPage({ recordId }: { recordId: string }) {
  const { session } = useAuth();
  const params = useSearchParams();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.MORTALITY_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.MORTALITY_MANAGE),
  );
  const [record, setRecord] = useState<MortalityDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(
    params.get("fenykep") === "hiba"
      ? "A bejegyzés elmentődött, de a fényképek feltöltése nem sikerült. Töltsd fel őket újra."
      : null,
  );
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      try {
        setRecord(await mortalityApi.detail(token, recordId, signal));
        setError(null);
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A bejegyzés nem tölthető be.",
          );
      }
    },
    [canView, recordId, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setUploading(true);
    setUploadError(null);
    try {
      await mortalityApi.uploadPhotos(token, recordId, Array.from(list));
      await load();
    } catch (cause) {
      setUploadError(
        cause instanceof Error ? cause.message : "A feltöltés nem sikerült.",
      );
    } finally {
      setUploading(false);
    }
  };

  const download = async (photoId: string, fileName: string) => {
    const blob = await mortalityApi.downloadPhoto(token, recordId, photoId);
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed az elhullási naplóhoz"
        description="mortality.view jogosultság szükséges."
      />
    );
  if (error)
    return (
      <Alert variant="danger" title="Betöltési hiba" description={error} />
    );
  if (!record)
    return (
      <div aria-label="Bejegyzés betöltése" className="space-y-3">
        <Skeleton className="h-16" />
        <Skeleton className="h-96" />
      </div>
    );

  return (
    <PilotThemeRoot theme="light" className="space-y-6">
      <nav aria-label="Morzsamenü" className="text-sm text-pilot-grey-500">
        <Link href={MORTALITY_LIST_PATH} className="hover:underline">
          Elhullási napló
        </Link>
        {"  /  "}
        <span className="text-pilot-grey-700">#{record.recordNumber}</span>
      </nav>
      <PilotPageHeader
        eyebrow="Belső nyilvántartás"
        title={livestockTitle(record)}
        description={livestockSubtitle(record) ?? undefined}
        meta={
          <>
            <PilotBadge variant="danger">{record.quantity} példány</PilotBadge>
            <PilotBadge variant="grey">
              {aquariumLabel(record.aquarium)}
            </PilotBadge>
          </>
        }
        actions={
          canManage ? (
            <Link
              href={`${MORTALITY_LIST_PATH}/${encodeURIComponent(record.id)}/szerkesztes`}
            >
              <PilotButton variant="secondary" size="regular">
                <Icon name="pencil" size={14} />
                Módosítás
              </PilotButton>
            </Link>
          ) : undefined
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-6">
          <PilotSection title="Esemény adatai">
            <PilotDataGrid columns={2}>
              <PilotDataItem label="Példányszám">
                {record.quantity} db
              </PilotDataItem>
              <PilotDataItem label="Akvárium">
                {aquariumLabel(record.aquarium)}
              </PilotDataItem>
              <PilotDataItem
                label="Beszállító / forrás"
                hint={
                  record.source.type === "SUPPLIER"
                    ? (sourceSubtitle(record.source) ??
                      MORTALITY_SOURCE_LABELS.SUPPLIER)
                    : (sourceSubtitle(record.source) ?? undefined)
                }
              >
                {sourceTitle(record.source)}
              </PilotDataItem>
              <PilotDataItem label="Rögzítette">
                {record.recordedBy.name}
              </PilotDataItem>
              <PilotDataItem label="Rögzítés ideje">
                {longDateTime(record.recordedAt)}
              </PilotDataItem>
              <PilotDataItem label="Azonosító" mono>
                #{record.recordNumber}
              </PilotDataItem>
              <PilotDataItem label="Készlet">
                {stockEffectText(record.stock)}
              </PilotDataItem>
            </PilotDataGrid>
          </PilotSection>

          <PilotSection title="Megjegyzés">
            <p className="whitespace-pre-wrap text-sm text-pilot-grey-700">
              {record.note ?? (
                <span className="text-pilot-grey-400">Nincs megjegyzés.</span>
              )}
            </p>
          </PilotSection>

          <PilotSection
            title="Fotók"
            action={
              canManage ? (
                <>
                  <PilotButton
                    variant="secondary"
                    disabled={uploading}
                    onClick={() => fileInput.current?.click()}
                  >
                    {uploading ? "Feltöltés…" : "Fotók hozzáadása"}
                  </PilotButton>
                  <input
                    ref={fileInput}
                    type="file"
                    multiple
                    accept="image/jpeg,image/png"
                    className="hidden"
                    onChange={(event) => {
                      void upload(event.target.files);
                      event.target.value = "";
                    }}
                  />
                </>
              ) : undefined
            }
          >
            {uploadError ? (
              <p
                role="alert"
                className="mb-3 text-sm font-medium text-rose-600"
              >
                {uploadError}
              </p>
            ) : null}
            <ServiceDocumentGallery
              items={record.photos}
              loadBlob={(photoId) =>
                mortalityApi.downloadPhotoThumbnail(token, record.id, photoId)
              }
              onDownload={(photo) =>
                void download(photo.id, photo.fileName).catch(() =>
                  setUploadError("A fénykép nem tölthető le."),
                )
              }
              emptyText="Ehhez a bejegyzéshez nincs fénykép."
            />
          </PilotSection>
        </div>

        <PilotSection title="Naplóinformáció" className="h-fit">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-pilot-grey-500">Létrehozva</dt>
              <dd className="text-pilot-grey-800">
                {record.recordedBy.name} · {longDateTime(record.createdAt)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-pilot-grey-500">Utolsó módosítás</dt>
              <dd className="text-pilot-grey-800">
                {record.lastModified
                  ? `${record.lastModified.by?.name ?? "Törölt felhasználó"} · ${longDateTime(record.lastModified.at)}`
                  : "Nem módosították"}
              </dd>
            </div>
          </dl>
        </PilotSection>
      </div>
    </PilotThemeRoot>
  );
}
