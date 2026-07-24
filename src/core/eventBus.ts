type Handler = (ev: any) => void;

class EventBus {
  private listeners = new Map<string, Handler[]>();

  on(type: string, handler: Handler): void {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  off(type: string, handler: Handler): void {
    const list = this.listeners.get(type);
    if (!list) return;
    const idx = list.indexOf(handler);
    if (idx >= 0) list.splice(idx, 1);
  }

  emit(ev: { type: string;[key: string]: any }): void {
    const handlers = this.listeners.get(ev.type);
    if (!handlers || handlers.length === 0) return;
    for (const h of handlers) h(ev);
  }

  clear(): void {
    this.listeners.clear();
  }
}

export const bus = new EventBus();
export { EventBus };
export type { Handler };
