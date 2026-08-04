import { bus } from "../core/eventBus";
import type { TurnControllerHooks } from "../state/turnController";

export type LogSource = "bus" | "hook";

export interface LogEntry {
  ts: number;
  type: string;
  source: LogSource;
  payload: Record<string, unknown>;
}

export interface LogQuery {
  limit?: number;
  typePrefix?: string;
  source?: LogSource;
  sinceMs?: number;
}

export interface LogStats {
  total: number;
  capacity: number;
  oldestTs: number | null;
  newestTs: number | null;
  bySource: Record<LogSource, number>;
  byType: Record<string, number>;
}

export type LogHandler = (entry: LogEntry) => void;

const DEFAULT_CAPACITY = 500;

export const DEFAULT_BUS_EVENT_TYPES: ReadonlyArray<string> = [
  "state:committed",
  "hero:moved",
  "settlement:captured",
  "battle:resolved",
  "turn:ended",
  "phase:changed",
  "round:changed",
  "day:changed",
  "economy:goldChanged",
  "economy:warehouseChanged",
];

export class EventLog {
  private buffer: LogEntry[] = [];
  private capacity: number = DEFAULT_CAPACITY;
  private handlers = new Set<LogHandler>();
  private busUnsubscribers: Array<() => void> = [];

  setCapacity(n: number): void {
    this.capacity = Math.max(1, n | 0);
    if (this.buffer.length > this.capacity) {
      this.buffer.splice(0, this.buffer.length - this.capacity);
    }
  }

  getCapacity(): number {
    return this.capacity;
  }

  record(type: string, source: LogSource, payload: Record<string, unknown> = {}): LogEntry {
    const entry: LogEntry = { ts: Date.now(), type, source, payload };
    this.buffer.push(entry);
    if (this.buffer.length > this.capacity) {
      this.buffer.splice(0, this.buffer.length - this.capacity);
    }
    for (const h of this.handlers) {
      try {
        h(entry);
      } catch (err) {
        console.warn("[eventLog] subscriber threw:", err);
      }
    }
    return entry;
  }

  subscribe(handler: LogHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  unsubscribe(handler: LogHandler): void {
    this.handlers.delete(handler);
  }

  getEntries(query: LogQuery = {}): LogEntry[] {
    const limit = query.limit ?? this.buffer.length;
    const sinceMs = query.sinceMs;
    const typePrefix = query.typePrefix;
    const source = query.source;
    const result: LogEntry[] = [];
    for (let i = this.buffer.length - 1; i >= 0 && result.length < limit; i--) {
      const e = this.buffer[i];
      if (sinceMs !== undefined && e.ts < sinceMs) continue;
      if (source && e.source !== source) continue;
      if (typePrefix && !e.type.startsWith(typePrefix)) continue;
      result.push(e);
    }
    return result.reverse();
  }

  clear(): void {
    this.buffer = [];
  }

  size(): number {
    return this.buffer.length;
  }

  stats(): LogStats {
    const bySource: Record<LogSource, number> = { bus: 0, hook: 0 };
    const byType: Record<string, number> = {};
    for (const e of this.buffer) {
      bySource[e.source]++;
      byType[e.type] = (byType[e.type] ?? 0) + 1;
    }
    return {
      total: this.buffer.length,
      capacity: this.capacity,
      oldestTs: this.buffer[0]?.ts ?? null,
      newestTs: this.buffer[this.buffer.length - 1]?.ts ?? null,
      bySource,
      byType,
    };
  }

  attachToBus(types: ReadonlyArray<string> = DEFAULT_BUS_EVENT_TYPES): () => void {
    for (const type of types) {
      const handler = (ev: Record<string, unknown>) => {
        const { type: _t, ...payload } = ev;
        void _t;
        this.record(type, "bus", payload as Record<string, unknown>);
      };
      bus.on(type, handler);
      this.busUnsubscribers.push(() => bus.off(type, handler));
    }
    return () => this.detachFromBus();
  }

  detachFromBus(): void {
    for (const off of this.busUnsubscribers) off();
    this.busUnsubscribers = [];
  }
}

export interface AttachEventLogOptions {
  busEventTypes?: ReadonlyArray<string>;
}

export interface AttachEventLogResult {
  log: EventLog;
  wrapHooks(hooks: TurnControllerHooks): TurnControllerHooks;
  detach(): void;
}

export function attachEventLog(opts: AttachEventLogOptions = {}): AttachEventLogResult {
  const log = new EventLog();
  const detachBus = log.attachToBus(opts.busEventTypes ?? DEFAULT_BUS_EVENT_TYPES);
  const wrapHooks = (hooks: TurnControllerHooks): TurnControllerHooks => ({
    ...hooks,
    logEvent: (event) => {
      log.record(event.type, "hook", event.payload ?? {});
      hooks.logEvent(event);
    },
  });
  return {
    log,
    wrapHooks,
    detach: () => {
      detachBus();
    },
  };
}
