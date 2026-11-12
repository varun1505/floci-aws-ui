import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./format";

/** Runs an async loader. Gives back the data, a loading flag, an error and a reload function. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const run = useRef(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(async (silent = false) => {
    const id = ++run.current;
    if (!silent) setLoading(true);
    try {
      const result = await loader();
      if (id === run.current) {
        setData(result);
        setError(undefined);
      }
    } catch (e) {
      if (id === run.current) setError(errorMessage(e));
    } finally {
      if (id === run.current) setLoading(false);
    }
  }, deps);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, error, reload };
}
