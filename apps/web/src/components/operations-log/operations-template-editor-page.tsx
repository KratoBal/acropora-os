"use client";

import {
  Alert,
  ConfirmDialog,
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotFormField,
  PilotInput,
  PilotPageHeader,
  PilotSegmentedControl,
  PilotSelect,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  OPERATIONS_FIELD_TYPES,
  OPERATIONS_METER_ROLE_LABELS,
  OPERATIONS_METER_ROLES,
  OPERATIONS_TASK_FREQUENCIES,
  OPERATIONS_TEMPLATE_LIMITS,
  operationsFieldErrors,
  PERMISSIONS,
  type AssetCategory,
  type AssetListItem,
  type OperationsMeterRole,
  type OperationsTaskFieldType,
  type OperationsTaskFrequency,
  type OperationsTaskTemplateDto,
  type OperationsTaskTemplateInput,
} from "@acropora/types";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { assetCategoriesApi } from "@/lib/api/asset-categories";
import { assetsApi } from "@/lib/api/assets";
import { operationsLogApi } from "@/lib/api/operations-log";

import {
  errorText,
  isAbort,
  OPERATIONS_FIELD_TYPE_LABELS,
  OPERATIONS_FREQUENCY_LABELS,
  OPERATIONS_TEMPLATES_PATH,
} from "./operations-format";

/** Egy mező a szerkesztőben: a `rowKey` csak a listához kell, a `key` a meglévő mező tárolt azonosítója. */
interface DraftField {
  rowKey: string;
  key: string | null;
  label: string;
  type: OperationsTaskFieldType;
  unit: string;
  required: boolean;
  meterRole: OperationsMeterRole | "";
}

interface Draft {
  name: string;
  description: string;
  frequency: OperationsTaskFrequency;
  targetKind: "ASSET" | "CATEGORY";
  assetId: string;
  /** A kiválasztott eszköz felirata (szám és név), a keresőmező alatt. */
  assetText: string;
  categoryId: string;
  fields: DraftField[];
}

let rowCounter = 0;
const rowKey = () => `m${(rowCounter += 1)}`;

const EMPTY: Draft = {
  name: "",
  description: "",
  frequency: "WEEKLY",
  targetKind: "ASSET",
  assetId: "",
  assetText: "",
  categoryId: "",
  fields: [],
};

const emptyField = (): DraftField => ({
  rowKey: rowKey(),
  key: null,
  label: "",
  type: "NUMBER",
  unit: "",
  required: false,
  meterRole: "",
});

function draftOf(template: OperationsTaskTemplateDto): Draft {
  return {
    name: template.name,
    description: template.description ?? "",
    frequency: template.frequency,
    targetKind: template.target.kind,
    assetId: template.target.kind === "ASSET" ? template.target.assetId : "",
    assetText:
      template.target.kind === "ASSET"
        ? `${template.target.assetNumber} ${template.target.name}`
        : "",
    categoryId:
      template.target.kind === "CATEGORY" ? template.target.categoryId : "",
    fields: template.fields.map((field) => ({
      rowKey: rowKey(),
      key: field.key,
      label: field.label,
      type: field.type,
      unit: field.unit ?? "",
      required: field.required,
      meterRole: field.meterRole ?? "",
    })),
  };
}

/** A mezők a szerver szabályainak alakjára (`operationsFieldErrors`, a mentés is ezt küldi). */
function fieldInputs(draft: Draft): OperationsTaskTemplateInput["fields"] {
  return draft.fields.map((field) => ({
    key: field.key,
    label: field.label.trim(),
    type: field.type,
    unit:
      field.type === "NUMBER" && field.unit.trim() ? field.unit.trim() : null,
    required: field.required,
    meterRole:
      field.type === "NUMBER" && field.meterRole ? field.meterRole : null,
  }));
}

function inputOf(
  draft: Draft,
  expectedUpdatedAt?: string,
): OperationsTaskTemplateInput {
  return {
    // az egyidejűség-őr: a betöltött sablon `updatedAt`-je; ha közben más módosította, a szerver 409-et ad
    ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    frequency: draft.frequency,
    assetId: draft.targetKind === "ASSET" ? draft.assetId : null,
    assetCategoryId: draft.targetKind === "CATEGORY" ? draft.categoryId : null,
    fields: fieldInputs(draft),
  };
}

/** A mentés előtti hibák: a név, a cél és a mezők szabályai (ugyanazok, mint a szerveren). */
export function draftErrors(draft: Draft): string[] {
  const errors: string[] = [];
  if (draft.name.trim() === "") errors.push("A sablon nevét meg kell adni.");
  if (draft.targetKind === "ASSET" && draft.assetId === "")
    errors.push("Válassz eszközt, amelyre a sablon szól.");
  if (draft.targetKind === "CATEGORY" && draft.categoryId === "")
    errors.push("Válassz eszköz-kategóriát, amelyre a sablon szól.");
  return [...errors, ...operationsFieldErrors(fieldInputs(draft))];
}

const TARGET_OPTIONS = ["Eszköz", "Eszköz-kategória"] as const;
const L = OPERATIONS_TEMPLATE_LIMITS;

/**
 * AZ ÜZEMELTETÉSI NAPLÓ SABLONJÁNAK SZERKESZTŐJE (task os-uzemeltetesi-naplo, S1b; a legközelebbi meglévő képernyő az
 * Ajánlatsablon szerkesztő, `quotes/quote-template-editor-page.tsx`, Figma 579:2562): ugyanaz a fejléc és a kártyák, a sorok
 * lejjebb/feljebb/eltávolítás gombjai. A mezők kód nélkül épülnek fel; a szerkesztő ugyanazokat a szabályokat futtatja, mint
 * a szerver (`operationsFieldErrors`).
 */
export function OperationsTemplateEditorPage({
  templateId,
}: {
  templateId: string | null;
}) {
  const { session } = useAuth();
  const router = useRouter();
  const token = session?.token ?? "";
  const canManage = Boolean(
    session &&
    hasPermission(session.user, PERMISSIONS.OPERATIONS_LOG_TEMPLATES_MANAGE),
  );
  const [template, setTemplate] = useState<OperationsTaskTemplateDto | null>(
    null,
  );
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [loaded, setLoaded] = useState(templateId === null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const [search, setSearch] = useState("");
  const [found, setFound] = useState<AssetListItem[]>([]);

  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    assetCategoriesApi
      .list(token, false, controller.signal)
      .then((response) => setCategories(response.items))
      .catch(() => setCategories([]));
    if (templateId) {
      operationsLogApi
        .get(token, templateId, controller.signal)
        .then((next) => {
          setTemplate(next);
          setDraft(draftOf(next));
          setLoaded(true);
        })
        .catch((cause) => {
          if (!isAbort(cause))
            setError(errorText(cause, "A sablon nem tölthető be."));
          setLoaded(true);
        });
    }
    return () => controller.abort();
  }, [canManage, templateId, token]);

  useEffect(() => {
    const needle = search.trim();
    if (!canManage || needle.length < 2) {
      setFound([]);
      return;
    }
    const controller = new AbortController();
    const query = new URLSearchParams({ search: needle, pageSize: "20" });
    const timer = setTimeout(() => {
      assetsApi
        .list(token, query, controller.signal)
        .then((response) => setFound(response.items))
        .catch(() => setFound([]));
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [canManage, search, token]);

  if (!canManage)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed az üzemeltetési napló sablonjaihoz"
        description="operations-log.templates.manage jogosultság szükséges."
      />
    );

  const change = (patch: Partial<Draft>) => {
    setSaved(false);
    setDraft((current) => ({ ...current, ...patch }));
  };
  const setField = (index: number, patch: Partial<DraftField>) =>
    change({
      fields: draft.fields.map((field, i) =>
        i === index ? { ...field, ...patch } : field,
      ),
    });
  const move = (index: number, by: -1 | 1) => {
    const next = [...draft.fields];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item!);
    change({ fields: next });
  };

  const errors = draftErrors(draft);
  const ready = errors.length === 0;

  const save = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const input = inputOf(draft, template?.updatedAt);
      const next = template
        ? await operationsLogApi.update(token, template.id, input)
        : await operationsLogApi.create(token, input);
      if (!template) {
        router.replace(`${OPERATIONS_TEMPLATES_PATH}/${next.id}`);
        return;
      }
      setTemplate(next);
      setDraft(draftOf(next));
      setSaved(true);
    } catch (cause) {
      setError(errorText(cause, "A sablon nem menthető."));
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (active: boolean) => {
    if (!template) return;
    setRetiring(false);
    setBusy(true);
    setError(null);
    try {
      if (active)
        setTemplate(
          await operationsLogApi.update(token, template.id, {
            ...inputOf(draft, template.updatedAt),
            isActive: true,
          }),
        );
      else {
        await operationsLogApi.retire(token, template.id);
        setTemplate(await operationsLogApi.get(token, template.id));
      }
    } catch (cause) {
      setError(
        errorText(
          cause,
          active
            ? "A sablon nem állítható vissza."
            : "A sablon nem vezethető ki.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const readOnly = template ? !template.isActive : false;

  return (
    <PilotThemeRoot theme="light" className="space-y-6">
      <PilotPageHeader
        eyebrow="Beállítások / Üzemeltetési napló"
        title={template ? `Sablon · ${template.name}` : "Új sablon"}
        description="A sablon mondja meg, mit kell rögzíteni egy üzemeltetési feladathoz. A mezők kód nélkül épülnek fel."
        actions={
          <div className="flex flex-wrap gap-2">
            <PilotButton
              variant="ghost"
              onClick={() => router.push(OPERATIONS_TEMPLATES_PATH)}
            >
              Vissza a sablonokhoz
            </PilotButton>
            {template ? (
              template.isActive ? (
                <PilotButton
                  variant="secondary"
                  size="regular"
                  disabled={busy}
                  onClick={() => setRetiring(true)}
                >
                  Kivezetés
                </PilotButton>
              ) : (
                <PilotButton
                  variant="secondary"
                  size="regular"
                  disabled={busy || !ready}
                  onClick={() => void setActive(true)}
                >
                  Visszaállítás
                </PilotButton>
              )
            ) : null}
            <PilotButton
              size="regular"
              disabled={!ready || busy || readOnly}
              onClick={() => void save()}
            >
              Sablon mentése
            </PilotButton>
          </div>
        }
      />

      {error ? (
        <Alert variant="danger" title="Hiba történt" description={error} />
      ) : null}
      {saved ? (
        <Alert variant="info" title="A sablon elmentve." description="" />
      ) : null}

      {!loaded ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <PilotCard>
            <PilotCardHeader title="Alapadatok" />
            <div className="flex flex-wrap items-end gap-6 p-5">
              <PilotFormField label="Sablon neve" required className="min-w-72">
                <PilotInput
                  aria-label="Sablon neve"
                  value={draft.name}
                  readOnly={readOnly}
                  maxLength={L.nameMax}
                  onChange={(name) => change({ name })}
                />
              </PilotFormField>
              <PilotFormField label="Gyakoriság" className="min-w-48">
                <PilotSelect
                  aria-label="Gyakoriság"
                  chevron
                  disabled={readOnly}
                  value={draft.frequency}
                  onChange={(value) =>
                    change({ frequency: value as OperationsTaskFrequency })
                  }
                >
                  {OPERATIONS_TASK_FREQUENCIES.map((frequency) => (
                    <option key={frequency} value={frequency}>
                      {OPERATIONS_FREQUENCY_LABELS[frequency]}
                    </option>
                  ))}
                </PilotSelect>
              </PilotFormField>
              <PilotFormField label="Leírás" className="min-w-72 flex-1">
                <PilotInput
                  aria-label="Leírás"
                  value={draft.description}
                  readOnly={readOnly}
                  maxLength={L.descriptionMax}
                  onChange={(description) => change({ description })}
                />
              </PilotFormField>
              {template ? (
                <PilotBadge variant={template.isActive ? "success" : "grey"}>
                  {template.isActive ? "Aktív" : "Kivezetett"}
                </PilotBadge>
              ) : null}
            </div>
          </PilotCard>

          <PilotCard>
            <PilotCardHeader title="Melyikre szól" />
            <div className="space-y-4 p-5">
              <PilotSegmentedControl
                options={TARGET_OPTIONS}
                value={
                  draft.targetKind === "ASSET" ? "Eszköz" : "Eszköz-kategória"
                }
                onChange={(value) =>
                  change({
                    targetKind: value === "Eszköz" ? "ASSET" : "CATEGORY",
                  })
                }
              />
              {draft.targetKind === "ASSET" ? (
                <div className="space-y-3">
                  <p className="text-sm text-pilot-grey-700">
                    {draft.assetId
                      ? `Kiválasztva: ${draft.assetText}`
                      : "Még nincs eszköz kiválasztva."}
                  </p>
                  {readOnly ? null : (
                    <>
                      <div className="w-full max-w-sm">
                        <PilotInput
                          aria-label="Eszköz keresése"
                          placeholder="Keresés számra vagy névre (legalább 2 karakter)…"
                          value={search}
                          onChange={setSearch}
                        />
                      </div>
                      {found.length ? (
                        <ul className="max-w-xl divide-y divide-pilot-grey-200 rounded-md ring-1 ring-pilot-grey-200">
                          {found.map((asset) => (
                            <li key={asset.id}>
                              <button
                                type="button"
                                className="block w-full px-3 py-2 text-left text-sm text-pilot-grey-800 hover:bg-pilot-grey-50"
                                onClick={() => {
                                  change({
                                    assetId: asset.id,
                                    assetText: `${asset.assetNumber} ${asset.name}`,
                                  });
                                  setSearch("");
                                  setFound([]);
                                }}
                              >
                                {asset.assetNumber} · {asset.name}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  )}
                </div>
              ) : (
                <PilotFormField label="Eszköz-kategória" className="max-w-sm">
                  <PilotSelect
                    aria-label="Eszköz-kategória"
                    chevron
                    disabled={readOnly}
                    value={draft.categoryId}
                    onChange={(categoryId) => change({ categoryId })}
                  >
                    <option value="">Válassz kategóriát…</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </PilotSelect>
                </PilotFormField>
              )}
            </div>
          </PilotCard>

          <PilotCard>
            <PilotCardHeader title="Mit kell rögzíteni" />
            <div className="space-y-4 p-5">
              {draft.fields.length === 0 ? (
                <p className="text-sm text-pilot-grey-600">
                  Még nincs mező. A „+ Mező hozzáadása” gombbal vehetsz fel
                  egyet (például a vízóra állását előtte és utána).
                </p>
              ) : (
                <ol className="space-y-3">
                  {draft.fields.map((field, index) => {
                    const label = field.label.trim() || `${index + 1}. mező`;
                    return (
                      <li
                        key={field.rowKey}
                        className="space-y-3 rounded-md bg-white p-4 ring-1 ring-pilot-grey-200"
                      >
                        <div className="flex flex-wrap items-end gap-4">
                          <PilotFormField
                            label="Címke"
                            className="min-w-60 flex-1"
                          >
                            <PilotInput
                              aria-label={`${label}: címke`}
                              value={field.label}
                              readOnly={readOnly}
                              maxLength={L.labelMax}
                              onChange={(value) =>
                                setField(index, { label: value })
                              }
                            />
                          </PilotFormField>
                          <PilotFormField label="Típus" className="w-40">
                            <PilotSelect
                              aria-label={`${label}: típus`}
                              chevron
                              disabled={readOnly}
                              value={field.type}
                              onChange={(value) =>
                                setField(index, {
                                  type: value as OperationsTaskFieldType,
                                })
                              }
                            >
                              {OPERATIONS_FIELD_TYPES.map((type) => (
                                <option key={type} value={type}>
                                  {OPERATIONS_FIELD_TYPE_LABELS[type]}
                                </option>
                              ))}
                            </PilotSelect>
                          </PilotFormField>
                          {field.type === "NUMBER" ? (
                            <>
                              <PilotFormField
                                label="Mértékegység"
                                className="w-32"
                              >
                                <PilotInput
                                  aria-label={`${label}: mértékegység`}
                                  value={field.unit}
                                  readOnly={readOnly}
                                  maxLength={L.unitMax}
                                  onChange={(value) =>
                                    setField(index, { unit: value })
                                  }
                                />
                              </PilotFormField>
                              <PilotFormField
                                label="Vízóra szerep"
                                className="w-52"
                              >
                                <PilotSelect
                                  aria-label={`${label}: vízóra szerep`}
                                  chevron
                                  disabled={readOnly}
                                  value={field.meterRole}
                                  onChange={(value) =>
                                    setField(index, {
                                      meterRole: value as
                                        OperationsMeterRole | "",
                                    })
                                  }
                                >
                                  <option value="">Nincs</option>
                                  {OPERATIONS_METER_ROLES.map((role) => (
                                    <option key={role} value={role}>
                                      {OPERATIONS_METER_ROLE_LABELS[role]}
                                    </option>
                                  ))}
                                </PilotSelect>
                              </PilotFormField>
                            </>
                          ) : null}
                          <label className="flex items-center gap-2 pb-2 text-sm text-pilot-grey-700">
                            <input
                              type="checkbox"
                              checked={field.required}
                              disabled={readOnly}
                              onChange={(event) =>
                                setField(index, {
                                  required: event.target.checked,
                                })
                              }
                            />
                            Kötelező
                          </label>
                        </div>
                        {readOnly ? null : (
                          <div className="flex gap-1">
                            <PilotButton
                              variant="ghost"
                              aria-label={`${label}: feljebb`}
                              disabled={index === 0}
                              onClick={() => move(index, -1)}
                            >
                              ↑
                            </PilotButton>
                            <PilotButton
                              variant="ghost"
                              aria-label={`${label}: lejjebb`}
                              disabled={index === draft.fields.length - 1}
                              onClick={() => move(index, 1)}
                            >
                              ↓
                            </PilotButton>
                            <PilotButton
                              variant="ghost"
                              aria-label={`${label}: eltávolítás`}
                              onClick={() =>
                                change({
                                  fields: draft.fields.filter(
                                    (_, i) => i !== index,
                                  ),
                                })
                              }
                            >
                              ×
                            </PilotButton>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
              {readOnly ? null : (
                <PilotButton
                  variant="secondary"
                  disabled={draft.fields.length >= L.fieldsMax}
                  onClick={() =>
                    change({ fields: [...draft.fields, emptyField()] })
                  }
                >
                  + Mező hozzáadása
                </PilotButton>
              )}
              {template?.retiredFields.length ? (
                <div className="space-y-2" data-testid="kivezetett-mezok">
                  <h3 className="text-sm font-semibold text-pilot-grey-800">
                    Kivezetett mezők
                  </h3>
                  <p className="text-xs text-pilot-grey-600">
                    A sablonból kimaradt mezők nem törlődnek: a rögzített
                    bejegyzések értékéhez a címkéjük megmarad, és a kulcsuk soha
                    nem kerül másik mezőhöz.
                  </p>
                  <ul className="space-y-1 text-sm text-pilot-grey-700">
                    {template.retiredFields.map((field) => (
                      <li key={field.id}>
                        {field.label} ·{" "}
                        {OPERATIONS_FIELD_TYPE_LABELS[field.type]}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {errors.length > 0 && (draft.name || draft.fields.length) ? (
                <ul
                  className="space-y-1 text-sm text-pilot-grey-700"
                  data-testid="sablon-hibak"
                >
                  {errors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </PilotCard>
        </>
      )}

      <ConfirmDialog
        open={retiring}
        title="Sablon kivezetése"
        consequence="A kivezetett sablon kiesik a rögzítés kínálatából. A mellé már rögzített bejegyzések nem változnak, a sablon olvasható marad."
        recovery="A sablon a Kivezetettek között megtalálható, és a Visszaállítás gombbal újra használhatóvá tehető."
        confirmLabel="Kivezetés"
        onConfirm={() => void setActive(false)}
        onCancel={() => setRetiring(false)}
      />
    </PilotThemeRoot>
  );
}
