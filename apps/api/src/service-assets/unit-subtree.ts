import type { UnitRow } from "./unit-path.js";

/**
 * EGY ALEGYSÉG ÉS MINDEN ALATTA LÉVŐ CSOMÓPONT AZONOSÍTÓJA.
 *
 * MIÉRT A RÉSZFA, ÉS NEM A PONTOS EGYEZÉS. Az eszköz a fa BÁRMELYIK
 * csomópontjához köthető, nem csak levélhez -- ez a séma kimondott döntése
 * (`Asset.departmentId` jegyzete), hogy egy új alcsomópont felvétele ne
 * árvítsa el a fölötte lógó eszközöket. Ebből következik, hogy a „mi van a
 * Biodómban" kérdésre a pontos egyezés ROSSZ választ ad: a Biodóm alatti Nagy
 * főkamedencén lógó eszközöket kihagyná, és a lista attól még szabályosnak
 * látszana. Ez a néma alak, nem a hangos.
 *
 * A FORDÍTOTT HIBA OLCSÓBB: ha valaki tényleg csak a csomóponton közvetlenül
 * lógó eszközöket akarja, az egy szűkebb kérdés, és látja, hogy többet kapott.
 * Aki viszont hiányos listát kap, nem látja, hogy hiányzik valami.
 *
 * TISZTA FÜGGVÉNY, adatbázis nélkül, ugyanúgy, mint a `buildUnitPaths`: a hívó
 * tölti be a sorokat egy kötegben, ez pedig csak bejárja őket. Így a mély fa és
 * a körvédelem is egységteszttel mérhető.
 */
export function collectUnitSubtreeIds(
  units: readonly UnitRow[],
  rootId: string,
): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const unit of units) {
    if (!unit.parentId) continue;
    const siblings = childrenByParent.get(unit.parentId);
    if (siblings) siblings.push(unit.id);
    else childrenByParent.set(unit.parentId, [unit.id]);
  }

  // A GYÖKÉR AKKOR IS BENNE VAN, HA NEM SZEREPEL A SOROK KÖZÖTT. A hívó a
  // partner saját sorait tölti be; ha a kért azonosító nem közülük való, a
  // szűrő egyetlen sorra szűkül, ami nem létezik -- vagyis üres eredmény. Ez
  // helyes: egy ismeretlen alegységre kérdezve NEM a teljes lista a válasz.
  const collected = [rootId];
  const seen = new Set<string>([rootId]);

  // Szélességi bejárás, `seen` őrzővel: egy körré záródott szülő-lánc (adathiba)
  // itt megáll, nem fagyasztja le a kérést. Ugyanaz a védekezés, mint a
  // `buildUnitPaths` felfelé haladó ciklusában.
  for (let index = 0; index < collected.length; index += 1) {
    for (const childId of childrenByParent.get(collected[index]!) ?? []) {
      if (seen.has(childId)) continue;
      seen.add(childId);
      collected.push(childId);
    }
  }

  return collected;
}
