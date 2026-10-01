import { Capacitor, type PluginListenerHandle, registerPlugin } from '@capacitor/core';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { getIncomingShare, saveIncomingShare, validateSharedFiles } from './shareInbox';

const nativeShareSchema = z.object({
  id: z.uuid({ version: 'v7' }),
  title: z.string(),
  text: z.string(),
  error: z.string().optional(),
  files: z.array(z.object({ path: z.string(), name: z.string(), mimeType: z.string() })),
});
const NativeShares = registerPlugin<{
  getPending(): Promise<unknown>;
  acknowledge(options: { id: string }): Promise<void>;
  addListener(
    event: 'shareAvailable',
    listener: (event: unknown) => void,
  ): Promise<PluginListenerHandle>;
}>('IncomingShares');

/** Native staging survives activity recreation and login's full page load. */
export function watchNativeShares(
  open: (id: string) => Promise<void>,
  fail: (error: unknown) => void,
) {
  if (Capacitor.getPlatform() !== 'android') return () => {};
  let stopped = false;
  let listener: PluginListenerHandle | undefined;
  let sequence = Promise.resolve();
  const check = () => {
    sequence = sequence
      .then(async () => {
        if (stopped) return;
        const { shares } = z
          .object({ shares: z.array(nativeShareSchema) })
          .parse(await NativeShares.getPending());
        for (const share of shares) {
          if (stopped) return;
          if (share.error) {
            fail(new Error(share.error));
            await NativeShares.acknowledge({ id: share.id });
            continue;
          }
          const existing = await getIncomingShare(share.id);
          if (!existing) {
            const files = [];
            for (const file of share.files) {
              const response = await fetch(Capacitor.convertFileSrc(file.path));
              if (!response.ok) throw new Error('Could not read the shared file.');
              const blob = new Blob([await response.blob()], { type: file.mimeType });
              files.push({ id: uuidv7(), name: file.name, blob });
            }
            validateSharedFiles(files);
            await saveIncomingShare({
              id: share.id,
              title: share.title,
              text: share.text,
              url: '',
              files,
              userId: null,
              complete: false,
            });
          }
          await NativeShares.acknowledge({ id: share.id });
          if (!stopped && !existing?.complete) await open(share.id);
        }
      })
      .catch(fail);
  };
  void NativeShares.addListener('shareAvailable', (event) => {
    const result = z.object({ error: z.string().optional() }).safeParse(event);
    if (result.success && result.data.error) fail(new Error(result.data.error));
    else check();
  })
    .then((handle) => {
      if (stopped) void handle.remove();
      else {
        listener = handle;
        check();
      }
    })
    .catch(fail);
  return () => {
    stopped = true;
    void listener?.remove();
  };
}
