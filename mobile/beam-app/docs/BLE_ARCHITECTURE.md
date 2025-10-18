# BLE Peripheral Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         BEAM BLE ARCHITECTURE                            │
└─────────────────────────────────────────────────────────────────────────┘

                        ┌──────────────────────┐
                        │   React Native UI    │
                        │  (Merchant/Customer) │
                        └──────────┬───────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │                             │
         ┌──────────▼──────────┐       ┌─────────▼──────────┐
         │   BLEService.ts     │       │  Other Services    │
         │  (Unified API)      │       │  (Settlement, etc) │
         └──────────┬──────────┘       └────────────────────┘
                    │
         ┌──────────┴─────────────────────────┐
         │                                    │
┌────────▼────────────┐            ┌─────────▼──────────────┐
│ BLEPeripheralService│            │   react-native-ble-plx │
│   (TypeScript)      │            │   (Central Mode Only)  │
└────────┬────────────┘            └────────────────────────┘
         │
         │ Native Bridge
         │
┌────────▼────────────────────────────────────────────────────┐
│                      Native Layer                           │
├─────────────────────────┬───────────────────────────────────┤
│      ANDROID            │           iOS                     │
│                         │                                   │
│ BLEPeripheralModule.kt  │  BLEPeripheralModule.swift        │
│ ┌───────────────────┐   │  ┌──────────────────────┐         │
│ │ BluetoothManager  │   │  │ CBPeripheralManager  │         │
│ │ GATT Server       │   │  │ GATT Service         │         │
│ │ LE Advertiser     │   │  │ Advertising          │         │
│ │ Connection Mgmt   │   │  │ Connection Handling  │         │
│ └───────────────────┘   │  └──────────────────────┘         │
└─────────────────────────┴───────────────────────────────────┘
                            │
                            │ BLE Protocol
                            │
           ┌────────────────▼──────────────────┐
           │       Bluetooth Hardware          │
           │     (BLE 4.0+ / 4.2+ / 5.0)      │
           └───────────────────────────────────┘
```

---

## Component Responsibilities

### UI Layer (React Native)

**Merchant Screen**:
- Start/stop advertising button
- Display connected customers
- Show payment requests
- Handle payment confirmations

**Customer Screen**:
- Scan for merchants button
- Display discovered merchants
- Payment confirmation
- Transfer progress

### Service Layer (TypeScript)

**BLEService** - Unified API:
```typescript
// Merchant Mode
startAdvertising(pubkey, name, request)
stopAdvertising()
listenForPayments(callback)
updatePaymentRequest(request)
getConnectedDevices()

// Customer Mode
scanForMerchants(callback, timeout)
sendPaymentBundle(device, bundle)
```

**BLEPeripheralService** - Peripheral Specific:
```typescript
// Core Methods
startAdvertising(config)
stopAdvertising()
sendResponseBundle(address, bundle)
getConnectedDevices()
disconnectDevice(address)

// Event Listeners
onBundleReceived(callback)
onDeviceConnected(callback)
onDeviceDisconnected(callback)
onMtuChanged(callback)
onAdvertisingStateChanged(callback)
```

### Native Layer

**Android - BLEPeripheralModule.kt**:
- BluetoothManager for BLE access
- BluetoothLeAdvertiser for advertising
- BluetoothGattServer for GATT service
- Connection tracking per device
- MTU negotiation
- Chunking protocol implementation

**iOS - BLEPeripheralModule.swift**:
- CBPeripheralManager for peripheral mode
- CBMutableService for GATT service
- CBMutableCharacteristic × 5
- Connection state management
- Event emission to JavaScript
- Chunking protocol implementation

---

## Data Flow - Payment Transaction

### Merchant Advertising

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. MERCHANT STARTS ADVERTISING                                  │
└─────────────────────────────────────────────────────────────────┘

React Native UI
    │
    │ bleService.startAdvertising(pubkey, name, request)
    ▼
BLEService.ts
    │
    │ blePeripheralService.startAdvertising(config)
    ▼
BLEPeripheralService.ts
    │
    │ NativeModules.BLEPeripheralModule.startAdvertising(config)
    ▼
Native Module (Android/iOS)
    │
    ├─ Create GATT Server
    │  ├─ Payment Request Characteristic (Read, Notify)
    │  ├─ Bundle Write Characteristic (Write, Notify)
    │  ├─ Bundle Response Characteristic (Notify)
    │  ├─ Chunk Control Characteristic (Write, Notify)
    │  └─ Connection State Characteristic (Read, Notify)
    │
    ├─ Start BLE Advertising
    │  ├─ Service UUID: 00006265-...
    │  ├─ Device Name: "Beam-{MerchantName}"
    │  └─ Service Data: merchant public key
    │
    └─ Listen for connections

┌─────────────────────────────────────────────────────────────────┐
│ 2. CUSTOMER DISCOVERS MERCHANT                                  │
└─────────────────────────────────────────────────────────────────┘

Customer Device
    │
    │ bleService.scanForMerchants(callback, timeout)
    ▼
react-native-ble-plx (BleManager)
    │
    │ startDeviceScan([serviceUUID])
    ▼
Bluetooth Hardware
    │
    │ Scans for BLE devices with Service UUID
    ▼
    │ Found: "Beam-CoffeeShop"
    │ Service Data: merchantPubkey
    │
    └─▶ callback(device, paymentRequest)

┌─────────────────────────────────────────────────────────────────┐
│ 3. CUSTOMER CONNECTS AND SENDS PAYMENT                          │
└─────────────────────────────────────────────────────────────────┘

Customer Device
    │
    │ bleService.sendPaymentBundle(device, bundle)
    ▼
BLEService.ts
    │
    │ device.connect()
    │ device.discoverAllServicesAndCharacteristics()
    │ device.requestMTU(512)
    ▼
    │ Create OfflineBundle (partial signature)
    │
    ├─ If bundle.size < MTU:
    │  └─ device.writeCharacteristic(BUNDLE_WRITE, bundle)
    │
    └─ If bundle.size >= MTU:
       └─ Chunking Protocol:
          ├─ Write CHUNK_CONTROL: START_TRANSFER [size]
          ├─ Write CHUNK_CONTROL: CHUNK_DATA [chunk1]
          ├─ Write CHUNK_CONTROL: CHUNK_DATA [chunk2]
          └─ Write CHUNK_CONTROL: END_TRANSFER

┌─────────────────────────────────────────────────────────────────┐
│ 4. MERCHANT RECEIVES AND PROCESSES PAYMENT                      │
└─────────────────────────────────────────────────────────────────┘

Merchant Native Module
    │
    │ onCharacteristicWriteRequest(BUNDLE_WRITE)
    │ or onChunkControl(chunks...)
    ▼
    │ Reassemble bundle from chunks
    │
    │ Emit event: "onBundleReceived"
    ▼
BLEPeripheralService.ts
    │
    │ bundleReceivedListeners.forEach(listener)
    ▼
BLEService.ts
    │
    │ listenForPayments callback
    ▼
React Native - User Code
    │
    ├─ Validate bundle
    │  ├─ Verify signatures
    │  ├─ Check timestamp
    │  └─ Verify merchant pubkey
    │
    ├─ Sign bundle with merchant key
    │
    ├─ Save to storage
    │
    └─ Return signed bundle

┌─────────────────────────────────────────────────────────────────┐
│ 5. MERCHANT SENDS SIGNED BUNDLE BACK                            │
└─────────────────────────────────────────────────────────────────┘

React Native - User Code
    │
    │ Return signedBundle from callback
    ▼
BLEService.ts
    │
    │ blePeripheralService.sendResponseBundle(address, signedBundle)
    ▼
BLEPeripheralService.ts
    │
    │ NativeModules.sendResponseBundle(address, bundleJson)
    ▼
Native Module
    │
    ├─ If bundle.size < MTU:
    │  └─ notify BUNDLE_RESPONSE characteristic
    │
    └─ If bundle.size >= MTU:
       └─ Chunking Protocol via CHUNK_CONTROL

┌─────────────────────────────────────────────────────────────────┐
│ 6. CUSTOMER RECEIVES SIGNED BUNDLE                              │
└─────────────────────────────────────────────────────────────────┘

Customer Device
    │
    │ readCharacteristic(BUNDLE_RESPONSE)
    │ or listen for CHUNK_CONTROL notifications
    ▼
    │ Reassemble bundle from chunks
    │
    │ Parse signedBundle JSON
    │
    ├─ Validate merchant signature
    ├─ Save to storage
    └─ Disconnect
```

---

## Chunking Protocol Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    CHUNKING PROTOCOL                            │
└─────────────────────────────────────────────────────────────────┘

Sender (Customer/Merchant)           Receiver (Merchant/Customer)
    │                                           │
    │  1. Detect bundle > MTU                   │
    │                                           │
    │  2. START_TRANSFER                        │
    │  ─────────────────────────────────────▶   │
    │     [0x01 | size: 4 bytes]                │
    │                                           │
    │                                           │  3. Create buffer
    │                                           │     Store total size
    │                                           │
    │  4. ACK                                   │
    │   ◀─────────────────────────────────────  │
    │     [0x04]                                │
    │                                           │
    │  5. CHUNK_DATA (chunk 1)                  │
    │  ─────────────────────────────────────▶   │
    │     [0x02 | data: N bytes]                │
    │                                           │
    │                                           │  6. Append to buffer
    │                                           │
    │  7. CHUNK_DATA (chunk 2)                  │
    │  ─────────────────────────────────────▶   │
    │     [0x02 | data: N bytes]                │
    │                                           │
    │         ...more chunks...                 │
    │                                           │
    │  8. CHUNK_DATA (chunk n)                  │
    │  ─────────────────────────────────────▶   │
    │     [0x02 | data: N bytes]                │
    │                                           │
    │                                           │  9. All chunks received
    │                                           │
    │  10. END_TRANSFER                         │
    │  ─────────────────────────────────────▶   │
    │     [0x03]                                │
    │                                           │
    │                                           │  11. Reassemble
    │                                           │      Validate size
    │                                           │      Parse JSON
    │                                           │
    │  12. ACK                                  │
    │   ◀─────────────────────────────────────  │
    │     [0x04]                                │
    │                                           │
    │  13. Transfer complete                    │  14. Process bundle
```

**Error Handling**:
```
Timeout (no chunk within 10s):
    Receiver → Sender: ERROR [0x05 | 0x10]
    Discard partial data

Size Mismatch:
    Receiver → Sender: ERROR [0x05 | 0x11]
    Discard partial data

Invalid Format:
    Receiver → Sender: ERROR [0x05 | 0x12]
    Discard data
```

---

## Connection State Machine

```
┌─────────────────────────────────────────────────────────────────┐
│              CONNECTION STATE MACHINE                           │
└─────────────────────────────────────────────────────────────────┘

    ┌─────────┐
    │  IDLE   │  Initial state
    │  (0x00) │
    └────┬────┘
         │
         │ Device Connected
         │ MTU Negotiated
         │
         ▼
    ┌─────────┐
    │  READY  │  Ready to receive/send
    │  (0x01) │
    └────┬────┘
         │
         ├─────────────────┬───────────────┐
         │                 │               │
         │ Receiving       │ Processing    │ Responding
         │ bundle          │ payment       │ with signed bundle
         │                 │               │
         ▼                 ▼               ▼
    ┌─────────┐      ┌─────────┐     ┌─────────┐
    │RECEIVING│      │PROCESSING│    │RESPONDING│
    │  (0x02) │      │  (0x03)  │    │  (0x04)  │
    └────┬────┘      └────┬─────┘    └────┬─────┘
         │                 │               │
         │ Complete        │ Signed        │ Sent
         │                 │               │
         └────────┬────────┴───────────────┘
                  │
                  │ Ready for next transaction
                  │
                  ▼
             ┌─────────┐
             │  READY  │
             │  (0x01) │
             └────┬────┘
                  │
                  │ Disconnect
                  │
                  ▼
             ┌─────────┐
             │  IDLE   │
             │  (0x00) │
             └─────────┘
```

---

## Multi-Connection Architecture (Merchant)

```
┌─────────────────────────────────────────────────────────────────┐
│         MERCHANT SERVING MULTIPLE CUSTOMERS                     │
└─────────────────────────────────────────────────────────────────┘

                    ┌──────────────────┐
                    │  Merchant Device │
                    │  (BLE Peripheral)│
                    └────────┬─────────┘
                             │
                   ┌─────────┴─────────┐
                   │  GATT Server      │
                   │  (Shared Service) │
                   └─────────┬─────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
  ┌──────────┐         ┌──────────┐        ┌──────────┐
  │Connection│         │Connection│        │Connection│
  │   #1     │         │   #2     │        │   #3     │
  │ State: 2 │         │ State: 1 │        │ State: 3 │
  │ MTU: 512 │         │ MTU: 185 │        │ MTU: 512 │
  └────┬─────┘         └────┬─────┘        └────┬─────┘
       │                    │                    │
       │                    │                    │
       ▼                    ▼                    ▼
  ┌──────────┐         ┌──────────┐        ┌──────────┐
  │ Customer │         │ Customer │        │ Customer │
  │    A     │         │    B     │        │    C     │
  └──────────┘         └──────────┘        └──────────┘
  Sending bundle       Idle/Ready          Processing

Each connection has:
  • Unique device address
  • Independent state machine
  • Separate MTU
  • Isolated chunk buffers
  • Independent data streams
```

**Connection Management**:
```typescript
connectedDevices: Map<string, DeviceConnection> {
  "DEVICE-A-UUID": {
    device: BluetoothDevice,
    state: RECEIVING (0x02),
    notificationsEnabled: true
  },
  "DEVICE-B-UUID": {
    device: BluetoothDevice,
    state: READY (0x01),
    notificationsEnabled: true
  },
  "DEVICE-C-UUID": {
    device: BluetoothDevice,
    state: PROCESSING (0x03),
    notificationsEnabled: true
  }
}

deviceMtuSizes: Map<string, number> {
  "DEVICE-A-UUID": 512,
  "DEVICE-B-UUID": 185,
  "DEVICE-C-UUID": 512
}

incomingChunks: Map<string, ChunkBuffer> {
  "DEVICE-A-UUID": {
    totalSize: 5120,
    receivedSize: 3072,
    chunks: [chunk1, chunk2, chunk3, ...]
  }
}
```

---

## Security Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    SECURITY LAYERS                              │
└─────────────────────────────────────────────────────────────────┘

Layer 1: BLE Transport
    • No encryption (public data only)
    • No pairing required
    • Eavesdropping possible but data is public anyway

    └──▶ Advertised: Merchant pubkey, service UUID, device name
    └──▶ Transmitted: Bundles with signatures, attestations

Layer 2: Application Protocol
    • All data signed with private keys
    • Signatures verified on both ends
    • Timestamps prevent replay attacks
    • Nonces ensure uniqueness

    └──▶ Bundle Validation:
         ├─ Verify payer signature
         ├─ Verify merchant signature (on response)
         ├─ Check timestamp (max age: 5 minutes)
         ├─ Verify nonce uniqueness
         └─ Validate transaction data

Layer 3: Device Attestation (Optional)
    • Hardware-backed attestation
    • Device integrity verification
    • Prevents rooted/jailbroken devices

    └──▶ Attestation Envelope:
         ├─ Bundle ID
         ├─ Timestamp
         ├─ Nonce
         ├─ Attestation Report (hardware-signed)
         ├─ Signature
         └─ Certificate Chain

Layer 4: Blockchain Settlement
    • Final settlement on Solana
    • Transaction immutability
    • Public ledger verification

    └──▶ On-chain validation occurs when online
```

**Security Flow**:
```
Customer creates bundle
    ├─ Generate nonce
    ├─ Add timestamp
    ├─ Sign with customer private key
    └─ Include device attestation
         │
         ▼
    Send via BLE (unsigned by merchant)
         │
         ▼
Merchant receives and validates
    ├─ Verify customer signature ✓
    ├─ Check timestamp ✓
    ├─ Verify nonce ✓
    ├─ Validate attestation ✓
    └─ Check transaction data ✓
         │
         ▼
Merchant signs bundle
    ├─ Add merchant signature
    ├─ Add merchant attestation
    └─ Return signed bundle
         │
         ▼
Customer validates response
    ├─ Verify merchant signature ✓
    └─ Store for settlement
         │
         ▼
Later: Settle on-chain
```

---

## Error Handling Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                  ERROR HANDLING LAYERS                          │
└─────────────────────────────────────────────────────────────────┘

UI Layer (React Native)
    │
    ├─ User-friendly error messages
    ├─ Retry buttons
    ├─ Fallback to QR codes
    └─ Loading states
         │
         ▼
Service Layer (TypeScript)
    │
    ├─ Try/catch around all async operations
    ├─ Error logging
    ├─ Analytics tracking
    └─ Graceful degradation
         │
         ▼
Native Layer (Android/iOS)
    │
    ├─ BLE state validation
    ├─ Permission checking
    ├─ Connection timeout handling
    ├─ Chunk timeout monitoring
    └─ Resource cleanup on errors
         │
         ▼
BLE Hardware
    │
    └─ Connection failures
    └─ Range issues
    └─ Interference
```

**Error Recovery Strategies**:
```
Connection Timeout:
    Retry → 1st: 2s delay
         → 2nd: 4s delay
         → 3rd: 8s delay
         → Give up: Show QR code option

Chunk Timeout:
    Abort transfer
    Clear buffers
    Notify error
    Allow retry from start

Invalid Bundle:
    Reject immediately
    Send error response
    Log for analysis
    Don't save

Bluetooth Disabled:
    Detect immediately
    Show enable prompt
    Wait for enable
    Auto-resume when ready
```

---

## Performance Optimization

```
┌─────────────────────────────────────────────────────────────────┐
│              PERFORMANCE OPTIMIZATIONS                          │
└─────────────────────────────────────────────────────────────────┘

1. MTU Negotiation
   ├─ Request 512 bytes immediately on connect
   ├─ Fall back to default if negotiation fails
   └─ Cache MTU per device

2. Chunk Size Optimization
   ├─ Use (MTU - 3) as chunk size
   ├─ Minimize overhead
   └─ Maximize throughput

3. Connection Management
   ├─ Disconnect immediately after transfer
   ├─ Don't maintain idle connections
   └─ Clean up resources promptly

4. Data Optimization
   ├─ Minimize JSON whitespace
   ├─ Remove optional fields when possible
   ├─ Future: Compression for large bundles

5. Battery Optimization
   ├─ Use appropriate advertising mode
   │  ├─ LOW_LATENCY when actively accepting payments
   │  └─ BALANCED when idle
   ├─ Limit scan duration (15s max)
   └─ Stop advertising when not needed

6. UI Responsiveness
   ├─ All BLE operations async
   ├─ Progress indicators for long operations
   ├─ Optimistic UI updates
   └─ Debounce user actions
```

---

**Version**: 1.0
**Last Updated**: 2025-10-18
**Status**: Production Ready
