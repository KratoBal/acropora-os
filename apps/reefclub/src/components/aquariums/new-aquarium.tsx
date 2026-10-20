"use client";

import { Alert, Button, FormField, Input, Select } from "@acropora/ui";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { rc } from "@/lib/api";
import { parseDecimal } from "@/lib/labels";
import type { ReefClubAquarium } from "@/lib/types";

export function NewAquarium() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [waterBodyType, setWaterBodyType] = useState<"AKVARIUM" | "TO">(
    "AKVARIUM",
  );
  const [waterType, setWaterType] = useState<"" | "EDESVIZI" | "TENGERI">("");
  const [liters, setLiters] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const volume = liters.trim() === "" ? undefined : parseDecimal(liters);
  const volumeProblem =
    volume === null
      ? "A térfogatot számmal add meg, például 120 vagy 60,5."
      : volume !== undefined && volume <= 0
        ? "A térfogat nagyobb legyen nullánál."
        : undefined;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await rc<ReefClubAquarium>("POST", "/aquariums", {
        body: {
          name: name.trim(),
          waterBodyType,
          // the server fills nothing in for us: an empty choice is left out, not sent as ""
          ...(waterType ? { waterType } : {}),
          ...(volume !== undefined && volume !== null
            ? { systemVolumeLiters: volume }
            : {}),
        },
      });
      router.push(`/akvariumok/${created.id}`);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Az akvárium létrehozása nem sikerült.",
      );
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-lg space-y-4" noValidate>
      <h1 className="text-2xl font-semibold">Új akvárium</h1>
      {error ? (
        <Alert variant="danger" title="Nem sikerült" description={error} />
      ) : null}
      <FormField label="Név" htmlFor="aquarium-name">
        <Input
          id="aquarium-name"
          required
          maxLength={100}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </FormField>
      <FormField label="Fajtája" htmlFor="aquarium-body">
        <Select
          id="aquarium-body"
          value={waterBodyType}
          onChange={(event) =>
            setWaterBodyType(event.target.value as "AKVARIUM" | "TO")
          }
        >
          <option value="AKVARIUM">Akvárium</option>
          <option value="TO">Tó</option>
        </Select>
      </FormField>
      <FormField label="Víz" htmlFor="aquarium-water">
        <Select
          id="aquarium-water"
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
        htmlFor="aquarium-liters"
        description="A tényleges vízmennyiség, nem a tartály mérete."
        error={volumeProblem}
      >
        <Input
          id="aquarium-liters"
          inputMode="decimal"
          value={liters}
          onChange={(event) => setLiters(event.target.value)}
        />
      </FormField>
      <div className="flex gap-3">
        <Button
          type="submit"
          disabled={
            busy ||
            !name.trim() ||
            volume === null ||
            (volume !== undefined && volume <= 0)
          }
        >
          {busy ? "Mentés…" : "Létrehozás"}
        </Button>
        <Button variant="secondary" onClick={() => router.push("/akvariumok")}>
          Mégse
        </Button>
      </div>
    </form>
  );
}
