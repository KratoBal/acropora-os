"use client";

import { Alert, Button } from "@acropora/ui";
import { useEffect, useState } from "react";

import { ReefClubApiError, rc } from "@/lib/api";
import { tokenFromHash } from "@/lib/hash-token";

type State =
  | { status: "reading" }
  | { status: "ready"; key: string }
  | { status: "working"; key: string }
  | { status: "done"; already: boolean }
  | { status: "failed"; message: string };

/**
 * THE UNSUBSCRIBE LINK OF A RUN-OUT REMINDER MAIL: `/emlekezteto-leiratkozas#token=<key>` (ReefClub V3.2, slice 3c). The key is
 * in the fragment, which the browser never sends to a server or in a Referer header, and it is removed from the address bar
 * right after it is read.
 *
 * THE UNSUBSCRIBE IS A BUTTON, NOT THE PAGE LOAD: a mail program's link checker opens every link of a mail, some of them run the
 * page's script too, and an unsubscribe on load would stop the reminder before the member read the mail. No session is needed:
 * the key alone names the one reminder (POST /rc/v1/runout-reminders/unsubscribe).
 */
export function RunOutUnsubscribe() {
  const [state, setState] = useState<State>({ status: "reading" });

  useEffect(() => {
    const key = tokenFromHash(window.location.hash);
    window.history.replaceState(null, "", window.location.pathname);
    setState(
      key
        ? { status: "ready", key }
        : {
            status: "failed",
            message:
              "Ez a link hibás: nincs benne leiratkozó kód. Nyisd meg újra a levélből.",
          },
    );
  }, []);

  async function unsubscribe(key: string) {
    setState({ status: "working", key });
    try {
      const answer = await rc<{ outcome: string }>(
        "POST",
        "/runout-reminders/unsubscribe",
        { body: { key } },
      );
      setState({
        status: "done",
        already: answer?.outcome === "ALREADY_UNSUBSCRIBED",
      });
    } catch (cause) {
      setState({
        status: "failed",
        message:
          cause instanceof ReefClubApiError || cause instanceof Error
            ? cause.message
            : "A leiratkozás nem sikerült.",
      });
    }
  }

  if (state.status === "reading") return null;
  if (state.status === "failed")
    return (
      <Alert
        variant="danger"
        title="A leiratkozás nem sikerült"
        description={state.message}
      />
    );
  if (state.status === "done")
    return (
      <Alert
        title={state.already ? "Már korábban leiratkoztál" : "Leiratkoztál"}
        description="Erről a termékről nem kapsz több kifogyási emlékeztetőt. Bármikor újra kérheted."
      />
    );
  return (
    <div className="space-y-4">
      <p className="text-sm text-pilot-grey-600">
        Ha leiratkozol, erről a termékről nem kapsz több kifogyási emlékeztetőt.
        A többi emlékeztetődet ez nem érinti.
      </p>
      <Button
        disabled={state.status === "working"}
        onClick={() => void unsubscribe(state.key)}
      >
        Leiratkozom
      </Button>
    </div>
  );
}
