"use client";

import { Alert, Button, FormField, Input } from "@acropora/ui";
import { useState, type FormEvent } from "react";

import { rc } from "@/lib/api";
import { formatMoment } from "@/lib/labels";
import type { ReefClubShopLink } from "@/lib/types";
import type { Loaded } from "@/lib/use-load";

/**
 * The shop code and the links it made. The code is what the shop gave the
 * customer: it, and nothing else (no e-mail match), connects the account to
 * the customer (plan 3.3). Every wrong code gets the server's one answer.
 */
export function ShopLinks({
  links,
  onChanged,
}: {
  links: Loaded<ReefClubShopLink[]>;
  onChanged(): Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState<string | null>(null);
  const [ending, setEnding] = useState<string | null>(null);

  async function redeem(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setLinked(null);
    try {
      const link = await rc<ReefClubShopLink>("POST", "/shop-links", {
        body: { code },
      });
      setCode("");
      setLinked(link.customerName);
      await onChanged();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A kód beváltása nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function end(link: ReefClubShopLink) {
    setBusy(true);
    setError(null);
    try {
      await rc("DELETE", `/shop-links/${encodeURIComponent(link.id)}`);
      setEnding(null);
      setLinked(null);
      await onChanged();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A kapcsolat megszüntetése nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-line bg-white p-5">
      <div>
        <h2 className="text-lg font-semibold">Bolti kapcsolat</h2>
        <p className="mt-1 text-sm text-pilot-grey-600">
          Ha a boltban kaptál egy kódot, írd be ide: a bolti akváriumaid és azok
          véglegesített mérései megjelennek a fiókodban. A kódot csak a bolt
          tudja kiadni, az e-mail cím egyezése nem elég.
        </p>
      </div>

      {error ? (
        <Alert variant="danger" title="Nem sikerült" description={error} />
      ) : null}
      {linked ? (
        <Alert
          title="Összekötve"
          description={`A fiókod mostantól össze van kötve ezzel: ${linked}.`}
        />
      ) : null}

      <form
        onSubmit={redeem}
        className="flex flex-wrap items-end gap-3"
        noValidate
      >
        <FormField
          label="Bolti kód"
          htmlFor="shop-code"
          className="min-w-48 flex-1"
        >
          <Input
            id="shop-code"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </FormField>
        <Button type="submit" disabled={busy || !code.trim()}>
          Összekötés
        </Button>
      </form>

      {links.status === "ready" && links.data.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold">Összekötött bolti vevők</h3>
          <ul className="mt-2 divide-y divide-line">
            {links.data.map((link) => (
              <li
                key={link.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <span>
                  <strong>{link.customerName}</strong>{" "}
                  <span className="text-pilot-grey-500">
                    · {formatMoment(link.createdAt)} óta
                  </span>
                </span>
                {ending === link.id ? (
                  <span className="flex items-center gap-2">
                    <span className="text-pilot-grey-600">
                      Megszűnik a hozzáférés a bolti akváriumokhoz. Biztos?
                    </span>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy}
                      onClick={() => void end(link)}
                    >
                      Igen, megszüntetem
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setEnding(null)}
                    >
                      Mégse
                    </Button>
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setEnding(link.id)}
                  >
                    Megszüntetés
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {links.status === "failed" ? (
        <p role="alert" className="text-sm text-rose-700">
          {links.message}
        </p>
      ) : null}
    </section>
  );
}
