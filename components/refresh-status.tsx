"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export function RefreshStatus() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 15000);
    return () => clearInterval(timer);
  }, [router]);
  return (
    <p className="mt-3 text-xs text-slate-500" role="status">
      Status updates automatically every 15 seconds.
    </p>
  );
}
