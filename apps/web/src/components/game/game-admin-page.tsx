"use client";

import {
  Alert,
  ConfirmDialog,
  EmptyState,
  PilotDateField,
  PilotFileInput,
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
  type GameMailQueue,
  type GameQuestionView,
} from "@/lib/api/game";
import { budapestInstant, budapestParts } from "@/lib/format/budapest-time";
import { formatDateTimeHu } from "@/lib/format/date";

const errorText = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Ismeretlen hiba";

/**
 * A nyitás és a zárás a nap ÉS az óra:perc, budapesti idő szerint (a boltban érvényes idő, nem a gép zónája). Az üres
 * óra:perc a régi űrlap értékét adja: a nyitás a nap eleje (00:00), a zárás a nap vége (23:59).
 */
const EMPTY_FORM = {
  week: "",
  type: "TEXT" as "TEXT" | "CHOICE",
  prompt: "",
  options: "",
  accepted: "",
  opens: "",
  opensTime: "00:00",
  closes: "",
  closesTime: "23:59",
  prizeName: "",
  prizeDescription: "",
  prizeImageId: "",
};

/** A nyeremény képe: feltöltés a kép-tárolóba, előnézettel; a kérdés az azonosítót őrzi. */
function PrizeImage({
  token,
  imageId,
  onChange,
}: {
  token: string;
  imageId: string;
  onChange: (id: string) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!imageId) {
      setPreview(null);
      return;
    }
    let url: string | null = null;
    let cancelled = false;
    void gameApi
      .prizeImageContent(token, imageId)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setPreview(url);
      })
      .catch(() => setPreview(null));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [token, imageId]);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange((await gameApi.uploadPrizeImage(token, file)).id);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <PilotFormField
      label="Képe"
      help="PNG, JPEG, GIF vagy WebP, legfeljebb 1 MB."
    >
      <div className="space-y-2">
        <PilotFileInput
          accept="image/png,image/jpeg,image/gif,image/webp"
          aria-label="Nyeremény képe"
          disabled={busy}
          onChange={(event) => void upload(event.target.files?.[0])}
        />
        {preview ? (
          <div className="flex items-center gap-3">
            <img
              src={preview}
              alt="A nyeremény képe"
              className="h-24 w-24 rounded-lg object-cover ring-1 ring-pilot-grey-200"
            />
            <PilotButton variant="secondary" onClick={() => onChange("")}>
              Kép törlése
            </PilotButton>
          </div>
        ) : null}
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      </div>
    </PilotFormField>
  );
}

/** Egy meglévő kérdés az űrlap mezőiben (a nyitás és a zárás budapesti nap és óra:perc). */
function formOf(question: GameQuestionView): typeof EMPTY_FORM {
  const opens = budapestParts(question.opensAt);
  const closes = budapestParts(question.closesAt);
  return {
    week: question.week,
    type: question.type,
    prompt: question.prompt,
    options: question.options
      .map((option) => `${option.id}: ${option.label}`)
      .join("\n"),
    accepted: question.acceptedAnswers.join("\n"),
    opens: opens?.day ?? "",
    opensTime: opens?.time ?? "00:00",
    closes: closes?.day ?? "",
    closesTime: closes?.time ?? "23:59",
    prizeName: question.prizeName ?? "",
    prizeDescription: question.prizeDescription ?? "",
    prizeImageId: question.prizeImageId ?? "",
  };
}

/**
 * Az új kérdés űrlapja, és (a `question` megadva) egy meglévő kérdés javítása ugyanezzel az űrlappal: a hét nem változik,
 * a többi (szöveg, válaszok, nyitás és zárás, nyeremény) igen. CHOICE-nál a lehetőségek soronként (`a: Acropora`), a helyes válasz a lehetőség betűje;
 * TEXT-nél az elfogadott válaszok soronként (a kis- és nagybetű, az ékezet és a szóköz nem számít).
 */
function QuestionForm({
  token,
  question,
  onDone,
  onCancel,
}: {
  token: string;
  question?: GameQuestionView;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState(question ? formOf(question) : EMPTY_FORM);
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
      const input = {
        week: form.week.trim(),
        type: form.type,
        prompt: form.prompt.trim(),
        options,
        acceptedAnswers: lines(form.accepted),
        // az érintetlen időpont a tárolt marad (a másodperc is): a javítás nem csúsztatja el a régi zárást
        opensAt:
          question &&
          form.opens === formOf(question).opens &&
          form.opensTime === formOf(question).opensTime
            ? question.opensAt
            : (budapestInstant(form.opens, form.opensTime) ?? ""),
        closesAt:
          question &&
          form.closes === formOf(question).closes &&
          form.closesTime === formOf(question).closesTime
            ? question.closesAt
            : (budapestInstant(form.closes, form.closesTime) ?? ""),
        prizeName: form.prizeName.trim() || null,
        prizeDescription: form.prizeDescription.trim() || null,
        prizeImageId: form.prizeImageId || null,
      };
      if (question) await gameApi.updateQuestion(token, question.id, input);
      else {
        await gameApi.createQuestion(token, input);
        setForm(EMPTY_FORM);
      }
      onDone();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="space-y-3 rounded-2xl border border-pilot-grey-200 bg-white px-5 py-4"
      data-testid={question ? "game-edit-question" : "game-new-question"}
    >
      <p className="text-sm font-semibold">
        {question ? `Kérdés javítása (${question.week})` : "Új heti kérdés"}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PilotFormField label="Hét (például 2026-W46)" required>
          <PilotInput
            value={form.week}
            onChange={set("week")}
            disabled={Boolean(question)}
            aria-label="Hét"
          />
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
        <PilotFormField label="Nyitás ideje (budapesti)" required>
          <PilotInput
            type="time"
            value={form.opensTime}
            onChange={set("opensTime")}
            aria-label="Nyitás ideje"
          />
        </PilotFormField>
        <PilotFormField label="Zárás napja" required>
          <PilotDateField
            value={form.closes}
            onChange={set("closes")}
            aria-label="Zárás napja"
          />
        </PilotFormField>
        <PilotFormField label="Zárás ideje (budapesti)" required>
          <PilotInput
            type="time"
            value={form.closesTime}
            onChange={set("closesTime")}
            aria-label="Zárás ideje"
          />
        </PilotFormField>
      </div>
      <div className="space-y-3 rounded-xl border border-pilot-grey-100 px-4 py-3">
        <p className="text-sm font-semibold">A hét nyereménye</p>
        <PilotFormField
          label="Neve"
          help="Nem kötelező, de a leírás és a kép csak névvel menthető."
        >
          <PilotInput
            value={form.prizeName}
            onChange={set("prizeName")}
            maxLength={120}
            aria-label="Nyeremény neve"
          />
        </PilotFormField>
        <PilotFormField label="Rövid leírása">
          <textarea
            className="min-h-16 w-full rounded-xl border border-pilot-grey-200 px-3 py-2 text-sm"
            value={form.prizeDescription}
            onChange={(event) => set("prizeDescription")(event.target.value)}
            maxLength={500}
            aria-label="Nyeremény leírása"
          />
        </PilotFormField>
        <PrizeImage
          token={token}
          imageId={form.prizeImageId}
          onChange={set("prizeImageId")}
        />
      </div>
      <PilotFormField label="A kérdés" required>
        <PilotInput
          value={form.prompt}
          onChange={set("prompt")}
          aria-label="Kérdés szövege"
        />
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
      <div className="flex gap-2">
        <PilotButton disabled={busy} onClick={() => void save()}>
          Kérdés mentése
        </PilotButton>
        {onCancel ? (
          <PilotButton variant="secondary" onClick={onCancel}>
            Mégse
          </PilotButton>
        ) : null}
      </div>
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
  const [testLinks, setTestLinks] = useState(false);
  const [links, setLinks] = useState<Record<string, string>>({});
  useEffect(() => {
    void gameApi
      .mailQueue(token)
      .then((queue) => setTestLinks(queue.testLinks))
      .catch(() => setTestLinks(false));
  }, [token]);
  const takeLink = async (entry: GameEntryView) => {
    try {
      const { link } = await gameApi.testLink(token, entry.id);
      setLinks((current) => ({ ...current, [entry.id]: link }));
    } catch (cause) {
      setError(errorText(cause));
    }
  };
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
          <span className="font-medium">
            {entry.name ? `${entry.name} · ` : ""}
            {entry.email}
          </span>
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
            {canManage && testLinks && !entry.confirmedAt ? (
              <PilotButton
                variant="secondary"
                onClick={() => void takeLink(entry)}
              >
                Teszt-link
              </PilotButton>
            ) : null}
            {links[entry.id] ? (
              <a
                className="break-all text-xs underline"
                href={links[entry.id]}
                data-testid="game-test-link"
              >
                {links[entry.id]}
              </a>
            ) : null}
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

/** A napi levél-plafon fölött várakozó megerősítő levelek, és a kiküldésük (acrobot, 2026-11-05). */
function MailQueue({
  token,
  canManage,
}: {
  token: string;
  canManage: boolean;
}) {
  const [queue, setQueue] = useState<GameMailQueue | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setQueue(await gameApi.mailQueue(token));
    } catch (cause) {
      setError(errorText(cause));
    }
  }, [token]);
  useEffect(() => {
    void load();
  }, [load]);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      setQueue(await gameApi.sendQueued(token));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  if (!queue) return null;
  return (
    <section
      className="space-y-2 rounded-2xl border border-pilot-grey-200 bg-white px-5 py-4"
      data-testid="game-mail-queue"
    >
      <p className="text-sm">
        Megerősítő levelek ma: {queue.sentToday} / {queue.dailyCap}
        {queue.pending > 0 ? ` · várakozik: ${queue.pending}` : ""}
      </p>
      {queue.blocked ? (
        <Alert
          variant="danger"
          title="A megerősítő levél most nem megy ki"
          description={`Ok: ${queue.blocked}`}
        />
      ) : null}
      {queue.lastError ? (
        <p
          className="text-xs text-pilot-grey-600"
          data-testid="game-mail-error"
        >
          Utolsó sikertelen küldés: {formatDateTimeHu(queue.lastError.at)},{" "}
          {queue.lastError.reason}
        </p>
      ) : null}
      {canManage && queue.pending > 0 ? (
        <PilotButton disabled={busy} onClick={() => void send()}>
          Várakozó levelek kiküldése
        </PilotButton>
      ) : null}
      {error ? (
        <Alert variant="danger" title="Hiba történt" description={error} />
      ) : null}
    </section>
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
  /**
   * A SORSOLÁS CSAK A ZÁRÁS UTÁN (barracuda, #2279; acrobot 44326): egy hét ELSŐ sorsolása végleges a nyilvános listán, ezért a
   * heti sorsolás a kérdés zárásáig, a karácsonyi az utolsó kérdés zárásáig nem indítható. A szerver is megtagadja (409);
   * itt a gomb áll le, és a szöveg megmondja, mire vár.
   */
  const now = Date.now();
  const picked = questions.find((q) => q.id === questionId);
  const weeklyWaitsFor =
    picked && new Date(picked.closesAt).getTime() > now ? picked : null;
  const christmasWaitsFor = questions.some(
    (q) => new Date(q.closesAt).getTime() > now,
  );
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
            disabled={busy || !questionId || weeklyWaitsFor !== null}
            onClick={() => setConfirm("WEEKLY")}
          >
            Heti sorsolás
          </PilotButton>
          <PilotButton
            variant="secondary"
            disabled={busy || christmasWaitsFor}
            onClick={() => setConfirm("CHRISTMAS")}
          >
            Karácsonyi sorsolás
          </PilotButton>
        </div>
      ) : null}
      {canManage && (weeklyWaitsFor || christmasWaitsFor) ? (
        <p className="text-xs text-pilot-grey-600" data-testid="game-draw-wait">
          {weeklyWaitsFor
            ? `A heti sorsolás a kérdés zárása után indítható (${formatDateTimeHu(weeklyWaitsFor.closesAt)}). `
            : ""}
          {christmasWaitsFor
            ? "A karácsonyi sorsolás az utolsó kérdés zárása után indítható. "
            : ""}
          Az első sorsolás végleges: az kerül ki a nyilvános oldalra.
        </p>
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
                {row.winnerEmail
                  ? `${row.names[row.winnerEmail] ? `${row.names[row.winnerEmail]} · ` : ""}${row.winnerEmail}`
                  : "nincs jelölt"}{" "}
                · {row.candidates.length} jelölt, {row.tickets} sorsjegy ·{" "}
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
 * válaszok kézi döntésével, és a heti meg a karácsonyi sorsolás. Olvasni a game.view, kérdést menteni, dönteni és
 * sorsolni a game.manage joga; mindkettő csak emberi szerepé (acrobot, 2026-11-05).
 */
export function GameAdminPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.GAME_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.GAME_MANAGE),
  );
  const [questions, setQuestions] = useState<GameQuestionView[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
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
        description="A megtekintéshez game.view jogosultság szükséges."
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
                  onClick={() => {
                    setSelected(q.id);
                    setEditing(false);
                  }}
                >
                  <span className="font-medium">{q.week}</span>
                  <span className="min-w-0 flex-1 truncate">{q.prompt}</span>
                  {q.prizeName ? (
                    <span className="text-xs text-pilot-grey-600">
                      nyeremény: {q.prizeName}
                    </span>
                  ) : null}
                  <span className="text-xs text-pilot-grey-600">
                    {q.entryCount} beküldés, {q.confirmedCount} megerősítve,{" "}
                    {q.candidateCount} jelölt
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {question && canManage ? (
            editing ? (
              <QuestionForm
                key={question.id}
                token={token}
                question={question}
                onDone={() => {
                  setEditing(false);
                  void load();
                }}
                onCancel={() => setEditing(false)}
              />
            ) : (
              <PilotButton variant="secondary" onClick={() => setEditing(true)}>
                Kérdés javítása ({question.week})
              </PilotButton>
            )
          ) : null}
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
      <MailQueue token={token} canManage={canManage} />
      {questions ? (
        <Draws token={token} questions={questions} canManage={canManage} />
      ) : null}
      {canManage ? (
        <QuestionForm token={token} onDone={() => void load()} />
      ) : null}
    </PilotThemeRoot>
  );
}
