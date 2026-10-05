import { Suspense } from "react";

import { MessagesPage } from "@/components/messages/messages-page";

export default function MessagesRoute() {
  // a kiválasztott beszélgetés a keresőparaméterben él (`useSearchParams`)
  return (
    <Suspense fallback={null}>
      <MessagesPage />
    </Suspense>
  );
}
