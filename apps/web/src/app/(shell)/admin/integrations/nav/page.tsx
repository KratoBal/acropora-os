import { EmptyState, Icon, PageHeader } from "@acropora/ui";

export default function NavIntegrationSettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="NAV"
        description="A NAV Online Számla kapcsolat és szinkronizáció beállításai."
      />
      <EmptyState
        icon={<Icon name="finance" size={20} />}
        title="NAV beállítások előkészítve"
        description="A technikai felhasználó, a kapcsolati adatok és az automatikus szinkron beállításai ezen az oldalon kapnak helyet."
      />
    </div>
  );
}
