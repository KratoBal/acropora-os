import type { ContentDetail, ContentStateEvent } from "@acropora/types";
import { describe, expect, it } from "vitest";

import { describeContentEvent, describeContentSent } from "./content-history";

/*
  WHAT TURNS THIS RED (T5.1, the log's line and the sent line). The line without the actor, the old state, the new state or the
  note; a creation shown with a "from"; a missing name shown blank (the id stays, and "ismeretlen" when there is no id either);
  an unknown state breaking the line; the sent line without the channel, or taking the time of a move that is not the sent one,
  or inventing a time when none is known.
*/
const event = (over: Partial<ContentStateEvent> = {}): ContentStateEvent => ({
  id: "e",
  fromState: "AWAITING_REVIEW",
  toState: "AWAITING_APPROVAL",
  actorUserId: "u-1",
  actorName: "Luca",
  note: null,
  createdAt: "2026-11-04T13:30:00.000Z",
  ...over,
});

describe("describeContentEvent", () => {
  it("time, who, from → to", () => {
    expect(describeContentEvent(event())).toBe(
      "2026. 11. 04. 14:30 Luca: lektorálásra vár → jóváhagyásra vár",
    );
  });

  it("the note goes in quotes at the end, trimmed; an empty note adds nothing", () => {
    expect(describeContentEvent(event({ note: "  az ár hiányzik " }))).toMatch(
      /→ jóváhagyásra vár, „az ár hiányzik”$/,
    );
    expect(describeContentEvent(event({ note: "   " }))).not.toMatch(/„/);
  });

  it("a creation has no from", () => {
    expect(
      describeContentEvent(event({ fromState: null, toState: "DRAFTING" })),
    ).toMatch(/Luca: létrehozta \(vázlat készül\)$/);
  });

  it("a missing name keeps the id, and with no id it is unknown; an unknown state shows its raw name", () => {
    expect(describeContentEvent(event({ actorName: null }))).toMatch(/ u-1: /);
    expect(
      describeContentEvent(event({ actorName: null, actorUserId: null })),
    ).toMatch(/ ismeretlen: /);
    expect(
      describeContentEvent(
        event({
          toState: "FUTURE_STATE" as unknown as ContentStateEvent["toState"],
        }),
      ),
    ).toMatch(/→ FUTURE_STATE$/);
  });
});

describe("describeContentSent", () => {
  const base = (over: Partial<ContentDetail> = {}) => ({
    state: "SENT" as const,
    channel: "FACEBOOK_POST" as const,
    history: [] as ContentStateEvent[],
    sentAt: null as string | null,
    ...over,
  });

  it("nothing for an item that has not gone out", () => {
    expect(describeContentSent(base({ state: "READY_TO_SEND" }))).toBeNull();
  });

  it("the time of the LAST sent move and the channel", () => {
    expect(
      describeContentSent(
        base({
          history: [
            event({ toState: "SENT", createdAt: "2026-11-05T09:00:00.000Z" }),
            event({
              toState: "AWAITING_REVISION",
              createdAt: "2026-11-06T09:00:00.000Z",
            }),
            event({ toState: "SENT", createdAt: "2026-11-07T09:00:00.000Z" }),
          ],
        }),
      ),
    ).toBe("Kiment: 2026. 11. 07. 10:00 · Facebook poszt");
  });

  it("with no sent move in the log it takes sentAt, and without that it admits the time is unknown", () => {
    expect(
      describeContentSent(base({ sentAt: "2026-10-01T08:00:00.000Z" })),
    ).toBe("Kiment: 2026. 10. 01. 10:00 · Facebook poszt");
    expect(describeContentSent(base({ channel: "OTHER" }))).toBe(
      "Kiment: Egyéb (az időpontot nem ismerjük: a napló bevezetése előtt történt)",
    );
  });
});
