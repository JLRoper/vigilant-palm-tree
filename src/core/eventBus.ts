import type { GameEvent } from "./events";

type BusEvent = GameEvent;

// Internal storage erases the per-type payload: dispatch is keyed by `type`,
// so a handler registered for K only ever receives Extract<BusEvent, { type: K }>
// events, and the cast below is the single place that relies on that invariant.
type AnyHandler = (ev: BusEvent) => void;

class EventBus {
  private listeners = new Map<string, AnyHandler[]>();
  private onceListeners = new Map<string, AnyHandler[]>();
  private anyListeners: Array<(ev: BusEvent) => void> = [];

  on<K extends BusEvent["type"]>(
    type: K,
    handler: (ev: Extract<BusEvent, { type: K }>) => void,
  ): void {
    const list = this.listeners.get(type) ?? [];
    list.push(handler as AnyHandler);
    this.listeners.set(type, list);
  }

  once<K extends BusEvent["type"]>(
    type: K,
    handler: (ev: Extract<BusEvent, { type: K }>) => void,
  ): void {
    const list = this.onceListeners.get(type) ?? [];
    list.push(handler as AnyHandler);
    this.onceListeners.set(type, list);
  }

  off<K extends BusEvent["type"]>(
    type: K,
    handler: (ev: Extract<BusEvent, { type: K }>) => void,
  ): void {
    const list = this.listeners.get(type);
    if (!list) return;
    const idx = list.indexOf(handler as AnyHandler);
    if (idx >= 0) list.splice(idx, 1);
  }

  /** Subscribe to every event regardless of type. Returns an unsubscribe function. */
  onAny(handler: (ev: BusEvent) => void): () => void {
    this.anyListeners.push(handler);
    return () => {
      const idx = this.anyListeners.indexOf(handler);
      if (idx >= 0) this.anyListeners.splice(idx, 1);
    };
  }

  emit(ev: BusEvent): void {
    this.dispatch(ev, true);
  }

  /** Debug escape hatch (developer settings "Fire" buttons): fire a
      payload-less event that carries no catalog type. Game code should use
      emit(); raw events deliberately do not consume once() listeners. */
  emitRaw(ev: { type: string; [key: string]: unknown }): void {
    this.dispatch(ev as BusEvent, false);
  }

  private dispatch(ev: BusEvent, consumeOnce: boolean): void {
    for (const h of this.anyListeners) h(ev);
    const handlers = this.listeners.get(ev.type);
    if (handlers) {
      for (const h of handlers) h(ev);
    }
    if (consumeOnce) {
      const once = this.onceListeners.get(ev.type);
      if (once) {
        this.onceListeners.delete(ev.type);
        for (const h of once) h(ev);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
    this.onceListeners.clear();
    this.anyListeners.length = 0;
  }

  getListenerCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const [type, handlers] of this.listeners) {
      counts.set(type, handlers.length);
    }
    for (const [type, handlers] of this.onceListeners) {
      counts.set(type, (counts.get(type) ?? 0) + handlers.length);
    }
    return counts;
  }
}

export const bus = new EventBus();
export { EventBus };
