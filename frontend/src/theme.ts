import { useSyncExternalStore } from "react";

// Appearance: Light, Dark or System (follows the device). A per-browser choice, so it's kept in
// localStorage (survives a browser restart) rather than the shared database. Settings > Appearance
// and the sidebar toggle both go through setTheme()/useTheme(), so they always agree.
export type ThemeChoice = "light" | "dark" | "system";

const KEY = "transportFinder.theme";
const THEMES: ThemeChoice[] = ["light", "dark", "system"];
let memory: ThemeChoice = "system"; // used only when storage is blocked

export function loadTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY) as ThemeChoice | null;
    return v && THEMES.includes(v) ? v : "system";
  } catch {
    return memory;
  }
}

export function saveTheme(choice: ThemeChoice): void {
  memory = choice;
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // storage blocked -- the choice still applies for this visit
  }
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(choice: ThemeChoice): "light" | "dark" {
  return choice === "system" ? (systemPrefersDark() ? "dark" : "light") : choice;
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
let stopFollowing: (() => void) | null = null;

/** Sets <html data-theme="light|dark">; for "system", keeps following the device setting live. */
export function applyTheme(choice: ThemeChoice): void {
  const set = () => {
    document.documentElement.setAttribute("data-theme", resolveTheme(choice));
    notify();
  };
  set();
  stopFollowing?.();
  stopFollowing = null;
  if (choice === "system" && typeof window.matchMedia === "function") {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener?.("change", set);
    stopFollowing = () => mq.removeEventListener?.("change", set);
  }
}

/** Saves and applies a theme choice (Settings > Appearance, and the sidebar toggle). */
export function setTheme(choice: ThemeChoice): void {
  saveTheme(choice);
  applyTheme(choice);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => `${loadTheme()}|${document.documentElement.getAttribute("data-theme") ?? ""}`;

/** The saved choice and the theme actually showing, kept in sync across every component. */
export function useTheme(): { choice: ThemeChoice; resolved: "light" | "dark"; setTheme: (c: ThemeChoice) => void } {
  const [choice, shown] = useSyncExternalStore(subscribe, snapshot).split("|") as [ThemeChoice, string];
  return { choice, resolved: shown === "dark" || shown === "light" ? shown : resolveTheme(choice), setTheme };
}
