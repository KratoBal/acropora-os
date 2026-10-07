"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  FormField,
  Input,
  PageHeader,
  Select,
  Skeleton,
} from "@acropora/ui";
import { RichTextEditor } from "@acropora/ui/rich-text-editor";
import {
  EMPTY_QUOTE_RICH_TEXT,
  hasPermission,
  PERMISSIONS,
  type QuoteMilestoneInput,
  type QuoteSnippetDto,
  type QuoteSnippetKindValue,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { quotesApi } from "@/lib/api/quotes";

import { errorText, isAbort } from "./quote-format";

export const SNIPPET_KIND_LABEL: Record<QuoteSnippetKindValue, string> = {
  INTRO: "Bevezető",
  TEXT: "Szöveg",
  DELIVERY: "Szállítás",
  WARRANTY: "Garancia",
  PAYMENT: "Fizetési feltétel",
};
const KINDS = Object.keys(SNIPPET_KIND_LABEL) as QuoteSnippetKindValue[];
const EMPTY = JSON.stringify(EMPTY_QUOTE_RICH_TEXT);

interface Draft {
  id: string | null;
  name: string;
  kind: QuoteSnippetKindValue;
  content: string;
  milestones: QuoteMilestoneInput[];
}
const NEW: Draft = {
  id: null,
  name: "",
  kind: "TEXT",
  content: EMPTY,
  milestones: [],
};

/**
 * AZ AJÁNLATI SZÖVEGRÉSZLETEK (#1582 P1). A Figma 35-ben nincs saját kerete,
 * ezért a Beállítások többi listalapjának mintáját követi. A beszúrt részlet
 * az ajánlatban MÁSOLAT: itt egy szerkesztés vagy archiválás a már megírt
 * ajánlatokat nem érinti. Törlés nincs, csak archiválás.
 */
export function QuoteSnippetsPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.QUOTES_TEMPLATES_MANAGE),
  );
  const [items, setItems] = useState<QuoteSnippetDto[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [draft, setDraft] = useState<Draft>(NEW);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState<QuoteSnippetDto | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canManage) return;
      setError(null);
      try {
        setItems(await quotesApi.snippets(token, showArchived, signal));
      } catch (cause) {
        if (!isAbort(cause))
          setError(errorText(cause, "A szövegrészletek nem tölthetők be."));
      }
    },
    [canManage, showArchived, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const edit = (snippet: QuoteSnippetDto) =>
    setDraft({
      id: snippet.id,
      name: snippet.name,
      kind: snippet.kind,
      content: JSON.stringify(snippet.content ?? EMPTY_QUOTE_RICH_TEXT),
      milestones: snippet.milestones ?? [],
    });

  const save = async () => {
    setSaving(true);
    setFormError(null);
    try {
      const content = JSON.parse(draft.content) as unknown;
      const milestones = draft.kind === "PAYMENT" ? draft.milestones : null;
      if (draft.id)
        await quotesApi.updateSnippet(token, draft.id, {
          name: draft.name,
          content,
          ...(draft.kind === "PAYMENT" ? { milestones } : {}),
        });
      else
        await quotesApi.createSnippet(token, {
          name: draft.name,
          kind: draft.kind,
          content,
          ...(milestones ? { milestones } : {}),
        });
      setDraft(NEW);
      await load();
    } catch (cause) {
      setFormError(errorText(cause, "A mentés nem sikerült."));
    } finally {
      setSaving(false);
    }
  };

  const archive = async (snippet: QuoteSnippetDto) => {
    setArchiving(null);
    try {
      await quotesApi.archiveSnippet(token, snippet.id);
      if (draft.id === snippet.id) setDraft(NEW);
      await load();
    } catch (cause) {
      setError(errorText(cause, "Az archiválás nem sikerült."));
    }
  };

  const setMilestone = (
    index: number,
    key: "label" | "percent",
    value: string,
  ) =>
    setDraft({
      ...draft,
      milestones: draft.milestones.map((m, i) =>
        i === index ? { ...m, [key]: value } : m,
      ),
    });

  if (!canManage)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed az ajánlati szövegrészletekhez"
        description="quotes.templates.manage jogosultság szükséges."
      />
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ajánlat szövegrészletek"
        description="Újrahasznosítható ajánlati szövegek. Beszúráskor az ajánlatba másolat kerül: egy későbbi szerkesztés vagy archiválás a már megírt ajánlatot nem változtatja."
      />

      {error ? (
        <Alert variant="danger" title="Hiba történt" description={error} />
      ) : null}

      <Card>
        <CardHeader>
          <span className="font-semibold text-dusk-900">
            {draft.id ? "Szövegrészlet szerkesztése" : "Új szövegrészlet"}
          </span>
        </CardHeader>
        <CardContent className="space-y-4">
          {formError ? (
            <Alert
              variant="danger"
              title="Nem menthető"
              description={formError}
            />
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Név" htmlFor="snippet-name">
              <Input
                id="snippet-name"
                aria-label="Név"
                value={draft.name}
                maxLength={120}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
              />
            </FormField>
            <FormField
              label="Fajta"
              htmlFor="snippet-kind"
              description={
                draft.id ? "A fajta utólag nem írható át." : undefined
              }
            >
              <Select
                id="snippet-kind"
                aria-label="Fajta"
                value={draft.kind}
                disabled={draft.id !== null}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    kind: event.target.value as QuoteSnippetKindValue,
                  })
                }
              >
                {KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {SNIPPET_KIND_LABEL[kind]}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <FormField label="Szöveg">
            <RichTextEditor
              mode="quote"
              aria-label="Szövegrészlet szövege"
              value={draft.content}
              onChange={(content) => setDraft({ ...draft, content })}
            />
          </FormField>
          {draft.kind === "PAYMENT" ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-dusk-900">
                Mérföldkövek (összesen 100%)
              </p>
              {draft.milestones.map((m, index) => (
                <div key={index} className="flex flex-wrap gap-2">
                  <Input
                    aria-label={`${index + 1}. mérföldkő neve`}
                    value={m.label}
                    onChange={(event) =>
                      setMilestone(index, "label", event.target.value)
                    }
                  />
                  <Input
                    aria-label={`${index + 1}. mérföldkő százaléka`}
                    inputMode="decimal"
                    value={m.percent}
                    onChange={(event) =>
                      setMilestone(index, "percent", event.target.value)
                    }
                  />
                  <Button
                    variant="ghost"
                    aria-label={`${index + 1}. mérföldkő törlése`}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        milestones: draft.milestones.filter(
                          (_, i) => i !== index,
                        ),
                      })
                    }
                  >
                    ×
                  </Button>
                </div>
              ))}
              <Button
                variant="secondary"
                onClick={() =>
                  setDraft({
                    ...draft,
                    milestones: [
                      ...draft.milestones,
                      { label: "", percent: "" },
                    ],
                  })
                }
              >
                + Mérföldkő
              </Button>
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button
              disabled={saving || !draft.name.trim()}
              onClick={() => void save()}
            >
              Mentés
            </Button>
            {draft.id ? (
              <Button variant="secondary" onClick={() => setDraft(NEW)}>
                Mégse
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold text-dusk-900">Szövegrészletek</span>
            <label className="flex items-center gap-2 text-sm text-dusk-600">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(event) => setShowArchived(event.target.checked)}
              />
              Archiváltak is
            </label>
          </div>
        </CardHeader>
        <CardContent>
          {items === null ? (
            <Skeleton className="h-32 w-full" />
          ) : items.length === 0 ? (
            <EmptyState
              title="Még nincs szövegrészlet"
              description="A fenti űrlappal vehetsz fel újat."
            />
          ) : (
            <ul
              aria-label="Szövegrészletek"
              className="divide-y divide-dusk-100"
            >
              {items.map((snippet) => (
                <li
                  key={snippet.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-dusk-900">
                      {snippet.name}
                    </span>
                    <Badge variant="info">
                      {SNIPPET_KIND_LABEL[snippet.kind]}
                    </Badge>
                    {snippet.archivedAt ? <Badge>Archivált</Badge> : null}
                  </div>
                  {snippet.archivedAt ? null : (
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={`${snippet.name}: szerkesztés`}
                        onClick={() => edit(snippet)}
                      >
                        Szerkesztés
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`${snippet.name}: archiválás`}
                        onClick={() => setArchiving(snippet)}
                      >
                        Archiválás
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={archiving !== null}
        title="Szövegrészlet archiválása"
        consequence="Az archivált szövegrészlet többé nem szúrható be új ajánlatba. A már megírt ajánlatokban álló másolat nem változik."
        recovery="Visszaállítás most nincs: ha újra kell, vedd fel újként."
        confirmLabel="Archiválás"
        onConfirm={() => archiving && void archive(archiving)}
        onCancel={() => setArchiving(null)}
      />
    </div>
  );
}
