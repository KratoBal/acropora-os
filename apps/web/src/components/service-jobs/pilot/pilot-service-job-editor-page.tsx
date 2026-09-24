"use client";

import { Alert } from "@acropora/ui";
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
import { PartnerPicker } from "../partner-picker";
import {
  toggleAssignee,
  useAssignableUsers,
  WorksheetAssigneePicker,
} from "@/components/worksheets/worksheet-assignee-picker";
import {
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";
import { hasPermission, PERMISSIONS } from "@acropora/types";

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

  const missing: string[] = [];
  if (!customer) missing.push("Partner");
  if (!departmentId) missing.push("Helyszín");
  if (!title.trim()) missing.push("Mi a baj?");
  const canSave = Boolean(created) || missing.length === 0;

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

  return (
    <PilotThemeRoot className="-m-6 flex min-h-screen flex-col bg-pilot-grey-50">
      <div className="border-b border-pilot-grey-200 bg-white px-8 py-5">
        <nav className="mb-3 flex items-center gap-1.5 text-xs text-pilot-grey-400">
          <button
            type="button"
            onClick={() => router.push("/szerviz/hibajegyek")}
            className="cursor-pointer transition-colors hover:text-pilot-aqua-600"
          >
            Szerviz
          </button>
          <span>/</span>
          <button
            type="button"
            onClick={() => router.push("/szerviz/hibajegyek")}
            className="cursor-pointer transition-colors hover:text-pilot-aqua-600"
          >
            Hibajegyek
          </button>
          <span>/</span>
          <span className="font-medium text-pilot-grey-700">Új hibajegy</span>
        </nav>
        <h1 className="text-xl font-semibold text-pilot-grey-900">
          Új hibajegy
        </h1>
      </div>

      <div className="flex-1 px-8 py-6">
        <div className="flex max-w-2xl flex-col gap-5">
          {error ? (
            <Alert variant="danger" title="Nem sikerült" description={error} />
          ) : null}

          <PilotCard>
            <PilotCardHeader title="Partner" />
            <div className="space-y-3 px-5 py-4">
              <div className="space-y-1">
                <label className="text-sm font-medium text-pilot-grey-700">
                  Partner <span className="text-pilot-aqua-600">*</span>
                </label>
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
                  <>
                    {/*
                      A `PartnerPicker` REGI STILUSBAN marad -- lasd a
                      fejlec varrat-szakaszat.
                    */}
                    <PartnerPicker
                      id="pilot-hibajegy-partner"
                      onPick={setCustomer}
                    />
                    <p className="pt-1 text-xs text-pilot-grey-400">
                      Kötelező: helyszín csak partnerhez rendelve létezik.
                    </p>
                  </>
                )}
              </div>

              <div className="space-y-1">
                <label
                  className="text-sm font-medium text-pilot-grey-700"
                  htmlFor="pilot-hibajegy-helyszin"
                >
                  Helyszín <span className="text-pilot-aqua-600">*</span>
                </label>
                {!customer ? (
                  <p className="text-sm text-pilot-grey-400">
                    Előbb válassz partnert. A helyszínek a partner saját fájából
                    jönnek.
                  </p>
                ) : !departmentsLoaded ? (
                  <p className="text-sm text-pilot-grey-400">
                    Helyszínek betöltése…
                  </p>
                ) : nincsValaszthatoHelyszin ? (
                  <p className="text-sm text-pilot-grey-400">
                    Ehhez a partnerhez nincs felvéve helyszín, ezért egyelőre
                    nem nyitható jegy rá. Vegyél fel egyet a partner lapján.
                  </p>
                ) : (
                  <select
                    id="pilot-hibajegy-helyszin"
                    value={departmentId}
                    onChange={(event) => setDepartmentId(event.target.value)}
                    className="w-full cursor-pointer appearance-none rounded-md px-3 py-1.5 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
                  >
                    <option value="">Válassz helyszínt…</option>
                    {departmentOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </PilotCard>

          <PilotCard>
            <PilotCardHeader title="Eszköz (opcionális)" />
            <div className="px-5 py-4">
              {/* A `JobAssetPicker` REGI STILUSBAN marad -- tobbszoros
                  valasztast tud, a Figma egyetlen legordulojenel tobbet. */}
              <JobAssetPicker
                departmentId={departmentId}
                selected={assetIds}
                onChange={setAssetIds}
              />
            </div>
          </PilotCard>

          <PilotCard>
            <PilotCardHeader title="Mi a baj?" />
            <div className="space-y-3 px-5 py-4">
              <div className="space-y-1">
                <label
                  className="text-sm font-medium text-pilot-grey-700"
                  htmlFor="pilot-hibajegy-cim"
                >
                  Mi a baj? <span className="text-pilot-aqua-600">*</span>
                </label>
                <input
                  id="pilot-hibajegy-cim"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Például: a hármas medence szivattyúja nem indul"
                  className="w-full rounded-md px-3 py-1.5 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-300 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
                />
              </div>
              <div className="space-y-1">
                <label
                  className="text-sm font-medium text-pilot-grey-700"
                  htmlFor="pilot-hibajegy-leiras"
                >
                  Részletek
                </label>
                <textarea
                  id="pilot-hibajegy-leiras"
                  rows={5}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Írd le a problémát részletesen…"
                  className="w-full resize-y rounded-md px-3 py-2 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-300 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
                />
              </div>
            </div>
          </PilotCard>

          <PilotCard>
            <PilotCardHeader title="Fotók" />
            <div className="px-5 py-4">
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
                    accept="image/jpeg,image/png,application/pdf"
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
              <p className="pt-2 text-xs text-pilot-grey-400">
                {files.length
                  ? `${files.length} fájl feltöltésre vár. A hibajegy megnyitása után töltjük fel.`
                  : "Elhagyható. JPEG, PNG vagy PDF, fájlonként legfeljebb 10 MB."}
              </p>
            </div>
          </PilotCard>

          <PilotCard>
            <PilotCardHeader title="Delegált kollégák" />
            <div className="space-y-2 px-5 py-4">
              {/* A `WorksheetAssigneePicker` REGI STILUSBAN marad -- lasd a
                  fejlec varrat-szakaszat. A Figma-terv ezt a mezot nem
                  mutatja, de a mai urlapon megvan, es Balazs kerte, hogy
                  maradjon (msg 23156). */}
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
              <p className="pt-1 text-xs text-pilot-grey-400">
                Elhagyható. A delegált kollégák értesítést kapnak a jegyről.
              </p>
            </div>
          </PilotCard>

          <div className="flex items-center justify-between gap-3 border-t border-pilot-grey-200 pt-4">
            <div>
              {!canSave ? (
                <p className="text-xs text-pilot-grey-400">
                  Hiányzó kötelező mezők: {missing.join(", ")}
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <PilotButton
                variant="secondary"
                onClick={() => router.push("/szerviz/hibajegyek")}
              >
                Mégse
              </PilotButton>
              <PilotButton
                variant="primary"
                disabled={!canSave || saving}
                onClick={() => void submit()}
              >
                {created
                  ? "Csatolmányok feltöltése újra"
                  : saving
                    ? "Mentés…"
                    : "Hibajegy megnyitása"}
              </PilotButton>
            </div>
          </div>
        </div>
      </div>
    </PilotThemeRoot>
  );
}
