import NetInfo from '@react-native-community/netinfo';
import { randomUUID } from 'expo-crypto';
import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createRepositories, type Repositories } from '@/db/repositories';
import { api, session } from '@/services/api';
import { describeError } from '@/services/api/client';
import { createOnlineLibrary } from '@/services/library/online-library';
import type { Book, LoanAction, LocalLoan } from '@/types';
import { useAuth } from './auth-provider';

interface DataContextValue {
  repos: Repositories; online: boolean; syncing: boolean; lastSyncAt: string | null;
  lastError: string | null; dataVersion: number;
  syncNow: () => Promise<void>; requestLoan: (book: Book) => Promise<LocalLoan>;
  transitionLoan: (id: string, action: LoanAction) => Promise<void>; signOut: () => Promise<void>;
}
const DataContext = createContext<DataContextValue | null>(null);

/** Montado con una base y un árbol React propios de uid/rol. */
export function DataProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const { user, signOut: clearSession } = useAuth();
  if (!user) throw new Error('DataProvider requiere identidad');
  const repos = useMemo(() => createRepositories(db), [db]);
  const service = useMemo(() => createOnlineLibrary({ api, repos, user, newId: randomUUID,
    isCurrent: () => session.getUser()?.uid === user.uid && session.getUser()?.role === user.role,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [repos, user.uid, user.role]); // Cambiar tokens no debe recrear el servicio de la misma identidad.
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(true);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const mounted = useRef(true);
  const flight = useRef<Promise<void> | null>(null);
  const changed = useCallback(() => { if (mounted.current) setDataVersion(v => v + 1); }, []);
  const syncNow = useCallback((): Promise<void> => {
    if (flight.current) return flight.current;
    setSyncing(true);
    const run = service.refresh().then(async () => {
      const at = await repos.meta.get('download.completedAt');
      if (mounted.current) { setLastError(null); setLastSyncAt(at); }
    }).catch(error => {
      if (mounted.current) setLastError(describeError(error));
    }).finally(() => {
      flight.current = null;
      if (mounted.current) { setSyncing(false); changed(); }
    });
    flight.current = run;
    return run;
  }, [service, repos, changed]);
  useEffect(() => {
    mounted.current = true;
    service.resume();
    const unsubscribe = NetInfo.addEventListener(s => setOnline(!!s.isConnected && s.isInternetReachable !== false));
    void repos.meta.get('download.completedAt').then(at => { if (mounted.current) setLastSyncAt(at); })
      .catch(() => { if (mounted.current) setLastError('No se pudieron leer los metadatos locales.'); });
    void syncNow();
    return () => { mounted.current = false; unsubscribe(); service.dispose(); };
  }, [service, repos, syncNow]);
  const requestLoan = async (book: Book) => {
    const loan = await service.requestLoan(book);
    changed();
    return loan;
  };
  const transitionLoan = async (id: string, action: LoanAction) => {
    try { await service.transition(id, action); } finally { changed(); }
  };
  const signOut = async () => {
    await service.close();
    await clearSession();
  };
  return <DataContext value={{ repos, online, syncing, lastSyncAt, lastError, dataVersion,
    syncNow, requestLoan, transitionLoan, signOut }}>{children}</DataContext>;
}
export function useData() {
  const value = useContext(DataContext);
  if (!value) throw new Error('useData requiere DataProvider');
  return value;
}
