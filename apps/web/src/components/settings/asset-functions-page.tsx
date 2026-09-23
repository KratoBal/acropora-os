"use client";

import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  Input,
} from "@acropora/ui";
import {
  normalizeAssetFunctionName,
  type AssetFunction,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { assetFunctionsApi } from "@/lib/api/asset-functions";

/**
 * AZ ESZKOZ-FUNKCIOK KARBANTARTASA -- SZO SZERINT AZ `AssetCategoriesPage`
 * SZERKEZETE, mas torzsadaton.
 *
 * Balazs kerese, 2026-09-22 (kanban 68add892): „szeretnek egy ugyanolyan
 * menut a Beallitasok ala mint az Eszkoz kategoriak, csak Eszkoz-funkciok
 * nevvel". A lista URESEN indul, Balazsek toltik fel.
 *
 * FUGGETLEN AZ ESZKOZ-KATEGORIAKTOL: ket kulon torzsadat, nincs kozottuk
 * kapcsolat.
 */
export function AssetFunctionsPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";

  const [items, setItems] = useState<AssetFunction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ujNev, setUjNev] = useState("");
  const [mentes, setMentes] = useState(false);

  const betolt = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const valasz = await assetFunctionsApi.list(token, true, signal);
        setItems(valasz.items);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(
          cause instanceof Error
            ? cause.message
            : "A funkciók nem tölthetők be.",
        );
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void betolt(controller.signal);
    return () => controller.abort();
  }, [betolt]);

  const felvesz = async () => {
    const nev = normalizeAssetFunctionName(ujNev);
    if (nev === "") return;
    setMentes(true);
    setError(null);
    try {
      await assetFunctionsApi.create(token, { name: nev });
      setUjNev("");
      await betolt();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A funkció nem vehető fel.",
      );
    } finally {
      setMentes(false);
    }
  };

  const allit = async (funkcio: AssetFunction, aktiv: boolean) => {
    setError(null);
    try {
      await assetFunctionsApi.update(token, funkcio.id, { isActive: aktiv });
      await betolt();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A funkció nem módosítható.",
      );
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-dusk-900">Eszköz-funkciók</h1>
        <p className="mt-1 text-sm text-dusk-600">
          Ez a lista áll az eszköz-felvitel legördülő menüjében. Kivezetni
          lehet, törölni nem: a már felvitt eszközök mellett a név olvasható
          marad.
        </p>
      </div>

      {error ? (
        <Alert variant="danger" title="Hiba" description={error} />
      ) : null}

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-dusk-900">Új funkció</h2>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-dusk-700">Név</span>
            <Input
              aria-label="Funkció neve"
              value={ujNev}
              maxLength={80}
              onChange={(event) => setUjNev(event.target.value)}
              placeholder="pl. Automata adagolás"
            />
          </label>
          <Button
            disabled={mentes || normalizeAssetFunctionName(ujNev) === ""}
            onClick={() => void felvesz()}
          >
            {mentes ? "Mentés…" : "Felvétel"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-dusk-900">A lista</h2>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-dusk-500">Betöltés…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-dusk-500">
              Még egyetlen funkció sincs felvéve.
            </p>
          ) : (
            <ul className="divide-y">
              {items.map((funkcio) => (
                <li
                  key={funkcio.id}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <span
                    className={
                      funkcio.isActive
                        ? "text-sm text-dusk-800"
                        : "text-sm text-dusk-400 line-through"
                    }
                  >
                    {funkcio.name}
                  </span>
                  <Button
                    variant="secondary"
                    onClick={() => void allit(funkcio, !funkcio.isActive)}
                  >
                    {funkcio.isActive ? "Kivezetés" : "Visszahozás"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
