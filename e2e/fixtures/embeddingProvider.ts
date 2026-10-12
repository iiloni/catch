import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';

const inputSchema = z.object({ model: z.string(), input: z.array(z.string()) });
export type EmbeddingCall = {
  path: string;
  input: string[];
  model: string;
  authorization?: string;
};

/** A real HTTP endpoint, with stable synonym vectors and controllable failures/delays. */
export async function fakeEmbeddingProvider(host = '127.0.0.1') {
  const calls: EmbeddingCall[] = [];
  const state = {
    fail: false,
    failureStatus: 400,
    dimensions: 3,
    beforeReply: null as (() => Promise<void>) | null,
    maxInputs: Number.POSITIVE_INFINITY,
    rejectText: null as string | null,
  };
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url?.endsWith('/models')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'fake-embedding' }, { id: 'chat-only' }] }));
      return;
    }
    let body = '';
    for await (const chunk of req) body += String(chunk);
    const parsed = inputSchema.safeParse(JSON.parse(body || '{}'));
    if (!parsed.success) {
      res.writeHead(400).end();
      return;
    }
    calls.push({ path: req.url ?? '', ...parsed.data, authorization: req.headers.authorization });
    await state.beforeReply?.();
    if (parsed.data.input.length > state.maxInputs) {
      res.writeHead(413).end();
      return;
    }
    if (state.rejectText && parsed.data.input.some((text) => text.includes(state.rejectText!))) {
      res.writeHead(400).end();
      return;
    }
    if (state.fail || parsed.data.model === 'chat-only') {
      res
        .writeHead(parsed.data.model === 'chat-only' ? 400 : state.failureStatus)
        .end('private text and secret must never escape');
      return;
    }
    const embeddings = parsed.data.input.map((text) => {
      const vector = /bicycle|cycling|bike/i.test(text)
        ? [1, 0, 0]
        : /food|grocer|milk/i.test(text)
          ? [0, 1, 0]
          : [0, 0, 1];
      return Array.from({ length: state.dimensions }, (_, index) => vector[index] ?? 0);
    });
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify(
        req.url?.endsWith('/api/embed')
          ? { embeddings }
          : {
              data: embeddings.map((embedding, index) => ({ index, embedding })),
            },
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fake provider port');
  return {
    calls,
    state,
    port: address.port,
    url: `http://127.0.0.1:${address.port}/v1`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
