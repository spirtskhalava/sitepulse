import { useCallback, useEffect, useState } from "react";

/** fetch once, then again every `ms` while `keepGoing` says so */
export function usePolling<T>(load: () => Promise<T>, keepGoing: (data: T) => boolean, ms = 2000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => load().then(setData, (e: Error) => setError(e.message)), [load]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!data || !keepGoing(data)) return;
    const id = setTimeout(refresh, ms);
    return () => clearTimeout(id);
  }, [data, keepGoing, refresh, ms]);

  return { data, error, refresh };
}
