"use client";

import { PilotBadge } from "@acropora/ui";
import { useEffect, useState } from "react";

import {
  knowledgeBaseApi,
  type ModelFlagTarget,
  type ModelFlagView,
} from "@/lib/api/knowledge-base";

/**
 * A FÜGGETLEN MODELL JELZÉSE (terv v4, 7a 3.; S4). A flotta GPT-futtatója egy
 * rögzített ellenőrző-listán eltérést keresett a tételen. A jelzés a tételt a
 * szerkesztőhöz küldi; a hallgatás „nem jelzett”, SOHA nem „ellenőrizve” és
 * soha nem zöld, mert a jelző külső szöveget olvas, és egy befecskendezett
 * kivonat legfeljebb hallgatásra veheti rá. A jelzés semmilyen állapotot nem
 * változtat: elfogadni csak a szerkesztő tud.
 *
 * A forrás (a futtató neve, a futás és a modell) látszik, a beíró fiók nem.
 */

const when = (iso: string) =>
  new Date(iso).toLocaleString("hu-HU", {
    timeZone: "Europe/Budapest",
    dateStyle: "short",
    timeStyle: "short",
  });

export function modelFlagText(flag: ModelFlagView | null): {
  badge: string | null;
  variant: "amber" | "grey";
  line: string;
} {
  if (flag === null)
    return {
      badge: null,
      variant: "grey",
      line: "Független modell: ezen a tételen még nem futott.",
    };
  const stale = flag.current
    ? ""
    : " Elavult: a tétel azóta változott, a jelzés a korábbi változatra szól.";
  const who = `Forrás: ${flag.source}, futás ${flag.runId}, modell ${flag.model}, ${when(flag.createdAt)}.`;
  return flag.flagged
    ? {
        badge: "GPT jelzett",
        variant: "amber",
        line: `A független modell eltérést jelzett: nézd át. ${who}${stale}`,
      }
    : {
        badge: "nem jelzett",
        variant: "grey",
        line: `A független modell nem jelzett eltérést. Ez nem ellenőrzés: elfogadni csak a szerkesztő tud. ${who}${stale}`,
      };
}

export function ModelFlagBadge({
  token,
  targetType,
  targetId,
}: {
  token: string;
  targetType: ModelFlagTarget;
  targetId: string;
}) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error" }
    | { kind: "ready"; flag: ModelFlagView | null }
  >({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    knowledgeBaseApi
      .modelFlags(token, targetType, [targetId], controller.signal)
      .then((flags) =>
        setState({ kind: "ready", flag: flags[targetId] ?? null }),
      )
      .catch((cause: unknown) => {
        if ((cause as Error)?.name === "AbortError") return;
        setState({ kind: "error" });
      });
    return () => controller.abort();
  }, [token, targetType, targetId]);

  if (state.kind === "loading")
    return (
      <p role="status" className="text-xs text-pilot-grey-500">
        Független modell jelzése: betöltés…
      </p>
    );
  if (state.kind === "error")
    return (
      <p role="alert" className="text-xs text-pilot-grey-600">
        A független modell jelzése nem tölthető be.
      </p>
    );
  const t = modelFlagText(state.flag);
  return (
    <p className="text-xs text-pilot-grey-600" data-testid="model-flag">
      {t.badge ? (
        <>
          <PilotBadge variant={t.variant}>{t.badge}</PilotBadge>{" "}
        </>
      ) : null}
      {t.line}
    </p>
  );
}
