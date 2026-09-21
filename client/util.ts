import { useEffect, useState } from "react";

const roubleFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const roubles = (value: number) => `${roubleFormat.format(Math.round(value))} ₽`;

/** State kept in localStorage; falls back to `initial` when storage is unavailable. */
export function useStoredState<T>(key: string, initial: T, validate: (value: unknown) => T | null) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) return validate(JSON.parse(saved)) ?? initial;
    } catch {
      // Unavailable or unreadable: use the default.
    }
    return initial;
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Private windows may refuse writes; the setting still works for this visit.
    }
  }, [key, value]);
  return [value, setValue] as const;
}
