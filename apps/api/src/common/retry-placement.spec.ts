import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { describe, it } from "node:test";

import ts from "typescript";

/**
 * HOL ALLHAT UJRAPROBALKOZAS, ES HOL NEM.
 *
 * A ket burkolat (`withUniqueCode`, `retryOnTakenCode`) csak ott helyes, ahol a
 * tranzakcio MEGNYILIK. Beljebb nem: a PostgreSQL az elso elbukott utasitas
 * utan az egesz tranzakciot hasznalhatatlanna teszi, tehat egy tranzakcion
 * BELULI ujraprobalas nem tud sikerulni. Elkolti a probalkozasokat, a naplo ugy
 * nez ki, mintha probaltunk volna, es a hivo ugyanazt a hibat kapja, csak
 * kesobb.
 *
 * A szabaly ELLENORIZHETO, nem izles kerdese: ha egy fuggveny
 * `Prisma.TransactionClient` parametert kap, akkor valaki masenak a
 * tranzakciojaban fut. Ilyen ma a `syncWorksheetMirror` es a keszlet-mozgast
 * konyvelo segedfuggveny -- mindketto huz kodot, tehat mindketto kezenfekvo
 * hely lenne egy burkolatnak, es mindketton rossz lenne.
 *
 * A lista nem kezzel karbantartott: a lemezen levo fajlokat jarja be, tehat egy
 * holnap szuletett fuggveny attol kerul bele, hogy letezik.
 */

const WRAPPERS = new Set(["withUniqueCode", "retryOnTakenCode"]);

async function sourceFiles(): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of glob("src/**/*.ts"))
    if (!entry.endsWith(".spec.ts")) found.push(entry);
  return found.sort();
}

/// Egy fuggveny akkor fut MASENAK a tranzakciojaban, ha kap egy
/// tranzakcio-klienst. A tipus nevere illesztunk, nem a parameter nevere: a
/// `tx` elnevezes szokas, a tipus viszont teny.
function takesTransactionClient(
  parameters: readonly ts.ParameterDeclaration[],
  source: ts.SourceFile,
): boolean {
  return parameters.some(
    (parameter) =>
      parameter.type !== undefined &&
      /(^|\.)TransactionClient$/.test(parameter.type.getText(source).trim()),
  );
}

interface Placement {
  file: string;
  line: number;
  wrapper: string;
}

/// Minden olyan fuggvenyt megkeres, ami tranzakcio-klienst kap ES valamelyik
/// burkolatot hivja. A visszatero lista URES kell legyen.
function misplacedRetries(file: string, text: string): Placement[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true);
  const found: Placement[] = [];

  const wrapperCallsInside = (node: ts.Node): void => {
    const visit = (child: ts.Node): void => {
      if (
        ts.isCallExpression(child) &&
        WRAPPERS.has(child.expression.getText(source))
      ) {
        const { line } = source.getLineAndCharacterOfPosition(
          child.getStart(source),
        );
        found.push({
          file,
          line: line + 1,
          wrapper: child.expression.getText(source),
        });
      }
      ts.forEachChild(child, visit);
    };
    ts.forEachChild(node, visit);
  };

  const walk = (node: ts.Node): void => {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node)) &&
      takesTransactionClient(node.parameters, source)
    )
      wrapperCallsInside(node);
    ts.forEachChild(node, walk);
  };

  walk(source);
  return found;
}

describe("az ujraprobalkozas helye", () => {
  it("egyetlen tranzakcion BELUL futo fuggveny sem hiv burkolatot", async () => {
    const files = await sourceFiles();

    // Nulla talalat itt zold lenne, es azt allitana, hogy minden rendben --
    // kozben azt jelentene, hogy a bejaras romlott el.
    assert.ok(
      files.length >= 100,
      `Csak ${files.length} forrasfajlt talaltam. Ez a keresés hibaja, nem a kode.`,
    );

    const scanned = files.map((file) => ({
      file,
      text: readFileSync(file, "utf8"),
    }));

    // A MASODIK ORZO: legyen mit talalni. Ha egy nap a burkolatok neve
    // megvaltozik es ezt a fajlt senki nem koveti, a fenti allitas ettol meg
    // zold maradna -- ez a sor viszont pirosra valt.
    const usesWrapper = scanned.filter((entry) =>
      [...WRAPPERS].some((wrapper) =>
        new RegExp(`${wrapper}\\s*\\(`).test(entry.text),
      ),
    );
    assert.ok(
      usesWrapper.length >= 3,
      `Csak ${usesWrapper.length} fajl hivja valamelyik burkolatot. A neveket atirtak, vagy a keresés romlott el.`,
    );

    const misplaced = scanned.flatMap((entry) =>
      misplacedRetries(entry.file, entry.text),
    );

    assert.deepEqual(
      misplaced.map((entry) => `${entry.file}:${entry.line} ${entry.wrapper}`),
      [],
      "Ezek a hivasok masenak a tranzakciojan BELUL allnak, ahol az " +
        "ujraprobalas nem tud sikerulni. A burkolat oda valo, ahol a " +
        "tranzakcio megnyilik.",
    );
  });

  /**
   * A FALSZIFIKACIO. A fenti allitas akkor is zold lenne, ha a kereso semmit
   * nem tudna megtalalni. Ez a sor egy szandekosan ROSSZ fuggvenyt ad neki, es
   * megkoveteli, hogy megtalalja.
   */
  it("a kereso megtalalja a rossz helyre tett burkolatot", () => {
    const bad = `
      import { Prisma } from "@acropora/database";
      export async function mirror(tx: Prisma.TransactionClient, id: string) {
        return retryOnTakenCode({ field: "customerNumber" }, () =>
          tx.customer.create({ data: { id } }),
        );
      }
    `;

    const found = misplacedRetries("kitalalt.ts", bad);

    assert.equal(found.length, 1);
    assert.equal(found[0]?.wrapper, "retryOnTakenCode");
  });

  /**
   * ES A MASIK IRANY: a helyes alak NE legyen lelet. Egy fuggveny, ami maga
   * nyitja a tranzakciot, akkor is burkolatot hiv, ha idelent van egy
   * tranzakcio-klienst kapo lezar -- azt nem szabad megjelolni.
   */
  it("a tranzakciot NYITO hivast nem jeloli meg", () => {
    const good = `
      import { prisma } from "@acropora/database";
      export function update(id: string) {
        return retryOnTakenCode({ field: "customerNumber" }, () =>
          prisma.$transaction(async (tx) => tx.customer.update({ where: { id } })),
        );
      }
    `;

    assert.deepEqual(misplacedRetries("kitalalt.ts", good), []);
  });
});
