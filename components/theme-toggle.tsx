"use client";
import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";
const ORDER: Theme[] = ["system", "light", "dark"];
const LABEL: Record<Theme, string> = {
  system: "Theme: follows your system",
  light: "Theme: light",
  dark: "Theme: dark",
};

// Runs before first paint (inlined in <head>) so a stored choice never
// flashes the other theme.
export const THEME_SCRIPT = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    const stored = document.documentElement.dataset.theme;
    if (stored === "light" || stored === "dark") setTheme(stored);
  }, []);
  function cycle() {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
    setTheme(next);
    try {
      if (next === "system") {
        localStorage.removeItem("theme");
        delete document.documentElement.dataset.theme;
      } else {
        localStorage.setItem("theme", next);
        document.documentElement.dataset.theme = next;
      }
    } catch {
      /* private mode: the choice just isn't remembered */
    }
  }
  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`${LABEL[theme]}. Change theme`}
      title={LABEL[theme]}
      className="grid h-9 w-9 place-items-center rounded-full text-muted transition hover:bg-ink/5 hover:text-ink"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="h-[18px] w-[18px]"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        {theme === "light" ? (
          <>
            <circle cx="10" cy="10" r="3.5" />
            <path d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M4 4l1.4 1.4M14.6 14.6 16 16M4 16l1.4-1.4M14.6 5.4 16 4" />
          </>
        ) : theme === "dark" ? (
          <path d="M16.5 12.3A7 7 0 0 1 7.7 3.5a7 7 0 1 0 8.8 8.8Z" />
        ) : (
          <>
            <circle cx="10" cy="10" r="7" />
            <path d="M10 3v14a7 7 0 0 0 0-14Z" fill="currentColor" />
          </>
        )}
      </svg>
    </button>
  );
}
