"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createRefreshScheduler } from "@/lib/dashboard-refresh";
let shared: ReturnType<typeof createRefreshScheduler> | undefined;
export function OnboardingRefresh({ progress }: { progress: string }) {
  const router = useRouter();
  const id = useRef(Symbol());
  useEffect(() => {
    if (!shared) {
      shared = createRefreshScheduler(
        () => router.refresh(),
        () => document.visibilityState === "visible",
      );
      document.addEventListener("visibilitychange", shared.visibilityChanged);
    }
    shared.update(id.current, progress);
  }, [router, progress]);
  useEffect(() => {
    const key = id.current;
    return () => shared?.remove(key);
  }, []);
  return null;
}
