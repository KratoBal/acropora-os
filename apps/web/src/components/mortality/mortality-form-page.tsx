"use client";

import {
  Alert,
  Icon,
  PilotButton,
  PilotFormField,
  PilotInput,
  PilotPageHeader,
  PilotSelect,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  MORTALITY_PRODUCT_NAME_MAX,
  MORTALITY_SOURCE_LABELS,
  MORTALITY_SOURCE_NOTE_MAX,
  MORTALITY_SOURCE_TYPES,
  PERMISSIONS,
  type CreateMortalityInput,
  type MortalityAquariumOption,
  type MortalityLocationOption,
  type MortalitySourceType,
} from "@acropora/types";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { mortalityApi } from "@/lib/api/mortality";
import { aquariumLabel, budapestDay } from "./mortality-format";
import { MORTALITY_LIST_PATH } from "./mortality-list-page";
import {
  freeTextOption,
  MortalitySearchPicker,
  type PickerOption,
} from "./mortality-search-picker";

const PHOTO_TYPES = ["image/jpeg", "image/png"];

export interface MortalityFormState {
  product: PickerOption | null;
  quantity: string;
  aquariumId: string;
  sourceType: MortalitySourceType | "";
  supplier: PickerOption | null;
  sourceNote: string;
  note: string;
  /** az elhullás napja, ÉÉÉÉ-HH-NN (a dátummező értéke) */
  occurredOn: string;
  /** a halas rack azonosítója, vagy üres */
  locationId: string;
}

/**
 * AZ ŰRLAP ÉRVÉNYESSÉGE, a szerver szabályaival egyezően: az első hiányzó
 * mező mondata, vagy a beküldhető bemenet. A `today` a mai nap Budapest
 * szerint (az elhullás napja nem lehet utána).
 */
export function mortalityFormInput(
  state: MortalityFormState,
  today: string = budapestDay(new Date()),
): { problem: string } | { input: CreateMortalityInput } {
  if (!state.product)
    return { problem: "Válaszd ki az élőlényt, vagy írd be a nevét." };
  const quantity = Number(state.quantity);
  if (!Number.isInteger(quantity) || quantity < 1)
    return { problem: "A példányszám legalább 1, egész szám." };
  if (!state.aquariumId) return { problem: "Válaszd ki az akváriumot." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(state.occurredOn))
    return { problem: "Add meg az elhullás napját." };
  // az ÉÉÉÉ-HH-NN alak szövegként is időrendben hasonlít
  if (state.occurredOn > today)
    return { problem: "Az elhullás napja nem lehet a jövőben." };
  if (!state.sourceType)
    return { problem: "Add meg, honnan érkezett az állat." };
  if (state.sourceType === "SUPPLIER" && !state.supplier)
    return { problem: "Válaszd ki a beszállítót, vagy írd be a nevét." };
  if (state.sourceType === "OTHER" && !state.sourceNote.trim())
    return { problem: "Az „Egyéb” forrásnál nevezd meg, honnan érkezett." };
  const isSupplier = state.sourceType === "SUPPLIER";
  // a beírt (rendszerben nem szereplő) élőlény és beszállító a szabad szöveges
  // mezőbe megy, az azonosító helyére (pontosan az egyik, a szerver is ezt kéri)
  const freeProduct = state.product.freeText === true;
  const freeSupplier = isSupplier && state.supplier!.freeText === true;
  return {
    input: {
      productId: freeProduct ? null : state.product.id,
      productName: freeProduct ? state.product.title : null,
      quantity,
      aquariumId: state.aquariumId,
      sourceType: state.sourceType,
      supplierId: isSupplier && !freeSupplier ? state.supplier!.id : null,
      sourceNote: isSupplier
        ? freeSupplier
          ? state.supplier!.title
          : null
        : state.sourceNote.trim() || null,
      note: state.note.trim() || null,
      occurredOn: state.occurredOn,
      locationId: state.locationId || null,
    },
  };
}

/** Az üres űrlap; az elhullás napja alapból a mai nap (Budapest szerint). */
function emptyState(): MortalityFormState {
  return {
    product: null,
    quantity: "1",
    aquariumId: "",
    sourceType: "",
    supplier: null,
    sourceNote: "",
    note: "",
    occurredOn: budapestDay(new Date()),
    locationId: "",
  };
}

/**
 * ÚJ ELHULLÁSI BEJEGYZÉS ÉS MÓDOSÍTÁS (kártya 115c9740; Figma: OS / Elhullási
 * napló / Új bejegyzés). A módosítás ugyanez az űrlap, kitöltve: minden mező
 * módosítható (acrobot 27141), a szerver naplózza. A rögzítő és a rögzítés
 * ideje nem mező: a rendszer menti. Az elhullás NAPJA viszont mező (Luca,
 * 2026-10-07), alapból a mai nap, és a halas rack is választható.
 *
 * A FÉNYKÉP A MENTÉS UTÁN MEGY FEL: a bejegyzés előtte nem létezik. Ha a
 * feltöltés elbukik, a bejegyzés már megvan, és a részletlap mondja ki, hogy a
 * képeket újra kell küldeni.
 */
export function MortalityFormPage({ recordId }: { recordId?: string }) {
  const { session } = useAuth();
  const router = useRouter();
  const token = session?.token ?? "";
  const isEdit = Boolean(recordId);
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.MORTALITY_MANAGE),
  );

  const [state, setState] = useState<MortalityFormState>(emptyState);
  const [aquariums, setAquariums] = useState<MortalityAquariumOption[]>([]);
  const [locations, setLocations] = useState<MortalityLocationOption[]>([]);
  const today = budapestDay(new Date());
  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const set = <K extends keyof MortalityFormState>(
    key: K,
    value: MortalityFormState[K],
  ) => setState((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    const options = mortalityApi.aquariumOptions(token, controller.signal);
    // a rack választható, nem kötelező: ha a lista nem jön meg, az űrlap
    // ettől még menthető
    const racks = mortalityApi
      .locationOptions(token, controller.signal)
      .catch(() => [] as MortalityLocationOption[]);
    if (!recordId) {
      options.then(setAquariums).catch(() => undefined);
      racks.then(setLocations).catch(() => undefined);
      return () => controller.abort();
    }
    Promise.all([
      options,
      mortalityApi.detail(token, recordId, controller.signal),
      racks,
    ])
      .then(([own, record, active]) => {
        // egy régi bejegyzés racket azóta kivezethették: akkor is álljon ott
        setLocations(
          !record.location ||
            active.some((rack) => rack.id === record.location!.id)
            ? active
            : [record.location, ...active],
        );
        // egy régi bejegyzés akváriuma azóta inaktív lehet: a választóban
        // akkor is ott kell állnia
        setAquariums(
          own.some((aquarium) => aquarium.id === record.aquarium.id)
            ? own
            : [record.aquarium, ...own],
        );
        setState({
          product: record.product
            ? {
                id: record.product.id,
                title: record.product.name,
                subtitle: record.product.commonName,
              }
            : freeTextOption(
                record.productName ?? "",
                MORTALITY_PRODUCT_NAME_MAX,
              ),
          quantity: String(record.quantity),
          aquariumId: record.aquarium.id,
          sourceType: record.source.type,
          supplier: record.source.supplier
            ? {
                id: record.source.supplier.id,
                title: record.source.supplier.name,
              }
            : record.source.type === "SUPPLIER" && record.source.note
              ? freeTextOption(record.source.note, MORTALITY_SOURCE_NOTE_MAX)
              : null,
          // beszállítónál a megnevezés a beszállító helyén áll, nem külön mezőben
          sourceNote:
            record.source.type === "SUPPLIER" ? "" : (record.source.note ?? ""),
          note: record.note ?? "",
          occurredOn: record.occurredOn,
          locationId: record.location?.id ?? "",
        });
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setLoadError(
          cause instanceof Error
            ? cause.message
            : "A bejegyzés nem tölthető be.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [canManage, recordId, token]);

  const searchProducts = useCallback(
    async (term: string, signal: AbortSignal) =>
      (await mortalityApi.productOptions(token, term, signal)).map(
        (option) => ({
          id: option.id,
          title: option.name,
          subtitle: option.commonName,
        }),
      ),
    [token],
  );
  const searchSuppliers = useCallback(
    async (term: string, signal: AbortSignal) =>
      (await mortalityApi.supplierOptions(token, term, signal)).map(
        (option) => ({
          id: option.id,
          title: option.name,
        }),
      ),
    [token],
  );

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const picked = Array.from(list);
    const rejected = picked.filter((file) => !PHOTO_TYPES.includes(file.type));
    setFiles((current) => [
      ...current,
      ...picked.filter((file) => PHOTO_TYPES.includes(file.type)),
    ]);
    setProblem(
      rejected.length
        ? `Csak JPEG vagy PNG fénykép csatolható; kihagyva: ${rejected.map((file) => file.name).join(", ")}.`
        : null,
    );
  };

  const save = async () => {
    const result = mortalityFormInput(state, today);
    if ("problem" in result) {
      setProblem(result.problem);
      return;
    }
    setProblem(null);
    setSaving(true);
    try {
      const saved = recordId
        ? await mortalityApi.update(token, recordId, result.input)
        : await mortalityApi.create(token, result.input);
      let photoFailed = false;
      if (files.length) {
        try {
          await mortalityApi.uploadPhotos(token, saved.id, files);
        } catch {
          photoFailed = true;
        }
      }
      router.push(
        `${MORTALITY_LIST_PATH}/${encodeURIComponent(saved.id)}${photoFailed ? "?fenykep=hiba" : ""}`,
      );
    } catch (cause) {
      setProblem(
        cause instanceof Error ? cause.message : "A bejegyzés nem menthető.",
      );
      setSaving(false);
    }
  };

  const cancel = () =>
    router.push(
      recordId
        ? `${MORTALITY_LIST_PATH}/${encodeURIComponent(recordId)}`
        : MORTALITY_LIST_PATH,
    );

  if (!canManage)
    return (
      <Alert
        variant="danger"
        title="Nincs jogosultságod elhullási bejegyzést rögzíteni"
        description="mortality.manage jogosultság szükséges."
      />
    );
  if (loadError)
    return (
      <Alert variant="danger" title="Betöltési hiba" description={loadError} />
    );
  if (loading)
    return (
      <div aria-label="Bejegyzés betöltése" className="space-y-3">
        <Skeleton className="h-16" />
        <Skeleton className="h-96" />
      </div>
    );

  return (
    <PilotThemeRoot theme="light" className="space-y-6">
      <PilotPageHeader
        title={
          isEdit ? "Elhullási bejegyzés módosítása" : "Új elhullási bejegyzés"
        }
        description={
          isEdit
            ? "Minden mező módosítható; a változás a naplóba kerül."
            : "Új esemény rögzítése a bolt élőállat-nyilvántartásába."
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <form
          className="space-y-5 rounded-2xl border border-pilot-grey-200 bg-white p-6"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <PilotFormField
            label="Élőlény"
            required
            help="A listában a Korallok, Halak és Gerinctelenek kategória termékei állnak. Ha az élőlény nincs a rendszerben, írd be a nevét. A rendszerbeli élőlény a készletből levonódik."
          >
            <MortalitySearchPicker
              label="Élőlény"
              placeholder="Keresés név alapján, vagy írd be a nevét…"
              value={state.product}
              onChange={(option) => set("product", option)}
              search={searchProducts}
              emptyText="Nincs ilyen nevű élő állat."
              freeTextMaxLength={MORTALITY_PRODUCT_NAME_MAX}
            />
          </PilotFormField>

          <div className="grid gap-5 sm:grid-cols-[140px_minmax(0,1fr)]">
            <PilotFormField label="Példányszám" required>
              <PilotInput
                aria-label="Példányszám"
                type="number"
                inputMode="numeric"
                min={1}
                value={state.quantity}
                onChange={(value) => set("quantity", value)}
                className="h-10"
              />
            </PilotFormField>
            <PilotFormField label="Akvárium" required>
              <PilotSelect
                chevron
                aria-label="Akvárium"
                value={state.aquariumId}
                onChange={(value) => set("aquariumId", value)}
                className="[&_select]:h-10"
              >
                <option value="">Válassz akváriumot…</option>
                {aquariums.map((aquarium) => (
                  <option key={aquarium.id} value={aquarium.id}>
                    {aquariumLabel(aquarium)}
                  </option>
                ))}
              </PilotSelect>
            </PilotFormField>
          </div>

          <div className="grid gap-5 sm:grid-cols-[180px_minmax(0,1fr)]">
            <PilotFormField
              label="Elhullás napja"
              required
              help="Ha utólag rögzíted, állítsd a valódi napra."
            >
              <PilotInput
                aria-label="Elhullás napja"
                type="date"
                max={today}
                value={state.occurredOn}
                onChange={(value) => set("occurredOn", value)}
                className="h-10"
              />
            </PilotFormField>
            <PilotFormField
              label="Halas rack"
              help="Ha a halas rendszerben történt, melyik részén."
            >
              <PilotSelect
                chevron
                aria-label="Halas rack"
                value={state.locationId}
                onChange={(value) => set("locationId", value)}
                className="[&_select]:h-10"
              >
                <option value="">Nincs megadva</option>
                {locations.map((rack) => (
                  <option key={rack.id} value={rack.id}>
                    {rack.name}
                  </option>
                ))}
              </PilotSelect>
            </PilotFormField>
          </div>

          <PilotFormField label="Beszállító / érkezési forrás" required>
            <PilotSelect
              chevron
              aria-label="Forrás típusa"
              value={state.sourceType}
              onChange={(value) =>
                setState((current) => ({
                  ...current,
                  sourceType: value as MortalitySourceType | "",
                  // a másik forrás adata nem öröklődik (a szerver sem viszi át)
                  supplier: value === "SUPPLIER" ? current.supplier : null,
                  sourceNote: value === "SUPPLIER" ? "" : current.sourceNote,
                }))
              }
              className="[&_select]:h-10"
            >
              <option value="">Válassz beszállítót vagy forrást…</option>
              {MORTALITY_SOURCE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {MORTALITY_SOURCE_LABELS[type]}
                </option>
              ))}
            </PilotSelect>
          </PilotFormField>

          {state.sourceType === "SUPPLIER" ? (
            <PilotFormField label="Beszállító" required>
              <MortalitySearchPicker
                label="Beszállító"
                placeholder="Keresés a beszállítók között, vagy írd be a nevét…"
                value={state.supplier}
                onChange={(option) => set("supplier", option)}
                search={searchSuppliers}
                emptyText="Nincs ilyen nevű beszállító."
                freeTextMaxLength={MORTALITY_SOURCE_NOTE_MAX}
              />
            </PilotFormField>
          ) : state.sourceType ? (
            <PilotFormField
              label="Megnevezés"
              required={state.sourceType === "OTHER"}
              help="Például a tenyésztő vagy a cserepartner neve."
            >
              <PilotInput
                aria-label="A forrás megnevezése"
                value={state.sourceNote}
                onChange={(value) =>
                  set("sourceNote", value.slice(0, MORTALITY_SOURCE_NOTE_MAX))
                }
                className="h-10"
              />
            </PilotFormField>
          ) : null}

          <div className="rounded-xl bg-pilot-grey-50 px-4 py-3">
            <p className="text-sm font-medium text-pilot-grey-800">
              Rögzítő és rögzítés ideje
            </p>
            <p className="mt-0.5 text-xs text-pilot-grey-500">
              A rendszer automatikusan menti a bejelentkezett kollégát és a
              rögzítés pontos idejét; az elhullás napja ettől független.
            </p>
          </div>

          <PilotFormField label="Megjegyzés">
            <textarea
              aria-label="Megjegyzés"
              value={state.note}
              onChange={(event) => set("note", event.target.value)}
              placeholder="Körülmények, tünetek, észrevételek…"
              maxLength={4000}
              rows={4}
              className="w-full rounded-lg px-3 py-2 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-400 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
            />
          </PilotFormField>

          {!isEdit ? (
            <PilotFormField label="Fotók" help="Több kép is feltölthető.">
              <div
                role="button"
                tabIndex={0}
                aria-label="Fotók feltöltése"
                onClick={() => fileInput.current?.click()}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ")
                    fileInput.current?.click();
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  addFiles(event.dataTransfer.files);
                }}
                className={`flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed px-4 py-8 text-center ${
                  dragging
                    ? "border-pilot-aqua-500 bg-pilot-aqua-50"
                    : "border-pilot-grey-200"
                }`}
              >
                <Icon
                  name="download"
                  size={18}
                  className="text-pilot-grey-400"
                />
                <span className="text-sm font-medium text-pilot-grey-700">
                  Húzd ide a fájlokat
                </span>
                <span className="text-xs text-pilot-grey-500">
                  vagy kattints a tallózáshoz (JPEG vagy PNG)
                </span>
              </div>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept={PHOTO_TYPES.join(",")}
                className="hidden"
                onChange={(event) => {
                  addFiles(event.target.files);
                  event.target.value = "";
                }}
              />
              {files.length ? (
                <ul className="mt-3 space-y-1">
                  {files.map((file, index) => (
                    <li
                      key={`${file.name}-${index}`}
                      className="flex items-center justify-between rounded-lg bg-pilot-grey-50 px-3 py-1.5 text-sm"
                    >
                      <span className="truncate">{file.name}</span>
                      <button
                        type="button"
                        aria-label={`${file.name} eltávolítása`}
                        onClick={() =>
                          setFiles((current) =>
                            current.filter((_, i) => i !== index),
                          )
                        }
                        className="cursor-pointer text-pilot-grey-500 hover:text-pilot-grey-800"
                      >
                        <Icon name="x" size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </PilotFormField>
          ) : null}

          {problem ? (
            <p role="alert" className="text-sm font-medium text-rose-600">
              {problem}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-pilot-grey-100 pt-5">
            <PilotButton variant="secondary" onClick={cancel} disabled={saving}>
              Mégse
            </PilotButton>
            <PilotButton type="submit" disabled={saving}>
              {saving
                ? "Mentés…"
                : isEdit
                  ? "Módosítás mentése"
                  : "Bejegyzés mentése"}
            </PilotButton>
          </div>
        </form>

        <aside className="h-fit rounded-2xl border border-pilot-grey-200 bg-white p-5">
          <p className="text-sm font-semibold text-pilot-grey-900">
            Mentés előtt
          </p>
          <ul className="mt-2 space-y-1.5 text-sm text-pilot-grey-600">
            <li>• Ellenőrizd a példányszámot</li>
            <li>• Utólagos rögzítésnél állítsd át az elhullás napját</li>
            <li>• Válaszd ki a pontos akváriumot</li>
            <li>• A fotó opcionális, de ajánlott</li>
            <li>• Add meg, honnan érkezett az állat</li>
          </ul>
        </aside>
      </div>
    </PilotThemeRoot>
  );
}
