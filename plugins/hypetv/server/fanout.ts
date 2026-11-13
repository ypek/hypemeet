/**
 * One upstream connection per live MPEG-TS channel, shared by everyone watching it through the relay.
 *
 * IPTV accounts usually allow one or two connections at a time; a room watching a channel together would
 * open one each and get cut off by the panel. Here the first viewer opens the channel and later viewers of the
 * same link (same login, so the same people's list) hang on to that stream, each starting at a packet boundary.
 * When the last one leaves, the upstream is closed soon after, freeing the account for the next channel.
 */

/** MPEG-TS packets are 188 bytes, each starting with this byte. */
const SYNC = 0x47;
const PACKET = 188;
/** A viewer this far behind (bytes queued) is dropped rather than buffering the channel for it forever. */
const MAX_QUEUED = 16 * 1024 * 1024;
/** After the last viewer leaves: a player retrying or someone switching back reuses the connection. */
const LINGER_MS = 1500;

/** First offset where packets line up (two sync bytes 188 apart, or one when the chunk is shorter). */
export function syncOffset(chunk: Uint8Array): number {
  for (let i = 0; i < chunk.length; i++) {
    if (chunk[i] !== SYNC) continue;
    if (i + PACKET >= chunk.length || chunk[i + PACKET] === SYNC) return i;
  }
  return -1;
}

interface Viewer {
  controller: ReadableStreamDefaultController<Uint8Array>;
  aligned: boolean;
}

interface Channel {
  headers: Headers;
  status: number;
  viewers: Set<Viewer>;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  linger?: ReturnType<typeof setTimeout>;
  closed: boolean;
}

export interface FanoutStats {
  channels: number;
  viewers: number;
}

export function createFanout() {
  const channels = new Map<string, Channel>();

  function close(key: string, channel: Channel) {
    if (channel.closed) return;
    channel.closed = true;
    clearTimeout(channel.linger);
    if (channels.get(key) === channel) channels.delete(key);
    void channel.reader.cancel().catch(() => undefined);
    for (const v of channel.viewers) {
      try {
        v.controller.close();
      } catch {
        // already gone
      }
    }
    channel.viewers.clear();
  }

  function deliver(channel: Channel, chunk: Uint8Array) {
    for (const viewer of channel.viewers) {
      let data = chunk;
      if (!viewer.aligned) {
        const at = syncOffset(chunk);
        if (at === -1) continue;
        viewer.aligned = true;
        data = chunk.subarray(at);
      }
      if ((viewer.controller.desiredSize ?? 0) < -MAX_QUEUED) {
        channel.viewers.delete(viewer);
        try {
          viewer.controller.error(new Error("too slow"));
        } catch {
          // already gone
        }
        continue;
      }
      viewer.controller.enqueue(data);
    }
  }

  async function pump(key: string, channel: Channel) {
    try {
      for (;;) {
        const { done, value } = await channel.reader.read();
        if (done || channel.closed) break;
        deliver(channel, value);
      }
    } catch {
      // upstream dropped: viewers see the end and their players retry
    }
    close(key, channel);
  }

  function join(key: string, channel: Channel, onLeave: () => void): Response {
    clearTimeout(channel.linger);
    let viewer: Viewer;
    const leave = () => {
      if (!channel.viewers.delete(viewer)) return;
      onLeave();
      if (!channel.viewers.size) channel.linger = setTimeout(() => close(key, channel), LINGER_MS);
    };
    const body = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          viewer = { controller, aligned: false };
          channel.viewers.add(viewer);
        },
        cancel: leave,
      },
      { highWaterMark: 0 },
    );
    return new Response(body, { status: channel.status, headers: channel.headers });
  }

  return {
    /** A viewer of an already open channel, or null when nobody has it open. */
    tryJoin(key: string, onLeave: () => void): Response | null {
      const channel = channels.get(key);
      return channel && !channel.closed ? join(key, channel, onLeave) : null;
    },
    /** Opens a channel on an upstream response (2xx, MPEG-TS) and makes the caller its first viewer. */
    open(key: string, upstream: Response, headers: Headers, onLeave: () => void): Response {
      const existing = channels.get(key);
      if (existing && !existing.closed) {
        // Two first viewers raced: keep the one already open, drop the new connection.
        void upstream.body?.cancel();
        return join(key, existing, onLeave);
      }
      const channel: Channel = { headers, status: upstream.status, viewers: new Set(), reader: upstream.body!.getReader(), closed: false };
      channels.set(key, channel);
      const response = join(key, channel, onLeave);
      void pump(key, channel);
      return response;
    },
    stats(): FanoutStats {
      let viewers = 0;
      for (const c of channels.values()) viewers += c.viewers.size;
      return { channels: channels.size, viewers };
    },
  };
}
