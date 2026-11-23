"use client";

import {
  analyzeTeachingSource,
  buildTeachingNarration,
  buildTeachingSlides,
  formatNumber,
  hasPermission,
  parseTeachingSourceInput,
  PERMISSIONS,
  TEACHING_OUTPUT_KINDS,
  type ContentDetail,
  type TeachingAudience,
  type TeachingNumber,
  type TeachingNumberState,
  type TeachingOutputKind,
  type TeachingOutputSummary,
  type TeachingPart,
  type TeachingSourceDetail,
  type TeachingSourceInput,
} from "@acropora/types";
import {
  Alert,
  PageHeader,
  PilotBadge,
  PilotButton,
  PilotFormField,
  PilotInput,
  PilotSelect,
  Skeleton,
  Textarea,
} from "@acropora/ui";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { contentApi } from "@/lib/api/content";

import { CONTENT_STATE_LABELS } from "./content-labels";
import { TeachingOutputEdits } from "./teaching-output-edits";
import {
  parseTeachingInflections,
  parseTeachingPairs,
  parseTeachingValue,
  suggestTeachingKey,
  teachingInflectionsText,
  teachingPairsText,
  teachingValueText,
} from "./teaching-source-form";

/**
 * AZ OKTATÓANYAG FORRÁSA (T5.2, 3. szelet; spec: exchange/otletek-2026-11-03/
 * t5-2-egy-forras-tobb-kimenet-spec-v2.md, 4. pont). Egy lapon a részek, az
 * alrészek, a számtábla, a dia-jegyzetek, és ami a kettőből következik: hol
 * szerepel egy szám, mi a nyitott kérdés, mi lóg ki a dia-keretből. Az elemzés
 * a böngészőben fut, ugyanazzal a tiszta függvénnyel, amivel a szerver ment.
 *
 * Saját Figma nincs (a FIGMA-MAP Tartalom sora „nincs"), a lap a cikk
 * szerkesztőjének mintáját követi. A jóváhagyás nem itt van, hanem a tétel
 * útján (Tartalom lista); a kimenetek a jóváhagyott forrásból készülnek.
 */

const AUDIENCE_LABELS: Record<TeachingAudience, string> = {
  INTERNAL: "Belső",
  PUBLIC: "Nyilvános",
};

const KIND_LABELS: Record<TeachingOutputKind, string> = {
  PRINTABLE: "Nyomtatható szöveg (PDF)",
  SLIDES: "Diasor (PPTX)",
  NARRATION: "Narráció (szöveg)",
};

const STATE_LABELS: Record<TeachingNumberState, string> = {
  OK: "Rendben",
  OPEN_QUESTION: "Nyitott kérdés",
};

/** A számsor a szerkesztőben: az érték, a párok és a ragos alakok szövegként. */
interface NumberRow extends Omit<
  TeachingNumber,
  "quantity" | "pairs" | "inflections"
> {
  valueText: string;
  unit: string;
  pairsText: string;
  inflectionsText: string;
}

interface FormState {
  subtitle: string;
  author: string;
  editor: string;
  audience: TeachingAudience;
  publicBasis: string;
  disclaimer: string;
  parts: TeachingPart[];
  numbers: NumberRow[];
}

function formFrom(source: TeachingSourceDetail | null): FormState {
  return {
    subtitle: source?.subtitle ?? "",
    author: source?.author ?? "",
    editor: source?.editor ?? "",
    audience: source?.audience ?? "INTERNAL",
    publicBasis: source?.publicBasis ?? "",
    disclaimer: source?.disclaimer ?? "",
    parts: source?.parts ?? [],
    numbers: (source?.numbers ?? []).map((n) => {
      const { quantity, pairs, inflections, ...rest } = n;
      return {
        ...rest,
        valueText: teachingValueText(quantity.value),
        unit: quantity.unit,
        pairsText: teachingPairsText(pairs),
        inflectionsText: teachingInflectionsText(inflections),
      };
    }),
  };
}

/** A szerkesztő állapota a mentés alakjában, vagy az első mező, ami nem áll össze. */
export function teachingInputFrom(
  form: FormState,
  baseVersion: number | null,
): { ok: true; value: TeachingSourceInput } | { ok: false; message: string } {
  const numbers: TeachingNumber[] = [];
  for (const row of form.numbers) {
    const value = parseTeachingValue(row.valueText);
    if (!value)
      return {
        ok: false,
        message: `${row.id || row.name}: az érték egy szám vagy egy tartomány (pl. 50, 1,026, 2-4).`,
      };
    const pairs = parseTeachingPairs(row.pairsText);
    if (!pairs)
      return {
        ok: false,
        message: `${row.id}: a párok alakja „35 PSU; 2-3 ppt”.`,
      };
    const inflections = parseTeachingInflections(row.inflectionsText);
    if (!inflections)
      return {
        ok: false,
        message: `${row.id}: a ragos alak soronként „hétig = 4 hétig | négy hétig”.`,
      };
    numbers.push({
      id: row.id,
      name: row.name,
      context: row.context,
      approx: row.approx,
      quantity: { value, unit: row.unit.trim() },
      pairs,
      partKey: row.partKey,
      display: row.display,
      short: row.short,
      spoken: row.spoken,
      inflections,
      state: row.state,
      note: row.note,
    });
  }
  const parsed = parseTeachingSourceInput({
    baseVersion,
    subtitle: form.subtitle,
    author: form.author,
    editor: form.editor,
    audience: form.audience,
    publicBasis: form.publicBasis,
    disclaimer: form.disclaimer,
    parts: form.parts,
    numbers,
  });
  return parsed.ok ? parsed : { ok: false, message: parsed.message };
}

const emptyPart = (index: number): TeachingPart => ({
  key: `resz-${index + 1}`,
  title: `${index + 1}. rész`,
  text: "",
  subparts: [],
  checklist: [],
  speakerNote: null,
});

const emptyNumber = (index: number): NumberRow => ({
  id: `szam-${index + 1}`,
  name: "",
  context: null,
  approx: false,
  valueText: "",
  unit: "",
  pairsText: "",
  partKey: null,
  display: "",
  short: "",
  spoken: null,
  inflectionsText: "",
  state: "OK",
  note: null,
});

const LOCATION_FIELD = {
  text: "szöveg",
  checklist: "ellenőrzőlista",
  speakerNote: "dia-jegyzet",
} as const;

export function TeachingSourcePage({ contentId }: { contentId: string }) {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.CONTENT_MANAGE),
  );

  const [item, setItem] = useState<ContentDetail | null>(null);
  const [source, setSource] = useState<TeachingSourceDetail | null>(null);
  const [editable, setEditable] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [outputs, setOutputs] = useState<TeachingOutputSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [outputError, setOutputError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sending, setSending] = useState<{
    id: string;
    to: string;
    public: boolean;
  } | null>(null);

  const loadOutputs = useCallback(
    (signal?: AbortSignal) =>
      contentApi
        .teachingOutputs(token, contentId, signal)
        .then(setOutputs)
        .catch(() => setOutputs([])),
    [token, contentId],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    Promise.all([
      contentApi.detail(token, contentId, controller.signal),
      contentApi.teachingSource(token, contentId, controller.signal),
    ])
      .then(([detail, data]) => {
        setItem(detail);
        setSource(data.source);
        setEditable(data.editable);
        setForm(formFrom(data.source));
        setDirty(false);
        if (data.source) void loadOutputs(controller.signal);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setLoadError(
          cause instanceof Error ? cause.message : "A forrás nem tölthető be.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [contentId, token, loadOutputs]);

  const input = useMemo(
    () => (form ? teachingInputFrom(form, source?.version ?? null) : null),
    [form, source],
  );
  const analysis = useMemo(
    () => (input?.ok ? analyzeTeachingSource(input.value) : null),
    [input],
  );
  const preview = useMemo(() => {
    if (!input?.ok || !item) return null;
    const outputSource = {
      ...input.value,
      title: item.title,
      version: source?.version ?? 0,
    };
    const open = new Set(analysis?.openQuestions.map((q) => q.numberId));
    return {
      slides: buildTeachingSlides(outputSource, "", open),
      narration: buildTeachingNarration(outputSource, "", open),
    };
  }, [input, item, source, analysis]);

  if (loading) return <Skeleton className="h-64" />;
  if (loadError)
    return (
      <Alert
        variant="danger"
        title="A forrás nem tölthető be"
        description={loadError}
      />
    );
  if (!item || !form) return null;
  if (item.channel !== "TEACHING_SOURCE")
    return (
      <Alert
        variant="info"
        title="Ez a tétel nem oktatóanyag"
        description="Forrás csak az Oktatóanyag csatornájú tételhez tartozik."
      />
    );

  const locked = !editable || !canManage;
  const readOnly = locked || saving;
  const update = (patch: Partial<FormState>) => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
    setSaved(false);
  };
  const updatePart = (index: number, patch: Partial<TeachingPart>) =>
    update({
      parts: form.parts.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    });
  const updateNumber = (index: number, patch: Partial<NumberRow>) =>
    update({
      numbers: form.numbers.map((n, i) =>
        i === index ? { ...n, ...patch } : n,
      ),
    });
  const usages = new Map(
    (analysis?.usages ?? []).map((u) => [u.numberId, u.locations]),
  );
  const openIds = new Set(analysis?.openQuestions.map((q) => q.numberId));
  const partTitle = new Map(form.parts.map((p) => [p.key, p.title]));

  const save = async () => {
    setSaveError(null);
    setSaved(false);
    if (!input || !input.ok) {
      setSaveError(input?.message ?? "A forrás nem áll össze.");
      return;
    }
    if (analysis?.problems.length) {
      setSaveError(analysis.problems.map((p) => p.message).join(" "));
      return;
    }
    setSaving(true);
    try {
      const data = await contentApi.saveTeachingSource(
        token,
        contentId,
        input.value,
      );
      setSource(data.source);
      setEditable(data.editable);
      setForm(formFrom(data.source));
      setDirty(false);
      setSaved(true);
      void loadOutputs();
    } catch (cause) {
      setSaveError(
        cause instanceof Error ? cause.message : "A mentés nem sikerült.",
      );
    } finally {
      setSaving(false);
    }
  };

  const approvedNow =
    item.state === "READY_TO_SEND" && source?.approvedVersion != null;
  const generate = async (kind: TeachingOutputKind) => {
    setOutputError(null);
    setBusy(kind);
    try {
      await contentApi.generateTeachingOutput(token, contentId, kind);
      await loadOutputs();
    } catch (cause) {
      setOutputError(
        cause instanceof Error ? cause.message : "A generálás nem sikerült.",
      );
    } finally {
      setBusy(null);
    }
  };
  const download = async (outputId: string) => {
    setOutputError(null);
    setBusy(outputId);
    try {
      await contentApi.downloadTeachingOutput(token, contentId, outputId);
    } catch (cause) {
      setOutputError(
        cause instanceof Error ? cause.message : "A letöltés nem sikerült.",
      );
    } finally {
      setBusy(null);
    }
  };
  const markSent = async () => {
    if (!sending) return;
    setOutputError(null);
    setBusy(sending.id);
    try {
      await contentApi.markTeachingOutputSent(token, contentId, sending.id, {
        to: sending.to,
        public: sending.public,
      });
      setSending(null);
      await loadOutputs();
    } catch (cause) {
      setOutputError(
        cause instanceof Error ? cause.message : "A rögzítés nem sikerült.",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/tartalom" className="text-xs text-pilot-grey-600">
          ← Tartalom
        </Link>
        <PageHeader
          title={item.title}
          description={`Oktatóanyag · ${CONTENT_STATE_LABELS[item.state]}${
            source ? ` · ${source.version}. verzió` : " · még nincs mentve"
          }${
            source?.approvedVersion != null
              ? ` · jóváhagyva: ${source.approvedVersion}. verzió`
              : ""
          }`}
          actions={
            canManage && editable ? (
              <div className="flex items-center gap-3">
                {saved ? (
                  <span className="text-sm text-pilot-grey-600">Mentve</span>
                ) : dirty ? (
                  <span className="text-sm text-pilot-grey-600">
                    Nem mentett változás
                  </span>
                ) : null}
                <PilotButton
                  onClick={() => void save()}
                  disabled={saving || !dirty}
                >
                  {saving ? "Mentés…" : "Mentés"}
                </PilotButton>
              </div>
            ) : undefined
          }
        />
      </div>

      {!editable ? (
        <Alert
          variant="info"
          title="A forrás most nem szerkeszthető"
          description="A jóváhagyásra küldött vagy jóváhagyott forrás nem változhat észrevétlenül. Módosításhoz előbb vissza kell küldeni javításra a Tartalom listán."
        />
      ) : !canManage ? (
        <Alert
          variant="info"
          title="Csak olvasható"
          description="A forrás szerkesztéséhez tartalomkezelési jog kell."
        />
      ) : null}

      {saveError ? (
        <Alert
          variant="danger"
          title="A mentés nem ment át"
          description={saveError}
        />
      ) : null}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <PilotFormField label="Alcím" htmlFor="ts-subtitle">
          <PilotInput
            id="ts-subtitle"
            value={form.subtitle}
            disabled={readOnly}
            onChange={(value) => update({ subtitle: value })}
          />
        </PilotFormField>
        <PilotFormField
          label="Szerző és forrás"
          htmlFor="ts-author"
          help="Pl. Akil, Modern Reef blog, 2026. 10. 15."
        >
          <PilotInput
            id="ts-author"
            value={form.author}
            disabled={readOnly}
            onChange={(value) => update({ author: value })}
          />
        </PilotFormField>
        <PilotFormField label="Fordító, szerkesztő" htmlFor="ts-editor">
          <PilotInput
            id="ts-editor"
            value={form.editor}
            disabled={readOnly}
            onChange={(value) => update({ editor: value })}
          />
        </PilotFormField>
        <PilotFormField
          label="Felhasználási kör"
          htmlFor="ts-audience"
          help="Idegen szerzőjű anyag belső, amíg a szerző vagy a jogtulajdonos nem engedi."
        >
          <PilotSelect
            id="ts-audience"
            value={form.audience}
            disabled={readOnly}
            onChange={(value) =>
              update({ audience: value as TeachingAudience })
            }
          >
            <option value="INTERNAL">{AUDIENCE_LABELS.INTERNAL}</option>
            <option value="PUBLIC">{AUDIENCE_LABELS.PUBLIC}</option>
          </PilotSelect>
        </PilotFormField>
        {form.audience === "PUBLIC" ? (
          <PilotFormField
            label="Mi engedi a nyilvánosságot"
            htmlFor="ts-public-basis"
          >
            <PilotInput
              id="ts-public-basis"
              value={form.publicBasis}
              disabled={readOnly}
              onChange={(value) => update({ publicBasis: value })}
            />
          </PilotFormField>
        ) : null}
        <PilotFormField
          label="Forrás-szintű kitétel"
          htmlFor="ts-disclaimer"
          help="Az egész anyagra érvényes; a PDF címoldalán, a diasor első diáján és a narráció nyitásában áll."
        >
          <Textarea
            id="ts-disclaimer"
            rows={2}
            value={form.disclaimer}
            disabled={readOnly}
            onChange={(event) => update({ disclaimer: event.target.value })}
          />
        </PilotFormField>
      </section>

      <section className="space-y-4" aria-labelledby="ts-parts-title">
        <h2 id="ts-parts-title" className="text-lg font-semibold">
          Részek
        </h2>
        <p className="text-sm text-pilot-grey-600">
          A szám a szövegben hivatkozásként áll: {"{szám: azonosító}"} vagy{" "}
          {"{szám: azonosító, rövid}"} (alakok: megjelenítési, rövid, kimondott,
          vagy egy ragos alak neve).
        </p>
        {form.parts.map((part, index) => (
          <fieldset
            key={index}
            className="space-y-3 rounded-lg border border-pilot-grey-200 p-4"
          >
            <legend className="px-1 text-sm font-semibold">
              {index + 1}. rész
            </legend>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[12rem_minmax(0,1fr)]">
              <PilotFormField
                label="Azonosító"
                htmlFor={`ts-part-${index}-key`}
              >
                <PilotInput
                  id={`ts-part-${index}-key`}
                  value={part.key}
                  disabled={readOnly}
                  onChange={(value) => updatePart(index, { key: value })}
                />
              </PilotFormField>
              <PilotFormField label="Cím" htmlFor={`ts-part-${index}-title`}>
                <PilotInput
                  id={`ts-part-${index}-title`}
                  value={part.title}
                  disabled={readOnly}
                  onChange={(value) => updatePart(index, { title: value })}
                />
              </PilotFormField>
            </div>
            <PilotFormField label="Szöveg" htmlFor={`ts-part-${index}-text`}>
              <Textarea
                id={`ts-part-${index}-text`}
                rows={6}
                value={part.text}
                disabled={readOnly}
                onChange={(event) =>
                  updatePart(index, { text: event.target.value })
                }
              />
            </PilotFormField>
            {part.subparts.map((sub, si) => (
              <div
                key={si}
                className="space-y-2 border-l-2 border-pilot-grey-200 pl-3"
              >
                <div className="grid grid-cols-1 gap-3 md:grid-cols-[12rem_minmax(0,1fr)]">
                  <PilotFormField
                    label="Alrész azonosító"
                    htmlFor={`ts-part-${index}-sub-${si}-key`}
                  >
                    <PilotInput
                      id={`ts-part-${index}-sub-${si}-key`}
                      value={sub.key}
                      disabled={readOnly}
                      onChange={(value) =>
                        updatePart(index, {
                          subparts: part.subparts.map((s, i) =>
                            i === si ? { ...s, key: value } : s,
                          ),
                        })
                      }
                    />
                  </PilotFormField>
                  <PilotFormField
                    label="Alrész címe"
                    htmlFor={`ts-part-${index}-sub-${si}-title`}
                  >
                    <PilotInput
                      id={`ts-part-${index}-sub-${si}-title`}
                      value={sub.title}
                      disabled={readOnly}
                      onChange={(value) =>
                        updatePart(index, {
                          subparts: part.subparts.map((s, i) =>
                            i === si ? { ...s, title: value } : s,
                          ),
                        })
                      }
                    />
                  </PilotFormField>
                </div>
                <PilotFormField
                  label="Alrész szövege"
                  htmlFor={`ts-part-${index}-sub-${si}-text`}
                >
                  <Textarea
                    id={`ts-part-${index}-sub-${si}-text`}
                    rows={4}
                    value={sub.text}
                    disabled={readOnly}
                    onChange={(event) =>
                      updatePart(index, {
                        subparts: part.subparts.map((s, i) =>
                          i === si ? { ...s, text: event.target.value } : s,
                        ),
                      })
                    }
                  />
                </PilotFormField>
                {!readOnly ? (
                  <PilotButton
                    variant="ghost"
                    size="regular"
                    onClick={() =>
                      updatePart(index, {
                        subparts: part.subparts.filter((_, i) => i !== si),
                      })
                    }
                  >
                    Alrész törlése
                  </PilotButton>
                ) : null}
              </div>
            ))}
            <PilotFormField
              label="Ellenőrzőlista (soronként egy pont)"
              htmlFor={`ts-part-${index}-checklist`}
            >
              <Textarea
                id={`ts-part-${index}-checklist`}
                rows={3}
                value={part.checklist.join("\n")}
                disabled={readOnly}
                onChange={(event) =>
                  updatePart(index, {
                    checklist: event.target.value
                      .split("\n")
                      .filter((line) => line.trim()),
                  })
                }
              />
            </PilotFormField>
            <PilotFormField
              label="Dia-jegyzet (élőbeszéd, ebből lesz a narráció)"
              htmlFor={`ts-part-${index}-note`}
              help={
                part.speakerNote?.state === "SUGGESTED"
                  ? "Javaslat: amíg a szerkesztő el nem fogadja, nem készül belőle narráció."
                  : undefined
              }
            >
              <Textarea
                id={`ts-part-${index}-note`}
                rows={3}
                value={part.speakerNote?.text ?? ""}
                disabled={readOnly}
                onChange={(event) =>
                  updatePart(index, {
                    speakerNote: event.target.value.trim()
                      ? {
                          text: event.target.value,
                          state: part.speakerNote?.state ?? "SOURCE",
                        }
                      : null,
                  })
                }
              />
            </PilotFormField>
            {!readOnly ? (
              <div className="flex flex-wrap gap-2">
                {part.speakerNote?.state === "SUGGESTED" ? (
                  <PilotButton
                    variant="secondary"
                    size="regular"
                    onClick={() =>
                      updatePart(index, {
                        speakerNote: part.speakerNote
                          ? { ...part.speakerNote, state: "SOURCE" }
                          : null,
                      })
                    }
                  >
                    Jegyzet elfogadása
                  </PilotButton>
                ) : null}
                <PilotButton
                  variant="secondary"
                  size="regular"
                  onClick={() =>
                    updatePart(index, {
                      subparts: [
                        ...part.subparts,
                        {
                          key: `${part.key}-${part.subparts.length + 1}`,
                          title: `${part.subparts.length + 1}. lépés`,
                          text: "",
                        },
                      ],
                    })
                  }
                >
                  Alrész hozzáadása
                </PilotButton>
                <PilotButton
                  variant="ghost"
                  size="regular"
                  onClick={() =>
                    update({ parts: form.parts.filter((_, i) => i !== index) })
                  }
                >
                  Rész törlése
                </PilotButton>
              </div>
            ) : null}
          </fieldset>
        ))}
        {!readOnly ? (
          <PilotButton
            variant="secondary"
            onClick={() =>
              update({ parts: [...form.parts, emptyPart(form.parts.length)] })
            }
          >
            Rész hozzáadása
          </PilotButton>
        ) : null}
      </section>

      <section className="space-y-4" aria-labelledby="ts-numbers-title">
        <h2 id="ts-numbers-title" className="text-lg font-semibold">
          Számtábla
        </h2>
        {form.numbers.map((row, index) => {
          const where = usages.get(row.id) ?? [];
          return (
            <fieldset
              key={index}
              className="space-y-3 rounded-lg border border-pilot-grey-200 p-4"
            >
              <legend className="flex items-center gap-2 px-1 text-sm font-semibold">
                {row.name || row.id}
                {openIds.has(row.id) ? (
                  <PilotBadge variant="amber">nyitott kérdés</PilotBadge>
                ) : null}
              </legend>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <PilotFormField label="Név" htmlFor={`ts-num-${index}-name`}>
                  <PilotInput
                    id={`ts-num-${index}-name`}
                    value={row.name}
                    disabled={readOnly}
                    onChange={(value) =>
                      updateNumber(index, {
                        name: value,
                        ...(row.id === `szam-${index + 1}` && value
                          ? { id: suggestTeachingKey(value) }
                          : {}),
                      })
                    }
                  />
                </PilotFormField>
                <PilotFormField
                  label="Azonosító"
                  htmlFor={`ts-num-${index}-id`}
                >
                  <PilotInput
                    id={`ts-num-${index}-id`}
                    value={row.id}
                    disabled={readOnly}
                    onChange={(value) => updateNumber(index, { id: value })}
                  />
                </PilotFormField>
                <PilotFormField
                  label="Környezet"
                  htmlFor={`ts-num-${index}-context`}
                  help="Mikor vagy mire érvényes; két érték egy névvel csak így különbözik."
                >
                  <PilotInput
                    id={`ts-num-${index}-context`}
                    value={row.context ?? ""}
                    disabled={readOnly}
                    onChange={(value) =>
                      updateNumber(index, { context: value || null })
                    }
                  />
                </PilotFormField>
                <PilotFormField
                  label="Érték (szám vagy tartomány)"
                  htmlFor={`ts-num-${index}-value`}
                >
                  <PilotInput
                    id={`ts-num-${index}-value`}
                    value={row.valueText}
                    disabled={readOnly}
                    onChange={(value) =>
                      updateNumber(index, { valueText: value })
                    }
                  />
                </PilotFormField>
                <PilotFormField
                  label="Mértékegység"
                  htmlFor={`ts-num-${index}-unit`}
                >
                  <PilotInput
                    id={`ts-num-${index}-unit`}
                    value={row.unit}
                    disabled={readOnly}
                    onChange={(value) => updateNumber(index, { unit: value })}
                  />
                </PilotFormField>
                <PilotFormField
                  label="Párok más egységben"
                  htmlFor={`ts-num-${index}-pairs`}
                  help="Pl. 35 PSU; több pár pontosvesszővel."
                >
                  <PilotInput
                    id={`ts-num-${index}-pairs`}
                    value={row.pairsText}
                    disabled={readOnly}
                    onChange={(value) =>
                      updateNumber(index, { pairsText: value })
                    }
                  />
                </PilotFormField>
                <PilotFormField
                  label="Megjelenítési alak"
                  htmlFor={`ts-num-${index}-display`}
                >
                  <PilotInput
                    id={`ts-num-${index}-display`}
                    value={row.display}
                    disabled={readOnly}
                    onChange={(value) =>
                      updateNumber(index, { display: value })
                    }
                  />
                </PilotFormField>
                <PilotFormField
                  label="Rövid alak"
                  htmlFor={`ts-num-${index}-short`}
                >
                  <PilotInput
                    id={`ts-num-${index}-short`}
                    value={row.short}
                    disabled={readOnly}
                    onChange={(value) => updateNumber(index, { short: value })}
                  />
                </PilotFormField>
                <PilotFormField
                  label="Kimondott alak"
                  htmlFor={`ts-num-${index}-spoken`}
                  help="A szerző vagy a szerkesztő adja meg; nélküle nem készül narráció."
                >
                  <PilotInput
                    id={`ts-num-${index}-spoken`}
                    value={row.spoken ?? ""}
                    disabled={readOnly}
                    onChange={(value) =>
                      updateNumber(index, { spoken: value || null })
                    }
                  />
                </PilotFormField>
                <PilotFormField
                  label="Hatókör"
                  htmlFor={`ts-num-${index}-scope`}
                >
                  <PilotSelect
                    id={`ts-num-${index}-scope`}
                    value={row.partKey ?? ""}
                    disabled={readOnly}
                    onChange={(value) =>
                      updateNumber(index, { partKey: value || null })
                    }
                  >
                    <option value="">Globális</option>
                    {form.parts.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.title}
                      </option>
                    ))}
                  </PilotSelect>
                </PilotFormField>
                <PilotFormField
                  label="Állapot"
                  htmlFor={`ts-num-${index}-state`}
                >
                  <PilotSelect
                    id={`ts-num-${index}-state`}
                    value={row.state}
                    disabled={readOnly}
                    onChange={(value) =>
                      updateNumber(index, {
                        state: value as TeachingNumberState,
                      })
                    }
                  >
                    <option value="OK">{STATE_LABELS.OK}</option>
                    <option value="OPEN_QUESTION">
                      {STATE_LABELS.OPEN_QUESTION}
                    </option>
                  </PilotSelect>
                </PilotFormField>
                <PilotFormField
                  label="Megjegyzés"
                  htmlFor={`ts-num-${index}-note`}
                >
                  <PilotInput
                    id={`ts-num-${index}-note`}
                    value={row.note ?? ""}
                    disabled={readOnly}
                    onChange={(value) =>
                      updateNumber(index, { note: value || null })
                    }
                  />
                </PilotFormField>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={row.approx}
                  disabled={readOnly}
                  onChange={(event) =>
                    updateNumber(index, { approx: event.target.checked })
                  }
                />
                Közelítő érték (kb.)
              </label>
              <PilotFormField
                label="Ragos alakok (soronként: név = írott | kimondott)"
                htmlFor={`ts-num-${index}-inflections`}
              >
                <Textarea
                  id={`ts-num-${index}-inflections`}
                  rows={2}
                  value={row.inflectionsText}
                  disabled={readOnly}
                  onChange={(event) =>
                    updateNumber(index, {
                      inflectionsText: event.target.value,
                    })
                  }
                />
              </PilotFormField>
              <p className="text-sm text-pilot-grey-600">
                Hol szerepel:{" "}
                {where.length
                  ? where
                      .map(
                        (l) =>
                          `${partTitle.get(l.partKey) ?? l.partKey}${
                            l.subpartKey ? ` / ${l.subpartKey}` : ""
                          } (${LOCATION_FIELD[l.field]}${
                            l.index !== null ? ` ${l.index + 1}.` : ""
                          })`,
                      )
                      .join(", ")
                  : "sehol"}
              </p>
              {!readOnly ? (
                <PilotButton
                  variant="ghost"
                  size="regular"
                  onClick={() =>
                    update({
                      numbers: form.numbers.filter((_, i) => i !== index),
                    })
                  }
                >
                  Szám törlése
                </PilotButton>
              ) : null}
            </fieldset>
          );
        })}
        {!readOnly ? (
          <PilotButton
            variant="secondary"
            onClick={() =>
              update({
                numbers: [...form.numbers, emptyNumber(form.numbers.length)],
              })
            }
          >
            Szám hozzáadása
          </PilotButton>
        ) : null}
      </section>

      <section className="space-y-3" aria-labelledby="ts-check-title">
        <h2 id="ts-check-title" className="text-lg font-semibold">
          Ellenőrzés
        </h2>
        {input && !input.ok ? (
          <Alert
            variant="danger"
            title="A forrás így nem menthető"
            description={input.message}
          />
        ) : null}
        {analysis?.problems.length ? (
          <Alert
            variant="danger"
            title="Hibás szám-hivatkozás"
            description={analysis.problems.map((p) => p.message).join(" ")}
          />
        ) : null}
        {analysis?.openQuestions.length ? (
          <Alert
            variant="info"
            title="Nyitott kérdés: a forrás így nem hagyható jóvá"
            description={analysis.openQuestions
              .map((q) =>
                q.conflictsWith.length
                  ? `${q.numberId} ellentmond ennek: ${q.conflictsWith.join(", ")}`
                  : `${q.numberId}${q.note ? `: ${q.note}` : ""}`,
              )
              .join("; ")}
          />
        ) : null}
        {analysis?.typedNumbers.length ? (
          <Alert
            variant="info"
            title="Beírt szám a szövegben"
            description={`Ezek nem hivatkozással állnak: ${analysis.typedNumbers
              .map((t) => `„${t.excerpt}”`)
              .join(", ")}`}
          />
        ) : null}
        {analysis?.unused.length ? (
          <p className="text-sm text-pilot-grey-600">
            Szöveg nem hivatkozik rájuk: {analysis.unused.join(", ")}
          </p>
        ) : null}
        {preview ? (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>
              Diasor: {preview.slides.slides.length} dia
              {preview.slides.overFrame.length
                ? `, keret felett: ${preview.slides.overFrame
                    .map(
                      (o) =>
                        `${partTitle.get(o.partKey) ?? o.partKey}${
                          o.subpartKey ? ` / ${o.subpartKey}` : ""
                        } (${o.slides} dia, legfeljebb ${o.limit})`,
                    )
                    .join(", ")}`
                : ", minden rész a keretben"}
            </li>
            {preview.slides.tableOverflow?.length ? (
              <li>
                Táblázat nem fér a diára (becslés, 9 pontos betűvel is):{" "}
                {preview.slides.tableOverflow
                  .map(
                    (o) =>
                      `${o.slide}. dia, kb. ${formatNumber(o.over * 2.54, 1)} cm túllóg`,
                  )
                  .join("; ")}
              </li>
            ) : null}
            <li>
              Narráció:{" "}
              {preview.narration.chapters.filter((c) => c.text !== null).length}
              /{preview.narration.chapters.length} fejezet készül
            </li>
          </ul>
        ) : null}
      </section>

      {source ? (
        <section className="space-y-3" aria-labelledby="ts-outputs-title">
          <h2 id="ts-outputs-title" className="text-lg font-semibold">
            Kimenetek
          </h2>
          {outputError ? (
            <Alert
              variant="danger"
              title="A kimenet művelete nem sikerült"
              description={outputError}
            />
          ) : null}
          {canManage ? (
            approvedNow ? (
              <div className="flex flex-wrap gap-2">
                {TEACHING_OUTPUT_KINDS.map((kind) => (
                  <PilotButton
                    key={kind}
                    variant="secondary"
                    disabled={busy !== null}
                    onClick={() => void generate(kind)}
                  >
                    {busy === kind
                      ? "Generálás…"
                      : `${KIND_LABELS[kind]} generálása`}
                  </PilotButton>
                ))}
              </div>
            ) : (
              <p className="text-sm text-pilot-grey-600">
                Kimenet a jóváhagyott forrásból készül; a jóváhagyás a Tartalom
                listán, a tétel útján történik.
              </p>
            )
          ) : null}
          {outputs.length ? (
            <ul className="divide-y divide-pilot-grey-200 rounded-lg border border-pilot-grey-200">
              {outputs.map((output) => (
                <li key={output.id} className="space-y-2 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {KIND_LABELS[output.kind]}
                    </span>
                    <span className="text-pilot-grey-600">
                      {output.sourceVersion}. verzió
                    </span>
                    {output.stale ? (
                      <PilotBadge variant="amber">elavult</PilotBadge>
                    ) : (
                      <PilotBadge variant="success">naprakész</PilotBadge>
                    )}
                    {output.overFrame ? (
                      <PilotBadge variant="amber">keret felett</PilotBadge>
                    ) : null}
                    {output.tableOverflow ? (
                      <PilotBadge variant="amber">táblázat nem fér</PilotBadge>
                    ) : null}
                    {output.chaptersWithoutNarration ? (
                      <PilotBadge variant="grey">
                        {output.chaptersWithoutNarration} fejezet narráció
                        nélkül
                      </PilotBadge>
                    ) : null}
                    {output.sent ? (
                      <PilotBadge variant="teal">
                        kiment: {output.sent.to}
                      </PilotBadge>
                    ) : null}
                    {output.edits ? (
                      <PilotBadge variant="amber">
                        eltér a forrástól
                        {output.undecidedEdits
                          ? `, ${output.undecidedEdits} döntésre vár`
                          : ""}
                      </PilotBadge>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <PilotButton
                      variant="ghost"
                      size="regular"
                      disabled={busy !== null}
                      onClick={() => void download(output.id)}
                    >
                      Letöltés
                    </PilotButton>
                    {canManage &&
                    !output.sent &&
                    !output.stale &&
                    output.approved ? (
                      <PilotButton
                        variant="ghost"
                        size="regular"
                        disabled={busy !== null}
                        onClick={() =>
                          setSending({ id: output.id, to: "", public: false })
                        }
                      >
                        Kiment rögzítése
                      </PilotButton>
                    ) : null}
                  </div>
                  <TeachingOutputEdits
                    token={token}
                    contentId={contentId}
                    outputId={output.id}
                    kind={output.kind}
                    canManage={canManage}
                    onChanged={() => void loadOutputs()}
                  />
                  {sending?.id === output.id ? (
                    <div className="space-y-2">
                      <PilotFormField
                        label="Hová ment"
                        htmlFor={`ts-sent-${output.id}`}
                      >
                        <PilotInput
                          id={`ts-sent-${output.id}`}
                          value={sending.to}
                          onChange={(value) =>
                            setSending({ ...sending, to: value })
                          }
                        />
                      </PilotFormField>
                      {source.audience === "PUBLIC" ? (
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={sending.public}
                            onChange={(event) =>
                              setSending({
                                ...sending,
                                public: event.target.checked,
                              })
                            }
                          />
                          Nyilvános csatorna (hírlevél, közösségi poszt,
                          termékoldal)
                        </label>
                      ) : (
                        <p className="text-pilot-grey-600">
                          Belső forrás: kimenete csak belső helyre mehet.
                        </p>
                      )}
                      <div className="flex gap-2">
                        <PilotButton
                          size="regular"
                          disabled={!sending.to.trim() || busy !== null}
                          onClick={() => void markSent()}
                        >
                          Rögzítés
                        </PilotButton>
                        <PilotButton
                          variant="ghost"
                          size="regular"
                          onClick={() => setSending(null)}
                        >
                          Mégse
                        </PilotButton>
                      </div>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-pilot-grey-600">
              Még nem készült kimenet.
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}
