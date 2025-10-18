# BLE Known Limitations and Workarounds

## Overview

This document outlines known limitations of the BLE peripheral implementation for the Beam app, along with recommended workarounds and mitigation strategies.

---

## Platform Limitations

### 1. iOS Background Mode Restrictions

**Limitation**: iOS restricts BLE peripheral functionality when the app is in the background.

**Impact**:
- Advertising continues but with reduced parameters
- Device name may not be advertised
- Service UUID advertising continues
- GATT server remains active but with limitations
- Connection handling may be delayed

**Workaround**:
```typescript
// Inform user to keep app in foreground
function showBackgroundWarning() {
  Alert.alert(
    'Keep App Active',
    'For best results, keep the Beam app in the foreground while accepting payments.',
    [{ text: 'OK' }]
  );
}

// Monitor app state
AppState.addEventListener('change', nextAppState => {
  if (nextAppState === 'background' && bleService.isAdvertisingActive()) {
    showBackgroundWarning();
  }
});
```

**Mitigation**:
- Add `bluetooth-peripheral` to UIBackgroundModes in Info.plist (already done)
- Use notifications to prompt user to open app
- Consider QR code fallback for background scenarios

**Reference**: [Apple Docs - Core Bluetooth Background Processing](https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/CoreBluetoothBackgroundProcessingForIOSApps/PerformingTasksWhileYourAppIsInTheBackground.html)

---

### 2. Android Peripheral Support Varies by Device

**Limitation**: Not all Android devices support BLE peripheral mode, even if they support BLE central mode.

**Affected Devices**:
- Some budget Android phones
- Older devices (pre-2015)
- Some tablets
- Emulators (most don't support peripheral mode)

**Detection**:
```kotlin
// Android native code
fun isPeripheralModeSupported(): Boolean {
    return bluetoothAdapter?.isMultipleAdvertisementSupported == true
}
```

```typescript
// TypeScript
async function checkPeripheralSupport() {
  try {
    await blePeripheralService.startAdvertising(testConfig);
    await blePeripheralService.stopAdvertising();
    return true;
  } catch (error) {
    if (error.message.includes('not supported')) {
      return false;
    }
    throw error;
  }
}

// In UI
const supported = await checkPeripheralSupport();
if (!supported) {
  showQRCodeMode(); // Fallback to QR codes
}
```

**Mitigation**:
- Check support before enabling merchant mode
- Provide QR code fallback
- Display clear error message
- Recommend compatible devices in documentation

**Known Compatible Devices**:
- Google Pixel (all models)
- Samsung Galaxy S7+
- OnePlus 5+
- Most flagship devices from 2016+

---

### 3. MTU Negotiation Not Guaranteed

**Limitation**: MTU negotiation may fail or return smaller than requested size.

**Impact**:
- Slower data transfer
- More chunks required for large bundles
- Increased transfer time

**Default MTU**: 23 bytes (BLE 4.0 minimum)
**Requested MTU**: 512 bytes
**Common Actual MTU**: 185-512 bytes

**Workaround**:
```typescript
// Handle any MTU size gracefully
blePeripheralService.onMtuChanged(event => {
  console.log('MTU for', event.deviceAddress, ':', event.mtu);

  if (event.mtu < 185) {
    // Warn about slow transfers
    showSlowTransferWarning(event.deviceAddress);
  }
});

// Optimize bundle size for low MTU
function optimizeBundle(bundle: OfflineBundle, mtu: number) {
  if (mtu < 185) {
    // Remove optional fields to reduce size
    delete bundle.metadata?.optional;
    delete bundle.attestations?.deviceInfo?.extraData;
  }
  return bundle;
}
```

**Mitigation**:
- Chunking protocol handles any MTU size
- Progress indicator for large transfers
- Option to compress bundles (future)

---

## Data Transfer Limitations

### 4. Maximum Bundle Size: 256 KB

**Limitation**: Bundles larger than 256 KB are rejected.

**Rationale**:
- BLE is designed for small data transfers
- Larger transfers are unreliable
- Battery impact increases with size
- Transfer time becomes impractical

**Typical Bundle Sizes**:
- Simple payment: ~500 bytes
- With attestation: ~2-5 KB
- Multiple transactions: ~5-20 KB

**Workaround**:
```typescript
// Validate bundle size before sending
function validateBundleSize(bundle: OfflineBundle): boolean {
  const size = JSON.stringify(bundle).length;
  const MAX_SIZE = 256 * 1024; // 256 KB

  if (size > MAX_SIZE) {
    console.error('Bundle too large:', size, 'bytes');
    return false;
  }

  if (size > 50 * 1024) {
    console.warn('Large bundle may be slow:', size, 'bytes');
  }

  return true;
}

// Split large bundles if needed
function splitBundle(bundle: OfflineBundle): OfflineBundle[] {
  if (bundle.transactions.length <= 10) {
    return [bundle];
  }

  // Split into multiple bundles
  const chunks = [];
  for (let i = 0; i < bundle.transactions.length; i += 10) {
    chunks.push({
      ...bundle,
      bundleId: generateNewBundleId(),
      transactions: bundle.transactions.slice(i, i + 10)
    });
  }
  return chunks;
}
```

**Mitigation**:
- Keep bundles minimal (only essential data)
- Use batch settlement for multiple transactions
- Consider compression (future enhancement)

---

### 5. Transfer Speed Limitations

**Limitation**: BLE is slower than WiFi or NFC.

**Typical Speeds**:
- **MTU 23**: ~400 bytes/second
- **MTU 185**: ~2 KB/second
- **MTU 512**: ~5 KB/second

**Comparison**:
- NFC: ~424 Kbps (53 KB/s)
- WiFi Direct: ~250 Mbps (31 MB/s)
- BLE: ~1 Mbps theoretical, ~5 KB/s practical

**Impact**:
| Bundle Size | MTU 23  | MTU 185 | MTU 512 |
|-------------|---------|---------|---------|
| 1 KB        | ~2.5s   | ~0.5s   | ~0.2s   |
| 10 KB       | ~25s    | ~5s     | ~2s     |
| 100 KB      | ~4min   | ~50s    | ~20s    |

**Workaround**:
```typescript
// Show progress for large transfers
function showTransferProgress(size: number, mtu: number) {
  const estimatedTime = estimateTransferTime(size, mtu);

  return (
    <ProgressBar
      indeterminate={estimatedTime < 2}
      progress={currentProgress}
      message={`Transferring payment (${Math.round(estimatedTime)}s)...`}
    />
  );
}

// Optimize bundle before transfer
async function optimizeBundleForTransfer(bundle: OfflineBundle) {
  // Remove whitespace from JSON
  const minified = JSON.stringify(bundle);

  // Future: Add compression
  // const compressed = await compress(minified);

  return minified;
}
```

**Mitigation**:
- Keep bundles < 10 KB when possible
- Show progress indicator
- Inform users about expected wait time
- Use QR codes for very large bundles

---

## Range and Connectivity Limitations

### 6. Limited BLE Range

**Limitation**: BLE has limited range compared to WiFi.

**Typical Range**:
- **Ideal conditions**: 30-50 meters
- **Indoor**: 10-20 meters
- **With obstacles**: 5-10 meters
- **Pocket/purse**: 2-5 meters

**Factors Affecting Range**:
- Physical obstacles (walls, people)
- Interference (WiFi, other BLE devices)
- Device orientation
- Tx power level
- Device antenna quality

**Workaround**:
```typescript
// Monitor connection quality
blePeripheralService.onDeviceConnected(event => {
  // Periodically check connection
  const interval = setInterval(async () => {
    const devices = await blePeripheralService.getConnectedDevices();
    const device = devices.find(d => d.address === event.deviceAddress);

    if (!device) {
      clearInterval(interval);
      showConnectionLostWarning();
    }
  }, 5000);
});

// UI guidance
function showProximityGuidance() {
  return (
    <View>
      <Text>Keep devices close together during payment</Text>
      <Text>Recommended distance: less than 1 meter</Text>
    </View>
  );
}
```

**Mitigation**:
- Instruct users to keep devices close
- Use HIGH tx power for advertising
- Implement connection loss recovery
- Retry failed transfers

---

### 7. Connection Limit

**Limitation**: Limited number of simultaneous connections.

**Limits**:
- **Android**: Typically 7-8 simultaneous connections
- **iOS**: Typically 8-10 simultaneous connections (as peripheral)
- **Varies by**: Device, OS version, BLE hardware

**Impact**:
- Merchant can serve ~7-8 customers simultaneously
- Additional customers must wait

**Workaround**:
```typescript
// Track connection count
let activeConnections = 0;
const MAX_CONNECTIONS = 7;

blePeripheralService.onDeviceConnected(event => {
  activeConnections++;

  if (activeConnections >= MAX_CONNECTIONS) {
    showCapacityWarning();
  }
});

blePeripheralService.onDeviceDisconnected(event => {
  activeConnections--;
});

// Queue system for busy merchants
class ConnectionQueue {
  private queue: string[] = [];

  async waitForSlot(): Promise<void> {
    return new Promise(resolve => {
      if (activeConnections < MAX_CONNECTIONS) {
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
  }

  releaseSlot(): void {
    const next = this.queue.shift();
    if (next) next();
  }
}
```

**Mitigation**:
- Disconnect immediately after payment
- Don't maintain persistent connections
- Implement queue system for busy periods
- Show "serving X customers" indicator

---

## Security Limitations

### 8. No BLE-Level Encryption

**Limitation**: Data transmitted over BLE is not encrypted at the BLE layer (no pairing).

**Rationale**:
- Pairing reduces UX friction
- Security handled at application layer
- Bundle data is signed, not encrypted

**What's Transmitted**:
- Public keys (already public)
- Signatures (cryptographically secure)
- Transaction data (will be public on blockchain anyway)
- Attestation reports (designed for public transmission)

**Risks**:
- Eavesdropping (low risk - data is public anyway)
- MITM (mitigated by signature verification)
- Replay (mitigated by timestamp + nonce)

**Mitigation**:
```typescript
// Validate bundle integrity
function validateBundleIntegrity(bundle: OfflineBundle): boolean {
  // 1. Verify signatures
  if (!verifyPayerSignature(bundle)) {
    return false;
  }

  // 2. Check timestamp (prevent old bundles)
  const age = Date.now() - bundle.timestamp;
  if (age > 5 * 60 * 1000) { // 5 minutes
    console.error('Bundle too old');
    return false;
  }

  // 3. Verify nonce (prevent replay)
  if (seenNonces.has(bundle.attestations.payer.nonce)) {
    console.error('Duplicate nonce - replay attack?');
    return false;
  }
  seenNonces.add(bundle.attestations.payer.nonce);

  // 4. Verify merchant pubkey matches
  if (bundle.transactions[0].to !== merchantPubkey) {
    console.error('Bundle not for this merchant');
    return false;
  }

  return true;
}
```

**Future Enhancement**:
- Optional BLE pairing for sensitive data
- End-to-end encryption at application layer
- Encrypted characteristics (BLE 4.2+)

---

### 9. Advertisement Data Interception

**Limitation**: BLE advertisements are public and can be scanned by anyone.

**What's Advertised**:
- Service UUID (identifies Beam app)
- Merchant name
- Merchant public key

**Risks**:
- Competitors tracking merchant locations
- Privacy concern for merchant identity
- Fake merchants advertising

**Workaround**:
```typescript
// Verify merchant before payment
async function verifyMerchant(merchantPubkey: string): Promise<boolean> {
  // Option 1: Check against known merchant list
  const knownMerchants = await fetchKnownMerchants();
  if (knownMerchants.includes(merchantPubkey)) {
    return true;
  }

  // Option 2: Show merchant info and let user confirm
  const merchantInfo = await fetchMerchantInfo(merchantPubkey);
  return await confirmMerchant(merchantInfo);
}

// Detect fake merchants
function detectSuspiciousMerchant(merchant: Merchant): boolean {
  // Check if merchant pubkey is newly seen
  const firstSeen = merchantSeenTimes.get(merchant.pubkey);
  const now = Date.now();

  if (!firstSeen) {
    merchantSeenTimes.set(merchant.pubkey, now);
    return true; // New merchant - potentially suspicious
  }

  // Warn if merchant changed identity quickly
  if (now - firstSeen < 60000) { // Less than 1 minute
    return true; // Suspicious - could be spoofing
  }

  return false;
}
```

**Mitigation**:
- Require merchant registration/verification
- Display merchant reputation score
- Allow customers to report suspicious merchants
- Use device attestation to verify merchant device integrity

---

## Platform-Specific Limitations

### 10. Android: Advertising Name Length

**Limitation**: Android limits advertisement data size, affecting device name length.

**Limits**:
- Total advertisement data: 31 bytes (BLE 4.x)
- Extended advertising: 254 bytes (BLE 5.0, Android 8.0+)
- Service UUID: 16 bytes
- Device name: ~15 bytes remaining (BLE 4.x)

**Workaround**:
```typescript
// Truncate merchant name if needed
function formatMerchantName(name: string, maxLength: number = 10): string {
  if (name.length <= maxLength) {
    return name;
  }

  return name.substring(0, maxLength - 1) + '…';
}

// Use scan response for full data
// (Handled automatically in native module)
```

**Mitigation**:
- Keep merchant names short
- Use scan response for additional data
- Use extended advertising on supported devices

---

### 11. iOS: No Access to Central's MAC Address

**Limitation**: iOS doesn't expose the central device's MAC address to peripherals.

**Impact**:
- Can't reliably identify customers across reconnections
- Can't implement MAC-based access control
- Device address is a UUID that changes

**Workaround**:
```typescript
// Use bundle ID for correlation instead
const customerMap = new Map<string, CustomerData>();

blePeripheralService.onBundleReceived(event => {
  const bundle = JSON.parse(event.bundle);

  // Use payer pubkey as identifier
  const customerId = bundle.transactions[0].from;

  customerMap.set(customerId, {
    deviceAddress: event.deviceAddress,
    lastSeen: Date.now(),
    totalPayments: (customerMap.get(customerId)?.totalPayments || 0) + 1
  });
});
```

**Mitigation**:
- Use application-layer identifiers (pubkeys)
- Don't rely on BLE device addresses
- Implement correlation at bundle level

---

### 12. Emulator/Simulator Limitations

**Limitation**: BLE peripheral mode doesn't work in emulators/simulators.

**Affected**:
- Android Emulator (all versions)
- iOS Simulator (all versions)
- Most desktop Bluetooth stacks

**Impact**:
- Can't test peripheral mode without real devices
- Can't use automated testing for some features

**Workaround**:
```typescript
// Mock implementation for testing
const IS_EMULATOR = Platform.OS === 'ios' && !Device.isDevice;

class MockBLEPeripheralModule {
  async startAdvertising(config) {
    console.log('[Mock] Started advertising:', config);
    return { success: true };
  }

  async getConnectedDevices() {
    return [
      { address: 'MOCK-001', name: 'Test Customer', state: 1, mtu: 512 }
    ];
  }

  // ... other mock methods
}

export const blePeripheralService = new BLEPeripheralService(
  IS_EMULATOR ? new MockBLEPeripheralModule() : NativeModule
);
```

**Mitigation**:
- Use real devices for BLE testing
- Implement mock layer for unit tests
- Use integration tests on real hardware
- Consider BLE hardware simulator (expensive)

---

## General BLE Limitations

### 13. Interference from Other Devices

**Limitation**: BLE operates in crowded 2.4 GHz spectrum.

**Sources of Interference**:
- WiFi (especially channels 1, 6, 11)
- Bluetooth Classic
- Microwaves
- Other BLE devices
- Zigbee, Thread

**Impact**:
- Slower connection establishment
- Packet loss during transfer
- Reduced range
- Connection drops

**Mitigation**:
- Use BLE's frequency hopping (automatic)
- Implement retry logic
- Show warning in crowded environments
- Use error correction in chunking protocol

---

### 14. Battery Drain

**Limitation**: Continuous BLE usage drains battery.

**Drain Rates**:
- **Advertising (merchant)**: ~3-5% per hour
- **Scanning (customer)**: ~5-8% per hour
- **Connected idle**: ~1-2% per hour
- **Active transfer**: ~2-3% per transaction

**Workaround**:
```typescript
// Monitor battery level
import { Battery } from 'react-native-battery';

async function checkBatteryBeforeAdvertising() {
  const batteryLevel = await Battery.getBatteryLevel();

  if (batteryLevel < 0.2) { // Less than 20%
    Alert.alert(
      'Low Battery',
      'BLE payments may drain your battery. Consider charging your device.',
      [
        { text: 'Continue Anyway', onPress: startAdvertising },
        { text: 'Cancel', style: 'cancel' }
      ]
    );
  } else {
    startAdvertising();
  }
}

// Auto-stop on low battery
Battery.addListener(info => {
  if (info.batteryLevel < 0.1 && bleService.isAdvertisingActive()) {
    bleService.stopAdvertising();
    showLowBatteryWarning();
  }
});
```

**Mitigation**:
- Limit advertising duration
- Stop advertising when not needed
- Show battery warning
- Use BALANCED advertising mode when not busy

---

## Summary of Workarounds

| Limitation | Severity | Workaround | Status |
|------------|----------|------------|--------|
| iOS Background | Medium | Keep app in foreground | Documented |
| Android Peripheral Support | High | Check support + QR fallback | Implemented |
| MTU Negotiation | Low | Chunking handles any MTU | Implemented |
| Max Bundle Size | Medium | Validate size + compression (future) | Implemented |
| Transfer Speed | Medium | Progress indicator + optimization | Implemented |
| Limited Range | Low | User guidance + proximity warning | Documented |
| Connection Limit | Low | Queue system + quick disconnect | Recommended |
| No BLE Encryption | Low | Application-layer validation | Implemented |
| Advertisement Interception | Low | Merchant verification | Recommended |
| Name Length | Low | Name truncation | Implemented |
| No MAC Address | Low | Use pubkey identifiers | Implemented |
| Emulator Support | Medium | Mock implementation + real device testing | Implemented |
| Interference | Low | Automatic frequency hopping + retries | Implemented |
| Battery Drain | Medium | Monitor battery + auto-stop | Recommended |

---

## Recommendations for Production

1. **Always provide QR code fallback** for devices without peripheral support
2. **Implement battery monitoring** and warn users about drain
3. **Test on real devices** across different manufacturers
4. **Monitor transfer success rates** and optimize based on data
5. **Keep bundles minimal** to ensure fast transfers
6. **Educate users** about range and proximity requirements
7. **Implement robust error handling** for all failure scenarios
8. **Use analytics** to track BLE success rates vs QR code usage

---

## Future Improvements

### Short Term (v1.1)
- [ ] Bundle compression to reduce transfer time
- [ ] Battery optimization modes
- [ ] Enhanced error recovery

### Medium Term (v1.5)
- [ ] Adaptive MTU optimization
- [ ] Connection quality monitoring
- [ ] Automatic fallback to QR codes

### Long Term (v2.0)
- [ ] BLE Mesh for multi-hop transfers
- [ ] Extended range mode (BLE 5.0)
- [ ] Application-layer encryption
- [ ] P2P bundle synchronization

---

**Last Updated**: 2025-10-18
**Version**: 1.0
