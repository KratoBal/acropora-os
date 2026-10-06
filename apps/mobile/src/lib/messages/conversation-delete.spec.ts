import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { parseSseChunk } from "./sse";
import { refreshesUnread } from "./unread-badge";

/*
  A BESZÉLGETÉS TÖRLÉSE A TELEFONON (fecbb1fe). MI PIROSÍT: ha a folyam a
  törlés-eseményt eldobja (a lista és a jelvény nem frissül); ha a gomb nem a
  szerver `canDelete` jelzésére áll; ha megerősítés nélkül töröl, vagy a
  kérdés nem nevezi meg a beszélgetést; ha a nyitott beszélgetés a törlés
  után nyitva marad.
*/
describe("deleting a conversation on the phone", () => {
  it("the stream keeps the deletion event, and the unread badge refreshes on it", () => {
    const { signals } = parseSseChunk(
      'event: conversation.deleted\ndata: {"type":"conversation.deleted","conversationId":"c1"}\n\n',
    );
    assert.deepEqual(signals, [
      { type: "conversation.deleted", conversationId: "c1" },
    ]);
    assert.equal(refreshesUnread({ type: "conversation.deleted" }), true);
  });

  it("the details screen offers it only when allowed, asks first with the name, then goes back to the list", () => {
    const source = readFileSync("src/app/uzenetek/adatok.tsx", "utf8");
    assert.match(
      source,
      /\{conversation\.canDelete \? \([\s\S]{0,200}onPress=\{confirmDelete\}/,
    );
    assert.match(
      source,
      /Alert\.alert\(\s*`Törlöd a\(z\) „\$\{name\}” beszélgetést\?`/,
    );
    assert.match(
      source,
      /deleteConversation\(id!\)[\s\S]{0,200}router\.dismissTo\("\/uzenetek"\)/,
    );
  });

  it("the open conversation leaves for the list when it is deleted elsewhere", () => {
    const source = readFileSync("src/app/uzenetek/[id].tsx", "utf8");
    assert.match(
      source,
      /signal\.type === "conversation\.deleted" &&\s*signal\.conversationId === id[\s\S]{0,200}router\.dismissTo\("\/uzenetek"\)/,
    );
  });
});
