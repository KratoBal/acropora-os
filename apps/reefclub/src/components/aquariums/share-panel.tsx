"use client";

import { Alert, Button } from "@acropora/ui";
import { useState } from "react";

import { rc } from "@/lib/api";
import { SHARE_CONSENT_LINES, SHARE_CONSENT_VERSION } from "@/lib/consent";
import { formatMoment } from "@/lib/labels";
import { formatValue, parameterLabel } from "@/lib/series";
import type { ReefClubAquarium, ReefClubShopView } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

/**
 * Sharing an own aquarium with the shop (plan 4.4): private by default; the
 * page shows exactly what the shop would see (the server builds the preview
 * from the same rows the shop reads), the consent text of the version the
 * server expects, and revoking takes effect at once.
 */
export function SharePanel({
  aquarium,
  onChanged,
}: {
  aquarium: ReefClubAquarium;
  onChanged(): Promise<void>;
}) {
  const base = `/aquariums/${encodeURIComponent(aquarium.id)}`;
  const shared = aquarium.sharedWithShopAt !== null;
  const preview = useLoad(() =>
    rc<ReefClubShopView>("GET", `${base}/share/preview`),
  );
  const serverVersion = useLoad(() =>
    rc<{ version: string }>("GET", "/me/share-consent"),
  );
  const [opening, setOpening] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const textIsCurrent =
    serverVersion.state.status === "ready" &&
    serverVersion.state.data.version === SHARE_CONSENT_VERSION;

  async function share() {
    setBusy(true);
    setError(null);
    try {
      await rc("POST", `${base}/share`, {
        body: { consentVersion: SHARE_CONSENT_VERSION },
      });
      setOpening(false);
      setAccepted(false);
      await onChanged();
      await preview.reload();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A megosztás nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    setError(null);
    try {
      await rc("DELETE", `${base}/share`);
      await onChanged();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A visszavonás nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="share-title"
      className="space-y-4 rounded-xl border border-line bg-white p-5"
    >
      <div>
        <h2 id="share-title" className="text-lg font-semibold">
          Megosztás a bolttal
        </h2>
        <p className="mt-1 text-sm text-pilot-grey-600">
          {shared
            ? `Megosztva ${formatMoment(aquarium.sharedWithShopAt!)} óta: a bolt ezt az akváriumot olvasni tudja.`
            : "Ez az akvárium privát: csak te látod. Ha megosztod, a bolt a mérései alapján tud segíteni."}
        </p>
      </div>

      {error ? (
        <Alert variant="danger" title="Nem sikerült" description={error} />
      ) : null}

      <Preview
        state={preview.state}
        heading={shared ? "Ezt látja most a bolt" : "Ezt látná a bolt"}
      />

      {shared ? (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void revoke()}
        >
          Megosztás visszavonása
        </Button>
      ) : opening ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-line bg-pilot-grey-50 p-3 text-sm">
            <p className="font-medium text-amber-700">
              Ez még nem a végleges jogi szöveg: a hozzájárulás szövege
              jóváhagyásra vár.
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-pilot-grey-700">
              {SHARE_CONSENT_LINES.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          {serverVersion.state.status === "ready" && !textIsCurrent ? (
            <Alert
              variant="danger"
              title="A megosztás szövege frissítés alatt"
              description="A szerver másik szövegverziót vár, mint amit ez az oldal mutat, ezért most nem lehet megosztani. Próbáld újra később."
            />
          ) : null}
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={accepted}
              onChange={(event) => setAccepted(event.target.checked)}
            />
            <span>Elolvastam, és megosztom ezt az akváriumot a bolttal.</span>
          </label>
          <div className="flex gap-3">
            <Button
              disabled={busy || !accepted || !textIsCurrent}
              onClick={() => void share()}
            >
              Megosztom
            </Button>
            <Button variant="secondary" onClick={() => setOpening(false)}>
              Mégse
            </Button>
          </div>
        </div>
      ) : (
        <Button onClick={() => setOpening(true)}>Megosztás a bolttal</Button>
      )}
    </section>
  );
}

function Preview({
  state,
  heading,
}: {
  state: ReturnType<typeof useLoad<ReefClubShopView>>["state"];
  heading: string;
}) {
  if (state.status === "loading")
    return (
      <p role="status" className="text-sm text-pilot-grey-500">
        Betöltés…
      </p>
    );
  if (state.status === "failed")
    return (
      <p role="alert" className="text-sm text-rose-700">
        {state.message}
      </p>
    );
  const { aquarium, targets, occasions } = state.data;
  return (
    <div className="rounded-lg border border-line p-3 text-sm">
      <h3 className="font-semibold">{heading}</h3>
      <p className="mt-1 text-pilot-grey-700">
        {aquarium.name} ·{" "}
        {aquarium.systemVolumeLiters === null
          ? "ismeretlen térfogat"
          : `${formatValue(aquarium.systemVolumeLiters)} liter`}
      </p>
      <p className="mt-1 text-pilot-grey-700">
        {targets.length} célsáv, {occasions.length} mérési alkalom.
      </p>
      {occasions.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-pilot-grey-600">
          {occasions.slice(0, 5).map((occasion) => (
            <li key={occasion.measuredAt}>
              {formatMoment(occasion.measuredAt)}:{" "}
              {occasion.values
                .map(
                  (v) =>
                    `${parameterLabel(v.parameterCode)} ${formatValue(v.value)}`,
                )
                .join(", ")}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
