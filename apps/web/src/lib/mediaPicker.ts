import { Capacitor, registerPlugin } from '@capacitor/core';
import { z } from 'zod';

const nativeFileSchema = z.object({ path: z.string(), name: z.string(), mimeType: z.string() });
const pickResultSchema = z.object({ files: z.array(nativeFileSchema) });
const NativeAttachments = registerPlugin<{
  pick(options: { kind: 'media' | 'files' | 'camera'; video?: boolean }): Promise<unknown>;
  beginExport(): Promise<void>;
  appendExport(options: { data: string }): Promise<void>;
  saveExport(options: { name: string; mimeType: string }): Promise<void>;
  cancelExport(): Promise<void>;
  releaseFile(options: { path: string }): Promise<void>;
  startRecording(): Promise<void>;
  stopRecording(options: { cancel: boolean }): Promise<unknown>;
}>('Attachments');

async function fileFromNative(input: z.infer<typeof nativeFileSchema>) {
  try {
    const response = await fetch(Capacitor.convertFileSrc(input.path));
    if (!response.ok) throw new Error('Could not read the selected file');
    return new File([await response.blob()], input.name, { type: input.mimeType });
  } finally {
    await NativeAttachments.releaseFile({ path: input.path });
  }
}
export async function pickNativeFiles(kind: 'media' | 'files' | 'camera', video = false) {
  const result = pickResultSchema.parse(await NativeAttachments.pick({ kind, video }));
  return Promise.all(result.files.map(fileFromNative));
}
export const startNativeRecording = () => NativeAttachments.startRecording();
export async function stopNativeRecording(cancel = false) {
  const result = await NativeAttachments.stopRecording({ cancel });
  return cancel ? null : fileFromNative(nativeFileSchema.parse(result));
}

/** Small bridge messages avoid base64-encoding an entire video in WebView memory. */
export async function saveNativeFile(blob: Blob, name: string, mimeType: string) {
  await NativeAttachments.beginExport();
  try {
    for (let offset = 0; offset < blob.size; offset += 256 * 1024) {
      const bytes = new Uint8Array(await blob.slice(offset, offset + 256 * 1024).arrayBuffer());
      const parts: string[] = [];
      for (let start = 0; start < bytes.length; start += 8192)
        parts.push(String.fromCharCode(...bytes.subarray(start, start + 8192)));
      await NativeAttachments.appendExport({ data: btoa(parts.join('')) });
    }
    await NativeAttachments.saveExport({ name, mimeType });
  } catch (error) {
    await NativeAttachments.cancelExport();
    throw error;
  }
}
