package com.beam.app.bridge

import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.os.Build
import android.os.ParcelUuid
import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONArray
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.experimental.and

/**
 * Native mesh networking bridge for Beam offline payments
 * Implements secure BLE mesh with multi-hop relay and gossip protocol
 */
class MeshNetworkBridge(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "MeshNetworkBridge"
        private const val MODULE_NAME = "MeshNetworkBridge"

        // Beam Protocol UUIDs - MUST MATCH Config.ble.serviceUUID in TypeScript
        private val BEAM_SERVICE_UUID = UUID.fromString("00006265-0000-1000-8000-00805f9b34fb")
        private val PAYMENT_REQUEST_UUID = UUID.fromString("00006265-0001-1000-8000-00805f9b34fb")
        private val PAYMENT_BUNDLE_UUID = UUID.fromString("00006265-0002-1000-8000-00805f9b34fb")
        private val PAYMENT_STATUS_UUID = UUID.fromString("00006265-0003-1000-8000-00805f9b34fb")
        private val MESH_RELAY_UUID = UUID.fromString("00006265-0004-1000-8000-00805f9b34fb")
        // Phase 2.3: ACK/NACK characteristic for delivery confirmation
        private val ACK_NACK_UUID = UUID.fromString("00006265-0005-1000-8000-00805f9b34fb")

        // Protocol constants
        private const val MAX_MTU_SIZE = 512
        private const val MAX_CHUNK_SIZE = MAX_MTU_SIZE - 4 // Reserve 4 bytes for header
        private const val MAX_BUNDLE_SIZE = 256 * 1024 // 256KB
        private const val BUNDLE_TTL_HOURS = 24
        private const val MAX_HOP_COUNT = 5
        private const val GOSSIP_INTERVAL_MS = 30000L // 30 seconds

        // Phase 2.4: Chunk transfer timeouts
        private const val CHUNK_TRANSFER_TIMEOUT_MS = 30000L // 30 seconds total
        private const val CHUNK_IDLE_TIMEOUT_MS = 5000L // 5 seconds since last chunk
    }

    // Bluetooth components
    private var bluetoothManager: BluetoothManager? = null
    private var bluetoothAdapter: BluetoothAdapter? = null
    private var advertiser: BluetoothLeAdvertiser? = null
    private var scanner: BluetoothLeScanner? = null
    private var gattServer: BluetoothGattServer? = null

    // State
    private var isActive = false
    private var nodeType: String = "relay" // "merchant", "customer", or "relay"
    private var myPubkey: String? = null

    // Connected peers
    private val connectedPeers = ConcurrentHashMap<String, BluetoothGatt>() // Only add AFTER services discovered
    private val pendingGattConnections = ConcurrentHashMap<String, BluetoothGatt>() // Temp storage during connection
    private val peerDevices = ConcurrentHashMap<String, BluetoothDevice>()
    private val peerMTUs = ConcurrentHashMap<String, Int>()
    private val servicesDiscovered = ConcurrentHashMap<String, Boolean>()

    // Phase 2.2: Connection retry management
    private val peerConnectionStates = ConcurrentHashMap<String, PeerConnectionState>()
    private val connectionRetryCount = ConcurrentHashMap<String, Int>()
    private val connectionTimeouts = ConcurrentHashMap<String, Long>()
    private val MAX_RETRY_ATTEMPTS = 5
    private val INITIAL_RETRY_DELAY_MS = 1000L
    private val MAX_RETRY_DELAY_MS = 30000L
    private val CONNECTION_TIMEOUT_MS = 15000L

    // Bundle queue and cache
    private val pendingBundles = ConcurrentHashMap<String, BundleMetadata>()
    private val seenBundleHashes = Collections.synchronizedSet(HashSet<String>())

    // Chunked transfer
    private val incomingChunks = ConcurrentHashMap<String, ChunkBuffer>()
    private val outgoingChunks = ConcurrentHashMap<String, ChunkBuffer>()

    // Executor for background tasks
    private val executor = Executors.newScheduledThreadPool(4)

    override fun getName(): String = MODULE_NAME

    init {
        bluetoothManager = reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        bluetoothAdapter = bluetoothManager?.adapter
        advertiser = bluetoothAdapter?.bluetoothLeAdvertiser
        scanner = bluetoothAdapter?.bluetoothLeScanner
    }

    // ==================== React Native Bridge Methods ====================

    @ReactMethod
    fun startMeshNode(config: ReadableMap, promise: Promise) {
        try {
            if (isActive) {
                Log.w(TAG, "❌ Mesh node already active")
                promise.reject("MESH_ERROR", "Mesh node already active")
                return
            }

            // ========== CRITICAL: Bluetooth Adapter Validation ==========
            if (bluetoothAdapter == null) {
                Log.e(TAG, "❌ CRITICAL: Bluetooth adapter is NULL - device doesn't support Bluetooth!")
                promise.reject("MESH_ERROR", "Bluetooth not supported on this device")
                return
            }

            if (!bluetoothAdapter!!.isEnabled) {
                Log.e(TAG, "❌ CRITICAL: Bluetooth is DISABLED - user must enable it in settings!")
                promise.reject("MESH_ERROR", "Bluetooth is disabled. Please enable Bluetooth in Settings.")
                return
            }

            // Check if BLE advertising is supported
            if (!bluetoothAdapter!!.isMultipleAdvertisementSupported) {
                Log.e(TAG, "❌ CRITICAL: BLE Multiple Advertisement NOT supported on this device!")
                promise.reject("MESH_ERROR", "BLE advertising not supported on this device (hardware limitation)")
                return
            }

            if (advertiser == null) {
                Log.e(TAG, "❌ CRITICAL: BLE Advertiser is NULL - may need Bluetooth permissions!")
                Log.e(TAG, "Make sure BLUETOOTH_ADVERTISE permission is granted (Android 12+)")
                promise.reject("MESH_ERROR", "BLE advertising not available - check Bluetooth permissions")
                return
            }

            if (scanner == null) {
                Log.e(TAG, "❌ CRITICAL: BLE Scanner is NULL - device doesn't support BLE scanning!")
                promise.reject("MESH_ERROR", "BLE scanning not supported on this device")
                return
            }

            nodeType = config.getString("nodeType") ?: "relay"
            myPubkey = config.getString("pubkey")

            Log.d(TAG, "========== STARTING MESH NODE ==========")
            Log.d(TAG, "✅ Bluetooth Adapter: ${bluetoothAdapter!!.address}")
            Log.d(TAG, "✅ Bluetooth Enabled: ${bluetoothAdapter!!.isEnabled}")
            Log.d(TAG, "✅ Node Type: $nodeType")
            Log.d(TAG, "✅ Pubkey: $myPubkey")
            Log.d(TAG, "✅ Service UUID: $BEAM_SERVICE_UUID")

            // Start GATT server (for receiving connections)
            Log.d(TAG, "→ Starting GATT server...")
            startGattServer()

            // Start advertising (so others can discover us)
            Log.d(TAG, "→ Starting BLE advertising...")
            startAdvertising()

            // Start scanning (to discover other nodes)
            Log.d(TAG, "→ Starting BLE scanning...")
            startScanning()

            // Start gossip protocol
            Log.d(TAG, "→ Starting gossip protocol...")
            startGossipProtocol()

            // Phase 2.4: Start chunk transfer cleanup task
            Log.d(TAG, "→ Starting chunk transfer cleanup task...")
            startChunkTransferCleanup()

            isActive = true
            Log.d(TAG, "========== MESH NODE STARTED SUCCESSFULLY ==========")

            val result = Arguments.createMap().apply {
                putString("status", "started")
                putString("nodeType", nodeType)
                putString("pubkey", myPubkey)
            }

            promise.resolve(result)
            sendEvent("MeshNodeStarted", result)

        } catch (e: Exception) {
            Log.e(TAG, "❌ FATAL: Failed to start mesh node", e)
            promise.reject("MESH_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun stopMeshNode(promise: Promise) {
        try {
            if (!isActive) {
                Log.w(TAG, "❌ Mesh node not active - nothing to stop")
                promise.reject("MESH_ERROR", "Mesh node not active")
                return
            }

            Log.d(TAG, "========== STOPPING MESH NODE ==========")

            // Stop scanning and advertising
            Log.d(TAG, "→ Stopping BLE scanner...")
            scanner?.stopScan(scanCallback)

            Log.d(TAG, "→ Stopping BLE advertiser...")
            advertiser?.stopAdvertising(advertiseCallback)

            // Disconnect all peers (both connected and pending)
            Log.d(TAG, "→ Disconnecting ${connectedPeers.size} connected peers...")
            connectedPeers.values.forEach { gatt ->
                try {
                    gatt.disconnect()
                    gatt.close()
                } catch (e: Exception) {
                    Log.w(TAG, "  Error disconnecting peer", e)
                }
            }
            connectedPeers.clear()

            Log.d(TAG, "→ Closing ${pendingGattConnections.size} pending connections...")
            pendingGattConnections.values.forEach { gatt ->
                try {
                    gatt.disconnect()
                    gatt.close()
                } catch (e: Exception) {
                    Log.w(TAG, "  Error closing pending connection", e)
                }
            }
            pendingGattConnections.clear()
            servicesDiscovered.clear()

            // Close GATT server
            Log.d(TAG, "→ Closing GATT server...")
            gattServer?.close()
            gattServer = null

            // Phase 2.2: Clear all connection retry state
            Log.d(TAG, "→ Clearing connection retry state...")
            peerConnectionStates.clear()
            connectionRetryCount.clear()
            connectionTimeouts.clear()
            peerDevices.clear()
            peerMTUs.clear()

            isActive = false
            Log.d(TAG, "========== MESH NODE STOPPED ==========")

            val result = Arguments.createMap().apply {
                putString("status", "stopped")
            }

            promise.resolve(result)
            sendEvent("MeshNodeStopped", result)

        } catch (e: Exception) {
            Log.e(TAG, "❌ Failed to stop mesh node", e)
            promise.reject("MESH_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun broadcastBundle(bundleData: ReadableMap, promise: Promise) {
        try {
            val bundleId = bundleData.getString("tx_id")
                ?: return promise.reject("MESH_ERROR", "Bundle missing tx_id")

            Log.d(TAG, "========== BROADCASTING BUNDLE ==========")
            Log.d(TAG, "Bundle ID: $bundleId")
            Log.d(TAG, "Connected Peers (services discovered): ${connectedPeers.size}")
            Log.d(TAG, "Pending Connections (services NOT discovered): ${pendingGattConnections.size}")

            // List all connection states
            peerDevices.forEach { (address, _) ->
                val state = peerConnectionStates[address]
                val discovered = servicesDiscovered[address]
                Log.d(TAG, "  • $address: state=$state, services_discovered=$discovered")
            }

            // Serialize bundle
            val serialized = serializeBundle(bundleData)
            if (serialized.size > MAX_BUNDLE_SIZE) {
                promise.reject("MESH_ERROR", "Bundle too large: ${serialized.size} bytes")
                return
            }

            Log.d(TAG, "Bundle size: ${serialized.size} bytes")

            // Add to pending queue (mark as seen to prevent relay loops)
            val metadata = BundleMetadata(
                bundleId = bundleId,
                data = serialized,
                timestamp = System.currentTimeMillis(),
                hopCount = 0,
                relayedBy = myPubkey ?: "unknown"
            )
            pendingBundles[bundleId] = metadata
            seenBundleHashes.add(bundleId)

            // Send to all FULLY connected peers (services must be discovered)
            var peersReached = 0
            connectedPeers.forEach { (address, gatt) ->
                try {
                    Log.d(TAG, "→ Sending bundle to peer: $address")
                    sendBundleToPeer(gatt, metadata)
                    peersReached++
                    Log.d(TAG, "  ✅ Bundle sent successfully")
                } catch (e: Exception) {
                    Log.w(TAG, "  ❌ Failed to send bundle to $address", e)
                }
            }

            if (peersReached == 0 && pendingGattConnections.isNotEmpty()) {
                Log.w(TAG, "⚠️ WARNING: No fully connected peers available yet!")
                Log.w(TAG, "  ${pendingGattConnections.size} peer(s) are still completing service discovery")
                Log.w(TAG, "  Bundle will be queued and sent once peers are fully connected")
            }

            Log.d(TAG, "✅ Broadcast complete - reached $peersReached peer(s)")
            Log.d(TAG, "========================================")

            val result = Arguments.createMap().apply {
                putBoolean("success", peersReached > 0)
                putInt("peersReached", peersReached)
                putString("bundleId", bundleId)
            }

            promise.resolve(result)

        } catch (e: Exception) {
            Log.e(TAG, "❌ Failed to broadcast bundle", e)
            promise.reject("MESH_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun requestPeers(promise: Promise) {
        try {
            val peers = Arguments.createArray()

            connectedPeers.forEach { (address, gatt) ->
                val peerInfo = Arguments.createMap().apply {
                    putString("address", address)
                    putString("name", gatt.device.name ?: "Unknown")
                    putInt("rssi", 0) // TODO: Track RSSI
                    putBoolean("connected", true)
                }
                peers.pushMap(peerInfo)
            }

            promise.resolve(peers)

        } catch (e: Exception) {
            Log.e(TAG, "Failed to get peers", e)
            promise.reject("MESH_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun getDiagnostics(promise: Promise) {
        try {
            val diagnostics = Arguments.createMap().apply {
                putBoolean("started", isActive)
                putString("nodeType", nodeType)
                putInt("connectedPeers", connectedPeers.size)
                putInt("pendingBundles", pendingBundles.size)
                putInt("seenBundleHashes", seenBundleHashes.size)
                putBoolean("advertising", isActive)
                putBoolean("scanning", isActive)
            }

            promise.resolve(diagnostics)

        } catch (e: Exception) {
            Log.e(TAG, "Failed to get diagnostics", e)
            promise.reject("MESH_ERROR", e.message, e)
        }
    }

    // ==================== GATT Server (Peripheral Mode) ====================

    private fun startGattServer() {
        Log.d(TAG, "========== STARTING GATT SERVER ==========")

        if (bluetoothManager == null) {
            Log.e(TAG, "❌ Cannot start GATT server: BluetoothManager is null")
            return
        }

        gattServer = bluetoothManager?.openGattServer(reactContext, gattServerCallback)

        if (gattServer == null) {
            Log.e(TAG, "❌ CRITICAL: Failed to open GATT server!")
            return
        }

        Log.d(TAG, "✅ GATT server opened successfully")

        // Create Beam service
        val service = BluetoothGattService(
            BEAM_SERVICE_UUID,
            BluetoothGattService.SERVICE_TYPE_PRIMARY
        )
        Log.d(TAG, "→ Creating Beam service: $BEAM_SERVICE_UUID")

        // Payment Request characteristic (Read)
        val paymentRequestChar = BluetoothGattCharacteristic(
            PAYMENT_REQUEST_UUID,
            BluetoothGattCharacteristic.PROPERTY_READ,
            BluetoothGattCharacteristic.PERMISSION_READ
        )
        service.addCharacteristic(paymentRequestChar)
        Log.d(TAG, "  • Added Payment Request characteristic: $PAYMENT_REQUEST_UUID")

        // Payment Bundle characteristic (Write)
        val paymentBundleChar = BluetoothGattCharacteristic(
            PAYMENT_BUNDLE_UUID,
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        )
        service.addCharacteristic(paymentBundleChar)
        Log.d(TAG, "  • Added Payment Bundle characteristic: $PAYMENT_BUNDLE_UUID")

        // Payment Status characteristic (Notify)
        val paymentStatusChar = BluetoothGattCharacteristic(
            PAYMENT_STATUS_UUID,
            BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ
        )
        paymentStatusChar.addDescriptor(
            BluetoothGattDescriptor(
                UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"), // CCC descriptor
                BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
            )
        )
        service.addCharacteristic(paymentStatusChar)
        Log.d(TAG, "  • Added Payment Status characteristic: $PAYMENT_STATUS_UUID")

        // Mesh Relay characteristic (Read/Write/Notify)
        val meshRelayChar = BluetoothGattCharacteristic(
            MESH_RELAY_UUID,
            BluetoothGattCharacteristic.PROPERTY_READ or
                    BluetoothGattCharacteristic.PROPERTY_WRITE or
                    BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ or BluetoothGattCharacteristic.PERMISSION_WRITE
        )
        meshRelayChar.addDescriptor(
            BluetoothGattDescriptor(
                UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"),
                BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
            )
        )
        service.addCharacteristic(meshRelayChar)
        Log.d(TAG, "  • Added Mesh Relay characteristic: $MESH_RELAY_UUID")

        // Phase 2.3: ACK/NACK characteristic (Write/Notify)
        val ackNackChar = BluetoothGattCharacteristic(
            ACK_NACK_UUID,
            BluetoothGattCharacteristic.PROPERTY_WRITE or
                    BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE or
                    BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        )
        ackNackChar.addDescriptor(
            BluetoothGattDescriptor(
                UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"), // CCC descriptor
                BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
            )
        )
        service.addCharacteristic(ackNackChar)
        Log.d(TAG, "  • Added ACK/NACK characteristic: $ACK_NACK_UUID")

        val serviceAdded = gattServer?.addService(service)
        Log.d(TAG, "→ Adding service to GATT server: ${if (serviceAdded == true) "SUCCESS" else "FAILED"}")
        Log.d(TAG, "========== GATT SERVER READY ==========")
    }

    private val gattServerCallback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            Log.d(TAG, "========== GATT SERVER: Connection State Change ==========")
            Log.d(TAG, "Device: ${device.address} (${device.name ?: "Unknown"})")
            Log.d(TAG, "Status: $status")
            Log.d(TAG, "New State: ${when (newState) {
                BluetoothProfile.STATE_CONNECTED -> "CONNECTED"
                BluetoothProfile.STATE_CONNECTING -> "CONNECTING"
                BluetoothProfile.STATE_DISCONNECTED -> "DISCONNECTED"
                BluetoothProfile.STATE_DISCONNECTING -> "DISCONNECTING"
                else -> "UNKNOWN($newState)"
            }}")

            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    Log.d(TAG, "✅ PEER CONNECTED via GATT server: ${device.address}")
                    peerDevices[device.address] = device
                    Log.d(TAG, "→ Total connected peers: ${peerDevices.size}")

                    sendEvent("PeerConnected", Arguments.createMap().apply {
                        putString("address", device.address)
                        putString("name", device.name ?: "Unknown")
                    })
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    Log.d(TAG, "❌ PEER DISCONNECTED from GATT server: ${device.address}")
                    peerDevices.remove(device.address)
                    peerMTUs.remove(device.address)
                    Log.d(TAG, "→ Total connected peers: ${peerDevices.size}")

                    sendEvent("PeerDisconnected", Arguments.createMap().apply {
                        putString("address", device.address)
                    })
                }
            }
            Log.d(TAG, "========================================")
        }

        override fun onMtuChanged(device: BluetoothDevice, mtu: Int) {
            Log.d(TAG, "MTU changed for ${device.address}: $mtu")
            peerMTUs[device.address] = mtu
        }

        override fun onCharacteristicReadRequest(
            device: BluetoothDevice,
            requestId: Int,
            offset: Int,
            characteristic: BluetoothGattCharacteristic
        ) {
            Log.d(TAG, "Read request from ${device.address} for ${characteristic.uuid}")

            when (characteristic.uuid) {
                PAYMENT_REQUEST_UUID -> {
                    // Return payment request if we're a merchant
                    val response = if (nodeType == "merchant") {
                        // TODO: Get current payment request from state
                        "{}".toByteArray()
                    } else {
                        ByteArray(0)
                    }
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, response)
                }
                else -> {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_FAILURE, offset, null)
                }
            }
        }

        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            characteristic: BluetoothGattCharacteristic,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray
        ) {
            Log.d(TAG, "Write request from ${device.address} for ${characteristic.uuid}, ${value.size} bytes")

            when (characteristic.uuid) {
                PAYMENT_BUNDLE_UUID -> {
                    handleIncomingBundleChunk(device, value)
                    if (responseNeeded) {
                        gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, null)
                    }
                }
                MESH_RELAY_UUID -> {
                    handleIncomingMeshMessage(device, value)
                    if (responseNeeded) {
                        gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, null)
                    }
                }
                ACK_NACK_UUID -> {
                    // Phase 2.3: Handle ACK/NACK received
                    handleAckNackReceived(device, value)
                    if (responseNeeded) {
                        gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, null)
                    }
                }
                else -> {
                    if (responseNeeded) {
                        gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_FAILURE, offset, null)
                    }
                }
            }
        }
    }

    // ==================== BLE Advertising ====================

    private fun startAdvertising() {
        Log.d(TAG, "========== STARTING BLE ADVERTISING ==========")

        if (advertiser == null) {
            Log.e(TAG, "❌ Cannot start advertising: Advertiser is null")
            return
        }

        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(true)
            .setTimeout(0)
            .build()

        Log.d(TAG, "→ Advertise Mode: LOW_LATENCY (fastest discovery)")
        Log.d(TAG, "→ TX Power: HIGH (maximum range)")
        Log.d(TAG, "→ Connectable: true")
        Log.d(TAG, "→ Timeout: 0 (unlimited)")

        val data = AdvertiseData.Builder()
            .setIncludeDeviceName(true)
            .addServiceUuid(ParcelUuid(BEAM_SERVICE_UUID))
            .build()

        Log.d(TAG, "→ Advertising Service UUID: $BEAM_SERVICE_UUID")
        Log.d(TAG, "→ Device Name Included: true")

        advertiser?.startAdvertising(settings, data, advertiseCallback)
        Log.d(TAG, "→ Advertising started (waiting for callback...)")
    }

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
            Log.d(TAG, "========== ✅ ADVERTISING STARTED SUCCESSFULLY ==========")
            Log.d(TAG, "Devices can now discover this device via BLE!")
            Log.d(TAG, "Service UUID being advertised: $BEAM_SERVICE_UUID")
            Log.d(TAG, "========================================")

            // Emit event to React Native so UI can show advertising status
            sendEvent("AdvertisingStarted", Arguments.createMap().apply {
                putString("status", "active")
                putString("serviceUuid", BEAM_SERVICE_UUID.toString())
            })
        }

        override fun onStartFailure(errorCode: Int) {
            val errorMessage = when (errorCode) {
                ADVERTISE_FAILED_DATA_TOO_LARGE -> "DATA_TOO_LARGE"
                ADVERTISE_FAILED_TOO_MANY_ADVERTISERS -> "TOO_MANY_ADVERTISERS"
                ADVERTISE_FAILED_ALREADY_STARTED -> "ALREADY_STARTED"
                ADVERTISE_FAILED_INTERNAL_ERROR -> "INTERNAL_ERROR"
                ADVERTISE_FAILED_FEATURE_UNSUPPORTED -> "FEATURE_UNSUPPORTED"
                else -> "UNKNOWN($errorCode)"
            }
            Log.e(TAG, "========== ❌ ADVERTISING FAILED ==========")
            Log.e(TAG, "Error Code: $errorCode ($errorMessage)")
            Log.e(TAG, "========================================")
            sendEvent("AdvertisingError", Arguments.createMap().apply {
                putInt("errorCode", errorCode)
                putString("errorMessage", errorMessage)
            })
        }
    }

    // ==================== BLE Scanning ====================

    private fun startScanning() {
        Log.d(TAG, "========== STARTING BLE SCANNING ==========")

        if (scanner == null) {
            Log.e(TAG, "❌ Cannot start scanning: Scanner is null")
            return
        }

        val scanFilter = ScanFilter.Builder()
            .setServiceUuid(ParcelUuid(BEAM_SERVICE_UUID))
            .build()

        val scanSettings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        Log.d(TAG, "→ Scan Filter: Service UUID = $BEAM_SERVICE_UUID")
        Log.d(TAG, "→ Scan Mode: LOW_LATENCY (fastest discovery)")

        scanner?.startScan(listOf(scanFilter), scanSettings, scanCallback)
        Log.d(TAG, "✅ BLE scanning started - listening for nearby Beam devices...")
        Log.d(TAG, "========================================")
    }

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val device = result.device
            val address = device.address

            Log.d(TAG, "========== 📡 DEVICE DISCOVERED ==========")
            Log.d(TAG, "Device Address: $address")
            Log.d(TAG, "Device Name: ${device.name ?: "Unknown"}")
            Log.d(TAG, "RSSI: ${result.rssi} dBm")
            Log.d(TAG, "Callback Type: ${when (callbackType) {
                ScanSettings.CALLBACK_TYPE_ALL_MATCHES -> "ALL_MATCHES"
                ScanSettings.CALLBACK_TYPE_FIRST_MATCH -> "FIRST_MATCH"
                ScanSettings.CALLBACK_TYPE_MATCH_LOST -> "MATCH_LOST"
                else -> "UNKNOWN($callbackType)"
            }}")

            // Log advertised services
            result.scanRecord?.serviceUuids?.forEach { uuid ->
                Log.d(TAG, "  • Advertised Service: $uuid")
            }

            // Skip if already connected or connecting
            val connectionState = peerConnectionStates[address]
            if (connectionState == PeerConnectionState.CONNECTED ||
                connectionState == PeerConnectionState.CONNECTING) {
                Log.d(TAG, "⚠️ Already $connectionState to this device - skipping")
                Log.d(TAG, "========================================")
                return
            }

            Log.d(TAG, "→ Attempting to connect to peer...")
            Log.d(TAG, "========================================")

            // Connect to peer
            connectToPeer(device)
        }

        override fun onScanFailed(errorCode: Int) {
            val errorMessage = when (errorCode) {
                ScanCallback.SCAN_FAILED_ALREADY_STARTED -> "ALREADY_STARTED"
                ScanCallback.SCAN_FAILED_APPLICATION_REGISTRATION_FAILED -> "APPLICATION_REGISTRATION_FAILED"
                ScanCallback.SCAN_FAILED_INTERNAL_ERROR -> "INTERNAL_ERROR"
                ScanCallback.SCAN_FAILED_FEATURE_UNSUPPORTED -> "FEATURE_UNSUPPORTED"
                else -> "UNKNOWN($errorCode)"
            }
            Log.e(TAG, "========== ❌ BLE SCAN FAILED ==========")
            Log.e(TAG, "Error Code: $errorCode ($errorMessage)")
            Log.e(TAG, "========================================")
        }
    }

    // ==================== Peer Connection (Central Mode) ====================

    // Phase 2.2: Calculate retry delay with exponential backoff
    private fun calculateRetryDelay(retryCount: Int): Long {
        val delay = INITIAL_RETRY_DELAY_MS * Math.pow(2.0, retryCount.toDouble()).toLong()
        return minOf(delay, MAX_RETRY_DELAY_MS)
    }

    // Phase 2.2: Check if should retry connection
    private fun shouldRetryConnection(address: String): Boolean {
        val retryCount = connectionRetryCount.getOrDefault(address, 0)
        return retryCount < MAX_RETRY_ATTEMPTS
    }

    // Phase 2.2: Schedule connection retry with exponential backoff
    private fun scheduleConnectionRetry(device: BluetoothDevice) {
        val address = device.address
        val retryCount = connectionRetryCount.getOrDefault(address, 0)

        if (!shouldRetryConnection(address)) {
            Log.w(TAG, "❌ Max retry attempts ($MAX_RETRY_ATTEMPTS) reached for $address - giving up")
            peerConnectionStates[address] = PeerConnectionState.FAILED
            connectionRetryCount.remove(address)
            return
        }

        val delay = calculateRetryDelay(retryCount)
        connectionRetryCount[address] = retryCount + 1
        peerConnectionStates[address] = PeerConnectionState.RETRYING

        Log.d(TAG, "⏳ Scheduling reconnection attempt ${retryCount + 1}/$MAX_RETRY_ATTEMPTS for $address in ${delay}ms")

        executor.schedule({
            try {
                Log.d(TAG, "🔄 Retry attempt ${retryCount + 1} for $address")
                connectToPeer(device)
            } catch (e: Exception) {
                Log.e(TAG, "❌ Retry connection failed for $address", e)
                scheduleConnectionRetry(device)
            }
        }, delay, TimeUnit.MILLISECONDS)
    }

    // Phase 2.2: Start connection timeout monitor
    private fun startConnectionTimeoutMonitor(address: String) {
        val timeoutTimestamp = System.currentTimeMillis() + CONNECTION_TIMEOUT_MS
        connectionTimeouts[address] = timeoutTimestamp

        executor.schedule({
            val currentState = peerConnectionStates[address]
            if (currentState == PeerConnectionState.CONNECTING) {
                Log.w(TAG, "⏱️ Connection timeout for $address after ${CONNECTION_TIMEOUT_MS}ms")

                // Close stale connection (check both pending and connected)
                val gatt = pendingGattConnections[address] ?: connectedPeers[address]
                gatt?.let {
                    try {
                        it.disconnect()
                        it.close()
                    } catch (e: Exception) {
                        Log.w(TAG, "Error closing timed-out connection", e)
                    }
                }
                pendingGattConnections.remove(address)
                connectedPeers.remove(address)
                servicesDiscovered.remove(address)
                peerConnectionStates[address] = PeerConnectionState.FAILED

                // Retry if attempts remain
                peerDevices[address]?.let { device ->
                    scheduleConnectionRetry(device)
                }
            }
        }, CONNECTION_TIMEOUT_MS, TimeUnit.MILLISECONDS)
    }

    private fun connectToPeer(device: BluetoothDevice) {
        executor.execute {
            try {
                val address = device.address
                val currentState = peerConnectionStates[address]

                // Phase 2.2: Skip if already connecting or connected
                if (currentState == PeerConnectionState.CONNECTING ||
                    currentState == PeerConnectionState.CONNECTED) {
                    Log.d(TAG, "⚠️ Already ${currentState} to $address - skipping")
                    return@execute
                }

                Log.d(TAG, "========== INITIATING GATT CONNECTION ==========")
                Log.d(TAG, "Target Device: $address (${device.name ?: "Unknown"})")
                Log.d(TAG, "Transport: BLE (Low Energy)")
                Log.d(TAG, "Auto Connect: false (immediate connection)")

                val retryCount = connectionRetryCount.getOrDefault(address, 0)
                if (retryCount > 0) {
                    Log.d(TAG, "Retry Attempt: $retryCount/$MAX_RETRY_ATTEMPTS")
                }

                // Phase 2.2: Update connection state and start timeout monitor
                peerConnectionStates[address] = PeerConnectionState.CONNECTING
                peerDevices[address] = device
                startConnectionTimeoutMonitor(address)

                val gatt = device.connectGatt(reactContext, false, gattClientCallback, BluetoothDevice.TRANSPORT_LE)

                if (gatt == null) {
                    Log.e(TAG, "❌ connectGatt returned NULL - connection failed!")
                    peerConnectionStates[address] = PeerConnectionState.FAILED
                    scheduleConnectionRetry(device)
                    return@execute
                }

                // Store GATT object temporarily, DON'T add to connectedPeers yet
                // Will add to connectedPeers AFTER services are discovered
                pendingGattConnections[address] = gatt
                peerDevices[address] = device
                Log.d(TAG, "→ Connection initiated, waiting for callback...")
                Log.d(TAG, "========================================")
            } catch (e: Exception) {
                Log.e(TAG, "========== ❌ CONNECTION FAILED ==========")
                Log.e(TAG, "Device: ${device.address}")
                Log.e(TAG, "Error: ${e.message}")
                Log.e(TAG, "========================================", e)

                // Phase 2.2: Retry on exception
                peerConnectionStates[device.address] = PeerConnectionState.FAILED
                scheduleConnectionRetry(device)
            }
        }
    }

    private val gattClientCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            val address = gatt.device.address

            Log.d(TAG, "========== GATT CLIENT: Connection State Change ==========")
            Log.d(TAG, "Device: $address (${gatt.device.name ?: "Unknown"})")
            Log.d(TAG, "Status: $status ${if (status == BluetoothGatt.GATT_SUCCESS) "(SUCCESS)" else "(FAILURE)"}")
            Log.d(TAG, "New State: ${when (newState) {
                BluetoothProfile.STATE_CONNECTED -> "CONNECTED"
                BluetoothProfile.STATE_CONNECTING -> "CONNECTING"
                BluetoothProfile.STATE_DISCONNECTED -> "DISCONNECTED"
                BluetoothProfile.STATE_DISCONNECTING -> "DISCONNECTING"
                else -> "UNKNOWN($newState)"
            }}")

            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    if (status == BluetoothGatt.GATT_SUCCESS) {
                        Log.d(TAG, "✅ SUCCESSFULLY CONNECTED to peer as GATT client")

                        // Phase 2.2: Reset retry count on successful connection
                        connectionRetryCount.remove(address)
                        connectionTimeouts.remove(address)
                        peerConnectionStates[address] = PeerConnectionState.CONNECTED

                        Log.d(TAG, "→ Requesting MTU: $MAX_MTU_SIZE bytes")
                        gatt.requestMtu(MAX_MTU_SIZE)

                        Log.d(TAG, "→ Discovering services...")
                        val discovered = gatt.discoverServices()
                        Log.d(TAG, "  Service discovery ${if (discovered) "initiated" else "FAILED"}")
                    } else {
                        Log.e(TAG, "❌ Connection established but status is not SUCCESS: $status")

                        // Phase 2.2: Retry on failed connection status
                        peerConnectionStates[address] = PeerConnectionState.FAILED
                        pendingGattConnections.remove(address)
                        connectedPeers.remove(address)
                        servicesDiscovered.remove(address)
                        gatt.close()

                        peerDevices[address]?.let { device ->
                            scheduleConnectionRetry(device)
                        }
                    }
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    Log.d(TAG, "❌ DISCONNECTED from peer")
                    val previousState = peerConnectionStates[address]

                    // Clean up all connection state
                    connectedPeers.remove(address)
                    pendingGattConnections.remove(address)
                    servicesDiscovered.remove(address)
                    gatt.close()
                    Log.d(TAG, "→ GATT connection closed and cleaned up")

                    // Phase 2.2: Automatic reconnection on unexpected disconnect
                    if (isActive && previousState == PeerConnectionState.CONNECTED) {
                        Log.d(TAG, "⚠️ Unexpected disconnect - attempting reconnection")
                        peerConnectionStates[address] = PeerConnectionState.DISCONNECTED

                        peerDevices[address]?.let { device ->
                            scheduleConnectionRetry(device)
                        }
                    } else if (previousState == PeerConnectionState.CONNECTING && status != BluetoothGatt.GATT_SUCCESS) {
                        // Connection attempt failed
                        Log.w(TAG, "⚠️ Connection attempt failed - will retry")
                        peerConnectionStates[address] = PeerConnectionState.FAILED

                        peerDevices[address]?.let { device ->
                            scheduleConnectionRetry(device)
                        }
                    } else {
                        peerConnectionStates[address] = PeerConnectionState.DISCONNECTED
                    }
                }
            }
            Log.d(TAG, "========================================")
        }

        override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
            Log.d(TAG, "========== MTU Changed ==========")
            Log.d(TAG, "Device: ${gatt.device.address}")
            Log.d(TAG, "New MTU: $mtu bytes")
            Log.d(TAG, "Status: ${if (status == BluetoothGatt.GATT_SUCCESS) "SUCCESS" else "FAILED ($status)"}")

            if (status == BluetoothGatt.GATT_SUCCESS) {
                peerMTUs[gatt.device.address] = mtu
                Log.d(TAG, "✅ MTU updated successfully")
            }
            Log.d(TAG, "========================================")
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            val address = gatt.device.address
            Log.d(TAG, "========== Services Discovered ==========")
            Log.d(TAG, "Device: $address")
            Log.d(TAG, "Status: ${if (status == BluetoothGatt.GATT_SUCCESS) "SUCCESS" else "FAILED ($status)"}")

            if (status == BluetoothGatt.GATT_SUCCESS) {
                Log.d(TAG, "✅ Discovered ${gatt.services.size} services:")
                gatt.services.forEach { service ->
                    Log.d(TAG, "  • Service: ${service.uuid}")
                    service.characteristics.forEach { char ->
                        Log.d(TAG, "    - Characteristic: ${char.uuid}")
                    }
                }

                // Check for Beam service
                val beamService = gatt.getService(BEAM_SERVICE_UUID)
                if (beamService != null) {
                    Log.d(TAG, "✅ Found Beam service: $BEAM_SERVICE_UUID")

                    // Verify required characteristics exist
                    val meshRelayChar = beamService.getCharacteristic(MESH_RELAY_UUID)
                    val paymentBundleChar = beamService.getCharacteristic(PAYMENT_BUNDLE_UUID)

                    if (meshRelayChar != null && paymentBundleChar != null) {
                        Log.d(TAG, "✅ All required characteristics found")

                        // NOW we can mark this device as fully connected
                        servicesDiscovered[address] = true

                        // Move from pending to connected peers
                        pendingGattConnections.remove(address)
                        connectedPeers[address] = gatt

                        Log.d(TAG, "✅ Device $address is now FULLY CONNECTED and ready for transfers")
                        Log.d(TAG, "Total connected peers: ${connectedPeers.size}")

                        // Notify React Native
                        sendEvent("PeerConnected", Arguments.createMap().apply {
                            putString("address", address)
                            putString("name", gatt.device.name ?: "Unknown")
                        })
                    } else {
                        Log.e(TAG, "❌ Required characteristics NOT found!")
                        if (meshRelayChar == null) Log.e(TAG, "  Missing: MESH_RELAY_UUID")
                        if (paymentBundleChar == null) Log.e(TAG, "  Missing: PAYMENT_BUNDLE_UUID")

                        // Disconnect and retry
                        peerConnectionStates[address] = PeerConnectionState.FAILED
                        gatt.disconnect()
                        gatt.close()
                        pendingGattConnections.remove(address)

                        peerDevices[address]?.let { device ->
                            scheduleConnectionRetry(device)
                        }
                    }
                } else {
                    Log.w(TAG, "⚠️ Beam service NOT found!")

                    // Disconnect and retry
                    peerConnectionStates[address] = PeerConnectionState.FAILED
                    gatt.disconnect()
                    gatt.close()
                    pendingGattConnections.remove(address)

                    peerDevices[address]?.let { device ->
                        scheduleConnectionRetry(device)
                    }
                }
            } else {
                Log.e(TAG, "❌ Service discovery failed with status $status")

                // Disconnect and retry
                peerConnectionStates[address] = PeerConnectionState.FAILED
                gatt.disconnect()
                gatt.close()
                pendingGattConnections.remove(address)

                peerDevices[address]?.let { device ->
                    scheduleConnectionRetry(device)
                }
            }
            Log.d(TAG, "========================================")
        }

        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            Log.d(TAG, "========== Characteristic Changed ==========")
            Log.d(TAG, "Device: ${gatt.device.address}")
            Log.d(TAG, "Characteristic: ${characteristic.uuid}")
            Log.d(TAG, "Value Size: ${characteristic.value?.size ?: 0} bytes")
            Log.d(TAG, "========================================")
            handleIncomingNotification(gatt.device, characteristic.value)
        }
    }

    // ==================== Bundle Transfer ====================

    private fun sendBundleToPeer(gatt: BluetoothGatt, metadata: BundleMetadata) {
        val address = gatt.device.address

        val service = gatt.getService(BEAM_SERVICE_UUID)
        if (service == null) {
            Log.w(TAG, "⚠️ Beam service not available for $address - services not discovered yet")
            return
        }

        val characteristic = service.getCharacteristic(MESH_RELAY_UUID)
        if (characteristic == null) {
            Log.w(TAG, "⚠️ Mesh relay characteristic not available for $address")
            return
        }

        // Check characteristic properties to ensure it's writable
        val properties = characteristic.properties
        if ((properties and BluetoothGattCharacteristic.PROPERTY_WRITE) == 0 &&
            (properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) == 0) {
            Log.w(TAG, "⚠️ Characteristic not writable for $address")
            return
        }

        val mtu = peerMTUs[address] ?: MAX_MTU_SIZE
        val chunkSize = minOf(mtu - 4, MAX_CHUNK_SIZE)

        val chunks = metadata.data.toList().chunked(chunkSize)
        Log.d(TAG, "Sending bundle ${metadata.bundleId} to $address in ${chunks.size} chunks")

        chunks.forEachIndexed { index, chunk ->
            try {
                val packet = ByteBuffer.allocate(chunk.size + 4)
                    .order(ByteOrder.BIG_ENDIAN)
                    .putShort(index.toShort())
                    .putShort(chunks.size.toShort())
                    .put(chunk.toByteArray())
                    .array()

                characteristic.value = packet
                val writeSuccess = gatt.writeCharacteristic(characteristic)

                if (!writeSuccess) {
                    Log.w(TAG, "⚠️ Failed to write chunk $index for bundle ${metadata.bundleId} to $address")
                } else {
                    Log.d(TAG, "  → Sent chunk $index/${chunks.size} to $address")
                }

                // Add delay to avoid overwhelming the peer
                Thread.sleep(50)
            } catch (e: Exception) {
                Log.e(TAG, "❌ Error sending chunk $index to $address", e)
            }
        }
    }

    private fun handleIncomingBundleChunk(device: BluetoothDevice, data: ByteArray) {
        try {
            val buffer = ByteBuffer.wrap(data).order(ByteOrder.BIG_ENDIAN)
            val chunkIndex = buffer.short.toInt() and 0xFFFF
            val totalChunks = buffer.short.toInt() and 0xFFFF

            val chunkData = ByteArray(data.size - 4)
            buffer.get(chunkData)

            val key = device.address
            val now = System.currentTimeMillis()

            // Phase 2.4: Get or create chunk buffer with transfer ID
            val chunkBuffer = incomingChunks.getOrPut(key) {
                val transferId = "${device.address}_${System.currentTimeMillis()}"
                Log.d(TAG, "→ Starting new chunk transfer: $transferId ($totalChunks chunks)")
                ChunkBuffer(
                    totalChunks = totalChunks,
                    transferId = transferId
                )
            }

            // Phase 2.4: Check for timeout
            val timeSinceStart = now - chunkBuffer.startedAt
            val timeSinceLastChunk = now - chunkBuffer.lastChunkAt

            if (timeSinceStart > CHUNK_TRANSFER_TIMEOUT_MS) {
                Log.w(TAG, "⏱️ Chunk transfer timeout (${timeSinceStart}ms) - aborting transfer from ${device.address}")
                incomingChunks.remove(key)
                return
            }

            if (timeSinceLastChunk > CHUNK_IDLE_TIMEOUT_MS && chunkBuffer.receivedChunks > 0) {
                Log.w(TAG, "⏱️ Chunk idle timeout (${timeSinceLastChunk}ms since last chunk) - aborting transfer from ${device.address}")
                incomingChunks.remove(key)
                return
            }

            // Phase 2.4: Detect and skip duplicates
            if (chunkBuffer.receivedChunkIndices.contains(chunkIndex)) {
                Log.d(TAG, "⚠️ Duplicate chunk $chunkIndex from ${device.address} - skipping")
                return
            }

            // Phase 2.4: Validate chunk index
            if (chunkIndex < 0 || chunkIndex >= totalChunks) {
                Log.e(TAG, "❌ Invalid chunk index $chunkIndex (total: $totalChunks) from ${device.address}")
                incomingChunks.remove(key)
                return
            }

            // Phase 2.4: Store chunk and update tracking
            chunkBuffer.chunks[chunkIndex] = chunkData
            chunkBuffer.receivedChunkIndices.add(chunkIndex)
            chunkBuffer.receivedChunks++
            chunkBuffer.lastChunkAt = now

            val progress = (chunkBuffer.receivedChunks * 100) / totalChunks
            Log.d(TAG, "→ Received chunk $chunkIndex/$totalChunks from ${device.address} (${progress}% complete)")

            // Phase 2.4: Check for completion
            if (chunkBuffer.receivedChunks == totalChunks) {
                Log.d(TAG, "✅ All $totalChunks chunks received - reassembling bundle")

                // Phase 2.4: Verify all chunk indices present
                val missingChunks = mutableListOf<Int>()
                for (i in 0 until totalChunks) {
                    if (!chunkBuffer.chunks.containsKey(i)) {
                        missingChunks.add(i)
                    }
                }

                if (missingChunks.isNotEmpty()) {
                    Log.e(TAG, "❌ Missing chunks: $missingChunks - transfer incomplete!")
                    incomingChunks.remove(key)
                    return
                }

                // All chunks received and verified, reassemble
                val sortedChunks = chunkBuffer.chunks.toSortedMap()
                val completeData = sortedChunks.values.fold(ByteArray(0)) { acc, bytes -> acc + bytes }

                val transferDuration = now - chunkBuffer.startedAt
                Log.d(TAG, "✅ Bundle reassembled successfully (${completeData.size} bytes in ${transferDuration}ms)")

                incomingChunks.remove(key)
                handleCompleteBundleReceived(device, completeData)
            }

        } catch (e: Exception) {
            Log.e(TAG, "Failed to handle incoming chunk", e)
            // Clean up on error
            incomingChunks.remove(device.address)
        }
    }

    private fun handleCompleteBundleReceived(device: BluetoothDevice, data: ByteArray) {
        var bundleId: String? = null
        try {
            val bundleJson = JSONObject(String(data))
            bundleId = bundleJson.optString("tx_id")

            // Check if already seen
            if (seenBundleHashes.contains(bundleId)) {
                Log.d(TAG, "Bundle $bundleId already seen, skipping")
                // Still send ACK even for duplicates
                sendAck(device, bundleId)
                return
            }

            Log.d(TAG, "Received complete bundle $bundleId from ${device.address}")
            seenBundleHashes.add(bundleId)

            // Send to React Native
            val bundleMap = jsonToReactMap(bundleJson)
            sendEvent("BundleReceived", bundleMap)

            // Phase 2.3: Send ACK on successful reception
            sendAck(device, bundleId)

            // Relay to other peers if hop count allows
            val hopCount = bundleJson.optInt("hopCount", 0)
            if (hopCount < MAX_HOP_COUNT) {
                relayBundle(bundleId, data, hopCount + 1)
            }

        } catch (e: Exception) {
            Log.e(TAG, "Failed to handle complete bundle", e)
            // Phase 2.3: Send NACK on validation failure
            if (bundleId != null) {
                sendNack(device, bundleId, e.message ?: "Unknown error")
            }
        }
    }

    // Phase 2.3: Send ACK to peer
    private fun sendAck(device: BluetoothDevice, bundleId: String) {
        try {
            Log.d(TAG, "→ Sending ACK for bundle $bundleId to ${device.address}")

            val ackData = JSONObject().apply {
                put("type", "ack")
                put("bundleId", bundleId)
                put("timestamp", System.currentTimeMillis())
            }.toString().toByteArray()

            // Send via GATT server notification if this is a server connection
            gattServer?.let { server ->
                val service = server.getService(BEAM_SERVICE_UUID)
                val ackChar = service?.getCharacteristic(ACK_NACK_UUID)
                if (ackChar != null) {
                    ackChar.value = ackData
                    server.notifyCharacteristicChanged(device, ackChar, false)
                    Log.d(TAG, "✅ ACK sent for bundle $bundleId")

                    // Also emit to React Native
                    sendEvent("AckReceived", Arguments.createMap().apply {
                        putString("bundleId", bundleId)
                    })
                }
            }

            // If we're connected as a client, write to the peer's ACK characteristic
            connectedPeers[device.address]?.let { gatt ->
                val service = gatt.getService(BEAM_SERVICE_UUID)
                val ackChar = service?.getCharacteristic(ACK_NACK_UUID)
                if (ackChar != null) {
                    ackChar.value = ackData
                    gatt.writeCharacteristic(ackChar)
                }
            }

        } catch (e: Exception) {
            Log.e(TAG, "Failed to send ACK for bundle $bundleId", e)
        }
    }

    // Phase 2.3: Send NACK to peer
    private fun sendNack(device: BluetoothDevice, bundleId: String, reason: String) {
        try {
            Log.w(TAG, "→ Sending NACK for bundle $bundleId to ${device.address}: $reason")

            val nackData = JSONObject().apply {
                put("type", "nack")
                put("bundleId", bundleId)
                put("reason", reason)
                put("timestamp", System.currentTimeMillis())
            }.toString().toByteArray()

            // Send via GATT server notification if this is a server connection
            gattServer?.let { server ->
                val service = server.getService(BEAM_SERVICE_UUID)
                val ackChar = service?.getCharacteristic(ACK_NACK_UUID)
                if (ackChar != null) {
                    ackChar.value = nackData
                    server.notifyCharacteristicChanged(device, ackChar, false)
                    Log.d(TAG, "❌ NACK sent for bundle $bundleId")

                    // Also emit to React Native
                    sendEvent("NackReceived", Arguments.createMap().apply {
                        putString("bundleId", bundleId)
                        putString("reason", reason)
                    })
                }
            }

            // If we're connected as a client, write to the peer's ACK characteristic
            connectedPeers[device.address]?.let { gatt ->
                val service = gatt.getService(BEAM_SERVICE_UUID)
                val ackChar = service?.getCharacteristic(ACK_NACK_UUID)
                if (ackChar != null) {
                    ackChar.value = nackData
                    gatt.writeCharacteristic(ackChar)
                }
            }

        } catch (e: Exception) {
            Log.e(TAG, "Failed to send NACK for bundle $bundleId", e)
        }
    }

    // Phase 2.3: Handle ACK/NACK received from peer
    private fun handleAckNackReceived(device: BluetoothDevice, data: ByteArray) {
        try {
            val json = JSONObject(String(data))
            val type = json.optString("type")
            val bundleId = json.optString("bundleId")

            when (type) {
                "ack" -> {
                    Log.d(TAG, "✅ Received ACK for bundle $bundleId from ${device.address}")
                    sendEvent("AckReceived", Arguments.createMap().apply {
                        putString("bundleId", bundleId)
                    })
                }
                "nack" -> {
                    val reason = json.optString("reason", "Unknown")
                    Log.w(TAG, "❌ Received NACK for bundle $bundleId from ${device.address}: $reason")
                    sendEvent("NackReceived", Arguments.createMap().apply {
                        putString("bundleId", bundleId)
                        putString("reason", reason)
                    })
                }
                else -> {
                    Log.w(TAG, "⚠️ Unknown ACK/NACK type: $type")
                }
            }

        } catch (e: Exception) {
            Log.e(TAG, "Failed to handle ACK/NACK", e)
        }
    }

    // ==================== Gossip Protocol ====================

    private fun startGossipProtocol() {
        executor.scheduleAtFixedRate({
            try {
                if (connectedPeers.isNotEmpty()) {
                    sendGossipMessage()
                }
            } catch (e: Exception) {
                Log.e(TAG, "Gossip protocol error", e)
            }
        }, GOSSIP_INTERVAL_MS, GOSSIP_INTERVAL_MS, TimeUnit.MILLISECONDS)
    }

    private fun sendGossipMessage() {
        val hashes = seenBundleHashes.take(100).toList()
        val gossipJson = JSONObject().apply {
            put("type", "gossip")
            put("hashes", JSONArray(hashes))
            put("timestamp", System.currentTimeMillis())
        }

        val gossipData = gossipJson.toString().toByteArray()

        connectedPeers.forEach { (address, gatt) ->
            try {
                val service = gatt.getService(BEAM_SERVICE_UUID)
                if (service == null) {
                    Log.w(TAG, "⚠️ Service not available for $address - services not discovered yet")
                    return@forEach
                }

                val characteristic = service.getCharacteristic(MESH_RELAY_UUID)
                if (characteristic == null) {
                    Log.w(TAG, "⚠️ Characteristic not available for $address - skipping gossip")
                    return@forEach
                }

                // Check characteristic properties to ensure it's writable
                val properties = characteristic.properties
                if ((properties and BluetoothGattCharacteristic.PROPERTY_WRITE) == 0 &&
                    (properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) == 0) {
                    Log.w(TAG, "⚠️ Characteristic not writable for $address")
                    return@forEach
                }

                characteristic.value = gossipData
                val writeSuccess = gatt.writeCharacteristic(characteristic)
                if (!writeSuccess) {
                    Log.w(TAG, "⚠️ Write characteristic failed for $address")
                }
            } catch (e: Exception) {
                Log.w(TAG, "Failed to send gossip to $address", e)
            }
        }
    }

    // Phase 2.4: Chunk transfer cleanup task
    private fun startChunkTransferCleanup() {
        executor.scheduleAtFixedRate({
            try {
                cleanupStaleChunkTransfers()
            } catch (e: Exception) {
                Log.e(TAG, "Chunk cleanup error", e)
            }
        }, CHUNK_IDLE_TIMEOUT_MS, CHUNK_IDLE_TIMEOUT_MS, TimeUnit.MILLISECONDS)
    }

    // Phase 2.4: Clean up stale chunk transfers
    private fun cleanupStaleChunkTransfers() {
        val now = System.currentTimeMillis()
        val staleKeys = mutableListOf<String>()

        incomingChunks.forEach { (key, buffer) ->
            val timeSinceStart = now - buffer.startedAt
            val timeSinceLastChunk = now - buffer.lastChunkAt

            if (timeSinceStart > CHUNK_TRANSFER_TIMEOUT_MS) {
                Log.w(TAG, "⏱️ Cleaning up stale chunk transfer from $key (timeout: ${timeSinceStart}ms)")
                staleKeys.add(key)
            } else if (timeSinceLastChunk > CHUNK_IDLE_TIMEOUT_MS && buffer.receivedChunks > 0) {
                Log.w(TAG, "⏱️ Cleaning up idle chunk transfer from $key (idle: ${timeSinceLastChunk}ms)")
                staleKeys.add(key)
            }
        }

        staleKeys.forEach { key ->
            incomingChunks.remove(key)
        }

        if (staleKeys.isNotEmpty()) {
            Log.d(TAG, "→ Cleaned up ${staleKeys.size} stale chunk transfer(s)")
        }
    }

    private fun handleIncomingMeshMessage(device: BluetoothDevice, data: ByteArray) {
        try {
            val json = JSONObject(String(data))
            val type = json.optString("type")

            when (type) {
                "gossip" -> handleGossipMessage(device, json)
                "bundle" -> handleIncomingBundleChunk(device, data)
                else -> Log.w(TAG, "Unknown mesh message type: $type")
            }

        } catch (e: Exception) {
            Log.e(TAG, "Failed to handle mesh message", e)
        }
    }

    private fun handleGossipMessage(device: BluetoothDevice, json: JSONObject) {
        val hashes = json.optJSONArray("hashes") ?: return
        val missing = mutableListOf<String>()

        for (i in 0 until hashes.length()) {
            val hash = hashes.getString(i)
            if (!seenBundleHashes.contains(hash)) {
                missing.add(hash)
            }
        }

        if (missing.isNotEmpty()) {
            Log.d(TAG, "Peer ${device.address} has ${missing.size} bundles we don't have")
            // TODO: Request missing bundles
        }
    }

    private fun handleIncomingNotification(device: BluetoothDevice, data: ByteArray) {
        // Handle notifications from peer
        Log.d(TAG, "Received notification from ${device.address}: ${data.size} bytes")
    }

    // ==================== Relay ====================

    private fun relayBundle(bundleId: String, data: ByteArray, hopCount: Int) {
        Log.d(TAG, "Relaying bundle $bundleId (hop $hopCount)")

        val metadata = BundleMetadata(
            bundleId = bundleId,
            data = data,
            timestamp = System.currentTimeMillis(),
            hopCount = hopCount,
            relayedBy = myPubkey ?: "unknown"
        )

        pendingBundles[bundleId] = metadata

        connectedPeers.forEach { (address, gatt) ->
            try {
                sendBundleToPeer(gatt, metadata)
            } catch (e: Exception) {
                Log.w(TAG, "Failed to relay bundle to $address", e)
            }
        }
    }

    // ==================== Utilities ====================

    private fun sendEvent(eventName: String, params: WritableMap?) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    private fun serializeBundle(bundle: ReadableMap): ByteArray {
        return bundle.toHashMap().toString().toByteArray()
    }

    private fun jsonToReactMap(json: JSONObject): WritableMap {
        val map = Arguments.createMap()
        val keys = json.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            val value = json.get(key)
            when (value) {
                is String -> map.putString(key, value)
                is Int -> map.putInt(key, value)
                is Long -> map.putDouble(key, value.toDouble())
                is Double -> map.putDouble(key, value)
                is Boolean -> map.putBoolean(key, value)
                is JSONObject -> map.putMap(key, jsonToReactMap(value))
                is JSONArray -> {
                    val array = Arguments.createArray()
                    for (i in 0 until value.length()) {
                        val item = value.get(i)
                        when (item) {
                            is String -> array.pushString(item)
                            is Int -> array.pushInt(item)
                            is Double -> array.pushDouble(item)
                            is Boolean -> array.pushBoolean(item)
                            is JSONObject -> array.pushMap(jsonToReactMap(item))
                        }
                    }
                    map.putArray(key, array)
                }
            }
        }
        return map
    }

    // ==================== Data Classes ====================

    private data class BundleMetadata(
        val bundleId: String,
        val data: ByteArray,
        val timestamp: Long,
        val hopCount: Int,
        val relayedBy: String
    )

    private data class ChunkBuffer(
        val totalChunks: Int,
        var receivedChunks: Int = 0,
        val chunks: MutableMap<Int, ByteArray> = mutableMapOf(),
        // Phase 2.4: Enhanced chunk tracking
        val transferId: String,
        val startedAt: Long = System.currentTimeMillis(),
        var lastChunkAt: Long = System.currentTimeMillis(),
        val receivedChunkIndices: MutableSet<Int> = mutableSetOf()
    )

    // Phase 2.2: Connection state tracking
    private enum class PeerConnectionState {
        DISCONNECTED,
        CONNECTING,
        CONNECTED,
        DISCONNECTING,
        FAILED,
        RETRYING
    }
}
