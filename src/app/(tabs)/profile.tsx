import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { formatDateTime } from '@/lib/text';
import { useAuth } from '@/providers/auth-provider';
import { useData } from '@/providers/data-provider';
import { describeError } from '@/services/api/client';
export default function ProfileScreen() {
  const { user } = useAuth();
  const { online, syncing, lastSyncAt, lastError, syncNow, signOut } = useData();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try { await signOut(); } catch (e) { setError(describeError(e)); } finally { setBusy(false); }
  }
  return <Screen><ScrollView contentContainerStyle={{ gap: 20, paddingVertical: 20 }}>
    <ThemedText type="subtitle">Perfil</ThemedText>
    <View><ThemedText>{user?.name}</ThemedText>
      <ThemedText>{user?.role === 'librarian' ? 'Bibliotecario' : 'Estudiante'}</ThemedText></View>
    <ThemedText type="small">Conexión: {online ? 'disponible' : 'sin red'}. Datos leídos desde SQLite.</ThemedText>
    <ThemedText type="small">Descarga confirmada: {formatDateTime(lastSyncAt)}</ThemedText>
    {lastError ? <ThemedText accessibilityRole="alert">{lastError}</ThemedText> : null}
    <Button title="Actualizar datos" loading={syncing} onPress={() => void syncNow()} />
    <ThemedText type="small">D03: solicitudes con conexión. La cola offline, reconexión y cámara quedan pendientes para D04.</ThemedText>
    {error ? <ThemedText accessibilityRole="alert">{error}</ThemedText> : null}
    <Button title="Cerrar sesión" variant="danger" loading={busy} onPress={() => void logout()} />
  </ScrollView></Screen>;
}
