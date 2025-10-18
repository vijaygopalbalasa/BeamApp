# Beam BLE Protocol Specification v1.0

## Overview

The Beam BLE (Bluetooth Low Energy) Protocol enables secure, offline payment transactions between merchants (BLE peripherals) and customers (BLE centrals). This specification defines the complete protocol for advertising, connection, data exchange, and error handling.

## Architecture

### Role Definitions

- **Merchant (Peripheral)**: Device advertising payment requests and accepting connections
- **Customer (Central)**: Device scanning for merchants and initiating payment transactions

### Design Principles

1. **Offline-First**: All transactions work without internet connectivity
2. **Secure**: End-to-end encryption with device attestation
3. **Reliable**: Chunked data transfer with acknowledgments
4. **Efficient**: Optimized for battery life and connection speed
5. **Scalable**: Support for multiple simultaneous connections

---

## BLE Service and Characteristics

### Primary Service

**Service UUID**: `00006265-0000-1000-8000-00805f9b34fb`

The Beam service is the primary GATT service for all payment-related operations.

### Characteristics

#### 1. Payment Request Characteristic

**UUID**: `000062b0-0000-1000-8000-00805f9b34fb`

- **Properties**: Read, Notify
- **Permissions**: Readable
- **Purpose**: Advertise payment request details to customers
- **Data Format**: JSON

```json
{
  "amount": 1000000,
  "currency": "USDC",
  "description": "Coffee and pastry",
  "metadata": {
    "orderId": "ORD-12345",
    "merchantId": "MERCHANT-ABC"
  }
}
```

**Max Size**: 512 bytes (recommended: < 256 bytes for compatibility)

---

#### 2. Bundle Write Characteristic

**UUID**: `000062b1-0000-1000-8000-00805f9b34fb`

- **Properties**: Write, Write Without Response, Notify
- **Permissions**: Writable
- **Purpose**: Customers write payment bundles to merchants
- **Data Format**: JSON (UTF-8 encoded)

For bundles < MTU size, write directly. For larger bundles, use chunking protocol.

**OfflineBundle Structure**:
```json
{
  "bundleId": "uuid-v4",
  "timestamp": 1234567890,
  "transactions": [
    {
      "from": "base58-pubkey",
      "to": "base58-pubkey",
      "amount": 1000000,
      "mint": "base58-mint-address"
    }
  ],
  "signatures": {
    "payer": "base58-signature",
    "merchant": "base58-signature"
  },
  "attestations": {
    "payer": { ... },
    "merchant": { ... }
  }
}
```

---

#### 3. Bundle Response Characteristic

**UUID**: `000062b2-0000-1000-8000-00805f9b34fb`

- **Properties**: Notify
- **Permissions**: None (notification only)
- **Purpose**: Merchants send signed bundles back to customers
- **Data Format**: JSON (same as Bundle Write)

---

#### 4. Chunk Control Characteristic

**UUID**: `000062b3-0000-1000-8000-00805f9b34fb`

- **Properties**: Write, Notify
- **Permissions**: Writable
- **Purpose**: Manage chunked data transfers for large bundles
- **Data Format**: Binary protocol (see Chunking Protocol section)

---

#### 5. Connection State Characteristic

**UUID**: `000062b4-0000-1000-8000-00805f9b34fb`

- **Properties**: Read, Notify
- **Permissions**: Readable
- **Purpose**: Communicate current connection state
- **Data Format**: Single byte

**State Values**:
- `0x00`: IDLE - Ready for new transaction
- `0x01`: READY - Connected and authenticated
- `0x02`: RECEIVING - Receiving payment bundle
- `0x03`: PROCESSING - Processing payment
- `0x04`: RESPONDING - Sending response bundle

---

## Chunking Protocol

For data transfers exceeding MTU size (typically 23-512 bytes), the chunking protocol is used.

### Control Commands

| Command | Value | Description |
|---------|-------|-------------|
| START_TRANSFER | 0x01 | Begin chunked transfer |
| CHUNK_DATA | 0x02 | Send data chunk |
| END_TRANSFER | 0x03 | Complete transfer |
| ACK | 0x04 | Acknowledge receipt |
| ERROR | 0x05 | Signal error |

### START_TRANSFER Format

```
Byte 0:     0x01 (START_TRANSFER)
Bytes 1-4:  Total size (uint32, big-endian)
```

**Example**: Transfer 2048 bytes
```
01 00 00 08 00
```

### CHUNK_DATA Format

```
Byte 0:     0x02 (CHUNK_DATA)
Bytes 1-N:  Chunk data (up to MTU-3 bytes)
```

### END_TRANSFER Format

```
Byte 0:     0x03 (END_TRANSFER)
```

### ACK Format

```
Byte 0:     0x04 (ACK)
```

### ERROR Format

```
Byte 0:     0x05 (ERROR)
Byte 1:     Error code
Bytes 2-N:  Error message (optional, UTF-8)
```

### Transfer Flow

```
Customer → Merchant: START_TRANSFER [total_size]
Merchant → Customer: ACK

Customer → Merchant: CHUNK_DATA [data_1]
Customer → Merchant: CHUNK_DATA [data_2]
...
Customer → Merchant: CHUNK_DATA [data_n]

Customer → Merchant: END_TRANSFER
Merchant → Customer: ACK (via notification)
```

### Chunk Size Calculation

```typescript
const effectiveMTU = negotiatedMTU - 3; // Account for ATT header
const chunkSize = Math.min(effectiveMTU, MAX_CHUNK_SIZE);
```

**Constants**:
- `MAX_MTU_SIZE`: 512 bytes
- `DEFAULT_MTU_SIZE`: 23 bytes (BLE default)
- `MAX_CHUNK_SIZE`: 509 bytes (MAX_MTU_SIZE - 3)
- `MAX_BUNDLE_SIZE`: 256 KB

---

## Connection Flow

### 1. Discovery Phase

```
Customer scans for BLE peripherals
  ↓
Customer filters by Service UUID (00006265-...)
  ↓
Customer finds merchant advertising "Beam-{MerchantName}"
  ↓
Customer reads advertisement service data (merchant pubkey)
```

### 2. Connection Phase

```
Customer connects to merchant
  ↓
Customer requests MTU negotiation (up to 512 bytes)
  ↓
Customer discovers services and characteristics
  ↓
Customer enables notifications on:
  - Payment Request Characteristic
  - Bundle Response Characteristic
  - Chunk Control Characteristic
  - Connection State Characteristic
```

### 3. Payment Request Phase

```
Customer reads Payment Request Characteristic
  ↓
Customer displays payment details to user
  ↓
User confirms payment
```

### 4. Bundle Exchange Phase

```
Customer creates OfflineBundle (partial signature)
  ↓
Customer writes bundle to Bundle Write Characteristic
  (uses chunking if size > MTU)
  ↓
Merchant receives and validates bundle
  ↓
Merchant adds signature and attestation
  ↓
Merchant notifies signed bundle via Bundle Response Characteristic
  (uses chunking if size > MTU)
  ↓
Customer receives and stores signed bundle
```

### 5. Disconnection Phase

```
Customer sends disconnect request
  ↓
Connection terminated
  ↓
Both devices clean up resources
```

---

## Advertising

### Merchant Advertisement Data

```
Flags: General Discoverable, BR/EDR Not Supported
Service UUIDs: [00006265-0000-1000-8000-00805f9b34fb]
Complete Local Name: "Beam-{MerchantName}"
Service Data:
  UUID: 00006265-0000-1000-8000-00805f9b34fb
  Data: {merchantPubkey} (base58 encoded, 32-44 bytes)
TX Power Level: High
```

### Advertising Parameters

**Android**:
```kotlin
AdvertiseSettings.Builder()
  .setAdvertiseMode(ADVERTISE_MODE_LOW_LATENCY)
  .setConnectable(true)
  .setTimeout(0)  // Advertise indefinitely
  .setTxPowerLevel(ADVERTISE_TX_POWER_HIGH)
  .build()
```

**iOS**:
```swift
advertisementData = [
  CBAdvertisementDataServiceUUIDsKey: [beamServiceUUID],
  CBAdvertisementDataLocalNameKey: "Beam-{merchantName}"
]
```

---

## Error Handling

### Connection Errors

| Error | Code | Handling |
|-------|------|----------|
| Connection Timeout | - | Retry with exponential backoff (2s, 4s, 8s) |
| MTU Negotiation Failed | - | Use default MTU (23 bytes) |
| Service Not Found | - | Disconnect and retry |
| Characteristic Not Found | - | Disconnect and report error |

### Transfer Errors

| Error | Code | Handling |
|-------|------|----------|
| Chunk Timeout | 0x10 | Abort transfer, send ERROR |
| Size Mismatch | 0x11 | Abort transfer, send ERROR |
| Invalid Format | 0x12 | Abort transfer, send ERROR |
| Bundle Too Large | 0x13 | Reject before transfer |

### Recovery Strategies

1. **Connection Lost**:
   - Customer: Retry connection up to 3 times
   - Merchant: Clear connection state after 30s timeout

2. **Incomplete Transfer**:
   - Sender: Retry entire transfer
   - Receiver: Discard partial data after 10s timeout

3. **Invalid Bundle**:
   - Merchant: Send ERROR via Bundle Response
   - Customer: Display error and allow retry

---

## Security Considerations

### 1. Pairing and Bonding

**Not Required**: Beam protocol does not use BLE pairing/bonding. All security is handled at the application layer through:
- Digital signatures
- Device attestation
- Bundle validation

### 2. Eavesdropping Protection

- Bundles contain only public keys and signatures
- Private keys never transmitted over BLE
- Transaction data is signed before transmission

### 3. Replay Attack Prevention

- Each bundle has unique `bundleId` (UUID v4)
- Timestamp validation (reject bundles > 5 minutes old)
- Nonce in attestation prevents replay

### 4. Man-in-the-Middle Protection

- Merchant public key verified against advertisement
- Device attestation validates device integrity
- Customer verifies merchant signature before accepting

---

## Performance Optimization

### MTU Negotiation

Always negotiate MTU to maximum supported value (512 bytes):

```kotlin
// Android
gatt.requestMtu(512)
```

```swift
// iOS - automatic negotiation
// iOS supports up to 512 bytes (iOS 10+)
```

### Connection Parameters

**Android**:
```kotlin
connectionPriority = CONNECTION_PRIORITY_HIGH
```

**iOS**:
```swift
// iOS manages connection parameters automatically
// Prioritize low latency during active transfer
```

### Battery Optimization

1. **Advertising**:
   - Use LOW_LATENCY mode only during active merchant hours
   - Switch to BALANCED mode during idle periods

2. **Scanning**:
   - Limit scan duration to 15-30 seconds
   - Use LOW_LATENCY mode for faster discovery

3. **Connections**:
   - Disconnect immediately after bundle exchange
   - Don't maintain persistent connections

---

## Testing and Validation

### Unit Tests

1. **Chunking Protocol**:
   - Test with various data sizes: 10B, 100B, 1KB, 10KB, 100KB
   - Test MTU sizes: 23, 185, 512 bytes
   - Test error conditions: timeout, size mismatch

2. **Bundle Validation**:
   - Test valid bundles
   - Test invalid signatures
   - Test malformed JSON
   - Test oversized bundles

### Integration Tests

1. **Connection Flow**:
   - Connect → Exchange → Disconnect
   - Test reconnection after disconnect
   - Test multiple simultaneous connections (merchant)

2. **Error Recovery**:
   - Simulate connection loss during transfer
   - Simulate invalid bundle data
   - Simulate timeout conditions

### Performance Tests

1. **Throughput**:
   - Measure transfer time for various bundle sizes
   - Target: < 2 seconds for typical bundle (< 2KB)

2. **Discovery Time**:
   - Measure time from scan start to device found
   - Target: < 5 seconds

3. **Battery Impact**:
   - Measure battery drain during 1-hour advertising session
   - Target: < 5% battery consumption

---

## Implementation Checklist

### Merchant (Peripheral)

- [ ] Initialize BLE peripheral manager
- [ ] Create GATT service with all characteristics
- [ ] Start advertising with correct parameters
- [ ] Handle connection state changes
- [ ] Implement chunking protocol (receive)
- [ ] Validate incoming bundles
- [ ] Sign bundles with merchant key
- [ ] Implement chunking protocol (send)
- [ ] Handle disconnections gracefully
- [ ] Clean up resources on stop

### Customer (Central)

- [ ] Initialize BLE central manager
- [ ] Scan for Beam service UUID
- [ ] Parse advertisement data
- [ ] Connect to merchant
- [ ] Negotiate MTU
- [ ] Discover services and characteristics
- [ ] Enable notifications
- [ ] Read payment request
- [ ] Create and sign bundle
- [ ] Implement chunking protocol (send)
- [ ] Implement chunking protocol (receive)
- [ ] Verify merchant signature
- [ ] Handle disconnections gracefully

---

## Version History

### v1.0 (Current)
- Initial protocol specification
- Support for chunked data transfer
- Device attestation integration
- Multiple simultaneous connections (merchant)

---

## Future Enhancements

### v1.1 (Planned)
- Compression for large bundles (gzip)
- Batch payment support (multiple transactions in one bundle)
- Payment request streaming (merchant can update request in real-time)

### v2.0 (Proposed)
- BLE Mesh support for payment relay networks
- Extended range mode (BLE 5.0 Long Range)
- Encrypted characteristics (BLE-level encryption)

---

## References

- [Bluetooth Core Specification 5.4](https://www.bluetooth.com/specifications/specs/core-specification-5-4/)
- [GATT Specification](https://www.bluetooth.com/specifications/specs/gatt-specification-supplement/)
- [Android BLE Guide](https://developer.android.com/guide/topics/connectivity/bluetooth-le)
- [iOS Core Bluetooth](https://developer.apple.com/documentation/corebluetooth)

---

## Contact

For questions or issues with this specification:
- GitHub Issues: [beam-app/issues](https://github.com/beam-app/issues)
- Email: dev@beam-payments.io

---

**Document Version**: 1.0
**Last Updated**: 2025-10-18
**Status**: Production Ready
