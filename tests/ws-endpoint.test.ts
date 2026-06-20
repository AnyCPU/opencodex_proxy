import { describe, expect, test } from "bun:test";
import { pumpSseToWebSocket, type WsData } from "../src/ws-bridge";
import type { ServerWebSocket } from "bun";

function mockWs(): { ws: ServerWebSocket<WsData>; sent: string[] } {
  const sent: string[] = [];
  const ws = {
    readyState: 1,
    data: {} as WsData,
    send: (m: string) => { sent.push(m); return 0; },
  } as unknown as ServerWebSocket<WsData>;
  return { ws, sent };
}

function sseStream(frames: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const f of frames) c.enqueue(enc.encode(f));
      c.close();
    },
  });
}

describe("WS endpoint re-framer (120.2)", () => {
  test("re-frames SSE data payloads as WS Text and drops [DONE]", async () => {
    const { ws, sent } = mockWs();
    await pumpSseToWebSocket(ws, sseStream([
      'event: response.created\ndata: {"type":"response.created","sequence_number":0}\n\n',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hi"}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"id":"r1"}}\n\n',
      "data: [DONE]\n\n",
    ]));
    expect(sent.length).toBe(3); // [DONE] dropped
    expect(JSON.parse(sent[0]).type).toBe("response.created");
    expect(JSON.parse(sent[2]).type).toBe("response.completed");
  });

  test("reassembles a frame split across chunks", async () => {
    const { ws, sent } = mockWs();
    await pumpSseToWebSocket(ws, sseStream([
      'event: response.created\ndata: {"type":"resp',
      'onse.created","sequence_number":0}\n\n',
    ]));
    expect(sent.length).toBe(1);
    expect(JSON.parse(sent[0]).type).toBe("response.created");
  });

  test("wires a cancel hook that aborts the stream on client disconnect (RC2)", async () => {
    const { ws } = mockWs();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start() { /* never enqueues or closes until cancelled */ },
      cancel() { cancelled = true; },
    });
    const pump = pumpSseToWebSocket(ws, stream);
    // cancel is registered synchronously, before the first awaited read.
    expect(typeof ws.data.cancel).toBe("function");
    ws.data.cancel!();
    await pump;
    expect(cancelled).toBe(true);
  });
});
