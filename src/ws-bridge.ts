import type { ServerWebSocket } from "bun";

export interface WsData {
  headers?: Headers; // inbound upgrade headers, threaded into the pipeline (auth is handshake-time only)
  cancel?: () => void; // cancels the in-flight stream reader on client disconnect (RC2 abort parity)
}

// Re-frame the existing SSE bridge/passthrough output onto a WebSocket. The frames' JSON already
// carries { type, sequence_number, ... }, so each is sent verbatim as a Text message. `[DONE]` is
// dropped (the WS terminal is response.completed); response.heartbeat frames pass through and
// re-arm Codex's idle timer (unknown type → ignored). Cancelling the reader on client disconnect
// propagates to the bridge's cancel() → upstream abort.
export async function pumpSseToWebSocket(
  ws: ServerWebSocket<WsData>,
  sseStream: ReadableStream<Uint8Array>,
): Promise<void> {
  const reader = sseStream.getReader();
  ws.data.cancel = () => {
    void reader.cancel().catch(() => {});
  };
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLine = frame.split("\n").find(l => l.startsWith("data: "));
        if (!dataLine) continue;
        const payload = dataLine.slice(6);
        if (payload === "[DONE]") continue; // WS terminal is response.completed
        if (ws.readyState === 1 /* OPEN */) ws.send(payload);
      }
    }
  } finally {
    ws.data.cancel = undefined;
  }
}
