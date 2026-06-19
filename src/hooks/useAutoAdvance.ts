// Tiny focus-chain helper for forms with multiple fixed-length inputs
// (MM/YYYY pairs, ZIP, formatted phone, etc.). Each input registers a
// ref by name; on user input that grows the value to its maxLength,
// focus jumps to the named next field. Backspace and any non-growing
// edit leave focus alone — we never advance unless `next.length`
// strictly exceeds `prev.length`.
//
// Programmatic state updates (e.g., MBI card-scan results filling
// Part A / Part B dates via setState) do NOT trigger advancement
// because onChange handlers are the only call site for `maybeAdvance`.

import { useCallback, useRef } from 'react';

export function useAutoAdvance() {
  const refs = useRef<Record<string, HTMLInputElement | null>>({});

  const register = useCallback(
    (name: string) => (el: HTMLInputElement | null) => {
      refs.current[name] = el;
    },
    [],
  );

  const maybeAdvance = useCallback(
    (prev: string, next: string, maxLen: number, nextName: string) => {
      if (next.length >= maxLen && next.length > prev.length) {
        refs.current[nextName]?.focus();
      }
    },
    [],
  );

  return { register, maybeAdvance };
}
