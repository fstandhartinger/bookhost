"use client";
import React, { useEffect, useState } from "react";

export const WIKI_CHAT_DEMO_TIMING = {
  question: 1600,
  thinking: 1400,
  answer: 1600,
  hold: 3500,
} as const;

const QUESTION = "Where may I leave my two-wheeler?";
const ANSWER =
  "Fahrräder, E-Bikes und Roller gehören ausschließlich in den überdachten Fahrradständer im Innenhof hinter Haus B.";
const SOURCE_NAME = "Fahrradabstellplätze im Innenhof";

type Phase = 0 | 1 | 2 | 3;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function")
      return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function WikiChatDemo({ immediate = false }: { immediate?: boolean }) {
  const reduced = usePrefersReducedMotion();
  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<Phase>(0);
  useEffect(() => {
    setMounted(true);
  }, []);
  const final = mounted && (reduced || immediate);
  useEffect(() => {
    if (!mounted) return;
    if (final) {
      setPhase(3);
      return;
    }
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => {
      timers.push(setTimeout(() => { if (!cancelled) fn(); }, ms));
    };
    const { question, thinking, answer, hold } = WIKI_CHAT_DEMO_TIMING;
    const loop = () => {
      setPhase(0);
      at(question, () => setPhase(1));
      at(question + thinking, () => setPhase(2));
      at(question + thinking + answer, () => setPhase(3));
      at(question + thinking + answer + hold, loop);
    };
    loop();
    return () => {
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
    };
  }, [final, mounted]);
  return (
    <div data-wiki-chat-demo className="price-card p-5 sm:p-6">
      <p className="sr-only">
        Animated demo: a question about bike parking, an answer with a numbered
        source, and the source page name.
      </p>
      <div aria-hidden="true" className="space-y-4">
        <p className="rounded-xl border border-ink/10 bg-[#f4f6f1] px-4 py-2.5 text-sm font-medium text-ink">
          {QUESTION}
        </p>
        {phase === 1 && (
          <div data-wiki-chat-demo-thinking className="flex items-center gap-1.5 px-1">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-moss/60" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-moss/60 [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-moss/60 [animation-delay:300ms]" />
          </div>
        )}
        {phase >= 2 && (
          <p className="rounded-xl border border-ink/10 bg-white px-4 py-3 text-sm leading-6 text-ink">
            {ANSWER}{" "}
            <span className="align-super text-xs text-moss">[1]</span>
          </p>
        )}
        {phase >= 3 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Sources
            </h3>
            <p className="mt-2 text-sm">
              <span className="font-medium text-moss">[1]</span> {SOURCE_NAME}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
