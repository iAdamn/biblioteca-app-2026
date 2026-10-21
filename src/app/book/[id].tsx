import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

import { availabilityLabel, BookCover } from '@/components/book-views';
import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { EmptyView, ErrorView, LoadingView } from '@/components/state-views';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useBook, useMyLoanForBook } from '@/hooks/use-library-data';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/providers/auth-provider';
import { useData } from '@/providers/data-provider';
import { describeError } from '@/services/api/client';
import { pickCover, PermissionDeniedError, type PickedCover, type CoverSource } from '@/services/device/cover-service';
export default function BookDetailScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { repos, online, requestLoan, syncNow, setCover } = useData();
  const { book, loaded, error } = useBook(id);
  const myLoan = useMyLoanForBook(id);

  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PickedCover | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);

  if (!loaded) return <LoadingView />;
  if (error) return <ErrorView message={error} onRetry={() => void syncNow()} />;
  if (!book)
    return <EmptyView title="Libro no encontrado" message="Puede que ya no esté en el catálogo." />;

  const librarian = user?.role === 'librarian';
  const hasActive =
    myLoan &&
    myLoan.syncState !== 'conflict' &&
    (myLoan.status === 'requested' || myLoan.status === 'approved');
  const awaitingRetry = myLoan?.operationState === 'attention';

  async function onRequest() {
    if (!book) return;
    setBusy(true);
    setFeedback(null);
    try {
      await requestLoan(book);
      setFeedback({
        error: false,
        text: 'Solicitud guardada en el dispositivo, pendiente de confirmación. Consulta Mis préstamos.',
      });
    } catch (err) {
      setFeedback({
        error: true,
        text: describeError(err),
      });
    } finally {
      setBusy(false);
    }
  }

  async function chooseCover(source: CoverSource) {
    if (!online) { setFeedback({ error: true, text: 'Necesitas conexión con la API para cambiar la portada.' }); return; }
    setBusy(true); setPreview(null); setFeedback(null);
    try { const selected = await pickCover(source, repos.activity); if (selected) setPreview(selected); }
    catch (error) {
      if (error instanceof PermissionDeniedError) {
        Alert.alert('Permiso de cámara necesario', 'Puedes permitir la cámara o elegir una imagen desde la galería.',
          error.canAskAgain ? [{ text: 'Entendido' }] : [{ text: 'Cancelar', style: 'cancel' }, { text: 'Abrir ajustes', onPress: () => void Linking.openSettings() }]);
      } else setFeedback({ error: true, text: error instanceof Error && ['InvalidImageError','ImageTooLargeError'].includes(error.name) ? error.message : describeError(error) });
    } finally { setBusy(false); }
  }
  async function saveCover() {
    if (!preview || !book) return;
    setBusy(true);
    try { await setCover(book.id, preview); setPreview(null); setFeedback({ error: false, text: 'Portada confirmada y actualizada en SQLite.' }); }
    catch (error) { setFeedback({ error: true, text: describeError(error) }); }
    finally { setBusy(false); }
  }

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.cover}>
          <BookCover book={book} width={160} height={220} />
        </View>

        <ThemedText type="subtitle" accessibilityRole="header">
          {book.title}
        </ThemedText>
        <ThemedText themeColor="textSecondary">{book.author}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {book.category} · {book.year}
        </ThemedText>
        <ThemedText
          type="smallBold"
          style={{ color: book.availableCopies > 0 ? theme.success : theme.danger }}>
          {availabilityLabel(book)}
        </ThemedText>
        <ThemedText style={styles.description}>{book.description}</ThemedText>

        {!librarian ? (
          <View style={styles.actions}>
            {myLoan?.syncState === 'pending' ? <ThemedText type="smallBold">{myLoan.operationState === 'in_flight' ? 'Enviando · sin confirmación todavía' : 'Pendiente de envío · guardado en SQLite'}</ThemedText> : null}
            {myLoan?.syncState === 'conflict' ? <ThemedText accessibilityRole="alert">{myLoan.syncError}</ThemedText> : null}
            {myLoan?.syncState === 'synced' && myLoan.status === 'requested' ? (
              <ThemedText type="smallBold" style={{ color: theme.primary }}>
                Solicitud enviada · esperando al bibliotecario
              </ThemedText>
            ) : null}
            {myLoan?.syncState === 'synced' && myLoan.status === 'approved' ? (
              <ThemedText type="smallBold" style={{ color: theme.success }}>
                Tienes este libro prestado
              </ThemedText>
            ) : null}
            <Button
              title={book.availableCopies > 0 ? 'Solicitar préstamo' : 'Sin ejemplares disponibles'}
              disabled={book.availableCopies <= 0 || !!hasActive || awaitingRetry}
              loading={busy}
              onPress={onRequest}
              accessibilityHint="Envía una solicitud de préstamo al bibliotecario"
            />
          </View>
        ) : (
          <View style={styles.actions}>
            <ThemedText type="smallBold">Portada del libro</ThemedText>
            <Button title="Tomar foto" disabled={busy} onPress={() => void chooseCover('camera')} />
            <Button title="Elegir de la galería" variant="secondary" disabled={busy} onPress={() => void chooseCover('library')} />
            {!online ? <ThemedText type="small">Necesitas conexión con la API. Las portadas no se encolan.</ThemedText> : null}
            {preview ? <View style={{ gap: 12 }}>
              <ThemedText type="smallBold">Vista previa sin publicar</ThemedText>
              <Image source={{ uri: preview.previewUri }} style={{ width: 180, height: 240 }} contentFit="contain" accessibilityLabel="Vista previa de la nueva portada" />
              <Button title="Subir portada" loading={busy} onPress={() => void saveCover()} />
              <Button title="Cancelar portada" variant="secondary" disabled={busy} onPress={() => setPreview(null)} />
            </View> : null}
          </View>
        )}

        {feedback ? (
          <ThemedText
            accessibilityLiveRegion="polite"
            accessibilityRole={feedback.error ? 'alert' : undefined}
            style={{ color: feedback.error ? theme.danger : theme.success }}>
            {feedback.text}
          </ThemedText>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.two, paddingVertical: Spacing.three },
  cover: { alignItems: 'center', paddingBottom: Spacing.two },
  description: { marginTop: Spacing.two, lineHeight: 24 },
  actions: { gap: Spacing.two, marginTop: Spacing.three },
});
