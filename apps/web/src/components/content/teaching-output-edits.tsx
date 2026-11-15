"use client";

import type {
  TeachingOutputEditDetail,
  TeachingOutputEditSummary,
  TeachingSlideChange,
} from "@acropora/types";
import {
  Alert,
  PilotBadge,
  PilotButton,
  PilotFileInput,
  PilotInput,
} from "@acropora/ui";
import { useCallback, useEffect, useState } from "react";

import { contentApi } from "@/lib/api/content";

/**
 * A DIASOR SZERKESZTETT VÁLTOZATAI (T5.2, „eltér a forrástól"; spec v2 3. és
 * 6. pont). Aki a generált diasort kézzel szerkesztette, itt tölti fel; a lap
 * diánként mutatja, mi változott a generálthoz képest, és a szerkesztő egyszer
 * dönt: a változás visszamegy-e a forrásba. Az átvezetés a forrásban történik
 * (kézzel vagy a tartalom-ágenssel), utána a forrás újra jóváhagyásra megy.
 */

const CHANGE_LABELS: Record<TeachingSlideChange, string> = {
  SAME: "változatlan",
  CHANGED: "módosult",
  ADDED: "új dia",
  REMOVED: "kivett dia",
};

export function TeachingOutputEdits({
  token,
  contentId,
  outputId,
  canManage,
  onChanged,
}: {
  token: string;
  contentId: string;
  outputId: string;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [edits, setEdits] = useState<TeachingOutputEditSummary[]>([]);
  const [open, setOpen] = useState<TeachingOutputEditDetail | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    (signal?: AbortSignal) =>
      contentApi
        .teachingOutputEdits(token, contentId, outputId, signal)
        .then(setEdits)
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === "AbortError")
            return;
          setEdits([]);
        }),
    [token, contentId, outputId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const run = async (step: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await step();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A művelet nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  const upload = (file: File) =>
    run(async () => {
      const detail = await contentApi.uploadTeachingOutputEdit(
        token,
        contentId,
        outputId,
        file,
      );
      setOpen(detail);
      setNote("");
      await load();
      onChanged();
    });

  const show = (editId: string) =>
    run(async () => {
      setOpen(
        await contentApi.teachingOutputEdit(token, contentId, outputId, editId),
      );
      setNote("");
    });

  const decide = (toSource: boolean) =>
    run(async () => {
      if (!open) return;
      setOpen(
        await contentApi.decideTeachingOutputEdit(
          token,
          contentId,
          outputId,
          open.id,
          { toSource, note: note.trim() || null },
        ),
      );
      await load();
      onChanged();
    });

  return (
    <div className="space-y-2">
      {error ? (
        <Alert
          variant="danger"
          title="A szerkesztett diasor"
          description={error}
        />
      ) : null}
      {canManage ? (
        <label className="flex flex-wrap items-center gap-2">
          <span>Szerkesztett diasor feltöltése (.pptx):</span>
          <PilotFileInput
            accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            aria-label="Szerkesztett diasor feltöltése"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void upload(file);
            }}
          />
        </label>
      ) : null}
      {edits.length ? (
        <ul className="space-y-1">
          {edits.map((edit) => (
            <li key={edit.id} className="flex flex-wrap items-center gap-2">
              <span>{edit.fileName}</span>
              <PilotBadge variant={edit.changedSlides ? "amber" : "success"}>
                {edit.changedSlides
                  ? `${edit.changedSlides} dia eltér`
                  : "nem tér el"}
              </PilotBadge>
              {edit.decision ? (
                <PilotBadge variant="grey">
                  {edit.decision.toSource
                    ? "a forrásba átvezetendő"
                    : "nem megy a forrásba"}
                </PilotBadge>
              ) : (
                <PilotBadge variant="amber">döntésre vár</PilotBadge>
              )}
              <PilotButton
                variant="ghost"
                size="regular"
                disabled={busy}
                onClick={() => void show(edit.id)}
              >
                Eltérés megnézése
              </PilotButton>
            </li>
          ))}
        </ul>
      ) : null}
      {open ? (
        <section
          aria-label={`Eltérés: ${open.fileName}`}
          className="space-y-2 rounded-lg border border-pilot-grey-200 p-3"
        >
          <p className="font-medium">
            {open.fileName}:{" "}
            {open.diff.changed
              ? `${open.diff.changed} dia tér el a generálttól`
              : "a diák szövege nem tér el a generálttól"}
          </p>
          <ol className="space-y-2">
            {open.diff.slides
              .filter((slide) => slide.change !== "SAME")
              .map((slide) => (
                <li key={slide.position}>
                  <span className="font-medium">
                    {slide.position}. dia ({CHANGE_LABELS[slide.change]})
                    {slide.titleChanged
                      ? `: „${slide.generated?.title ?? ""}” helyett „${slide.edited?.title ?? ""}”`
                      : `: ${(slide.edited ?? slide.generated)?.title ?? ""}`}
                  </span>
                  {slide.removedPoints.length ? (
                    <ul className="list-disc pl-5 text-pilot-grey-600">
                      {slide.removedPoints.map((p) => (
                        <li key={`-${p}`}>
                          <del>{p}</del>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {slide.addedPoints.length ? (
                    <ul className="list-disc pl-5">
                      {slide.addedPoints.map((p) => (
                        <li key={`+${p}`}>
                          <ins>{p}</ins>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {slide.change === "CHANGED" &&
                  !slide.titleChanged &&
                  !slide.removedPoints.length &&
                  !slide.addedPoints.length ? (
                    <p className="text-pilot-grey-600">
                      A pontok sorrendje változott.
                    </p>
                  ) : null}
                </li>
              ))}
          </ol>
          {open.decision ? (
            <p>
              Döntés:{" "}
              {open.decision.toSource
                ? "a változás a forrásba átvezetendő"
                : "a változás nem megy a forrásba"}
              {open.decision.note ? ` (${open.decision.note})` : ""}
            </p>
          ) : canManage ? (
            <div className="space-y-2">
              <PilotInput
                aria-label="Megjegyzés a döntéshez"
                value={note}
                onChange={setNote}
                placeholder="Megjegyzés (nem kötelező)"
              />
              <div className="flex flex-wrap gap-2">
                <PilotButton
                  size="regular"
                  disabled={busy}
                  onClick={() => void decide(true)}
                >
                  A forrásba átvezetendő
                </PilotButton>
                <PilotButton
                  variant="secondary"
                  size="regular"
                  disabled={busy}
                  onClick={() => void decide(false)}
                >
                  Nem megy a forrásba
                </PilotButton>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
