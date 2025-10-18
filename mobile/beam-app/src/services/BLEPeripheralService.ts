/**
 * BLE Peripheral Service for Beam Merchant Mode
 *
 * This service provides enhanced BLE peripheral support for merchants to:
 * - Advertise payment requests to nearby customers
 * - Accept connections from multiple customers simultaneously
 * - Exchange payment bundles with proper chunking for large data
 * - Manage connection state and handle reconnections
 *
 * Architecture:
 * - Uses native modules for both Android and iOS
 * - Supports both central (customer) and peripheral (merchant) roles
 * - Implements chunked data transfer for bundles > MTU size
 * - Provides automatic reconnection and error recovery
 */

import { NativeModules, NativeEventEmitter, Platform, EmitterSubscription } from 'react-native';
import type { OfflineBundle } from '@beam/shared';
import { Buffer } from 'buffer';

const MODULE_NAME = 'BLEPeripheralModule';

// Type Definitions

export interface BLEPeripheralConfig {
  merchantPubkey: string;
  merchantName: string;
  paymentRequest?: PaymentRequestData;
}

export interface PaymentRequestData {
  amount: number;
  currency: string;
  description?: string;
  metadata?: Record<string, any>;
}

export interface ConnectedDevice {
  address: string;
  name: string;
  state: ConnectionState;
  mtu: number;
}

export enum ConnectionState {
  IDLE = 0,
  READY = 1,
  RECEIVING = 2,
  PROCESSING = 3,
  RESPONDING = 4,
}

export interface BundleReceivedEvent {
  deviceAddress: string;
  bundle: string; // JSON string of OfflineBundle
}

export interface DeviceConnectedEvent {
  deviceAddress: string;
  deviceName: string;
}

export interface DeviceDisconnectedEvent {
  deviceAddress: string;
}

export interface MtuChangedEvent {
  deviceAddress: string;
  mtu: number;
}

export interface AdvertisingStartedEvent {
  merchantName: string;
}

export interface AdvertisingFailedEvent {
  error: string;
  errorCode?: number;
}

// Native Module Interface

export interface BLEPeripheralModule {
  startAdvertising(config: BLEPeripheralConfig): Promise<{
    success: boolean;
    merchantPubkey: string;
    merchantName: string;
    pending?: boolean;
  }>;

  stopAdvertising(): Promise<{ success: boolean }>;

  updatePaymentRequest(paymentRequest: PaymentRequestData): Promise<{ success: boolean }>;

  sendResponseBundle(
    deviceAddress: string,
    bundleJson: string
  ): Promise<{ success: boolean; bytesSent: number }>;

  getConnectedDevices(): Promise<ConnectedDevice[]>;

  disconnectDevice(deviceAddress: string): Promise<{ success: boolean }>;
}

// Event Listeners

type BundleReceivedListener = (event: BundleReceivedEvent) => void;
type DeviceConnectedListener = (event: DeviceConnectedEvent) => void;
type DeviceDisconnectedListener = (event: DeviceDisconnectedEvent) => void;
type MtuChangedListener = (event: MtuChangedEvent) => void;
type AdvertisingStateListener = (started: boolean, error?: string) => void;

// No-op implementation for platforms without native module

class NoopBLEPeripheral implements BLEPeripheralModule {
  async startAdvertising(): Promise<any> {
    if (__DEV__) {
      console.warn('[BLEPeripheral] Native module not available on', Platform.OS);
    }
    throw new Error('BLE Peripheral not supported on this platform');
  }

  async stopAdvertising(): Promise<any> {
    return { success: false };
  }

  async updatePaymentRequest(): Promise<any> {
    return { success: false };
  }

  async sendResponseBundle(): Promise<any> {
    throw new Error('BLE Peripheral not supported on this platform');
  }

  async getConnectedDevices(): Promise<ConnectedDevice[]> {
    return [];
  }

  async disconnectDevice(): Promise<any> {
    return { success: false };
  }
}

// Main Service Class

const NativeModule: BLEPeripheralModule | undefined = NativeModules[MODULE_NAME];

export class BLEPeripheralService {
  private readonly module: BLEPeripheralModule;
  private eventEmitter: NativeEventEmitter | null = null;
  private subscriptions: Map<string, EmitterSubscription> = new Map();

  private isAdvertising = false;
  private currentConfig: BLEPeripheralConfig | null = null;
  private connectedDevices = new Map<string, ConnectedDevice>();

  // Event listeners
  private bundleReceivedListeners = new Set<BundleReceivedListener>();
  private deviceConnectedListeners = new Set<DeviceConnectedListener>();
  private deviceDisconnectedListeners = new Set<DeviceDisconnectedListener>();
  private mtuChangedListeners = new Set<MtuChangedListener>();
  private advertisingStateListeners = new Set<AdvertisingStateListener>();

  constructor(module: BLEPeripheralModule) {
    this.module = module;

    if (module !== (NativeModule as BLEPeripheralModule | undefined)) {
      this.eventEmitter = null;
    } else if (NativeModules[MODULE_NAME]) {
      this.eventEmitter = new NativeEventEmitter(NativeModules[MODULE_NAME]);
      this.setupEventListeners();
    }
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Start advertising as a merchant accepting payments
   */
  async startAdvertising(config: BLEPeripheralConfig): Promise<void> {
    try {
      const result = await this.module.startAdvertising(config);

      if (result.success) {
        this.isAdvertising = true;
        this.currentConfig = config;

        if (__DEV__) {
          console.log('[BLEPeripheral] Started advertising as', config.merchantName);
        }
      }
    } catch (error) {
      if (__DEV__) {
        console.error('[BLEPeripheral] Failed to start advertising:', error);
      }
      throw error;
    }
  }

  /**
   * Stop advertising and disconnect all devices
   */
  async stopAdvertising(): Promise<void> {
    try {
      await this.module.stopAdvertising();
      this.isAdvertising = false;
      this.currentConfig = null;
      this.connectedDevices.clear();

      if (__DEV__) {
        console.log('[BLEPeripheral] Stopped advertising');
      }
    } catch (error) {
      if (__DEV__) {
        console.error('[BLEPeripheral] Failed to stop advertising:', error);
      }
      throw error;
    }
  }

  /**
   * Update the payment request data while advertising
   * Notifies all connected devices of the change
   */
  async updatePaymentRequest(paymentRequest: PaymentRequestData): Promise<void> {
    try {
      await this.module.updatePaymentRequest(paymentRequest);

      if (this.currentConfig) {
        this.currentConfig.paymentRequest = paymentRequest;
      }

      if (__DEV__) {
        console.log('[BLEPeripheral] Updated payment request:', paymentRequest);
      }
    } catch (error) {
      if (__DEV__) {
        console.error('[BLEPeripheral] Failed to update payment request:', error);
      }
      throw error;
    }
  }

  /**
   * Send a signed response bundle to a specific device
   */
  async sendResponseBundle(deviceAddress: string, bundle: OfflineBundle): Promise<void> {
    try {
      const bundleJson = JSON.stringify(bundle);
      const result = await this.module.sendResponseBundle(deviceAddress, bundleJson);

      if (__DEV__) {
        console.log(
          `[BLEPeripheral] Sent response bundle to ${deviceAddress}: ${result.bytesSent} bytes`
        );
      }
    } catch (error) {
      if (__DEV__) {
        console.error('[BLEPeripheral] Failed to send response bundle:', error);
      }
      throw error;
    }
  }

  /**
   * Get list of currently connected devices
   */
  async getConnectedDevices(): Promise<ConnectedDevice[]> {
    try {
      const devices = await this.module.getConnectedDevices();

      // Update internal cache
      this.connectedDevices.clear();
      devices.forEach(device => {
        this.connectedDevices.set(device.address, device);
      });

      return devices;
    } catch (error) {
      if (__DEV__) {
        console.error('[BLEPeripheral] Failed to get connected devices:', error);
      }
      return [];
    }
  }

  /**
   * Disconnect a specific device
   */
  async disconnectDevice(deviceAddress: string): Promise<void> {
    try {
      await this.module.disconnectDevice(deviceAddress);
      this.connectedDevices.delete(deviceAddress);

      if (__DEV__) {
        console.log('[BLEPeripheral] Disconnected device:', deviceAddress);
      }
    } catch (error) {
      if (__DEV__) {
        console.error('[BLEPeripheral] Failed to disconnect device:', error);
      }
      throw error;
    }
  }

  /**
   * Get current advertising state
   */
  getIsAdvertising(): boolean {
    return this.isAdvertising;
  }

  /**
   * Get current merchant configuration
   */
  getCurrentConfig(): BLEPeripheralConfig | null {
    return this.currentConfig;
  }

  /**
   * Get a specific connected device
   */
  getConnectedDevice(deviceAddress: string): ConnectedDevice | undefined {
    return this.connectedDevices.get(deviceAddress);
  }

  // ============================================================================
  // Event Listeners
  // ============================================================================

  /**
   * Subscribe to bundle received events
   */
  onBundleReceived(callback: BundleReceivedListener): () => void {
    this.bundleReceivedListeners.add(callback);
    return () => {
      this.bundleReceivedListeners.delete(callback);
    };
  }

  /**
   * Subscribe to device connected events
   */
  onDeviceConnected(callback: DeviceConnectedListener): () => void {
    this.deviceConnectedListeners.add(callback);
    return () => {
      this.deviceConnectedListeners.delete(callback);
    };
  }

  /**
   * Subscribe to device disconnected events
   */
  onDeviceDisconnected(callback: DeviceDisconnectedListener): () => void {
    this.deviceDisconnectedListeners.add(callback);
    return () => {
      this.deviceDisconnectedListeners.delete(callback);
    };
  }

  /**
   * Subscribe to MTU changed events
   */
  onMtuChanged(callback: MtuChangedListener): () => void {
    this.mtuChangedListeners.add(callback);
    return () => {
      this.mtuChangedListeners.delete(callback);
    };
  }

  /**
   * Subscribe to advertising state changes
   */
  onAdvertisingStateChanged(callback: AdvertisingStateListener): () => void {
    this.advertisingStateListeners.add(callback);
    return () => {
      this.advertisingStateListeners.delete(callback);
    };
  }

  /**
   * Cleanup all event listeners
   */
  cleanup(): void {
    this.subscriptions.forEach(subscription => subscription.remove());
    this.subscriptions.clear();

    this.bundleReceivedListeners.clear();
    this.deviceConnectedListeners.clear();
    this.deviceDisconnectedListeners.clear();
    this.mtuChangedListeners.clear();
    this.advertisingStateListeners.clear();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private setupEventListeners(): void {
    if (!this.eventEmitter) return;

    // Bundle Received
    this.subscriptions.set(
      'onBundleReceived',
      this.eventEmitter.addListener('onBundleReceived', (event: BundleReceivedEvent) => {
        if (__DEV__) {
          console.log('[BLEPeripheral] Bundle received from', event.deviceAddress);
        }

        this.bundleReceivedListeners.forEach(listener => {
          try {
            listener(event);
          } catch (error) {
            if (__DEV__) {
              console.error('[BLEPeripheral] Error in bundle received listener:', error);
            }
          }
        });
      })
    );

    // Device Connected
    this.subscriptions.set(
      'onDeviceConnected',
      this.eventEmitter.addListener('onDeviceConnected', (event: DeviceConnectedEvent) => {
        if (__DEV__) {
          console.log('[BLEPeripheral] Device connected:', event.deviceAddress);
        }

        this.deviceConnectedListeners.forEach(listener => {
          try {
            listener(event);
          } catch (error) {
            if (__DEV__) {
              console.error('[BLEPeripheral] Error in device connected listener:', error);
            }
          }
        });
      })
    );

    // Device Disconnected
    this.subscriptions.set(
      'onDeviceDisconnected',
      this.eventEmitter.addListener('onDeviceDisconnected', (event: DeviceDisconnectedEvent) => {
        if (__DEV__) {
          console.log('[BLEPeripheral] Device disconnected:', event.deviceAddress);
        }

        this.connectedDevices.delete(event.deviceAddress);

        this.deviceDisconnectedListeners.forEach(listener => {
          try {
            listener(event);
          } catch (error) {
            if (__DEV__) {
              console.error('[BLEPeripheral] Error in device disconnected listener:', error);
            }
          }
        });
      })
    );

    // MTU Changed
    this.subscriptions.set(
      'onMtuChanged',
      this.eventEmitter.addListener('onMtuChanged', (event: MtuChangedEvent) => {
        if (__DEV__) {
          console.log('[BLEPeripheral] MTU changed for', event.deviceAddress, ':', event.mtu);
        }

        const device = this.connectedDevices.get(event.deviceAddress);
        if (device) {
          device.mtu = event.mtu;
        }

        this.mtuChangedListeners.forEach(listener => {
          try {
            listener(event);
          } catch (error) {
            if (__DEV__) {
              console.error('[BLEPeripheral] Error in MTU changed listener:', error);
            }
          }
        });
      })
    );

    // Advertising Started
    this.subscriptions.set(
      'onAdvertisingStarted',
      this.eventEmitter.addListener('onAdvertisingStarted', (event: AdvertisingStartedEvent) => {
        if (__DEV__) {
          console.log('[BLEPeripheral] Advertising started:', event.merchantName);
        }

        this.isAdvertising = true;

        this.advertisingStateListeners.forEach(listener => {
          try {
            listener(true);
          } catch (error) {
            if (__DEV__) {
              console.error('[BLEPeripheral] Error in advertising state listener:', error);
            }
          }
        });
      })
    );

    // Advertising Failed
    this.subscriptions.set(
      'onAdvertisingFailed',
      this.eventEmitter.addListener('onAdvertisingFailed', (event: AdvertisingFailedEvent) => {
        if (__DEV__) {
          console.error('[BLEPeripheral] Advertising failed:', event.error);
        }

        this.isAdvertising = false;

        this.advertisingStateListeners.forEach(listener => {
          try {
            listener(false, event.error);
          } catch (error) {
            if (__DEV__) {
              console.error('[BLEPeripheral] Error in advertising state listener:', error);
            }
          }
        });
      })
    );
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

const nativeModule = NativeModule ?? new NoopBLEPeripheral();
export const blePeripheralService = new BLEPeripheralService(nativeModule);

// Export types
export type { BLEPeripheralModule };
