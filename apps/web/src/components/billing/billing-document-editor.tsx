"use client";

import {
  Alert,
  ConfirmDialog,
  PilotButton,
  PilotCallout,
  PilotPageHeader,
  PilotSection,
  Skeleton,
} from "@acropora/ui";
import {
  billingEmailDelivery,
  billingEmailModeFor,
  billingIssueCta,
  getDocumentCapabilities,
  hasAnyPermission,
  hasPermission,
  PERMISSIONS,
  type BillingDocumentDetail,
  type BillingDocumentType,
  type InvoiceFormat,
} from "@acropora/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useMailImages } from "@/components/settings/mail-image-picker";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { billingDocumentsApi } from "@/lib/api/billing-documents";
import {
  BillingDocumentEmailDrawer,
  defaultBillingEmail,
  billingEmailHtmlFromText,
  billingEmailText,
  splitAddresses,
  type BillingEmailDraft,
} from "./billing-document-email-drawer";
import { BillingDocumentFields } from "./billing-document-fields";
import { BillingDocumentLineEditor } from "./billing-document-line-editor";
import { BillingDocumentSummary } from "./billing-document-summary";
import { BILLING_LIST_PATH } from "./billing-document-table";
import { BillingDocumentTypeSelector } from "./billing-document-type-selector";
import {
  billingPreview,
  effectiveFormat,
  formatMoney,
  fromDetail,
  hiddenFilledFields,
  missingForSave,
  newEditorState,
  toDraftInput,
  withCustomer,
  type EditorState,
} from "./billing-editor-state";
import { BillingPartnerCard } from "./billing-partner-card";
import {
  editorLinesFromPosHandoff,
  readPosInvoiceHandoff,
} from "./pos-invoice-handoff";

export const BILLING_EDITOR_PATH = "/penzugy/szamlazas";

const EDITABLE_STATUSES = ["DRAFT", "ISSUE_FAILED"];

function today(): string {
  // A helyi nap, nem az UTC-é: este tizenegykor a teljesítés ne a holnap legyen.
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/**
 * A SZÁMLÁZÁS SZERKESZTŐJE (Számlázás v0.1): EGY oldal a négy bizonylattípusra
 * (brief 6. pont), a képesség-tábla szerint alkalmazkodva.
 *
 * AMI MŰKÖDIK: a vázlat létrehozása, mentése és betöltése (a saját
 * adatbázisunkba). AMI TILTOTT, AMÍG NINCS BEKÖTVE: a kiállítás és a kiküldés
 * (a Számlázz.hu adapterrel, nautilus). A két gomb felirata már a végleges.
 */
export function BillingDocumentEditor({
  documentId,
  initialType,
  posHandoffKey,
}: {
  documentId?: string;
  initialType?: BillingDocumentType;
  /** A pénztár kosarának kulcsa (`pos-invoice-handoff`); csak új számlánál. */
  posHandoffKey?: string;
}) {
  const { session } = useAuth();
  const router = useRouter();
  const token = session?.token ?? "";
  // A BILLING-JOGOK (#1276): a betöltés `billing.view`, a vázlat
  // létrehozása és mentése `billing.create` -- ugyanaz, amit a végpont kér.
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.BILLING_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.BILLING_CREATE),
  );
  const canIssue = Boolean(
    session && hasPermission(session.user, PERMISSIONS.BILLING_ISSUE),
  );
  // AZ E-SZÁMLA KIÁLLÍTÁSA A KIKÜLDÉSSEL EGYÜTT MEGY, és a kiküldés végpontja
  // `billing.resend` jogot kér (nautilus #1288): mindkettő kell a gombhoz.
  const canSend = Boolean(
    session && hasPermission(session.user, PERMISSIONS.BILLING_RESEND),
  );

  const [state, setState] = useState<EditorState | null>(() =>
    documentId
      ? null
      : newEditorState({
          id: crypto.randomUUID(),
          today: today(),
          documentType: initialType,
        }),
  );
  const [status, setStatus] =
    useState<BillingDocumentDetail["status"]>("DRAFT");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  /*
    A LEVÉL KÉPEI: olvasni számlaküldési vagy beállítás-kezelési joggal,
    feltölteni csak az utóbbival (acrobot 25433); csak nyitott drawernél
    töltődnek.
  */
  const canReadMailImages = Boolean(
    session &&
    hasAnyPermission(session.user, [
      PERMISSIONS.BILLING_RESEND,
      PERMISSIONS.SETTINGS_MANAGE,
    ]),
  );
  const canUploadMailImages = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SETTINGS_MANAGE),
  );
  const mailImages = useMailImages(token, {
    enabled: canReadMailImages && drawerOpen,
  });
  const [confirmIssue, setConfirmIssue] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [issuedNumber, setIssuedNumber] = useState<string | null>(null);
  const [email, setEmail] = useState<BillingEmailDraft | null>(null);
  /** A kiállítás utáni kiküldés kimenete: a címzettek, vagy a hiba. */
  const [sent, setSent] = useState<
    { ok: true; to: string } | { ok: false; error: string } | null
  >(null);

  /*
    A PÉNZTÁR KOSARA (kártya cdc2771b): az új számla a kosár tételsoraival
    nyílik. Hatásban olvas, nem a kezdőállapotban, mert a munkamenet-tár a
    szerveren nem létezik, és a két render különbözne.
  */
  useEffect(() => {
    if (documentId || !posHandoffKey) return;
    const lines = readPosInvoiceHandoff(window.sessionStorage, posHandoffKey);
    if (!lines || lines.length === 0) return;
    setState((current) =>
      current && current.lines.length === 0
        ? {
            ...current,
            lines: editorLinesFromPosHandoff(lines, current.currency),
          }
        : current,
    );
  }, [documentId, posHandoffKey]);

  useEffect(() => {
    if (!documentId || !canView) return;
    const controller = new AbortController();
    billingDocumentsApi
      .detail(token, documentId, controller.signal)
      .then((detail) => {
        setState(fromDetail(detail));
        setStatus(detail.status);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setLoadError(
          cause instanceof Error
            ? cause.message
            : "A bizonylat nem tölthető be.",
        );
      });
    return () => controller.abort();
  }, [canView, documentId, token]);

  const preview = useMemo(
    () => (state ? billingPreview(state) : null),
    [state],
  );

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a számlázáshoz"
        description="billing.view jogosultság szükséges."
      />
    );
  if (loadError)
    return (
      <Alert
        variant="danger"
        title="A bizonylat nem tölthető be"
        description={loadError}
      />
    );
  if (!state)
    return (
      <PilotThemeRoot theme="light" className="space-y-6">
        <Skeleton className="h-72" />
      </PilotThemeRoot>
    );

  const capabilities = getDocumentCapabilities(state.documentType);
  const format = effectiveFormat(state);
  const editable = canManage && EDITABLE_STATUSES.includes(status);
  const delivery = billingEmailDelivery(state.documentType, format);
  const hidden = hiddenFilledFields(state);
  const missing = missingForSave(state);
  const change = (patch: Partial<EditorState>) =>
    setState((current) => (current ? { ...current, ...patch } : current));

  const emailDraft =
    email ??
    defaultBillingEmail(state.documentType, state.customer?.email ?? "");

  /** A mentés maga: a tárolt bizonylat, vagy hiba. A kiállítás is ezzel kezd. */
  const persist = async () => {
    const created = state.savedUpdatedAt === null;
    const detail = created
      ? await billingDocumentsApi.create(token, toDraftInput(state, "create"))
      : await billingDocumentsApi.update(
          token,
          state.id,
          toDraftInput(state, "update"),
        );
    return { detail, created };
  };

  const save = async () => {
    if (missing.length > 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { detail, created } = await persist();
      // A TÁROLT ÁLLAPOT A MÉRVADÓ (a szerver számolt), a termék-sor alcíme
      // viszont csak a szerkesztőben él: sorrend szerint átvesszük.
      setState((previous) => {
        const next = fromDetail(detail);
        next.lines = next.lines.map((line, index) => ({
          ...line,
          productLabel: previous?.lines[index]?.productLabel ?? null,
        }));
        return next;
      });
      setStatus(detail.status);
      setSavedAt(
        new Date(detail.updatedAt).toLocaleTimeString("hu-HU", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
      if (created)
        router.replace(`${BILLING_EDITOR_PATH}/${detail.id}/szerkesztes`);
    } catch (cause) {
      setSaveError(
        cause instanceof Error
          ? cause.message
          : "A vázlat mentése nem sikerült.",
      );
    } finally {
      setSaving(false);
    }
  };

  /**
   * A KIÁLLÍTÁS: előbb a mostani állapot mentése (a szerver azt állítja ki,
   * amit lát), aztán a kiállítás a friss időbélyeggel. Siker után a bizonylat
   * csak olvasható, a számot a Számlázz.hu adta.
   */
  const issue = async () => {
    setIssuing(true);
    setSaveError(null);
    try {
      const { detail: saved, created } = await persist();
      const issued = await billingDocumentsApi.issue(
        token,
        saved.id,
        saved.updatedAt,
      );
      setState(fromDetail(issued));
      setStatus(issued.status);
      setIssuedNumber(issued.documentNumber);
      if (created)
        router.replace(`${BILLING_EDITOR_PATH}/${issued.id}/szerkesztes`);
      if (delivery === "REQUIRED") await sendAfterIssue(issued);
    } catch (cause) {
      setSaveError(
        cause instanceof Error ? cause.message : "A kiállítás nem sikerült.",
      );
    } finally {
      setIssuing(false);
      setConfirmIssue(false);
    }
  };

  /**
   * A KIÁLLÍTÁS UTÁNI KIKÜLDÉS, a szerkesztett levéllel. A bizonylat ekkor MÁR
   * kiállított: ha a küldés elbukik, az nem a kiállítás hibája, és nem is
   * vonható vissza. A felület ezt kimondja, és a részletekre visz, ahol a
   * hiba utáni újrapróbálás ugyanazzal a levéllel megy.
   */
  const sendAfterIssue = async (issued: BillingDocumentDetail) => {
    const mode = billingEmailModeFor(
      issued.status,
      issued.delivery?.status ?? issued.emailStatus,
    );
    if (mode === null) {
      setSent({
        ok: false,
        error: "A bizonylat most nem küldhető ki.",
      });
      return;
    }
    try {
      // AMIHEZ NEM NYÚLTAK, AZ A LEVELEZÉS OLDAL SABLONJA (nautilus #1293): a
      // helyi alapszöveg csak a fiók előnézete, a kiküldés a szerver vázlatát
      // viszi. Ha az nem jön meg, a levél nem megy ki (a hiba alább).
      let letter: BillingEmailDraft;
      if (email !== null) letter = email;
      else {
        const draft = await billingDocumentsApi.templateDraft(token);
        letter = {
          ...emailDraft,
          subject: draft.subject,
          bodyHtml: draft.bodyHtml ?? billingEmailHtmlFromText(draft.body),
        };
      }
      const after = await billingDocumentsApi.email(token, issued.id, {
        requestId: crypto.randomUUID(),
        mode,
        to: splitAddresses(letter.to),
        cc: splitAddresses(letter.cc),
        bcc: splitAddresses(letter.bcc),
        subject: letter.subject,
        body: billingEmailText(letter.bodyHtml),
        bodyHtml: letter.bodyHtml,
      });
      setStatus(after.status);
      setSent({ ok: true, to: emailDraft.to });
    } catch (cause) {
      setSent({
        ok: false,
        error: cause instanceof Error ? cause.message : "A levél nem ment ki.",
      });
    }
  };

  /**
   * A FIÓK MEGNYITÁSA: a Levelezés oldal sablonja tölti ki a levelet, amíg
   * senki nem írt bele, MENTÉSTŐL FÜGGETLENÜL (nautilus #1300, a bizonylat
   * nélküli vázlat). Balázs a stage-en (acrobot 25337): az új, még nem mentett
   * számla addig a beégetett alapszöveget mutatta, a kiküldés pedig már a
   * sablont vitte, tehát az előnézet és a kimenő levél eltért.
   */
  const openDrawer = () => {
    setDrawerOpen(true);
    if (email !== null || !canSend) return;
    billingDocumentsApi
      .templateDraft(token)
      .then((draft) =>
        setEmail(
          (current) =>
            current ?? {
              ...emailDraft,
              subject: draft.subject,
              bodyHtml: draft.bodyHtml ?? billingEmailHtmlFromText(draft.body),
            },
        ),
      )
      .catch(() => undefined);
  };

  const issueDisabledReason = !canIssue
    ? "A kiállításhoz billing.issue jog kell."
    : !editable
      ? "Ez a bizonylat már nem állítható ki."
      : missing.length > 0
        ? "Kiállítás előtt töltsd ki a hiányzó adatokat."
        : delivery === "REQUIRED" && !canSend
          ? "Az e-számla kiállítása a kiküldéssel együtt megy, ahhoz billing.resend jog is kell."
          : delivery === "REQUIRED" &&
              splitAddresses(emailDraft.to).length === 0
            ? "Add meg a kiküldési e-mail címzettjét."
            : null;

  const grossLabel = preview
    ? formatMoney(preview.totals.grossAmount, state.currency)
    : "—";

  return (
    <PilotThemeRoot theme="light" className="space-y-6">
      <PilotPageHeader
        title={capabilities.newTitle}
        description={`${format === "ELECTRONIC" && state.documentType === "INVOICE" ? "E-számla" : capabilities.label} kiállítása Számlázz.hu-n keresztül.`}
      />

      <BillingDocumentTypeSelector
        documentType={state.documentType}
        format={format}
        onTypeChange={(documentType) => change({ documentType })}
        onFormatChange={(preferredFormat: InvoiceFormat) =>
          change({ preferredFormat })
        }
        source={
          state.sourceType
            ? { type: state.sourceType, id: state.sourceId }
            : null
        }
        hiddenNote={
          hidden.length > 0
            ? `A(z) ${capabilities.label.toLowerCase()} nem használja: ${hidden.join(", ")}. Az értékük megmarad, ha visszaváltasz.`
            : null
        }
      />

      {issuedNumber ? (
        <Alert
          variant="info"
          title={`Kiállítva: ${issuedNumber}`}
          description="A bizonylat számát a Számlázz.hu adta."
        />
      ) : null}
      {sent?.ok ? (
        <Alert
          variant="info"
          title="Kiküldve"
          description={`Az értesítő levél elment: ${sent.to}.`}
        />
      ) : null}
      {sent && !sent.ok ? (
        <Alert
          variant="danger"
          title="A bizonylat kiállítva, de a levél nem ment ki"
          description={`${sent.error} A kiállítás ettől érvényes; a levél a részleteknél újrapróbálható.`}
          action={
            <Link
              href={`${BILLING_LIST_PATH}/${state.id}`}
              className="text-sm font-semibold text-pilot-aqua-700 underline"
            >
              Részletek és újrapróbálás
            </Link>
          }
        />
      ) : null}
      {!editable ? (
        <Alert
          variant="info"
          title="Csak olvasható"
          description={
            canManage
              ? "Ez a bizonylat már kiállítás alatt van vagy ki van állítva."
              : "A szerkesztéshez billing.create jogosultság szükséges."
          }
        />
      ) : null}
      {saveError ? (
        <Alert
          variant="danger"
          title="A mentés nem sikerült"
          description={saveError}
        />
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <BillingPartnerCard
            token={token}
            customer={state.customer}
            onChange={(customer, terms) =>
              setState((current) =>
                current
                  ? withCustomer(current, customer, terms.paymentDueDays)
                  : current,
              )
            }
            disabled={!editable}
          />
          <BillingDocumentFields
            state={state}
            format={format}
            onChange={(key, value) =>
              change(
                key === "dueDate"
                  ? { dueDate: value, dueDateTouched: true }
                  : { [key]: value },
              )
            }
            disabled={!editable}
          />
          <BillingDocumentLineEditor
            token={token}
            lines={state.lines}
            amounts={preview?.lines ?? null}
            currency={state.currency}
            onChange={(lines) => change({ lines })}
            onLineUpdate={(key, update) =>
              setState((current) =>
                current
                  ? {
                      ...current,
                      lines: current.lines.map((line) =>
                        line.key === key ? update(line) : line,
                      ),
                    }
                  : current,
              )
            }
            disabled={!editable}
          />
        </div>

        <aside className="flex flex-col gap-6">
          <BillingDocumentSummary
            documentType={state.documentType}
            format={format}
            currency={state.currency}
            paymentMethod={state.paymentMethod || null}
            preview={preview}
            onSave={() => void save()}
            saving={saving}
            saveDisabledReason={
              !editable
                ? "szerkesztési jog vagy szerkeszthető állapot"
                : missing.length > 0
                  ? missing.join(", ")
                  : null
            }
            savedLabel={savedAt ? `Mentve ${savedAt}.` : null}
            issue={{
              onClick: () => setConfirmIssue(true),
              disabledReason: issueDisabledReason,
              busy: issuing,
            }}
          />
          {delivery !== "NONE" ? (
            <PilotSection
              title="Kiküldési e-mail"
              subtitle={
                delivery === "REQUIRED"
                  ? "A kiállítás része; kiállítás előtt szerkeszthető."
                  : "Nem kötelező; kiállítás után is elküldhető."
              }
            >
              <p className="text-xs text-pilot-grey-500">Címzett</p>
              <p className="text-sm font-semibold text-pilot-grey-900">
                {emailDraft.to || "Nincs e-mail cím a partnernél"}
              </p>
              <div className="mt-3">
                <PilotButton
                  variant="secondary"
                  size="regular"
                  onClick={openDrawer}
                >
                  E-mail szerkesztése
                </PilotButton>
              </div>
            </PilotSection>
          ) : null}
          <PilotCallout
            tone="aqua"
            title="Mi történik véglegesítéskor?"
            description={
              <>
                1. Az Acropora OS elküldi az adatokat a Számlázz.hu-nak.
                <br />
                2. Siker esetén megkapjuk a bizonylat számát
                {format === "ELECTRONIC" ? " és az e-számlát" : ""}.
                {delivery === "REQUIRED" ? (
                  <>
                    <br />
                    3. Ezután megy ki a szerkesztett értesítő levél.
                  </>
                ) : null}
              </>
            }
          />
        </aside>
      </div>

      {delivery !== "NONE" ? (
        <BillingDocumentEmailDrawer
          images={canReadMailImages ? mailImages : undefined}
          imageUpload={canUploadMailImages}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          documentType={state.documentType}
          format={format}
          draft={emailDraft}
          onChange={setEmail}
          customerName={state.customer?.name ?? "Nincs kiválasztott partner"}
          grossLabel={grossLabel}
          meta={[
            capabilities.showsPaymentFields ? state.paymentMethod : null,
            capabilities.showsPaymentFields && state.dueDate
              ? `fizetési határidő: ${state.dueDate.replaceAll("-", ". ")}.`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          known={{
            customer_name: state.customer?.name ?? "{{customer_name}}",
            gross_total: grossLabel,
            due_date: state.dueDate
              ? `${state.dueDate.replaceAll("-", ". ")}.`
              : "{{due_date}}",
            order_number: state.reference || "{{order_number}}",
          }}
        />
      ) : null}
      <ConfirmDialog
        open={confirmIssue}
        title={`${capabilities.label} kiállítása`}
        consequence={`A kiállítással valódi ${capabilities.label.toLowerCase()} készül a Számlázz.hu-n, saját számmal. A bizonylat ezután nem szerkeszthető.`}
        recovery="Egy kiállított bizonylat nem vonható vissza; javítani csak sztornóval vagy helyesbítő bizonylattal lehet."
        confirmLabel={billingIssueCta(state.documentType, format)}
        busy={issuing}
        onConfirm={() => void issue()}
        onCancel={() => setConfirmIssue(false)}
      />
    </PilotThemeRoot>
  );
}
