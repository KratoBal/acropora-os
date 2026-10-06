"use client";

import { useAuth } from "@/components/auth/auth-provider";

import { ServiceWorkPage } from "./service-work-page";
import { TaskBoardPage } from "./task-board-page";

/**
 * A FELADATAIM: UGYANAZ AZ OLDAL, SZEREP SZERINT MÁS TARTALOMMAL (kártya
 * 041a3dd5; Balázs 2026-09-02). A szervizes a rá osztott hibajegyeket és
 * munkalapokat látja, mindenki más a flotta kérdéseit és a kézi feladatokat.
 * A kettőt nem fésüljük össze: egy szerelő sosem kap flotta-eszkalációt, a
 * vezető sosem kap munkalap-kiosztást.
 */
export function MyTasksPage() {
  const { session } = useAuth();
  return session?.user.role === "SERVICE" ? (
    <ServiceWorkPage />
  ) : (
    <TaskBoardPage />
  );
}
