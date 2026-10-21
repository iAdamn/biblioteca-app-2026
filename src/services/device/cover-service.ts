/** Adaptado del servicio docente: permiso mínimo → selector → JPEG600px → vista previa → PUT. */
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { File, Paths } from 'expo-file-system';
import type { Repositories } from '@/db/repositories';
import type { ApiClient } from '@/services/api/client';
import { parseBook } from '@/services/api/contracts';
export type CoverSource = 'camera' | 'library';
export const MAX_BASE64_LENGTH = 700_000;
export class PermissionDeniedError extends Error {
  constructor(readonly canAskAgain: boolean, readonly source: CoverSource = 'camera') {
    super('Permiso de cámara denegado'); this.name = 'PermissionDeniedError';
  }
}
export class InvalidImageError extends Error {
  constructor() { super('El archivo no es una imagen válida. Elige otra foto.'); this.name = 'InvalidImageError'; }
}
export class ImageTooLargeError extends Error {
  constructor() { super('La imagen supera el límite incluso después de comprimir.'); this.name = 'ImageTooLargeError'; }
}
export interface PickedCover { base64: string; contentType: 'image/jpeg'; previewUri: string }
type Activity = Pick<Repositories['activity'], 'log'>;
export async function pickCover(source: CoverSource, activity: Activity): Promise<PickedCover | null> {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    await activity.log('cover.permission', permission.granted ? 'camera: granted' : 'camera: denied');
    if (!permission.granted) throw new PermissionDeniedError(permission.canAskAgain);
  }
  // El selector del sistema para imágenes no requiere acceso general al almacenamiento.
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: 'images', allowsEditing: false, quality: 0.8 };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.length) { await activity.log('cover.cancel', source); return null; }
  const asset = result.assets[0];
  if (!asset.uri || !Number.isFinite(asset.width) || asset.width <= 0 || !Number.isFinite(asset.height) || asset.height <= 0 ||
      (asset.type && asset.type !== 'image') || (asset.mimeType && !asset.mimeType.startsWith('image/'))) throw new InvalidImageError();
  for (const quality of [0.7, 0.5, 0.35, 0.2]) {
    const context = ImageManipulator.ImageManipulator.manipulate(asset.uri);
    let rendered: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
    let temporary: string | undefined;
    try {
      context.resize({ width: Math.min(asset.width, 600) });
      rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress: quality, base64: true });
      temporary = saved.uri;
      if (!saved.base64 || !saved.base64.startsWith('/9j/') || !/^[A-Za-z0-9+/]+={0,2}$/.test(saved.base64)) throw new InvalidImageError();
      if (saved.base64.length <= MAX_BASE64_LENGTH) {
        await activity.log('cover.prepared', `${source}: JPEG,${saved.base64.length} caracteres,calidad${quality}`);
        return { base64: saved.base64, contentType: 'image/jpeg', previewUri: `data:image/jpeg;base64,${saved.base64}` };
      }
    } catch (error) {
      if (error instanceof InvalidImageError) throw error;
      throw new InvalidImageError();
    } finally {
      rendered?.release(); context.release();
      // Solo copia generada por esta operación bajo caché; nunca el original del selector.
      if (temporary && temporary !== asset.uri && temporary.startsWith(Paths.cache.uri)) {
        try { const file = new File(temporary); if (file.exists) file.delete(); }
        catch { await activity.log('cover.cleanup', 'No se pudo retirar una copia temporal de caché'); }
      }
    }
  }
  await activity.log('cover.invalid', 'JPEG preparado supera el límite');
  throw new ImageTooLargeError();
}
export async function uploadCover(api: Pick<ApiClient, 'put'>, activity: Activity, bookId: string, cover: PickedCover) {
  if (!cover.base64 || cover.base64.length > MAX_BASE64_LENGTH || !cover.base64.startsWith('/9j/')) throw new InvalidImageError();
  try {
    const response = await api.put<{ book: unknown }>(`/api/books/${encodeURIComponent(bookId)}/cover`, { contentType: cover.contentType, data: cover.base64 });
    const book = parseBook(response.book);
    if (book.id !== bookId) throw new InvalidImageError();
    await activity.log('cover.upload', 'Portada confirmada por API'); return book;
  } catch (error) { await activity.log('cover.error', 'Subida no confirmada; sin guardar imagen en la cola'); throw error; }
}
