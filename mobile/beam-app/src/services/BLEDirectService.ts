/**
 * BLE DIRECT P2P SERVICE - Point-to-Point Bluetooth Payment Transfer
 *
 * IMPORTANT: This is NOT a mesh network. It's direct 1:1 BLE connections.
 *
 * What this actually does:
 * - Direct BLE GATT connections between 2 devices (merchant ↔ customer)
 * - Merchant advertises as BLE peripheral
 * - Customer connects as BLE central
 * - Payment bundles transferred over GATT characteristic
 * - Connection is temporary (disconnects after transfer)
 *
 * Features:
 * ✅ BLE peripheral advertising (merchants)
 * ✅ BLE central scanning (customers)
 * ✅ Direct data transfer (no multi-hop)
 * ✅ Queue persistence
 * ✅ Automatic retry on failure
 *
 * Architecture:
 * - Native Android module: MeshNetworkBridge.kt (handles BLE GATT)
 * - TypeScript service layer (this file)
 * - Persistent queue with AsyncStorage
 *
 * @see /android/app/src/main/java/com/beam/app/bridge/MeshNetworkBridge.kt
 */

import { NativeModules, Platform, NativeEventEmitter, EmitterSubscription } from 'react-native';
import { Buffer } from 'buffer';
import EncryptedStorage from 'react-native-encrypted-storage';
import type { OfflineBundle, AttestationEnvelope } from '@beam/shared';
import { encodeOfflineBundle, decodeOfflineBundle, type PersistedOfflineBundle } from '../storage/BundleStorage';

type BundleListener = (message: BLEBundleMessage) => void;
type DiagnosticsListener = (diagnostics: BLEDiagnostics) => void;

const MODULE_NAME = 'MeshNetworkBridge'; // Note: Native module name unchanged
const MAX_BLE_PAYLOAD_BYTES = 8 * 1024;
const MAX_QUEUE_SIZE = 32;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_INITIAL_DELAY_MS = 2_000;
const QUEUE_FLUSH_INTERVAL_MS = 4_000;
const MAX_RETRY_DELAY_MS = 60_000;
const BLE_QUEUE_STORAGE_KEY = '@beam:ble_queue';

export interface BLEDiscoveryOptions {
  serviceUuid: string;
  timeoutMs?: number;
  allowRelay?: boolean;
}

export interface BLEBroadcastResult {
  success: boolean;
  peersReached: number; // Renamed from relaysReached (not a mesh)
}

export interface BLEDirectModule {
  startMeshNode(config: { nodeType: string; pubkey?: string }): Promise<{ status: string; nodeType: string; pubkey?: string }>;
  stopMeshNode(): Promise<{ status: string }>;
  broadcastBundle(bundleData: any): Promise<BLEBroadcastResult>;
  requestPeers(): Promise<Array<{ address: string; name: string; rssi: number; connected: boolean }>>;
  getDiagnostics(): Promise<any>;
}

export interface BLEBundleMessage {
  bundle: OfflineBundle;
  payerAttestation?: AttestationEnvelope;
  merchantAttestation?: AttestationEnvelope;
}

export interface BLEDiagnostics {
  started: boolean;
  serviceUuid: string | null;
  queueLength: number;
  lastBroadcastAt: number | null;
  lastSuccessAt: number | null;
  lastReceiveAt: number | null;
  lastError: string | null;
  peersReached: number | null; // Renamed from relaysReached
}

interface QueueOptions {
  serviceUuid?: string;
  maxAttempts: number;
  initialDelayMs: number;
}

interface QueueItem {
  message: BLEBundleMessage;
  serviceUuid?: string;
  attempts: number;
  nextAttemptAt: number;
  maxAttempts: number;
  initialDelayMs: number;
}

interface PersistedQueueItem {
  message: {
    bundle: PersistedOfflineBundle;
    payerAttestation?: any;
    merchantAttestation?: any;
  };
  serviceUuid?: string;
  attempts: number;
  nextAttemptAt: number;
  maxAttempts: number;
  initialDelayMs: number;
}

// Phase 2.3: ACK/NACK tracking
interface PendingAck {
  bundleId: string;
  message: BLEBundleMessage;
  sentAt: number;
  retryCount: number;
  timeoutHandle: ReturnType<typeof setTimeout>;
}


const NativeBLE: BLEDirectModule | undefined =
  (NativeModules as unknown as {
    [MODULE_NAME]?: BLEDirectModule;
  })[MODULE_NAME];

class NoopBLEDirect implements BLEDirectModule {
  async startMeshNode(): Promise<{ status: string; nodeType: string; pubkey?: string }> {
    if (__DEV__) {
      console.warn('BLE Direct bridge not implemented for', Platform.OS);
    }
    return { status: 'noop', nodeType: 'relay' };
  }

  async stopMeshNode(): Promise<{ status: string }> {
    return { status: 'noop' };
  }

  async broadcastBundle(): Promise<BLEBroadcastResult> {
    return { success: false, peersReached: 0 };
  }

  async requestPeers(): Promise<Array<{ address: string; name: string; rssi: number; connected: boolean }>> {
    return [];
  }

  async getDiagnostics(): Promise<any> {
    return {
      started: false,
      nodeType: 'noop',
      connectedPeers: 0,
      pendingBundles: 0,
      seenBundleHashes: 0,
      advertising: false,
      scanning: false,
    };
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
      console.error('Failed to decode BLE attestation', err);
    }
    return undefined;
  }
}

class BLEDirectService {
  private readonly bridge: BLEDirectModule;
  private eventEmitter: NativeEventEmitter | null = null;
  private subscription: EmitterSubscription | null = null;
  private started = false;
  private serviceUuid: string | null = null;
  private queue: QueueItem[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private diagnostics: BLEDiagnostics = {
    started: false,
    serviceUuid: null,
    queueLength: 0,
    lastBroadcastAt: null,
    lastSuccessAt: null,
    lastReceiveAt: null,
    lastError: null,
    peersReached: null,
  };
  private diagnosticsListeners = new Set<DiagnosticsListener>();
  private bundleListeners = new Set<BundleListener>();

  // Phase 2.3: Message acknowledgment tracking
  private pendingAcks = new Map<string, PendingAck>();
  private readonly ACK_TIMEOUT_MS = 5000; // 5 second timeout
  private readonly MAX_ACK_RETRIES = 3;
  private ackListeners = new Set<(ev: { bundleId: string; type: 'ack' | 'nack' | 'timeout'; reason?: string }) => void>();

  constructor(bridge: BLEDirectModule) {
    this.bridge = bridge;
    if (bridge !== (NativeBLE as BLEDirectModule | undefined)) {
      this.eventEmitter = null;
    } else if (bridge) {
      this.eventEmitter = new NativeEventEmitter(NativeModules[MODULE_NAME]);
    }

    // Load persisted queue on startup
    this.loadQueue().catch(err => {
      if (__DEV__) {
        console.error('Failed to load BLE queue on startup:', err);
      }
    });
  }

  getDiagnostics(): BLEDiagnostics {
    return { ...this.diagnostics };
  }

  addAckListener(listener: (ev: { bundleId: string; type: 'ack' | 'nack' | 'timeout'; reason?: string }) => void): () => void {
    this.ackListeners.add(listener);
    return () => this.ackListeners.delete(listener);
  }

  addDiagnosticsListener(listener: DiagnosticsListener): () => void {
    this.diagnosticsListeners.add(listener);
    listener(this.getDiagnostics());
    return () => {
      this.diagnosticsListeners.delete(listener);
    };
  }

  async startBLENode(serviceUuid: string, nodeType: string = 'relay', pubkey?: string): Promise<void> {
    console.log('[BLEDirect] Starting BLE node:', { serviceUuid, nodeType, pubkey });

    if (this.started) {
      if (this.serviceUuid === serviceUuid) {
        console.log('[BLEDirect] BLE node already started with same service UUID');
        return;
      }
      await this.stopBLENode();
    }

    try {
      const result = await this.bridge.startMeshNode({ nodeType, pubkey });
      console.log('[BLEDirect] ✅ BLE node started:', result);

      this.serviceUuid = serviceUuid;
      this.started = true;
      this.updateDiagnostics({ started: true, serviceUuid });
      this.startFlushLoop();

      // Setup event listeners
      this.setupEventListeners();
    } catch (err) {
      console.error('[BLEDirect] ❌ Failed to start BLE node:', err);
      throw err;
    }
  }

  async stopBLENode(): Promise<void> {
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
      await this.startBLENode(serviceUuid);
    }
  }

  async broadcastBundle(
    bundle: OfflineBundle,
    serviceUuid?: string,
    payerAttestation?: AttestationEnvelope,
    merchantAttestation?: AttestationEnvelope
  ): Promise<BLEBroadcastResult> {
    console.log('[BLEDirect] broadcastBundle called with bundle:', bundle.tx_id);

    if (!this.started) {
      console.warn('[BLEDirect] BLE not started, cannot broadcast');
      return { success: false, peersReached: 0 };
    }

    const message: BLEBundleMessage = { bundle, payerAttestation, merchantAttestation };
    const targetService = serviceUuid ?? this.serviceUuid ?? undefined;

    console.log('[BLEDirect] Broadcasting bundle via native bridge...');
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
    await this.saveQueue(); // Persist queue after adding item
    this.startFlushLoop();
    await this.flushQueue();
  }

  async subscribe(callback: BundleListener, serviceUuid?: string): Promise<() => void> {
    if (serviceUuid) {
      await this.ensureActive(serviceUuid);
    }
    // No native subscribeBundles call needed - the bridge automatically emits events
    // when bundles are received via BLE
    if (!this.eventEmitter) {
      if (__DEV__) {
        console.warn('BLE Direct events not supported on this platform');
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

          const payload: BLEBundleMessage = {
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
                console.error('BLE bundle listener error', err);
              }
            }
          });
        } catch (err) {
          if (__DEV__) {
            console.error('Failed to parse BLE bundle', err);
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

  async requestPeers(options?: BLEDiscoveryOptions): Promise<Array<{ address: string; name: string; rssi: number; connected: boolean }>> {
    if (!this.started && options?.serviceUuid) {
      await this.ensureActive(options.serviceUuid);
    }
    // Native bridge requestPeers takes no arguments and returns array of peer info
    return this.bridge.requestPeers();
  }

  // Phase 2.3: Handle ACK received from peer
  private handleAckReceived(bundleId: string): void {
    const pending = this.pendingAcks.get(bundleId);
    if (!pending) {
      return; // Already processed or not tracking this bundle
    }

    console.log('[BLEDirect] ✅ ACK received for bundle:', bundleId);

    // Clear timeout
    clearTimeout(pending.timeoutHandle);

    // Remove from pending
    this.pendingAcks.delete(bundleId);

    // Update diagnostics
    this.updateDiagnostics({
      lastSuccessAt: Date.now(),
      lastError: null,
    });

    // Notify listeners
    this.ackListeners.forEach(fn => fn({ bundleId, type: 'ack' }));
  }

  // Phase 2.3: Handle NACK received from peer
  private handleNackReceived(bundleId: string, reason?: string): void {
    const pending = this.pendingAcks.get(bundleId);
    if (!pending) {
      return;
    }

    console.warn('[BLEDirect] ❌ NACK received for bundle:', bundleId, 'reason:', reason);

    // Clear timeout
    clearTimeout(pending.timeoutHandle);

    // Retry if attempts remain
    if (pending.retryCount < this.MAX_ACK_RETRIES) {
      console.log(`[BLEDirect] Retrying bundle ${bundleId} (attempt ${pending.retryCount + 1}/${this.MAX_ACK_RETRIES})`);

      // Schedule retry with exponential backoff
      const delay = Math.min(1000 * Math.pow(2, pending.retryCount), 10000);
      setTimeout(() => {
        this.retryBundle(bundleId).catch(err => {
          console.error('[BLEDirect] Retry failed:', err);
        });
      }, delay);
    } else {
      console.error(`[BLEDirect] Max retries (${this.MAX_ACK_RETRIES}) reached for bundle ${bundleId}`);
      this.pendingAcks.delete(bundleId);
      this.updateDiagnostics({ lastError: `Bundle ${bundleId} failed after ${this.MAX_ACK_RETRIES} retries` });
      this.ackListeners.forEach(fn => fn({ bundleId, type: 'nack', reason }));
    }
  }

  // Phase 2.3: Handle ACK timeout
  private handleAckTimeout(bundleId: string): void {
    const pending = this.pendingAcks.get(bundleId);
    if (!pending) {
      return;
    }

    console.warn(`[BLEDirect] ⏱️ ACK timeout for bundle ${bundleId} after ${this.ACK_TIMEOUT_MS}ms`);

    // Retry if attempts remain
    if (pending.retryCount < this.MAX_ACK_RETRIES) {
      console.log(`[BLEDirect] Retrying bundle ${bundleId} (attempt ${pending.retryCount + 1}/${this.MAX_ACK_RETRIES})`);

      this.retryBundle(bundleId).catch(err => {
        console.error('[BLEDirect] Retry failed:', err);
      });
    } else {
      console.error(`[BLEDirect] Max retries (${this.MAX_ACK_RETRIES}) reached for bundle ${bundleId} - giving up`);
      this.pendingAcks.delete(bundleId);
      this.updateDiagnostics({ lastError: `Bundle ${bundleId} timed out after ${this.MAX_ACK_RETRIES} retries` });
      this.ackListeners.forEach(fn => fn({ bundleId, type: 'timeout' }));
    }
  }

  // Phase 2.3: Retry sending a bundle
  private async retryBundle(bundleId: string): Promise<void> {
    const pending = this.pendingAcks.get(bundleId);
    if (!pending) {
      return;
    }

    // Update retry count
    pending.retryCount += 1;
    pending.sentAt = Date.now();

    // Start new ACK timeout
    pending.timeoutHandle = setTimeout(() => {
      this.handleAckTimeout(bundleId);
    }, this.ACK_TIMEOUT_MS);

    // Resend the bundle
    try {
      await this.sendPayload(pending.message);
    } catch (err) {
      console.error('[BLEDirect] Failed to retry bundle:', err);
      this.handleAckTimeout(bundleId); // Trigger retry logic
    }
  }

  // Phase 2.3: Start tracking ACK for a bundle
  private trackBundleAck(bundleId: string, message: BLEBundleMessage): void {
    // Clear any existing tracking for this bundle
    const existing = this.pendingAcks.get(bundleId);
    if (existing) {
      clearTimeout(existing.timeoutHandle);
    }

    // Start ACK timeout
    const timeoutHandle = setTimeout(() => {
      this.handleAckTimeout(bundleId);
    }, this.ACK_TIMEOUT_MS);

    // Track pending ACK
    this.pendingAcks.set(bundleId, {
      bundleId,
      message,
      sentAt: Date.now(),
      retryCount: 0,
      timeoutHandle,
    });

    console.log(`[BLEDirect] Tracking ACK for bundle ${bundleId} (timeout: ${this.ACK_TIMEOUT_MS}ms)`);
  }

  private async sendPayload(message: BLEBundleMessage, serviceUuid?: string): Promise<BLEBroadcastResult> {
    console.log('[BLEDirect] Sending payload for bundle:', message.bundle.tx_id);

    if (serviceUuid) {
      await this.ensureActive(serviceUuid);
    }
    if (!this.started) {
      console.warn('[BLEDirect] BLE not started, cannot send payload');
      return { success: false, peersReached: 0 };
    }

    try {
      // Prepare bundle data for native module (as object, not JSON string)
      const bundleData = {
        ...encodeOfflineBundle(message.bundle),
        payerAttestation: encodeAttestation(message.payerAttestation),
        merchantAttestation: encodeAttestation(message.merchantAttestation),
      };

      // Check size (convert to JSON for size check)
      const payload = JSON.stringify(bundleData);
      if (Buffer.byteLength(payload, 'utf8') > MAX_BLE_PAYLOAD_BYTES) {
        console.error('[BLEDirect] Payload too large:', Buffer.byteLength(payload, 'utf8'), '>', MAX_BLE_PAYLOAD_BYTES);
        return { success: false, peersReached: 0 };
      }

      console.log('[BLEDirect] Broadcasting bundle:', bundleData.tx_id);
      const result = await this.bridge.broadcastBundle(bundleData);
      console.log('[BLEDirect] Broadcast result:', result);

      // Phase 2.3: Start tracking ACK for this bundle
      if (result.success && message.bundle.tx_id) {
        this.trackBundleAck(message.bundle.tx_id, message);
      }

      const now = Date.now();
      this.updateDiagnostics({
        lastBroadcastAt: now,
        peersReached: result.peersReached,
        lastSuccessAt: result.success ? now : this.diagnostics.lastSuccessAt,
        lastError: result.success ? null : this.diagnostics.lastError,
      });

      if (result.success) {
        console.log('[BLEDirect] ✅ Broadcast successful, peers reached:', result.peersReached);
      } else {
        console.warn('[BLEDirect] ❌ Broadcast failed, peers reached:', result.peersReached);
      }

      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[BLEDirect] sendPayload error:', errorMsg);
      this.updateDiagnostics({ lastError: errorMsg });
      return { success: false, peersReached: 0 };
    }
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
    let queueChanged = false;

    for (let i = 0; i < this.queue.length;) {
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
          queueChanged = true;
          this.updateDiagnostics({ queueLength: this.queue.length, lastError: result.success ? null : this.diagnostics.lastError });
          continue;
        }
        // treat unsuccessful attempt as retry
        item.nextAttemptAt = now + Math.min(item.initialDelayMs * Math.pow(2, item.attempts), MAX_RETRY_DELAY_MS);
        queueChanged = true;
        this.updateDiagnostics({ lastError: 'BLE broadcast failed' });
        i += 1;
      } catch (err) {
        item.attempts += 1;
        item.nextAttemptAt = now + Math.min(item.initialDelayMs * Math.pow(2, item.attempts), MAX_RETRY_DELAY_MS);
        if (item.attempts >= item.maxAttempts) {
          this.queue.splice(i, 1);
          queueChanged = true;
        } else {
          queueChanged = true;
          i += 1;
        }
        this.updateDiagnostics({
          queueLength: this.queue.length,
          lastError: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (queueChanged) {
      await this.saveQueue(); // Persist queue after changes
    }

    this.updateDiagnostics({ queueLength: this.queue.length });
    this.stopFlushLoop();
  }

  private setupEventListeners(): void {
    if (!this.eventEmitter) {
      console.warn('[BLEDirect] No event emitter available');
      return;
    }

    console.log('[BLEDirect] Setting up event listeners');

    // Listen for incoming bundles
    this.eventEmitter.addListener('BundleReceived', (data: any) => {
      console.log('[BLEDirect] Bundle received from BLE:', data);
      try {
        const bundle = data.bundle ? decodeOfflineBundle(data.bundle) : null;
        if (bundle) {
          const message: BLEBundleMessage = {
            bundle,
            payerAttestation: data.payerAttestation ? decodeAttestation(data.payerAttestation) : undefined,
            merchantAttestation: data.merchantAttestation ? decodeAttestation(data.merchantAttestation) : undefined,
          };
          this.bundleListeners.forEach(listener => listener(message));
          this.updateDiagnostics({ lastReceiveAt: Date.now() });
        }
      } catch (err) {
        console.error('[BLEDirect] Failed to process received bundle:', err);
      }
    });

    // Listen for peer events
    this.eventEmitter.addListener('PeerConnected', (data: any) => {
      console.log('[BLEDirect] Peer connected:', data);
    });

    this.eventEmitter.addListener('PeerDisconnected', (data: any) => {
      console.log('[BLEDirect] Peer disconnected:', data);
    });

    // Listen for BLE node events
    this.eventEmitter.addListener('MeshNodeStarted', (data: any) => {
      console.log('[BLEDirect] BLE node started event:', data);
    });

    this.eventEmitter.addListener('MeshNodeStopped', (data: any) => {
      console.log('[BLEDirect] BLE node stopped event:', data);
    });

    // Listen for advertising events
    this.eventEmitter.addListener('AdvertisingStarted', (data: any) => {
      console.log('[BLEDirect] ✅ BLE ADVERTISING IS NOW ACTIVE - Merchant is discoverable!');
      console.log('[BLEDirect] Service UUID:', data?.serviceUuid);
    });

    this.eventEmitter.addListener('AdvertisingError', (data: any) => {
      console.error('[BLEDirect] ❌ BLE ADVERTISING FAILED:', data);
      this.updateDiagnostics({ lastError: `Advertising failed: ${data?.errorMessage}` });
    });

    // Phase 2.3: Listen for ACK/NACK events
    this.eventEmitter.addListener('AckReceived', (data: any) => {
      const bundleId = data?.bundleId;
      if (bundleId) {
        this.handleAckReceived(bundleId);
      }
    });

    this.eventEmitter.addListener('NackReceived', (data: any) => {
      const bundleId = data?.bundleId;
      const reason = data?.reason;
      if (bundleId) {
        this.handleNackReceived(bundleId, reason);
      }
    });
  }

  private teardownSubscription(): void {
    if (this.subscription) {
      this.subscription.remove();
      this.subscription = null;
    }
    if (this.eventEmitter) {
      this.eventEmitter.removeAllListeners('BundleReceived');
      this.eventEmitter.removeAllListeners('PeerConnected');
      this.eventEmitter.removeAllListeners('PeerDisconnected');
      this.eventEmitter.removeAllListeners('MeshNodeStarted');
      this.eventEmitter.removeAllListeners('MeshNodeStopped');
      this.eventEmitter.removeAllListeners('AdvertisingStarted');
      this.eventEmitter.removeAllListeners('AdvertisingError');
      this.eventEmitter.removeAllListeners('AckReceived');
      this.eventEmitter.removeAllListeners('NackReceived');
    }
    this.bundleListeners.clear();

    // Phase 2.3: Clear all pending ACK timeouts
    this.pendingAcks.forEach(pending => {
      clearTimeout(pending.timeoutHandle);
    });
    this.pendingAcks.clear();
  }

  private updateDiagnostics(patch: Partial<BLEDiagnostics>): void {
    this.diagnostics = { ...this.diagnostics, ...patch };
    const snapshot = this.getDiagnostics();
    this.diagnosticsListeners.forEach(listener => listener(snapshot));
  }

  /**
   * Load persisted queue from AsyncStorage
   */
  private async loadQueue(): Promise<void> {
    try {
      const json = await EncryptedStorage.getItem(BLE_QUEUE_STORAGE_KEY);
      if (!json) {
        return;
      }

      const persistedQueue: PersistedQueueItem[] = JSON.parse(json);
      this.queue = persistedQueue.map(item => ({
        message: {
          bundle: decodeOfflineBundle(item.message.bundle),
          payerAttestation: item.message.payerAttestation ? decodeAttestation(item.message.payerAttestation) : undefined,
          merchantAttestation: item.message.merchantAttestation ? decodeAttestation(item.message.merchantAttestation) : undefined,
        },
        serviceUuid: item.serviceUuid,
        attempts: item.attempts,
        nextAttemptAt: item.nextAttemptAt,
        maxAttempts: item.maxAttempts,
        initialDelayMs: item.initialDelayMs,
      }));

      this.updateDiagnostics({ queueLength: this.queue.length });

      if (this.queue.length > 0) {
        if (__DEV__) {
          console.log(`Loaded ${this.queue.length} queued bundles from storage`);
        }
        // Start flush loop if there are items to process
        this.startFlushLoop();
      }
    } catch (err) {
      if (__DEV__) {
        console.error('Failed to load BLE queue:', err);
      }
      // On parse error, clear corrupted queue
      await EncryptedStorage.removeItem(BLE_QUEUE_STORAGE_KEY).catch(() => { });
    }
  }

  /**
   * Save current queue to AsyncStorage
   */
  private async saveQueue(): Promise<void> {
    try {
      const persistedQueue: PersistedQueueItem[] = this.queue.map(item => ({
        message: {
          bundle: encodeOfflineBundle(item.message.bundle) as PersistedOfflineBundle,
          payerAttestation: encodeAttestation(item.message.payerAttestation),
          merchantAttestation: encodeAttestation(item.message.merchantAttestation),
        },
        serviceUuid: item.serviceUuid,
        attempts: item.attempts,
        nextAttemptAt: item.nextAttemptAt,
        maxAttempts: item.maxAttempts,
        initialDelayMs: item.initialDelayMs,
      }));

      await EncryptedStorage.setItem(BLE_QUEUE_STORAGE_KEY, JSON.stringify(persistedQueue));
    } catch (err) {
      if (__DEV__) {
        console.error('Failed to save BLE queue:', err);
      }
    }
  }

  /**
   * Clear persisted queue
   */
  private async clearQueue(): Promise<void> {
    try {
      await EncryptedStorage.removeItem(BLE_QUEUE_STORAGE_KEY);
    } catch (err) {
      if (__DEV__) {
        console.error('Failed to clear BLE queue:', err);
      }
    }
  }
}

const bridge = NativeBLE ?? new NoopBLEDirect();
export const bleDirect = new BLEDirectService(bridge);
