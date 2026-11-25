"use client";

import {
  Alert,
  Icon,
  PageHeader,
  PAGE_GUTTER_X,
  PilotField,
  PilotFieldPair,
  PilotFormActions,
  PilotFormCard,
  PilotFormLayout,
  PILOT_FIELD_HINT_CLASS,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type WorksheetSelectablePartner,
  type WorksheetDepartmentSummary,
} from "@acropora/types";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useReturnTo } from "@/components/navigation-history";
import { ServiceOfflineNotice } from "@/components/service/service-offline-notice";
import { serviceJobsApi } from "@/lib/api/service-jobs";
import { worksheetsApi } from "@/lib/api/worksheets";
import { JobAssetPicker } from "@/components/service-jobs/job-asset-picker";
import { buildSiteOptions } from "@/lib/partners/site-tree";
import {
  toggleAssignee,
  useAssignableUsers,
  WorksheetAssigneePicker,
} from "../worksheet-assignee-picker";
import {
  maintenanceAssigneePrefill,
  type PrefillJobAssignee,
} from "./worksheet-assignee-prefill";
import {
  emptyLine,
  toLineInput,
  WorksheetLineEditor,
  type WorksheetLineDraft,
} from "../worksheet-line-editor";
import {
  PilotButton,
  PilotInput,
  PilotSelect,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";

/**
 * A FIGMA MAKE TERV ÁTÜLTETÉSE -- ÚJ MUNKALAP ŰRLAP (8. kör, 3/3 rész).
 *
 * Brief: `exchange/figma-leiras-8-kor-munkalapok-2026-09-25.md`, forrás:
 * `exchange/figma-munkalapok-make-8/src/MunkalapokScreen.tsx` (`UjMunkalap`,
 * 880-1065. sor). Ez a HARMADIK a kör három oldalából (lista #1102, adatlap
 * #1105+#1106, új munkalap -- ez a PR).
 *
 * === A VALÓDI ŰRLAP LOGIKÁJA VÁLTOZATLAN, CSAK A STÍLUS FIGMA ===
 *
 * A validáció, a mentés (`worksheetsApi.create`), a partner/alegység
 * függősége, az új alegység felvitele, a hibajegyből előtöltés
 * (partner/helyszín/eszközök, archivált helyszín kezelése), a felelős- és
 * eszköz-választó SZÓ SZERINT a régi `worksheet-editor-page.tsx` CREATE
 * ágából jött (`worksheetId` nélküli eset).
 *
 * FRISSÍTVE 2026-09-25: a régi `WorksheetEditorPage` (és a teljes teszt-sora,
 * `worksheet-editor-page.component.test.tsx`) TÖRÖLVE -- a `/szerkesztes`
 * útvonal azóta a `pilot-worksheet-editor-page.tsx`-re mutat, tehát a régi
 * fájl felvitel-ága volt az EGYETLEN élő logikája, és az itt fut tovább. A
 * régi teszt CREATE-ágának minden állítása átköltözött ide
 * (`pilot-worksheet-create-page.component.test.tsx`), a leképezés a PR
 * törzsében áll.
 *
 * === A TÉTEL-SZERKESZTŐ ÉS A FELELŐS-VÁLASZTÓ VÁLTOZATLAN ("VARRAT") ===
 *
 * A `WorksheetLineEditor` (Tételek: mennyiség, egység, fajta, ár -- az ár
 * rejtve, Balázs "B" döntése) és a `WorksheetAssigneePicker` (jelölőnégyzet-
 * lista) a régi `dusk-*`/`brand-*` arculatukkal ágyazódnak be, ugyanúgy,
 * ahogy az Eszközök és a Munkalapok adatlap körben az öt beágyazott widget
 * -- ezek önmagukban működő, tesztelt alrendszerek, nem Figma-terv részei.
 *
 * === HÁROM KÁRTYA A FIGMA SZERINT, A VALÓDI MEZŐK BENNE ===
 *
 * A Figma `UjMunkalap` három kártyát rajzol (Hozzárendelés, Munkalap adatai,
 * Munka és anyagok), és egy negyediket a mai kód ad hozzá (Érintett
 * eszközök) -- ez a Figma "Munka és anyagok" kártyájának NINCS RÉSZE, de a
 * mai felvitel kéri (`JobAssetPicker`), és a hibajegyből nyitott lap ezekkel
 * ELŐ VAN TÖLTVE. A negyedik kártya a Munka és anyagok UTÁN áll, mert a
 * Figma sem helyezi el sehol -- a legközelebbi rokon tartalom mellé került.
 *
 * === KÉT MEZŐ, AHOL A KÓD NYER A TERV FELETT ===
 *
 * A Figma "Felelősök" egy egyszerű chip-választó FIX NÉVLISTÁVAL
 * (`FELELŐS_OPTIONS`). A valódi lista a szervertől jön
 * (`worksheetsApi.assignableUsers`), és a valódi `WorksheetAssigneePicker`
 * jelölőnégyzeteket használ chip helyett -- a chip-alak itt nem kerül át,
 * mert a lista NEM statikus.
 *
 * A Figma "Alegység" egyetlen legördülő, statikus `ALEGYSÉGEK` térképpel.
 * A valóságban az alegység-választás archiválást, új alegység felvitelét és
 * a jegyből örökölt, esetleg archivált helyszín különleges esetét is hordja
 * -- mindez a (2026-09-25-ig élt, azóta törölt) `worksheet-editor-page.tsx`-ből
 * jött át szó szerint, és ezen a lapon fut tovább.
 *
 * === A KÉT (C) HIÁNY, MOST PÓTOLVA ===
 *
 * acrobot jelezte: a Figma terv ad két olyan elemet, ami a mai valódi
 * felvitelről HIÁNYZOTT.
 *
 * 1) HIBAJEGY-SOR, ha a lap egy hibajegyből nyílik (`?hibajegy=<id>` a
 *    címben): "Hibajegy: HJ-2026-014", a jegy saját számával. A régi
 *    `worksheet-editor-page.tsx` ELTÖLTÖTTE a partnert/helyszínt/eszközöket
 *    a jegyből, de sehol nem írta ki, MELYIK jegyből -- csak a HIBA ágon
 *    (`ticketError`) látszott, hogy egyáltalán van jegy a háttérben.
 * 2) "KÖTELEZŐ: X, Y" MONDAT a Mentés gomb alatt, inaktív állapotban -- a
 *    mai űrlapon a gomb csak szürkén áll, ok nélkül. A minta a
 *    `pilot-asset-create-page.tsx`-ből jön (`missing` tömb).
 */

interface HeaderDraft {
  subject: string;
  description: string;
  issueDate: string;
  fulfillmentDate: string;
  dueDate: string;
}

/** A munkalap tárgyának hossz-korlátja (a szerver `MaxLength(500)`-ja): az előtöltött cím nem lehet hosszabb. */
const SUBJECT_MAX_LENGTH = 500;

function emptyHeader(): HeaderDraft {
  return {
    subject: "",
    description: "",
    issueDate: "",
    fulfillmentDate: "",
    dueDate: "",
  };
}

function dateOrNull(value: string): string | null {
  return value.trim() ? value : null;
}

export function PilotWorksheetCreatePage() {
  const { session } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const backToList = useReturnTo("/szerviz/munkalapok");
  const ticketId = searchParams.get("hibajegy");
  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_MANAGE),
  );

  const [partners, setPartners] = useState<WorksheetSelectablePartner[]>([]);
  const [partnersLoaded, setPartnersLoaded] = useState(false);
  const [departmentsLoaded, setDepartmentsLoaded] = useState(false);
  const [departments, setDepartments] = useState<WorksheetDepartmentSummary[]>(
    [],
  );
  const [customerId, setCustomerId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [header, setHeader] = useState<HeaderDraft>(emptyHeader);
  const [lines, setLines] = useState<WorksheetLineDraft[]>([emptyLine()]);
  const [newDepartmentOpen, setNewDepartmentOpen] = useState(false);
  const [newDepartment, setNewDepartment] = useState({
    parentId: "",
    code: "",
    name: "",
  });
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  // A karbantartási lap felelősei (kártya d91005e9): a lap betöltése után, és csak karbantartási lapnál, előtöltik a
  // felelősöket. A felvivő bármikor átírhatja: ha már nyúlt a listához, az előtöltés nem írja felül.
  const [jobAssignees, setJobAssignees] = useState<PrefillJobAssignee[] | null>(
    null,
  );
  const [prefillDropped, setPrefillDropped] = useState<PrefillJobAssignee[]>(
    [],
  );
  const assigneesTouched = useRef(false);
  const assigneesPrefilled = useRef(false);
  const [assetIds, setAssetIds] = useState<string[]>([]);
  // a mező-hibák az első mentési kísérlet UTÁN látszanak (előtte az összesítő és a halvány gomb jelez)
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticketCustomerId, setTicketCustomerId] = useState<string | null>(null);
  const [ticketDepartmentId, setTicketDepartmentId] = useState<string | null>(
    null,
  );
  const [ticketDepartmentName, setTicketDepartmentName] = useState<
    string | null
  >(null);
  const [ticketJobNumber, setTicketJobNumber] = useState<string | null>(null);
  // A karbantartásnak semmi köze a hibajegyekhez (Balázs, 2026-11-18): a karbantartási lapról nyitott űrlap a karbantartás szavait és útvonalát használja.
  const [ticketKind, setTicketKind] = useState<"REPAIR" | "MAINTENANCE">(
    "REPAIR",
  );
  const maintenance = ticketKind === "MAINTENANCE";
  const parentHref = `${maintenance ? "/szerviz/karbantartas" : "/szerviz/hibajegyek"}/${ticketId}`;
  const [ticketError, setTicketError] = useState<string | null>(null);

  const { candidates, error: candidatesError } = useAssignableUsers(
    token,
    canManage,
  );

  useEffect(() => {
    if (
      jobAssignees === null ||
      assigneesPrefilled.current ||
      assigneesTouched.current
    )
      return;
    // a kiosztható kollégák listája kell hozzá: addig nem tudjuk, kik oszthatók ki
    if (candidates.length === 0 && !candidatesError) return;
    assigneesPrefilled.current = true;
    const { selected, dropped } = maintenanceAssigneePrefill({
      kind: "MAINTENANCE",
      jobAssignees,
      candidates,
    });
    setAssigneeIds(selected);
    setPrefillDropped(dropped);
  }, [candidates, candidatesError, jobAssignees]);

  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    worksheetsApi
      .selectablePartners(token, controller.signal)
      .then((response) => {
        setPartners(response.items);
        setPartnersLoaded(true);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError("A partnerlista nem tölthető be.");
      });
    return () => controller.abort();
  }, [canManage, token]);

  const loadDepartments = useCallback(
    async (owner: string, signal?: AbortSignal) => {
      if (!owner) {
        setDepartments([]);
        setDepartmentsLoaded(false);
        return;
      }
      try {
        const response = await worksheetsApi.departments(token, owner, signal);
        setDepartments(response.items.filter((item) => item.isActive));
        setDepartmentsLoaded(true);
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError("Az alegységek nem tölthetők be.");
      }
    },
    [token],
  );

  const departmentOptions = useMemo(
    () => buildSiteOptions(departments),
    [departments],
  );

  const ticketUnitArchived =
    ticketDepartmentId !== null &&
    departmentsLoaded &&
    departmentOptions.length > 0 &&
    !departmentOptions.some((option) => option.id === ticketDepartmentId);

  useEffect(() => {
    if (ticketUnitArchived) setDepartmentId("");
  }, [ticketUnitArchived]);

  useEffect(() => {
    const controller = new AbortController();
    void loadDepartments(customerId, controller.signal);
    return () => controller.abort();
  }, [customerId, loadDepartments]);

  useEffect(() => {
    if (!ticketId || !canManage) return;
    const controller = new AbortController();
    serviceJobsApi
      .detail(token, ticketId, controller.signal)
      .then((job) => {
        setTicketError(null);
        setTicketJobNumber(job.jobNumber);
        setTicketKind(job.kind === "MAINTENANCE" ? "MAINTENANCE" : "REPAIR");
        // A MUNKALAP TÁRGYA A LAP CÍME (Luca, 2026-11-20): a hibajegyből és a karbantartási lapról nyitott munkalap tárgya
        // előre a lap címe, szerkeszthetően. CSAK ÜRES mezőt tölt: amit a felvivő már beírt, azt nem írja felül (a betöltés
        // alatt is gépelhet), és a mező jogos kiürítése után sem tér vissza (az előtöltés a betöltéskor fut, egyszer).
        const title = typeof job.title === "string" ? job.title.trim() : "";
        if (title)
          setHeader((current) =>
            current.subject.trim()
              ? current
              : { ...current, subject: title.slice(0, SUBJECT_MAX_LENGTH) },
          );
        if (job.kind === "MAINTENANCE")
          setJobAssignees(
            (job.assignees ?? []).map((assignee) => ({
              userId: assignee.userId,
              name: assignee.name,
            })),
          );
        if (job.customerId === null) {
          setTicketError(
            job.kind === "MAINTENANCE"
              ? "Ehhez a karbantartási laphoz még nincs partner. Először állítsd be a lap partnerét, és utána nyiss alá munkalapot."
              : "Ehhez a hibajegyhez még nincs partner. Először állítsd be a hibajegy partnerét, és utána nyiss alá munkalapot.",
          );
          return;
        }
        setTicketCustomerId(job.customerId);
        setCustomerId(job.customerId);
        setTicketDepartmentId(job.departmentId ?? null);
        setTicketDepartmentName(job.departmentName ?? null);
        if (job.departmentId) setDepartmentId(job.departmentId);
        setAssetIds(job.assets.map((link) => link.assetId));
      })
      .catch((cause: unknown) => {
        setTicketError(
          cause instanceof Error
            ? cause.message
            : "A lap nem tölthető be, ezért a partnere sem állítható be automatikusan.",
        );
      });
    return () => controller.abort();
  }, [canManage, ticketId, token]);

  const addDepartment = async () => {
    if (!customerId) return;
    setError(null);
    try {
      const created = await worksheetsApi.createDepartment(token, customerId, {
        ...(newDepartment.parentId ? { parentId: newDepartment.parentId } : {}),
        code: newDepartment.code.trim().toUpperCase(),
        name: newDepartment.name.trim(),
      });
      setDepartments((current) => [...current, created]);
      setDepartmentId(created.id);
      setNewDepartment((current) => ({
        parentId: current.parentId,
        code: "",
        name: "",
      }));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Az alegység felvitele nem sikerült.",
      );
    }
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await worksheetsApi.create(token, {
        subject: header.subject.trim(),
        description: header.description.trim()
          ? header.description.trim()
          : null,
        issueDate: dateOrNull(header.issueDate),
        fulfillmentDate: dateOrNull(header.fulfillmentDate),
        dueDate: dateOrNull(header.dueDate),
        lines: lines.map(toLineInput),
        customerId,
        departmentId,
        assigneeIds,
        assetIds,
        ...(ticketId ? { serviceJobId: ticketId } : {}),
      });
      router.push(`/szerviz/munkalapok/${saved.id}`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A mentés nem sikerült.",
      );
      setSaving(false);
    }
  };

  if (!canManage)
    return (
      <PilotThemeRoot bleed className="min-h-screen bg-pilot-grey-50 p-8">
        <Alert
          variant="danger"
          title="Nincs jogosultságod munkalapot írni"
          description="service.manage jogosultság szükséges."
        />
      </PilotThemeRoot>
    );

  const partnerOptions = partners.map((partner) => ({
    id: partner.customerId,
    displayName: `${partner.partnerCode} - ${partner.name}`,
  }));
  const noSelectablePartners = partnersLoaded && partnerOptions.length === 0;
  const noSelectableUnits =
    Boolean(customerId) && departmentsLoaded && departmentOptions.length === 0;
  const ticketPartnerIsMirror =
    ticketCustomerId === null ||
    partners.some((partner) => partner.customerId === ticketCustomerId);

  // a hiányzó kötelező mezők (a szabály a régi: partner, helyszín, tárgy), a megjelenő név és a doboz azonosítója (ide görget a mentés gomb)
  const missingFields: { label: string; fieldId: string }[] = [];
  if (!customerId)
    missingFields.push({ label: "Partner", fieldId: "munkalap-partner-mezo" });
  if (!departmentId)
    missingFields.push({
      label: "Helyszín",
      fieldId: "munkalap-helyszin-mezo",
    });
  if (!header.subject.trim())
    missingFields.push({ label: "Tárgy", fieldId: "munkalap-targy-mezo" });
  const missing = missingFields.map((field) => field.label);
  const canSubmit = missing.length === 0;
  const errorOf = (label: string, sentence: string) =>
    showErrors && missing.includes(label) ? sentence : null;
  // a halvány mentés gomb kattintható: hiányzó mezőnél megmutatja a hibákat és az első hibás mezőhöz görget (nem ment)
  const onSubmitClick = () => {
    if (canSubmit) {
      void submit();
      return;
    }
    setShowErrors(true);
    const first = missingFields[0];
    if (first) {
      const box = document.getElementById(first.fieldId);
      box?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      box
        ?.querySelector<HTMLElement>("input, select, textarea, button")
        ?.focus({ preventScroll: true });
    }
  };

  return (
    <PilotThemeRoot bleed className="min-h-screen bg-pilot-grey-50">
      <div className={`${PAGE_GUTTER_X} pt-6`}>
        <Link
          href={backToList.href}
          className="mb-3 flex items-center gap-1.5 text-xs text-pilot-grey-400 transition-colors hover:text-pilot-grey-700"
        >
          <Icon name="chevron-left" size={12} />
          {backToList.fromWithinApp ? "Vissza" : "Munkalapok"}
        </Link>
        <PageHeader title="Új munkalap" />
      </div>

      <div className={`${PAGE_GUTTER_X} py-6`}>
        <PilotFormLayout
          top={
            <>
              <ServiceOfflineNotice state={{ kind: "form" }} pilot />
              {error ? (
                <Alert variant="danger" title="Hiba" description={error} />
              ) : null}
              {ticketError ? (
                <Alert
                  variant="danger"
                  title={
                    maintenance
                      ? "A karbantartási lapról"
                      : "A hibajegy oldaláról"
                  }
                  description={ticketError}
                />
              ) : null}
            </>
          }
          afterText="Mentés után megnyílik az új munkalap adatlapja, ahol a tételeket és a felelőst is szerkesztheted, és ahol a munkalapot kiállíthatod és lezárhatod. A felelősnek kiosztott kollégák értesítést kapnak."
          actions={
            <PilotFormActions
              missing={missing}
              busy={saving}
              submitLabel="Mentés"
              busyLabel="Mentés…"
              onCancel={() => router.push(backToList.href)}
              onSubmit={onSubmitClick}
            />
          }
        >
          <PilotFormCard title="Kinek és hol?">
            {/*
              A HIBAJEGY SORA. Csak akkor jelenik meg, ha a lap egy jegyből nyílt ÉS a jegy száma megjött -- a Figma feltétel nélkül
              rajzolja (`linkedHibajegy &&`), itt a valódi betöltés dönti el.
            */}
            {ticketId && ticketJobNumber ? (
              <div className="rounded-lg bg-pilot-grey-50 px-4 py-3 text-sm text-pilot-grey-600 ring-1 ring-pilot-grey-200">
                {maintenance ? "Karbantartási lap:" : "Hibajegy:"}{" "}
                <Link
                  href={parentHref}
                  className="font-mono font-medium text-pilot-grey-800 hover:text-pilot-aqua-700"
                >
                  {ticketJobNumber}
                </Link>
              </div>
            ) : null}
            <PilotFieldPair>
              <PilotField
                id="munkalap-partner-mezo"
                label="Partner"
                requirement="required"
                error={errorOf("Partner", "Válassz partnert.")}
                help={
                  noSelectablePartners
                    ? "Csak az a partner választható, akinél be van pipálva a Szerviz, és van munkalap-rövidítése. A rövidítést a partner adatlapján lehet felvinni."
                    : undefined
                }
              >
                <PilotSelect
                  aria-label="Partner"
                  value={customerId}
                  disabled={ticketCustomerId !== null}
                  onChange={(value) => {
                    setCustomerId(value);
                    setDepartmentId("");
                  }}
                >
                  <option value="">
                    {noSelectablePartners
                      ? "Nincs választható szerviz partner"
                      : "Válassz partnert…"}
                  </option>
                  {partnerOptions.map((partner) => (
                    <option key={partner.id} value={partner.id}>
                      {partner.displayName}
                    </option>
                  ))}
                </PilotSelect>
              </PilotField>
              <PilotField
                id="munkalap-helyszin-mezo"
                label="Helyszín"
                requirement="required"
                error={errorOf("Helyszín", "Válassz helyszínt.")}
                help={
                  ticketUnitArchived
                    ? `A ${maintenance ? "karbantartási lap" : "hibajegy"} helyszíne (${ticketDepartmentName ?? "ismeretlen"}) archivált, ezért nem tölthető elő. Válassz aktív helyszínt.`
                    : noSelectableUnits
                      ? ticketPartnerIsMirror
                        ? "Ehhez a partnerhez még nincs helyszín. Vegyél fel egyet lent."
                        : maintenance
                          ? "Ehhez a karbantartási laphoz nem tartozhat helyszín: a partnere nem szerviz partnerként van felvéve. A lap partnerét kell rendbe tenni."
                          : "Ehhez a hibajegyhez nem tartozhat helyszín: a partnere nem szerviz partnerként van felvéve. A jegy partnerét kell rendbe tenni."
                      : "A munkalapszám első tagja is ebből lesz."
                }
              >
                <PilotSelect
                  aria-label="Helyszín"
                  value={departmentId}
                  disabled={!customerId}
                  onChange={setDepartmentId}
                >
                  <option value="">Válassz helyszínt…</option>
                  {departmentOptions.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.label}
                    </option>
                  ))}
                </PilotSelect>
                <button
                  type="button"
                  onClick={() => setNewDepartmentOpen((open) => !open)}
                  disabled={!customerId}
                  className="mt-1.5 cursor-pointer self-start text-xs text-pilot-aqua-600 transition hover:text-pilot-aqua-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {newDepartmentOpen ? "− Mégsem" : "+ Új helyszín hozzáadása"}
                </button>
              </PilotField>
            </PilotFieldPair>
            {newDepartmentOpen && customerId ? (
              <div className="flex flex-col gap-5 rounded-lg bg-pilot-grey-50 p-4 ring-1 ring-pilot-grey-200">
                <PilotFieldPair>
                  <PilotField label="Szülő helyszín" requirement="optional">
                    <PilotSelect
                      aria-label="Szülő helyszín"
                      value={newDepartment.parentId}
                      onChange={(value) =>
                        setNewDepartment((current) => ({
                          ...current,
                          parentId: value,
                        }))
                      }
                    >
                      <option value="">Legfelső szint</option>
                      {departmentOptions.map((department) => (
                        <option key={department.id} value={department.id}>
                          {department.label}
                        </option>
                      ))}
                    </PilotSelect>
                  </PilotField>
                  <PilotField label="Új helyszín kódja" requirement="required">
                    <PilotInput
                      aria-label="Új helyszín kódja"
                      value={newDepartment.code}
                      placeholder="pl. CAP-UJ"
                      onChange={(value) =>
                        setNewDepartment((current) => ({
                          ...current,
                          code: value,
                        }))
                      }
                    />
                  </PilotField>
                </PilotFieldPair>
                <PilotField label="Új helyszín neve" requirement="required">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <PilotInput
                      aria-label="Új helyszín neve"
                      value={newDepartment.name}
                      placeholder="pl. Hátsó medence"
                      onChange={(value) =>
                        setNewDepartment((current) => ({
                          ...current,
                          name: value,
                        }))
                      }
                    />
                    <PilotButton
                      variant="secondary"
                      disabled={
                        !newDepartment.code.trim() || !newDepartment.name.trim()
                      }
                      onClick={() => void addDepartment()}
                    >
                      Helyszín felvitele
                    </PilotButton>
                  </div>
                </PilotField>
              </div>
            ) : null}
          </PilotFormCard>

          <PilotFormCard title="Mi a munka?">
            <PilotField
              id="munkalap-targy-mezo"
              label="Tárgy"
              requirement="required"
              error={errorOf("Tárgy", "Add meg a munkalap tárgyát.")}
            >
              <PilotInput
                aria-label="Tárgy"
                value={header.subject}
                placeholder="pl. Szűrőrendszer csere"
                onChange={(value) =>
                  setHeader((current) => ({ ...current, subject: value }))
                }
              />
            </PilotField>
            <PilotField label="Megjegyzés" requirement="optional">
              <textarea
                aria-label="Megjegyzés"
                rows={3}
                value={header.description}
                onChange={(event) =>
                  setHeader((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                className="w-full resize-none rounded-md px-3 py-1.5 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-300 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
              />
            </PilotField>
            <WorksheetLineEditor
              pilot
              bare
              lines={lines}
              onChange={setLines}
              disabled={saving}
            />
            <PilotField
              label="Érintett eszközök"
              requirement="optional"
              help={
                departmentId
                  ? maintenance
                    ? "A karbantartási lapból nyitott munkalap a lap eszközeivel indul; itt levehetők és továbbiak felvehetők."
                    : "A hibajegyből nyitott lap a jegy eszközeivel indul; itt levehetők és továbbiak felvehetők."
                  : undefined
              }
            >
              {departmentId ? (
                <JobAssetPicker
                  departmentId={departmentId}
                  selected={assetIds}
                  onChange={setAssetIds}
                />
              ) : (
                <p className={PILOT_FIELD_HINT_CLASS}>
                  Előbb válassz helyszínt: az eszközök a helyszín részfájából
                  jönnek.
                </p>
              )}
            </PilotField>
          </PilotFormCard>

          <PilotFormCard title="Mikor?">
            <PilotFieldPair>
              <PilotField label="Keltezés" requirement="optional">
                <PilotInput
                  aria-label="Keltezés"
                  type="date"
                  value={header.issueDate}
                  onChange={(value) =>
                    setHeader((current) => ({ ...current, issueDate: value }))
                  }
                />
              </PilotField>
              <PilotField label="Határidő" requirement="optional">
                <PilotInput
                  aria-label="Határidő"
                  type="date"
                  value={header.dueDate}
                  onChange={(value) =>
                    setHeader((current) => ({ ...current, dueDate: value }))
                  }
                />
              </PilotField>
            </PilotFieldPair>
            <PilotFieldPair>
              <PilotField label="Teljesítés" requirement="optional">
                <PilotInput
                  aria-label="Teljesítés"
                  type="date"
                  value={header.fulfillmentDate}
                  onChange={(value) =>
                    setHeader((current) => ({
                      ...current,
                      fulfillmentDate: value,
                    }))
                  }
                />
              </PilotField>
            </PilotFieldPair>
          </PilotFormCard>

          <PilotFormCard title="Ki felel érte?">
            <PilotField
              label="Felelős"
              requirement="optional"
              help="A kiosztás a lap adatlapján később is elvégezhető."
            >
              <div className="space-y-1">
                <WorksheetAssigneePicker
                  pilot
                  candidates={candidates}
                  selected={assigneeIds}
                  onToggle={(userId) => {
                    assigneesTouched.current = true;
                    setAssigneeIds((current) =>
                      toggleAssignee(current, userId),
                    );
                  }}
                />
                {jobAssignees && jobAssignees.length > 0 ? (
                  <p
                    className="text-xs text-pilot-grey-500"
                    data-testid="assignee-prefill-note"
                  >
                    A karbantartási lap felelősei előre ki vannak jelölve; itt
                    módosíthatók.
                  </p>
                ) : null}
                {prefillDropped.length > 0 ? (
                  <p
                    className="text-xs font-medium text-amber-700"
                    data-testid="assignee-prefill-dropped"
                  >
                    A karbantartási lap felelősei közül nem jelölhető ki a
                    munkalapra: {prefillDropped.map((p) => p.name).join(", ")}{" "}
                    (a szerepkörük nem engedi).
                  </p>
                ) : null}
                {candidatesError ? (
                  <p className="text-xs font-medium text-red-600">
                    {candidatesError}
                  </p>
                ) : null}
              </div>
            </PilotField>
          </PilotFormCard>
        </PilotFormLayout>
      </div>
    </PilotThemeRoot>
  );
}
