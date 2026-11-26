"use client";

import { PilotBackLink } from "@/components/pilot/pilot-back-link";
import {
  Alert,
  PageHeader,
  PilotField,
  PilotFormActions,
  PilotFormCard,
  PilotFormLayout,
  PilotSelect,
  PAGE_GUTTER_X,
  PILOT_FIELD_HINT_CLASS,
} from "@acropora/ui";
import type {
  WorksheetDepartmentSummary,
  WorksheetSelectablePartner,
} from "@acropora/types";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { serviceJobsApi } from "@/lib/api/service-jobs";
import { worksheetsApi } from "@/lib/api/worksheets";
import { buildSiteOptions } from "@/lib/partners/site-tree";
import { JobAssetPicker } from "../job-asset-picker";
import { PilotWaitingField } from "@/components/pilot/pilot-waiting-field";
import { PartnerPicker } from "../partner-picker";
import {
  toggleAssignee,
  useAssignableUsers,
  WorksheetAssigneePicker,
} from "@/components/worksheets/worksheet-assignee-picker";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { hasPermission, PERMISSIONS, uploadAccept } from "@acropora/types";

/**
 * A FIGMA MAKE TERV ÁTÜLTETÉSE -- ÚJ HIBAJEGY (harmadik, utolsó kör).
 *
 * Acrobot kérése (msg 23137/23138/23139), forrás:
 * `exchange/figma-hibajegyek-make-6/src/HibajegyekScreen.tsx`
 * (`UjHibajegy`). Lista -> #1071, adatlap -> #1072, ez a harmadik.
 *
 * === UGYANAZ A VARRAT, MINT AZ ELŐZŐ KÉT KÖRBEN ===
 *
 * A lap SAJÁT mezői (partner/helyszín választó felirat, cím, leírás,
 * fájl-feltöltő terület, lábléc) Figma-stílust kapnak. Az ÖSSZETETT,
 * KÉSZ, működő beágyazott widgetek (`PartnerPicker`, `JobAssetPicker`,
 * `WorksheetAssigneePicker`) VÁLTOZATLAN kinézettel maradnak -- ugyanaz
 * a minta, mint a lista/adatlap körben (#1071/#1072).
 *
 * === A DELEGÁLÁS MEGMARADT, HOLOTT A FIGMA-LEÍRÁS NEM EMLÍTI ===
 *
 * A round 5 leírás ("New ticket page") és a round 6 export
 * (`UjHibajegy`) NEM tartalmaz delegálás-mezőt -- a Figma 5b
 * kiegészítése csak a LISTA és az ADATLAP delegálását írja le. Balázs
 * viszont kifejezetten kérte (acrobot közvetítésével, msg 23156, emlék
 * 639), hogy a mai delegálás a felvitel-űrlapon MARADJON MEG. Ez pontosan
 * a ház szabálya: amit a Figma nem mutat, de ma megvan, az nem tűnik el
 * csendben.
 *
 * === A CÍM ÉS A LEÍRÁS KÉT MEZŐ MARAD, A FIGMA EGYET MUTAT ===
 *
 * A Figma "Mi a baj?" egyetlen többsoros mezőt ad. A valódi
 * `CreateServiceJobDto` viszont `title` (rövid, kötelező -- ez jelenik
 * meg a listán és az adatlap fejlécében) ÉS `description` (hosszú,
 * elhagyható) mezőt is ismer, külön -- ez a mai (nem-pilot) űrlap
 * felépítése is. Egybe vonva a listán megjelenő cím elveszne, vagy a
 * teljes szöveg kerülne oda csonkítva. A két mező marad, a "Mi a baj?"
 * címke a RÖVID mezőé (ez felel meg legjobban a Figma szándékának),
 * "Részletek" a hosszúé.
 *
 * === A FÁJL-FELTÖLTÉS HÚZd-IDE, MINT A FIGMÁN ===
 *
 * A mai (nem-pilot) űrlap egyszerű fájl-választó. A Figma húzd-ide
 * (drag & drop) területet mutat -- ezt a felületi javítást a kör átveszi,
 * mert nem veszít semmilyen mai képességet (a kattintásos választás is
 * megmarad, csak a terület fogadja a húzást is), és a Figma kifejezetten
 * ezt kéri.
 *
 * === FLAT SZAKASZOK, NEM KÁRTYÁK (javítva, 2026-09-25 este) ===
 *
 * A terv (`UjHibajegy`, HibajegyekScreen.tsx:1009-1113) erre a lapra
 * EGYETLEN kártyát sem használ: a `FormSection` (1115-1117. sor) egy sima
 * `flex flex-col gap-1` doboz, háttér/keret nélkül. Ez a fájl korábban
 * öt `PilotCard`-ba tördelte ugyanezt -- ugyanaz a mintakoveto javítás,
 * mint a partner portál "Új hibajegy"/"Új akvárium" űrlapjain, ugyanezen
 * az estén. A Partner és a Helyszín is KÜLÖN szakasz a tervben (1025-1048.
 * sor, két önálló `FormSection`), nem egy közös kártya két mezője -- ez is
 * javítva. A "Delegált kollégák" szakasz nincs a tervben (lásd fent), de
 * ugyanazt a flat mintát kapja, hogy ne üssön el a lap többi részétől.
 */
export function PilotServiceJobEditorPage() {
  const { session } = useAuth();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [customer, setCustomer] = useState<WorksheetSelectablePartner | null>(
    null,
  );
  const [departments, setDepartments] = useState<WorksheetDepartmentSummary[]>(
    [],
  );
  const [departmentsLoaded, setDepartmentsLoaded] = useState(false);
  const [departmentId, setDepartmentId] = useState("");
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  // a mező-hibák az első mentési kísérlet UTÁN látszanak (előtte az összesítő és a halvány gomb jelez)
  const [showErrors, setShowErrors] = useState(false);
  const [created, setCreated] = useState<{
    id: string;
    jobNumber: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_MANAGE),
  );
  const token = session?.token ?? "";

  const { candidates, error: candidatesError } = useAssignableUsers(
    token,
    canManage,
  );

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
          setError("A partner helyszínei nem tölthetők be.");
      }
    },
    [token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadDepartments(customer?.customerId ?? "", controller.signal);
    return () => controller.abort();
  }, [customer?.customerId, loadDepartments]);

  useEffect(() => {
    setDepartmentId("");
  }, [customer?.customerId]);

  useEffect(() => {
    setAssetIds([]);
  }, [departmentId]);

  const departmentOptions = useMemo(
    () => buildSiteOptions(departments),
    [departments],
  );

  const nincsValaszthatoHelyszin =
    Boolean(customer) && departmentsLoaded && departmentOptions.length === 0;

  // a hiányzó kötelező mezők, a megjelenő név és a doboz azonosítója (ide görget a mentés gomb); a kötelezőségi szabály a régi: partner, helyszín, cím
  const missingFields: { label: string; fieldId: string }[] = [];
  if (!customer)
    missingFields.push({ label: "Partner", fieldId: "hibajegy-partner-mezo" });
  if (!departmentId)
    missingFields.push({
      label: "Helyszín",
      fieldId: "hibajegy-helyszin-mezo",
    });
  if (!title.trim())
    missingFields.push({ label: "Mi a baj?", fieldId: "hibajegy-cim-mezo" });
  const missing = missingFields.map((field) => field.label);
  const canSave = Boolean(created) || missing.length === 0;
  const errorOf = (label: string, sentence: string) =>
    showErrors && missing.includes(label) ? sentence : null;

  if (!canManage)
    return (
      <Alert
        variant="danger"
        title="Nincs jogosultságod hibajegyet nyitni"
        description="service.manage jogosultság szükséges."
      />
    );

  const uploadFiles = async (jobId: string) => {
    const kepek = files.filter((file) => file.type.startsWith("image/"));
    const egyeb = files.filter((file) => !file.type.startsWith("image/"));
    if (kepek.length)
      await serviceJobsApi.uploadDocument(token, jobId, "PHOTO", kepek);
    if (egyeb.length)
      await serviceJobsApi.uploadDocument(token, jobId, "OTHER", egyeb);
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    const job =
      created ??
      (await serviceJobsApi
        .create(token, {
          title: title.trim(),
          description: description.trim() || null,
          customerId: customer?.customerId ?? null,
          departmentId: departmentId || null,
          assetIds,
          assigneeIds,
        })
        .catch((cause: unknown) => {
          setError(
            cause instanceof Error
              ? cause.message
              : "A hibajegy nem jött létre.",
          );
          return null;
        }));
    if (!job) {
      setSaving(false);
      return;
    }
    setCreated(job);

    if (files.length) {
      try {
        await uploadFiles(job.id);
      } catch (cause) {
        setError(
          `A(z) ${job.jobNumber} hibajegy LÉTREJÖTT, de a csatolmányok feltöltése nem sikerült: ` +
            (cause instanceof Error ? cause.message : "ismeretlen hiba") +
            ". A fájlok kiválasztva maradtak, a gombbal újrapróbálhatod, vagy a jegy lapján is feltöltheted.",
        );
        setSaving(false);
        return;
      }
    }

    router.push(`/szerviz/hibajegyek/${job.id}`);
  };

  // a halvány mentés gomb kattintható: hiányzó mezőnél megmutatja a hibákat és az első hibás mezőhöz görget (nem ment)
  const onSubmitClick = () => {
    if (canSave) {
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
    <PilotThemeRoot
      bleed
      className="flex min-h-screen flex-col bg-pilot-grey-50"
    >
      <div className={`${PAGE_GUTTER_X} pt-6`}>
        <PilotBackLink href="/szerviz/hibajegyek">Hibajegyek</PilotBackLink>
        <PageHeader title="Új hibajegy" />
      </div>

      <div className={`flex-1 ${PAGE_GUTTER_X} py-6`}>
        <PilotFormLayout
          top={
            error ? (
              <Alert
                variant="danger"
                title="Nem sikerült"
                description={error}
              />
            ) : null
          }
          afterText="Mentés után megnyílik az új hibajegy adatlapja. A felelősnek kiosztott kollégák értesítést kapnak, a fotók a megnyitás után töltődnek fel."
          actions={
            <PilotFormActions
              missing={canSave ? [] : missing}
              busy={saving}
              submitLabel={
                created ? "Csatolmányok feltöltése újra" : "Hibajegy megnyitása"
              }
              busyLabel="Mentés…"
              onCancel={() => router.push("/szerviz/hibajegyek")}
              onSubmit={onSubmitClick}
            />
          }
        >
          <PilotFormCard title="Kinek és hol?">
            <PilotField
              id="hibajegy-partner-mezo"
              label="Partner"
              requirement="required"
              htmlFor={customer ? undefined : "pilot-hibajegy-partner"}
              error={errorOf("Partner", "Válassz partnert.")}
              help={
                customer
                  ? undefined
                  : "Helyszín csak partnerhez rendelve létezik."
              }
            >
              {customer ? (
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-pilot-grey-900">
                    {customer.name}
                  </span>
                  <button
                    type="button"
                    className="cursor-pointer text-xs text-pilot-grey-400 underline hover:text-pilot-aqua-700"
                    onClick={() => setCustomer(null)}
                  >
                    Másik partner
                  </button>
                </div>
              ) : (
                <PartnerPicker
                  variant="pilot"
                  id="pilot-hibajegy-partner"
                  onPick={setCustomer}
                />
              )}
            </PilotField>

            <PilotField
              id="hibajegy-helyszin-mezo"
              label="Helyszín"
              requirement="required"
              htmlFor="pilot-hibajegy-helyszin"
              error={errorOf("Helyszín", "Válassz helyszínt.")}
              help={
                !customer
                  ? "A helyszínek a partner saját fájából jönnek."
                  : undefined
              }
            >
              {/* the disabled field in its place, not a sentence (Picasso 3.7) */}
              {!customer ? (
                <PilotWaitingField
                  id="pilot-hibajegy-helyszin"
                  waitingFor="Előbb válassz partnert"
                />
              ) : !departmentsLoaded ? (
                <p className={PILOT_FIELD_HINT_CLASS}>Helyszínek betöltése…</p>
              ) : nincsValaszthatoHelyszin ? (
                <p className="text-sm text-pilot-grey-400">
                  Ehhez a partnerhez nincs felvéve helyszín, ezért egyelőre nem
                  nyitható jegy rá. Vegyél fel egyet a partner lapján.
                </p>
              ) : (
                <PilotSelect
                  id="pilot-hibajegy-helyszin"
                  value={departmentId}
                  onChange={(nextValue) => setDepartmentId(nextValue)}
                  className="w-full"
                  chevron
                >
                  <option value="">Válassz helyszínt…</option>
                  {departmentOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </PilotSelect>
              )}
            </PilotField>

            <PilotField
              label="Eszköz"
              requirement="optional"
              help={
                departmentId
                  ? undefined
                  : "Az eszközök a helyszínhez és az alatta lévő egységekhez tartoznak."
              }
            >
              {/* A `JobAssetPicker` REGI STILUSBAN marad -- tobbszoros
                  valasztast tud, a Figma egyetlen legordulojenel tobbet. Helyszin nelkul a kikapcsolt mezo all a helyen (Picasso 3.7). */}
              {departmentId ? (
                <JobAssetPicker
                  hintClassName={PILOT_FIELD_HINT_CLASS}
                  departmentId={departmentId}
                  selected={assetIds}
                  onChange={setAssetIds}
                />
              ) : (
                <PilotWaitingField waitingFor="Előbb válassz helyszínt" />
              )}
            </PilotField>
          </PilotFormCard>

          <PilotFormCard title="Mi a munka?">
            <PilotField
              id="hibajegy-cim-mezo"
              label="Mi a baj?"
              requirement="required"
              htmlFor="pilot-hibajegy-cim"
              error={errorOf("Mi a baj?", "Írd le röviden, mi a baj.")}
            >
              <input
                id="pilot-hibajegy-cim"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Például: a hármas medence szivattyúja nem indul"
                className="w-full rounded-md px-3 py-1.5 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-300 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
              />
            </PilotField>
            <PilotField
              label="Részletek"
              requirement="optional"
              htmlFor="pilot-hibajegy-leiras"
            >
              <textarea
                id="pilot-hibajegy-leiras"
                rows={5}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Írd le a problémát részletesen…"
                className="w-full resize-y rounded-md px-3 py-2 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-300 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
              />
            </PilotField>

            <PilotField
              label="Fotók"
              requirement="optional"
              help={
                files.length
                  ? `${files.length} fájl feltöltésre vár. A hibajegy megnyitása után töltjük fel.`
                  : "JPEG, PNG vagy PDF, fájlonként legfeljebb 10 MB."
              }
            >
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  setFiles((current) => [
                    ...current,
                    ...Array.from(event.dataTransfer.files),
                  ]);
                }}
                className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 transition-all ${
                  dragging
                    ? "border-pilot-aqua-500 bg-pilot-aqua-50"
                    : "border-pilot-grey-200 hover:border-pilot-grey-300"
                }`}
              >
                <svg
                  width={28}
                  height={28}
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="#9ba3ae"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                >
                  <rect x="1" y="3" width="14" height="10" rx="1.5" />
                  <circle cx="5" cy="6.5" r="1" />
                  <path d="M1 10.5l3.5-3 3 3 2-2 4.5 4.5" />
                </svg>
                <p className="text-sm text-pilot-grey-500">
                  Húzd ide a fotókat, vagy
                </p>
                <label className="cursor-pointer text-sm font-medium text-pilot-aqua-600 transition-colors hover:text-pilot-aqua-800">
                  kattints a tallózáshoz
                  <input
                    type="file"
                    multiple
                    accept={uploadAccept(["jpeg", "png", "pdf"])}
                    className="hidden"
                    onChange={(event) =>
                      setFiles((current) => [
                        ...current,
                        ...Array.from(event.target.files ?? []),
                      ])
                    }
                  />
                </label>
                {files.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {files.map((file, index) => (
                      <span
                        key={`${file.name}-${index}`}
                        className="rounded bg-pilot-grey-100 px-2 py-0.5 text-xs text-pilot-grey-600 ring-1 ring-pilot-grey-200"
                      >
                        {file.name}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </PilotField>
          </PilotFormCard>

          <PilotFormCard title="Ki felel érte?">
            {/*
              Felelős -- NINCS A TERVBEN, de Balázs kérte, hogy maradjon (msg 23156): a mai delegálás a felvitel-űrlapon megmarad.
              Egy felirat mindenhol: "Felelős" (picasso R5, Balázs D4).
            */}
            <PilotField
              label="Felelős"
              requirement="optional"
              help="A kiosztott kollégák értesítést kapnak a jegyről."
            >
              <WorksheetAssigneePicker
                candidates={candidates}
                selected={assigneeIds}
                onToggle={(userId) =>
                  setAssigneeIds((current) => toggleAssignee(current, userId))
                }
              />
              {candidatesError ? (
                <p className="text-xs font-medium text-rose-600">
                  {candidatesError}
                </p>
              ) : null}
            </PilotField>
          </PilotFormCard>
        </PilotFormLayout>
      </div>
    </PilotThemeRoot>
  );
}
