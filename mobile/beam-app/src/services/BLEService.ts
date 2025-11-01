import { BleManager, Device, BleError, Subscription, Characteristic } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid } from 'react-native';
import { Buffer } from 'buffer';
import { Config } from '../config';
import { startAdvertising, stopAdvertising, setServices } from 'munim-bluetooth-peripheral';

export interface BLEPaymentRequest {
  merchantPubkey: string;
  merchantName: string;
  amount: number;
  description?: string;
}

export class BLEService {
  private manager: BleManager;
  private device: Device | null = null;
  private isScanning = false;
  private connectionSubscription: Subscription | null = null;

  constructor() {
    this.manager = new BleManager();
  }

  async requestPermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') {
      return true;
    }

    const apiLevel = Platform.Version;

    if (apiLevel >= 31) {
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
    }

    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  }

  async isBluetoothEnabled(): Promise<boolean> {
    const state = await this.manager.state();
    return state === 'PoweredOn';
  }

  async scanForMerchants(
    onMerchantFound: (device: Device, paymentRequest: BLEPaymentRequest) => void,
    timeout: number = 15000,
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
      this.stopScanning();
    }

    this.isScanning = true;
    this.manager.startDeviceScan(
      [Config.ble.serviceUUID],
      { allowDuplicates: false },
      (error: BleError | null, device: Device | null) => {
        if (error) {
          console.error('[BLE] Scan error:', error);
          this.stopScanning();
          return;
        }

        if (!device) {
          return;
        }

        const paymentRequest = this.parsePaymentRequest(device);
        if (paymentRequest) {
          onMerchantFound(device, paymentRequest);
        }
      },
    );

    setTimeout(() => {
      if (this.isScanning) {
        this.stopScanning();
      }
    }, timeout);
  }

  stopScanning(): void {
    if (this.isScanning) {
      this.manager.stopDeviceScan();
      this.isScanning = false;
    }
  }

  async startAdvertising(paymentRequest: BLEPaymentRequest): Promise<void> {
    const hasPermission = await this.requestPermissions();
    if (!hasPermission) {
      throw new Error('Bluetooth permissions not granted');
    }

    const bluetoothEnabled = await this.isBluetoothEnabled();
    if (!bluetoothEnabled) {
      throw new Error('Please enable Bluetooth to accept payments');
    }

    try {
      await this.stopAdvertising();

      const payloadJson = JSON.stringify(paymentRequest);
      const payloadBase64 = Buffer.from(payloadJson, 'utf-8').toString('base64');

      setServices([
        {
          uuid: Config.ble.serviceUUID,
          characteristics: [
            {
              uuid: Config.ble.bundleCharUUID,
              properties: ['read', 'write', 'writeWithoutResponse'],
              value: payloadBase64,
            },
            {
              uuid: Config.ble.responseCharUUID,
              properties: ['read', 'notify'],
            },
          ],
        },
      ]);

      await startAdvertising({
        serviceUUIDs: [Config.ble.serviceUUID],
        localName: `Beam-${paymentRequest.merchantName}`,
        advertisingData: {
          completeServiceUUIDs128: [Config.ble.serviceUUID],
          completeLocalName: `Beam-${paymentRequest.merchantName}`,
        },
      });

      console.log('[BLE] Started advertising as merchant:', paymentRequest.merchantName);
    } catch (error) {
      console.error('[BLE] Advertising error:', error);
      throw error;
    }
  }

  async stopAdvertising(): Promise<void> {
    try {
      await stopAdvertising();
    } catch (error) {
      console.error('[BLE] Error stopping advertising:', error);
    }
  }

  async connectToDevice(deviceId: string): Promise<Device> {
    try {
      const device = await this.manager.connectToDevice(deviceId, { timeout: 10000 });
      this.device = device;
      await device.discoverAllServicesAndCharacteristics();
      return device;
    } catch (error) {
      console.error('[BLE] Connection error:', error);
      throw error;
    }
  }

  async readPaymentRequest(): Promise<BLEPaymentRequest | null> {
    if (!this.device) {
      throw new Error('No device connected');
    }

    try {
      const payload = await this.readCharacteristic(
        Config.ble.serviceUUID,
        Config.ble.bundleCharUUID,
      );
      if (!payload) {
        return null;
      }
      return JSON.parse(payload) as BLEPaymentRequest;
    } catch (error) {
      console.error('[BLE] Failed to read payment request characteristic:', error);
      return null;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.device) {
      return;
    }

    try {
      await this.manager.cancelDeviceConnection(this.device.id);
    } catch (error) {
      console.error('[BLE] Disconnect error:', error);
    } finally {
      this.device = null;
    }
  }

  async writeCharacteristic(
    serviceUUID: string,
    charUUID: string,
    data: string,
  ): Promise<Characteristic | null> {
    if (!this.device) {
      throw new Error('No device connected');
    }

    try {
      return await this.device.writeCharacteristicWithResponseForService(
        serviceUUID,
        charUUID,
        Buffer.from(data, 'utf-8').toString('base64'),
      );
    } catch (error) {
      console.error('[BLE] Write characteristic error:', error);
      return null;
    }
  }

  async readCharacteristic(serviceUUID: string, charUUID: string): Promise<string | null> {
    if (!this.device) {
      throw new Error('No device connected');
    }

    try {
      const characteristic = await this.device.readCharacteristicForService(serviceUUID, charUUID);
      if (!characteristic.value) {
        return null;
      }
      return Buffer.from(characteristic.value, 'base64').toString('utf-8');
    } catch (error) {
      console.error('[BLE] Read characteristic error:', error);
      return null;
    }
  }

  cleanup(): void {
    this.stopScanning();
    void this.disconnect();
    this.connectionSubscription?.remove();
    this.connectionSubscription = null;
    this.manager.destroy();
  }

  private parsePaymentRequest(device: Device): BLEPaymentRequest | null {
    if (!device.name || !device.name.startsWith(Config.ble.deviceNamePrefix)) {
      return null;
    }

    return {
      merchantPubkey: '',
      merchantName: device.name.replace(Config.ble.deviceNamePrefix, ''),
      amount: 0,
      description: undefined,
    };
  }
}

export const bleService = new BLEService();
