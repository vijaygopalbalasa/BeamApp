package com.beam.app.bridge

import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.experimental.and
import kotlin.jvm.Volatile

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
    @Volatile private var currentPaymentRequest: ByteArray = "{}".toByteArray(Charsets.UTF_8)

    // Connected peers
    private val connectedPeers = ConcurrentHashMap<String, BluetoothGatt>() // Only add AFTER services discovered
    private val pendingGattConnections = ConcurrentHashMap<String, BluetoothGatt>() // Temp storage during connection
    private val peerDevices = ConcurrentHashMap<String, BluetoothDevice>()
    private val peerMTUs = ConcurrentHashMap<String, Int>()
    private val servicesDiscovered = ConcurrentHashMap<String, Boolean>()
    private val serviceDiscoveryInProgress = ConcurrentHashMap<String, Boolean>() // Track if discoverServices() called
    private val connectionTimestamps = ConcurrentHashMap<String, Long>()
    private val peerPublicKeys = ConcurrentHashMap<String, String>() // Track each peer's public key
    private val peerReadyEmitted = ConcurrentHashMap<String, Boolean>()

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

    // Phase 2: FIFO Operation Queue
    private val operationQueues = ConcurrentHashMap<String, BleOperationQueue>()
    private val operationLock = Any()
    private val MAX_OPERATION_RETRIES = 3
    private val OPERATION_TIMEOUT_MS = 10000L // 10 seconds per operation

    // Executor for background tasks
    private val executor = Executors.newScheduledThreadPool(4)
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun getName(): String = MODULE_NAME

    init {
        refreshBluetoothState()
    }

    private fun refreshBluetoothState() {
        Log.d(TAG, "→ Refreshing Bluetooth state handles")

        bluetoothManager = reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        bluetoothAdapter = bluetoothManager?.adapter

        // Retry logic for BLE handles (they may be null if Bluetooth is still initializing)
        var attempts = 0
        val maxAttempts = 3
        val delayMs = 300L

        while (attempts < maxAttempts && (advertiser == null || scanner == null)) {
            advertiser = try {
                bluetoothAdapter?.bluetoothLeAdvertiser?.also {
                    Log.d(TAG, "  • bluetoothLeAdvertiser available (attempt ${attempts + 1})")
                }
            } catch (security: SecurityException) {
                Log.w(TAG, "⚠️ Unable to access bluetoothLeAdvertiser – missing permission?", security)
                null
            }

            scanner = try {
                bluetoothAdapter?.bluetoothLeScanner?.also {
                    Log.d(TAG, "  • bluetoothLeScanner available (attempt ${attempts + 1})")
                }
            } catch (security: SecurityException) {
                Log.w(TAG, "⚠️ Unable to access bluetoothLeScanner – missing permission?", security)
                null
            }

            if (advertiser == null || scanner == null) {
                attempts++
                if (attempts < maxAttempts) {
                    Log.w(TAG, "  ⚠️ BLE handles not ready, retrying in ${delayMs}ms (attempt $attempts/$maxAttempts)...")
                    Thread.sleep(delayMs)
                }
            }
        }

        if (advertiser == null) {
            Log.e(TAG, "  ❌ bluetoothLeAdvertiser still null after $maxAttempts attempts!")
        }
        if (scanner == null) {
            Log.e(TAG, "  ❌ bluetoothLeScanner still null after $maxAttempts attempts!")
        }
    }

    // ==================== React Native Bridge Methods ====================

    @ReactMethod
    fun startMeshNode(config: ReadableMap, promise: Promise) {
        try {
            refreshBluetoothState()
            if (isActive) {
                Log.w(TAG, "❌ Mesh node already active")
                promise.reject("MESH_ERROR", "Mesh node already active")
                return
            }

            // ========== CRITICAL: Clear all previous connection state ==========
            Log.d(TAG, "→ Clearing all previous connection state...")

            // 1. Track disconnection completion
            val disconnectLatch = CountDownLatch(connectedPeers.size + pendingGattConnections.size)
            val disconnectCallback = object : BluetoothGattCallback() {
                override fun onConnectionStateChange(
                    gatt: BluetoothGatt,
                    status: Int,
                    newState: Int
                ) {
                    if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                        Log.d(TAG, "  • GATT disconnected: ${gatt.device.address}")
                        disconnectLatch.countDown()
                    }
                }
            }

            // 2. Disconnect all active GATT connections
            connectedPeers.values.forEach { gatt ->
                try {
                    Log.d(TAG, "  • Disconnecting GATT: ${gatt.device.address}")
                    runOnMainThread {
                        gatt.disconnect()
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Error disconnecting GATT", e)
                    disconnectLatch.countDown() // Count down even on error
                }
            }

            pendingGattConnections.values.forEach { gatt ->
                try {
                    runOnMainThread {
                        gatt.disconnect()
                    }
                } catch (e: Exception) {
                    disconnectLatch.countDown()
                }
            }

            // 3. Wait for all disconnects (max 2 seconds)
            val allDisconnected = disconnectLatch.await(2000, TimeUnit.MILLISECONDS)
            if (!allDisconnected) {
                Log.w(TAG, "⚠️ Not all GATTs disconnected cleanly - forcing cleanup")
            }

            // 4. Force close all GATT objects
            connectedPeers.values.forEach { gatt ->
                try {
                    runOnMainThread {
                        gatt.close()
                    }
                } catch (e: Exception) {}
            }

            pendingGattConnections.values.forEach { gatt ->
                try {
                    runOnMainThread {
                        gatt.close()
                    }
                } catch (e: Exception) {}
            }

            // 5. Clear all data structures
            connectedPeers.clear()
            pendingGattConnections.clear()
            peerConnectionStates.clear()
            connectionRetryCount.clear()
            connectionTimeouts.clear()
            peerDevices.clear()
            peerMTUs.clear()
            connectionTimestamps.clear()
            peerPublicKeys.clear()
            peerReadyEmitted.clear()
            peerReadyEmitted.clear()
            connectionTimestamps.clear()
            peerPublicKeys.clear()
            servicesDiscovered.clear()
            serviceDiscoveryInProgress.clear()

            // FORCE STOP previous BLE operations (prevents stale scanner/advertiser from previous mode)
            Log.d(TAG, "→ Force stopping any previous BLE operations...")
            try {
                scanner?.stopScan(scanCallback)
                Log.d(TAG, "  ✅ Scanner stopped")
            } catch (e: Exception) {
                Log.w(TAG, "  ⚠️ Scanner stop failed (may not have been running): ${e.message}")
            }

            try {
                advertiser?.stopAdvertising(advertiseCallback)
                Log.d(TAG, "  ✅ Advertiser stopped")
            } catch (e: Exception) {
                Log.w(TAG, "  ⚠️ Advertiser stop failed (may not have been running): ${e.message}")
            }

            // Give Bluetooth stack time to release resources
            Thread.sleep(500)
            Log.d(TAG, "→ BLE operations cleanup complete")

            Log.d(TAG, "✅ Connection state cleared - ready for fresh connections")

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

            // Start GATT server (both roles need this for data transfer)
            Log.d(TAG, "→ Starting GATT server...")
            startGattServer()

            // Role-specific behavior to prevent connection race conditions
            Log.d(TAG, "========== ENFORCING NODE TYPE BEHAVIOR ==========")
            Log.d(TAG, "Node Type: $nodeType")
            when (nodeType) {
                "merchant" -> {
                    Log.d(TAG, "  → Merchant will: ADVERTISE ONLY (no scanning)")
                    Log.d(TAG, "  → Merchant will: Wait for customer to connect")
                    // Merchant = PERIPHERAL ONLY (advertises, waits for customer to connect)
                    Log.d(TAG, "→ Starting MERCHANT mode (peripheral only - NO SCANNING)")
                    try {
                        startAdvertising()
                        Log.d(TAG, "  ✅ Merchant advertising started successfully")
                    } catch (e: Exception) {
                        Log.e(TAG, "❌ CRITICAL: Failed to start merchant advertising!", e)
                        throw e
                    }
                    // Merchants do NOT scan - they only advertise and wait
                }
                "customer" -> {
                    Log.d(TAG, "  → Customer will: SCAN ONLY (no advertising)")
                    Log.d(TAG, "  → Customer will: Connect to merchant")
                    // Customer = CENTRAL ONLY (scans and initiates connection)
                    Log.d(TAG, "→ Starting CUSTOMER mode (central only - NO ADVERTISING)")
                    try {
                        startScanning()
                        Log.d(TAG, "  ✅ Customer scanning started successfully")
                    } catch (e: Exception) {
                        Log.e(TAG, "❌ CRITICAL: Failed to start customer scanning!", e)
                        throw e
                    }
                    // Customers do NOT advertise - they only scan and connect
                }
                else -> {
                    Log.d(TAG, "  → Relay will: BOTH advertise and scan")
                    // Relay mode = both peripheral and central
                    Log.d(TAG, "→ Starting RELAY mode (both peripheral and central)")
                    try {
                        startAdvertising()
                        Log.d(TAG, "  ✅ Relay advertising started successfully")
                    } catch (e: Exception) {
                        Log.e(TAG, "❌ CRITICAL: Failed to start relay advertising!", e)
                        throw e
                    }
                    try {
                        startScanning()
                        Log.d(TAG, "  ✅ Relay scanning started successfully")
                    } catch (e: Exception) {
                        Log.e(TAG, "❌ CRITICAL: Failed to start relay scanning!", e)
                        throw e
                    }
                }
            }
            Log.d(TAG, "========================================")

            // Start gossip protocol
            Log.d(TAG, "→ Starting gossip protocol...")
            startGossipProtocol()

            // Phase 2.4: Clear any stale chunks from previous session
            Log.d(TAG, "→ Clearing stale chunk buffers...")
            incomingChunks.clear()

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

            val event = Arguments.createMap().apply {
                putString("status", "started")
                putString("nodeType", nodeType)
                putString("pubkey", myPubkey)
            }

            sendEvent("MeshNodeStarted", event)

        } catch (e: Exception) {
            Log.e(TAG, "❌ FATAL: Failed to start mesh node", e)
            promise.reject("MESH_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun stopMeshNode(promise: Promise) {
        try {
            refreshBluetoothState()
            if (!isActive) {
                Log.w(TAG, "❌ Mesh node not active - nothing to stop")
                promise.reject("MESH_ERROR", "Mesh node not active")
                return
            }

            Log.d(TAG, "========== STOPPING MESH NODE ==========")

            // Stop scanning and advertising
            Log.d(TAG, "→ Stopping BLE scanner...")
            runOnMainThread {
                scanner?.stopScan(scanCallback)
            }
            val scanStoppedEvent = Arguments.createMap().apply {
                putDouble("timestamp", System.currentTimeMillis().toDouble())
            }
            sendEventToJS("MeshScanStopped", scanStoppedEvent)

            Log.d(TAG, "→ Stopping BLE advertiser...")
            runOnMainThread {
                advertiser?.stopAdvertising(advertiseCallback)
            }
            val advertisingStoppedEvent = Arguments.createMap().apply {
                putDouble("timestamp", System.currentTimeMillis().toDouble())
            }
            sendEvent("AdvertisingStopped", advertisingStoppedEvent)

            // Disconnect all peers (both connected and pending)
            Log.d(TAG, "→ Disconnecting ${connectedPeers.size} connected peers...")
            connectedPeers.values.forEach { gatt ->
                try {
                    runOnMainThread {
                        try {
                            gatt.disconnect()
                        } finally {
                            gatt.close()
                        }
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "  Error disconnecting peer", e)
                }
            }
            connectedPeers.clear()

            Log.d(TAG, "→ Closing ${pendingGattConnections.size} pending connections...")
            pendingGattConnections.values.forEach { gatt ->
                try {
                    runOnMainThread {
                        try {
                            gatt.disconnect()
                        } finally {
                            gatt.close()
                        }
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "  Error closing pending connection", e)
                }
            }
            pendingGattConnections.clear()
            servicesDiscovered.clear()
            serviceDiscoveryInProgress.clear()

            // Close GATT server
            Log.d(TAG, "→ Closing GATT server...")
            runOnMainThread {
                gattServer?.close()
            }
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
            val event = Arguments.createMap().apply {
                putString("status", "stopped")
            }
            sendEvent("MeshNodeStopped", event)

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
            if (bundleData.hasKey("token")) {
                val tokenMap = bundleData.getMap("token")
                Log.d(TAG, "Bundle token map: ${tokenMap?.toHashMap()}")
            } else {
                Log.w(TAG, "Bundle missing token field before serialization")
            }
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
            Log.d(TAG, "Serialized bundle payload: ${String(serialized)}")
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

            // Extract merchant pubkey from bundle to verify target
            val merchantPubkey = bundleData.getString("merchant_pubkey")
            val merchantPrefix = merchantPubkey?.let { if (it.length > 16) it.substring(0, 16) else it }
            if (merchantPrefix != null) {
                Log.d(TAG, "Target merchant prefix: $merchantPrefix")
            }

            // Determine eligible peers (services discovered & identity matches)
            val eligiblePeers = connectedPeers.entries.filter { entry ->
                val address = entry.key
                val peerPubkey = peerPublicKeys[address]

                if (merchantPrefix != null && peerPubkey != null) {
                    if (peerPubkey != merchantPrefix) {
                        Log.d(TAG, "→ Skipping peer $address (pubkey mismatch: expected=$merchantPrefix, got=$peerPubkey)")
                    return@filter false
                }
                }
                true
            }

            if (eligiblePeers.isEmpty()) {
                val reason = if (merchantPubkey != null) {
                    "No connected peers matched merchant pubkey $merchantPubkey"
                } else if (connectedPeers.isEmpty()) {
                    "No connected peers available"
                } else {
                    "Connected peers not ready for transfer"
                }
                Log.w(TAG, "⚠️ Broadcast aborted: $reason")

                val errorResult = Arguments.createMap().apply {
                    putBoolean("success", false)
                    putString("bundleId", bundleId)
                    putString("error", reason)
                    putDouble("timestamp", System.currentTimeMillis().toDouble())
                }
                sendEventToJS("MeshBundleBroadcast", errorResult)
                promise.reject("MESH_NO_READY_PEERS", reason)
                return
            }

            // Send to eligible peers
            var peersReached = 0
            eligiblePeers.forEach { (address, gatt) ->
                try {
                    val peerPubkey = peerPublicKeys[address]

                    Log.d(TAG, "→ Sending bundle to peer: $address${if (peerPubkey != null) " (pubkey=$peerPubkey)" else ""}")
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

            val broadcastEvent = Arguments.createMap().apply {
                putBoolean("success", peersReached > 0)
                putInt("peersReached", peersReached)
                putString("bundleId", bundleId)
                putDouble("timestamp", System.currentTimeMillis().toDouble())
            }
            sendEventToJS("MeshBundleBroadcast", broadcastEvent)

        } catch (e: Exception) {
            Log.e(TAG, "❌ Failed to broadcast bundle", e)
            val broadcastEvent = Arguments.createMap().apply {
                putBoolean("success", false)
                putString("error", e.message ?: "unknown")
                putDouble("timestamp", System.currentTimeMillis().toDouble())
            }
            sendEventToJS("MeshBundleBroadcast", broadcastEvent)
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
    fun updatePaymentRequest(paymentRequest: ReadableMap, promise: Promise) {
        try {
            val json = readableMapToJson(paymentRequest)
            val payload = json.toString().toByteArray(Charsets.UTF_8)
            updatePaymentRequestCharacteristic(payload)
            Log.d(TAG, "✅ Payment request characteristic updated (${payload.size} bytes)")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "❌ Failed to update payment request", e)
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

        gattServer = runOnMainThreadBlocking(timeoutMs = 3000) {
            bluetoothManager?.openGattServer(reactContext, gattServerCallback)
        }

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
        paymentRequestChar.value = currentPaymentRequest
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

        val serviceAdded = runOnMainThreadBlocking(timeoutMs = 2000) {
            gattServer?.addService(service)
        }
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
                    markConnectionEvent(device.address)

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
                    markConnectionEvent(device.address)

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
                        currentPaymentRequest
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
                    if (isLikelyChunkPayload(value)) {
                        Log.d(TAG, "→ Mesh relay payload classified as chunk data (${value.size} bytes)")
                        handleIncomingBundleChunk(device, value)
                    } else {
                        Log.d(TAG, "→ Mesh relay payload classified as JSON message (${value.size} bytes)")
                        handleIncomingMeshMessage(device, value)
                    }
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
            val error = "❌ CRITICAL: Cannot start advertising - Bluetooth LE Advertiser is null! Bluetooth may not be ready or enabled."
            Log.e(TAG, error)
            throw IllegalStateException(error)
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
            .setIncludeDeviceName(false)
            .addServiceUuid(ParcelUuid(BEAM_SERVICE_UUID))
            .build()

        // Include merchant pubkey in scan response for verification
        // Use only first 16 bytes of pubkey to fit in BLE advertising limits
        val scanResponse = AdvertiseData.Builder()
            .setIncludeDeviceName(false) // Don't include device name to save space
            .apply {
                // Add merchant pubkey as manufacturer data for verification
                if (myPubkey != null && nodeType == "merchant") {
                    // Use a custom manufacturer ID (0xFFFF is reserved for internal use)
                    // Use first 16 chars of pubkey (sufficient for identification)
                    val shortPubkey = if (myPubkey!!.length > 16) myPubkey!!.substring(0, 16) else myPubkey!!
                    val pubkeyBytes = shortPubkey.toByteArray(Charsets.UTF_8)
                    addManufacturerData(0xFFFF, pubkeyBytes)
                    Log.d(TAG, "→ Including merchant pubkey in advertisement: $shortPubkey (first 16 chars)")
                }
            }
            .build()

        Log.d(TAG, "→ Advertising Service UUID: $BEAM_SERVICE_UUID")
        Log.d(TAG, "→ Device Name Included: false (kept under 31 bytes)")
        Log.d(TAG, "→ Scan Response: Device name + pubkey")

        runOnMainThread {
            advertiser?.startAdvertising(settings, data, scanResponse, advertiseCallback)
        }
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
            val error = "❌ CRITICAL: Cannot start scanning - Bluetooth LE Scanner is null! Bluetooth may not be ready or enabled."
            Log.e(TAG, error)
            throw IllegalStateException(error)
        }

        val scanSettings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        Log.d(TAG, "→ Scan Mode: LOW_LATENCY (fastest discovery)")

        runOnMainThread {
            scanner?.startScan(null, scanSettings, scanCallback)
        }
        Log.d(TAG, "✅ BLE scanning started - listening for nearby Beam devices...")
        Log.d(TAG, "========================================")

        val scanStartedEvent = Arguments.createMap().apply {
            putDouble("timestamp", System.currentTimeMillis().toDouble())
        }
        sendEventToJS("MeshScanStarted", scanStartedEvent)
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
            val serviceUuids = result.scanRecord?.serviceUuids ?: emptyList<ParcelUuid>()
            if (serviceUuids.isEmpty()) {
                Log.d(TAG, "  • No service UUIDs advertised")
            } else {
                serviceUuids.forEach { uuid ->
                    Log.d(TAG, "  • Advertised Service: $uuid")
                }
            }

            val hasBeamService = serviceUuids.any { it.uuid == BEAM_SERVICE_UUID }
            if (!hasBeamService) {
                Log.d(TAG, "⚠️ Skipping device $address – Beam service UUID not found")
                Log.d(TAG, "========================================")
                return
            }

            // Extract merchant pubkey from manufacturer data if present
            val manufacturerData = result.scanRecord?.getManufacturerSpecificData(0xFFFF)
            if (manufacturerData != null) {
                val pubkey = String(manufacturerData, Charsets.UTF_8)
                peerPublicKeys[address] = pubkey
                Log.d(TAG, "✅ Extracted peer pubkey: $pubkey")
            } else {
                Log.d(TAG, "ℹ️ No pubkey in advertisement (non-merchant or old version)")
            }

            val serviceArray = Arguments.createArray()
            serviceUuids.forEach { uuid ->
                serviceArray.pushString(uuid.uuid.toString())
            }

            val scanEvent = Arguments.createMap().apply {
                putString("address", address)
                putString("name", device.name ?: "Unknown")
                putInt("rssi", result.rssi)
                putDouble("timestamp", System.currentTimeMillis().toDouble())
                putInt("callbackType", callbackType)
                putArray("serviceUuids", serviceArray)
            }
            sendEventToJS("MeshScanResult", scanEvent)

            // Check if already connected or connecting
            val connectionState = peerConnectionStates[address]
            if (connectionState == PeerConnectionState.CONNECTED ||
                connectionState == PeerConnectionState.CONNECTING) {
                // Check if we have a working GATT connection (don't trust Android's BluetoothManager)
                val hasWorkingGatt = connectedPeers[address] != null || pendingGattConnections[address] != null
                val lastEvent = connectionTimestamps[address] ?: 0L
                val ageMs = System.currentTimeMillis() - lastEvent
                val discoveryInProgress = serviceDiscoveryInProgress[address] == true

                if (hasWorkingGatt && ageMs < 5000) {
                    Log.d(TAG, "⚠️ Already $connectionState with working GATT (age ${ageMs}ms) - skipping")
                    Log.d(TAG, "========================================")
                    return
                }

                // CRITICAL: Don't clean up if service discovery is in progress
                if (discoveryInProgress) {
                    Log.d(TAG, "⚠️ Service discovery in progress for $address - waiting for callback (age ${ageMs}ms)")
                    Log.d(TAG, "========================================")
                    return
                }

                Log.w(TAG, "⚠️ Connection state=$connectionState but no working GATT or age=${ageMs}ms; cleaning up stale entry")
                cleanupStaleConnectionState(address)
                peerConnectionStates[address] = PeerConnectionState.DISCONNECTED
                Log.d(TAG, "→ Cleaned up stale connection, will retry")
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

            val eventParams = Arguments.createMap().apply {
                putInt("errorCode", errorCode)
                putString("errorMessage", errorMessage)
                putDouble("timestamp", System.currentTimeMillis().toDouble())
            }
            sendEventToJS("MeshScanFailed", eventParams)
        }
    }

    // ==================== Peer Connection (Central Mode) ====================

    /**
     * Verify connection state with Android BLE stack
     * Handles edge cases and device-specific bugs
     */
    private fun verifyConnectionState(device: BluetoothDevice): Pair<Boolean, String> {
        val address = device.address

        synchronized(peerConnectionStates) {
            val javaState = peerConnectionStates[address]

            // 1. Check if BluetoothManager is available
            val btManager = bluetoothManager
            if (btManager == null) {
                Log.w(TAG, "⚠️ BluetoothManager is null - cannot verify Android state")
                // Trust Java state if Android state unavailable
                return Pair(javaState == PeerConnectionState.CONNECTED, "BluetoothManager unavailable")
            }

            // 2. Get Android BLE stack state (with error handling)
            val androidState = try {
                btManager.getConnectionState(device, BluetoothProfile.GATT)
            } catch (e: SecurityException) {
                Log.w(TAG, "⚠️ No permission to check connection state", e)
                return Pair(javaState == PeerConnectionState.CONNECTED, "Permission denied")
            } catch (e: Exception) {
                Log.w(TAG, "⚠️ Error checking connection state", e)
                return Pair(javaState == PeerConnectionState.CONNECTED, "Error checking state")
            }

            // 3. Compare states and detect mismatch
            val javaConnected = javaState == PeerConnectionState.CONNECTED
            val androidConnected = androidState == BluetoothProfile.STATE_CONNECTED

            if (javaConnected != androidConnected) {
                Log.w(TAG, "⚠️ STATE MISMATCH DETECTED:")
                Log.w(TAG, "  Java state: $javaState")
                Log.w(TAG, "  Android state: ${stateToString(androidState)}")

                // 4. Clean up stale Java state
                if (javaConnected && !androidConnected) {
                    Log.w(TAG, "  → Cleaning stale Java connection state")
                    cleanupStaleConnectionState(address)
                    Log.w(TAG, "  ✅ Stale state cleaned")
                    return Pair(false, "State mismatch - cleaned stale connection")
                }
            }

            // 5. Only consider connected if BOTH agree
            return Pair(javaConnected && androidConnected, "States synchronized")
        }
    }

    /**
     * Convert Android BLE state to human-readable string
     */
    private fun stateToString(state: Int): String {
        return when (state) {
            BluetoothProfile.STATE_CONNECTED -> "CONNECTED"
            BluetoothProfile.STATE_CONNECTING -> "CONNECTING"
            BluetoothProfile.STATE_DISCONNECTED -> "DISCONNECTED"
            BluetoothProfile.STATE_DISCONNECTING -> "DISCONNECTING"
            else -> "UNKNOWN($state)"
        }
    }

    /**
     * Clean up stale connection state for a specific address
     */
    private fun cleanupStaleConnectionState(address: String) {
        synchronized(peerConnectionStates) {
            connectedPeers.remove(address)?.let { gatt ->
                try {
                    gatt.disconnect()
                    gatt.close()
                } catch (e: Exception) {
                    Log.w(TAG, "Error cleaning stale GATT", e)
                }
            }

            pendingGattConnections.remove(address)?.let { gatt ->
                try {
                    gatt.disconnect()
                    gatt.close()
                } catch (e: Exception) {
                    Log.w(TAG, "Error cleaning stale pending GATT", e)
                }
            }

            peerConnectionStates.remove(address)
            servicesDiscovered.remove(address)
            connectionRetryCount.remove(address)
            connectionTimeouts.remove(address)
            connectionTimestamps.remove(address)
            peerPublicKeys.remove(address)
            serviceDiscoveryInProgress.remove(address)
            peerReadyEmitted.remove(address)
        }
    }

    private fun markConnectionEvent(address: String) {
        connectionTimestamps[address] = System.currentTimeMillis()
    }

    private fun emitPeerReadyEvent(address: String, name: String?, pubkey: String?) {
        if (peerReadyEmitted.put(address, true) == true) {
            Log.d(TAG, "Peer readiness already emitted for $address - skipping")
            return
        }

        val map = Arguments.createMap().apply {
            putString("address", address)
            name?.let { putString("name", it) }
            pubkey?.let { putString("pubkey", if (it.length > 16) it.substring(0, 16) else it) }
            putDouble("timestamp", System.currentTimeMillis().toDouble())
        }

        Log.d(TAG, "📡 Emitting PeerReadyForTransfer for $address (pubkey=${map.getString("pubkey")})")
        sendEvent("PeerReadyForTransfer", map)
    }

    // ============================================================================
    // Phase 2: FIFO Operation Queue Management
    // ============================================================================

    /**
     * Enqueue a BLE operation for execution
     * Operations are executed in FIFO order, one at a time per device
     */
    private fun enqueueOperation(operation: BleOperation) {
        val queue = operationQueues.getOrPut(operation.deviceAddress) {
            BleOperationQueue(operation.deviceAddress)
        }

        synchronized(queue) {
            queue.operations.add(operation)
            Log.d(TAG, "📥 Enqueued ${operation::class.simpleName} for ${operation.deviceAddress} (queue size: ${queue.operations.size})")
        }

        // Start processing if not already running
        processNextOperation(operation.deviceAddress)
    }

    /**
     * Process next operation in queue
     * Called after each operation completes (success or failure)
     */
    private fun processNextOperation(deviceAddress: String) {
        val queue = operationQueues[deviceAddress] ?: return

        synchronized(queue) {
            if (queue.isProcessing) {
                Log.d(TAG, "⏸️ Queue for $deviceAddress already processing")
                return
            }

            if (queue.operations.isEmpty()) {
                Log.d(TAG, "✅ Queue for $deviceAddress empty - done")
                operationQueues.remove(deviceAddress)
                return
            }

            queue.isProcessing = true
            val operation = queue.operations.removeAt(0)

            Log.d(TAG, "⚙️ Processing ${operation::class.simpleName} for $deviceAddress (${queue.operations.size} remaining)")

            executor.execute {
                try {
                    val success = executeOperation(operation)

                    if (!success && operation.retryCount < MAX_OPERATION_RETRIES) {
                        // Retry operation with incremented counter
                        val retriedOp = when (operation) {
                            is BleOperation.Connect -> operation.copy(retryCount = operation.retryCount + 1)
                            is BleOperation.Disconnect -> operation.copy(retryCount = operation.retryCount + 1)
                            is BleOperation.DiscoverServices -> operation.copy(retryCount = operation.retryCount + 1)
                            is BleOperation.ReadCharacteristic -> operation.copy(retryCount = operation.retryCount + 1)
                            is BleOperation.WriteCharacteristic -> operation.copy(retryCount = operation.retryCount + 1)
                            is BleOperation.MtuRequest -> operation.copy(retryCount = operation.retryCount + 1)
                        }

                        Log.w(TAG, "⚠️ Operation failed, retrying (${retriedOp.retryCount}/$MAX_OPERATION_RETRIES)")

                        synchronized(queue) {
                            queue.operations.add(0, retriedOp) // Add back to front of queue
                            queue.isProcessing = false
                        }
                    } else {
                        if (!success) {
                            Log.e(TAG, "❌ Operation failed after $MAX_OPERATION_RETRIES retries")
                        }

                        synchronized(queue) {
                            queue.isProcessing = false
                        }
                    }

                    // Process next operation
                    processNextOperation(deviceAddress)

                } catch (e: Exception) {
                    Log.e(TAG, "❌ Error executing BLE operation", e)
                    synchronized(queue) {
                        queue.isProcessing = false
                    }
                    processNextOperation(deviceAddress)
                }
            }
        }
    }

    /**
     * Execute a BLE operation
     * @return true if operation initiated successfully, false if should retry
     */
    private fun executeOperation(operation: BleOperation): Boolean {
        return when (operation) {
            is BleOperation.Connect -> {
                val device = peerDevices[operation.deviceAddress]
                if (device == null) {
                    Log.e(TAG, "❌ Device not found for Connect operation")
                    return false
                }

                Log.d(TAG, "→ Executing Connect for ${operation.deviceAddress}")
                val gatt = runOnMainThreadBlocking(timeoutMs = 4000) {
                    device.connectGatt(reactContext, false, gattClientCallback, BluetoothDevice.TRANSPORT_LE)
                }
                if (gatt == null) {
                    Log.e(TAG, "❌ connectGatt returned NULL")
                    return false
                }

                pendingGattConnections[operation.deviceAddress] = gatt
                peerConnectionStates[operation.deviceAddress] = PeerConnectionState.CONNECTING
                true // Wait for onConnectionStateChange callback
            }

            is BleOperation.Disconnect -> {
                val gatt = connectedPeers[operation.deviceAddress]
                if (gatt == null) {
                    Log.w(TAG, "⚠️ GATT not found for Disconnect operation")
                    return true // Already disconnected
                }

                Log.d(TAG, "→ Executing Disconnect for ${operation.deviceAddress}")
                runOnMainThread {
                    gatt.disconnect()
                }
                true // Wait for callback
            }

            is BleOperation.DiscoverServices -> {
                // Check both pending and connected peers (happens right after connection)
                val gatt = pendingGattConnections[operation.deviceAddress] ?: connectedPeers[operation.deviceAddress]
                if (gatt == null) {
                    Log.e(TAG, "❌ GATT not found for DiscoverServices")
                    return false
                }

                // CRITICAL: Only call discoverServices() once per connection
                if (serviceDiscoveryInProgress[operation.deviceAddress] == true) {
                    Log.d(TAG, "⚠️ Service discovery already in progress for ${operation.deviceAddress} - skipping")
                    return false // Don't retry, wait for callback
                }

                if (servicesDiscovered[operation.deviceAddress] == true) {
                    Log.d(TAG, "✅ Services already discovered for ${operation.deviceAddress} - skipping")
                    return false // Already done
                }

                Log.d(TAG, "→ Executing DiscoverServices for ${operation.deviceAddress}")
                serviceDiscoveryInProgress[operation.deviceAddress] = true
                runOnMainThread {
                    mainHandler.postDelayed({
                        val success = gatt.discoverServices()
                        if (!success) {
                            Log.e(TAG, "❌ discoverServices() returned false!")
                            serviceDiscoveryInProgress.remove(operation.deviceAddress)
                        }
                    }, 200)
                }
                true
            }

            is BleOperation.ReadCharacteristic -> {
                val gatt = connectedPeers[operation.deviceAddress]
                if (gatt == null) {
                    Log.e(TAG, "❌ GATT not found for ReadCharacteristic")
                    return false
                }

                val service = gatt.getService(operation.serviceUuid)
                if (service == null) {
                    Log.e(TAG, "❌ Service not found: ${operation.serviceUuid}")
                    return false
                }

                val char = service.getCharacteristic(operation.charUuid)
                if (char == null) {
                    Log.e(TAG, "❌ Characteristic not found: ${operation.charUuid}")
                    return false
                }

                Log.d(TAG, "→ Executing ReadCharacteristic for ${operation.deviceAddress}")
                runOnMainThread {
                    gatt.readCharacteristic(char)
                }
                true
            }

            is BleOperation.WriteCharacteristic -> {
                val gatt = connectedPeers[operation.deviceAddress]
                if (gatt == null) {
                    Log.e(TAG, "❌ GATT not found for WriteCharacteristic")
                    return false
                }

                val service = gatt.getService(operation.serviceUuid)
                if (service == null) {
                    Log.e(TAG, "❌ Service not found: ${operation.serviceUuid}")
                    return false
                }

                val char = service.getCharacteristic(operation.charUuid)
                if (char == null) {
                    Log.e(TAG, "❌ Characteristic not found: ${operation.charUuid}")
                    return false
                }

                Log.d(TAG, "→ Executing WriteCharacteristic for ${operation.deviceAddress} (${operation.data.size} bytes)")
                char.value = operation.data
                runOnMainThread {
                    gatt.writeCharacteristic(char)
                }
                true
            }

            is BleOperation.MtuRequest -> {
                // Check both pending and connected peers (MTU happens before service discovery)
                val gatt = pendingGattConnections[operation.deviceAddress] ?: connectedPeers[operation.deviceAddress]
                if (gatt == null) {
                    Log.e(TAG, "❌ GATT not found for MtuRequest")
                    return false
                }

                Log.d(TAG, "→ Executing MtuRequest for ${operation.deviceAddress}: ${operation.mtuSize}")
                runOnMainThread {
                    gatt.requestMtu(operation.mtuSize)
                }
                true
            }
        }
    }

    /**
     * Mark current operation as complete and process next
     * Call this from GATT callbacks after operation completes
     */
    private fun completeCurrentOperation(deviceAddress: String, success: Boolean) {
        val queue = operationQueues[deviceAddress] ?: return

        synchronized(queue) {
            queue.isProcessing = false
        }

        if (success) {
            Log.d(TAG, "✅ Operation completed successfully for $deviceAddress")
        } else {
            Log.w(TAG, "⚠️ Operation completed with failure for $deviceAddress")
        }

        processNextOperation(deviceAddress)
    }

    // ============================================================================
    // Phase 2.2: Connection Retry Management
    // ============================================================================

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
                markConnectionEvent(address)

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

                // Verify state before connecting (with synchronized state check)
                val (isConnected, reason) = verifyConnectionState(device)

                if (isConnected) {
                    Log.d(TAG, "⚠️ Already CONNECTED (verified) - skipping. Reason: $reason")
                    return@execute
                }

                val currentState = peerConnectionStates[address]

                // Phase 2.2: Skip if already connecting
                if (currentState == PeerConnectionState.CONNECTING) {
                    Log.d(TAG, "⚠️ Already CONNECTING to $address - skipping")
                    return@execute
                }

                Log.d(TAG, "========== INITIATING GATT CONNECTION ==========")
                Log.d(TAG, "Target Device: $address (${device.name ?: "Unknown"})")
                Log.d(TAG, "Transport: BLE (Low Energy)")
                Log.d(TAG, "Auto Connect: false (immediate connection)")
                Log.d(TAG, "→ Connection check passed: $reason")

                val retryCount = connectionRetryCount.getOrDefault(address, 0)
                if (retryCount > 0) {
                    Log.d(TAG, "Retry Attempt: $retryCount/$MAX_RETRY_ATTEMPTS")
                }

                // Phase 2.2: Update connection state and start timeout monitor
                peerDevices[address] = device
                startConnectionTimeoutMonitor(address)

                // Phase 2: Use FIFO queue for connection
                enqueueOperation(BleOperation.Connect(address))
                Log.d(TAG, "→ Connection queued, will execute via FIFO queue")
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
                        markConnectionEvent(address)

                        // CRITICAL: Store GATT in pending connections so operations can find it
                        pendingGattConnections[address] = gatt
                        Log.d(TAG, "→ Stored GATT in pending connections")

                        // Phase 2: Mark Connect operation complete
                        completeCurrentOperation(address, true)

                        // Phase 2: Queue MTU and service discovery
                        Log.d(TAG, "→ Queuing MTU request: $MAX_MTU_SIZE bytes")
                        enqueueOperation(BleOperation.MtuRequest(address, MAX_MTU_SIZE))

                        Log.d(TAG, "→ Queuing service discovery")
                        enqueueOperation(BleOperation.DiscoverServices(address))
                    } else {
                        Log.e(TAG, "❌ Connection established but status is not SUCCESS: $status")

                        // Phase 2.2: Retry on failed connection status
                        peerConnectionStates[address] = PeerConnectionState.FAILED
                        pendingGattConnections.remove(address)
                        connectedPeers.remove(address)
                        servicesDiscovered.remove(address)
                        gatt.close()
                        markConnectionEvent(address)

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
                    serviceDiscoveryInProgress.remove(address)  // CRITICAL: Clear discovery flag on disconnect
                    gatt.close()
                    Log.d(TAG, "→ GATT connection closed and cleaned up")
                    markConnectionEvent(address)

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
                // Phase 2: Mark MTU operation complete
                completeCurrentOperation(gatt.device.address, true)
            } else {
                // Phase 2: Mark MTU operation failed
                completeCurrentOperation(gatt.device.address, false)
            }
            Log.d(TAG, "========================================")
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            val address = gatt.device.address
            Log.d(TAG, "========== Services Discovered ==========")
            Log.d(TAG, "Device: $address")
            Log.d(TAG, "Status: ${if (status == BluetoothGatt.GATT_SUCCESS) "SUCCESS" else "FAILED ($status)"}")

            // Clear the in-progress flag
            serviceDiscoveryInProgress.remove(address)

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
                        markConnectionEvent(address)

                        Log.d(TAG, "✅ Device $address is now FULLY CONNECTED and ready for transfers")
                        Log.d(TAG, "Total connected peers: ${connectedPeers.size}")

                        // Phase 2: Mark service discovery complete
                        completeCurrentOperation(address, true)

                        // Notify React Native of connection (readiness emitted after payment request read)
                        sendEvent("PeerConnected", Arguments.createMap().apply {
                            putString("address", address)
                            putString("name", gatt.device.name ?: "Unknown")
                        })

                        // Read payment request characteristic to capture merchant identity before declaring readiness
                        enqueueOperation(
                            BleOperation.ReadCharacteristic(
                                deviceAddress = address,
                                serviceUuid = BEAM_SERVICE_UUID,
                                charUuid = PAYMENT_REQUEST_UUID,
                            ),
                        )
                    } else {
                        Log.e(TAG, "❌ Required characteristics NOT found!")
                        if (meshRelayChar == null) Log.e(TAG, "  Missing: MESH_RELAY_UUID")
                        if (paymentBundleChar == null) Log.e(TAG, "  Missing: PAYMENT_BUNDLE_UUID")

                        // Disconnect and retry
                        peerConnectionStates[address] = PeerConnectionState.FAILED
                        completeCurrentOperation(address, false) // Phase 2
                        gatt.disconnect()
                        gatt.close()
                        pendingGattConnections.remove(address)
                        markConnectionEvent(address)

                        peerDevices[address]?.let { device ->
                            scheduleConnectionRetry(device)
                        }
                    }
                } else {
                    Log.w(TAG, "⚠️ Beam service NOT found!")

                    // Disconnect and retry
                    peerConnectionStates[address] = PeerConnectionState.FAILED
                    completeCurrentOperation(address, false) // Phase 2
                    gatt.disconnect()
                    gatt.close()
                    pendingGattConnections.remove(address)
                    markConnectionEvent(address)

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
                markConnectionEvent(address)

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

        override fun onCharacteristicWrite(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            status: Int
        ) {
            val address = gatt.device.address
            Log.d(TAG, "========== Characteristic Write ==========")
            Log.d(TAG, "Device: $address")
            Log.d(TAG, "Characteristic: ${characteristic.uuid}")
            Log.d(TAG, "Status: ${if (status == BluetoothGatt.GATT_SUCCESS) "SUCCESS" else "FAILED ($status)"}")
            Log.d(TAG, "========================================")

            completeCurrentOperation(address, status == BluetoothGatt.GATT_SUCCESS)
        }

        override fun onCharacteristicRead(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            val address = gatt.device.address
            val uuid = characteristic.uuid

            Log.d(TAG, "========== Characteristic Read ==========")
            Log.d(TAG, "Device: $address")
            Log.d(TAG, "Characteristic: $uuid")
            Log.d(TAG, "Status: ${if (status == BluetoothGatt.GATT_SUCCESS) "SUCCESS" else "FAILED ($status)"}")

            if (uuid == PAYMENT_REQUEST_UUID) {
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    val value = characteristic.value
                    val jsonString = value?.let { String(it, Charsets.UTF_8) }
                    Log.d(TAG, "Payment request payload: $jsonString")

                    var merchantPubkey: String? = null
                    if (!jsonString.isNullOrEmpty()) {
                        try {
                            val json = JSONObject(jsonString)
                            merchantPubkey = when {
                                json.has("merchantPubkey") -> json.getString("merchantPubkey")
                                json.has("merchant") -> json.getString("merchant")
                                else -> null
                            }
                        } catch (e: Exception) {
                            Log.w(TAG, "Failed to parse payment request JSON", e)
                        }
                    }

                    if (!merchantPubkey.isNullOrEmpty()) {
                        val prefix = if (merchantPubkey.length > 16) merchantPubkey.substring(0, 16) else merchantPubkey
                        peerPublicKeys[address] = prefix
                        Log.d(TAG, "Stored merchant pubkey prefix for $address: $prefix")
                        emitPeerReadyEvent(address, gatt.device.name, prefix)
                    } else {
                        emitPeerReadyEvent(address, gatt.device.name, null)
                    }
                } else {
                    Log.w(TAG, "Payment request read failed for $address - emitting readiness without pubkey")
                    emitPeerReadyEvent(address, gatt.device.name, peerPublicKeys[address])
                }
            }

            completeCurrentOperation(address, status == BluetoothGatt.GATT_SUCCESS)
            Log.d(TAG, "========================================")
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

        val characteristic = service.getCharacteristic(PAYMENT_BUNDLE_UUID)
            ?: service.getCharacteristic(MESH_RELAY_UUID)?.also {
                Log.w(TAG, "⚠️ Payment bundle characteristic missing, falling back to mesh relay for $address")
            }

        if (characteristic == null) {
            Log.w(TAG, "⚠️ No writable characteristic available for bundle delivery to $address")
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
        Log.d(TAG, "Sending bundle ${metadata.bundleId} to $address in ${chunks.size} chunks (chunkSize=$chunkSize bytes, total=${metadata.data.size} bytes)")
        characteristic.writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE

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

                // Give BLE stack time to process
                Thread.sleep(10)
            } catch (e: Exception) {
                Log.e(TAG, "❌ Error sending chunk $index to $address", e)
            }
        }
    }

    private fun handleIncomingBundleChunk(device: BluetoothDevice, data: ByteArray) {
        try {
            // DEBUG: Log first 16 bytes as hex for analysis
            val hexPreview = data.take(minOf(16, data.size)).joinToString(" ") { String.format("%02X", it) }
            val asciiPreview = data.take(minOf(16, data.size)).map { if (it in 32..126) it.toInt().toChar() else '.' }.joinToString("")
            Log.d(TAG, "📦 Received ${data.size} bytes from ${device.address}")
            Log.d(TAG, "   Hex: $hexPreview")
            Log.d(TAG, "   ASCII: $asciiPreview")

            val buffer = ByteBuffer.wrap(data).order(ByteOrder.BIG_ENDIAN)
            val chunkIndex = buffer.short.toInt() and 0xFFFF
            val totalChunks = buffer.short.toInt() and 0xFFFF

            Log.d(TAG, "   Parsed: chunk $chunkIndex of $totalChunks")

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

            Log.d(TAG, "✅ Received complete bundle $bundleId from ${device.address}")
            Log.d(TAG, "   Bundle size: ${data.size} bytes")
            seenBundleHashes.add(bundleId)

            // ========== EMIT EVENT TO JAVASCRIPT ==========
            val bundleDataString = String(data, Charsets.UTF_8)
            Log.d(TAG, "Bundle JSON raw: $bundleDataString")
            val eventParams = Arguments.createMap().apply {
                putString("bundleData", bundleDataString)
                putString("deviceAddress", device.address)
                putString("deviceName", device.name ?: "Unknown")
                putDouble("timestamp", System.currentTimeMillis().toDouble())
                putInt("bundleSize", data.size)
                putString("bundleId", bundleId)
            }

            sendEventToJS("BLE_BUNDLE_RECEIVED", eventParams)
            Log.d(TAG, "✅ Bundle processed and emitted to JS")

            // Send to React Native (legacy event)
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

    private fun isLikelyChunkPayload(data: ByteArray): Boolean {
        if (data.size < 4) {
            return false
        }

        return try {
            val buffer = ByteBuffer.wrap(data).order(ByteOrder.BIG_ENDIAN)
            val chunkIndex = buffer.short.toInt() and 0xFFFF
            val totalChunks = buffer.short.toInt() and 0xFFFF

            if (totalChunks == 0 || totalChunks > 2048) {
                return false
            }

            if (chunkIndex < 0 || chunkIndex >= totalChunks) {
                return false
            }

            true
        } catch (e: Exception) {
            false
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

    /**
     * Send event to JavaScript layer
     * Uses React Native's DeviceEventEmitter
     *
     * @param eventName Event name (e.g., "BLE_BUNDLE_RECEIVED")
     * @param params Event data as WritableMap (nullable)
     */
    private fun sendEventToJS(eventName: String, params: WritableMap?) {
        try {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
            Log.d(TAG, "📤 Event sent to JS: $eventName")
        } catch (e: Exception) {
            Log.e(TAG, "❌ Failed to send event $eventName to JS", e)
        }
    }

    private fun updatePaymentRequestCharacteristic(payload: ByteArray) {
        currentPaymentRequest = payload

        val server = gattServer ?: return
        val service = server.getService(BEAM_SERVICE_UUID) ?: return
        val characteristic = service.getCharacteristic(PAYMENT_REQUEST_UUID) ?: return

        characteristic.value = payload
    }

    private fun serializeBundle(bundle: ReadableMap): ByteArray {
        return try {
            val jsonObject = readableMapToJson(bundle)
            jsonObject.toString().toByteArray(Charsets.UTF_8)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to serialize bundle to JSON, falling back to toString()", e)
            bundle.toHashMap().toString().toByteArray(Charsets.UTF_8)
        }
    }

    private fun readableMapToJson(map: ReadableMap): JSONObject {
        val iterator = map.keySetIterator()
        val json = JSONObject()
        while (iterator.hasNextKey()) {
            val key = iterator.nextKey()
            when (map.getType(key)) {
                ReadableType.Null -> json.put(key, JSONObject.NULL)
                ReadableType.Boolean -> json.put(key, map.getBoolean(key))
                ReadableType.Number -> {
                    val number = map.getDouble(key)
                    if (number % 1 == 0.0) {
                        json.put(key, number.toLong())
                    } else {
                        json.put(key, number)
                    }
                }
                ReadableType.String -> json.put(key, map.getString(key))
                ReadableType.Map -> json.put(key, readableMapToJson(map.getMap(key) ?: Arguments.createMap()))
                ReadableType.Array -> json.put(key, readableArrayToJson(map.getArray(key) ?: Arguments.createArray()))
            }
        }
        return json
    }

    private fun readableArrayToJson(array: ReadableArray): JSONArray {
        val jsonArray = JSONArray()
        for (index in 0 until array.size()) {
            when (array.getType(index)) {
                ReadableType.Null -> jsonArray.put(JSONObject.NULL)
                ReadableType.Boolean -> jsonArray.put(array.getBoolean(index))
                ReadableType.Number -> {
                    val number = array.getDouble(index)
                    if (number % 1 == 0.0) {
                        jsonArray.put(number.toLong())
                    } else {
                        jsonArray.put(number)
                    }
                }
                ReadableType.String -> jsonArray.put(array.getString(index))
                ReadableType.Map -> jsonArray.put(readableMapToJson(array.getMap(index) ?: Arguments.createMap()))
                ReadableType.Array -> jsonArray.put(readableArrayToJson(array.getArray(index) ?: Arguments.createArray()))
            }
        }
        return jsonArray
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
    private fun runOnMainThread(action: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            action()
        } else {
            mainHandler.post(action)
        }
    }

    private fun <T> runOnMainThreadBlocking(timeoutMs: Long = 2000, block: () -> T): T? {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            return block()
        }

        val latch = CountDownLatch(1)
        val resultHolder = arrayOfNulls<Any>(1)
        val errorHolder = arrayOfNulls<Throwable>(1)

        mainHandler.post {
            try {
                resultHolder[0] = block()
            } catch (t: Throwable) {
                errorHolder[0] = t
            } finally {
                latch.countDown()
            }
        }

        val completed = latch.await(timeoutMs, TimeUnit.MILLISECONDS)
        if (!completed) {
            Log.w(TAG, "runOnMainThreadBlocking timed out after ${timeoutMs}ms")
            return null
        }

        val error = errorHolder[0]
        if (error != null) {
            throw RuntimeException(error)
        }

        @Suppress("UNCHECKED_CAST")
        return resultHolder[0] as T?
    }
}

// ============================================================================
// Phase 2: BLE Operation Classes
// ============================================================================

/**
 * Sealed class representing BLE operations
 * All operations are immutable and can be retried
 */
sealed class BleOperation {
    abstract val deviceAddress: String
    abstract val retryCount: Int

    data class Connect(
        override val deviceAddress: String,
        override val retryCount: Int = 0
    ) : BleOperation()

    data class Disconnect(
        override val deviceAddress: String,
        override val retryCount: Int = 0
    ) : BleOperation()

    data class DiscoverServices(
        override val deviceAddress: String,
        override val retryCount: Int = 0
    ) : BleOperation()

    data class ReadCharacteristic(
        override val deviceAddress: String,
        val serviceUuid: UUID,
        val charUuid: UUID,
        override val retryCount: Int = 0
    ) : BleOperation()

    data class WriteCharacteristic(
        override val deviceAddress: String,
        val serviceUuid: UUID,
        val charUuid: UUID,
        val data: ByteArray,
        override val retryCount: Int = 0
    ) : BleOperation() {
        // Override equals/hashCode for ByteArray
        override fun equals(other: Any?): Boolean {
            if (this === other) return true
            if (javaClass != other?.javaClass) return false

            other as WriteCharacteristic

            if (deviceAddress != other.deviceAddress) return false
            if (serviceUuid != other.serviceUuid) return false
            if (charUuid != other.charUuid) return false
            if (!data.contentEquals(other.data)) return false
            if (retryCount != other.retryCount) return false

            return true
        }

        override fun hashCode(): Int {
            var result = deviceAddress.hashCode()
            result = 31 * result + serviceUuid.hashCode()
            result = 31 * result + charUuid.hashCode()
            result = 31 * result + data.contentHashCode()
            result = 31 * result + retryCount
            return result
        }
    }

    data class MtuRequest(
        override val deviceAddress: String,
        val mtuSize: Int,
        override val retryCount: Int = 0
    ) : BleOperation()
}

/**
 * FIFO queue for BLE operations (one queue per device)
 */
data class BleOperationQueue(
    val deviceAddress: String,
    val operations: MutableList<BleOperation> = mutableListOf(),
    var isProcessing: Boolean = false
)
