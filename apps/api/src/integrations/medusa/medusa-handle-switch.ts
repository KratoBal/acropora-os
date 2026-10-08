/**
 * A HANDLE ÁTKAPCSOLÁSA (SEO P0 PR 7d). A bolt termékcíme `/hu/termek/{handle}`,
 * és a handle a WEBSHOP-slug lesz (PR 5) a mai UNAS-alapú helyett. A kapcsoló
 * (`MEDUSA_HANDLE_FROM_WEBSHOP_SLUG`) önmagában egy terméket sem tesz esedékessé,
 * ezért az átkapcsolás egy külön parancs, egyszerre minden kötött termékre.
 *
 * A MEDUSA HANDLE EGYEDI, ezért a sorrend számít. Mérve a stage-en (PR 5 export):
 * 834 handle változik, és 6 terméknél az új handle ma egy MÁSIK termék handle-je.
 * Annak előbb el kell engednie. Kételemű kör 0, de a terv a hosszabbat is felismeri.
 */
export interface HandleSwitchRow {
  productId: string;
  medusaId: string;
  current: string;
  desired: string;
}

export interface HandleSwitchPlan {
  /** A kiírandó sorok, függőségi sorrendben. */
  order: HandleSwitchRow[];
  unchanged: number;
  /** Az új handle-t egy NEM mozgó termék tartja (a mi listánkon vagy azon kívül). */
  conflicts: { row: HandleSwitchRow; heldBy: string }[];
  /** Körben álló sorok (A a B-é, B az A-é); egyik sem írható. */
  cycles: HandleSwitchRow[];
  /** Egy ütköző vagy körben álló sorra várnak, tehát most nem írhatók. */
  blocked: HandleSwitchRow[];
}

/**
 * `rows`: a kötött termékek, a mai és a kívánt handle-lel. `allHandles`: a bolt
 * MINDEN termékének mai handle-je (handle → Medusa id), a nem kötötteké is,
 * mert egy idegen termék is foglalhatja a kívánt címet.
 */
export function planHandleSwitch(
  rows: readonly HandleSwitchRow[],
  allHandles: ReadonlyMap<string, string>,
): HandleSwitchPlan {
  const valtozik = rows.filter((r) => r.current !== r.desired);
  const plan: HandleSwitchPlan = {
    order: [],
    unchanged: rows.length - valtozik.length,
    conflicts: [],
    cycles: [],
    blocked: [],
  };
  const mozgoMedusaId = new Map(valtozik.map((r) => [r.medusaId, r]));

  // A → B: A csak B után írható (A kívánt handle-jét ma B tartja, és B mozog)
  const elofeltetel = new Map<string, string>();
  const kizart = new Set<string>();
  for (const r of valtozik) {
    const tarto = allHandles.get(r.desired);
    if (!tarto || tarto === r.medusaId) continue;
    if (mozgoMedusaId.has(tarto)) elofeltetel.set(r.medusaId, tarto);
    else {
      plan.conflicts.push({ row: r, heldBy: tarto });
      kizart.add(r.medusaId);
    }
  }

  // kör: az előfeltétel-lánc visszaér önmagába
  for (const r of valtozik) {
    if (kizart.has(r.medusaId)) continue;
    const lanc = new Set<string>([r.medusaId]);
    let kov = elofeltetel.get(r.medusaId);
    while (kov && !lanc.has(kov)) {
      lanc.add(kov);
      kov = elofeltetel.get(kov);
    }
    if (kov === r.medusaId) plan.cycles.push(r);
  }
  for (const r of plan.cycles) kizart.add(r.medusaId);

  // ami (közvetve) kizártra vár, az blokkolt
  const blokkolt = (id: string, latott = new Set<string>()): boolean => {
    const elo = elofeltetel.get(id);
    if (!elo || latott.has(id)) return false;
    latott.add(id);
    return kizart.has(elo) || blokkolt(elo, latott);
  };
  const irhato = valtozik.filter((r) => !kizart.has(r.medusaId));
  for (const r of irhato) if (blokkolt(r.medusaId)) plan.blocked.push(r);
  const blokkoltIds = new Set(plan.blocked.map((r) => r.medusaId));

  // sorrend: előbb, akire várnak (mélységi bejárás az előfeltételen)
  const kesz = new Set<string>();
  const sorba = (r: HandleSwitchRow) => {
    if (kesz.has(r.medusaId)) return;
    const elo = elofeltetel.get(r.medusaId);
    const eloSor = elo ? mozgoMedusaId.get(elo) : undefined;
    if (eloSor) sorba(eloSor);
    kesz.add(r.medusaId);
    plan.order.push(r);
  };
  for (const r of irhato) if (!blokkoltIds.has(r.medusaId)) sorba(r);
  return plan;
}

export function describeHandleSwitch(plan: HandleSwitchPlan): string {
  return [
    `Handle: valtozik ${plan.order.length + plan.conflicts.length + plan.cycles.length + plan.blocked.length}, valtozatlan ${plan.unchanged}`,
    `Irhato (fuggosegi sorrendben): ${plan.order.length}; ebbol egy masik termekre var: ${plan.order.filter((r, i) => plan.order.slice(0, i).some((e) => e.current === r.desired)).length}`,
    `Utkozes (nem mozgo termek tartja): ${plan.conflicts.length}; kor: ${plan.cycles.length}; blokkolt: ${plan.blocked.length}`,
    ...plan.conflicts.map(
      (c) =>
        `  utkozes: ${c.row.productId} ${c.row.current} -> ${c.row.desired} (tartja: ${c.heldBy})`,
    ),
    ...plan.cycles.map(
      (r) => `  kor: ${r.productId} ${r.current} -> ${r.desired}`,
    ),
    ...plan.blocked.map(
      (r) => `  blokkolt: ${r.productId} ${r.current} -> ${r.desired}`,
    ),
    "",
  ].join("\n");
}
