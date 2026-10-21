import { Pressable } from 'react-native';
import { ThemedText } from './themed-text';
import { useData } from '@/providers/data-provider';
import { formatDateTime } from '@/lib/text';
export function ConnectionBanner() {
  const { networkAvailable, online, syncing, pendingCount, attentionCount, lastSyncAt, lastError, syncNow } = useData();
  const message = !networkAvailable ? 'Sin conexión · mostrando datos guardados' : syncing ? 'Sincronizando…' :
    attentionCount > 0 ? `Atención requerida: ${attentionCount} operación(es). Consulta Mis préstamos o Perfil.` :
    lastError ? `${lastError} Toca para reintentar.` : pendingCount > 0 ? `${pendingCount} cambio(s) pendiente(s) de enviar` :
    online ? `Sincronizado · ${formatDateTime(lastSyncAt)}` : 'Red disponible; comprobando acceso a la API';
  return <Pressable accessibilityRole="button" accessibilityLabel={message} onPress={() => void syncNow()}
    style={{ padding: 10, borderWidth: 1, borderColor: attentionCount || lastError ? '#B42318' : '#705095', borderRadius: 10 }}>
    <ThemedText type="small">{message}{!networkAvailable && pendingCount > 0 ? ` · ${pendingCount} pendiente(s)` : ''}</ThemedText>
  </Pressable>;
}
