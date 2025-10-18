# BLE Usage Guide - Beam Offline Payments

## Table of Contents

1. [Quick Start](#quick-start)
2. [Merchant Mode (Peripheral)](#merchant-mode-peripheral)
3. [Customer Mode (Central)](#customer-mode-central)
4. [Advanced Usage](#advanced-usage)
5. [Error Handling](#error-handling)
6. [Best Practices](#best-practices)
7. [Troubleshooting](#troubleshooting)

---

## Quick Start

### Installation

The BLE peripheral module is already included in the Beam app. No additional installation required.

### Permissions

#### Android

Add to `AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.BLUETOOTH" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />

<!-- Android 12+ -->
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.BLUETOOTH_ADVERTISE" />
```

#### iOS

Add to `Info.plist`:

```xml
<key>NSBluetoothAlwaysUsageDescription</key>
<string>Beam uses Bluetooth to enable offline payments between devices</string>
<key>NSBluetoothPeripheralUsageDescription</key>
<string>Beam uses Bluetooth to accept offline payments from customers</string>
```

---

## Merchant Mode (Peripheral)

Merchants advertise payment requests and accept payment bundles from customers.

### Basic Setup

```typescript
import { bleService } from '../services/BLEService';
import { blePeripheralService } from '../services/BLEPeripheralService';

// Start advertising as a merchant
async function startMerchantMode() {
  try {
    const merchantPubkey = 'YOUR_MERCHANT_PUBKEY';
    const merchantName = 'Coffee Shop';

    await bleService.startAdvertising(
      merchantPubkey,
      merchantName,
      {
        amount: 5_000000, // 5 USDC
        currency: 'USDC',
        description: 'Coffee and pastry',
        metadata: {
          orderId: 'ORDER-123',
          tableNumber: '5'
        }
      }
    );

    console.log('Advertising started!');
  } catch (error) {
    console.error('Failed to start advertising:', error);
  }
}
```

### Listen for Incoming Payments

```typescript
import type { OfflineBundle } from '@beam/shared';

async function setupPaymentListener() {
  // Define callback for when payment is received
  const handlePaymentReceived = async (bundle: OfflineBundle): Promise<OfflineBundle> => {
    console.log('Payment received:', bundle);

    // Validate bundle
    if (!validateBundle(bundle)) {
      throw new Error('Invalid payment bundle');
    }

    // Sign the bundle with merchant key
    const signedBundle = await signBundleWithMerchantKey(bundle);

    // Save to local storage for later settlement
    await saveBundleToStorage(signedBundle);

    // Return signed bundle to customer
    return signedBundle;
  };

  // Start listening
  const unsubscribe = await bleService.listenForPayments(handlePaymentReceived);

  // To stop listening later:
  // unsubscribe();
}
```

### Monitor Connected Devices

```typescript
import { blePeripheralService } from '../services/BLEPeripheralService';

async function monitorConnections() {
  // Subscribe to connection events
  const unsubscribeConnected = blePeripheralService.onDeviceConnected(event => {
    console.log('Customer connected:', event.deviceAddress, event.deviceName);
  });

  const unsubscribeDisconnected = blePeripheralService.onDeviceDisconnected(event => {
    console.log('Customer disconnected:', event.deviceAddress);
  });

  // Get currently connected devices
  const devices = await blePeripheralService.getConnectedDevices();
  console.log('Connected devices:', devices);

  // Cleanup
  // unsubscribeConnected();
  // unsubscribeDisconnected();
}
```

### Update Payment Request

```typescript
async function updatePaymentAmount(newAmount: number) {
  try {
    await bleService.updatePaymentRequest({
      amount: newAmount,
      currency: 'USDC',
      description: 'Updated order total'
    });

    console.log('Payment request updated');
    // All connected customers will be notified
  } catch (error) {
    console.error('Failed to update payment request:', error);
  }
}
```

### Stop Advertising

```typescript
async function stopMerchantMode() {
  try {
    await bleService.stopAdvertising();
    console.log('Stopped advertising');
  } catch (error) {
    console.error('Failed to stop advertising:', error);
  }
}
```

### Complete Merchant Example

```typescript
import { useState, useEffect } from 'react';
import { bleService } from '../services/BLEService';
import { blePeripheralService } from '../services/BLEPeripheralService';

function MerchantScreen() {
  const [isAdvertising, setIsAdvertising] = useState(false);
  const [connectedDevices, setConnectedDevices] = useState([]);
  const [receivedPayments, setReceivedPayments] = useState([]);

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      bleService.stopAdvertising();
    };
  }, []);

  const startMerchant = async () => {
    try {
      // Start advertising
      await bleService.startAdvertising(
        merchantPubkey,
        'My Coffee Shop',
        {
          amount: 5_000000,
          currency: 'USDC',
          description: 'Coffee'
        }
      );

      // Listen for payments
      await bleService.listenForPayments(async (bundle) => {
        // Validate and sign bundle
        const signedBundle = await processPaymentBundle(bundle);

        // Update UI
        setReceivedPayments(prev => [...prev, signedBundle]);

        return signedBundle;
      });

      // Monitor connections
      blePeripheralService.onDeviceConnected(event => {
        console.log('Customer connected:', event.deviceAddress);
        refreshConnectedDevices();
      });

      blePeripheralService.onDeviceDisconnected(event => {
        console.log('Customer disconnected:', event.deviceAddress);
        refreshConnectedDevices();
      });

      setIsAdvertising(true);
    } catch (error) {
      console.error('Failed to start merchant mode:', error);
      alert('Failed to start accepting payments');
    }
  };

  const refreshConnectedDevices = async () => {
    const devices = await bleService.getConnectedDevices();
    setConnectedDevices(devices);
  };

  const stopMerchant = async () => {
    await bleService.stopAdvertising();
    setIsAdvertising(false);
    setConnectedDevices([]);
  };

  return (
    <View>
      <Button
        title={isAdvertising ? 'Stop Accepting Payments' : 'Start Accepting Payments'}
        onPress={isAdvertising ? stopMerchant : startMerchant}
      />

      <Text>Connected Customers: {connectedDevices.length}</Text>

      <FlatList
        data={receivedPayments}
        renderItem={({ item }) => (
          <PaymentItem bundle={item} />
        )}
      />
    </View>
  );
}
```

---

## Customer Mode (Central)

Customers scan for nearby merchants and send payment bundles.

### Scan for Merchants

```typescript
import { bleService } from '../services/BLEService';

async function scanForMerchants() {
  try {
    const merchants = [];

    await bleService.scanForMerchants(
      (device, paymentRequest) => {
        console.log('Found merchant:', paymentRequest.merchantName);
        console.log('Payment request:', paymentRequest);

        merchants.push({
          device,
          paymentRequest
        });
      },
      15000 // Scan for 15 seconds
    );

    console.log('Scan complete. Found', merchants.length, 'merchants');
    return merchants;
  } catch (error) {
    console.error('Scan failed:', error);
    return [];
  }
}
```

### Connect and Send Payment

```typescript
import type { Device } from 'react-native-ble-plx';
import type { OfflineBundle } from '@beam/shared';

async function payMerchant(device: Device, paymentAmount: number) {
  try {
    // Create payment bundle
    const bundle: OfflineBundle = await createPaymentBundle({
      merchantPubkey: extractMerchantPubkey(device),
      amount: paymentAmount,
      customerPubkey: 'YOUR_CUSTOMER_PUBKEY'
    });

    // Send to merchant and get signed bundle back
    const signedBundle = await bleService.sendPaymentBundle(device, bundle);

    console.log('Payment successful!');
    console.log('Signed bundle:', signedBundle);

    // Save signed bundle for settlement
    await saveBundleToStorage(signedBundle);

    return signedBundle;
  } catch (error) {
    console.error('Payment failed:', error);
    throw error;
  }
}
```

### Complete Customer Example

```typescript
import { useState } from 'react';
import { bleService } from '../services/BLEService';

function CustomerScreen() {
  const [scanning, setScanning] = useState(false);
  const [merchants, setMerchants] = useState([]);
  const [selectedMerchant, setSelectedMerchant] = useState(null);

  const scanForMerchants = async () => {
    try {
      setScanning(true);
      setMerchants([]);

      await bleService.scanForMerchants(
        (device, paymentRequest) => {
          setMerchants(prev => [...prev, { device, paymentRequest }]);
        },
        15000
      );
    } catch (error) {
      console.error('Scan failed:', error);
      alert('Failed to scan for merchants');
    } finally {
      setScanning(false);
    }
  };

  const makePayment = async (merchant) => {
    try {
      const bundle = await createPaymentBundle({
        merchantPubkey: merchant.paymentRequest.merchantPubkey,
        amount: merchant.paymentRequest.amount,
        customerPubkey: myPubkey
      });

      const signedBundle = await bleService.sendPaymentBundle(
        merchant.device,
        bundle
      );

      await saveBundleToStorage(signedBundle);

      alert('Payment successful!');
    } catch (error) {
      console.error('Payment failed:', error);
      alert('Payment failed: ' + error.message);
    }
  };

  return (
    <View>
      <Button
        title={scanning ? 'Scanning...' : 'Scan for Merchants'}
        onPress={scanForMerchants}
        disabled={scanning}
      />

      <FlatList
        data={merchants}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => makePayment(item)}>
            <View>
              <Text>{item.paymentRequest.merchantName}</Text>
              <Text>{item.paymentRequest.amount / 1_000000} USDC</Text>
              <Text>{item.paymentRequest.description}</Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}
```

---

## Advanced Usage

### Custom Payment Request Data

```typescript
interface CustomPaymentRequest {
  amount: number;
  currency: string;
  description?: string;
  metadata?: {
    orderId?: string;
    tableNumber?: string;
    items?: Array<{
      name: string;
      quantity: number;
      price: number;
    }>;
    taxes?: number;
    tip?: number;
    total?: number;
  };
}

async function createDetailedPaymentRequest() {
  const paymentRequest: CustomPaymentRequest = {
    amount: 15_500000, // 15.5 USDC
    currency: 'USDC',
    description: 'Lunch order',
    metadata: {
      orderId: 'ORD-2024-001',
      tableNumber: '12',
      items: [
        { name: 'Burger', quantity: 1, price: 10_000000 },
        { name: 'Fries', quantity: 2, price: 3_000000 },
        { name: 'Soda', quantity: 1, price: 2_000000 }
      ],
      taxes: 1_200000,
      tip: 2_300000,
      total: 15_500000
    }
  };

  await bleService.startAdvertising(
    merchantPubkey,
    'Restaurant XYZ',
    paymentRequest
  );
}
```

### Handle Large Bundles

The chunking protocol automatically handles bundles larger than MTU size:

```typescript
// No special handling needed - chunking is automatic
const largeBundle: OfflineBundle = {
  bundleId: 'uuid-v4',
  timestamp: Date.now(),
  transactions: [
    // Multiple transactions
    // Up to 256KB total size
  ],
  signatures: { /* ... */ },
  attestations: { /* ... */ }
};

// Chunking happens automatically
await bleService.sendPaymentBundle(device, largeBundle);
```

### Multiple Simultaneous Connections

Merchants can handle multiple customers at once:

```typescript
import { blePeripheralService } from '../services/BLEPeripheralService';

async function handleMultipleCustomers() {
  // Track active transactions
  const activeTransactions = new Map();

  // Listen for bundle from any customer
  blePeripheralService.onBundleReceived(async event => {
    const { deviceAddress, bundle } = event;

    // Process bundle for specific customer
    const parsedBundle = JSON.parse(bundle);
    activeTransactions.set(deviceAddress, parsedBundle);

    // Process payment
    const signedBundle = await processPayment(parsedBundle);

    // Send response to specific customer
    await blePeripheralService.sendResponseBundle(
      deviceAddress,
      JSON.stringify(signedBundle)
    );

    activeTransactions.delete(deviceAddress);
  });

  // Monitor connections
  blePeripheralService.onDeviceConnected(event => {
    console.log('Customer connected:', event.deviceAddress);
    console.log('Total customers:', activeTransactions.size + 1);
  });
}
```

### Connection State Management

```typescript
import { ConnectionState } from '../services/BLEPeripheralService';

async function monitorConnectionState() {
  const devices = await blePeripheralService.getConnectedDevices();

  devices.forEach(device => {
    switch (device.state) {
      case ConnectionState.IDLE:
        console.log(device.address, 'is idle');
        break;
      case ConnectionState.READY:
        console.log(device.address, 'is ready');
        break;
      case ConnectionState.RECEIVING:
        console.log(device.address, 'is sending payment');
        break;
      case ConnectionState.PROCESSING:
        console.log(device.address, 'payment is processing');
        break;
      case ConnectionState.RESPONDING:
        console.log(device.address, 'sending response');
        break;
    }

    console.log('MTU:', device.mtu, 'bytes');
  });
}
```

---

## Error Handling

### Common Errors and Solutions

#### 1. Bluetooth Not Enabled

```typescript
try {
  await bleService.startAdvertising(pubkey, name, request);
} catch (error) {
  if (error.message.includes('Bluetooth')) {
    // Prompt user to enable Bluetooth
    alert('Please enable Bluetooth to accept payments');
    // On Android, you can open Bluetooth settings:
    // await BluetoothAdapter.requestEnable();
  }
}
```

#### 2. Permissions Denied

```typescript
try {
  await bleService.startAdvertising(pubkey, name, request);
} catch (error) {
  if (error.message.includes('permission')) {
    alert('Bluetooth permissions are required. Please grant permissions in Settings.');
    // Open app settings
    // Linking.openSettings();
  }
}
```

#### 3. Connection Timeout

```typescript
try {
  const signedBundle = await bleService.sendPaymentBundle(device, bundle);
} catch (error) {
  if (error.message.includes('timeout')) {
    // Retry with exponential backoff
    await retryWithBackoff(
      () => bleService.sendPaymentBundle(device, bundle),
      3, // max retries
      2000 // initial delay
    );
  }
}

async function retryWithBackoff(fn, maxRetries, initialDelay) {
  let delay = initialDelay;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }
  }
}
```

#### 4. Bundle Too Large

```typescript
try {
  await bleService.sendPaymentBundle(device, bundle);
} catch (error) {
  if (error.message.includes('too large')) {
    // Bundle exceeds 256KB limit
    // Split into multiple bundles or reduce data
    console.error('Bundle size:', JSON.stringify(bundle).length, 'bytes');
    alert('Payment data is too large. Please contact support.');
  }
}
```

### Graceful Degradation

```typescript
async function startPaymentWithFallback() {
  try {
    // Try BLE first
    await bleService.startAdvertising(pubkey, name, request);
  } catch (error) {
    console.error('BLE not available:', error);

    // Fall back to QR code
    displayQRCodePaymentRequest(request);
  }
}
```

---

## Best Practices

### 1. Battery Optimization

```typescript
// Merchant: Stop advertising when not needed
async function pauseMerchantMode() {
  if (!hasActiveCustomers()) {
    await bleService.stopAdvertising();
    console.log('Paused advertising to save battery');
  }
}

// Customer: Limit scan duration
const SCAN_DURATION = 15000; // 15 seconds max
await bleService.scanForMerchants(onMerchantFound, SCAN_DURATION);
```

### 2. User Feedback

```typescript
// Show scanning indicator
setScanning(true);
await bleService.scanForMerchants(onFound, 15000);
setScanning(false);

// Show connection status
blePeripheralService.onDeviceConnected(event => {
  showToast('Customer connected');
});

// Show payment progress
await bleService.listenForPayments(async bundle => {
  showToast('Processing payment...');
  const signed = await processBundle(bundle);
  showToast('Payment complete!');
  return signed;
});
```

### 3. Cleanup Resources

```typescript
// In React component
useEffect(() => {
  return () => {
    // Cleanup on unmount
    bleService.cleanup();
  };
}, []);

// Manual cleanup
async function cleanupBLE() {
  await bleService.stopAdvertising();
  await bleService.stopScanning();
  await bleService.disconnect();
  blePeripheralService.cleanup();
}
```

### 4. Validate Input

```typescript
function validateBundle(bundle: OfflineBundle): boolean {
  // Check required fields
  if (!bundle.bundleId || !bundle.timestamp) {
    return false;
  }

  // Check timestamp (not too old)
  const age = Date.now() - bundle.timestamp;
  if (age > 5 * 60 * 1000) { // 5 minutes
    console.error('Bundle too old:', age, 'ms');
    return false;
  }

  // Verify signatures
  if (!verifySignatures(bundle)) {
    return false;
  }

  return true;
}
```

### 5. Logging and Monitoring

```typescript
// Production logging
if (__DEV__) {
  console.log('[BLE] Detailed debug logs');
} else {
  // Send to analytics
  analytics.track('ble_payment_received', {
    amount: bundle.amount,
    merchantId: merchantPubkey,
    duration: Date.now() - startTime
  });
}
```

---

## Troubleshooting

### Issue: Can't start advertising

**Symptoms**: Error when calling `startAdvertising()`

**Solutions**:
1. Check Bluetooth is enabled
2. Check permissions are granted
3. Check device supports BLE peripheral mode (some Android devices don't)
4. Restart Bluetooth adapter
5. Check if another app is already advertising

```typescript
// Check BLE support
const isSupported = await checkBLEPeripheralSupport();
if (!isSupported) {
  alert('Your device does not support BLE peripheral mode. Use QR codes instead.');
}
```

### Issue: Merchants not found during scan

**Symptoms**: Scan completes but no merchants found

**Solutions**:
1. Ensure merchant is advertising
2. Check Bluetooth is enabled on both devices
3. Increase scan duration
4. Check device proximity (BLE range ~10-30 meters)
5. Check for Bluetooth interference

```typescript
// Extended scan with debug logging
await bleService.scanForMerchants(
  (device, request) => {
    console.log('Found device:', device.name, device.id);
  },
  30000 // 30 seconds
);
```

### Issue: Connection drops during payment

**Symptoms**: Connection lost while sending bundle

**Solutions**:
1. Reduce distance between devices
2. Retry transaction
3. Check for Bluetooth interference
4. Ensure devices have sufficient battery

```typescript
// Auto-retry on connection loss
async function robustSendBundle(device, bundle, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await bleService.sendPaymentBundle(device, bundle);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      console.log('Retry', i + 1, 'of', maxRetries);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}
```

### Issue: Slow data transfer

**Symptoms**: Bundle transfer takes > 5 seconds

**Solutions**:
1. Check MTU is negotiated correctly (should be 512)
2. Reduce bundle size if possible
3. Check for Bluetooth interference
4. Ensure devices support BLE 4.2+ for larger MTU

```typescript
// Check MTU after connection
const devices = await blePeripheralService.getConnectedDevices();
devices.forEach(device => {
  console.log('Device MTU:', device.mtu);
  if (device.mtu < 185) {
    console.warn('Low MTU may cause slow transfers');
  }
});
```

### Debug Mode

```typescript
// Enable detailed logging
const DEBUG = true;

if (DEBUG) {
  // Log all BLE events
  blePeripheralService.onDeviceConnected(e => console.log('Connected:', e));
  blePeripheralService.onDeviceDisconnected(e => console.log('Disconnected:', e));
  blePeripheralService.onMtuChanged(e => console.log('MTU changed:', e));
  blePeripheralService.onBundleReceived(e => console.log('Bundle received:', e));
}
```

---

## Platform-Specific Notes

### Android

- **Peripheral mode** requires Android 5.0+ (API 21)
- **Multiple advertising** requires Android 8.0+ (API 26)
- **Extended advertising** requires Android 8.0+ (API 26)
- Some devices don't support peripheral mode (check manufacturer specs)

### iOS

- **Peripheral mode** requires iOS 6.0+
- **512-byte MTU** requires iOS 10.0+
- App must be in foreground for best performance
- Background advertising has limitations (name may not be advertised)

---

## Next Steps

1. **Testing**: Use the test suite in `/tests/ble/` to verify implementation
2. **Integration**: Integrate with your payment flow
3. **Deployment**: Test on real devices (simulators have limitations)
4. **Monitoring**: Set up analytics to track BLE payment success rate

---

## Support

- **Documentation**: See [BLE_PROTOCOL_SPECIFICATION.md](./BLE_PROTOCOL_SPECIFICATION.md)
- **Issues**: Report bugs on GitHub
- **Community**: Join Discord for help

---

**Last Updated**: 2025-10-18
