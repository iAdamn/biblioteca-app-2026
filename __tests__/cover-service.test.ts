import * as Picker from 'expo-image-picker';
import * as Manipulator from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { pickCover, uploadCover, PermissionDeniedError, ImageTooLargeError, InvalidImageError, MAX_BASE64_LENGTH } from '@/services/device/cover-service';
import { ApiRequestError } from '@/services/api/client';
import { makeBook } from '../test-utils/fakes';
jest.mock('expo-image-picker', () => ({ requestCameraPermissionsAsync: jest.fn(), launchCameraAsync: jest.fn(), launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: jest.fn() }, SaveFormat: { JPEG: 'jpeg' } }));
const mockRemove = jest.fn();
jest.mock('expo-file-system', () => ({ File: jest.fn(() => ({ exists: true, delete: () => mockRemove() })), Paths: { cache: { uri: 'file:///cache/' } } }));
const data = '/9j/' + 'A'.repeat(120);
const log = jest.fn().mockResolvedValue(undefined);
let save: jest.Mock; let resize: jest.Mock;
beforeEach(() => {
  jest.clearAllMocks(); log.mockResolvedValue(undefined);
  jest.mocked(Picker.requestCameraPermissionsAsync).mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted', expires: 'never' } as never);
  const result = { canceled: false, assets: [{ uri: 'file:///original-privado.jpg', width: 1200, height: 1600, type: 'image', mimeType: 'image/jpeg' }] };
  jest.mocked(Picker.launchCameraAsync).mockResolvedValue(result as never); jest.mocked(Picker.launchImageLibraryAsync).mockResolvedValue(result as never);
  save = jest.fn().mockResolvedValue({ uri: 'file:///cache/generated.jpg', base64: data }); resize = jest.fn();
  jest.mocked(Manipulator.ImageManipulator.manipulate).mockReturnValue({ resize, renderAsync: async () => ({ saveAsync: save, release: jest.fn() }), release: jest.fn() } as never);
});
describe('portadas y permisos con adaptadores nativos simulados', () => {
  it.each([true,false])('permiso cámara denegado canAskAgain=%s no abre cámara', async canAskAgain => {
    jest.mocked(Picker.requestCameraPermissionsAsync).mockResolvedValue({ granted: false, canAskAgain, status: 'denied' } as never);
    await expect(pickCover('camera', { log })).rejects.toMatchObject({ name: 'PermissionDeniedError', canAskAgain });
    expect(Picker.launchCameraAsync).not.toHaveBeenCalled(); expect(Manipulator.ImageManipulator.manipulate).not.toHaveBeenCalled();
  });
  it.each(['camera','library'] as const)('cancelar %s no comprime ni sube ni produce error', async source => {
    jest.mocked(source === 'camera' ? Picker.launchCameraAsync : Picker.launchImageLibraryAsync).mockResolvedValue({ canceled: true, assets: null });
    expect(await pickCover(source, { log })).toBeNull(); expect(save).not.toHaveBeenCalled();
  });
  it('galería usa selector mínimo, prepara vista previa y borra solo copia generada', async () => {
    const cover = await pickCover('library', { log });
    expect(Picker.requestCameraPermissionsAsync).not.toHaveBeenCalled(); expect(resize).toHaveBeenCalledWith({ width: 600 });
    expect(cover?.previewUri).toBe(`data:image/jpeg;base64,${data}`); expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(File).toHaveBeenCalledWith('file:///cache/generated.jpg'); expect(File).not.toHaveBeenCalledWith('file:///original-privado.jpg');
    expect(JSON.stringify(log.mock.calls)).not.toContain(data); expect(JSON.stringify(log.mock.calls)).not.toContain('original-privado');
  });
  it('reintenta calidades para entrar al límite y elimina cada temporal', async () => {
    save.mockResolvedValueOnce({ uri: 'file:///cache/a.jpg', base64: '/9j/' + 'A'.repeat(MAX_BASE64_LENGTH) });
    expect((await pickCover('camera', { log }))?.base64.length).toBeLessThanOrEqual(MAX_BASE64_LENGTH);
    expect(save.mock.calls.map(c => c[0].compress)).toEqual([0.7,0.5]); expect(mockRemove).toHaveBeenCalledTimes(2);
  });
  it('tras cuatro calidades excedidas informa tamaño sin encolar imagen', async () => {
    save.mockResolvedValue({ uri: 'file:///cache/a.jpg', base64: '/9j/' + 'A'.repeat(MAX_BASE64_LENGTH) });
    await expect(pickCover('camera', { log })).rejects.toBeInstanceOf(ImageTooLargeError); expect(save).toHaveBeenCalledTimes(4);
  });
  it.each([{ width: 0, type: 'image' }, { width: 1200, type: 'video' }])('rechaza dimensiones/tipo inválidos %j', async asset => {
    jest.mocked(Picker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [{ ...asset, height: 100, uri: 'file:///x' }] } as never);
    await expect(pickCover('library', { log })).rejects.toBeInstanceOf(InvalidImageError);
  });
  it('fallo del selector se propaga sin imprimir rutas ni imágenes', async () => {
    jest.mocked(Picker.launchImageLibraryAsync).mockRejectedValue(new PermissionDeniedError(false, 'library'));
    await expect(pickCover('library', { log })).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(save).not.toHaveBeenCalled();
  });
  it('PUT usa contrato existente; respuesta válida se devuelve para actualizar SQLite', async () => {
    const put = jest.fn().mockResolvedValue({ book: makeBook({ coverUrl: '/api/books/b1/cover?v=2' }) });
    const book = await uploadCover({ put }, { log }, 'b1', { base64: data, previewUri: '', contentType: 'image/jpeg' });
    expect(put).toHaveBeenCalledWith('/api/books/b1/cover', { data, contentType: 'image/jpeg' });
    expect(book.coverUrl).toContain('v=2'); expect(JSON.stringify(log.mock.calls)).not.toContain(data);
  });
  it('rechazo403 y datos base64 inválidos no se anuncian como éxito', async () => {
    const put = jest.fn().mockRejectedValue(new ApiRequestError(403, 'FORBIDDEN', 'No autorizado'));
    await expect(uploadCover({ put }, { log }, 'b1', { base64: data, previewUri: '', contentType: 'image/jpeg' })).rejects.toMatchObject({ status: 403 });
    put.mockClear(); await expect(uploadCover({ put }, { log }, 'b1', { base64: 'mal', previewUri: '', contentType: 'image/jpeg' })).rejects.toBeInstanceOf(InvalidImageError);
    expect(put).not.toHaveBeenCalled();
  });
});
