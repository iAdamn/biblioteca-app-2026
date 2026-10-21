import NetInfo from '@react-native-community/netinfo';
import { randomUUID } from 'expo-crypto';
import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { createRepositories, type Repositories } from '@/db/repositories';
import { api, session } from '@/services/api';
import { ApiRequestError, describeError } from '@/services/api/client';
import { createLibraryService } from '@/services/library/library-service';
import { uploadCover, type PickedCover } from '@/services/device/cover-service';
import type { Book, LoanAction, LocalLoan } from '@/types';
import { useAuth } from './auth-provider';

interface DataContextValue {
  repos: Repositories; online: boolean; networkAvailable: boolean; syncing: boolean; lastSyncAt: string | null;
  lastError: string | null; dataVersion: number; pendingCount: number; attentionCount: number;
  syncNow: () => Promise<void>; requestLoan: (book: Book) => Promise<LocalLoan>;
  transitionLoan: (id: string, action: LoanAction) => Promise<void>; signOut: () => Promise<void>;
  dismissLoan: (id: string) => Promise<void>; retryAttention: () => Promise<void>;
  setCover: (bookId: string, cover: PickedCover) => Promise<void>;
}
const DataContext = createContext<DataContextValue | null>(null);
export function DataProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const { user, signOut: clearSession } = useAuth();
  if (!user) throw new Error('DataProvider requiere identidad');
  const repos = useMemo(() => createRepositories(db), [db]);
  const mounted = useRef(true);
  const [dataVersion, setDataVersion] = useState(0);
  const changed = useCallback(() => setDataVersion(v => v + 1), []);
  const service = useMemo(() => createLibraryService({ api, repos, user, newId: randomUUID, changed,
    isCurrent: () => session.getUser()?.uid === user.uid && session.getUser()?.role === user.role,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [repos, user.uid, user.role, changed]);
  const ready = useRef<Promise<void> | null>(null);
  const network = useRef(true);
  const [networkAvailable, setNetworkAvailable] = useState(true);
  const [reachable, setReachable] = useState(false);
  const [syncing, setSyncing] = useState(true);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [attentionCount, setAttentionCount] = useState(0);
  const flight = useRef<Promise<void> | null>(null);
  const rerun = useRef(false);
  const refreshMeta = useCallback(async () => {
    const [pending, attention, at] = await Promise.all([repos.outbox.count(user.uid), repos.outbox.attention(user.uid), repos.meta.get('sync.lastSyncAt')]);
    if (mounted.current) { setPendingCount(pending); setAttentionCount(attention); setLastSyncAt(at); }
  }, [repos, user.uid]);
  const syncNow = useCallback(function syncCycle(): Promise<void> {
    if (!network.current || !mounted.current) { setSyncing(false); return Promise.resolve(); }
    if (flight.current) { rerun.current = true; return flight.current; }
    setSyncing(true);
    const run = (async () => {
      try {
        await ready.current; await service.refresh();
        if (mounted.current) { setReachable(true); setLastError(null); }
      } catch (error) {
        if (mounted.current) { setReachable(error instanceof ApiRequestError && error.status < 500); setLastError(describeError(error)); }
      } finally {
        if (mounted.current) {
          try { await refreshMeta(); } catch { if (mounted.current) setLastError('No se pudieron leer los indicadores locales.'); }
          changed(); setSyncing(false);
        }
        flight.current = null;
      }
    })();
    flight.current = run;
    void run.then(() => { if (rerun.current && mounted.current) { rerun.current = false; void syncCycle(); } });
    return run;
  }, [service, refreshMeta, changed]);
  useEffect(() => {
    mounted.current = true; service.resume();
    ready.current = service.initialize();
    void ready.current.then(refreshMeta).catch(() => { if (mounted.current) setLastError('No se pudo abrir la base de esta cuenta.'); });
    let previousReachable = false;
    const unsubscribe = NetInfo.addEventListener(s => {
      network.current = s.isConnected !== false;
      setNetworkAvailable(network.current);
      if (!network.current) setReachable(false);
      const next = !!s.isConnected && s.isInternetReachable !== false;
      if (next && !previousReachable) void syncNow();
      previousReachable = next;
    });
    const sub = AppState.addEventListener('change', state => { if (state === 'active') void syncNow(); });
    // Recuperación de servidor con el mismo Wi-Fi: una comprobación cada30s, sin solapar ciclos.
    const timer = setInterval(() => { if (network.current && AppState.currentState === 'active' && !flight.current) void syncNow(); }, 30_000);
    void syncNow();
    return () => { mounted.current = false; clearInterval(timer); unsubscribe(); sub.remove(); service.dispose(); };
  }, [service, refreshMeta, syncNow]);
  const requestLoan = async (book: Book) => {
    await ready.current; const loan = await service.requestLoan(book); changed(); await refreshMeta(); void syncNow(); return loan;
  };
  const transitionLoan = async (id: string, action: LoanAction) => {
    if (!network.current || !reachable) throw new Error('Necesitas conexión con la API para gestionar préstamos.');
    try { await service.transition(id, action); await repos.activity.log('loan.' + action, 'Gestión confirmada por API'); }
    finally { changed(); }
  };
  const dismissLoan = async (id: string) => { await service.dismiss(id); changed(); await refreshMeta(); };
  const retryAttention = async () => { await service.retryAttention(); changed(); await refreshMeta(); void syncNow(); };
  const setCover = async (bookId: string, cover: PickedCover) => {
    if (user.role !== 'librarian') throw new ApiRequestError(403, 'FORBIDDEN', 'Solo bibliotecario cambia portadas.');
    if (!network.current || !reachable) throw new Error('Necesitas conexión con la API para subir la portada.');
    await service.setCover(() => uploadCover(api, repos.activity, bookId, cover)); changed();
  };
  const signOut = async () => { await service.close(); await clearSession(); };
  return <DataContext value={{ repos, online: networkAvailable && reachable, networkAvailable, syncing, lastSyncAt, lastError,
    dataVersion, pendingCount, attentionCount, syncNow, requestLoan, transitionLoan, signOut, dismissLoan, retryAttention, setCover }}>{children}</DataContext>;
}
export function useData() { const value = useContext(DataContext); if (!value) throw new Error('useData requiere DataProvider'); return value; }
