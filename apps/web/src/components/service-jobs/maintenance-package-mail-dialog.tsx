"use client";

import { useEffect, useState } from "react";

import { Alert, Button, FormField, Input, Textarea } from "@acropora/ui";
import type { MaintenancePackageMailPreview } from "@acropora/types";

import { KIHAGYAS_OKA } from "./maintenance-package-mail-skip-reason";

/**
 * A KARBANTARTÁSI CSOMAG KIKÜLDÉSE -- A HIBAJEGYES `HandoverMailDialog`
 * MINTÁJA (679d4c04 utáni "3.5" szelet). Ugyanaz a döntés minden ponton:
 * az ablak MAGA a megerősítés (nem előtte áll egy IGEN/NEM kérdés), a
 * művelet visszafordíthatatlan, és egy begépelt, még el nem küldött üzenet
 * védi az ablakot a véletlen bezárástól.
 */

export interface MaintenancePackageMailDialogProps {
  open: boolean;
  jobNumber: string;
  preview: MaintenancePackageMailPreview | null;
  previewError: string | null;
  sendError: string | null;
  busy: boolean;
  onSend(input: { subject: string; message: string }): void;
  onCancel(): void;
}

export function MaintenancePackageMailDialog({
  open,
  jobNumber,
  preview,
  previewError,
  sendError,
  busy,
  onSend,
  onCancel,
}: MaintenancePackageMailDialogProps) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    setSubject(preview?.kind === "send" ? preview.subject : "");
    setMessage("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || preview?.kind !== "send") return;
    setSubject((elozo) => (elozo === "" ? preview.subject : elozo));
  }, [open, preview]);

  const vanSzoveg = message.trim().length > 0;
  const zarhatoKivulrol = !busy && !vanSzoveg;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && zarhatoKivulrol) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, zarhatoKivulrol, onCancel]);

  if (!open) return null;

  const cimzettek = preview?.kind === "send" ? preview.recipients : [];
  const kuldheto = preview?.kind === "send" && vanSzoveg;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-dusk-900/40 p-4"
      onClick={() => {
        if (zarhatoKivulrol) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`A ${jobNumber} számú karbantartási lap dokumentumcsomagjának kiküldése`}
        className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl border border-dusk-200 bg-white p-5 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div>
          <p className="text-sm font-semibold text-dusk-900">
            A {jobNumber} számú karbantartás dokumentumcsomagjának kiküldése
          </p>
          <p className="text-sm text-dusk-500">
            A dokumentumcsomag csatolva megy.
          </p>
        </div>

        {previewError ? (
          <Alert
            variant="danger"
            title="A címzettek nem tölthetők be"
            description={previewError}
          />
        ) : null}

        {!preview && !previewError ? (
          <p className="text-sm text-dusk-500">Címzettek betöltése…</p>
        ) : null}

        {preview?.kind === "skip" ? (
          <Alert
            variant="info"
            title="A csomag most nem küldhető ki"
            description={KIHAGYAS_OKA[preview.reason]}
          />
        ) : null}

        {preview?.kind === "send" ? (
          <>
            <FormField label="Címzettek">
              <ul
                className="space-y-1"
                data-testid="maintenance-package-mail-recipients"
              >
                {cimzettek.map((cimzett) => (
                  <li key={cimzett.email} className="text-sm text-dusk-900">
                    {cimzett.name}{" "}
                    <span className="text-dusk-500">({cimzett.email})</span>
                  </li>
                ))}
              </ul>
            </FormField>

            <FormField label="Tárgy" htmlFor="maintenance-package-mail-subject">
              <Input
                id="maintenance-package-mail-subject"
                value={subject}
                maxLength={200}
                disabled={busy}
                onChange={(event) => setSubject(event.target.value)}
              />
            </FormField>

            <FormField
              label="Üzenet"
              htmlFor="maintenance-package-mail-message"
              description="Ez lesz a levél törzse, pontosan így. A rendszer semmit nem fűz hozzá."
            >
              <Textarea
                id="maintenance-package-mail-message"
                value={message}
                rows={6}
                maxLength={4000}
                disabled={busy}
                onChange={(event) => setMessage(event.target.value)}
              />
            </FormField>
          </>
        ) : null}

        {sendError ? (
          <Alert
            variant="danger"
            title="A kiküldés nem sikerült"
            description={sendError}
          />
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={!kuldheto || busy}
            onClick={() => onSend({ subject, message })}
          >
            {busy ? "Kiküldés…" : `Elküldés ${cimzettek.length} címzettnek`}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            Mégsem
          </Button>
        </div>
        {preview?.kind === "send" ? (
          <p className="text-sm text-dusk-500">
            Az elküldött levél nem vonható vissza.
          </p>
        ) : null}
      </div>
    </div>
  );
}
