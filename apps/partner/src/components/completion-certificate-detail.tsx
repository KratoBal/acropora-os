"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Icon,
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotDataRow,
  PilotThemeRoot,
} from "@acropora/ui";
import type { CompletionCertificatePartnerDetail } from "@acropora/types";

import { partnerApi } from "@/lib/api";
import { Message } from "./ticket-list";

/**
 * A TELJESÍTÉSI IGAZOLÁS ADATLAPJA -- ugyanaz a két elv, mint a
 * megrendelőlap adatlapján (lásd `maintenance-order-detail.tsx` fejlécét):
 * ár nélküli tételek, a valódi tárolt fájltípust követő letöltés, és a
 * feltöltő kártya két feltételhez kötve.
 *
 * A FELTÖLTŐ KÁRTYA ITT MÁS FELTÉTELT KAP: nem állapot szerint (az
 * igazolásnak nincs állapota), hanem "MÉG NINCS ALÁÍRT PÉLDÁNY" ÉS
 * `canUploadSigned` esetén -- pontosan a Figma terv szabálya
 * (`!c.alairvaPeldany`).
 */
export function CompletionCertificateDetail({ id }: { id: string }) {
  const [certificate, setCertificate] =
    useState<CompletionCertificatePartnerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setCertificate(await partnerApi.completionCertificate(id));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A teljesítési igazolás nem tölthető be.",
      );
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function download(documentId: string, fileName: string) {
    const blob = await partnerApi.completionCertificateDocumentBlob(
      id,
      documentId,
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await partnerApi.uploadSignedCompletionCertificate(id, file);
      setFile(null);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A fájl nem tölthető fel.",
      );
    } finally {
      setUploading(false);
    }
  }

  if (error && !certificate)
    return (
      <PilotThemeRoot className="bg-pilot-grey-50 px-8 py-6">
        <VisszaLink />
        <Message tone="error" text={error} retry={load} />
      </PilotThemeRoot>
    );
  if (!certificate)
    return (
      <PilotThemeRoot className="bg-pilot-grey-50 px-8 py-6">
        <p className="text-sm text-pilot-grey-400">
          Teljesítési igazolás betöltése…
        </p>
      </PilotThemeRoot>
    );

  const generated = certificate.documents.find(
    (doc) => doc.type === "GENERATED_FORM",
  );
  const hasSignedDocument = certificate.documents.some(
    (doc) => doc.type === "SIGNED_FORM",
  );
  const showUpload = !hasSignedDocument && certificate.canUploadSigned;

  return (
    <PilotThemeRoot className="bg-pilot-grey-50">
      <div className="border-b border-pilot-grey-200 bg-white px-8 py-5">
        <VisszaLink />
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-pilot-grey-400">
          {certificate.number}
        </p>
        <h1 className="text-xl font-semibold text-pilot-grey-900">
          Teljesítési igazolás – {certificate.departmentName}
        </h1>
        {error ? (
          <p
            className="mt-3 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-5 px-8 py-6 max-w-2xl">
        <PilotCard>
          <PilotCardHeader title="Igazolás adatai" />
          <div className="px-5 py-2">
            <PilotDataRow
              label="Kiállítva"
              value={new Date(certificate.issuedAt).toLocaleDateString("hu-HU")}
            />
            <PilotDataRow
              label="Kiállította"
              value={certificate.issuedByName ?? undefined}
            />
            <PilotDataRow label="Helyszín" value={certificate.departmentName} />
            <PilotDataRow
              label="Aláírt példány"
              value={hasSignedDocument ? "Feltöltve" : "Még nincs feltöltve"}
            />
          </div>
        </PilotCard>

        <PilotCard>
          <PilotCardHeader title="Generált igazolás" />
          <div className="flex items-center gap-3 px-5 py-4">
            {generated ? (
              <>
                <div className="flex flex-1 items-center gap-3 rounded-lg bg-pilot-grey-50 px-4 py-3 ring-1 ring-pilot-grey-200">
                  <Icon
                    name="clipboard"
                    size={16}
                    className="text-pilot-grey-400"
                  />
                  <span className="truncate font-mono text-sm text-pilot-grey-600">
                    {generated.fileName}
                  </span>
                </div>
                <PilotButton
                  variant="secondary"
                  onClick={() => download(generated.id, generated.fileName)}
                >
                  <Icon name="download" size={13} />
                  Letöltés
                </PilotButton>
              </>
            ) : (
              <p className="text-sm italic text-pilot-grey-500">
                Nincs generált igazolás.
              </p>
            )}
          </div>
        </PilotCard>

        {showUpload ? (
          <PilotCard>
            <PilotCardHeader title="Aláírt példány feltöltése" />
            <form className="flex flex-col gap-3 px-5 py-4" onSubmit={submit}>
              <label className="flex flex-col gap-1 text-sm font-medium text-pilot-grey-700">
                Aláírt teljesítési igazolás (PDF)
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  className="cursor-pointer text-sm text-pilot-grey-600 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-pilot-aqua-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-pilot-aqua-700"
                />
              </label>
              <div>
                <PilotButton type="submit" disabled={!file || uploading}>
                  {uploading ? "Feltöltés…" : "Feltöltés"}
                </PilotButton>
              </div>
            </form>
          </PilotCard>
        ) : null}
      </div>
    </PilotThemeRoot>
  );
}

function VisszaLink() {
  return (
    <Link
      href="/teljesitesi-igazolasok"
      className="mb-3 inline-flex items-center gap-1.5 text-xs text-pilot-grey-400 hover:text-pilot-grey-700"
    >
      <Icon name="chevron-left" size={12} />
      Teljesítési igazolások
    </Link>
  );
}
