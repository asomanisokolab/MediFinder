/* Loads data for a key and keeps the answer with the key it belongs to.
   Loading is derived (the stored answer is for a different key), so no
   state is set synchronously inside an effect, and a slow old answer can
   never overwrite a newer one. Pass a null key to load nothing. */
import { useEffect, useRef, useState } from 'react';

interface Answer<T> {
  key: string | null;
  data?: T;
  error?: string;
}

export function useQuery<T>(key: string | null, fetcher: () => Promise<T>) {
  const [attempt, setAttempt] = useState(0);
  const fullKey = key === null ? null : `${key}#${attempt}`;
  const [answer, setAnswer] = useState<Answer<T>>({ key: null });

  const latestFetcher = useRef(fetcher);
  useEffect(() => {
    latestFetcher.current = fetcher;
  });

  useEffect(() => {
    if (fullKey === null) return;
    let live = true;
    latestFetcher.current().then(
      (data) => {
        if (live) setAnswer({ key: fullKey, data });
      },
      (err: Error) => {
        if (live) setAnswer({ key: fullKey, error: err.message });
      }
    );
    return () => {
      live = false;
    };
  }, [fullKey]);

  const current = answer.key === fullKey;
  return {
    key: fullKey,
    data: current ? answer.data : undefined,
    error: current ? (answer.error ?? '') : '',
    loading: fullKey !== null && !current,
    retry: () => setAttempt((n) => n + 1),
  };
}
