import type { NavigationItem } from "@acropora/types";
import { Button } from "@acropora/ui";

const modules: NavigationItem[] = [
  { label: "Készlet", description: "Termékek, raktárak és készletmozgások" },
  {
    label: "Bevételezés",
    description: "Beszállítói bizonylatok és áruátvétel",
  },
  { label: "Rendelések", description: "Webshopos és helyi értékesítések" },
];

export default function HomePage() {
  return (
    <main className="min-h-screen px-6 py-16 sm:px-10">
      <div className="mx-auto max-w-5xl">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-teal-700">
          Acropora OS
        </p>
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-slate-900 sm:text-6xl">
          A vállalat működése, egy átlátható rendszerben.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
          A magyar nyelvű vállalatirányítási platform alapjai elkészültek. A
          következő mérföldkő a jogosultságkezelés és a készletmag kialakítása.
        </p>

        <section
          className="mt-12 grid gap-4 md:grid-cols-3"
          aria-label="Tervezett modulok"
        >
          {modules.map((module) => (
            <article
              key={module.label}
              className="rounded-2xl border border-teal-100 bg-white p-6 shadow-sm"
            >
              <h2 className="text-xl font-semibold text-slate-900">
                {module.label}
              </h2>
              <p className="mt-2 leading-6 text-slate-600">
                {module.description}
              </p>
            </article>
          ))}
        </section>

        <div className="mt-10">
          <Button type="button">Rendszer állapota: működőképes</Button>
        </div>
      </div>
    </main>
  );
}
