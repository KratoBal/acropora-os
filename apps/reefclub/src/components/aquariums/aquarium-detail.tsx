"use client";

import { Alert, Badge, Button, FormField, Input, Select } from "@acropora/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { rc } from "@/lib/api";
import {
  formatLiters,
  parseDecimal,
  WATER_BODY_LABEL,
  WATER_TYPE_LABEL,
} from "@/lib/labels";
import {
  formatValue,
  latestTarget,
  measuredParameters,
  parameterLabel,
  seriesFor,
} from "@/lib/series";
import type {
  ReefClubAquarium,
  ReefClubOccasion,
  ReefClubTarget,
} from "@/lib/types";
import { useLoad } from "@/lib/use-load";

import { MeasurementChart } from "./measurement-chart";
import { MeasurementForm } from "./measurement-form";
import { OccasionList } from "./occasion-list";

/**
 * An aquarium: its data, its own target ranges, the measurements with a chart,
 * and for an OWN aquarium the manual measurement, the edit and the delete. A
 * SHOP aquarium is read only (plan 3.4): it shows only the occasions the shop
 * released, which the server filters. A foreign or unknown id is the server's
 * one 404, shown as "not found".
 */
export function AquariumDetail({ id }: { id: string }) {
  const base = `/aquariums/${encodeURIComponent(id)}`;
  const aquarium = useLoad(() => rc<ReefClubAquarium>("GET", base));
  const occasions = useLoad(() =>
    rc<{ occasions: ReefClubOccasion[] }>("GET", `${base}/measurements`).then(
      (r) => r.occasions,
    ),
  );
  const targets = useLoad(() =>
    rc<{ targets: ReefClubTarget[] }>("GET", `${base}/targets`).then(
      (r) => r.targets,
    ),
  );

  if (aquarium.state.status === "loading")
    return (
      <p role="status" className="text-sm text-pilot-grey-500">
        Betöltés…
      </p>
    );
  if (aquarium.state.status === "failed")
    return (
      <div className="space-y-3">
        <Alert
          variant="danger"
          title="Az akvárium nem található"
          description={aquarium.state.message}
        />
        <Link
          href="/akvariumok"
          className="font-semibold text-pilot-aqua-700 underline"
        >
          Vissza az akváriumokhoz
        </Link>
      </div>
    );

  const data = aquarium.state.data;
  const own = data.origin === "OWN";
  const list = occasions.state.status === "ready" ? occasions.state.data : [];

  return (
    <div className="space-y-8">
      <Header aquarium={data} onChanged={aquarium.reload} />

      <section aria-labelledby="targets-title" className="space-y-2">
        <h2 id="targets-title" className="text-lg font-semibold">
          Célsávok
        </h2>
        <Targets state={targets.state} />
      </section>

      <section aria-labelledby="measurements-title" className="space-y-4">
        <h2 id="measurements-title" className="text-lg font-semibold">
          Mérések
        </h2>
        {occasions.state.status === "loading" ? (
          <p role="status" className="text-sm text-pilot-grey-500">
            Betöltés…
          </p>
        ) : null}
        {occasions.state.status === "failed" ? (
          <Alert
            variant="danger"
            title="A mérések nem töltődtek be"
            description={occasions.state.message}
          />
        ) : null}
        {occasions.state.status === "ready" ? (
          <>
            <ChartPanel occasions={list} />
            {!own ? (
              <p className="text-xs text-pilot-grey-500">
                A bolti akvárium mérései csak olvashatók, és akkor jelennek meg,
                amikor a bolt véglegesítette őket.
              </p>
            ) : null}
            <OccasionList
              occasions={list}
              canDelete={own}
              onDelete={async (occasion) => {
                await rc(
                  "DELETE",
                  `${base}/measurements/${encodeURIComponent(occasion.id)}`,
                );
                await occasions.reload();
              }}
            />
          </>
        ) : null}
      </section>

      {own ? (
        <section
          aria-labelledby="new-measurement-title"
          className="space-y-3 rounded-xl border border-line bg-white p-5"
        >
          <h2 id="new-measurement-title" className="text-lg font-semibold">
            Mérés felvétele
          </h2>
          <MeasurementForm aquarium={data} onSaved={occasions.reload} />
        </section>
      ) : null}
    </div>
  );
}

function Header({
  aquarium,
  onChanged,
}: {
  aquarium: ReefClubAquarium;
  onChanged(): Promise<void>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const own = aquarium.origin === "OWN";

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await rc("DELETE", `/aquariums/${encodeURIComponent(aquarium.id)}`);
      router.push("/akvariumok");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Az akvárium törlése nem sikerült.",
      );
      setBusy(false);
    }
  }

  return (
    <header className="space-y-3">
      <Link
        href="/akvariumok"
        className="text-sm font-semibold text-pilot-aqua-700 underline"
      >
        ← Akváriumok
      </Link>
      {error ? (
        <Alert variant="danger" title="Nem sikerült" description={error} />
      ) : null}
      {editing ? (
        <EditForm
          aquarium={aquarium}
          onCancel={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await onChanged();
          }}
        />
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">
              {aquarium.name} <Badge>{own ? "Saját" : "Bolti"}</Badge>
            </h1>
            <p className="mt-1 text-sm text-pilot-grey-600">
              {[
                WATER_BODY_LABEL[aquarium.waterBodyType],
                aquarium.waterType
                  ? WATER_TYPE_LABEL[aquarium.waterType]
                  : null,
                formatLiters(aquarium.systemVolumeLiters),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {aquarium.sharedWithShopAt ? (
              <p className="mt-1 text-xs font-medium text-pilot-aqua-700">
                Megosztva a bolttal
              </p>
            ) : null}
          </div>
          {own ? (
            deleting ? (
              <span className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-pilot-grey-600">
                  Az akvárium és a mérései törlődnek. Biztos?
                </span>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy}
                  onClick={() => void remove()}
                >
                  Igen, törlöm
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setDeleting(false)}
                >
                  Mégse
                </Button>
              </span>
            ) : (
              <span className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setEditing(true)}
                >
                  Szerkesztés
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setDeleting(true)}
                >
                  Törlés
                </Button>
              </span>
            )
          ) : null}
        </div>
      )}
    </header>
  );
}

function EditForm({
  aquarium,
  onCancel,
  onSaved,
}: {
  aquarium: ReefClubAquarium;
  onCancel(): void;
  onSaved(): Promise<void>;
}) {
  const [name, setName] = useState(aquarium.name);
  const [waterBodyType, setWaterBodyType] = useState(aquarium.waterBodyType);
  const [waterType, setWaterType] = useState<"" | "EDESVIZI" | "TENGERI">(
    aquarium.waterType ?? "",
  );
  const [liters, setLiters] = useState(
    aquarium.systemVolumeLiters === null
      ? ""
      : String(aquarium.systemVolumeLiters).replace(".", ","),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const volume = liters.trim() === "" ? null : parseDecimal(liters);
  const volumeBad = liters.trim() !== "" && (volume === null || volume <= 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await rc<ReefClubAquarium>(
        "PATCH",
        `/aquariums/${encodeURIComponent(aquarium.id)}`,
        {
          // null clears an optional field; a missing key would leave it as it was
          body: {
            name: name.trim(),
            waterBodyType,
            waterType: waterType || null,
            systemVolumeLiters: volume,
          },
        },
      );
      await onSaved();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A mentés nem sikerült.",
      );
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-lg space-y-4" noValidate>
      {error ? (
        <Alert
          variant="danger"
          title="A mentés nem sikerült"
          description={error}
        />
      ) : null}
      <FormField label="Név" htmlFor="edit-name">
        <Input
          id="edit-name"
          maxLength={100}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </FormField>
      <FormField label="Fajtája" htmlFor="edit-body">
        <Select
          id="edit-body"
          value={waterBodyType}
          onChange={(event) =>
            setWaterBodyType(event.target.value as "AKVARIUM" | "TO")
          }
        >
          <option value="AKVARIUM">Akvárium</option>
          <option value="TO">Tó</option>
        </Select>
      </FormField>
      <FormField label="Víz" htmlFor="edit-water">
        <Select
          id="edit-water"
          value={waterType}
          onChange={(event) =>
            setWaterType(event.target.value as "" | "EDESVIZI" | "TENGERI")
          }
        >
          <option value="">Nem adom meg</option>
          <option value="EDESVIZI">Édesvizi</option>
          <option value="TENGERI">Tengeri</option>
        </Select>
      </FormField>
      <FormField
        label="Nettó térfogat (liter)"
        htmlFor="edit-liters"
        error={
          volumeBad
            ? "A térfogatot pozitív számmal add meg, például 120 vagy 60,5."
            : undefined
        }
      >
        <Input
          id="edit-liters"
          inputMode="decimal"
          value={liters}
          onChange={(event) => setLiters(event.target.value)}
        />
      </FormField>
      <div className="flex gap-3">
        <Button type="submit" disabled={busy || !name.trim() || volumeBad}>
          {busy ? "Mentés…" : "Mentés"}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Mégse
        </Button>
      </div>
    </form>
  );
}

function Targets({
  state,
}: {
  state: ReturnType<typeof useLoad<ReefClubTarget[]>>["state"];
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
  if (state.data.length === 0)
    return (
      <p className="text-sm text-pilot-grey-600">
        Nincs saját célsáv beállítva: a mérések az alapértelmezett sávokkal
        vannak értékelve.
      </p>
    );
  return (
    <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
      {state.data.map((target) => (
        <li
          key={target.parameterCode}
          className="flex justify-between border-b border-line/60 py-1"
        >
          <span className="text-pilot-grey-600">
            {parameterLabel(target.parameterCode)}
          </span>
          <span>
            {target.min !== null ? formatValue(target.min) : "…"} –{" "}
            {target.max !== null ? formatValue(target.max) : "…"}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ChartPanel({ occasions }: { occasions: ReefClubOccasion[] }) {
  const codes = measuredParameters(occasions);
  const [chosen, setChosen] = useState<string | null>(null);
  if (codes.length === 0) return null;
  const code = chosen && codes.includes(chosen) ? chosen : codes[0]!;
  const unit =
    occasions.flatMap((o) => o.values).find((v) => v.parameterCode === code)
      ?.unit ?? "";
  return (
    <div className="space-y-2 rounded-xl border border-line bg-white p-4">
      <FormField
        label="Grafikon paramétere"
        htmlFor="chart-parameter"
        className="max-w-xs"
      >
        <Select
          id="chart-parameter"
          value={code}
          onChange={(event) => setChosen(event.target.value)}
        >
          {codes.map((c) => (
            <option key={c} value={c}>
              {parameterLabel(c)}
            </option>
          ))}
        </Select>
      </FormField>
      <MeasurementChart
        label={parameterLabel(code)}
        unit={unit}
        points={seriesFor(code, occasions)}
        target={latestTarget(code, occasions)}
      />
    </div>
  );
}
