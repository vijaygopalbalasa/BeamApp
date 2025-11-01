import { MeshNetworkService, type AdvertisingStateEvent, type ScanStateEvent, type ScanResultEvent, type BundleBroadcastEvent, type BLEConnectionStateEvent, type BLEErrorEvent } from './MeshNetworkService';

export type MeshDiagnosticEventType =
  | 'advertising'
  | 'scan'
  | 'scan-result'
  | 'bundle-broadcast'
  | 'connection'
  | 'queue'
  | 'error';

export interface MeshDiagnosticEvent {
  id: string;
  type: MeshDiagnosticEventType;
  timestamp: number;
  payload: Record<string, unknown>;
}

type Subscriber = (events: MeshDiagnosticEvent[]) => void;

class MeshDiagnosticsStore {
  private events: MeshDiagnosticEvent[] = [];
  private subscribers: Set<Subscriber> = new Set();
  private maxEvents = 200;
  private attached = false;
  private counter = 0;

  attach(service: MeshNetworkService) {
    if (this.attached) {
      return;
    }
    this.attached = true;

    service.onAdvertisingStateChange((event: AdvertisingStateEvent) => {
      this.record('advertising', event);
    });

    service.onScanStateChange((event: ScanStateEvent) => {
      this.record('scan', event);
    });

    service.onScanResult((event: ScanResultEvent) => {
      this.record('scan-result', event);
    });

    service.onBundleBroadcast((event: BundleBroadcastEvent) => {
      this.record('bundle-broadcast', event);
    });

    service.onConnectionStateChange((event: BLEConnectionStateEvent) => {
      this.record('connection', event);
    });

    service.onError((event: BLEErrorEvent) => {
      this.record('error', event);
    });
  }

  record(type: MeshDiagnosticEventType, payload: Record<string, unknown>) {
    const timestamp =
      typeof payload.timestamp === 'number' && Number.isFinite(payload.timestamp)
        ? (payload.timestamp as number)
        : Date.now();

    const event: MeshDiagnosticEvent = {
      id: `${timestamp}-${this.counter++}`,
      type,
      timestamp,
      payload: { ...payload },
    };

    this.events = [event, ...this.events].slice(0, this.maxEvents);
    this.notify();
  }

  getEvents(): MeshDiagnosticEvent[] {
    return this.events;
  }

  subscribe(callback: Subscriber): () => void {
    this.subscribers.add(callback);
    callback(this.events);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  clear() {
    this.events = [];
    this.notify();
  }

  writeQueueSnapshot(role: 'customer' | 'merchant', pending: Array<{ bundle: { tx_id: string }; state?: string }>) {
    const breakdown = pending.reduce(
      (acc, item) => {
        const state = item.state ?? 'unknown';
        acc[state] = (acc[state] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    this.record('queue', {
      role,
      total: pending.length,
      breakdown,
      firstBundle: pending[0]?.bundle.tx_id,
      timestamp: Date.now(),
    });
  }

  private notify() {
    this.subscribers.forEach(sub => sub(this.events));
  }
}

export const meshDiagnosticsStore = new MeshDiagnosticsStore();
