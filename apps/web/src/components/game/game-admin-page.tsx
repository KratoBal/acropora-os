"use client";

import {
  Alert,
  ConfirmDialog,
  EmptyState,
  PilotDateField,
  PilotPageHeader,
  Skeleton,
} from "@acropora/ui";
import { hasPermission, PERMISSIONS } from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  PilotBadge,
  PilotButton,
  PilotFormField,
  PilotInput,
  PilotSelect,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";
import {
  gameApi,
  type GameDrawView,
  type GameEntryView,
  type GameQuestionView,
} from "@/lib/api/game";
import { formatDateTimeHu } from "@/lib/format/date";

const errorText = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Ismeretlen hiba";

/** A nap a böngésző (budapesti) idejében: a nyitás a nap eleje, a zárás a nap vége. */
const dayStart = (day: string) => new Date(`${day}T00:00:00`).toISOString();
const dayEnd = (day: string) => new Date(`${day}T23:59:59`).toISOString();

const EMPTY_FORM = {
  week: "",
  type: "TEXT" as "TEXT" | "CHOICE",
  prompt: "",
  options: "",
  accepted: "",
  opens: "",
  closes: "",
};

/**
 * Az új kérdés űrlapja. CHOICE-nál a lehetőségek soronként (`a: Acropora`), a helyes válasz a lehetőség betűje;
 * TEXT-nél az elfogadott válaszok soronként (a kis- és nagybetű, az ékezet és a szóköz nem számít).
 */
function NewQuestion({
  token,
  onCreated,
}: {
  token: string;
  onCreated: () => void;
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof EMPTY_FORM) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const lines = (text: string) =>
    text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const options =
        form.type === "CHOICE"
          ? lines(form.options).map((line) => {
              const [id, ...label] = line.split(":");
              return { id: id!.trim(), label: label.join(":").trim() };
            })
          : [];
      await gameApi.createQuestion(token, {
        week: form.week.trim(),
        type: form.type,
        prompt: form.prompt.trim(),
        options,
        acceptedAnswers: lines(form.accepted),
        opensAt: form.opens ? dayStart(form.opens) : "",
        closesAt: form.closes ? dayEnd(form.closes) : "",
      });
      setForm(EMPTY_FORM);
      onCreated();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="space-y-3 rounded-2xl border border-pilot-grey-200 bg-white px-5 py-4"
      data-testid="game-new-question"
    >
      <p className="text-sm font-semibold">Új heti kérdés</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PilotFormField label="Hét (például 2026-W46)" required>
          <PilotInput value={form.week} onChange={set("week")} />
        </PilotFormField>
        <PilotFormField label="Típus" required>
          <PilotSelect
            value={form.type}
            onChange={(value) => set("type")(value)}
          >
            <option value="TEXT">Szabad szöveges válasz</option>
            <option value="CHOICE">Választás lehetőségek közül</option>
          </PilotSelect>
        </PilotFormField>
        <PilotFormField label="Nyitás napja" required>
          <PilotDateField
            value={form.opens}
            onChange={set("opens")}
            aria-label="Nyitás napja"
          />
        </PilotFormField>
        <PilotFormField label="Zárás napja (a nap végéig)" required>
          <PilotDateField
            value={form.closes}
            onChange={set("closes")}
            aria-label="Zárás napja"
          />
        </PilotFormField>
      </div>
      <PilotFormField label="A kérdés" required>
        <PilotInput value={form.prompt} onChange={set("prompt")} />
      </PilotFormField>
      {form.type === "CHOICE" ? (
        <PilotFormField
          label="Lehetőségek, soronként (a: Acropora)"
          help="A betű a lehetőség azonosítója; a helyes válasznál ezt írd."
        >
          <textarea
            className="min-h-24 w-full rounded-xl border border-pilot-grey-200 px-3 py-2 text-sm"
            value={form.options}
            onChange={(event) => set("options")(event.target.value)}
            aria-label="Lehetőségek"
          />
        </PilotFormField>
      ) : null}
      <PilotFormField
        label={
          form.type === "CHOICE"
            ? "Helyes lehetőség betűje"
            : "Elfogadott válaszok, soronként"
        }
        help={
          form.type === "CHOICE"
            ? undefined
            : "A kis- és nagybetű, az ékezet és a szóköz nem számít; a kétes választ a beküldéseknél kézzel elfogadhatod."
        }
        required
      >
        <textarea
          className="min-h-16 w-full rounded-xl border border-pilot-grey-200 px-3 py-2 text-sm"
          value={form.accepted}
          onChange={(event) => set("accepted")(event.target.value)}
          aria-label="Elfogadott válaszok"
        />
      </PilotFormField>
      {error ? (
        <Alert
          variant="danger"
          title="A kérdés nem menthető"
          description={error}
        />
      ) : null}
      <PilotButton disabled={busy} onClick={() => void save()}>
        Kérdés mentése
      </PilotButton>
    </section>
  );
}

/** Egy kérdés beküldései: ki, mit válaszolt, megerősítette-e, és a kézi döntés gombjai. */
function Entries({
  token,
  question,
  canManage,
  onChanged,
}: {
  token: string;
  question: GameQuestionView;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<GameEntryView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setRows(await gameApi.entries(token, question.id));
    } catch (cause) {
      setError(errorText(cause));
    }
  }, [token, question.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (entry: GameEntryView, correct: boolean | null) => {
    try {
      await gameApi.decide(token, entry.id, correct);
      await load();
      onChanged();
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  if (error)
    return <Alert variant="danger" title="Hiba történt" description={error} />;
  if (!rows) return <Skeleton className="h-20" />;
  if (rows.length === 0)
    return <p className="text-sm text-pilot-grey-600">Még nincs beküldés.</p>;
  return (
    <ul
      className="divide-y divide-pilot-grey-100 rounded-xl border border-pilot-grey-200 text-sm"
      data-testid="game-entries"
    >
      {rows.map((entry) => (
        <li
          key={entry.id}
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2"
        >
          <span className="font-medium">{entry.email}</span>
          <span>{entry.answer}</span>
          <span className="inline-flex flex-wrap items-center gap-2">
            {entry.confirmedAt ? (
              <PilotBadge variant="grey">megerősítve</PilotBadge>
            ) : (
              <PilotBadge variant="amber">megerősítetlen</PilotBadge>
            )}
            {entry.manualCorrect !== null ? (
              <PilotBadge variant={entry.manualCorrect ? "success" : "danger"}>
                kézzel {entry.manualCorrect ? "elfogadva" : "elutasítva"}
              </PilotBadge>
            ) : (
              <PilotBadge variant={entry.autoCorrect ? "success" : "grey"}>
                {entry.autoCorrect ? "helyes" : "nem egyezik"}
              </PilotBadge>
            )}
            {canManage ? (
              entry.manualCorrect === null ? (
                <PilotButton
                  variant="secondary"
                  onClick={() => void decide(entry, !entry.autoCorrect)}
                >
                  {entry.autoCorrect ? "Elutasítom" : "Elfogadom"}
                </PilotButton>
              ) : (
                <PilotButton
                  variant="secondary"
                  onClick={() => void decide(entry, null)}
                >
                  Kézi döntés visszavonása
                </PilotButton>
              )
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A sorsolások: új heti vagy karácsonyi sorsolás, és a régi újrafuttatása ugyanazzal a maggal. */
function Draws({
  token,
  questions,
  canManage,
}: {
  token: string;
  questions: GameQuestionView[];
  canManage: boolean;
}) {
  const [rows, setRows] = useState<GameDrawView[] | null>(null);
  const [questionId, setQuestionId] = useState("");
  const [confirm, setConfirm] = useState<"WEEKLY" | "CHRISTMAS" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    try {
      setRows(await gameApi.draws(token));
    } catch (cause) {
      setError(errorText(cause));
    }
  }, [token]);
  useEffect(() => {
    void load();
  }, [load]);

  const draw = async (kind: "WEEKLY" | "CHRISTMAS") => {
    setBusy(true);
    setError(null);
    try {
      await gameApi.draw(
        token,
        kind,
        kind === "WEEKLY" ? questionId : undefined,
      );
      setConfirm(null);
      await load();
    } catch (cause) {
      setConfirm(null);
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (row: GameDrawView) => {
    try {
      const again = await gameApi.verify(token, row.id);
      setVerified((current) => ({
        ...current,
        [row.id]: again.same
          ? `ugyanaz: ${again.winnerEmail ?? "nincs nyertes"}`
          : `ELTÉR: ${again.winnerEmail ?? "nincs nyertes"}`,
      }));
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  return (
    <section
      className="space-y-3 rounded-2xl border border-pilot-grey-200 bg-white px-5 py-4"
      data-testid="game-draws"
    >
      <p className="text-sm font-semibold">Sorsolás</p>
      <p className="text-xs text-pilot-grey-600">
        Csak a megerősített, helyes beküldés kerül a sorsolásba. A karácsonyi
        sorsolásban mindenki annyiszor szerepel, ahány héten helyesen játszott.
        A mag és a jelöltlista mentve: ugyanazzal a maggal újrafuttatva ugyanaz
        a nyertes jön ki.
      </p>
      {canManage ? (
        <div className="flex flex-wrap items-end gap-2">
          <PilotFormField label="Heti sorsolás kérdése">
            <PilotSelect value={questionId} onChange={setQuestionId}>
              <option value="">Válassz hetet</option>
              {questions.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.week} ({q.candidateCount} jelölt)
                </option>
              ))}
            </PilotSelect>
          </PilotFormField>
          <PilotButton
            disabled={busy || !questionId}
            onClick={() => setConfirm("WEEKLY")}
          >
            Heti sorsolás
          </PilotButton>
          <PilotButton
            variant="secondary"
            disabled={busy}
            onClick={() => setConfirm("CHRISTMAS")}
          >
            Karácsonyi sorsolás
          </PilotButton>
        </div>
      ) : null}
      {error ? (
        <Alert variant="danger" title="Hiba történt" description={error} />
      ) : null}
      {!rows ? (
        <Skeleton className="h-16" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-pilot-grey-600">Még nem volt sorsolás.</p>
      ) : (
        <ul className="divide-y divide-pilot-grey-100 rounded-xl border border-pilot-grey-200 text-sm">
          {rows.map((row) => (
            <li key={row.id} className="space-y-1 px-4 py-2">
              <p>
                <span className="font-medium">
                  {row.kind === "WEEKLY"
                    ? `Heti (${row.question?.week ?? "?"})`
                    : "Karácsonyi"}
                </span>
                {": "}
                {row.winnerEmail ?? "nincs jelölt"} · {row.candidates.length}{" "}
                jelölt, {row.tickets} sorsjegy ·{" "}
                {formatDateTimeHu(row.createdAt)}
              </p>
              <p className="text-xs text-pilot-grey-600">
                mag: {row.seed}
                {verified[row.id] ? ` · újrafuttatva: ${verified[row.id]}` : ""}
              </p>
              <PilotButton variant="secondary" onClick={() => void verify(row)}>
                Újrafuttatás ugyanazzal a maggal
              </PilotButton>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm === "WEEKLY"
            ? "Elindítod a heti sorsolást?"
            : "Elindítod a karácsonyi sorsolást?"
        }
        consequence="A sorsolás a mostani megerősített, helyes beküldésekből választ, és a magjával, a jelöltlistával és a nyertessel együtt mentődik."
        recovery="Egy sorsolás nem törölhető; ugyanazzal a maggal bármikor újrafuttatható, és ugyanazt adja."
        confirmLabel="Sorsolás"
        busy={busy}
        onConfirm={() => confirm && void draw(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </section>
  );
}

/**
 * A KARÁCSONYI NYEREMÉNYJÁTÉK KEZELÉSE (kártya 31445d0f; Balázs, 2026-11-05). A heti kérdések, a beküldések a kétes
 * válaszok kézi döntésével, és a heti meg a karácsonyi sorsolás. Olvasni a tartalom-olvasás joga (content.view),
 * kérdést menteni, dönteni és sorsolni a tartalom-kezelésé (content.manage).
 */
export function GameAdminPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.CONTENT_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.CONTENT_MANAGE),
  );
  const [questions, setQuestions] = useState<GameQuestionView[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canView) return;
    try {
      const rows = await gameApi.questions(token);
      setQuestions(rows);
      setSelected((current) => current ?? rows[0]?.id ?? null);
    } catch (cause) {
      setError(errorText(cause));
      setQuestions((current) => current ?? []);
    }
  }, [token, canView]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a nyereményjátékhoz"
        description="A megtekintéshez content.view jogosultság szükséges."
      />
    );

  const question = (questions ?? []).find((q) => q.id === selected) ?? null;
  return (
    <PilotThemeRoot className="space-y-6">
      <PilotPageHeader
        title="Nyereményjáték"
        description="Heti kérdések, beküldések és sorsolás. A beküldés csak a megerősítő link után számít, és csak a helyes válasz kerül a sorsolásba."
      />
      {error ? (
        <Alert variant="danger" title="Hiba történt" description={error} />
      ) : null}
      {questions === null ? (
        <Skeleton className="h-32" />
      ) : questions.length === 0 ? (
        <EmptyState
          title="Még nincs kérdés"
          description="Az első heti kérdést lent veheted fel."
        />
      ) : (
        <section className="space-y-3" data-testid="game-questions">
          <ul className="divide-y divide-pilot-grey-100 rounded-xl border border-pilot-grey-200 bg-white text-sm">
            {questions.map((q) => (
              <li key={q.id}>
                <button
                  type="button"
                  className={`flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 text-left ${q.id === selected ? "bg-pilot-grey-50" : ""}`}
                  onClick={() => setSelected(q.id)}
                >
                  <span className="font-medium">{q.week}</span>
                  <span className="min-w-0 flex-1 truncate">{q.prompt}</span>
                  <span className="text-xs text-pilot-grey-600">
                    {q.entryCount} beküldés, {q.confirmedCount} megerősítve,{" "}
                    {q.candidateCount} jelölt
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {question ? (
            <Entries
              token={token}
              question={question}
              canManage={canManage}
              onChanged={() => void load()}
            />
          ) : null}
        </section>
      )}
      {questions ? (
        <Draws token={token} questions={questions} canManage={canManage} />
      ) : null}
      {canManage ? (
        <NewQuestion token={token} onCreated={() => void load()} />
      ) : null}
    </PilotThemeRoot>
  );
}
