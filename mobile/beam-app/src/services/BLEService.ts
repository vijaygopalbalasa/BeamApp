import { BleManager, Device } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid } from 'react-native';
import type { OfflineBundle } from '@beam/shared';
import { Config } from '../config';
import { Buffer } from 'buffer';
import { blePeripheralService, type BLEPeripheralConfig } from './BLEPeripheralService';

export interface BLEPaymentRequest {
  merchantPubkey: string;
  merchantName: string;
  amount: number;
  description?: string;
}

export class BLEService {
  private manager: BleManager;
  private device: Device | null = null;
  private isScanning: boolean = false;

  constructor() {
    this.manager = new BleManager();
  }

  /**
   * Request all necessary Bluetooth permissions
   */
  async requestPermissions(): Promise<boolean> {
    if (Platform.OS === 'android') {
      if (Platform.Version >= 31) {
        // Android 12+
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);

        return (
          granted['android.permission.BLUETOOTH_SCAN'] === PermissionsAndroid.RESULTS.GRANTED &&
          granted['android.permission.BLUETOOTH_CONNECT'] === PermissionsAndroid.RESULTS.GRANTED &&
          granted['android.permission.BLUETOOTH_ADVERTISE'] === PermissionsAndroid.RESULTS.GRANTED &&
          granted['android.permission.ACCESS_FINE_LOCATION'] === PermissionsAndroid.RESULTS.GRANTED
        );
      } else {
        // Android 11 and below
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
    }
    // iOS permissions handled automatically
    return true;
  }

  /**
   * Check if Bluetooth is enabled
   */
  async isBluetoothEnabled(): Promise<boolean> {
    const state = await this.manager.state();
    return state === 'PoweredOn';
  }

  /**
   * Merchant: Start advertising for offline payments
   */
  async startAdvertising(
    merchantPubkey: string,
    merchantName: string,
    paymentRequest?: {
      amount: number;
      currency: string;
      description?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    const hasPermission = await this.requestPermissions();
    if (!hasPermission) {
      throw new Error('Bluetooth permissions not granted');
    }

    const bluetoothEnabled = await this.isBluetoothEnabled();
    if (!bluetoothEnabled) {
      throw new Error('Please enable Bluetooth to accept payments');
    }

    // Use the enhanced BLE peripheral service
    const config: BLEPeripheralConfig = {
      merchantPubkey,
      merchantName,
      paymentRequest,
    };

    await blePeripheralService.startAdvertising(config);

    if (__DEV__) {
      console.log('[BLE] Started advertising as merchant:', merchantName);
    }
  }

  /**
   * Customer: Scan for nearby merchants
   */
  async scanForMerchants(
    onMerchantFound: (device: Device, paymentRequest: BLEPaymentRequest) => void,
    timeout: number = 15000
  ): Promise<void> {
    const hasPermission = await this.requestPermissions();
    if (!hasPermission) {
      throw new Error('Bluetooth permissions not granted');
    }

    const bluetoothEnabled = await this.isBluetoothEnabled();
    if (!bluetoothEnabled) {
      throw new Error('Please enable Bluetooth to scan for merchants');
    }

    if (this.isScanning) {
      if (__DEV__) {
        console.log('[BLE] Already scanning, stopping previous scan');
      }
      this.stopScanning();
    }

    return new Promise((resolve, reject) => {
      if (__DEV__) {
        console.log('[BLE] Starting scan for merchants...');
      }
      this.isScanning = true;

      const scanTimeout = setTimeout(() => {
        if (__DEV__) {
          console.log('[BLE] Scan timeout reached');
        }
        this.stopScanning();
        resolve();
      }, timeout);

      this.manager.startDeviceScan(
        [Config.ble.serviceUUID],
        {
          allowDuplicates: false,
          scanMode: 1, // Low latency mode
        },
        (error, device) => {
          if (error) {
            if (__DEV__) {
              console.error('[BLE] Scan error:', error);
            }
            clearTimeout(scanTimeout);
            this.isScanning = false;
            this.manager.stopDeviceScan();
            reject(error);
            return;
          }

          if (device && device.name?.startsWith('Beam-')) {
            if (__DEV__) {
              console.log('[BLE] Found merchant device:', device.name, device.id);
            }

            try {
              // Parse merchant info from advertisement data
              // In production, merchant pubkey should be in advertisement data
              // Format: serviceData should contain merchant pubkey

              let merchantPubkey = '';
              if (device.serviceData && device.serviceData[Config.ble.serviceUUID]) {
                // Decode merchant pubkey from service data
                const serviceData = device.serviceData[Config.ble.serviceUUID];
                merchantPubkey = Buffer.from(serviceData, 'base64').toString('utf-8');
              } else {
                // Fallback: This won't work in production
                if (__DEV__) {
                  console.warn('[BLE] No service data found. Merchant pubkey not available.');
                }
                throw new Error('Invalid merchant advertisement: missing pubkey data');
              }

              // Parse merchant name from device name
              // Format: "Beam-{merchantName}"
              const merchantName = device.name.replace('Beam-', '') || 'Unknown Merchant';

              const paymentRequest: BLEPaymentRequest = {
                merchantPubkey,
                merchantName,
                amount: 10_000000, // Default 10 USDC
                description: `Payment to ${merchantName}`,
              };

              onMerchantFound(device, paymentRequest);
            } catch (err) {
              if (__DEV__) {
                console.error('[BLE] Failed to parse merchant info:', err);
              }
            }
          }
        }
      );
    });
  }

  /**
   * Customer: Connect to merchant and send payment bundle
   */
  async sendPaymentBundle(device: Device, bundle: OfflineBundle): Promise<OfflineBundle> {
    try {
      if (__DEV__) {
        console.log('[BLE] Connecting to merchant...', device.id);
      }

      // Connect with timeout
      const connectedDevice = await device.connect({ timeout: 10000 });
      this.device = connectedDevice;

      if (__DEV__) {
        console.log('[BLE] Discovering services...');
      }
      await connectedDevice.discoverAllServicesAndCharacteristics();

      // Convert bundle to base64 for transmission
      const bundleJson = JSON.stringify(bundle);
      const base64Bundle = Buffer.from(bundleJson).toString('base64');

      if (__DEV__) {
        console.log('[BLE] Sending payment bundle...');
      }

      // Write bundle to characteristic
      await connectedDevice.writeCharacteristicWithResponseForService(
        Config.ble.serviceUUID,
        Config.ble.bundleCharUUID,
        base64Bundle
      );

      if (__DEV__) {
        console.log('[BLE] Reading merchant response...');
      }

      // Read response (merchant-signed bundle)
      const responseChar = await connectedDevice.readCharacteristicForService(
        Config.ble.serviceUUID,
        Config.ble.responseCharUUID
      );

      const responseJson = Buffer.from(responseChar.value!, 'base64').toString();
      const signedBundle: OfflineBundle = JSON.parse(responseJson);

      if (__DEV__) {
        console.log('[BLE] Payment bundle exchanged successfully');
      }

      // Disconnect
      await connectedDevice.cancelConnection();
      this.device = null;

      return signedBundle;
    } catch (error) {
      if (__DEV__) {
        console.error('[BLE] Failed to send payment bundle:', error);
      }

      // Clean up connection
      if (this.device) {
        try {
          await this.device.cancelConnection();
        } catch {
          // Ignore disconnect errors
        }
        this.device = null;
      }

      throw error;
    }
  }

  /**
   * Merchant: Listen for incoming payment bundles
   */
  async listenForPayments(
    onPaymentReceived: (bundle: OfflineBundle) => Promise<OfflineBundle>
  ): Promise<() => void> {
    const hasPermission = await this.requestPermissions();
    if (!hasPermission) {
      throw new Error('Bluetooth permissions not granted');
    }

    const bluetoothEnabled = await this.isBluetoothEnabled();
    if (!bluetoothEnabled) {
      throw new Error('Please enable Bluetooth to accept payments');
    }

    // Use the enhanced BLE peripheral service
    const unsubscribe = blePeripheralService.onBundleReceived(async event => {
      try {
        const bundle: OfflineBundle = JSON.parse(event.bundle);

        if (__DEV__) {
          console.log('[BLE] Received payment bundle from', event.deviceAddress);
        }

        // Process the bundle and get the signed response
        const signedBundle = await onPaymentReceived(bundle);

        // Send the signed bundle back to the customer
        await blePeripheralService.sendResponseBundle(event.deviceAddress, signedBundle);

        if (__DEV__) {
          console.log('[BLE] Sent signed bundle to', event.deviceAddress);
        }
      } catch (error) {
        if (__DEV__) {
          console.error('[BLE] Error processing payment bundle:', error);
        }
      }
    });

    return unsubscribe;
  }

  /**
   * Process BLE payment exchange
   * Note: Requires native peripheral mode implementation.
   */
  async simulatePaymentExchange(
    _merchantPubkey: string,
    _bundle: OfflineBundle
  ): Promise<OfflineBundle> {
    throw new Error(
      'BLE Payment Exchange Requires Additional Setup\n\n' +
      'BLE-based payment exchange requires native peripheral mode implementation. ' +
      'This feature requires additional device configuration.\n\n' +
      'Alternative payment flow:\n' +
      '1. Use two devices\n' +
      '2. Merchant generates QR code\n' +
      '3. Customer scans QR code\n' +
      '4. Payment is created offline and can be settled later'
    );
  }

  /**
   * Stop scanning for devices
   */
  stopScanning(): void {
    if (this.isScanning) {
      if (__DEV__) {
        console.log('[BLE] Stopping device scan');
      }
      this.manager.stopDeviceScan();
      this.isScanning = false;
    }
  }

  /**
   * Disconnect from current device
   */
  async disconnect(): Promise<void> {
    if (this.device) {
      try {
        if (__DEV__) {
          console.log('[BLE] Disconnecting from device');
        }
        await this.device.cancelConnection();
      } catch (err) {
        if (__DEV__) {
          console.error('[BLE] Disconnect error:', err);
        }
      } finally {
        this.device = null;
      }
    }
  }

  /**
   * Stop advertising (merchant mode)
   */
  async stopAdvertising(): Promise<void> {
    await blePeripheralService.stopAdvertising();

    if (__DEV__) {
      console.log('[BLE] Stopped advertising');
    }
  }

  /**
   * Get connected devices (merchant mode)
   */
  async getConnectedDevices() {
    return blePeripheralService.getConnectedDevices();
  }

  /**
   * Update payment request while advertising (merchant mode)
   */
  async updatePaymentRequest(paymentRequest: {
    amount: number;
    currency: string;
    description?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await blePeripheralService.updatePaymentRequest(paymentRequest);

    if (__DEV__) {
      console.log('[BLE] Updated payment request');
    }
  }

  /**
   * Get advertising state
   */
  isAdvertisingActive(): boolean {
    return blePeripheralService.getIsAdvertising();
  }

  /**
   * Cleanup all BLE resources
   */
  async cleanup(): Promise<void> {
    this.stopScanning();
    await this.disconnect();
    await blePeripheralService.stopAdvertising();
    blePeripheralService.cleanup();
  }

  /**
   * Get scan status
   */
  getIsScanning(): boolean {
    return this.isScanning;
  }

  /**
   * Get connected device
   */
  getConnectedDevice(): Device | null {
    return this.device;
  }
}

export const bleService = new BLEService();
