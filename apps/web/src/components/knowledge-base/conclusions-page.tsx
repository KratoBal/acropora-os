"use client";

import {
  Alert,
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotPageHeader,
  Skeleton,
} from "@acropora/ui";
import { hasPermission, PERMISSIONS } from "@acropora/types";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { KNOWLEDGE_CONCLUSIONS_PATH } from "@/components/navigation";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import {
  knowledgeBaseApi,
  type ClaimStoreItem,
  type KnowledgeConclusion,
} from "@/lib/api/knowledge-base";
import { KnowledgeBaseTabs, KnowledgeLayerLegend } from "./knowledge-base-tabs";

/**
 * SZAKMAI KÖVETKEZTETÉSEK (Research & Knowledge Engine S5; Figma
 * K2d2lES872xzwQHCMVXtam 3:275, „05 · Következtetések”). A szerkesztő saját
 * következtetése, mindig VERIFIED állításokra építve; a tervezet módosítható,
 * a jóváhagyott nem (javítás: új következtetés, a régi visszavonva).
 *
 * A jog a szerveren dől el, a felület csak nem kínál olyat, amit a szerver
 * elutasítana: írás `knowledge.manage`, jóváhagyás és visszavonás
 * `knowledge.approve` (a pilotban Balázs). A terv jobb oldali paneljét, a
 * független modell bírálatát, ez a képernyő nem rajzolja: az az S7 része, és
 * egy üres helye hibának látszana.
 */

const STATUS_LABELS: Record<KnowledgeConclusion["status"], string> = {
  DRAFT: "Tervezet",
  APPROVED: "Jóváhagyva",
  WITHDRAWN: "Visszavonva",
};

const STATUS_VARIANTS = {
  DRAFT: "default",
  APPROVED: "success",
  WITHDRAWN: "amber",
} as const;

interface Draft {
  id: string | null;
  text: string;
  reasoning: string;
  claimIds: string[];
}

const EMPTY: Draft = { id: null, text: "", reasoning: "", claimIds: [] };

export function ConclusionsPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const can = (p: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) =>
    Boolean(session && hasPermission(session.user, p));
  const canView = can(PERMISSIONS.KNOWLEDGE_VIEW);
  const canManage = can(PERMISSIONS.KNOWLEDGE_MANAGE);
  const canApprove = can(PERMISSIONS.KNOWLEDGE_APPROVE);

  const [list, setList] = useState<KnowledgeConclusion[] | null>(null);
  const [claims, setClaims] = useState<ClaimStoreItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pick, setPick] = useState("");
  const [withdrawReason, setWithdrawReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (signal?: AbortSignal) => {
      if (!canView) return;
      setLoadError(null);
      Promise.all([
        knowledgeBaseApi.conclusions(token, signal),
        knowledgeBaseApi.claimStore(token, null, signal),
      ])
        .then(([conclusions, store]) => {
          setList(conclusions);
          setClaims(store.claims);
        })
        .catch((cause: unknown) => {
          if ((cause as Error)?.name === "AbortError") return;
          setLoadError((cause as Error)?.message ?? "Ismeretlen hiba.");
        });
    },
    [canView, token],
  );
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const titles = useMemo(
    () => new Map(claims.map((c) => [c.id, c.title])),
    [claims],
  );
  const current = list?.find((c) => c.id === selected) ?? null;

  /** One write; the answer replaces the row it came from. */
  const write = (
    run: () => Promise<KnowledgeConclusion>,
    after?: () => void,
  ) => {
    setBusy(true);
    setError(null);
    run()
      .then((saved) => {
        setList((rows) => [
          saved,
          ...(rows ?? []).filter((r) => r.id !== saved.id),
        ]);
        setSelected(saved.id);
        after?.();
      })
      .catch((cause: unknown) =>
        setError((cause as Error)?.message ?? "A mentés nem sikerült."),
      )
      .finally(() => setBusy(false));
  };

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

  const editing = draft !== null;
  const ready =
    draft !== null &&
    draft.text.trim() !== "" &&
    draft.reasoning.trim() !== "" &&
    draft.claimIds.length > 0;

  return (
    <PilotThemeRoot className="space-y-6">
      <PilotPageHeader
        eyebrow="Kutatási és szerkesztői modul"
        title="Szakmai következtetések"
        meta={<PilotBadge variant="amber">Stage · Pilot</PilotBadge>}
      />
      <KnowledgeBaseTabs active={KNOWLEDGE_CONCLUSIONS_PATH} />

      {loadError ? (
        <Alert
          variant="danger"
          title="A következtetések nem tölthetők be"
          description={loadError}
          action={
            <PilotButton
              variant="secondary"
              size="action"
              onClick={() => load()}
            >
              Újra
            </PilotButton>
          }
        />
      ) : null}
      {error ? (
        <Alert
          variant="danger"
          title="A művelet nem sikerült"
          description={error}
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
        <PilotCard className="space-y-3 p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-pilot-grey-900">
              Következtetések
            </h2>
            {canManage ? (
              <PilotButton
                variant="secondary"
                size="action"
                onClick={() => {
                  setSelected(null);
                  setDraft({ ...EMPTY });
                }}
              >
                Új következtetés
              </PilotButton>
            ) : null}
          </div>
          {list === null && !loadError ? (
            <div role="status" aria-label="Betöltés" className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : list?.length === 0 ? (
            <p className="text-sm text-pilot-grey-600">
              Még nincs következtetés. Egy következtetés ellenőrzött állításokra
              épül: az Állítás-tár tételeiből választhatsz.
            </p>
          ) : (
            <ul className="space-y-2">
              {list?.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    aria-current={c.id === selected ? "true" : undefined}
                    className={`w-full rounded-lg border p-3 text-left text-sm ${
                      c.id === selected
                        ? "border-pilot-grey-900"
                        : "border-pilot-grey-200"
                    }`}
                    onClick={() => {
                      setSelected(c.id);
                      setDraft(null);
                      setWithdrawReason("");
                    }}
                  >
                    <span className="line-clamp-2 text-pilot-grey-900">
                      {c.text}
                    </span>
                    <span className="mt-1 flex items-center gap-2">
                      <PilotBadge variant={STATUS_VARIANTS[c.status]}>
                        {STATUS_LABELS[c.status]}
                      </PilotBadge>
                      <span className="text-xs text-pilot-grey-500">
                        {c.claims.length} állítás
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </PilotCard>

        <PilotCard className="space-y-4 p-5">
          <h2 className="text-lg font-semibold text-pilot-grey-900">
            Saját szakmai következtetés
          </h2>
          {editing ? (
            <div className="space-y-3">
              <label className="block space-y-1 text-sm">
                <span className="font-semibold text-pilot-grey-800">
                  Következtetés
                </span>
                <textarea
                  className="w-full rounded-lg border border-pilot-grey-300 p-2"
                  rows={3}
                  value={draft.text}
                  onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="font-semibold text-pilot-grey-800">
                  Indoklás és korlátok
                </span>
                <textarea
                  className="w-full rounded-lg border border-pilot-grey-300 bg-pilot-grey-50 p-2"
                  rows={5}
                  value={draft.reasoning}
                  onChange={(e) =>
                    setDraft({ ...draft, reasoning: e.target.value })
                  }
                />
              </label>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Állítás beszúrása"
                    className="rounded-lg border border-pilot-grey-300 px-2 py-1 text-sm"
                    value={pick}
                    onChange={(e) => setPick(e.target.value)}
                  >
                    <option value="">+ Állítás beszúrása</option>
                    {claims
                      .filter((c) => !draft.claimIds.includes(c.id))
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                  </select>
                  <PilotButton
                    variant="secondary"
                    size="action"
                    disabled={!pick}
                    onClick={() => {
                      setDraft({
                        ...draft,
                        claimIds: [...draft.claimIds, pick],
                      });
                      setPick("");
                    }}
                  >
                    Hozzáad
                  </PilotButton>
                  <PilotBadge variant="blue">
                    {draft.claimIds.length} hivatkozott állítás
                  </PilotBadge>
                </div>
                <ul className="space-y-1 text-sm">
                  {draft.claimIds.map((id) => (
                    <li key={id} className="flex items-center gap-2">
                      <span>{titles.get(id) ?? id}</span>
                      <button
                        type="button"
                        className="text-xs text-pilot-grey-600 underline"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            claimIds: draft.claimIds.filter((c) => c !== id),
                          })
                        }
                      >
                        Kivesz
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-wrap gap-2">
                <PilotButton
                  size="action"
                  disabled={busy || !ready}
                  onClick={() => {
                    const input = {
                      text: draft.text.trim(),
                      reasoning: draft.reasoning.trim(),
                      claimIds: draft.claimIds,
                    };
                    write(
                      () =>
                        draft.id
                          ? knowledgeBaseApi.updateConclusion(
                              token,
                              draft.id,
                              input,
                            )
                          : knowledgeBaseApi.createConclusion(token, input),
                      () => setDraft(null),
                    );
                  }}
                >
                  Tervezet mentése
                </PilotButton>
                <PilotButton
                  variant="secondary"
                  size="action"
                  onClick={() => setDraft(null)}
                >
                  Mégse
                </PilotButton>
              </div>
            </div>
          ) : current ? (
            <div className="space-y-3">
              <p className="text-[15px] text-pilot-grey-900">{current.text}</p>
              <div className="rounded-lg bg-pilot-grey-50 p-3 text-sm text-pilot-grey-800">
                {current.reasoning}
              </div>
              <div className="space-y-1">
                <PilotBadge variant="blue">
                  {current.claims.length} hivatkozott állítás
                </PilotBadge>
                <ul className="space-y-1 text-sm">
                  {current.claims.map((c) => (
                    <li key={c.id}>
                      {titles.get(c.id) ?? c.id}
                      {c.status === "VERIFIED"
                        ? ""
                        : ` (már nem VERIFIED: ${c.status})`}
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-sm">
                <PilotBadge variant={STATUS_VARIANTS[current.status]}>
                  {STATUS_LABELS[current.status]}
                </PilotBadge>
                {current.withdrawnReason
                  ? ` Ok: ${current.withdrawnReason}`
                  : ""}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {current.status === "DRAFT" && canManage ? (
                  <PilotButton
                    variant="secondary"
                    size="action"
                    onClick={() =>
                      setDraft({
                        id: current.id,
                        text: current.text,
                        reasoning: current.reasoning,
                        claimIds: current.claims.map((c) => c.id),
                      })
                    }
                  >
                    Szerkesztés
                  </PilotButton>
                ) : null}
                {current.status === "DRAFT" && canApprove ? (
                  <PilotButton
                    size="action"
                    disabled={busy}
                    onClick={() =>
                      write(() =>
                        knowledgeBaseApi.approveConclusion(token, current.id),
                      )
                    }
                  >
                    Jóváhagyás
                  </PilotButton>
                ) : null}
                {current.status === "DRAFT" && !canApprove ? (
                  <span className="text-sm text-pilot-grey-600">
                    A jóváhagyás knowledge.approve joggal megy (a pilotban
                    Balázs).
                  </span>
                ) : null}
              </div>
              {current.status !== "WITHDRAWN" && canApprove ? (
                <div className="flex flex-wrap items-center gap-2 border-t border-pilot-grey-200 pt-3">
                  <input
                    aria-label="A visszavonás oka"
                    className="min-w-64 flex-1 rounded-lg border border-pilot-grey-300 px-2 py-1 text-sm"
                    value={withdrawReason}
                    onChange={(e) => setWithdrawReason(e.target.value)}
                  />
                  <PilotButton
                    variant="secondary"
                    size="action"
                    disabled={busy || !withdrawReason.trim()}
                    onClick={() =>
                      write(
                        () =>
                          knowledgeBaseApi.withdrawConclusion(
                            token,
                            current.id,
                            withdrawReason.trim(),
                          ),
                        () => setWithdrawReason(""),
                      )
                    }
                  >
                    Visszavonás
                  </PilotButton>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-pilot-grey-600">
              Válassz egy következtetést a listából
              {canManage ? ", vagy kezdj újat" : ""}.
            </p>
          )}
        </PilotCard>
      </div>
      <KnowledgeLayerLegend />
    </PilotThemeRoot>
  );
}
