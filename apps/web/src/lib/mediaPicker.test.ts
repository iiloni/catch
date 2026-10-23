import { Blob as NodeBlob } from 'node:buffer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveNativeFile } from './mediaPicker';

const bridge = vi.hoisted(() => ({
  beginExport: vi.fn(),
  appendExport: vi.fn(),
  saveExport: vi.fn(),
  cancelExport: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({ registerPlugin: () => bridge }));
beforeEach(() => vi.resetAllMocks());

// jsdom's Blob lacks arrayBuffer; use Node's implementation for bridge byte tests.
const blob = (parts: string[]) => new NodeBlob(parts) as unknown as Blob;

describe('native snippet export', () => {
  it('creates a file even for an empty snippet', async () => {
    await saveNativeFile(blob([]), 'snippet.txt', 'text/plain');
    expect(bridge.beginExport).toHaveBeenCalledOnce();
    expect(bridge.appendExport).toHaveBeenCalledWith({ data: '' });
    expect(bridge.saveExport).toHaveBeenCalledWith({ name: 'snippet.txt', mimeType: 'text/plain' });
  });

  it('passes UTF-8 bytes without trimming or adding a newline', async () => {
    const source = '  print("héllo 🦊")\n\n';
    await saveNativeFile(blob([source]), 'snippet.py', 'text/plain');
    expect(bridge.appendExport).toHaveBeenCalledWith({
      data: Buffer.from(source).toString('base64'),
    });
    expect(bridge.cancelExport).not.toHaveBeenCalled();
  });

  it('releases the temporary export after a failure', async () => {
    bridge.appendExport.mockRejectedValueOnce(new Error('Could not write'));
    await expect(saveNativeFile(blob(['code']), 'snippet.txt', 'text/plain')).rejects.toThrow(
      'Could not write',
    );
    expect(bridge.cancelExport).toHaveBeenCalledOnce();
    expect(bridge.saveExport).not.toHaveBeenCalled();
  });
});
