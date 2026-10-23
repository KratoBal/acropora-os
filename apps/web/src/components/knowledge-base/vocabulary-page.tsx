"use client";

import {
  Alert,
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotInput,
  PilotPageHeader,
  PilotSelect,
  Skeleton,
} from "@acropora/ui";
import { hasPermission, PERMISSIONS } from "@acropora/types";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { KNOWLEDGE_VOCABULARY_PATH } from "@/components/navigation";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import {
  knowledgeBaseApi,
  type VocabularyEntry,
  type VocabularyProbe,
  type VocabularyState,
} from "@/lib/api/knowledge-base";
import { KnowledgeBaseTabs, KnowledgeLayerLegend } from "./knowledge-base-tabs";

/**
 * SZAKMAI SZÓTÁRAK (Research & Knowledge Engine S5, a K4 kezelése; Figma
 * K2d2lES872xzwQHCMVXtam 3:425). A gépi ellenőrzés csak a JÓVÁHAGYOTT
 * változatot olvassa; minden szerkesztés a következő változat tervezetébe
 * megy, és a tervezet csak egészében, a jóváhagyó gombjával lesz jóváhagyott
 * (Balázsé, `knowledge.approve`; acrobot 35807, 35810).
 *
 * Bal oldalt a taxonok fája (csoport, nemzetség, faj) és a többi szótár
 * listája, jobb oldalt a kijelölt elem: a felismert alakjai, a helye a fában,
 * és egy próbamező, ami megmutatja, mit ismer fel a gép egy mondatból. Új
 * kulcs fajnak és hatásnak vehető fel (a többi lista kulcsai zártak, csak az
 * alakjaik bővíthetők). Áthúzás helyett a szülő választóval állítható.
 */
export const KIND_LABELS: Record<string, string> = {
  TAXON: "Taxonómia",
  EFFECT: "Hatás",
  ENVIRONMENT: "Környezet",
  DIRECTION_VERB: "Irány",
  NEGATION: "Tagadás",
  CERTAINTY: "Bizonyosság",
  SCOPE_PHRASE: "Általánosító fordulat",
  UNSUPPORTED_CONSTRUCTION: "Nem kezelt szerkezet",
  UNIT: "Egység",
};

const RANK_LABELS: Record<string, string> = {
  GROUP: "Csoport",
  GENUS: "Nemzetség",
  SPECIES: "Faj",
};

const CHANGE_LABELS: Record<string, string> = {
  ADDED: "új",
  CHANGED: "módosult",
  REMOVED: "kikerült",
};

/** The editor writes forms separated by ";" or line breaks (a form may hold a comma). */
export const formsOfText = (text: string) =>
  text
    .split(/[;\n]/)
    .map((f) => f.trim())
    .filter(Boolean);

/** The parent chain of a taxon, as the editor reads it: "Kőkorall → SPS → Acropora". */
export function parentChain(
  entries: readonly VocabularyEntry[],
  entry: VocabularyEntry,
): string {
  const chain: string[] = [];
  const seen = new Set<string>();
  for (
    let p = entry.parentKey;
    p !== null && !seen.has(p);
    p =
      entries.find((e) => e.kind === "TAXON" && e.key === p)?.parentKey ?? null
  ) {
    seen.add(p);
    chain.unshift(
      entries.find((e) => e.kind === "TAXON" && e.key === p)?.label ?? p,
    );
  }
  return chain.join(" → ");
}

/** The taxa in tree order, each with its depth. */
export function taxonTree(
  entries: readonly VocabularyEntry[],
): { entry: VocabularyEntry; depth: number }[] {
  const taxa = entries.filter((e) => e.kind === "TAXON");
  const out: { entry: VocabularyEntry; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const t of taxa
      .filter((x) => x.parentKey === parent)
      .sort((a, b) => a.label.localeCompare(b.label, "hu"))) {
      out.push({ entry: t, depth });
      if (depth < 8) walk(t.key, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function VocabularyPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.KNOWLEDGE_VIEW),
  );
  const canEdit = Boolean(
    session && hasPermission(session.user, PERMISSIONS.KNOWLEDGE_MANAGE),
  );
  const canApprove = Boolean(
    session && hasPermission(session.user, PERMISSIONS.KNOWLEDGE_APPROVE),
  );

  const [state, setState] = useState<VocabularyState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState("TAXON");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [formsText, setFormsText] = useState("");
  const [parentKey, setParentKey] = useState("");
  const [adding, setAdding] = useState(false);
  const [newForms, setNewForms] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newRank, setNewRank] = useState("SPECIES");
  const [newParent, setNewParent] = useState("");
  const [sentence, setSentence] = useState("");
  const [probe, setProbe] = useState<VocabularyProbe | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setError(null);
      try {
        setState(await knowledgeBaseApi.vocabulary(token, signal));
      } catch (caught) {
        if ((caught as Error)?.name === "AbortError") return;
        setError((caught as Error)?.message ?? "Ismeretlen hiba.");
      }
    },
    [canView, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const entries = useMemo(() => state?.entries ?? [], [state]);
  const ofKind = useMemo(
    () =>
      kind === "TAXON"
        ? taxonTree(entries)
        : entries
            .filter((e) => e.kind === kind)
            .map((entry) => ({ entry, depth: 0 })),
    [entries, kind],
  );
  const selected =
    entries.find((e) => e.kind === kind && e.key === selectedKey) ?? null;
  const taxa = entries.filter((e) => e.kind === "TAXON");

  useEffect(() => {
    setFormsText(selected ? selected.forms.join("; ") : "");
    setParentKey(selected?.parentKey ?? "");
    setWriteError(null);
  }, [selected]);

  const write = async (run: () => Promise<VocabularyState>) => {
    setBusy(true);
    setWriteError(null);
    try {
      setState(await run());
      return true;
    } catch (caught) {
      setWriteError((caught as Error)?.message ?? "Ismeretlen hiba.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveSelected = () => {
    if (!selected) return;
    const forms = formsOfText(formsText);
    const edit: { forms?: string[]; parentKey?: string | null } = {};
    if (forms.join("\u0000") !== selected.forms.join("\u0000"))
      edit.forms = forms;
    if (selected.kind === "TAXON" && parentKey !== (selected.parentKey ?? ""))
      edit.parentKey = parentKey || null;
    if (Object.keys(edit).length === 0) return;
    void write(() =>
      knowledgeBaseApi.editVocabularyEntry(
        token,
        selected.kind,
        selected.key,
        edit,
      ),
    );
  };

  const addNew = async () => {
    const forms = formsOfText(newForms);
    if (!forms.length) return;
    const ok = await write(() =>
      knowledgeBaseApi.addVocabularyEntry(token, {
        kind: kind === "TAXON" ? "TAXON" : "EFFECT",
        forms,
        ...(newKey.trim() ? { key: newKey.trim() } : {}),
        ...(kind === "TAXON"
          ? {
              rank: newRank as "GROUP" | "GENUS" | "SPECIES",
              ...(newParent ? { parentKey: newParent } : {}),
            }
          : {}),
      }),
    );
    if (ok) {
      setAdding(false);
      setNewForms("");
      setNewKey("");
      setNewParent("");
    }
  };

  const runProbe = async () => {
    if (!sentence.trim()) return;
    setWriteError(null);
    try {
      setProbe(
        await knowledgeBaseApi.probeVocabulary(
          token,
          sentence.trim(),
          state?.draft ? "DRAFT" : "APPROVED",
        ),
      );
    } catch (caught) {
      setWriteError((caught as Error)?.message ?? "Ismeretlen hiba.");
    }
  };

  const labelOf = (k: string, key: string) =>
    entries.find((e) => e.kind === k && e.key === key)?.label ?? key;

  if (!canView)
    return (
      <PilotThemeRoot className="space-y-6">
        <Alert
          variant="danger"
          title="Nincs jogosultság"
          description="A Tudásbázishoz knowledge.view jog kell."
        />
      </PilotThemeRoot>
    );

  const addable = kind === "TAXON" || kind === "EFFECT";
  const recognised = probe
    ? [
        ...probe.parts.taxa.map((k) => `${labelOf("TAXON", k)} felismerve`),
        ...probe.parts.effects.map((k) => `Hatás: ${labelOf("EFFECT", k)}`),
        ...probe.parts.environments.map(
          (k) => `Környezet: ${labelOf("ENVIRONMENT", k)}`,
        ),
        ...probe.parts.certainty.map(
          (k) => `Bizonyosság: ${labelOf("CERTAINTY", k)}`,
        ),
        ...probe.parts.quantities.map((q) => `Mennyiség: ${q.text}`),
        ...(probe.parts.negation === "NEGATED" ? ["Tagadó mondat"] : []),
      ]
    : [];

  return (
    <PilotThemeRoot className="space-y-6">
      <PilotPageHeader
        eyebrow="Kutatási és szerkesztői modul"
        title="Szakmai szótárak"
        meta={<PilotBadge variant="amber">Stage · Pilot</PilotBadge>}
      />
      <KnowledgeBaseTabs active={KNOWLEDGE_VOCABULARY_PATH} />

      {error ? (
        <Alert
          variant="danger"
          title="A szótár nem tölthető be"
          description={error}
          action={
            <PilotButton
              variant="secondary"
              size="action"
              onClick={() => void load()}
            >
              Újra
            </PilotButton>
          }
        />
      ) : state === null ? (
        <div role="status" aria-label="Betöltés" className="space-y-4">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : (
        <>
          <p className="text-sm text-pilot-grey-600" aria-label="Változat">
            Jóváhagyott változat: {state.approved.version}.
            {state.approved.origin === "CODE"
              ? " (a kezdő tervezet, a tesztrendszer alapja)"
              : state.approved.approvedBy
                ? ` Jóváhagyta: ${state.approved.approvedBy}.`
                : ""}
            {state.draft
              ? ` Szerkesztés alatt: ${state.draft.version}. változat, ${state.draft.changes.length} változással. A gép a jóváhagyásig a(z) ${state.approved.version}. változatot használja.`
              : ""}
          </p>

          <div className="flex flex-wrap gap-1.5" role="tablist">
            {Object.entries(KIND_LABELS).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kind === k}
                onClick={() => {
                  setKind(k);
                  setSelectedKey(null);
                  setAdding(false);
                }}
                className={`min-h-10 rounded-md px-3 text-sm ring-1 ${
                  kind === k
                    ? "bg-pilot-grey-900 text-white ring-pilot-grey-900"
                    : "bg-white text-pilot-grey-800 ring-pilot-grey-200 hover:bg-pilot-grey-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <PilotCard>
              <PilotCardHeader
                title={
                  kind === "TAXON" ? "Taxonómia · fa-nézet" : KIND_LABELS[kind]!
                }
                action={
                  canEdit && addable ? (
                    <PilotButton
                      variant="secondary"
                      size="action"
                      onClick={() => {
                        setAdding(true);
                        setSelectedKey(null);
                      }}
                    >
                      Új elem
                    </PilotButton>
                  ) : undefined
                }
              />
              <ul aria-label="Szótár elemei" className="space-y-0.5 p-3">
                {ofKind.map(({ entry, depth }) => (
                  <li key={entry.key}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedKey(entry.key);
                        setAdding(false);
                      }}
                      aria-pressed={entry.key === selectedKey}
                      style={{ paddingLeft: `${0.75 + depth * 1}rem` }}
                      className={`min-h-10 w-full rounded-md pr-3 text-left ${
                        entry.key === selectedKey
                          ? "font-semibold text-pilot-accent-warm"
                          : "text-pilot-grey-900 hover:bg-pilot-grey-50"
                      }`}
                    >
                      {entry.label}
                      {state.draft?.changes.some(
                        (c) => c.kind === entry.kind && c.key === entry.key,
                      ) ? (
                        <span className="ml-2 text-xs font-normal text-pilot-grey-500">
                          tervezet
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </PilotCard>

            <PilotCard>
              <PilotCardHeader
                title={
                  adding ? "Új elem a szótárba" : "Szótár elemének szerkesztése"
                }
              />
              <div className="space-y-4 p-5">
                {adding ? (
                  <>
                    <label className="block space-y-1 text-sm text-pilot-grey-700">
                      <span>Felismert alakok (pontosvesszővel)</span>
                      <PilotInput
                        aria-label="Új elem alakjai"
                        value={newForms}
                        onChange={setNewForms}
                        placeholder={
                          kind === "TAXON"
                            ? "pocillopora verrucosa"
                            : "mikrobiom-összetétel"
                        }
                      />
                    </label>
                    <label className="block space-y-1 text-sm text-pilot-grey-700">
                      <span>Kulcs (üresen az első alakból)</span>
                      <PilotInput
                        aria-label="Új elem kulcsa"
                        value={newKey}
                        onChange={setNewKey}
                      />
                    </label>
                    {kind === "TAXON" ? (
                      <div className="flex flex-wrap gap-3">
                        <label className="space-y-1 text-sm text-pilot-grey-700">
                          <span>Szint</span>
                          <PilotSelect
                            aria-label="Új elem szintje"
                            value={newRank}
                            onChange={setNewRank}
                          >
                            {Object.entries(RANK_LABELS).map(([k, l]) => (
                              <option key={k} value={k}>
                                {l}
                              </option>
                            ))}
                          </PilotSelect>
                        </label>
                        <label className="min-w-48 flex-1 space-y-1 text-sm text-pilot-grey-700">
                          <span>Szülő</span>
                          <PilotSelect
                            aria-label="Új elem szülője"
                            value={newParent}
                            onChange={setNewParent}
                          >
                            <option value="">nincs</option>
                            {taxa.map((t) => (
                              <option key={t.key} value={t.key}>
                                {t.label}
                              </option>
                            ))}
                          </PilotSelect>
                        </label>
                      </div>
                    ) : null}
                    <div className="flex gap-2">
                      <PilotButton
                        size="action"
                        disabled={busy || !formsOfText(newForms).length}
                        onClick={() => void addNew()}
                      >
                        Felvétel a tervezetbe
                      </PilotButton>
                      <PilotButton
                        variant="ghost"
                        size="action"
                        onClick={() => setAdding(false)}
                      >
                        Mégse
                      </PilotButton>
                    </div>
                  </>
                ) : selected ? (
                  <>
                    <div className="space-y-1 text-sm text-pilot-grey-700">
                      <span>Elfogadott név</span>
                      <p
                        aria-label="Elfogadott név"
                        className="rounded-md bg-pilot-grey-50 px-3 py-2 text-pilot-grey-900"
                      >
                        {selected.label}
                        <span className="ml-2 text-xs text-pilot-grey-500">
                          {selected.key}
                        </span>
                      </p>
                    </div>
                    <label className="block space-y-1 text-sm text-pilot-grey-700">
                      <span>Felismert alakok (pontosvesszővel)</span>
                      <PilotInput
                        aria-label="Felismert alakok"
                        value={formsText}
                        onChange={setFormsText}
                        readOnly={!canEdit}
                      />
                    </label>
                    {selected.kind === "TAXON" ? (
                      <label className="block space-y-1 text-sm text-pilot-grey-700">
                        <span>
                          Kategória
                          {selected.rank
                            ? ` · ${RANK_LABELS[selected.rank] ?? selected.rank}`
                            : ""}
                        </span>
                        {canEdit ? (
                          <PilotSelect
                            aria-label="Kategória"
                            value={parentKey}
                            onChange={setParentKey}
                          >
                            <option value="">nincs (legfelső csoport)</option>
                            {taxa
                              .filter((t) => t.key !== selected.key)
                              .map((t) => (
                                <option key={t.key} value={t.key}>
                                  {t.label}
                                </option>
                              ))}
                          </PilotSelect>
                        ) : (
                          <p className="rounded-md bg-pilot-grey-50 px-3 py-2">
                            {parentChain(entries, selected) || "nincs"}
                          </p>
                        )}
                        {canEdit ? (
                          <p className="text-xs text-pilot-grey-500">
                            {parentChain(entries, selected)}
                          </p>
                        ) : null}
                      </label>
                    ) : null}
                    {selected.note ? (
                      <p className="text-sm text-pilot-grey-600">
                        {selected.note}
                      </p>
                    ) : null}
                    {canEdit ? (
                      <PilotButton
                        size="action"
                        disabled={busy}
                        onClick={saveSelected}
                      >
                        Mentés a tervezetbe
                      </PilotButton>
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm text-pilot-grey-600">
                    Válassz egy elemet a listából.
                  </p>
                )}

                {writeError ? (
                  <Alert
                    variant="danger"
                    title="A szótár nem módosult"
                    description={writeError}
                  />
                ) : null}

                <div className="space-y-2 border-t border-pilot-grey-100 pt-4">
                  <p className="text-sm font-semibold text-pilot-grey-900">
                    Próbamondat felismerése
                  </p>
                  <PilotInput
                    aria-label="Próbamondat"
                    value={sentence}
                    onChange={setSentence}
                    placeholder="Az Acropora muricata korallok növekedése…"
                  />
                  <PilotButton
                    variant="secondary"
                    size="action"
                    disabled={!sentence.trim()}
                    onClick={() => void runProbe()}
                  >
                    Felismerés
                  </PilotButton>
                  {probe ? (
                    <div
                      aria-label="Felismert részek"
                      className="flex flex-wrap gap-1.5"
                    >
                      <span className="text-xs text-pilot-grey-500">
                        {probe.version}. változat szerint:
                      </span>
                      {recognised.length ? (
                        recognised.map((r) => (
                          <PilotBadge key={r} variant="success">
                            {r}
                          </PilotBadge>
                        ))
                      ) : (
                        <PilotBadge variant="grey">
                          Semmit nem ismert fel
                        </PilotBadge>
                      )}
                    </div>
                  ) : null}
                </div>

                {state.draft && state.draft.changes.length ? (
                  <div className="space-y-2 border-t border-pilot-grey-100 pt-4">
                    <p className="text-sm font-semibold text-pilot-grey-900">
                      A tervezet változásai ({state.approved.version}. →{" "}
                      {state.draft.version}. változat)
                    </p>
                    <ul aria-label="Változások" className="space-y-1 text-sm">
                      {state.draft.changes.map((c) => (
                        <li key={`${c.kind}/${c.key}`}>
                          {KIND_LABELS[c.kind] ?? c.kind}:{" "}
                          {labelOf(c.kind, c.key)} ({CHANGE_LABELS[c.change]})
                        </li>
                      ))}
                    </ul>
                    {canApprove ? (
                      <div className="flex justify-end">
                        <PilotButton
                          size="action"
                          disabled={busy}
                          onClick={() =>
                            void write(() =>
                              knowledgeBaseApi.approveVocabulary(
                                token,
                                state.draft!.version,
                                state.draft!.fingerprint,
                              ),
                            )
                          }
                        >
                          Szótárváltozat jóváhagyása
                        </PilotButton>
                      </div>
                    ) : (
                      <p className="text-xs text-pilot-grey-500">
                        A változat jóváhagyása a szerkesztőé (Balázs).
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            </PilotCard>
          </div>
        </>
      )}
      <KnowledgeLayerLegend />
    </PilotThemeRoot>
  );
}
