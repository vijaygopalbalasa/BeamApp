# BLE Peripheral Integration Checklist

## Pre-Integration

- [x] Review BLE Protocol Specification
- [x] Review Usage Guide
- [x] Review Known Limitations
- [ ] Understand your use case (merchant-only, customer-only, or both)
- [ ] Identify target devices and OS versions
- [ ] Plan QR code fallback strategy

---

## Android Setup

### 1. Native Module

- [x] BLEPeripheralModule.kt created
- [x] BLEPeripheralPackage.kt created
- [x] Package registered in MainApplication.kt

### 2. Permissions

- [ ] Add permissions to AndroidManifest.xml:
  ```xml
  <uses-permission android:name="android.permission.BLUETOOTH" />
  <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" />
  <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
  <uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
  <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
  <uses-permission android:name="android.permission.BLUETOOTH_ADVERTISE" />
  ```

- [ ] Request permissions at runtime (handled by BLEService)

### 3. Build Configuration

- [ ] Ensure minSdkVersion >= 21 (Android 5.0)
- [ ] Test on physical device (not emulator)

---

## iOS Setup

### 1. Native Module

- [x] BLEPeripheralModule.swift created
- [x] BLEPeripheralModuleBridge.m created

### 2. Project Configuration

- [ ] Add Swift Bridging Header (if needed)
- [ ] Add BLEPeripheralModule.swift to Xcode project
- [ ] Add BLEPeripheralModuleBridge.m to Xcode project

### 3. Permissions

- [ ] Add to Info.plist:
  ```xml
  <key>NSBluetoothAlwaysUsageDescription</key>
  <string>Beam uses Bluetooth to enable offline payments</string>
  <key>NSBluetoothPeripheralUsageDescription</key>
  <string>Beam uses Bluetooth to accept payments from customers</string>
  ```

### 4. Background Modes

- [ ] Add bluetooth-peripheral to UIBackgroundModes:
  ```xml
  <key>UIBackgroundModes</key>
  <array>
    <string>bluetooth-peripheral</string>
  </array>
  ```

### 5. Build Configuration

- [ ] Ensure iOS deployment target >= 10.0
- [ ] Test on physical device (not simulator)

---

## TypeScript Integration

### 1. Import Services

```typescript
// For merchant mode
import { bleService } from '../services/BLEService';
import { blePeripheralService } from '../services/BLEPeripheralService';

// For customer mode
import { bleService } from '../services/BLEService';
```

### 2. Merchant Mode Implementation

- [ ] Implement startAdvertising flow
- [ ] Implement listenForPayments callback
- [ ] Implement bundle validation
- [ ] Implement bundle signing
- [ ] Implement bundle storage
- [ ] Handle connection events
- [ ] Handle errors gracefully
- [ ] Add UI indicators (advertising status, connected customers)

**Example**:
```typescript
// Start merchant mode
await bleService.startAdvertising(
  merchantPubkey,
  merchantName,
  paymentRequest
);

// Listen for payments
const unsubscribe = await bleService.listenForPayments(async (bundle) => {
  // Validate
  if (!validateBundle(bundle)) {
    throw new Error('Invalid bundle');
  }

  // Sign
  const signed = await signBundle(bundle);

  // Store
  await storeBundle(signed);

  return signed;
});
```

### 3. Customer Mode Implementation

- [ ] Implement merchant scanning
- [ ] Implement merchant selection UI
- [ ] Implement payment bundle creation
- [ ] Implement bundle sending
- [ ] Handle signed bundle response
- [ ] Store bundles for settlement
- [ ] Handle errors gracefully
- [ ] Add UI indicators (scanning, connecting, transferring)

**Example**:
```typescript
// Scan for merchants
const merchants = [];
await bleService.scanForMerchants((device, request) => {
  merchants.push({ device, request });
}, 15000);

// Pay merchant
const bundle = await createBundle(merchant);
const signed = await bleService.sendPaymentBundle(merchant.device, bundle);
await storeBundle(signed);
```

---

## Testing Checklist

### Unit Tests

- [ ] BLEPeripheralService unit tests
  - [ ] startAdvertising
  - [ ] stopAdvertising
  - [ ] updatePaymentRequest
  - [ ] sendResponseBundle
  - [ ] getConnectedDevices
  - [ ] Event listeners

- [ ] BLEService integration tests
  - [ ] Merchant mode methods
  - [ ] Customer mode methods
  - [ ] Error handling

### Integration Tests

- [ ] Android-to-Android payment flow
- [ ] iOS-to-iOS payment flow
- [ ] Android-to-iOS payment flow
- [ ] iOS-to-Android payment flow

### Manual Testing

- [ ] **Discovery**:
  - [ ] Merchant starts advertising
  - [ ] Customer scans and finds merchant
  - [ ] Correct merchant info displayed

- [ ] **Connection**:
  - [ ] Customer connects to merchant
  - [ ] MTU negotiation succeeds
  - [ ] Connection state events fire correctly

- [ ] **Payment**:
  - [ ] Small bundle (< 1KB) transfers successfully
  - [ ] Large bundle (> 10KB) transfers successfully
  - [ ] Chunking protocol works correctly
  - [ ] Signed bundle returned to customer

- [ ] **Multiple Connections** (Merchant):
  - [ ] Can handle 2 simultaneous customers
  - [ ] Can handle 5 simultaneous customers
  - [ ] Each customer gets correct response

- [ ] **Error Handling**:
  - [ ] Connection timeout handled
  - [ ] Invalid bundle rejected
  - [ ] Connection loss during transfer recovered
  - [ ] Bluetooth disabled error shown
  - [ ] Permissions denied error shown

- [ ] **Range Testing**:
  - [ ] Works at 1 meter
  - [ ] Works at 5 meters
  - [ ] Works at 10 meters
  - [ ] Fails gracefully beyond range

- [ ] **Performance**:
  - [ ] 1KB bundle transfers in < 2 seconds
  - [ ] 10KB bundle transfers in < 5 seconds
  - [ ] Discovery time < 5 seconds

- [ ] **Battery**:
  - [ ] Advertising for 1 hour uses < 5% battery
  - [ ] Single transaction uses < 0.1% battery

---

## UI/UX Checklist

### Merchant Screen

- [ ] Toggle to start/stop advertising
- [ ] Display advertising status
- [ ] Display connected customers count
- [ ] List connected customers
- [ ] Display payment requests received
- [ ] Show payment amount updating in real-time
- [ ] Display confirmation when payment received
- [ ] Handle errors with user-friendly messages

### Customer Screen

- [ ] Button to scan for merchants
- [ ] Scanning indicator
- [ ] List discovered merchants with:
  - [ ] Merchant name
  - [ ] Payment amount
  - [ ] Description
  - [ ] Distance indicator (if available)
- [ ] Payment confirmation screen
- [ ] Transfer progress indicator
- [ ] Success confirmation
- [ ] Error messages

### Settings Screen

- [ ] Toggle for BLE vs QR code preference
- [ ] View BLE status (enabled/disabled)
- [ ] Request Bluetooth permissions
- [ ] View connection diagnostics
- [ ] Clear BLE cache (if needed)

---

## Error Handling Checklist

- [ ] **Bluetooth Not Enabled**:
  - [ ] Detect condition
  - [ ] Show user-friendly message
  - [ ] Provide link to enable Bluetooth
  - [ ] Retry after enabling

- [ ] **Permissions Denied**:
  - [ ] Detect condition
  - [ ] Show explanation why permissions needed
  - [ ] Provide link to app settings
  - [ ] Gracefully degrade to QR code

- [ ] **Peripheral Mode Not Supported** (Android):
  - [ ] Detect at startup
  - [ ] Show one-time notification
  - [ ] Default to QR code mode
  - [ ] Hide merchant mode UI elements

- [ ] **Connection Timeout**:
  - [ ] Detect timeout
  - [ ] Show retry option
  - [ ] Implement exponential backoff
  - [ ] Fall back to QR code after 3 retries

- [ ] **Invalid Bundle**:
  - [ ] Validate bundle before sending
  - [ ] Validate bundle after receiving
  - [ ] Show specific error (signature, timestamp, etc.)
  - [ ] Allow retry with corrected bundle

- [ ] **Bundle Too Large**:
  - [ ] Validate size before transfer
  - [ ] Show size limit to user
  - [ ] Suggest reducing data
  - [ ] Fall back to QR code

---

## Performance Optimization Checklist

- [ ] **MTU Negotiation**:
  - [ ] Always request maximum MTU (512)
  - [ ] Handle any MTU size gracefully
  - [ ] Log actual MTU for analytics

- [ ] **Bundle Optimization**:
  - [ ] Remove unnecessary whitespace from JSON
  - [ ] Minimize metadata
  - [ ] Consider compression for large bundles (future)

- [ ] **Connection Management**:
  - [ ] Disconnect immediately after payment
  - [ ] Don't maintain persistent connections
  - [ ] Clean up resources on disconnect

- [ ] **Battery Optimization**:
  - [ ] Stop advertising when not needed
  - [ ] Limit scan duration
  - [ ] Use appropriate advertising mode
  - [ ] Monitor battery level

- [ ] **UI Optimization**:
  - [ ] Show progress for transfers > 2 seconds
  - [ ] Debounce scan button
  - [ ] Cache discovered merchants briefly
  - [ ] Use optimistic UI updates

---

## Security Checklist

- [ ] **Bundle Validation**:
  - [ ] Verify all signatures
  - [ ] Check timestamp (max age: 5 minutes)
  - [ ] Verify nonce uniqueness
  - [ ] Validate merchant public key
  - [ ] Validate transaction amounts

- [ ] **Merchant Verification**:
  - [ ] Check merchant against known list (optional)
  - [ ] Display merchant reputation (if available)
  - [ ] Allow user to verify merchant identity

- [ ] **Device Attestation**:
  - [ ] Include attestation in bundle
  - [ ] Verify attestation on receive
  - [ ] Check device integrity
  - [ ] Warn if attestation fails (optional)

- [ ] **Data Privacy**:
  - [ ] Never transmit private keys
  - [ ] Only transmit public data
  - [ ] Clear sensitive data from memory
  - [ ] Implement secure bundle storage

---

## Analytics & Monitoring Checklist

- [ ] Track BLE availability rate
- [ ] Track merchant advertising success rate
- [ ] Track customer scanning success rate
- [ ] Track connection success rate
- [ ] Track payment completion rate
- [ ] Track average transfer time
- [ ] Track MTU distribution
- [ ] Track error frequency by type
- [ ] Track BLE vs QR code usage ratio
- [ ] Track battery impact

**Example**:
```typescript
analytics.track('ble_payment_completed', {
  role: 'merchant',
  bundleSize: bundle.length,
  transferTime: duration,
  mtu: actualMtu,
  connections: connectedDevices.length
});
```

---

## Documentation Checklist

- [x] BLE Protocol Specification
- [x] BLE Usage Guide
- [x] Known Limitations
- [x] Implementation Summary
- [x] Integration Checklist
- [ ] API Reference (if needed)
- [ ] Troubleshooting Guide (extend as needed)
- [ ] Video tutorials (optional)
- [ ] User-facing help docs

---

## Deployment Checklist

### Pre-Deployment

- [ ] All tests passing
- [ ] Tested on multiple devices
  - [ ] Android (multiple manufacturers)
  - [ ] iOS (multiple models)
  - [ ] Various OS versions
- [ ] Performance benchmarks met
- [ ] Battery impact acceptable
- [ ] Error handling comprehensive
- [ ] Analytics implemented
- [ ] Documentation complete

### Deployment

- [ ] Feature flag for BLE (optional)
- [ ] Gradual rollout plan
- [ ] Monitoring dashboard ready
- [ ] Support team trained
- [ ] Rollback plan prepared

### Post-Deployment

- [ ] Monitor error rates
- [ ] Monitor success rates
- [ ] Monitor battery complaints
- [ ] Collect user feedback
- [ ] Optimize based on data
- [ ] Document known issues
- [ ] Plan improvements

---

## Maintenance Checklist

### Weekly

- [ ] Review error logs
- [ ] Check success rate metrics
- [ ] Monitor user feedback

### Monthly

- [ ] Review analytics trends
- [ ] Plan optimizations
- [ ] Update documentation if needed
- [ ] Test on new devices/OS versions

### Quarterly

- [ ] Performance audit
- [ ] Security audit
- [ ] User satisfaction survey
- [ ] Plan major improvements

---

## Support Resources

- **Code**: `/src/services/BLEPeripheralService.ts`, `/src/services/BLEService.ts`
- **Native**: `/android/app/src/main/java/com/beam/app/bridge/BLEPeripheralModule.kt`
- **Native**: `/ios/BeamApp/BLEPeripheralModule.swift`
- **Docs**: `/docs/BLE_*.md`
- **Tests**: `/tests/ble/` (to be created)

---

## Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| Module not found | Check native module registration |
| Permissions denied | Check manifest/plist and runtime requests |
| Advertising fails | Check device support, Bluetooth enabled |
| Slow transfers | Check MTU, reduce bundle size |
| Connection drops | Reduce distance, retry logic |
| Emulator doesn't work | Use real device for BLE testing |

---

**Status**: Ready for Integration
**Last Updated**: 2025-10-18
**Version**: 1.0
