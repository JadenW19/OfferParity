"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type ColorScheme = "light" | "dark";

function readMetaScheme(): ColorScheme {
  if (typeof document === "undefined") {
    return "dark";
  }
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="color-scheme"]'
  );
  return meta?.content === "light" ? "light" : "dark";
}

function applyScheme(next: ColorScheme): void {
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="color-scheme"]'
  );
  if (meta) {
    meta.content = next;
  }
  try {
    localStorage.setItem("color-scheme", next);
  } catch {
    // Ignore storage errors in restricted browsing modes
  }
}

export function ThemeToggle() {
  const [scheme, setScheme] = useState<ColorScheme>("dark");

  useEffect(() => {
    const sync = () => setScheme(readMetaScheme());
    sync();

    const onStorage = (event: StorageEvent) => {
      if (event.key === "color-scheme") {
        const next = event.newValue === "light" ? "light" : "dark";
        const meta = document.querySelector<HTMLMetaElement>(
          'meta[name="color-scheme"]'
        );
        if (meta) {
          meta.content = next;
        }
        setScheme(next);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function handleToggle() {
    const next: ColorScheme = scheme === "dark" ? "light" : "dark";
    applyScheme(next);
    setScheme(next);
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label={
        scheme === "dark" ? "Switch to warm light theme" : "Switch to dark theme"
      }
      title={scheme === "dark" ? "Switch to Warm Light" : "Switch to Dark"}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
    >
      {scheme === "dark" ? (
        <Sun className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <Moon className="h-3.5 w-3.5" aria-hidden="true" />
      )}
    </button>
  );
}
