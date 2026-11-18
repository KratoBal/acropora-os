/**
 * RELATIV UT, NEM `@/` ALIAS: ez a modul spec-bol is behuzodik.
 */
import { jobWords, type JobWordsKind } from "./job-words";
import { shortWhen } from "./list-card";
import { serviceJobStatusLabel } from "./service-job-status";
import type { ServiceJobTimelineEntry } from "./types";

/**
 * "AMI TÖRTÉNT" ON THE PHONE (service redesign, Figma 423:890, 2026-10-04):
 * one row per log entry, newest first as the server orders it, as a time, a
 * title and one line of detail.
 *
 * Both shapes are drawn from what they carry. The internal row names the two
 * statuses and keeps the note; the partner row has only the partner's label.
 * A row saved before the phone read these fields still gets a title from its
 * kind, never an invented status.
 */
export interface TimelineRow {
  key: string;
  when: string;
  title: string;
  detail: string | null;
}

function statusTitle(
  entry: Extract<ServiceJobTimelineEntry, { kind: "status" }>,
  noun: string,
): string {
  const event = entry.event;
  if (!event) return "Állapotváltás";
  if (event.toStatus) {
    const to = serviceJobStatusLabel(event.toStatus);
    if (!event.fromStatus) return `A ${noun} létrejött (${to})`;
    return `${serviceJobStatusLabel(event.fromStatus)} → ${to}`;
  }
  if (event.isCreation) return `A ${noun} létrejött`;
  return event.partnerStatusLabel ?? "Állapotváltás";
}

/**
 * A `kind` a lap fajtája (a részletlapon ismert): a karbantartási lap naplója a saját nevét viseli (hibajegy-maradek lista, acrobot 56196). A fajta nélküli hívás (egy régi mentett
 * sor) a hibajegy szavait tartja, ahogy eddig.
 */
export function timelineRows(
  timeline: readonly ServiceJobTimelineEntry[],
  now: Date,
  kind?: JobWordsKind,
): TimelineRow[] {
  const maintenance = kind === "MAINTENANCE";
  const noun = jobWords(kind).noun;
  return timeline.map((entry) => {
    const base = {
      key: `${entry.kind}-${entry.sortKey}`,
      when: shortWhen(entry.at, now),
    };
    switch (entry.kind) {
      case "status": {
        const parts = [entry.event?.actorName, entry.event?.note].filter(
          (part): part is string => Boolean(part && part.trim()),
        );
        return {
          ...base,
          title: statusTitle(entry, noun),
          detail: parts.length ? parts.join(" · ") : null,
        };
      }
      case "worksheet":
        return {
          ...base,
          title: maintenance
            ? `Munkalap a ${jobWords(kind).under}`
            : "Munkalap a jegy alatt",
          detail: entry.worksheet.number ?? entry.worksheet.subject,
        };
      case "asset":
        return {
          ...base,
          title: maintenance
            ? `Eszköz a ${jobWords(kind).on}`
            : "Eszköz a jegyen",
          detail: `${entry.asset.assetNumber} · ${entry.asset.assetName}`,
        };
      case "document":
        return {
          ...base,
          title: "Csatolmány törölve",
          detail: entry.removal
            ? [entry.removal.actorName, entry.removal.fileName]
                .filter(Boolean)
                .join(" · ")
            : null,
        };
    }
  });
}
