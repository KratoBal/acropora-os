import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/*
  A 2d BEKÖTÉSE (kártya 34753075): a tiszta függvények a képernyőn és a
  buborékban tényleg hívódnak. Hívás-alakra illeszt, nem puszta névre: egy
  import maga nem tartja zölden.
*/
const read = (path: string) => readFileSync(path, "utf8");
const SCREEN = read("src/app/uzenetek/[id].tsx");
const BUBBLE = read("src/components/messages/MessageBubble.tsx");

describe("Messages 2d wiring", () => {
  it("the attach panel offers the file picker, and the screen feeds it to the upload queue", () => {
    assert.match(
      BUBBLE,
      /label="Fájl kiválasztása"[\s\S]{0,80}onPress=\{onFile\}/,
    );
    assert.match(SCREEN, /onFile=\{\(\) => void addPickedDocuments\(\)\}/);
    assert.match(SCREEN, /toPickedDocuments\(result\.assets\)/);
  });

  it("a file attachment opens through openAttachment, and the web-only sentence is gone", () => {
    assert.match(BUBBLE, /onPress=\{\(\) => onOpenFile\(attachment\)\}/);
    assert.doesNotMatch(BUBBLE, /webes felületen/);
    assert.match(
      SCREEN,
      /openAttachment\(\s*\{[\s\S]{0,200}\},\s*openAttachmentDeps,?\s*\)/,
    );
  });

  it("Copy is offered for a text message only, and copies that text", () => {
    assert.match(
      BUBBLE,
      /\{message\.text && !message\.deleted \? \(\s*<PanelButton\s*label="Másolás"/,
    );
    assert.match(SCREEN, /void copyText\(text\)/);
  });
});
