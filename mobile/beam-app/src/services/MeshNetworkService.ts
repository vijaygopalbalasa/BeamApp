import {
  NativeModules,
  NativeEventEmitter,
  Platform,
  PermissionsAndroid,
  EmitterSubscription,
} from 'react-native';
import type { OfflineBundle } from '@beam/shared';
import { Config } from '../config';
import { meshDiagnosticsStore } from './MeshDiagnosticsStore';

const { MeshNetworkBridge } = NativeModules;

const meshNetworkEmitter =
  Platform.OS === 'android' && MeshNetworkBridge
    ? new NativeEventEmitter(MeshNetworkBridge)
    : null;

export interface MeshNetworkConfig {
  serviceUUID: string;
  nodeType: 'customer' | 'merchant' | 'relay';
  publicKey: string;
}

export interface MeshPaymentRequestPayload {
  merchantPubkey: string;
  merchantName?: string;
  amount: number;
  currency?: string;
  description?: string;
  displayAmount?: string;
}

export interface AdvertisingStateEvent {
  status: 'started' | 'stopped' | 'error';
  timestamp: number;
  errorMessage?: string;
}

export interface ScanStateEvent {
  status: 'started' | 'stopped' | 'failed';
  timestamp: number;
  errorMessage?: string;
}

export interface ScanResultEvent {
  address: string;
  name: string;
  rssi: number;
  timestamp: number;
  serviceUuids: string[];
  callbackType: number;
}

export interface BundleBroadcastEvent {
  success: boolean;
  peersReached?: number;
  bundleId?: string | null;
  timestamp: number;
  error?: string;
}

export interface BLEBundleReceivedEvent {
  bundleData: string;
  deviceAddress: string;
  deviceName: string;
  timestamp: number;
  bundleSize: number;
  bundleId: string;
}

export interface BLEConnectionStateEvent {
  deviceAddress: string;
  deviceName?: string | null;
  state: 'CONNECTED' | 'DISCONNECTED';
  timestamp: number;
}

export interface BLEErrorEvent {
  errorType: string;
  errorMessage: string;
  timestamp: number;
}

export interface MeshPeerInfo {
  address: string;
  name: string;
  rssi: number;
  connected: boolean;
}

export interface PeerReadyEvent {
  address: string;
  name?: string;
  pubkey?: string;
  timestamp: number;
}

function cloneConfig(config: MeshNetworkConfig): MeshNetworkConfig {
  return {
    serviceUUID: config.serviceUUID,
    nodeType: config.nodeType,
    publicKey: config.publicKey,
  };
}

function configsMatch(a: MeshNetworkConfig | null, b: MeshNetworkConfig | null): boolean {
  if (!a || !b) {
    return false;
  }
  return (
    a.serviceUUID === b.serviceUUID &&
    a.nodeType === b.nodeType &&
    a.publicKey === b.publicKey
  );
}

export class MeshNetworkService {
  private eventListeners: Map<string, EmitterSubscription[]> = new Map();
  private started = false;
  private activeConfig: MeshNetworkConfig | null = null;
  private readyPeerAddresses: Set<string> = new Set();
  private readyPeerPubkeys: Map<string, string> = new Map();
  private readinessWaiters: Array<{
    match: (event: PeerReadyEvent) => boolean;
    resolve: (address: string) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor() {
    if (Platform.OS === 'android' && meshNetworkEmitter) {
      const subscription = meshNetworkEmitter.addListener(
        'PeerReadyForTransfer',
        (event: PeerReadyEvent) => {
          this.handlePeerReadyEvent(event);
        },
      );
      this.trackListener('PeerReadyForTransfer', subscription);
    }
  }

  private async ensurePermissions(): Promise<void> {
    if (Platform.OS !== 'android') {
      return;
    }

    const apiLevel = Number.parseInt(String(Platform.Version), 10);
    if (apiLevel >= 31) {
      const permissions = [
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ];

      const results = await PermissionsAndroid.requestMultiple(permissions);
      const missing = permissions.filter(
        permission => results[permission] !== PermissionsAndroid.RESULTS.GRANTED,
      );

      if (missing.length > 0) {
        throw new Error('Bluetooth permissions not granted');
      }
    } else {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      );

      if (result !== PermissionsAndroid.RESULTS.GRANTED) {
        throw new Error('Bluetooth permissions not granted');
      }
    }
  }

  async startBLENode(config: MeshNetworkConfig, options?: { forceRestart?: boolean }): Promise<void> {
    if (Platform.OS !== 'android') {
      throw new Error('MeshNetwork only supported on Android');
    }

    if (!MeshNetworkBridge) {
      throw new Error('MeshNetworkBridge native module not available');
    }

    await this.ensurePermissions();

    const forceRestart = options?.forceRestart === true;

    if (this.started && configsMatch(this.activeConfig, config) && !forceRestart) {
      console.log('[MeshNetworkService] Mesh node already active with matching config');
      return;
    }

    if (this.started) {
      await this.stopBLENode().catch(error => {
        console.warn('[MeshNetworkService] Failed to stop existing mesh node before restart:', error);
      });
    }
    this.resetReadinessState('restart');

    console.log('[MeshNetworkService] Starting BLE node:', {
      nodeType: config.nodeType,
      publicKey:
        config.publicKey.length > 8
          ? `${config.publicKey.substring(0, 8)}...`
          : config.publicKey,
    });

    const readinessPromise = this.waitForNodeReady(config);

    await MeshNetworkBridge.startMeshNode({
      serviceUuid: config.serviceUUID,
      nodeType: config.nodeType,
      pubkey: config.publicKey,
    });

    try {
      await readinessPromise;
    } catch (error) {
      console.error('[MeshNetworkService] BLE node did not reach ready state:', error);
      this.started = false;
      this.activeConfig = null;
      throw error;
    }

    this.started = true;
    this.activeConfig = cloneConfig(config);
    console.log('[MeshNetworkService] BLE node started successfully');
  }

  async stopBLENode(): Promise<void> {
    if (Platform.OS !== 'android') {
      return;
    }

    if (!MeshNetworkBridge) {
      console.warn('[MeshNetworkService] MeshNetworkBridge not available');
      return;
    }

    if (!this.started) {
      return;
    }

    try {
      console.log('[MeshNetworkService] Stopping BLE node');
      await MeshNetworkBridge.stopMeshNode();
      console.log('[MeshNetworkService] BLE node stopped');
    } catch (error) {
      console.warn('[MeshNetworkService] Failed to stop BLE node:', error);
    } finally {
      this.started = false;
      this.activeConfig = null;
      this.resetReadinessState('stop');
    }
  }

  async ensureNode(config?: MeshNetworkConfig): Promise<void> {
    const targetConfig = config ?? this.activeConfig ?? {
      serviceUUID: Config.ble.serviceUUID,
      nodeType: 'relay',
      publicKey: '',
    };

    if (targetConfig.publicKey.length === 0) {
      throw new Error('Mesh network configuration requires a public key');
    }

    await this.startBLENode(targetConfig);
  }

  isStarted(): boolean {
    return this.started;
  }

  getActiveConfig(): MeshNetworkConfig | null {
    return this.activeConfig ? cloneConfig(this.activeConfig) : null;
  }

  private async waitForNodeReady(config: MeshNetworkConfig): Promise<void> {
    if (Platform.OS !== 'android' || !meshNetworkEmitter) {
      return;
    }

    const isMerchant = config.nodeType === 'merchant';
    const isCustomer = config.nodeType === 'customer';

    if (!isMerchant && !isCustomer) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeoutMs = 5000;

      const cleanup = (msg?: string) => {
        settled = true;
        clearTimeout(timer);
        startSub?.remove();
        errorSub?.remove();
        if (msg) {
          reject(new Error(msg));
        } else {
          resolve();
        }
      };

      const timer = setTimeout(() => {
        if (!settled) {
          cleanup(isMerchant ? 'Timed out waiting for merchant advertising to start' : 'Timed out waiting for customer scan to start');
        }
      }, timeoutMs);

      const handleSuccess = () => {
        if (!settled) {
          cleanup();
        }
      };

      const handleError = (event: any) => {
        if (!settled) {
          const message = typeof event?.errorMessage === 'string'
            ? event.errorMessage
            : 'BLE startup error';
          cleanup(message);
        }
      };

      let startSub: EmitterSubscription | undefined;
      let errorSub: EmitterSubscription | undefined;

      if (isMerchant) {
        startSub = meshNetworkEmitter.addListener('AdvertisingStarted', handleSuccess);
        errorSub = meshNetworkEmitter.addListener('AdvertisingError', handleError);
      } else {
        startSub = meshNetworkEmitter.addListener('MeshScanStarted', handleSuccess);
        errorSub = meshNetworkEmitter.addListener('MeshScanFailed', handleError);
      }
    });
  }

  onBundleReceived(callback: (event: BLEBundleReceivedEvent) => void): () => void {
    if (Platform.OS !== 'android' || !meshNetworkEmitter) {
      console.warn('[MeshNetworkService] Event emitter not available');
      return () => {};
    }

    const subscription = meshNetworkEmitter.addListener('BLE_BUNDLE_RECEIVED', (event) => {
      if (!event) {
        return;
      }
      callback({
        bundleData: event.bundleData ?? '',
        deviceAddress: event.deviceAddress ?? 'unknown',
        deviceName: event.deviceName ?? 'Unknown',
        timestamp: typeof event.timestamp === 'number' ? event.timestamp : Date.now(),
        bundleSize: event.bundleSize ?? 0,
        bundleId: event.bundleId ?? 'unknown',
      });
    });

    this.trackListener('BLE_BUNDLE_RECEIVED', subscription);
    return () => this.removeListener('BLE_BUNDLE_RECEIVED', subscription);
  }

  onConnectionStateChange(callback: (event: BLEConnectionStateEvent) => void): () => void {
    if (Platform.OS !== 'android' || !meshNetworkEmitter) {
      console.warn('[MeshNetworkService] Event emitter not available');
      return () => {};
    }

    const handleConnected = (event: any) => {
      callback({
        deviceAddress: event?.address ?? 'unknown',
        deviceName: event?.name ?? null,
        state: 'CONNECTED',
        timestamp: Date.now(),
      });
    };

    const handleDisconnected = (event: any) => {
      callback({
        deviceAddress: event?.address ?? 'unknown',
        deviceName: event?.name ?? null,
        state: 'DISCONNECTED',
        timestamp: Date.now(),
      });
    };

    const connectedSub = meshNetworkEmitter.addListener('PeerConnected', handleConnected);
    const disconnectedSub = meshNetworkEmitter.addListener('PeerDisconnected', handleDisconnected);

    this.trackListener('PeerConnected', connectedSub);
    this.trackListener('PeerDisconnected', disconnectedSub);

    return () => {
      this.removeListener('PeerConnected', connectedSub);
      this.removeListener('PeerDisconnected', disconnectedSub);
    };
  }

  onError(callback: (event: BLEErrorEvent) => void): () => void {
    if (Platform.OS !== 'android' || !meshNetworkEmitter) {
      console.warn('[MeshNetworkService] Event emitter not available');
      return () => {};
    }

    const subscription = meshNetworkEmitter.addListener('AdvertisingError', (event) => {
      callback({
        errorType: 'advertising',
        errorMessage: event?.errorMessage ?? 'Unknown advertising error',
        timestamp: Date.now(),
      });
    });

    this.trackListener('AdvertisingError', subscription);
    return () => this.removeListener('AdvertisingError', subscription);
  }

  onAdvertisingStateChange(callback: (event: AdvertisingStateEvent) => void): () => void {
    if (Platform.OS !== 'android' || !meshNetworkEmitter) {
      console.warn('[MeshNetworkService] Event emitter not available');
      return () => {};
    }

    const startedSub = meshNetworkEmitter.addListener('AdvertisingStarted', (event) => {
      callback({
        status: 'started',
        timestamp: this.timestampFrom(event?.timestamp),
      });
    });

    const stoppedSub = meshNetworkEmitter.addListener('AdvertisingStopped', (event) => {
      callback({
        status: 'stopped',
        timestamp: this.timestampFrom(event?.timestamp),
      });
    });

    const errorSub = meshNetworkEmitter.addListener('AdvertisingError', (event) => {
      callback({
        status: 'error',
        timestamp: this.timestampFrom(event?.timestamp),
        errorMessage: event?.errorMessage ?? 'Unknown advertising error',
      });
    });

    this.trackListener('AdvertisingStarted', startedSub);
    this.trackListener('AdvertisingStopped', stoppedSub);
    this.trackListener('AdvertisingError', errorSub);

    return () => {
      this.removeListener('AdvertisingStarted', startedSub);
      this.removeListener('AdvertisingStopped', stoppedSub);
      this.removeListener('AdvertisingError', errorSub);
    };
  }

  onScanStateChange(callback: (event: ScanStateEvent) => void): () => void {
    if (Platform.OS !== 'android' || !meshNetworkEmitter) {
      console.warn('[MeshNetworkService] Event emitter not available');
      return () => {};
    }

    const startedSub = meshNetworkEmitter.addListener('MeshScanStarted', (event) => {
      callback({ status: 'started', timestamp: this.timestampFrom(event?.timestamp) });
    });

    const stoppedSub = meshNetworkEmitter.addListener('MeshScanStopped', (event) => {
      callback({ status: 'stopped', timestamp: this.timestampFrom(event?.timestamp) });
    });

    const failedSub = meshNetworkEmitter.addListener('MeshScanFailed', (event) => {
      callback({
        status: 'failed',
        timestamp: this.timestampFrom(event?.timestamp),
        errorMessage: event?.errorMessage ?? 'Scan failed',
      });
    });

    this.trackListener('MeshScanStarted', startedSub);
    this.trackListener('MeshScanStopped', stoppedSub);
    this.trackListener('MeshScanFailed', failedSub);

    return () => {
      this.removeListener('MeshScanStarted', startedSub);
      this.removeListener('MeshScanStopped', stoppedSub);
      this.removeListener('MeshScanFailed', failedSub);
    };
  }

  onScanResult(callback: (event: ScanResultEvent) => void): () => void {
    if (Platform.OS !== 'android' || !meshNetworkEmitter) {
      console.warn('[MeshNetworkService] Event emitter not available');
      return () => {};
    }

    const subscription = meshNetworkEmitter.addListener('MeshScanResult', (event) => {
      if (!event) {
        return;
      }

      const serviceUuids: string[] = Array.isArray(event.serviceUuids)
        ? event.serviceUuids.filter((uuid: unknown): uuid is string => typeof uuid === 'string')
        : [];

      callback({
        address: event.address ?? 'unknown',
        name: event.name ?? 'Unknown',
        rssi: typeof event.rssi === 'number' ? event.rssi : 0,
        callbackType: typeof event.callbackType === 'number' ? event.callbackType : 0,
        serviceUuids,
        timestamp: this.timestampFrom(event.timestamp),
      });
    });

    this.trackListener('MeshScanResult', subscription);
    return () => this.removeListener('MeshScanResult', subscription);
  }

  onBundleBroadcast(callback: (event: BundleBroadcastEvent) => void): () => void {
    if (Platform.OS !== 'android' || !meshNetworkEmitter) {
      console.warn('[MeshNetworkService] Event emitter not available');
      return () => {};
    }

    const subscription = meshNetworkEmitter.addListener('MeshBundleBroadcast', (event) => {
      if (!event) {
        return;
      }

      callback({
        success: Boolean(event.success),
        peersReached: typeof event.peersReached === 'number' ? event.peersReached : undefined,
        bundleId: event.bundleId ?? null,
        error: event.error,
        timestamp: this.timestampFrom(event.timestamp),
      });
    });

    this.trackListener('MeshBundleBroadcast', subscription);
    return () => this.removeListener('MeshBundleBroadcast', subscription);
  }

  async broadcastBundle(
    bundle: OfflineBundle | Record<string, unknown>,
    options?: { serviceUUID?: string; config?: MeshNetworkConfig },
  ): Promise<{ success: boolean; peersReached: number; bundleId?: string | null }> {
    if (Platform.OS !== 'android') {
      throw new Error('MeshNetwork only supported on Android');
    }

    if (!MeshNetworkBridge) {
      throw new Error('MeshNetworkBridge native module not available');
    }

    const targetConfig = options?.config ?? this.activeConfig;
    if (!targetConfig) {
      throw new Error('Mesh network is not running');
    }

    if (!this.started || !configsMatch(this.activeConfig, targetConfig)) {
      await this.startBLENode(targetConfig);
    }

    try {
      const result = await MeshNetworkBridge.broadcastBundle(bundle);
      return {
        success: Boolean(result?.success),
        peersReached: typeof result?.peersReached === 'number' ? result.peersReached : 0,
        bundleId: result?.bundleId ?? (bundle as any)?.tx_id ?? null,
      };
    } catch (error) {
      console.error('[MeshNetworkService] Failed to broadcast bundle:', error);
      throw error;
    }
  }

  async updatePaymentRequest(payload: MeshPaymentRequestPayload): Promise<void> {
    if (Platform.OS !== 'android') {
      return;
    }

    if (!MeshNetworkBridge) {
      throw new Error('MeshNetworkBridge native module not available');
    }

    if (!payload.merchantPubkey) {
      throw new Error('Payment request is missing merchantPubkey');
    }

    const body = {
      ...payload,
      updatedAt: Date.now(),
    };

    await MeshNetworkBridge.updatePaymentRequest(body);
  }

  async requestPeers(): Promise<MeshPeerInfo[]> {
    if (Platform.OS !== 'android' || !MeshNetworkBridge) {
      return [];
    }

    try {
      const peers = await MeshNetworkBridge.requestPeers();
      if (!Array.isArray(peers)) {
        return [];
      }
      return peers.map(peer => ({
        address: peer.address ?? 'unknown',
        name: peer.name ?? 'Unknown',
        rssi: typeof peer.rssi === 'number' ? peer.rssi : 0,
        connected: Boolean(peer.connected),
      }));
    } catch (error) {
      console.warn('[MeshNetworkService] Failed to request peers:', error);
      return [];
    }
  }

  async getDiagnostics(): Promise<Record<string, unknown>> {
    if (Platform.OS !== 'android' || !MeshNetworkBridge) {
      return {};
    }

    try {
      return await MeshNetworkBridge.getDiagnostics();
    } catch (error) {
      console.warn('[MeshNetworkService] Failed to fetch diagnostics:', error);
      return {};
    }
  }

  cleanup(): void {
    this.eventListeners.forEach(subscriptions => {
      subscriptions.forEach(subscription => subscription.remove());
    });
    this.eventListeners.clear();
    this.resetReadinessState('cleanup');
  }

  private trackListener(eventName: string, subscription: EmitterSubscription) {
    if (!this.eventListeners.has(eventName)) {
      this.eventListeners.set(eventName, []);
    }
    this.eventListeners.get(eventName)!.push(subscription);
  }

  private removeListener(eventName: string, subscription: EmitterSubscription) {
    subscription.remove();
    const listeners = this.eventListeners.get(eventName);
    if (!listeners) {
      return;
    }
    const index = listeners.indexOf(subscription);
    if (index > -1) {
      listeners.splice(index, 1);
    }
    if (listeners.length === 0) {
      this.eventListeners.delete(eventName);
    }
  }

  private timestampFrom(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : Date.now();
  }

  private handlePeerReadyEvent(raw: PeerReadyEvent) {
    const event: PeerReadyEvent = {
      address: typeof raw?.address === 'string' ? raw.address : 'unknown',
      name: typeof raw?.name === 'string' ? raw.name : undefined,
      pubkey: typeof raw?.pubkey === 'string' ? raw.pubkey : undefined,
      timestamp: this.timestampFrom(raw?.timestamp),
    };

    this.readyPeerAddresses.add(event.address);
    if (event.pubkey) {
      this.readyPeerPubkeys.set(event.pubkey, event.address);
    }

    console.log('[MeshNetworkService] Peer ready for transfer:', event);

    this.readinessWaiters = this.readinessWaiters.filter(waiter => {
      if (waiter.match(event)) {
        clearTimeout(waiter.timer);
        waiter.resolve(event.address);
        return false;
      }
      return true;
    });
  }

  async waitForPeerReady(options?: { merchantPubkey?: string; timeoutMs?: number }): Promise<string> {
    if (Platform.OS !== 'android') {
      throw new Error('Mesh network readiness only supported on Android');
    }

    const merchantPubkey = options?.merchantPubkey;
    const timeoutMs = options?.timeoutMs ?? 10000;

    const merchantPrefix =
      merchantPubkey && merchantPubkey.length > 16
        ? merchantPubkey.substring(0, 16)
        : merchantPubkey ?? null;

    if (merchantPrefix) {
      const existing = this.readyPeerPubkeys.get(merchantPrefix);
      if (existing) {
        return existing;
      }
    } else if (this.readyPeerAddresses.size > 0) {
      return Array.from(this.readyPeerAddresses)[0];
    }

    if (!meshNetworkEmitter) {
      throw new Error('Mesh network emitter unavailable');
    }

    return new Promise<string>((resolve, reject) => {
      const entry: {
        match: (event: PeerReadyEvent) => boolean;
        resolve: (address: string) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      } = {
        match: (event: PeerReadyEvent) =>
          merchantPrefix ? event.pubkey === merchantPrefix : true,
        resolve: () => {},
        reject: () => {},
        timer: setTimeout(() => {}, timeoutMs),
      };

      entry.resolve = (address: string) => {
        clearTimeout(entry.timer);
        resolve(address);
      };
      entry.reject = (error: Error) => {
        clearTimeout(entry.timer);
        reject(error);
      };
      entry.timer = setTimeout(() => {
        this.readinessWaiters = this.readinessWaiters.filter(waiter => waiter !== entry);
        entry.reject(new Error('Timed out waiting for peer readiness'));
      }, timeoutMs);

      this.readinessWaiters.push(entry);
    });
  }

  private resetReadinessState(reason: string) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.log('[MeshNetworkService] Reset readiness state:', reason);
    }
    this.readyPeerAddresses.clear();
    this.readyPeerPubkeys.clear();
    this.readinessWaiters.forEach(waiter => {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('Mesh network reset'));
    });
    this.readinessWaiters = [];
  }
}

export const meshNetworkService = new MeshNetworkService();

if (Platform.OS === 'android') {
  meshDiagnosticsStore.attach(meshNetworkService);
}
