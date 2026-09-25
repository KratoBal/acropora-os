"use client";

import { Alert, Icon } from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type WorksheetSelectablePartner,
  type WorksheetDepartmentSummary,
} from "@acropora/types";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

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
  emptyLine,
  toLineInput,
  WorksheetLineEditor,
  type WorksheetLineDraft,
} from "../worksheet-line-editor";
import {
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotFormField,
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
  const [assetIds, setAssetIds] = useState<string[]>([]);
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
  const [ticketError, setTicketError] = useState<string | null>(null);

  const { candidates, error: candidatesError } = useAssignableUsers(
    token,
    canManage,
  );

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
        if (job.customerId === null) {
          setTicketError(
            "Ehhez a hibajegyhez még nincs partner. Először állítsd be a hibajegy partnerét, és utána nyiss alá munkalapot.",
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
            : "A hibajegy nem tölthető be, ezért a partnere sem állítható be automatikusan.",
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
      <PilotThemeRoot className="-m-6 min-h-screen bg-pilot-grey-50 p-8">
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

  const missing: string[] = [];
  if (!customerId) missing.push("Partner");
  if (!departmentId) missing.push("Alegység");
  if (!header.subject.trim()) missing.push("Tárgy");
  const canSubmit = missing.length === 0;

  return (
    <PilotThemeRoot className="-m-6 min-h-screen bg-pilot-grey-50">
      <div className="border-b border-pilot-grey-200 bg-white px-8 py-5">
        <Link
          href={backToList.href}
          className="mb-3 flex items-center gap-1.5 text-xs text-pilot-grey-400 transition-colors hover:text-pilot-grey-700"
        >
          <Icon name="chevron-left" size={12} />
          {backToList.fromWithinApp ? "Vissza" : "Munkalapok"}
        </Link>
        <h1 className="text-xl font-semibold text-pilot-grey-900">
          Új munkalap
        </h1>
      </div>

      <div className="flex max-w-3xl flex-col gap-5 px-8 py-6">
        <ServiceOfflineNotice state={{ kind: "form" }} pilot />
        {error ? (
          <Alert variant="danger" title="Hiba" description={error} />
        ) : null}
        {ticketError ? (
          <Alert
            variant="danger"
            title="A hibajegy oldaláról"
            description={ticketError}
          />
        ) : null}
        {/*
          A (C) HIÁNY 1/2: A HIBAJEGY SORA. Csak akkor jelenik meg, ha a lap
          egy jegyből nyílt ÉS a jegy száma megjött -- a Figma feltétel nélkül
          rajzolja (`linkedHibajegy &&`), itt a valódi betöltés dönti el.
        */}
        {ticketId && ticketJobNumber ? (
          <div className="rounded-lg bg-pilot-grey-50 px-4 py-3 text-sm text-pilot-grey-600 ring-1 ring-pilot-grey-200">
            Hibajegy:{" "}
            <Link
              href={`/szerviz/hibajegyek/${ticketId}`}
              className="font-mono font-medium text-pilot-grey-800 hover:text-pilot-aqua-700"
            >
              {ticketJobNumber}
            </Link>
          </div>
        ) : null}

        <PilotCard>
          <PilotCardHeader title="Hozzárendelés" />
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 p-5 sm:grid-cols-2">
            <PilotFormField
              label="Partner"
              required
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
            </PilotFormField>
            <PilotFormField
              label="Alegység"
              required
              help={
                ticketUnitArchived
                  ? `A hibajegy helyszíne (${ticketDepartmentName ?? "ismeretlen"}) archivált, ezért nem tölthető elő. Válassz aktív alegységet.`
                  : noSelectableUnits
                    ? ticketPartnerIsMirror
                      ? "Ehhez a partnerhez még nincs alegység. Vegyél fel egyet lent."
                      : "Ehhez a hibajegyhez nem tartozhat alegység: a partnere nem szerviz partnerként van felvéve. A jegy partnerét kell rendbe tenni."
                    : "A munkalapszám első tagja is ebből lesz."
              }
            >
              <PilotSelect
                aria-label="Alegység"
                value={departmentId}
                disabled={!customerId}
                onChange={setDepartmentId}
              >
                <option value="">Válasszon alegységet…</option>
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
                className="mt-1.5 cursor-pointer text-xs text-pilot-aqua-600 transition hover:text-pilot-aqua-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {newDepartmentOpen ? "− Mégsem" : "+ Új alegység hozzáadása"}
              </button>
            </PilotFormField>
            {newDepartmentOpen && customerId ? (
              <>
                <PilotFormField label="Szülő helyszín">
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
                </PilotFormField>
                <PilotFormField label="Új alegység kódja">
                  <PilotInput
                    aria-label="Új alegység kódja"
                    value={newDepartment.code}
                    placeholder="pl. CAP-UJ"
                    onChange={(value) =>
                      setNewDepartment((current) => ({
                        ...current,
                        code: value,
                      }))
                    }
                  />
                </PilotFormField>
                <PilotFormField
                  label="Új alegység neve"
                  required
                  className="sm:col-span-2"
                >
                  <div className="flex gap-2">
                    <PilotInput
                      aria-label="Új alegység neve"
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
                      Alegység felvitele
                    </PilotButton>
                  </div>
                </PilotFormField>
              </>
            ) : null}
          </div>
        </PilotCard>

        <PilotCard>
          <PilotCardHeader title="Munkalap adatai" />
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 p-5 sm:grid-cols-2">
            <PilotFormField label="Tárgy" required className="sm:col-span-2">
              <PilotInput
                aria-label="Tárgy"
                value={header.subject}
                placeholder="pl. Szűrőrendszer csere"
                onChange={(value) =>
                  setHeader((current) => ({ ...current, subject: value }))
                }
              />
            </PilotFormField>
            <PilotFormField label="Keltezés">
              <PilotInput
                aria-label="Keltezés"
                type="date"
                value={header.issueDate}
                onChange={(value) =>
                  setHeader((current) => ({ ...current, issueDate: value }))
                }
              />
            </PilotFormField>
            <PilotFormField label="Határidő">
              <PilotInput
                aria-label="Határidő"
                type="date"
                value={header.dueDate}
                onChange={(value) =>
                  setHeader((current) => ({ ...current, dueDate: value }))
                }
              />
            </PilotFormField>
            <PilotFormField label="Teljesítés">
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
            </PilotFormField>
            <PilotFormField
              label="Felelősök"
              className="sm:col-span-2"
              help="Elhagyható: a kiosztás a lap adatlapján később is elvégezhető."
            >
              <div className="space-y-1">
                <WorksheetAssigneePicker
                  pilot
                  candidates={candidates}
                  selected={assigneeIds}
                  onToggle={(userId) =>
                    setAssigneeIds((current) => toggleAssignee(current, userId))
                  }
                />
                {candidatesError ? (
                  <p className="text-xs font-medium text-red-600">
                    {candidatesError}
                  </p>
                ) : null}
              </div>
            </PilotFormField>
            <PilotFormField label="Megjegyzés" className="sm:col-span-2">
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
            </PilotFormField>
          </div>
        </PilotCard>

        <WorksheetLineEditor
          pilot
          lines={lines}
          onChange={setLines}
          disabled={saving}
        />

        <PilotCard>
          <PilotCardHeader title="Érintett eszközök" />
          <div className="p-5">
            {departmentId ? (
              <>
                <p className="mb-3 text-xs text-pilot-grey-400">
                  Elhagyható. A hibajegyből nyitott lap a jegy eszközeivel
                  indul; itt levehetők és továbbiak felvehetők.
                </p>
                <JobAssetPicker
                  departmentId={departmentId}
                  selected={assetIds}
                  onChange={setAssetIds}
                />
              </>
            ) : (
              <p className="text-xs italic text-pilot-grey-400">
                Előbb válassz alegységet: az eszközök a helyszín részfájából
                jönnek.
              </p>
            )}
          </div>
        </PilotCard>

        {/*
          A (C) HIÁNY 2/2: "KÖTELEZŐ: X, Y" A MENTÉS GOMB ALATT, csak amíg a
          gomb inaktív -- a minta a pilot-asset-create-page.tsx-ből jön.
        */}
        <div className="flex items-center gap-4 pb-8">
          <Link href={backToList.href}>
            <PilotButton variant="secondary" disabled={saving}>
              Mégse
            </PilotButton>
          </Link>
          <PilotButton
            variant="primary"
            disabled={!canSubmit || saving}
            onClick={() => void submit()}
          >
            {saving ? "Mentés…" : "Mentés"}
          </PilotButton>
          {missing.length > 0 ? (
            <p className="text-xs text-pilot-grey-400">
              Kötelező: {missing.join(", ")}
            </p>
          ) : null}
        </div>
      </div>
    </PilotThemeRoot>
  );
}
