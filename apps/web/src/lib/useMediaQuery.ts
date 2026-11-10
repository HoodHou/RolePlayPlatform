import { useCallback, useSyncExternalStore } from 'react';

/** Below this width the side panels turn into drawers. Keep in sync with layout.css. */
export const NARROW_QUERY = '(max-width: 959.98px)';

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}
