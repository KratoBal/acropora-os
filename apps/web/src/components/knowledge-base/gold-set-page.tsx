"use client";

import {
  Alert,
  ConfirmDialog,
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotPageHeader,
  Skeleton,
} from "@acropora/ui";
import { hasPermission, PERMISSIONS } from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  KNOWLEDGE_CLAIMS_PATH,
  KNOWLEDGE_GOLD_SET_PATH,
} from "@/components/navigation";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import {
  knowledgeBaseApi,
  type GoldAnchorDecision,
  type GoldOutReason,
  type GoldRow,
  type GoldRowVerdict,
  type GoldScore,
  type GoldScoreFailure,
  type GoldSet,
  type GoldSource,
} from "@/lib/api/knowledge-base";
import { FIELD_LABELS } from "./claim-review-page";
import { KnowledgeBaseTabs, KnowledgeLayerLegend } from "./knowledge-base-tabs";

/**
 * T3 ARANY-KÉSZLET (terv v4, 10. pont, T3; research-t3-jelolt-keszlet). Egy
 * helyen, soronként: a rögzített tíz forrás gépi állításai, mindegyik a
 * szerkesztő mezőnkénti döntéseiből számolt ítélettel (a bírálat maga a
 * Kiolvasás fülön történik, ugyanúgy, mint eddig), forrásonként a kimaradt
 * állítások, és a pontszám a terv küszöbeivel. Parancssor nem kell hozzá.
 *
 * Figma-keret nincs: a Kiolvasás és a Következtetések elemeiből épül.
 *
 * T3b (acrobot 37343): forrásonként egy forrás-sor is áll, a vizsgálattípus
 * és a mérési módszer tárolt döntéseiből, KÜLÖN számolva a 27/30-tól. A
 * „kontroll” mezőt ez a kör nem méri: ahhoz még nincs szerkesztői döntés.
 */
const VERDICT: Record<
  GoldRowVerdict,
  { label: string; variant: "amber" | "success" | "danger" | "grey" }
> = {
  PENDING: { label: "Bírálatra vár", variant: "amber" },
  CORRECT: { label: "Helyes", variant: "success" },
  WRONG: { label: "Hibás", variant: "danger" },
  OUT: { label: "Nem számít bele", variant: "grey" },
};

const OUT_REASONS: Record<GoldOutReason, string> = {
  REEXTRACTED: "egy újrakiolvasás visszavonta",
  DISPUTED: "a forrását visszavonták",
  SUPERSEDED: "felülírták",
  MISSING: "már nincs meg",
};

const DECISIONS: Record<GoldAnchorDecision, string> = {
  PENDING: "vár",
  ACCEPTED: "elfogadva",
  CORRECTED: "javítva",
  REJECTED: "elvetve",
};

const FAILURES: Record<GoldScoreFailure, string> = {
  PRECISION: "Pontosság: több a hibás sor, mint a megengedett.",
  CRITICAL_ERRORS: "Van érték-, egység- vagy bázishiba (ebből nulla a tűrés).",
  COMPLETENESS: "Teljesség: a gép a szükségesnél kevesebb állítást talált meg.",
};

export function problemSentences(score: GoldScore, sources: number): string[] {
  return score.problems.map((p) => {
    switch (p) {
      case "NOT_FROZEN":
        return "A készlet még nincs rögzítve.";
      case "SOURCE_COUNT":
        return `A készletben ${sources} forrás van, a terv tízzel számol.`;
      case "PENDING_ROWS":
        return `${score.rows.pending} sor bírálatra vár a Kiolvasás fülön.`;
      case "TOO_FEW_SCORED":
        return `${score.precision.scored} bírált sor van, a méréshez legalább 30 kell.`;
      case "COMPLETENESS_OPEN":
        return `${sources - score.completeness.sourcesChecked} forrásnál még nincs kimondva, hogy nincs több kimaradt állítás.`;
      case "GOLD_TOO_SMALL":
        return `Az arany-készlet (a gép megtartott és a kimaradt állításai) ${score.completeness.gold} állítás, a méréshez legalább 30 kell.`;
    }
  });
}

const percent = (v: number | null) =>
  v === null ? "nincs adat" : `${Math.round(v * 100)}%`;

export function errorText(caught: unknown): string {
  return (caught as Error)?.message ?? "Ismeretlen hiba.";
}

export function GoldSetPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.KNOWLEDGE_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.KNOWLEDGE_MANAGE),
  );
  const [goldSet, setGoldSet] = useState<GoldSet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmFreeze, setConfirmFreeze] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setError(null);
      try {
        setGoldSet(await knowledgeBaseApi.goldSet(token, signal));
      } catch (caught) {
        if ((caught as Error)?.name === "AbortError") return;
        setError(errorText(caught));
      }
    },
    [canView, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const write = useCallback(async (run: () => Promise<GoldSet>) => {
    setBusy(true);
    setWriteError(null);
    try {
      setGoldSet(await run());
      return true;
    } catch (caught) {
      setWriteError(errorText(caught));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

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

  return (
    <PilotThemeRoot className="space-y-6">
      <PilotPageHeader
        eyebrow="Kutatási és szerkesztői modul"
        title="T3 arany-készlet"
        meta={<PilotBadge variant="amber">Stage · Pilot</PilotBadge>}
      />
      <KnowledgeBaseTabs active={KNOWLEDGE_GOLD_SET_PATH} />
      <p className="max-w-3xl text-[15px] text-pilot-grey-800">
        A kiolvasó pontosságát és teljességét a te bírálatod méri. A sorokat a{" "}
        <Link className="underline" href={KNOWLEDGE_CLAIMS_PATH}>
          Kiolvasás
        </Link>{" "}
        fülön bírálod mezőnként, ahogy eddig; itt látod, melyik sor hogy áll, és
        itt rögzíted, amit a gép kihagyott.
      </p>

      {writeError ? (
        <Alert
          variant="danger"
          title="A változás nem ment át"
          description={writeError}
        />
      ) : null}

      {error ? (
        <Alert
          variant="danger"
          title="A készlet nem tölthető be"
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
      ) : goldSet === null ? (
        <div role="status" aria-label="Betöltés" className="space-y-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : !goldSet.frozen ? (
        <ProposalCard
          goldSet={goldSet}
          canManage={canManage}
          onFreeze={() => setConfirmFreeze(true)}
        />
      ) : (
        <>
          <ScoreCard score={goldSet.score} sources={goldSet.sources.length} />
          {goldSet.sources.map((source) => (
            <SourceCard
              key={source.sourceId}
              source={source}
              canManage={canManage}
              busy={busy}
              onAddMissed={(input) =>
                write(() =>
                  knowledgeBaseApi.addGoldMissed(token, source.sourceId, input),
                )
              }
              onRemoveMissed={(id) =>
                write(() => knowledgeBaseApi.removeGoldMissed(token, id))
              }
              onCompleteness={(checked) =>
                write(() =>
                  knowledgeBaseApi.setGoldCompleteness(
                    token,
                    source.sourceId,
                    checked,
                  ),
                )
              }
            />
          ))}
        </>
      )}

      <ConfirmDialog
        open={confirmFreeze && Boolean(goldSet?.proposal)}
        title={`Rögzíted ezt a ${goldSet?.proposal?.sources.length ?? 0} forrást a T3 készletnek?`}
        consequence={`A forrásokból ${goldSet?.proposal?.claims ?? 0} gépi állítás lesz a mérés alapja (forrásonként legfeljebb ${goldSet?.proposal?.required.perSource ?? 0}); egy későbbi kiolvasás nem cseréli ki a sorokat.`}
        recovery="A rögzítés a felületen nem vonható vissza."
        confirmLabel="Rögzítés"
        busy={busy}
        onConfirm={() => {
          const ids = goldSet?.proposal?.sources.map((s) => s.sourceId) ?? [];
          void write(() => knowledgeBaseApi.freezeGoldSet(token, ids)).then(
            () => setConfirmFreeze(false),
          );
        }}
        onCancel={() => setConfirmFreeze(false)}
      />

      <KnowledgeLayerLegend />
    </PilotThemeRoot>
  );
}

function ProposalCard({
  goldSet,
  canManage,
  onFreeze,
}: {
  goldSet: GoldSet;
  canManage: boolean;
  onFreeze: () => void;
}) {
  const proposal = goldSet.proposal;
  if (!proposal) return null;
  return (
    <PilotCard className="space-y-4 p-5">
      <h2 className="text-lg font-semibold text-pilot-grey-900">
        Javasolt készlet
      </h2>
      <p className="text-[15px] text-pilot-grey-800">
        A befogadott források közül azok, amelyekből a legtöbb gépi állítás
        készült: {proposal.sources.length} forrás, a készletbe {proposal.claims}{" "}
        állítás kerül (egy forrásból legfeljebb {proposal.required.perSource}, a
        kiolvasás sorrendjében egyenletesen válogatva).
      </p>
      {proposal.enough ? null : (
        <Alert
          variant="info"
          title="Ebből még nem áll össze a készlet"
          description={`A T3 ${proposal.required.sources} forrást és legalább ${proposal.required.claims} gépi állítást kér. Több befogadott, kiolvasott forrás kell hozzá.`}
        />
      )}
      {proposal.sources.length ? (
        <ol className="space-y-2">
          {proposal.sources.map((s) => (
            <li
              key={s.sourceId}
              className="flex items-baseline justify-between gap-4 border-b border-pilot-grey-100 pb-2"
            >
              <span className="text-[15px] text-pilot-grey-900">
                {s.title}
                {s.year ? (
                  <span className="text-pilot-grey-500"> · {s.year}</span>
                ) : null}
              </span>
              <span className="whitespace-nowrap text-sm text-pilot-grey-600">
                {s.inSet === s.claims
                  ? `${s.claims} állítás`
                  : `${s.inSet} a ${s.claims} állításból`}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      {canManage && proposal.enough ? (
        <PilotButton variant="primary" size="action" onClick={onFreeze}>
          Készlet rögzítése
        </PilotButton>
      ) : null}
    </PilotCard>
  );
}

function ScoreCard({ score, sources }: { score: GoldScore; sources: number }) {
  const { precision: p, completeness: c } = score;
  return (
    <PilotCard className="space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-pilot-grey-900">Eredmény</h2>
        <PilotBadge
          variant={
            score.verdict === "PASS"
              ? "success"
              : score.verdict === "FAIL"
                ? "danger"
                : "amber"
          }
        >
          {score.verdict === "PASS"
            ? "Megfelel"
            : score.verdict === "FAIL"
              ? "Nem felel meg"
              : "Folyamatban"}
        </PilotBadge>
      </div>
      <dl className="grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-pilot-grey-600">Pontosság</dt>
          <dd className="mt-1 text-2xl font-semibold text-pilot-grey-900">
            {p.correct} / {p.scored}
          </dd>
          <dd className="text-sm text-pilot-grey-600">
            hibás {p.wrong}, megengedett {p.maxErrors} · alsó határ{" "}
            {percent(p.wilsonLower)}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-pilot-grey-600">
            Érték-, egység-, bázishiba
          </dt>
          <dd className="mt-1 text-2xl font-semibold text-pilot-grey-900">
            {p.critical}
          </dd>
          <dd className="text-sm text-pilot-grey-600">megengedett 0</dd>
        </div>
        <div>
          <dt className="text-sm text-pilot-grey-600">Teljesség</dt>
          <dd className="mt-1 text-2xl font-semibold text-pilot-grey-900">
            {c.found} / {c.gold}
          </dd>
          <dd className="text-sm text-pilot-grey-600">
            legalább {c.minFound} · kimaradt {c.missed} · alsó határ{" "}
            {percent(c.wilsonLower)}
          </dd>
        </div>
      </dl>
      <p className="text-sm text-pilot-grey-600">
        Sorok: {score.rows.total} · helyes {score.rows.correct} · hibás{" "}
        {score.rows.wrong} · vár {score.rows.pending} · nem számít bele{" "}
        {score.rows.out}. A 30 soros minta kicsi: az alsó határ a 95%-os
        Wilson-intervallumé.
      </p>
      {score.problems.length ? (
        <ul aria-label="Ami még hiányzik" className="list-disc pl-5 text-sm">
          {problemSentences(score, sources).map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      ) : null}
      {score.failures.length ? (
        <ul aria-label="Amin elbukik" className="list-disc pl-5 text-sm">
          {score.failures.map((f) => (
            <li key={f}>{FAILURES[f]}</li>
          ))}
        </ul>
      ) : null}
      <SourceFieldsScore score={score.sourceFields} />
    </PilotCard>
  );
}

function SourceFieldsScore({ score }: { score: GoldScore["sourceFields"] }) {
  return (
    <section
      aria-label="Forrás vizsgálati mezői"
      className="space-y-2 border-t border-pilot-grey-200 pt-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-base font-semibold text-pilot-grey-900">
          Forrás vizsgálati mezői (külön számolva)
        </h3>
        <PilotBadge
          variant={
            score.verdict === "PASS"
              ? "success"
              : score.verdict === "FAIL"
                ? "danger"
                : "amber"
          }
        >
          {score.verdict === "PASS"
            ? "Megfelel"
            : score.verdict === "FAIL"
              ? "Nem felel meg"
              : "Folyamatban"}
        </PilotBadge>
      </div>
      <p className="text-sm text-pilot-grey-700">
        Hibás mező {score.wrongFields}, megengedett {score.maxErrors} ·
        bizonyítéki szintet változtató hiba {score.levelChanged}, megengedett 0
        · vár {score.pending} forrás. A vizsgálattípus és a mérési módszer
        számít bele; a kontroll mezőt ez a kör nem méri. Hogy egy hiba
        változtat-e a szinten, azt a szabálytábla újraszámolása dönti el.
      </p>
    </section>
  );
}

function SourceCard({
  source,
  canManage,
  busy,
  onAddMissed,
  onRemoveMissed,
  onCompleteness,
}: {
  source: GoldSource;
  canManage: boolean;
  busy: boolean;
  onAddMissed: (input: {
    text: string;
    locator: string | null;
  }) => Promise<boolean>;
  onRemoveMissed: (id: string) => Promise<boolean>;
  onCompleteness: (checked: boolean) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [locator, setLocator] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const checked = source.completenessCheckedAt !== null;
  const headingId = `t3-forras-${source.position}`;
  return (
    <PilotCard className="space-y-4 p-5">
      <div className="space-y-1">
        <h2
          id={headingId}
          className="text-lg font-semibold text-pilot-grey-900"
        >
          {source.position}. {source.title}
        </h2>
        <p className="text-sm text-pilot-grey-600">
          {[source.year, source.doi].filter(Boolean).join(" · ")}
        </p>
        {source.notInSet > 0 ? (
          <p className="text-sm text-pilot-grey-700">
            A forrás további {source.notInSet} gépi állítása nincs a készletben
            (forrásonként legfeljebb hat került be). Kimaradt állításnak csak
            azt vedd fel, amit a gép ebből a forrásból egyáltalán nem hozott.
          </p>
        ) : null}
      </div>

      <SourceRowItem row={source.sourceRow} />

      <ol className="space-y-3" aria-label="Gépi állítások">
        {source.rows.map((row, i) => (
          <RowItem key={row.claimId} row={row} index={i + 1} />
        ))}
      </ol>

      <section className="space-y-3 border-t border-pilot-grey-200 pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-base font-semibold text-pilot-grey-900">
            Kimaradt állítások
          </h3>
          <PilotBadge variant={checked ? "success" : "amber"}>
            {checked ? "Teljesség kimondva" : "Teljesség nyitott"}
          </PilotBadge>
        </div>
        {source.missed.length ? (
          <ul className="space-y-2">
            {source.missed.map((m) => (
              <li
                key={m.id}
                className="flex items-start justify-between gap-4 text-[15px]"
              >
                <span>
                  {m.text}
                  {m.locator ? (
                    <span className="text-pilot-grey-500"> · {m.locator}</span>
                  ) : null}
                </span>
                {canManage && !checked ? (
                  <PilotButton
                    variant="secondary"
                    size="action"
                    disabled={busy}
                    onClick={() => setRemoving(m.id)}
                  >
                    Törlés
                  </PilotButton>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-pilot-grey-600">
            Nincs felvett kimaradt állítás.
          </p>
        )}

        {canManage && !checked ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void onAddMissed({
                text: text.trim(),
                locator: locator.trim() || null,
              }).then((ok) => {
                if (ok) {
                  setText("");
                  setLocator("");
                }
              });
            }}
          >
            <label className="block space-y-1 text-sm">
              <span className="font-semibold text-pilot-grey-800">
                Kimaradt állítás
              </span>
              <textarea
                className="w-full rounded-lg border border-pilot-grey-300 p-2"
                rows={2}
                maxLength={500}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-semibold text-pilot-grey-800">
                Hol áll (oldal, szakasz, táblázat)
              </span>
              <input
                className="w-full rounded-lg border border-pilot-grey-300 p-2"
                maxLength={128}
                value={locator}
                onChange={(e) => setLocator(e.target.value)}
              />
            </label>
            <PilotButton
              type="submit"
              variant="secondary"
              size="action"
              disabled={busy || !text.trim()}
            >
              Kimaradt állítás felvétele
            </PilotButton>
          </form>
        ) : null}

        {canManage ? (
          <PilotButton
            variant={checked ? "secondary" : "primary"}
            size="action"
            disabled={busy}
            onClick={() => void onCompleteness(!checked)}
          >
            {checked
              ? "Újranyitás"
              : "Ebben a forrásban nincs több kimaradt állítás"}
          </PilotButton>
        ) : null}
      </section>

      <ConfirmDialog
        open={removing !== null}
        title="Törlöd ezt a kimaradt állítást?"
        consequence="A teljesség számából kikerül; a pontszám azonnal újraszámolódik."
        recovery="Újra felvehető ugyanígy, a szövegét viszont újra be kell írni."
        confirmLabel="Törlés"
        busy={busy}
        onConfirm={() => {
          if (!removing) return;
          void onRemoveMissed(removing).then(() => setRemoving(null));
        }}
        onCancel={() => setRemoving(null)}
      />
    </PilotCard>
  );
}

const SOURCE_ROW_VERDICT: Record<
  GoldSource["sourceRow"]["judgement"]["verdict"],
  { label: string; variant: "amber" | "success" | "danger" | "grey" }
> = {
  PENDING: { label: "Bírálatra vár", variant: "amber" },
  CORRECT: { label: "Helyes", variant: "success" },
  WRONG: { label: "Hibás", variant: "danger" },
  NONE: { label: "Nincs gépi vizsgálati mező", variant: "grey" },
};

function SourceRowItem({ row }: { row: GoldSource["sourceRow"] }) {
  const v = SOURCE_ROW_VERDICT[row.judgement.verdict];
  return (
    <div
      aria-label="Vizsgálati mezők"
      className="space-y-2 rounded-lg bg-pilot-grey-50 p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-pilot-grey-700">
          Vizsgálati mezők
        </span>
        <PilotBadge variant={v.variant}>{v.label}</PilotBadge>
        {row.judgement.verdict === "WRONG" ? (
          <span className="text-sm text-pilot-grey-800">
            {row.judgement.errors.map((e) => FIELD_LABELS[e] ?? e).join(", ")}
            {row.judgement.levelChanged
              ? " · a bizonyítéki szintet megváltoztatja"
              : ""}
          </span>
        ) : null}
      </div>
      {row.fields.length ? (
        <ul className="flex flex-wrap gap-2" aria-label="Forrás-mezők">
          {row.fields.map((f, i) => (
            <li key={`${f.field}-${i}`} className="text-sm">
              <span className="font-semibold">
                {FIELD_LABELS[f.field] ?? f.field}:
              </span>{" "}
              {f.value ?? "kérdés"}
              {f.correctedValue ? ` → ${f.correctedValue}` : ""}{" "}
              <span className="text-pilot-grey-500">
                ({DECISIONS[f.decision]})
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function RowItem({ row, index }: { row: GoldRow; index: number }) {
  const v = VERDICT[row.judgement.verdict];
  const j = row.judgement;
  return (
    <li className="space-y-2 rounded-lg border border-pilot-grey-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-pilot-grey-700">
          {index}.
        </span>
        <PilotBadge variant={v.variant}>{v.label}</PilotBadge>
        {j.verdict === "WRONG" ? (
          <span className="text-sm text-pilot-grey-800">
            {j.errors.includes("CLAIM")
              ? "az egész állítás elvetve"
              : j.errors.map((e) => FIELD_LABELS[e] ?? e).join(", ")}
            {j.critical ? " · érték-, egység- vagy bázishiba" : ""}
          </span>
        ) : null}
        {j.verdict === "OUT" && j.outReason ? (
          <span className="text-sm text-pilot-grey-600">
            {OUT_REASONS[j.outReason]}
          </span>
        ) : null}
        {j.verdict === "PENDING" ? (
          <Link className="text-sm underline" href={KNOWLEDGE_CLAIMS_PATH}>
            Bírálat a Kiolvasás fülön
          </Link>
        ) : null}
      </div>
      {row.passage ? (
        <blockquote className="border-l-2 border-pilot-grey-300 pl-3 text-[15px] text-pilot-grey-800">
          {row.passage.text}
          <span className="text-sm text-pilot-grey-500">
            {" "}
            · {row.passage.locator}
          </span>
        </blockquote>
      ) : null}
      {row.fields.length ? (
        <ul className="flex flex-wrap gap-2" aria-label="Mezők">
          {row.fields.map((f, i) => (
            <li key={`${f.field}-${i}`} className="text-sm">
              <span className="font-semibold">
                {FIELD_LABELS[f.field] ?? f.field}:
              </span>{" "}
              {f.value ?? "kérdés"}
              {f.correctedValue ? ` → ${f.correctedValue}` : ""}{" "}
              <span className="text-pilot-grey-500">
                ({DECISIONS[f.decision]})
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
