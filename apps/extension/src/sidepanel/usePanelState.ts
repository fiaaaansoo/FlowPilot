import { useCallback, useEffect, useState } from 'react';
import { EMPTY_SNAPSHOT, type ExtensionApi, type PanelSnapshot } from './api';

interface PanelState {
  snapshot: PanelSnapshot;
  /** Vrai dès la première lecture terminée, réussie ou non. */
  loaded: boolean;
  /** Message affichable si la dernière lecture a échoué. */
  loadError: string | null;
  refresh: () => void;
}

/** Instantané du panneau, rafraîchi à chaque changement de stockage ou de permissions. */
export function usePanelState(api: ExtensionApi): PanelState {
  const [snapshot, setSnapshot] = useState<PanelSnapshot>(EMPTY_SNAPSHOT);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => {
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => api.subscribe(refresh), [api, refresh]);

  useEffect(() => {
    let cancelled = false;
    api.snapshot().then(
      (next) => {
        if (cancelled) return;
        setSnapshot(next);
        setLoadError(null);
        setLoaded(true);
      },
      (error: unknown) => {
        console.error('[FlowPilot] lecture de l’état', error);
        if (cancelled) return;
        setLoadError('Impossible de lire l’état de l’extension. Réessayez, ou rechargez l’extension.');
        setLoaded(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, version]);

  return { snapshot, loaded, loadError, refresh };
}
