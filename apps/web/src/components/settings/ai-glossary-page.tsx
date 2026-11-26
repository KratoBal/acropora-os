"use client";

import {
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotInput,
  PilotPageHeader,
  PilotSelect,
  PilotThemeRoot,
} from "@acropora/ui";
import {
  AI_GLOSSARY_LIMITS,
  hasPermission,
  parseAiGlossarySaveInput,
  PERMISSIONS,
  type AiGlossaryEntry,
  type AiGlossaryLanguage,
  type AiGlossaryVersion,
  type AiGlossaryVersionInfo,
} from "@acropora/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { UnsavedChangesGuard } from "@/components/common/unsaved-changes-guard";
import { aiGlossaryApi } from "@/lib/api/ai-glossary";
import { ApiError } from "@/lib/api/client";

/**
 * AZ AI SZÓJEGYZÉKE (kártya 7a5ea203, C3; Balázs, 2026-08-27: a rövidítések verziózott szójegyzékben, szerkeszthetően). A rövidítések, amiket a modell
 * az első előfordulásnál kibont: az eredeti kifejezés, a forrásnyelv és a magyar név. Egy mentés ÚJ verzió (a lista egésze); az előzményből egy régi
 * verzió a szerkesztőbe tölthető, és a mentése újabb verzió: visszaállítás. A jóváhagyás-jelző csak jelöl, a promptból semmit nem szűr (acrobot 63253);
 * mellette áll, ki és mikor hagyta jóvá (acrobot 63288). Csak ott látszik, ahol az `AI_GLOSSARY_EDITOR` kapcsoló be van kapcsolva (a teszt OS).
 */

const LANGUAGE_LABEL: Record<AiGlossaryLanguage, string> = {
  en: "Angol",
  de: "Német",
};

/** A mentés után a futó példányok ennyi ideig adhatják a régi listát (az AI szolgáltatás válasza mondja ki; ez a tartalék, ha nem). */
const DEFAULT_DELAY_SECONDS = 60;

type Row = {
  key: number;
  abbreviation: string;
  original: string;
  language: AiGlossaryLanguage;
  hungarian: string;
  approved: boolean;
  /** A betöltött sor jóváhagyója és ideje: csak a VÁLTOZATLAN, jóváhagyott sor mellett igaz, mert a szerver ezt örökli. */
  approvedBy: string | null;
  approvedAt: string | null;
};

let nextKey = 1;
const rowOf = (entry: AiGlossaryEntry): Row => ({
  key: nextKey++,
  abbreviation: entry.abbreviation,
  original: entry.original,
  language: entry.language,
  hungarian: entry.hungarian,
  approved: entry.approved,
  approvedBy: entry.approvedBy,
  approvedAt: entry.approvedAt,
});

const blankRow = (): Row => ({
  key: nextKey++,
  abbreviation: "",
  original: "",
  language: "en",
  hungarian: "",
  approved: false,
  approvedBy: null,
  approvedAt: null,
});

/** A lista tartalma összehasonlításhoz (a sorkulcs és a jóváhagyó adatai nélkül). */
const contentOf = (rows: readonly Row[]) =>
  JSON.stringify(
    rows.map(({ abbreviation, original, language, hungarian, approved }) => [
      abbreviation.trim(),
      original.trim(),
      language,
      hungarian.trim(),
      approved,
    ]),
  );

/**
 * A jóváhagyó adata a sor mellett: a szerver mentéskor számolja, és ezt tükrözzük. Egy jóváhagyott sor, ami az AKTÍV verzióban is jóváhagyott volt
 * és a magyar neve ugyanaz, megtartja a jóváhagyóját és idejét; minden más jóváhagyott sor (új jóváhagyás, megváltozott név, régi verzióból
 * betöltött eltérés) a mentőé lesz, ezt a sor "A mentéssel te hagyod jóvá" szöveggel jelzi.
 */
function withApproval(row: Row, active: AiGlossaryVersion | null): Row {
  const before = active?.entries.find(
    (entry) => entry.abbreviation === row.abbreviation.trim(),
  );
  const unchanged =
    row.approved &&
    before?.approved === true &&
    before.hungarian === row.hungarian.trim();
  return {
    ...row,
    approvedBy: unchanged ? before.approvedBy : null,
    approvedAt: unchanged ? before.approvedAt : null,
  };
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("hu-HU", { timeZone: "Europe/Budapest" });

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

export function AiGlossaryPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SETTINGS_MANAGE),
  );
  const [versions, setVersions] = useState<AiGlossaryVersionInfo[] | null>(
    null,
  );
  const [loaded, setLoaded] = useState<AiGlossaryVersion | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [note, setNote] = useState("");
  /** A szerkesztőbe töltött RÉGI verzió száma (visszaállítás), ha van: a mentés ÚJ verzió, az alapja az aktív marad. */
  const [restoredFrom, setRestoredFrom] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  /** A mentés után a betöltés ne számítson szerkesztésnek (a `UnsavedChangesGuard` a `dirty`-t nézi). */
  const baseline = useRef<string>("");

  const load = useCallback(async () => {
    if (!canManage) return;
    setError(null);
    setConflict(false);
    try {
      const list = (await aiGlossaryApi.versions(token)).versions;
      setVersions(list);
      const active = list.find((version) => version.active);
      if (!active) {
        setLoaded(null);
        setRows([]);
        baseline.current = contentOf([]);
        return;
      }
      const detail = await aiGlossaryApi.version(token, active.version);
      setLoaded(detail);
      const next = detail.entries.map(rowOf);
      setRows(next);
      baseline.current = contentOf(next);
      setNote("");
      setRestoredFrom(null);
    } catch (cause) {
      setError(message(cause, "Az AI szójegyzék nem tölthető be."));
    }
  }, [canManage, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = loaded !== null && contentOf(rows) !== baseline.current;

  const update = (key: number, patch: Partial<Row>) =>
    setRows((prev) =>
      prev.map((row) =>
        row.key === key ? withApproval({ ...row, ...patch }, loaded) : row,
      ),
    );

  const parsed = useMemo(
    () =>
      parseAiGlossarySaveInput({
        expectedVersion: loaded?.version ?? null,
        note,
        entries: rows.map(
          ({ abbreviation, original, language, hungarian, approved }) => ({
            abbreviation,
            original,
            language,
            hungarian,
            approved,
          }),
        ),
      }),
    [loaded, note, rows],
  );
  const problem = parsed.ok ? null : parsed.message;

  /** A kérdéskészlet az ATO-ra épül: nem tiltás, hanem figyelmeztetés, ha kikerül vagy az eredetije változik. */
  const atoWarning = useMemo(() => {
    const before = loaded?.entries.find(
      (entry) => entry.abbreviation === "ATO",
    );
    if (!before) return null;
    const now = rows.find((row) => row.abbreviation.trim() === "ATO");
    if (!now)
      return "Az ATO kikerül a szójegyzékből. A kérdéskészlet az ATO kibontását méri, ezért az automatikus mérés hibát jelezhet.";
    if (now.original.trim() !== before.original)
      return "Az ATO eredeti kifejezése változik. A kérdéskészlet ehhez méri a kibontást, ezért az automatikus mérés hibát jelezhet.";
    return null;
  }, [loaded, rows]);

  const save = async () => {
    if (!parsed.ok) return;
    setBusy(true);
    setError(null);
    setConflict(false);
    setNotice(null);
    try {
      const result = await aiGlossaryApi.save(token, parsed.value);
      const seconds = result.takesEffectWithinSeconds || DEFAULT_DELAY_SECONDS;
      await load();
      setNotice(
        `Mentve: ${result.version}. verzió. A változás legfeljebb ${seconds} másodpercen belül él minden futó példányon, és a kérdéskészlet-őr automatikusan új mérést indít.`,
      );
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) setConflict(true);
      setError(message(cause, "A mentés nem sikerült."));
    } finally {
      setBusy(false);
    }
  };

  const restore = async (version: number) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const old = await aiGlossaryApi.version(token, version);
      setRows(old.entries.map((entry) => withApproval(rowOf(entry), loaded)));
      setNote(`Visszaállítás: ${version}. verzió`);
      setRestoredFrom(version);
      setShowHistory(false);
    } catch (cause) {
      setError(message(cause, "A verzió nem tölthető be."));
    } finally {
      setBusy(false);
    }
  };

  const unapprovedCount = rows.filter((row) => !row.approved).length;

  return (
    <PilotThemeRoot className="space-y-6">
      <UnsavedChangesGuard when={dirty} />
      <PilotPageHeader
        eyebrow="Beállítások / AI szójegyzék"
        title="AI szójegyzék"
        description="A rövidítések, amiket az AI az első előfordulásnál kibont: az eredeti kifejezés és a magyar név. Egy mentés új verzió; az előzményből bármelyik visszaállítható."
      />
      {!canManage ? (
        <p
          role="status"
          className="rounded-lg bg-pilot-blue-50 p-3 text-sm text-pilot-blue-700"
        >
          Nincs hozzáférésed az AI szójegyzékéhez
        </p>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="space-y-2 rounded-lg bg-pilot-red-50 p-3 text-sm text-pilot-red-700"
        >
          <p>{error}</p>
          {conflict ? (
            <PilotButton
              variant="secondary"
              disabled={busy}
              onClick={() => void load()}
            >
              Újratöltés
            </PilotButton>
          ) : null}
        </div>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="rounded-lg bg-pilot-aqua-50 p-3 text-sm text-pilot-aqua-700"
        >
          {notice}
        </p>
      ) : null}

      {canManage && !versions && !error ? (
        <div
          aria-busy="true"
          className="h-48 animate-pulse rounded-xl bg-pilot-grey-100"
        />
      ) : null}

      {loaded ? (
        <PilotCard className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-pilot-grey-900">
                Aktív verzió: {loaded.version}
              </h2>
              <p className="text-xs text-pilot-grey-500">
                Mentette: {loaded.createdBy}, {when(loaded.createdAt)}
                {loaded.note ? `, megjegyzés: ${loaded.note}` : ""}
              </p>
            </div>
            {unapprovedCount ? (
              <PilotBadge variant="amber">
                {unapprovedCount} jóváhagyásra vár
              </PilotBadge>
            ) : null}
          </div>
          {restoredFrom !== null ? (
            <p
              role="status"
              className="rounded-lg bg-pilot-blue-50 p-3 text-sm text-pilot-blue-700"
            >
              A(z) {restoredFrom}. verzió tartalma van betöltve. A mentés új
              verziót ír, az aktív verzió addig marad.
            </p>
          ) : null}

          <ul className="space-y-3">
            {rows.map((row, index) => (
              <li
                key={row.key}
                className="space-y-2 border-t border-pilot-grey-100 pt-3 first:border-t-0 first:pt-0"
                data-testid={`szojegyzek-sor-${index + 1}`}
              >
                <div className="grid grid-cols-1 gap-2 md:grid-cols-[8rem_minmax(0,1fr)_8rem_minmax(0,1fr)]">
                  <label className="space-y-1 text-xs text-pilot-grey-600">
                    Rövidítés
                    <PilotInput
                      aria-label={`${index + 1}. sor rövidítése`}
                      value={row.abbreviation}
                      maxLength={AI_GLOSSARY_LIMITS.abbreviation}
                      onChange={(value) =>
                        update(row.key, { abbreviation: value })
                      }
                    />
                  </label>
                  <label className="space-y-1 text-xs text-pilot-grey-600">
                    Eredeti kifejezés
                    <PilotInput
                      aria-label={`${index + 1}. sor eredeti kifejezése`}
                      value={row.original}
                      maxLength={AI_GLOSSARY_LIMITS.original}
                      onChange={(value) => update(row.key, { original: value })}
                    />
                  </label>
                  <label className="space-y-1 text-xs text-pilot-grey-600">
                    Nyelv
                    <PilotSelect
                      aria-label={`${index + 1}. sor nyelve`}
                      value={row.language}
                      onChange={(value) =>
                        update(row.key, {
                          language: value as AiGlossaryLanguage,
                        })
                      }
                    >
                      {(
                        Object.keys(LANGUAGE_LABEL) as AiGlossaryLanguage[]
                      ).map((language) => (
                        <option key={language} value={language}>
                          {LANGUAGE_LABEL[language]}
                        </option>
                      ))}
                    </PilotSelect>
                  </label>
                  <label className="space-y-1 text-xs text-pilot-grey-600">
                    Magyar név
                    <PilotInput
                      aria-label={`${index + 1}. sor magyar neve`}
                      value={row.hungarian}
                      maxLength={AI_GLOSSARY_LIMITS.hungarian}
                      onChange={(value) =>
                        update(row.key, { hungarian: value })
                      }
                    />
                  </label>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm text-pilot-grey-800">
                    <input
                      type="checkbox"
                      checked={row.approved}
                      onChange={(event) =>
                        update(row.key, { approved: event.target.checked })
                      }
                      aria-label={`${index + 1}. sor jóváhagyva`}
                    />
                    Jóváhagyva
                  </label>
                  <p
                    className="text-xs text-pilot-grey-600"
                    data-testid={`jovahagyas-${index + 1}`}
                  >
                    {!row.approved
                      ? "Jóváhagyásra vár"
                      : row.approvedBy && row.approvedAt
                        ? `Jóváhagyta: ${row.approvedBy}, ${when(row.approvedAt)}`
                        : "A mentéssel te hagyod jóvá"}
                  </p>
                  <PilotButton
                    variant="ghost"
                    disabled={busy || rows.length <= 1}
                    onClick={() =>
                      setRows((prev) =>
                        prev.filter((other) => other.key !== row.key),
                      )
                    }
                  >
                    Sor törlése
                  </PilotButton>
                </div>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap gap-2">
            <PilotButton
              variant="secondary"
              disabled={busy || rows.length >= AI_GLOSSARY_LIMITS.entries}
              onClick={() => setRows((prev) => [...prev, blankRow()])}
            >
              Új sor
            </PilotButton>
          </div>

          {atoWarning ? (
            <p
              role="status"
              className="rounded-lg bg-pilot-amber-50 p-3 text-sm text-pilot-amber-700"
              data-testid="ato-figyelmeztetes"
            >
              {atoWarning}
            </p>
          ) : null}

          <label className="block space-y-1 text-xs text-pilot-grey-600">
            Megjegyzés a mentéshez
            <PilotInput
              aria-label="Megjegyzés a mentéshez"
              value={note}
              maxLength={AI_GLOSSARY_LIMITS.note}
              onChange={setNote}
            />
          </label>
          {dirty && problem ? (
            <p role="alert" className="text-sm text-pilot-red-700">
              {problem}
            </p>
          ) : null}
          <div className="flex gap-2">
            <PilotButton
              disabled={busy || !parsed.ok || (!dirty && restoredFrom === null)}
              onClick={() => void save()}
            >
              Mentés új verzióként
            </PilotButton>
            <PilotButton
              variant="secondary"
              disabled={busy || (!dirty && restoredFrom === null)}
              onClick={() => void load()}
            >
              Elvetés
            </PilotButton>
          </div>
          <p className="text-xs text-pilot-grey-500">
            A mentés után a változás legfeljebb egy percen belül él minden futó
            példányon, és a kérdéskészlet-őr automatikusan új mérést indít.
          </p>
        </PilotCard>
      ) : null}

      {versions ? (
        <PilotCard className="space-y-3 p-5">
          <button
            type="button"
            aria-expanded={showHistory}
            className="flex w-full items-center justify-between text-left"
            onClick={() => setShowHistory((open) => !open)}
          >
            <span className="text-base font-semibold text-pilot-grey-900">
              Előzmény
            </span>
            <span className="text-sm text-pilot-grey-500">
              {versions.length} verzió
            </span>
          </button>
          {showHistory ? (
            <ul data-testid="szojegyzek-elozmeny">
              {versions.map((version) => (
                <li
                  key={version.version}
                  className="flex flex-wrap items-center justify-between gap-2 border-t border-pilot-grey-100 py-2 first:border-t-0"
                >
                  <div className="space-y-0.5">
                    <p className="text-sm text-pilot-grey-900">
                      {version.version}. verzió
                      {version.active ? " (aktív)" : ""}
                    </p>
                    <p className="text-xs text-pilot-grey-500">
                      {version.createdBy}, {when(version.createdAt)},{" "}
                      {version.entryCount} sor
                      {version.note ? `, ${version.note}` : ""}
                    </p>
                  </div>
                  {!version.active ? (
                    <PilotButton
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void restore(version.version)}
                    >
                      Betöltés szerkesztőbe
                    </PilotButton>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </PilotCard>
      ) : null}
    </PilotThemeRoot>
  );
}
