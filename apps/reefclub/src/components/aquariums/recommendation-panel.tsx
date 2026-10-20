"use client";

import { RECOMMENDATION_PARAMETERS } from "@acropora/aquarium-calc";
import { Alert, Badge, Button, FormField, Input, Select } from "@acropora/ui";
import { useRef, useState, type FormEvent } from "react";

import { ReefClubApiError, rc } from "@/lib/api";
import { formatMoment, parseDecimal } from "@/lib/labels";
import { parameterLabel } from "@/lib/series";
import type {
  DoseUnit,
  ReefClubAquarium,
  ReefClubDoseItem,
  ReefClubDoseRecorded,
  ReefClubRecommendationAnswer,
  ReefClubRecommendationItem,
  ReefClubRecommendationStatus,
} from "@/lib/types";
import { useLoad } from "@/lib/use-load";

import { localInputValue } from "./measurement-form";

export const UNIT_LABEL: Record<DoseUnit, string> = {
  ML: "ml",
  G: "g",
  CSEPP: "csepp",
};

const STATUS_LABEL: Record<ReefClubRecommendationStatus, string> = {
  OPEN: "Nyitott",
  EXPIRED: "Lejárt, nincs visszajelzés",
  GIVEN: "Beadtad",
  PARTIAL: "Részben adtad be",
  NOT_GIVEN: "Nem adtad be",
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 3 }).format(
    value,
  );
}

/**
 * The automatic recommendation of an aquarium (ReefClub plan v6.1, 6; slice 9,
 * the screen). Per parameter: ask for a recommendation, read the dose in the
 * server's fixed sentence (the amount with its unit, the days and the source:
 * the page shows the sentence as it is and adds nothing of its own to a dose),
 * answer it (I gave it / partly / I did not), and record a dose by hand.
 *
 * WHAT THE PAGE SAYS INSTEAD OF A BLANK: a refusal is the server's sentence,
 * and a dose list that is not current is said in so many words. An old
 * recommendation is shown with its state. A recommendation or a dose recorded
 * for another account linked to the same shop customer is marked as such (the
 * tank is the same and its daily limit is shared); its e-mail is not here.
 *
 * Asking is a POST, never a GET: issuing writes the log and reserves the daily
 * limit, so the page asks on a click and not on load.
 */
export function RecommendationPanel({
  aquarium,
  now = () => new Date(),
}: {
  aquarium: ReefClubAquarium;
  now?: () => Date;
}) {
  const base = `/aquariums/${encodeURIComponent(aquarium.id)}`;
  const recommendations = useLoad(() =>
    rc<{ items: ReefClubRecommendationItem[] }>(
      "GET",
      `${base}/recommendations`,
    ).then((r) => r.items),
  );
  const doses = useLoad(() =>
    rc<{ items: ReefClubDoseItem[] }>("GET", `${base}/doses`).then(
      (r) => r.items,
    ),
  );
  const items =
    recommendations.state.status === "ready" ? recommendations.state.data : [];

  async function changed() {
    await Promise.all([recommendations.reload(), doses.reload()]);
  }

  return (
    <section aria-labelledby="recommendation-title" className="space-y-5">
      <div className="space-y-1">
        <h2 id="recommendation-title" className="text-lg font-semibold">
          Adagolási javaslat
        </h2>
        <p className="text-sm text-pilot-grey-600">
          A javaslat a legfrissebb méréseden és a termékek ellenőrzött adagolási
          adatain alapul, rögzített mondatokkal, szám nélküli magyarázat nélkül.
          Ha bizonytalan vagy, kérdezd a boltot.
        </p>
      </div>

      <AskList base={base} onChanged={changed} />

      <div className="space-y-2">
        <h3 className="font-semibold">Javaslataid</h3>
        {recommendations.state.status === "loading" ? (
          <p role="status" className="text-sm text-pilot-grey-500">
            Betöltés…
          </p>
        ) : null}
        {recommendations.state.status === "failed" ? (
          <Alert
            variant="danger"
            title="A javaslatok nem töltődtek be"
            description={recommendations.state.message}
          />
        ) : null}
        {recommendations.state.status === "ready" && items.length === 0 ? (
          <p className="text-sm text-pilot-grey-500">
            Még nincs javaslat ehhez az akváriumhoz.
          </p>
        ) : null}
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id}>
              <RecommendationCard
                base={base}
                item={item}
                onAnswered={changed}
              />
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-3">
        <h3 className="font-semibold">Beadott adag rögzítése</h3>
        <DoseForm base={base} items={items} now={now} onSaved={changed} />
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">Rögzített adagok</h3>
        {doses.state.status === "failed" ? (
          <Alert
            variant="danger"
            title="Az adagok nem töltődtek be"
            description={doses.state.message}
          />
        ) : null}
        {doses.state.status === "ready" && doses.state.data.length === 0 ? (
          <p className="text-sm text-pilot-grey-500">
            Még nincs rögzített adag.
          </p>
        ) : null}
        <ul className="space-y-2">
          {(doses.state.status === "ready" ? doses.state.data : []).map(
            (dose) => (
              <li
                key={dose.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white p-3 text-sm"
              >
                <span className="font-semibold">
                  {parameterLabel(dose.parameter)}
                </span>
                <span>{formatMoment(dose.administeredAt)}</span>
                <span>{doseText(dose)}</span>
                {dose.byOtherAccount ? (
                  <Badge variant="info">Másik fiók rögzítette</Badge>
                ) : null}
              </li>
            ),
          )}
        </ul>
      </div>
    </section>
  );
}

function doseText(dose: ReefClubDoseItem): string {
  const product = dose.product
    ? (dose.product.name ?? "Ismeretlen termék")
    : "Más termék";
  return dose.amount === null || dose.unit === null
    ? `${product}, a mennyiség nem ismert`
    : `${product}: ${formatNumber(dose.amount)} ${UNIT_LABEL[dose.unit]}`;
}

/** One button per parameter; a click asks the server, which issues a dose or says why not. */
function AskList({
  base,
  onChanged,
}: {
  base: string;
  onChanged(): Promise<void>;
}) {
  const [answers, setAnswers] = useState<
    Record<string, ReefClubRecommendationAnswer | { error: string }>
  >({});
  const [busy, setBusy] = useState<string | null>(null);

  async function ask(parameter: string) {
    setBusy(parameter);
    try {
      const answer = await rc<ReefClubRecommendationAnswer>(
        "POST",
        `${base}/recommendations`,
        { body: { parameter } },
      );
      setAnswers((current) => ({ ...current, [parameter]: answer }));
      if (answer.outcome !== "NO_DOSE") await onChanged();
    } catch (cause) {
      setAnswers((current) => ({
        ...current,
        [parameter]: {
          error:
            cause instanceof Error
              ? cause.message
              : "A javaslat kérése nem sikerült.",
        },
      }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <h3 className="font-semibold">Javaslat kérése</h3>
      <ul className="space-y-3">
        {RECOMMENDATION_PARAMETERS.map((parameter) => {
          const answer = answers[parameter];
          return (
            <li
              key={parameter}
              className="space-y-2 rounded-lg border border-line bg-white p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">
                  {parameterLabel(parameter)}
                </span>
                <Button
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() => void ask(parameter)}
                  aria-label={`Javaslat kérése: ${parameterLabel(parameter)}`}
                >
                  {busy === parameter ? "Kérés…" : "Javaslat kérése"}
                </Button>
              </div>
              {answer ? <AskResult answer={answer} /> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AskResult({
  answer,
}: {
  answer: ReefClubRecommendationAnswer | { error: string };
}) {
  if ("error" in answer)
    return (
      <Alert
        variant="danger"
        title="A javaslat nem érkezett meg"
        description={answer.error}
      />
    );
  if (answer.outcome === "NO_DOSE" && answer.reason === "DOSE_LIST_STALE")
    return (
      <Alert
        variant="danger"
        title="A termék-adag lista most nem friss"
        description={answer.text}
      />
    );
  if (answer.outcome === "NO_DOSE")
    return <p className="text-sm text-pilot-grey-700">{answer.text}</p>;
  return (
    <p className="text-sm text-pilot-grey-700">
      {answer.outcome === "ACTIVE"
        ? answer.byOtherAccount
          ? "Ehhez a paraméterhez már van érvényes javaslat, amit másik fiók kapott (ugyanaz az akvárium, közös napi korlát): "
          : "Ehhez a paraméterhez már van érvényes javaslatod: "
        : "Új javaslat: "}
      <span className="font-semibold">{answer.text}</span>{" "}
      {answer.byOtherAccount
        ? "Ennek a beadását az a fiók jelezheti, amelyik kapta."
        : "Lent a „Javaslataid” között tudod megválaszolni."}
    </p>
  );
}

function RecommendationCard({
  base,
  item,
  onAnswered,
}: {
  base: string;
  item: ReefClubRecommendationItem;
  onAnswered(): Promise<void>;
}) {
  return (
    <article className="space-y-3 rounded-xl border border-line bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{parameterLabel(item.parameter)}</span>
        <Badge variant={item.status === "OPEN" ? "success" : "neutral"}>
          {STATUS_LABEL[item.status]}
        </Badge>
        {item.byOtherAccount ? (
          <Badge variant="info">Másik fiók rögzítette</Badge>
        ) : null}
      </div>
      <p className="text-sm">{item.text}</p>
      <dl className="grid gap-x-4 gap-y-1 text-xs text-pilot-grey-600 sm:grid-cols-3">
        <div>
          <dt className="inline font-semibold">Termék: </dt>
          <dd className="inline">{item.product.name}</dd>
        </div>
        <div>
          <dt className="inline font-semibold">Forrás: </dt>
          <dd className="inline">{item.source}</dd>
        </div>
        <div>
          <dt className="inline font-semibold">Kiadva: </dt>
          <dd className="inline">{formatMoment(item.createdAt)}</dd>
        </div>
      </dl>
      {item.status === "OPEN" && !item.byOtherAccount ? (
        <AnswerControls base={base} item={item} onAnswered={onAnswered} />
      ) : null}
      {item.status === "OPEN" && item.byOtherAccount ? (
        <p className="text-xs text-pilot-grey-500">
          Ezt másik fiók kapta; a beadást az a fiók jelezheti.
        </p>
      ) : null}
    </article>
  );
}

/**
 * I gave it / partly / I did not. The server decides what needs a
 * confirmation (an amount that differs from the recommended one answers 409),
 * so the page asks again only when the server says so.
 */
function AnswerControls({
  base,
  item,
  onAnswered,
}: {
  base: string;
  item: ReefClubRecommendationItem;
  onAnswered(): Promise<void>;
}) {
  const [partial, setPartial] = useState(false);
  const [amountText, setAmountText] = useState("");
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // one key per answer attempt, kept until it succeeds (a lost answer is retried safely)
  const operationId = useRef<string | null>(null);

  async function send(
    answer: "GIVEN" | "PARTIAL" | "NOT_GIVEN",
    confirmed = false,
  ) {
    const amount = answer === "PARTIAL" ? parseDecimal(amountText) : null;
    if (answer === "PARTIAL" && (amount === null || amount <= 0)) {
      setError("Add meg, mennyit adtál be (nullánál nagyobb szám).");
      return;
    }
    setBusy(true);
    setError(null);
    operationId.current ??= crypto.randomUUID();
    try {
      await rc(
        "POST",
        `${base}/recommendations/${encodeURIComponent(item.id)}/answer`,
        {
          body: {
            answer,
            ...(amount !== null ? { amount } : {}),
            ...(confirmed ? { confirmed: true } : {}),
            ...(answer === "NOT_GIVEN"
              ? {}
              : { clientOperationId: operationId.current }),
          },
        },
      );
      operationId.current = null;
      await onAnswered();
    } catch (cause) {
      if (cause instanceof ReefClubApiError && cause.status === 409) {
        setNeedsConfirmation(true);
        setError(cause.message);
      } else {
        setError(
          cause instanceof Error ? cause.message : "A válasz nem mentődött.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {error ? (
        <Alert
          variant="danger"
          title="A válasz nem mentődött"
          description={error}
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void send("GIVEN")}>
          Beadtam
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => setPartial((open) => !open)}
        >
          Részben adtam be
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void send("NOT_GIVEN")}
        >
          Nem adtam be
        </Button>
      </div>
      {partial ? (
        <div className="flex flex-wrap items-end gap-2">
          <FormField
            label={`Beadott mennyiség (${UNIT_LABEL[item.unit]})`}
            htmlFor={`partial-${item.id}`}
          >
            <Input
              id={`partial-${item.id}`}
              inputMode="decimal"
              value={amountText}
              onChange={(event) => {
                setAmountText(event.target.value);
                setNeedsConfirmation(false);
              }}
            />
          </FormField>
          {needsConfirmation ? (
            <Button disabled={busy} onClick={() => void send("PARTIAL", true)}>
              Igen, ennyit adtam be
            </Button>
          ) : (
            <Button disabled={busy} onClick={() => void send("PARTIAL")}>
              Mentés
            </Button>
          )}
          <p className="basis-full text-xs text-pilot-grey-500">
            Legfeljebb az ajánlott {formatNumber(item.amount)}{" "}
            {UNIT_LABEL[item.unit]} adható meg; ha többet adtál be, rögzítsd
            lent külön adagként.
          </p>
        </div>
      ) : null}
    </div>
  );
}

const OTHER_PRODUCT = "";

/**
 * A given dose by hand. A product is chosen among the ones this aquarium has a
 * recommendation for, or "another product" (its effect is unknown, and the
 * server then gives no dose for that parameter for a day). The operation key
 * is kept until the save succeeds, so a lost answer is retried without a
 * second dose.
 */
function DoseForm({
  base,
  items,
  now,
  onSaved,
}: {
  base: string;
  items: readonly ReefClubRecommendationItem[];
  now: () => Date;
  onSaved(): Promise<void>;
}) {
  const products = [
    ...new Map(
      items
        .filter((item) => item.product.id !== null)
        .map((item) => [item.product.id as string, item.product.name]),
    ),
  ];
  const [parameter, setParameter] = useState<string>(
    RECOMMENDATION_PARAMETERS[0],
  );
  const [productId, setProductId] = useState(OTHER_PRODUCT);
  const [amountText, setAmountText] = useState("");
  const [unit, setUnit] = useState<DoseUnit>("ML");
  const [moment, setMoment] = useState(() => localInputValue(now()));
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<ReefClubDoseRecorded | null>(null);

  const amount = amountText.trim() === "" ? null : parseDecimal(amountText);
  const listed = productId !== OTHER_PRODUCT;
  const amountProblem =
    amountText.trim() !== "" && (amount === null || amount <= 0)
      ? "A mennyiség nullánál nagyobb szám legyen."
      : listed && amount === null
        ? "Listán szereplő termékhez add meg a mennyiséget."
        : undefined;
  const at = new Date(moment);
  const momentProblem = Number.isNaN(at.getTime())
    ? "Add meg a beadás időpontját."
    : at.getTime() > now().getTime() + 5 * 60_000
      ? "A beadás időpontja nem lehet a jövőben."
      : now().getTime() - at.getTime() > 7 * 24 * 3_600_000
        ? "A beadás legfeljebb 7 nappal lehet korábbi."
        : undefined;
  const ready = !amountProblem && !momentProblem;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const result = await rc<ReefClubDoseRecorded>("POST", `${base}/doses`, {
        body: {
          parameter,
          productId: listed ? productId : null,
          amount,
          unit: amount === null ? null : unit,
          administeredAt: at.toISOString(),
          clientOperationId: operationId,
        },
      });
      setSaved(result);
      setAmountText("");
      setOperationId(crypto.randomUUID());
      await onSaved();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Az adag nem mentődött.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-xl border border-line bg-white p-4"
      noValidate
    >
      {error ? (
        <Alert
          variant="danger"
          title="Az adag nem mentődött"
          description={error}
        />
      ) : null}
      {saved ? (
        <Alert
          title="Az adag mentve"
          description={saved.warnings.map((w) => w.message).join("\n")}
        />
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Paraméter" htmlFor="dose-parameter">
          <Select
            id="dose-parameter"
            value={parameter}
            onChange={(event) => setParameter(event.target.value)}
          >
            {RECOMMENDATION_PARAMETERS.map((code) => (
              <option key={code} value={code}>
                {parameterLabel(code)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Termék" htmlFor="dose-product">
          <Select
            id="dose-product"
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
          >
            <option value={OTHER_PRODUCT}>Más termék (nem ismert hatás)</option>
            {products.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          label="Mennyiség"
          htmlFor="dose-amount"
          error={amountProblem}
          description={
            listed ? undefined : "Más terméknél elhagyható, ha nem tudod."
          }
        >
          <Input
            id="dose-amount"
            inputMode="decimal"
            value={amountText}
            onChange={(event) => setAmountText(event.target.value)}
          />
        </FormField>
        <FormField label="Mértékegység" htmlFor="dose-unit">
          <Select
            id="dose-unit"
            value={unit}
            onChange={(event) => setUnit(event.target.value as DoseUnit)}
          >
            {(Object.keys(UNIT_LABEL) as DoseUnit[]).map((code) => (
              <option key={code} value={code}>
                {UNIT_LABEL[code]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          label="Beadás időpontja"
          htmlFor="dose-moment"
          error={momentProblem}
        >
          <Input
            id="dose-moment"
            type="datetime-local"
            value={moment}
            onChange={(event) => setMoment(event.target.value)}
          />
        </FormField>
      </div>
      <Button type="submit" disabled={busy || !ready}>
        {busy ? "Mentés…" : "Adag rögzítése"}
      </Button>
    </form>
  );
}
