"use client";

import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Icon,
  PageHeader,
  StatCard,
} from "@acropora/ui";

import { useAuth } from "@/components/auth/auth-provider";

function getGreeting(hour: number) {
  if (hour < 10) return "Jó reggelt";
  if (hour < 18) return "Jó napot";
  return "Jó estét";
}

const tasks = [
  {
    title: "UNAS rendelések ellenőrzése",
    meta: "09:30 · Webshop",
    urgent: true,
  },
  {
    title: "AquaLine szállítmány bevételezése",
    meta: "11:00 · Raktár",
    urgent: false,
  },
  {
    title: "Heti pénztárzárás jóváhagyása",
    meta: "14:00 · Pénzügy",
    urgent: false,
  },
  {
    title: "Szerviz munkalapok kiosztása",
    meta: "Ma · Szerviz",
    urgent: false,
  },
];

const activities = [
  {
    initials: "KM",
    name: "Kovács Márk",
    action: "lezárta a #BEV-1048 bevételezést",
    time: "8 perce",
  },
  {
    initials: "NL",
    name: "Nagy Lilla",
    action: "új vevőt rögzített: Blue Reef Kft.",
    time: "24 perce",
  },
  {
    initials: "TA",
    name: "Tóth Ádám",
    action: "frissítette 18 termék készletét",
    time: "1 órája",
  },
  {
    initials: "SZ",
    name: "Rendszer",
    action: "befejezte az UNAS szinkronizációt",
    time: "2 órája",
  },
];

const inventoryAlerts = [
  {
    product: "Red Sea ReefMat 500",
    sku: "RS-RM500",
    stock: 2,
    level: "Kritikus",
  },
  {
    product: "Tropic Marin Pro Reef 25 kg",
    sku: "TM-PR25",
    stock: 4,
    level: "Alacsony",
  },
  {
    product: "Aqua Medic DC Runner 3.3",
    sku: "AM-DC33",
    stock: 5,
    level: "Alacsony",
  },
];

export default function DashboardPage() {
  const { session } = useAuth();
  const firstName = session?.user.displayName.split(" ")[0];
  const greeting = getGreeting(new Date().getHours());

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="2026. július 19., vasárnap"
        title={firstName ? `${greeting}, ${firstName}!` : `${greeting}!`}
        description="Itt találod a vállalat mai legfontosabb történéseit és teendőit."
        actions={
          <Button variant="secondary">
            <Icon name="activity" size={16} />
            Riport megnyitása
          </Button>
        }
      />

      <section
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Fő mutatók"
      >
        <StatCard
          label="Mai nettó árbevétel"
          value="1 284 500 Ft"
          change="+12,4%"
          changeLabel="tegnaphoz képest"
          trend="up"
          icon={<Icon name="finance" size={17} />}
        />
        <StatCard
          label="Nyitott rendelések"
          value="38"
          change="6 új"
          changeLabel="az elmúlt órában"
          trend="neutral"
          icon={<Icon name="cart" size={17} />}
        />
        <StatCard
          label="Készlethiányos termékek"
          value="12"
          change="−3"
          changeLabel="a tegnapi állapothoz képest"
          trend="up"
          icon={<Icon name="package" size={17} />}
        />
        <StatCard
          label="Nyitott szervizlapok"
          value="7"
          change="2 sürgős"
          changeLabel="mai határidővel"
          trend="down"
          icon={<Icon name="service" size={17} />}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Mai feladatok
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                4 feladat vár rád ma
              </p>
            </div>
            <Button variant="ghost" size="sm">
              Összes megnyitása
            </Button>
          </CardHeader>
          <div className="divide-y divide-slate-100">
            {tasks.map((task) => (
              <div
                key={task.title}
                className="flex items-center gap-3 px-5 py-3.5"
              >
                <span className="size-4 shrink-0 rounded-full border-2 border-slate-300" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">
                    {task.title}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">{task.meta}</p>
                </div>
                {task.urgent ? <Badge variant="danger">Sürgős</Badge> : null}
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Készletfigyelő
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Minimumszint alatti tételek
              </p>
            </div>
            <Button variant="ghost" size="sm">
              Készlet megnyitása
            </Button>
          </CardHeader>
          <div className="divide-y divide-slate-100">
            {inventoryAlerts.map((item) => (
              <div
                key={item.sku}
                className="flex items-center gap-3 px-5 py-3.5"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                  <Icon name="box" size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">
                    {item.product}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {item.sku} · {item.stock} db
                  </p>
                </div>
                <Badge
                  variant={item.level === "Kritikus" ? "danger" : "warning"}
                >
                  {item.level}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Legutóbbi aktivitások
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              A csapat és a rendszer legfrissebb műveletei
            </p>
          </div>
          <Button variant="ghost" size="sm">
            Aktivitási napló
          </Button>
        </CardHeader>
        <CardContent className="grid gap-x-8 gap-y-5 md:grid-cols-2">
          {activities.map((activity) => (
            <div
              key={`${activity.name}-${activity.time}`}
              className="flex items-start gap-3"
            >
              <Avatar name={activity.initials} size="sm" />
              <div className="min-w-0">
                <p className="text-sm leading-5 text-slate-600">
                  <span className="font-semibold text-slate-800">
                    {activity.name}
                  </span>{" "}
                  {activity.action}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">{activity.time}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
