import { NativeModules, Platform, NativeEventEmitter, EmitterSubscription } from 'react-native';
import { Buffer } from 'buffer';
import type { OfflineBundle, AttestationEnvelope } from '@beam/shared';
import { encodeOfflineBundle, decodeOfflineBundle, type PersistedOfflineBundle } from '../storage/BundleStorage';

type BundleListener = (message: MeshBundleMessage) => void;
type DiagnosticsListener = (diagnostics: MeshDiagnostics) => void;

const MODULE_NAME = 'MeshNetworkBridge';
const MAX_MESH_PAYLOAD_BYTES = 8 * 1024;
const MAX_QUEUE_SIZE = 32;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_INITIAL_DELAY_MS = 2_000;
const QUEUE_FLUSH_INTERVAL_MS = 4_000;
const MAX_RETRY_DELAY_MS = 60_000;

export interface MeshDiscoveryOptions {
  serviceUuid: string;
  timeoutMs?: number;
  allowRelay?: boolean;
}

export interface MeshBroadcastResult {
  success: boolean;
  relaysReached: number;
}

export interface MeshNetworkModule {
  startMeshNode(serviceUuid: string): Promise<void>;
  stopMeshNode(): Promise<void>;
  broadcastBundle(bundle: string): Promise<MeshBroadcastResult>;
  subscribeBundles(): Promise<void>;
  requestPeers(options: MeshDiscoveryOptions): Promise<string[]>;
}

export interface MeshBundleMessage {
  bundle: OfflineBundle;
  payerAttestation?: AttestationEnvelope;
  merchantAttestation?: AttestationEnvelope;
}

export interface MeshDiagnostics {
  started: boolean;
  serviceUuid: string | null;
  queueLength: number;
  lastBroadcastAt: number | null;
  lastSuccessAt: number | null;
  lastReceiveAt: number | null;
  lastError: string | null;
  relaysReached: number | null;
}

interface QueueOptions {
  serviceUuid?: string;
  maxAttempts: number;
  initialDelayMs: number;
}

interface QueueItem {
  message: MeshBundleMessage;
  serviceUuid?: string;
  attempts: number;
  nextAttemptAt: number;
  maxAttempts: number;
  initialDelayMs: number;
}

const NativeMesh: MeshNetworkModule | undefined =
  (NativeModules as unknown as {
    [MODULE_NAME]?: MeshNetworkModule;
  })[MODULE_NAME];

class NoopMeshNetwork implements MeshNetworkModule {
  async startMeshNode(): Promise<void> {
    if (__DEV__) {
      console.warn('Mesh network bridge not implemented for', Platform.OS);
    }
  }

  async stopMeshNode(): Promise<void> {}

  async broadcastBundle(): Promise<MeshBroadcastResult> {
    return { success: false, relaysReached: 0 };
  }

  async subscribeBundles(): Promise<void> {
    if (__DEV__) {
      console.warn('Mesh network subscription unavailable');
    }
  }

  async requestPeers(): Promise<string[]> {
    return [];
  }
}

function encodeAttestation(envelope?: AttestationEnvelope | null) {
  if (!envelope) {
    return null;
  }

  return {
    bundleId: envelope.bundleId,
    timestamp: envelope.timestamp,
    nonce: Buffer.from(envelope.nonce).toString('base64'),
    attestationReport: Buffer.from(envelope.attestationReport).toString('base64'),
    signature: Buffer.from(envelope.signature).toString('base64'),
    certificateChain: envelope.certificateChain.map(cert => Buffer.from(cert).toString('base64')),
    deviceInfo: envelope.deviceInfo,
  };
}

function decodeAttestation(raw: any): AttestationEnvelope | undefined {
  if (!raw) {
    return undefined;
  }

  try {
    return {
      bundleId: raw.bundleId,
      timestamp: raw.timestamp,
      nonce: Buffer.from(raw.nonce, 'base64'),
      attestationReport: Buffer.from(raw.attestationReport, 'base64'),
      signature: Buffer.from(raw.signature, 'base64'),
      certificateChain: Array.isArray(raw.certificateChain)
        ? raw.certificateChain.map((entry: string) => Buffer.from(entry, 'base64'))
        : [],
      deviceInfo: raw.deviceInfo,
    };
  } catch (err) {
    if (__DEV__) {
      console.error('Failed to decode mesh attestation', err);
    }
    return undefined;
  }
}

class MeshNetworkService {
  private readonly bridge: MeshNetworkModule;
  private eventEmitter: NativeEventEmitter | null = null;
  private subscription: EmitterSubscription | null = null;
  private started = false;
  private serviceUuid: string | null = null;
  private queue: QueueItem[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private diagnostics: MeshDiagnostics = {
    started: false,
    serviceUuid: null,
    queueLength: 0,
    lastBroadcastAt: null,
    lastSuccessAt: null,
    lastReceiveAt: null,
    lastError: null,
    relaysReached: null,
  };
  private diagnosticsListeners = new Set<DiagnosticsListener>();
  private bundleListeners = new Set<BundleListener>();

  constructor(bridge: MeshNetworkModule) {
    this.bridge = bridge;
    if (bridge !== (NativeMesh as MeshNetworkModule | undefined)) {
      this.eventEmitter = null;
    } else if (bridge) {
      this.eventEmitter = new NativeEventEmitter(NativeModules[MODULE_NAME]);
    }
  }

  getDiagnostics(): MeshDiagnostics {
    return { ...this.diagnostics };
  }

  addDiagnosticsListener(listener: DiagnosticsListener): () => void {
    this.diagnosticsListeners.add(listener);
    listener(this.getDiagnostics());
    return () => {
      this.diagnosticsListeners.delete(listener);
    };
  }

  async startMeshNode(serviceUuid: string): Promise<void> {
    if (this.started) {
      if (this.serviceUuid === serviceUuid) {
        return;
      }
      await this.stopMeshNode();
    }

    await this.bridge.startMeshNode(serviceUuid);
    this.serviceUuid = serviceUuid;
    this.started = true;
    this.updateDiagnostics({ started: true, serviceUuid });
    this.startFlushLoop();
  }

  async stopMeshNode(): Promise<void> {
    if (!this.started) {
      return;
    }

    await this.bridge.stopMeshNode();
    this.started = false;
    this.serviceUuid = null;
    this.teardownSubscription();
    this.updateDiagnostics({ started: false, serviceUuid: null });
    this.stopFlushLoop();
  }

  async ensureActive(serviceUuid: string): Promise<void> {
    if (!this.started || this.serviceUuid !== serviceUuid) {
      await this.startMeshNode(serviceUuid);
    }
  }

  async broadcastBundle(
    bundle: OfflineBundle,
    serviceUuid?: string,
    payerAttestation?: AttestationEnvelope,
    merchantAttestation?: AttestationEnvelope
  ): Promise<MeshBroadcastResult> {
    const message: MeshBundleMessage = { bundle, payerAttestation, merchantAttestation };
    const targetService = serviceUuid ?? this.serviceUuid ?? undefined;
    return this.sendPayload(message, targetService);
  }

  async queueBundle(
    bundle: OfflineBundle,
    serviceUuid?: string,
    payerAttestation?: AttestationEnvelope,
    merchantAttestation?: AttestationEnvelope,
    options?: Partial<QueueOptions>
  ): Promise<void> {
    const queueOptions: QueueOptions = {
      serviceUuid,
      maxAttempts: options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      initialDelayMs: options?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS,
    };

    if (queueOptions.serviceUuid) {
      await this.ensureActive(queueOptions.serviceUuid);
    }

    if (this.queue.length >= MAX_QUEUE_SIZE) {
      this.queue.shift();
    }

    this.queue.push({
      message: { bundle, payerAttestation, merchantAttestation },
      serviceUuid: queueOptions.serviceUuid ?? this.serviceUuid ?? undefined,
      attempts: 0,
      nextAttemptAt: Date.now(),
      maxAttempts: queueOptions.maxAttempts,
      initialDelayMs: queueOptions.initialDelayMs,
    });

    this.updateDiagnostics({ queueLength: this.queue.length });
    this.startFlushLoop();
    await this.flushQueue();
  }

  async subscribe(callback: BundleListener, serviceUuid?: string): Promise<() => void> {
    if (serviceUuid) {
      await this.ensureActive(serviceUuid);
    }
    await this.bridge.subscribeBundles();
    if (!this.eventEmitter) {
      if (__DEV__) {
        console.warn('Mesh network events not supported on this platform');
      }
      this.bundleListeners.add(callback);
      return () => {
        this.bundleListeners.delete(callback);
      };
    }
    this.bundleListeners.add(callback);
    if (!this.subscription) {
      this.subscription = this.eventEmitter.addListener('meshBundle', event => {
        try {
          const parsed = JSON.parse(event.bundle);
          if (!parsed || typeof parsed !== 'object') {
            return;
          }
          const encodedBundle = parsed.bundle as PersistedOfflineBundle | undefined;
          if (!encodedBundle) {
            return;
          }

          const payload: MeshBundleMessage = {
            bundle: decodeOfflineBundle(encodedBundle),
            payerAttestation: decodeAttestation(parsed.payerAttestation),
            merchantAttestation: decodeAttestation(parsed.merchantAttestation),
          };
          this.updateDiagnostics({ lastReceiveAt: Date.now() });
          this.bundleListeners.forEach(listener => {
            try {
              listener(payload);
            } catch (err) {
              if (__DEV__) {
                console.error('Mesh bundle listener error', err);
              }
            }
          });
        } catch (err) {
          if (__DEV__) {
            console.error('Failed to parse mesh bundle', err);
          }
        }
      });
    }

    return () => {
      this.bundleListeners.delete(callback);
      if (this.bundleListeners.size === 0) {
        this.teardownSubscription();
      }
    };
  }

  async requestPeers(options: MeshDiscoveryOptions): Promise<string[]> {
    if (!this.started && options.serviceUuid) {
      await this.ensureActive(options.serviceUuid);
    }
    return this.bridge.requestPeers(options);
  }

  private async sendPayload(message: MeshBundleMessage, serviceUuid?: string): Promise<MeshBroadcastResult> {
    if (serviceUuid) {
      await this.ensureActive(serviceUuid);
    }
    if (!this.started) {
      throw new Error('Mesh network not started');
    }

    const payload = JSON.stringify({
      bundle: encodeOfflineBundle(message.bundle) as PersistedOfflineBundle,
      payerAttestation: encodeAttestation(message.payerAttestation),
      merchantAttestation: encodeAttestation(message.merchantAttestation),
    });

    if (Buffer.byteLength(payload, 'utf8') > MAX_MESH_PAYLOAD_BYTES) {
      throw new Error('Mesh payload exceeds size limit');
    }

    const result = await this.bridge.broadcastBundle(payload);
    const now = Date.now();
    this.updateDiagnostics({
      lastBroadcastAt: now,
      relaysReached: result.relaysReached,
      lastSuccessAt: result.success ? now : this.diagnostics.lastSuccessAt,
      lastError: result.success ? null : this.diagnostics.lastError,
    });
    return result;
  }

  private startFlushLoop(): void {
    if (this.flushTimer) {
      return;
    }
    this.flushTimer = setInterval(() => {
      void this.flushQueue();
    }, QUEUE_FLUSH_INTERVAL_MS);
  }

  private stopFlushLoop(): void {
    if (this.flushTimer && this.queue.length === 0) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private async flushQueue(): Promise<void> {
    if (!this.started || this.queue.length === 0) {
      this.stopFlushLoop();
      return;
    }

    const now = Date.now();
    for (let i = 0; i < this.queue.length; ) {
      const item = this.queue[i];
      if (item.nextAttemptAt > now) {
        i += 1;
        continue;
      }

      try {
        const result = await this.sendPayload(item.message, item.serviceUuid);
        item.attempts += 1;
        if (result.success || item.attempts >= item.maxAttempts) {
          this.queue.splice(i, 1);
          this.updateDiagnostics({ queueLength: this.queue.length, lastError: result.success ? null : this.diagnostics.lastError });
          continue;
        }
        // treat unsuccessful attempt as retry
        item.nextAttemptAt = now + Math.min(item.initialDelayMs * Math.pow(2, item.attempts), MAX_RETRY_DELAY_MS);
        this.updateDiagnostics({ lastError: 'Mesh broadcast failed' });
        i += 1;
      } catch (err) {
        item.attempts += 1;
        item.nextAttemptAt = now + Math.min(item.initialDelayMs * Math.pow(2, item.attempts), MAX_RETRY_DELAY_MS);
        if (item.attempts >= item.maxAttempts) {
          this.queue.splice(i, 1);
        } else {
          i += 1;
        }
        this.updateDiagnostics({
          queueLength: this.queue.length,
          lastError: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.updateDiagnostics({ queueLength: this.queue.length });
    this.stopFlushLoop();
  }

  private teardownSubscription(): void {
    if (this.subscription) {
      this.subscription.remove();
      this.subscription = null;
    }
    this.bundleListeners.clear();
  }

  private updateDiagnostics(patch: Partial<MeshDiagnostics>): void {
    this.diagnostics = { ...this.diagnostics, ...patch };
    const snapshot = this.getDiagnostics();
    this.diagnosticsListeners.forEach(listener => listener(snapshot));
  }
}

const bridge = NativeMesh ?? new NoopMeshNetwork();
export const meshNetwork = new MeshNetworkService(bridge);
export type { MeshBundleMessage, MeshDiagnostics };
