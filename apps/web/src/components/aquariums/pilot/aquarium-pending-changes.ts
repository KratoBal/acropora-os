import type {
  AquariumEquipment,
  AquariumMaintainer,
  CreateAquariumEquipmentInput,
} from "@acropora/types";

/**
 * AZ AKVÁRIUM ADATLAPJÁN EGY MENTÉS VAN (picasso leltár 3.22, acrobot döntése 2026-11-26). Eddig két mentési modell állt egy lapon:
 * a mezők az alsó Mentéssel mentek, a karbantartó-pill és a berendezés hozzáadása vagy törlése viszont kattintásra, azonnal. Most a
 * karbantartók és a berendezések is a lapon várnak, és a Mentés viszi őket, ugyanúgy, mint az Új akvárium űrlapon. Ez a modul mondja
 * meg, mi vár mentésre a legutóbb mentett állapothoz képest.
 *
 * A még nem mentett berendezés helyi azonosítót kap (`LOCAL_EQUIPMENT_PREFIX`), a szerver a mentéskor ad valódit.
 */
export const LOCAL_EQUIPMENT_PREFIX = "helyi-";

export function isLocalEquipment(row: Pick<AquariumEquipment, "id">): boolean {
  return row.id.startsWith(LOCAL_EQUIPMENT_PREFIX);
}

/** A mentett listához képest: mely mentett sorok törlődnek, és mely helyi sorok kerülnek fel. */
export function equipmentChanges(
  saved: AquariumEquipment[],
  local: AquariumEquipment[],
): { remove: string[]; add: AquariumEquipment[] } {
  const localIds = new Set(local.map((row) => row.id));
  return {
    remove: saved.filter((row) => !localIds.has(row.id)).map((row) => row.id),
    add: local.filter(isLocalEquipment),
  };
}

export function sameMaintainers(
  a: AquariumMaintainer[],
  b: AquariumMaintainer[],
): boolean {
  const ids = (list: AquariumMaintainer[]) =>
    list
      .map((m) => m.userId)
      .sort()
      .join(",");
  return ids(a) === ids(b);
}

/** Ami mentésre vár, a felület szavaival ("a berendezések", "a karbantartók"); üres, ha semmi. */
export function pendingParts(input: {
  savedEquipment: AquariumEquipment[];
  equipment: AquariumEquipment[];
  savedMaintainers: AquariumMaintainer[];
  maintainers: AquariumMaintainer[];
}): string[] {
  const { remove, add } = equipmentChanges(
    input.savedEquipment,
    input.equipment,
  );
  return [
    ...(remove.length || add.length ? ["a berendezések"] : []),
    ...(sameMaintainers(input.savedMaintainers, input.maintainers)
      ? []
      : ["a karbantartók"]),
  ];
}

/** Egy helyi sorból a szervernek küldhető bemenet (az azonosító nélkül). */
export function equipmentInput(
  row: AquariumEquipment,
): CreateAquariumEquipmentInput {
  return {
    kind: row.kind,
    manufacturer: row.manufacturer,
    model: row.model,
    quantity: row.quantity,
    channelCount: row.channelCount,
    notes: row.notes,
  };
}
