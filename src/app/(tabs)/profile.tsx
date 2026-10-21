import { useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ConnectionBanner } from '@/components/connection-banner';
import { formatDateTime } from '@/lib/text';
import { useAuth } from '@/providers/auth-provider';
import { useData } from '@/providers/data-provider';
import { describeError } from '@/services/api/client';
import type { ActivityEntry } from '@/db/outbox';
export default function ProfileScreen() {
  const { user } = useAuth();
  const { repos, syncing, lastSyncAt, dataVersion, pendingCount, attentionCount, syncNow, signOut, retryAttention } = useData();
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof repos.outbox.recent>>>([]);
  useEffect(() => {
    let active = true;
    Promise.all([repos.activity.recent(20), repos.outbox.recent(user?.uid ?? '')]).then(([a,h]) => {
      if (active) { setActivity(a); setHistory(h); }
    }).catch(() => { if (active) setError('No se pudo leer la actividad local.'); });
    return () => { active = false; };
  }, [repos, dataVersion, user?.uid]);
  async function logout() {
    setBusy(true); try { await signOut(); } catch (e) { setError(describeError(e)); } finally { setBusy(false); }
  }
  function confirmLogout() {
    Alert.alert('Cerrar sesión', pendingCount ? `Hay ${pendingCount} solicitud(es) sin confirmar. Se eliminarán de este dispositivo si sales. ¿Continuar?` : 'Se borrarán los datos privados locales. ¿Continuar?', [
      { text: 'Cancelar', style: 'cancel' }, { text: 'Cerrar sesión', style: 'destructive', onPress: () => void logout() },
    ]);
  }
  return <Screen><ScrollView contentContainerStyle={{ gap: 18, paddingVertical: 20, paddingBottom: 100 }}>
    <ThemedText type="subtitle">Perfil</ThemedText>
    <View><ThemedText>{user?.name}</ThemedText><ThemedText>{user?.role === 'librarian' ? 'Bibliotecario' : 'Estudiante'}</ThemedText></View>
    <ConnectionBanner />
    <ThemedText type="small">Última sincronización: {formatDateTime(lastSyncAt)}</ThemedText>
    <ThemedText>Cambios pendientes: {pendingCount}</ThemedText>
    <ThemedText>Atención requerida: {attentionCount}</ThemedText>
    <Button title="Sincronizar ahora" loading={syncing} onPress={() => void syncNow()} />
    <Button title="Reintentar operaciones pausadas" variant="secondary" onPress={() => void retryAttention().catch(e => setError(describeError(e)))} />
    {error ? <ThemedText accessibilityRole="alert">{error}</ThemedText> : null}
    <ThemedText type="smallBold">Resultados de operaciones</ThemedText>
    {history.slice(0,10).map(item => <ThemedText key={item.id} type="small">{item.kind} · {item.state} · envíos {item.sendCount} · fallos temporales {item.attempts}{item.lastError ? ` · ${item.lastError}` : ''}</ThemedText>)}
    <ThemedText type="smallBold">Actividad reciente</ThemedText>
    {activity.map(item => <ThemedText key={item.id} type="small">{formatDateTime(item.createdAt)} · {item.kind} · {item.detail}</ThemedText>)}
    <Button title="Cerrar sesión" variant="danger" loading={busy} onPress={confirmLogout} />
  </ScrollView></Screen>;
}
