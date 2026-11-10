"use client";

import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  Input,
  PageHeader,
  Textarea,
} from "@acropora/ui";
import {
  RENTAL_CONTRACT_LIMITS,
  RENTAL_CONTRACT_VARIABLES,
  unknownRentalContractVariables,
  type RentalSettings,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { rentalSettingsApi } from "@/lib/api/rental-settings";

/**
 * The late-fee multiplier as typed: a comma or a point, at most two decimals, in range; empty is "not set yet" (`null`).
 * `undefined` when the text is not a valid value, so the page can say so instead of sending it.
 */
export function parseMultiplier(raw: string): number | null | undefined {
  const text = raw.trim().replace(",", ".");
  if (text === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return undefined;
  const value = Number(text);
  const { min, max } = RENTAL_CONTRACT_LIMITS.lateFeeMultiplier;
  return value >= min && value <= max ? value : undefined;
}

/** The day count as typed: a whole number in range, or empty for "not set yet". */
export function parseDays(raw: string): number | null | undefined {
  const text = raw.trim();
  if (text === "") return null;
  if (!/^\d+$/.test(text)) return undefined;
  const value = Number(text);
  const { min, max } = RENTAL_CONTRACT_LIMITS.replacementAfterDays;
  return value >= min && value <= max ? value : undefined;
}

/**
 * SETTINGS > BÉRLETI SZERZŐDÉS (task eszkozberles, S3; Balázs: "a szöveg cserélhető legyen, ne beégetett"). The contract text
 * with its `{{mezo}}` places, and the two late-return numbers the contract prints. An unknown place is flagged while typing,
 * and the server refuses it on save too.
 */
export function RentalContractPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";

  const [settings, setSettings] = useState<RentalSettings | null>(null);
  const [template, setTemplate] = useState("");
  const [multiplier, setMultiplier] = useState("");
  const [days, setDays] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const show = (loaded: RentalSettings) => {
    setSettings(loaded);
    setTemplate(loaded.contractTemplate);
    setMultiplier(
      loaded.lateFeeMultiplier === null
        ? ""
        : String(loaded.lateFeeMultiplier).replace(".", ","),
    );
    setDays(
      loaded.replacementAfterDays === null
        ? ""
        : String(loaded.replacementAfterDays),
    );
  };

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        show(await rentalSettingsApi.get(token, signal));
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(
          cause instanceof Error
            ? cause.message
            : "A beállítások nem tölthetők be.",
        );
      }
    },
    [token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const unknown = unknownRentalContractVariables(template);

  const save = async (contractTemplate: string | null) => {
    const lateFeeMultiplier = parseMultiplier(multiplier);
    const replacementAfterDays = parseDays(days);
    if (lateFeeMultiplier === undefined) {
      setError(
        `A késedelmi szorzó ${RENTAL_CONTRACT_LIMITS.lateFeeMultiplier.min} és ${RENTAL_CONTRACT_LIMITS.lateFeeMultiplier.max} közötti szám legyen, legfeljebb két tizedesjeggyel (vagy üres).`,
      );
      return;
    }
    if (replacementAfterDays === undefined) {
      setError(
        `A napok száma ${RENTAL_CONTRACT_LIMITS.replacementAfterDays.min} és ${RENTAL_CONTRACT_LIMITS.replacementAfterDays.max} közötti egész szám legyen (vagy üres).`,
      );
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      show(
        await rentalSettingsApi.save(token, {
          contractTemplate,
          lateFeeMultiplier,
          replacementAfterDays,
        }),
      );
      setNotice(
        contractTemplate === null
          ? "Visszaállítva az alapszövegre."
          : "Mentve. A következő nyomtatás már ezt a szöveget használja.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A mentés nem sikerült.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bérleti szerződés"
        description="A bérléskor nyomtatott szerződés szövege. A {{mezo}} alakú helyekre a rendszer a bérlés adatait írja. A szöveg, a szorzó és a napok a bérléskor rögzülnek: egy változtatás csak az új bérlésekre vonatkozik, a már megkötött szerződés újranyomtatva sem változik."
      />

      {error ? (
        <Alert variant="danger" title="Hiba" description={error} />
      ) : null}
      {notice ? (
        <Alert variant="info" title="Kész" description={notice} />
      ) : null}

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-dusk-900">
            Késedelmes visszahozás
          </h2>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-dusk-700">
              Késedelmi szorzó (a napi díj hányszorosa)
            </span>
            <Input
              aria-label="Késedelmi szorzó"
              inputMode="decimal"
              value={multiplier}
              placeholder="még nincs megadva"
              onChange={(event) => setMultiplier(event.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-dusk-700">
              Hány nap késés után jár a pótlási érték
            </span>
            <Input
              aria-label="Napok a pótlási értékig"
              inputMode="numeric"
              value={days}
              placeholder="még nincs megadva"
              onChange={(event) => setDays(event.target.value)}
            />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-dusk-900">
            A szerződés szövege
            {settings?.contractTemplateIsDefault ? " (alapszöveg)" : ""}
          </h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-dusk-600">
            A „## ” kezdetű sor fejléc, az üres sor új bekezdés, a [[alairas]]
            sor a két aláírásvonal.
          </p>
          <Textarea
            aria-label="A szerződés szövege"
            rows={24}
            value={template}
            maxLength={RENTAL_CONTRACT_LIMITS.template.max}
            onChange={(event) => setTemplate(event.target.value)}
          />
          {unknown.length > 0 ? (
            <Alert
              variant="danger"
              title="Ismeretlen mező"
              description={`Ezeket a rendszer nem ismeri: ${unknown.map((name) => `{{${name}}}`).join(", ")}. Mentés előtt javítsd.`}
            />
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={saving || settings === null || unknown.length > 0}
              onClick={() => void save(template)}
            >
              {saving ? "Mentés…" : "Mentés"}
            </Button>
            <Button
              variant="secondary"
              disabled={saving || settings === null}
              onClick={() => void save(null)}
            >
              Alapszöveg visszaállítása
            </Button>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-dusk-800">
              Választható mezők
            </p>
            <ul className="grid grid-cols-1 gap-1 text-sm text-dusk-600 sm:grid-cols-2">
              {Object.entries(RENTAL_CONTRACT_VARIABLES).map(([key, label]) => (
                <li key={key}>
                  <code className="text-dusk-800">{`{{${key}}}`}</code>: {label}
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
