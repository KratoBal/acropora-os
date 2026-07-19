import { EmptyState, Icon, PageHeader } from "@acropora/ui";
import { notFound } from "next/navigation";

const sections = {
  feladataim: {
    title: "Feladataim",
    description:
      "Személyes és csapatszintű feladatok, határidők és prioritások.",
    icon: "clipboard" as const,
  },
  webshop: {
    title: "Webshop",
    description: "UNAS rendelések, szinkronizációk és webshopműveletek.",
    icon: "store" as const,
  },
  pos: {
    title: "POS",
    description: "Bolti értékesítés, pénztár és napi zárások.",
    icon: "credit-card" as const,
  },
  termekek: {
    title: "Termékek",
    description: "A teljes terméktörzs, árak, vonalkódok és kategóriák.",
    icon: "package" as const,
  },
  vevok: {
    title: "Vevők",
    description: "Ügyféladatok, vásárlási előzmények és kapcsolattartás.",
    icon: "users" as const,
  },
  raktar: {
    title: "Raktár",
    description: "Készletek, raktárhelyek, mozgások és leltározás.",
    icon: "warehouse" as const,
  },
  beszerzes: {
    title: "Beszerzés",
    description: "Beszállítók, megrendelések és áruátvétel.",
    icon: "cart" as const,
  },
  penzugy: {
    title: "Pénzügy",
    description: "Számlák, kifizetések és vállalati pénzügyi áttekintés.",
    icon: "finance" as const,
  },
  szerviz: {
    title: "Szerviz",
    description: "Munkalapok, javítások, határidők és kapacitások.",
    icon: "service" as const,
  },
  akvariumok: {
    title: "Akváriumok",
    description: "Kezelt akváriumok, karbantartások és vízparaméterek.",
    icon: "aquarium" as const,
  },
  icp: {
    title: "ICP",
    description: "Belső vállalati folyamatok és teljesítménymutatók.",
    icon: "briefcase" as const,
  },
  beallitasok: {
    title: "Beállítások",
    description: "Szervezeti, felhasználói és integrációs beállítások.",
    icon: "settings" as const,
  },
};

export function generateStaticParams() {
  return Object.keys(sections).map((section) => ({ section }));
}

export default async function SectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const page = sections[section as keyof typeof sections];

  if (!page) notFound();

  return (
    <div className="space-y-6">
      <PageHeader title={page.title} description={page.description} />
      <EmptyState
        icon={<Icon name={page.icon} size={20} />}
        title={`${page.title} modul előkészítve`}
        description="A modul felülete és üzleti folyamatai egy következő fejlesztési mérföldkőben készülnek el."
      />
    </div>
  );
}
