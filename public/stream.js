// Network chunks and SSE frames have different boundaries, including within UTF-8.
export async function readEvents(response, onEvent) {
  if (!response.body) throw new Error("Your browser could not open the response stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let completed = false;
  try {
    while (!completed) {
      const { value, done } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = /\r\n\r\n|\n\n|\r\r/.exec(pending))) {
        const frame = pending.slice(0, boundary.index);
        pending = pending.slice(boundary.index + boundary[0].length);
        const lines = frame.split(/\r\n|\n|\r/);
        const data = lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /, "")).join("\n");
        const event = lines.findLast(line => line.startsWith("event:"))?.slice(6).trim() || "message";
        if (!data) continue;
        if (data.trim() === "[DONE]") { completed = true; break; }
        onEvent(event, JSON.parse(data));
      }
      if (pending.length > 1_000_000) throw new Error("The response stream exceeded its size limit.");
      if (done && !completed) throw new Error("The reply was interrupted. Your partial response is kept below.");
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
