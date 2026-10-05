import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth/auth-gate";
import { MessageStreamProvider } from "@/components/messages/message-stream";
import { NavigationHistoryProvider } from "@/components/navigation-history";

export default function ShellLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      {/*
        A nyom a héjon BELÜL él, nem a bejelentkező képernyőn: csak azok a
        lapok érdekesek, amiket bejelentkezve járt be a kolléga. Így a
        bejelentkezés utáni első lapról a "vissza" nem a login oldalra visz.
      */}
      <NavigationHistoryProvider>
        {/* egy üzenet-folyam a héjnak és a lapoknak (Üzenetek modul) */}
        <MessageStreamProvider>
          <AppShell>{children}</AppShell>
        </MessageStreamProvider>
      </NavigationHistoryProvider>
    </AuthGate>
  );
}
