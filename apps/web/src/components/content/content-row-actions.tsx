"use client";

import { Alert, Button, Textarea } from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type ContentListItem,
  type ContentMoveOption,
} from "@acropora/types";
import { useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { contentApi } from "@/lib/api/content";
import { contentMoveLabel } from "./content-labels";

/**
 * A CSELEKVÉS EGY SORON: lépés és hozzászólás.
 *
 * EZ A FÁJL EGYETLEN SZABÁLYT SEM TART. Nincs benne állapotnév, nincs benne
 * átmenet-tábla, és nincs benne az sem, hogy melyik lépés jóváhagyói. Mindezt a
 * sor hozza magával (`item.moves`), a szerverről, ahol mérve is van.
 *
 * MIÉRT SZÁMÍT EZ: ha a felület tartaná a listát, ugyanaz a szabály két helyen
 * állna, és a második egy nap csendben elavulna. A különbség egy olyan gombban
 * jelenne meg, ami elutasításba fut -- és a felhasználó azt tanulná meg, hogy a
 * gombok néha nem működnek.
 *
 * HÁROM DOLGOT KEZEL, AMIT A SZERVER MOND MEG:
 *
 *   1. `requiresApproval` -- jóváhagyói jog nélkül a lépés meg sem jelenik.
 *      Ez NEM a védelem: a kapu a szerveren van. Ez csak annyit tesz, hogy nem
 *      kínálunk fel valamit, amit a hívó úgysem tud végrehajtani.
 *   2. `blockedByExternalWork` -- a lépés látszik, de le van tiltva, ÉS ott áll
 *      az indok. Elrejteni rosszabb lenne: egy ütemezett poszt visszavonása
 *      valódi teendő, csak nem itt.
 *   3. az elvetés OKA kötelező, ahogy a szerveren is. Ok nélkül a gomb nem
 *      indul el, tehát a mező hiánya nem szerver-hibaként jelenik meg.
 */
export function ContentRowActions({
  item,
  onDone,
}: {
  item: ContentListItem;
  onDone: () => void;
}) {
  const { session } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [discardReason, setDiscardReason] = useState("");
  const [commenting, setCommenting] = useState(false);
  const [comment, setComment] = useState("");

  const token = session?.token ?? "";
  const canApprove = Boolean(
    session && hasPermission(session.user, PERMISSIONS.CONTENT_APPROVE),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.CONTENT_MANAGE),
  );

  // A MEZŐ HIÁNYÁVAL IS SZÁMOLUNK. A típus szerint mindig ott van, de az a
  // fordító ígérete: ami a dróton érkezik, azt egy régebbi szerver is
  // küldhette. Ilyenkor egyszerűen nincs lépés -- nem hasal el.
  const moves = item.moves ?? [];
  const offered = moves.filter(
    (move) => canManage && (!move.requiresApproval || canApprove),
  );

  async function run(move: ContentMoveOption, reason?: string) {
    setPending(true);
    setError(null);
    try {
      await contentApi.move(token, item.id, {
        from: item.state,
        to: move.to,
        requiresApproval: move.requiresApproval,
        ...(reason ? { discardReason: reason } : {}),
      });
      setDiscarding(false);
      setDiscardReason("");
      onDone();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A lépés nem sikerült.",
      );
    } finally {
      setPending(false);
    }
  }

  async function submitComment() {
    if (!comment.trim()) return;
    setPending(true);
    setError(null);
    try {
      await contentApi.comment(token, item.id, comment.trim());
      setComment("");
      setCommenting(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A hozzászólás nem mentődött el.",
      );
    } finally {
      setPending(false);
    }
  }

  // A HOZZÁSZÓLÁS `content.view` JOGON ÁLL, A LÉPÉS `content.manage`-en. Aki csak
  // nézhet, az tehát nem lát lépés-gombot, de hozzászólni tud -- és ez nem
  // engedmény: a lektori észrevétel pontosan attól ér valamit, hogy az is
  // leírhatja, aki magát a tételt nem mozgatja.
  if (!session) return null;

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
      <div className="flex flex-wrap items-center gap-2">
        {offered.map((move) => (
          <MoveButton
            key={move.to}
            move={move}
            pending={pending}
            onClick={() => {
              // AZ ELVETÉS OKOT KÍVÁN, tehát nem indul azonnal: előbb megnyílik
              // a mező. A `discardReason` kötelezőségét a szerver őrzi, ez
              // csak annyit tesz, hogy nem futunk bele szándékosan.
              if (move.to === "DISCARDED") setDiscarding(true);
              else void run(move);
            }}
          />
        ))}

        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => setCommenting((open) => !open)}
        >
          Hozzászólás
        </Button>
      </div>

      {discarding ? (
        <div className="flex w-full flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:w-72">
          <Textarea
            aria-label="Az elvetés oka"
            placeholder="Miért vetjük el?"
            value={discardReason}
            onChange={(event) => setDiscardReason(event.target.value)}
          />
          <div className="flex gap-2">
            <Button
              variant="danger"
              size="sm"
              // OK NÉLKÜL EL SEM INDUL. A szerver ugyanezt megtagadná, de akkor
              // a hiányzó mező szerver-hibaként jelenne meg, és a felhasználó
              // egy elrontott lépést látna egy hiányzó mező helyett.
              disabled={pending || !discardReason.trim()}
              onClick={() => {
                const move = offered.find(
                  (option) => option.to === "DISCARDED",
                );
                if (move) void run(move, discardReason.trim());
              }}
            >
              Elvetem
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                setDiscarding(false);
                setDiscardReason("");
              }}
            >
              Mégsem
            </Button>
          </div>
        </div>
      ) : null}

      {commenting ? (
        <div className="flex w-full flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:w-72">
          <Textarea
            aria-label="Hozzászólás"
            placeholder="Mit kell tudni erről a tételről?"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={pending || !comment.trim()}
              onClick={() => void submitComment()}
            >
              Elküldöm
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                setCommenting(false);
                setComment("");
              }}
            >
              Mégsem
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <Alert
          variant="danger"
          title="A lépés nem ment át"
          description={error}
        />
      ) : null}
    </div>
  );
}

/**
 * EGY LÉPÉS GOMBJA.
 *
 * A BLOKKOLT LÉPÉS LÁTSZIK, DE NEM INDÍTHATÓ, és az indok mellette áll. A másik
 * két lehetőség rosszabb: elrejtve senki nem tudná meg, hogy van teendő, engedve
 * pedig a szerver utasítaná el, és a gomb tanítaná meg, hogy néha nem működik.
 */
function MoveButton({
  move,
  pending,
  onClick,
}: {
  move: ContentMoveOption;
  pending: boolean;
  onClick: () => void;
}) {
  const blocked = move.blockedByExternalWork;
  return (
    <span className="flex flex-col gap-1">
      <Button
        // EGY KIEMELT LÉPÉS SORONKÉNT, A TÖBBI HALKÍTVA.
        //
        // MIÉRT NEM MIND A NÉGY EGYFORMA: egy jóváhagyásra váró soron három
        // lépés-gomb áll a hozzászólás mellett, és picasso lemérte, hogy négy
        // egyforma gomb 390 pixelen két sorba törik -- ráadásul semmi nem
        // mondja meg, mit akar tőlem a rendszer.
        //
        // MELYIK A KIEMELT, AZT A SZERVER DÖNTI EL (`primary`). Ha itt dőlne
        // el, minden képernyő maga találná ki, és a második találgatás egy nap
        // szétcsúszna az elsőtől.
        variant={move.primary ? "primary" : "ghost"}
        size="sm"
        className={
          move.primary ? undefined : "px-1 underline underline-offset-2"
        }
        disabled={pending || blocked !== null}
        title={blocked ?? undefined}
        onClick={onClick}
      >
        {contentMoveLabel(move.to)}
      </Button>
      {blocked ? (
        <span className="max-w-56 text-xs text-amber-700">{blocked}</span>
      ) : null}
    </span>
  );
}
