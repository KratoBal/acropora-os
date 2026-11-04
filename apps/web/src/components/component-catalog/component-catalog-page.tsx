"use client";

import {
  Alert,
  EmptyState,
  Icon,
  PageHeader,
  Pagination,
  PilotAvatar,
  PilotAvatarStack,
  PilotBadge,
  type PilotBadgeVariant,
  PilotButton,
  PilotCallout,
  PilotCard,
  PilotCardHeader,
  PilotDataGrid,
  PilotDataItem,
  PilotDataRow,
  PilotDataTable,
  PilotDateField,
  PilotDialog,
  PilotDrawer,
  PilotFileInput,
  PilotFormField,
  PilotInput,
  PilotLinkTabs,
  PilotMonthField,
  PilotPairedRows,
  PilotRadioGroup,
  PilotSection,
  PilotSegmentedControl,
  PilotSelect,
  type PilotTableColumn,
  PilotThemeRoot,
  PilotThumbnail,
  PilotTimeline,
  PilotTotals,
  PilotVariableChips,
  Skeleton,
} from "@acropora/ui";
import { formatMoney } from "@acropora/types";
import { useState, type ReactNode } from "react";

/*
  ÉLŐ KOMPONENS-KATALÓGUS (T1.4, kártya 17cd4dbc). A közös pilot készlet minden darabja, a fő állapotaival, egyetlen
  lapon. Egy design-kört így egy lap három szélességű képéből (ui-screens.yml) is ellenőrizni lehet, nem 98 lapból.
  A lap nem kér adatot és nem ír: minden érték helyben áll, a mezők állapota csak a böngészőben él.

  AMI IDE KERÜL: a pilot készlet és a párja nélküli közös darabok (Alert, EmptyState, Skeleton, Pagination). A dusk
  ikreket szándékosan nem mutatja: azok kivezetés alatt állnak (T1.3, no-dusk-twin-in-pilot.test.ts).
*/

const BUTTON_VARIANTS = ["primary", "secondary", "ghost", "danger"] as const;
const BUTTON_SIZES = ["md", "lg", "action", "regular"] as const;
const BADGE_VARIANTS: readonly PilotBadgeVariant[] = [
  "default",
  "teal",
  "grey",
  "amber",
  "blue",
  "success",
  "danger",
];

interface MintaSor {
  id: string;
  nev: string;
  allapot: { szoveg: string; tonus: PilotBadgeVariant };
  osszeg: number;
}

const SOROK: readonly MintaSor[] = [
  {
    id: "1",
    nev: "Acropora millepora, kék",
    allapot: { szoveg: "Kész", tonus: "success" },
    osszeg: 24900,
  },
  {
    id: "2",
    nev: "Egy nagyon hosszú terméknév, ami telefonon is törni fog, mert ilyen a valóság",
    allapot: { szoveg: "Várakozik", tonus: "amber" },
    osszeg: 1290,
  },
  {
    id: "3",
    nev: "Vízcsere szerviz",
    allapot: { szoveg: "Lemondva", tonus: "danger" },
    osszeg: 0,
  },
];

const OSZLOPOK: readonly PilotTableColumn<MintaSor>[] = [
  { id: "nev", header: "Név", phone: "title", cell: (sor) => sor.nev },
  {
    id: "allapot",
    header: "Állapot",
    nowrap: true,
    cell: (sor) => (
      <PilotBadge variant={sor.allapot.tonus}>{sor.allapot.szoveg}</PilotBadge>
    ),
  },
  {
    id: "osszeg",
    header: "Összeg",
    align: "right",
    nowrap: true,
    cell: (sor) => formatMoney(sor.osszeg, "HUF"),
  },
];

function Minta({ cim, children }: { cim: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-[0.05em] text-pilot-grey-500">
        {cim}
      </p>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        {children}
      </div>
    </div>
  );
}

export function ComponentCatalogPage() {
  const [szoveg, setSzoveg] = useState("Kitöltött érték");
  const [valasztas, setValasztas] = useState("b");
  const [datum, setDatum] = useState("");
  const [szegmens, setSzegmens] = useState("Mind");
  const [oldal, setOldal] = useState(2);
  const [honap, setHonap] = useState("2026-11");
  const [radio, setRadio] = useState<"egy" | "ketto">("egy");
  const [beszurt, setBeszurt] = useState("");
  const [dialogus, setDialogus] = useState(false);
  const [fiok, setFiok] = useState(false);

  return (
    <PilotThemeRoot className="space-y-6">
      <PageHeader
        eyebrow="Fejlesztés"
        title="Komponens-katalógus"
        description="A közös pilot készlet minden darabja a fő állapotaival. Design-kör ellenőrzéséhez: egy lap három szélességen."
        meta={<PilotBadge variant="teal">Belső lap</PilotBadge>}
        actions={
          <>
            <PilotButton variant="secondary">Másodlagos</PilotButton>
            <PilotButton>Elsődleges művelet</PilotButton>
          </>
        }
      />

      <PilotSection
        title="Gombok"
        subtitle="Változat és méret, és a letiltott állapot."
      >
        <div className="space-y-5">
          {BUTTON_SIZES.map((meret) => (
            <Minta key={meret} cim={`Méret: ${meret}`}>
              {BUTTON_VARIANTS.map((valtozat) => (
                <PilotButton key={valtozat} variant={valtozat} size={meret}>
                  {valtozat}
                </PilotButton>
              ))}
              <PilotButton size={meret} disabled title="Letiltva: ez a súgó">
                letiltva
              </PilotButton>
            </Minta>
          ))}
          <Minta cim="Teljes szélesség">
            <div className="w-full max-w-sm">
              <PilotButton fullWidth>Teljes szélességű gomb</PilotButton>
            </div>
          </Minta>
        </div>
      </PilotSection>

      <PilotSection title="Jelvények és avatárok">
        <div className="space-y-5">
          <Minta cim="Jelvény">
            {BADGE_VARIANTS.map((valtozat) => (
              <PilotBadge key={valtozat} variant={valtozat}>
                {valtozat}
              </PilotBadge>
            ))}
          </Minta>
          <Minta cim="Avatár">
            <PilotAvatar initials="BK" color="#0E7C86" />
            <PilotAvatar initials="LM" color="#A2491A" size="sm" />
            <PilotAvatarStack
              people={[
                { userId: "1", name: "Kiss Anna" },
                { userId: "2", name: "Nagy Béla" },
                { userId: "3", name: "Tóth Csilla" },
                { userId: "4", name: "Varga Dénes" },
              ]}
              max={3}
            />
          </Minta>
          <Minta cim="Bélyegkép kép nélkül">
            <PilotThumbnail fallback={{ kind: "icon", icon: "package" }} />
            <PilotThumbnail fallback={{ kind: "monogram", text: "FM" }} />
            <PilotThumbnail fallback={{ kind: "generic" }} />
          </Minta>
        </div>
      </PilotSection>

      <PilotSection
        title="Űrlapmezők"
        subtitle="Üres, kitöltött, csak olvasható és letiltott állapot."
      >
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <PilotFormField label="Üres mező" help="Segítő szöveg a mező alatt.">
            <PilotInput placeholder="Írj ide valamit" />
          </PilotFormField>
          <PilotFormField label="Kitöltött, kötelező" required>
            <PilotInput value={szoveg} onChange={setSzoveg} />
          </PilotFormField>
          <PilotFormField label="Csak olvasható">
            <PilotInput value="Nem szerkeszthető" readOnly />
          </PilotFormField>
          <PilotFormField label="Letiltva">
            <PilotInput value="Letiltott mező" disabled />
          </PilotFormField>
          <PilotFormField label="Kereső ikonnal">
            <PilotInput
              placeholder="Keresés"
              leadingIcon={<Icon name="search" size={16} />}
            />
          </PilotFormField>
          <PilotFormField label="Választó">
            <PilotSelect value={valasztas} onChange={setValasztas}>
              <option value="a">Első lehetőség</option>
              <option value="b">Második lehetőség</option>
              <option value="c">Harmadik, hosszabb lehetőség</option>
            </PilotSelect>
          </PilotFormField>
          <PilotFormField label="Dátum">
            <PilotDateField value={datum} onChange={setDatum} />
          </PilotFormField>
          <PilotFormField label="Letiltott választó">
            <PilotSelect value="a" disabled>
              <option value="a">Nem választható</option>
            </PilotSelect>
          </PilotFormField>
        </div>
        <div className="mt-5">
          <Minta cim="Szegmens-vezérlő">
            <PilotSegmentedControl
              options={["Mind", "Nyitott", "Lezárt"]}
              value={szegmens}
              onChange={setSzegmens}
            />
          </Minta>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
          <PilotFormField label="Hónap">
            <PilotMonthField value={honap} onChange={setHonap} />
          </PilotFormField>
          <PilotFormField label="Fájl">
            <PilotFileInput aria-label="Fájl kiválasztása" />
          </PilotFormField>
          <PilotRadioGroup
            name="katalogus-radio"
            label="Rádiócsoport"
            options={[
              { value: "egy", label: "Első lehetőség" },
              { value: "ketto", label: "Második lehetőség" },
            ]}
            value={radio}
            onChange={setRadio}
            hint="A súgó a csoport alatt áll."
          />
          <div className="space-y-2">
            <PilotVariableChips
              label="Változók"
              variables={["{{vevo_neve}}", "{{rendelesszam}}"]}
              onInsert={(valtozo) => setBeszurt(valtozo)}
            />
            <p className="text-xs text-pilot-grey-500">
              {beszurt ? `Beszúrva: ${beszurt}` : "Kattints egy változóra."}
            </p>
          </div>
        </div>
      </PilotSection>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PilotCard>
          <PilotCardHeader
            title="Kártya fejléccel"
            action={<PilotButton variant="ghost">Szerkesztés</PilotButton>}
          />
          <div className="space-y-4 p-5">
            <PilotDataGrid columns={2}>
              <PilotDataItem label="Kitöltött adat">
                Acropora Kft.
              </PilotDataItem>
              <PilotDataItem label="Üres adat" />
              <PilotDataItem label="Cikkszám" mono>
                ACR-0042
              </PilotDataItem>
              <PilotDataItem label="Súgóval" hint="A súgó az érték alatt áll.">
                Igen
              </PilotDataItem>
            </PilotDataGrid>
            <PilotDataRow label="Adatsor" value="Egy címke és egy érték" />
          </div>
        </PilotCard>
        <PilotCard>
          <PilotCardHeader title="Összesítő" />
          <div className="p-5">
            <PilotTotals
              rows={[
                { label: "Nettó", value: formatMoney(19606, "HUF") },
                { label: "ÁFA (27%)", value: formatMoney(5294, "HUF") },
                {
                  label: "Bruttó",
                  value: formatMoney(24900, "HUF"),
                  emphasis: true,
                },
              ]}
            />
          </div>
        </PilotCard>
      </div>

      <PilotSection
        title="Táblázat"
        subtitle="Telefonon a név a sor címe, a többi oszlop alá kerül."
      >
        <PilotDataTable
          columns={OSZLOPOK}
          rows={SOROK}
          rowKey={(sor) => sor.id}
          minWidth={560}
        />
        <div className="mt-4">
          <Pagination
            page={oldal}
            totalPages={5}
            onPageChange={setOldal}
            variant="directionF"
          />
        </div>
      </PilotSection>

      <PilotSection title="Üres, betöltés és hiba">
        <div className="space-y-5">
          <EmptyState
            title="Nincs még tétel"
            description="Az üres állapot szövege megmondja, mi a következő lépés."
            action={<PilotButton>Új tétel</PilotButton>}
          />
          <div className="space-y-2" aria-label="Betöltés">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
          </div>
          <Alert
            title="Tájékoztatás"
            description="Egy semleges üzenet a lap tetején."
          />
          <Alert
            variant="danger"
            title="Hiba történt"
            description="A hibaüzenet megmondja, mi romlott el, és mit lehet tenni."
          />
          <PilotCallout
            tone="warm"
            title="Figyelmet igényel"
            description="Kiemelt felhívás egy művelettel."
            action={<PilotButton variant="secondary">Megnézem</PilotButton>}
          />
          <PilotCallout
            tone="aqua"
            title="Tipp"
            description="A második, hidegebb tónus."
          />
        </div>
      </PilotSection>

      <PilotSection title="Fülek, páros sorok, rétegek">
        <div className="space-y-5">
          <PilotLinkTabs
            label="Minta fülek"
            tabs={[
              {
                href: "/beallitasok/komponensek",
                label: "Aktív fül",
                active: true,
              },
              { href: "/beallitasok", label: "Másik fül", active: false },
            ]}
          />
          <PilotPairedRows
            rows={[
              { id: "1", main: "Fő oszlop tartalma", side: "Oldalsó érték" },
              { id: "2", main: "Oldalsó érték nélküli sor" },
            ]}
          />
          <Minta cim="Párbeszédablak és fiók">
            <PilotButton variant="secondary" onClick={() => setDialogus(true)}>
              Párbeszédablak megnyitása
            </PilotButton>
            <PilotButton variant="secondary" onClick={() => setFiok(true)}>
              Fiók megnyitása
            </PilotButton>
          </Minta>
          <PilotDialog open={dialogus} onClose={() => setDialogus(false)}>
            <div className="space-y-4 p-6">
              <p className="text-sm text-pilot-grey-700">
                Egy párbeszédablak tartalma.
              </p>
              <PilotButton onClick={() => setDialogus(false)}>
                Bezárás
              </PilotButton>
            </div>
          </PilotDialog>
          <PilotDrawer
            open={fiok}
            onClose={() => setFiok(false)}
            title="Fiók címe"
            subtitle="Alcím a cím alatt"
            footer={
              <PilotButton onClick={() => setFiok(false)}>Kész</PilotButton>
            }
          >
            <p className="text-sm text-pilot-grey-700">A fiók tartalma.</p>
          </PilotDrawer>
        </div>
      </PilotSection>

      <PilotSection title="Idővonal">
        <PilotTimeline
          items={[
            {
              key: "1",
              text: "A munkalap létrejött",
              meta: "Ügyintéző, 09:12",
            },
            { key: "2", text: "Állapot: folyamatban", meta: "Szerviz, 10:40" },
            { key: "3", text: "Lezárva, a számla elkészült", meta: "14:05" },
          ]}
        />
      </PilotSection>
    </PilotThemeRoot>
  );
}
