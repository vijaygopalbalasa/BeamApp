package com.beam.app.modules

import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlinx.coroutines.*
import java.nio.ByteBuffer
import java.util.*
import java.util.concurrent.ConcurrentHashMap
import kotlin.collections.HashMap

/**
 * BLEPeripheralModule - Production-ready BLE Peripheral implementation for Android
 *
 * Provides GATT server functionality for Beam payment protocol
 * Supports chunked data transfer for large bundles (up to 256KB)
 * Handles multiple simultaneous connections (7-8 devices)
 * Matches iOS BLEPeripheralModule API exactly
 */
class BLEPeripheralModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "BLEPeripheral"

        // Beam BLE Protocol UUIDs - MUST match iOS exactly
        private val BEAM_SERVICE_UUID = UUID.fromString("00006265-0000-1000-8000-00805f9b34fb")
        private val PAYMENT_REQUEST_CHAR_UUID = UUID.fromString("000062b0-0000-1000-8000-00805f9b34fb")
        private val BUNDLE_WRITE_CHAR_UUID = UUID.fromString("000062b1-0000-1000-8000-00805f9b34fb")
        private val BUNDLE_RESPONSE_CHAR_UUID = UUID.fromString("000062b2-0000-1000-8000-00805f9b34fb")
        private val CHUNK_CONTROL_CHAR_UUID = UUID.fromString("000062b3-0000-1000-8000-00805f9b34fb")
        private val CONNECTION_STATE_CHAR_UUID = UUID.fromString("000062b4-0000-1000-8000-00805f9b34fb")

        // Protocol Constants
        private const val MAX_MTU_SIZE = 512
        private const val DEFAULT_MTU_SIZE = 23
        private const val MAX_CHUNK_SIZE = MAX_MTU_SIZE - 3 // Header overhead
        private const val MAX_BUNDLE_SIZE = 256 * 1024 // 256KB

        // Connection States - MUST match iOS
        private const val STATE_IDLE: Byte = 0
        private const val STATE_READY: Byte = 1
        private const val STATE_RECEIVING: Byte = 2
        private const val STATE_PROCESSING: Byte = 3
        private const val STATE_RESPONDING: Byte = 4

        // Chunk Control Commands - MUST match iOS
        private const val CMD_START_TRANSFER: Byte = 0x01
        private const val CMD_CHUNK_DATA: Byte = 0x02
        private const val CMD_END_TRANSFER: Byte = 0x03
        private const val CMD_ACK: Byte = 0x04
        private const val CMD_ERROR: Byte = 0x05

        // Event names - MUST match iOS exactly
        private const val EVENT_ADVERTISING_STARTED = "onAdvertisingStarted"
        private const val EVENT_ADVERTISING_FAILED = "onAdvertisingFailed"
        private const val EVENT_DEVICE_CONNECTED = "onDeviceConnected"
        private const val EVENT_DEVICE_DISCONNECTED = "onDeviceDisconnected"
        private const val EVENT_MTU_CHANGED = "onMtuChanged"
        private const val EVENT_BUNDLE_RECEIVED = "onBundleReceived"
    }

    override fun getName(): String = "BLEPeripheralModule"

    // BLE Components
    private var bluetoothManager: BluetoothManager? = null
    private var bluetoothAdapter: BluetoothAdapter? = null
    private var gattServer: BluetoothGattServer? = null
    private var advertiser: BluetoothLeAdvertiser? = null

    // Characteristics
    private var paymentRequestChar: BluetoothGattCharacteristic? = null
    private var bundleWriteChar: BluetoothGattCharacteristic? = null
    private var bundleResponseChar: BluetoothGattCharacteristic? = null
    private var chunkControlChar: BluetoothGattCharacteristic? = null
    private var connectionStateChar: BluetoothGattCharacteristic? = null

    // State management
    private var isAdvertising = false
    private var merchantPubkey: String? = null
    private var merchantName: String? = null

    // Connection tracking
    private val connectedDevices = ConcurrentHashMap<String, BluetoothDevice>()
    private val deviceStates = ConcurrentHashMap<String, Byte>()
    private val deviceMTUs = ConcurrentHashMap<String, Int>()

    // Chunked transfer management
    private val incomingChunks = ConcurrentHashMap<String, ChunkBuffer>()
    private val outgoingChunks = ConcurrentHashMap<String, ChunkBuffer>()

    // Coroutine scope for async operations
    private val moduleScope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    private val mainHandler = Handler(Looper.getMainLooper())

    /**
     * Chunk buffer for managing large data transfers
     */
    private data class ChunkBuffer(
        val totalSize: Int,
        var receivedSize: Int = 0,
        val chunks: MutableList<ByteArray> = mutableListOf(),
        var lastChunkTime: Long = System.currentTimeMillis()
    )

    init {
        try {
            bluetoothManager = reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
            bluetoothAdapter = bluetoothManager?.adapter
            Log.d(TAG, "BLEPeripheralModule initialized")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize Bluetooth", e)
        }
    }

    // ========== React Native Bridge Methods ==========

    @ReactMethod
    fun startAdvertising(config: ReadableMap, promise: Promise) {
        try {
            val pubkey = config.getString("merchantPubkey")
            val name = config.getString("merchantName")

            if (pubkey.isNullOrEmpty() || name.isNullOrEmpty()) {
                promise.reject("BLE_PERIPHERAL_ERROR", "merchantPubkey and merchantName required")
                return
            }

            merchantPubkey = pubkey
            merchantName = name

            Log.d(TAG, "Starting advertising for merchant: $name")

            // Check Bluetooth availability
            if (bluetoothAdapter == null || !bluetoothAdapter!!.isEnabled) {
                promise.reject("BLE_PERIPHERAL_ERROR", "Bluetooth not available or disabled")
                return
            }

            // Start GATT server and advertising
            startGattServer(promise)

        } catch (e: Exception) {
            Log.e(TAG, "Error starting advertising", e)
            promise.reject("BLE_PERIPHERAL_ERROR", "Failed to start advertising: ${e.message}", e)
        }
    }

    @ReactMethod
    fun stopAdvertising(promise: Promise) {
        try {
            Log.d(TAG, "Stopping advertising")
            stopBleAdvertising()
            stopGattServer()
            isAdvertising = false

            val result = Arguments.createMap()
            result.putBoolean("success", true)
            promise.resolve(result)
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping advertising", e)
            promise.reject("BLE_PERIPHERAL_ERROR", "Failed to stop advertising: ${e.message}", e)
        }
    }

    @ReactMethod
    fun updatePaymentRequest(paymentRequest: ReadableMap, promise: Promise) {
        try {
            val characteristic = paymentRequestChar
            if (characteristic == null || gattServer == null) {
                promise.reject("BLE_PERIPHERAL_ERROR", "GATT server not running")
                return
            }

            // Convert ReadableMap to JSON string
            val jsonString = convertMapToJsonString(paymentRequest)
            val data = jsonString.toByteArray(Charsets.UTF_8)

            // Update characteristic value
            characteristic.value = data

            // Notify all subscribed devices
            val success = notifyCharacteristicChanged(characteristic)

            val result = Arguments.createMap()
            result.putBoolean("success", success)
            promise.resolve(result)

        } catch (e: Exception) {
            Log.e(TAG, "Error updating payment request", e)
            promise.reject("BLE_PERIPHERAL_ERROR", "Failed to update payment request: ${e.message}", e)
        }
    }

    @ReactMethod
    fun sendResponseBundle(deviceAddress: String, bundleJson: String, promise: Promise) {
        try {
            val data = bundleJson.toByteArray(Charsets.UTF_8)

            if (data.size > MAX_BUNDLE_SIZE) {
                promise.reject("BLE_PERIPHERAL_ERROR", "Bundle too large: ${data.size} bytes")
                return
            }

            Log.d(TAG, "Sending response bundle to $deviceAddress, size: ${data.size} bytes")

            // Find the device
            val device = connectedDevices[deviceAddress]
            if (device == null) {
                // Send to all connected devices (iOS behavior)
                connectedDevices.values.forEach { dev ->
                    moduleScope.launch {
                        sendChunkedData(data, dev)
                        deviceStates[dev.address] = STATE_READY
                    }
                }
            } else {
                moduleScope.launch {
                    sendChunkedData(data, device)
                    deviceStates[deviceAddress] = STATE_READY
                }
            }

            val result = Arguments.createMap()
            result.putBoolean("success", true)
            result.putInt("bytesSent", data.size)
            promise.resolve(result)

        } catch (e: Exception) {
            Log.e(TAG, "Error sending response bundle", e)
            promise.reject("BLE_PERIPHERAL_ERROR", "Failed to send bundle: ${e.message}", e)
        }
    }

    @ReactMethod
    fun getConnectedDevices(promise: Promise) {
        try {
            val devices = Arguments.createArray()

            connectedDevices.forEach { (address, device) ->
                val deviceMap = Arguments.createMap()
                deviceMap.putString("address", address)
                deviceMap.putString("name", device.name ?: "Unknown Device")
                deviceMap.putInt("state", (deviceStates[address] ?: STATE_IDLE).toInt())
                deviceMap.putInt("mtu", deviceMTUs[address] ?: DEFAULT_MTU_SIZE)
                devices.pushMap(deviceMap)
            }

            promise.resolve(devices)
        } catch (e: Exception) {
            Log.e(TAG, "Error getting connected devices", e)
            promise.reject("BLE_PERIPHERAL_ERROR", "Failed to get devices: ${e.message}", e)
        }
    }

    @ReactMethod
    fun disconnectDevice(deviceAddress: String, promise: Promise) {
        try {
            Log.d(TAG, "Disconnecting device: $deviceAddress")

            // Android doesn't allow peripheral to forcibly disconnect centrals
            // We can only clean up our state
            connectedDevices.remove(deviceAddress)
            deviceStates.remove(deviceAddress)
            deviceMTUs.remove(deviceAddress)
            incomingChunks.remove(deviceAddress)
            outgoingChunks.remove(deviceAddress)

            val result = Arguments.createMap()
            result.putBoolean("success", true)
            promise.resolve(result)
        } catch (e: Exception) {
            Log.e(TAG, "Error disconnecting device", e)
            promise.reject("BLE_PERIPHERAL_ERROR", "Failed to disconnect: ${e.message}", e)
        }
    }

    // ========== GATT Server Management ==========

    private fun startGattServer(promise: Promise) {
        try {
            // Close existing server if any
            gattServer?.close()

            // Open GATT server
            gattServer = bluetoothManager?.openGattServer(reactContext, gattServerCallback)
            if (gattServer == null) {
                promise.reject("BLE_PERIPHERAL_ERROR", "Failed to open GATT server")
                return
            }

            // Create and add service
            val service = BluetoothGattService(BEAM_SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)

            // Payment Request Characteristic (Read, Notify)
            paymentRequestChar = BluetoothGattCharacteristic(
                PAYMENT_REQUEST_CHAR_UUID,
                BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
                BluetoothGattCharacteristic.PERMISSION_READ
            ).apply {
                addDescriptor(createCCCDescriptor())
            }

            // Bundle Write Characteristic (Write, Notify)
            bundleWriteChar = BluetoothGattCharacteristic(
                BUNDLE_WRITE_CHAR_UUID,
                BluetoothGattCharacteristic.PROPERTY_WRITE or
                BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE or
                BluetoothGattCharacteristic.PROPERTY_NOTIFY,
                BluetoothGattCharacteristic.PERMISSION_WRITE
            ).apply {
                addDescriptor(createCCCDescriptor())
            }

            // Bundle Response Characteristic (Notify)
            bundleResponseChar = BluetoothGattCharacteristic(
                BUNDLE_RESPONSE_CHAR_UUID,
                BluetoothGattCharacteristic.PROPERTY_NOTIFY,
                0
            ).apply {
                addDescriptor(createCCCDescriptor())
            }

            // Chunk Control Characteristic (Write, Notify)
            chunkControlChar = BluetoothGattCharacteristic(
                CHUNK_CONTROL_CHAR_UUID,
                BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
                BluetoothGattCharacteristic.PERMISSION_WRITE
            ).apply {
                addDescriptor(createCCCDescriptor())
            }

            // Connection State Characteristic (Read, Notify)
            connectionStateChar = BluetoothGattCharacteristic(
                CONNECTION_STATE_CHAR_UUID,
                BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
                BluetoothGattCharacteristic.PERMISSION_READ
            ).apply {
                addDescriptor(createCCCDescriptor())
            }

            // Add all characteristics to service
            service.addCharacteristic(paymentRequestChar!!)
            service.addCharacteristic(bundleWriteChar!!)
            service.addCharacteristic(bundleResponseChar!!)
            service.addCharacteristic(chunkControlChar!!)
            service.addCharacteristic(connectionStateChar!!)

            // Add service to GATT server
            val added = gattServer?.addService(service) ?: false
            if (!added) {
                promise.reject("BLE_PERIPHERAL_ERROR", "Failed to add service")
                return
            }

            Log.d(TAG, "GATT server started with 5 characteristics")

            // Start advertising
            startBleAdvertising()

            val result = Arguments.createMap()
            result.putBoolean("success", true)
            result.putString("merchantPubkey", merchantPubkey ?: "")
            result.putString("merchantName", merchantName ?: "")
            promise.resolve(result)

        } catch (e: Exception) {
            Log.e(TAG, "Error starting GATT server", e)
            promise.reject("BLE_PERIPHERAL_ERROR", "Failed to start GATT server: ${e.message}", e)
        }
    }

    private fun stopGattServer() {
        try {
            gattServer?.clearServices()
            gattServer?.close()
            gattServer = null

            connectedDevices.clear()
            deviceStates.clear()
            deviceMTUs.clear()
            incomingChunks.clear()
            outgoingChunks.clear()

            Log.d(TAG, "GATT server stopped")
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping GATT server", e)
        }
    }

    private fun createCCCDescriptor(): BluetoothGattDescriptor {
        return BluetoothGattDescriptor(
            UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"),
            BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
        )
    }

    // ========== Advertising Management ==========

    private fun startBleAdvertising() {
        try {
            // Check if BLE advertising is supported on this device
            val adapter = bluetoothAdapter
            if (adapter == null) {
                Log.e(TAG, "Bluetooth adapter not available")
                sendEvent(EVENT_ADVERTISING_FAILED, mapOf("error" to "Bluetooth adapter not available"))
                return
            }

            // Check if Bluetooth is actually enabled
            if (!adapter.isEnabled) {
                Log.e(TAG, "Bluetooth is disabled - please enable Bluetooth in Settings")
                sendEvent(EVENT_ADVERTISING_FAILED, mapOf("error" to "Bluetooth is disabled. Please enable Bluetooth in Settings."))
                return
            }

            // Check Bluetooth state
            val state = adapter.state
            Log.d(TAG, "Bluetooth state: $state (STATE_ON=12, STATE_OFF=10)")
            if (state != android.bluetooth.BluetoothAdapter.STATE_ON) {
                Log.e(TAG, "Bluetooth is not in STATE_ON, current state: $state")
                sendEvent(EVENT_ADVERTISING_FAILED, mapOf("error" to "Bluetooth is not ready. Current state: $state"))
                return
            }

            if (!adapter.isMultipleAdvertisementSupported) {
                Log.e(TAG, "BLE advertising not supported on this device")
                sendEvent(EVENT_ADVERTISING_FAILED, mapOf("error" to "BLE advertising not supported on this device"))
                return
            }

            advertiser = adapter.bluetoothLeAdvertiser
            if (advertiser == null) {
                Log.e(TAG, "BLE advertiser not available - isEnabled=${adapter.isEnabled}, state=${adapter.state}")
                sendEvent(EVENT_ADVERTISING_FAILED, mapOf("error" to "BLE advertiser not available. Check Bluetooth permissions."))
                return
            }

            val settings = AdvertiseSettings.Builder()
                .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                .setConnectable(true)
                .setTimeout(0)
                .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
                .build()

            val deviceName = "Beam-$merchantName"
            bluetoothAdapter?.name = deviceName

            val data = AdvertiseData.Builder()
                .setIncludeDeviceName(true)
                .addServiceUuid(ParcelUuid(BEAM_SERVICE_UUID))
                .build()

            advertiser?.startAdvertising(settings, data, advertiseCallback)
            isAdvertising = true

            Log.d(TAG, "Started advertising as: $deviceName")

        } catch (e: SecurityException) {
            Log.e(TAG, "Permission denied for advertising", e)
            sendEvent(EVENT_ADVERTISING_FAILED, mapOf("error" to "Bluetooth permission denied"))
        } catch (e: Exception) {
            Log.e(TAG, "Error starting advertising", e)
            sendEvent(EVENT_ADVERTISING_FAILED, mapOf("error" to e.message))
        }
    }

    private fun stopBleAdvertising() {
        try {
            advertiser?.stopAdvertising(advertiseCallback)
            isAdvertising = false
            Log.d(TAG, "Stopped advertising")
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping advertising", e)
        }
    }

    // ========== Chunked Data Transfer ==========

    private suspend fun sendChunkedData(data: ByteArray, device: BluetoothDevice) = withContext(Dispatchers.IO) {
        try {
            val characteristic = chunkControlChar ?: return@withContext
            val mtu = deviceMTUs[device.address] ?: DEFAULT_MTU_SIZE
            val chunkSize = minOf(mtu - 3, MAX_CHUNK_SIZE)

            Log.d(TAG, "Sending ${data.size} bytes to ${device.address} with MTU $mtu, chunk size $chunkSize")

            // Send START command
            val startCmd = ByteBuffer.allocate(5)
            startCmd.put(CMD_START_TRANSFER)
            startCmd.putInt(data.size)
            characteristic.value = startCmd.array()
            notifyCharacteristicChanged(characteristic, device)
            delay(20) // Small delay for stability

            // Send data in chunks
            var offset = 0
            var chunkCount = 0
            while (offset < data.size) {
                val remainingBytes = data.size - offset
                val currentChunkSize = minOf(remainingBytes, chunkSize)

                val chunkData = ByteArray(currentChunkSize + 1)
                chunkData[0] = CMD_CHUNK_DATA
                System.arraycopy(data, offset, chunkData, 1, currentChunkSize)

                characteristic.value = chunkData
                notifyCharacteristicChanged(characteristic, device)

                offset += currentChunkSize
                chunkCount++

                // Delay between chunks to prevent overflow
                delay(10)
            }

            // Send END command
            characteristic.value = byteArrayOf(CMD_END_TRANSFER)
            notifyCharacteristicChanged(characteristic, device)

            Log.d(TAG, "Sent $chunkCount chunks to ${device.address}")

        } catch (e: Exception) {
            Log.e(TAG, "Error sending chunked data", e)
        }
    }

    private fun handleChunkControl(data: ByteArray, device: BluetoothDevice) {
        try {
            if (data.isEmpty()) return

            val command = data[0]
            val deviceAddress = device.address

            when (command) {
                CMD_START_TRANSFER -> {
                    if (data.size >= 5) {
                        val buffer = ByteBuffer.wrap(data, 1, 4)
                        val totalSize = buffer.int

                        Log.d(TAG, "Starting transfer from $deviceAddress, size: $totalSize")

                        incomingChunks[deviceAddress] = ChunkBuffer(totalSize)
                        deviceStates[deviceAddress] = STATE_RECEIVING

                        // Send ACK
                        sendChunkControlAck(device)
                    }
                }

                CMD_CHUNK_DATA -> {
                    val buffer = incomingChunks[deviceAddress]
                    if (buffer != null && data.size > 1) {
                        val chunkData = data.copyOfRange(1, data.size)
                        buffer.chunks.add(chunkData)
                        buffer.receivedSize += chunkData.size
                        buffer.lastChunkTime = System.currentTimeMillis()

                        Log.v(TAG, "Received chunk ${buffer.chunks.size} from $deviceAddress (${buffer.receivedSize}/${buffer.totalSize})")
                    }
                }

                CMD_END_TRANSFER -> {
                    val buffer = incomingChunks.remove(deviceAddress)
                    if (buffer != null) {
                        // Reassemble data
                        val completeData = ByteArray(buffer.receivedSize)
                        var offset = 0
                        buffer.chunks.forEach { chunk ->
                            System.arraycopy(chunk, 0, completeData, offset, chunk.size)
                            offset += chunk.size
                        }

                        val bundleJson = String(completeData, Charsets.UTF_8)
                        processBundleReceived(bundleJson, device)
                        deviceStates[deviceAddress] = STATE_PROCESSING

                        Log.d(TAG, "Transfer complete from $deviceAddress: ${completeData.size} bytes")
                    }
                }

                CMD_ACK -> {
                    Log.v(TAG, "Received ACK from $deviceAddress")
                }

                CMD_ERROR -> {
                    Log.e(TAG, "Received ERROR from $deviceAddress")
                    incomingChunks.remove(deviceAddress)
                    deviceStates[deviceAddress] = STATE_READY
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error handling chunk control", e)
        }
    }

    private fun sendChunkControlAck(device: BluetoothDevice) {
        try {
            chunkControlChar?.value = byteArrayOf(CMD_ACK)
            chunkControlChar?.let { notifyCharacteristicChanged(it, device) }
        } catch (e: Exception) {
            Log.e(TAG, "Error sending ACK", e)
        }
    }

    private fun processBundleReceived(bundleJson: String, device: BluetoothDevice) {
        try {
            Log.d(TAG, "Received payment bundle from ${device.address}")

            sendEvent(EVENT_BUNDLE_RECEIVED, mapOf(
                "deviceAddress" to device.address,
                "bundle" to bundleJson
            ))
        } catch (e: Exception) {
            Log.e(TAG, "Error processing bundle", e)
        }
    }

    // ========== GATT Server Callback ==========

    private val gattServerCallback = object : BluetoothGattServerCallback() {

        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            super.onConnectionStateChange(device, status, newState)

            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    Log.d(TAG, "Device connected: ${device.address}")
                    connectedDevices[device.address] = device
                    deviceStates[device.address] = STATE_READY
                    deviceMTUs[device.address] = DEFAULT_MTU_SIZE

                    sendEvent(EVENT_DEVICE_CONNECTED, mapOf(
                        "deviceAddress" to device.address,
                        "deviceName" to (device.name ?: "Unknown Device")
                    ))
                }

                BluetoothProfile.STATE_DISCONNECTED -> {
                    Log.d(TAG, "Device disconnected: ${device.address}")
                    connectedDevices.remove(device.address)
                    deviceStates.remove(device.address)
                    deviceMTUs.remove(device.address)
                    incomingChunks.remove(device.address)
                    outgoingChunks.remove(device.address)

                    sendEvent(EVENT_DEVICE_DISCONNECTED, mapOf(
                        "deviceAddress" to device.address
                    ))
                }
            }
        }

        override fun onMtuChanged(device: BluetoothDevice, mtu: Int) {
            super.onMtuChanged(device, mtu)
            Log.d(TAG, "MTU changed for ${device.address}: $mtu")
            deviceMTUs[device.address] = mtu

            sendEvent(EVENT_MTU_CHANGED, mapOf(
                "deviceAddress" to device.address,
                "mtu" to mtu
            ))
        }

        override fun onCharacteristicReadRequest(
            device: BluetoothDevice,
            requestId: Int,
            offset: Int,
            characteristic: BluetoothGattCharacteristic
        ) {
            when (characteristic.uuid) {
                PAYMENT_REQUEST_CHAR_UUID -> {
                    val value = characteristic.value ?: ByteArray(0)
                    if (offset > value.size) {
                        gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_INVALID_OFFSET, offset, null)
                    } else {
                        val response = value.copyOfRange(offset, value.size)
                        gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, response)
                    }
                }

                CONNECTION_STATE_CHAR_UUID -> {
                    val state = deviceStates[device.address] ?: STATE_IDLE
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, byteArrayOf(state))
                }

                else -> {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_READ_NOT_PERMITTED, 0, null)
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
            when (characteristic.uuid) {
                BUNDLE_WRITE_CHAR_UUID -> {
                    // Handle small bundles directly
                    if (value.size < MAX_CHUNK_SIZE) {
                        val bundleJson = String(value, Charsets.UTF_8)
                        processBundleReceived(bundleJson, device)
                    }
                    if (responseNeeded) {
                        gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
                    }
                }

                CHUNK_CONTROL_CHAR_UUID -> {
                    handleChunkControl(value, device)
                    if (responseNeeded) {
                        gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
                    }
                }

                else -> {
                    if (responseNeeded) {
                        gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_WRITE_NOT_PERMITTED, 0, null)
                    }
                }
            }
        }

        override fun onDescriptorReadRequest(
            device: BluetoothDevice,
            requestId: Int,
            offset: Int,
            descriptor: BluetoothGattDescriptor
        ) {
            gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
        }

        override fun onDescriptorWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            descriptor: BluetoothGattDescriptor,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray
        ) {
            if (responseNeeded) {
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
            }
        }
    }

    // ========== Advertise Callback ==========

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
            super.onStartSuccess(settingsInEffect)
            Log.d(TAG, "Advertising started successfully")
            sendEvent(EVENT_ADVERTISING_STARTED, mapOf(
                "merchantName" to (merchantName ?: "")
            ))
        }

        override fun onStartFailure(errorCode: Int) {
            super.onStartFailure(errorCode)
            val errorMsg = when (errorCode) {
                ADVERTISE_FAILED_DATA_TOO_LARGE -> "Data too large"
                ADVERTISE_FAILED_TOO_MANY_ADVERTISERS -> "Too many advertisers"
                ADVERTISE_FAILED_ALREADY_STARTED -> "Already started"
                ADVERTISE_FAILED_INTERNAL_ERROR -> "Internal error"
                ADVERTISE_FAILED_FEATURE_UNSUPPORTED -> "Feature not supported"
                else -> "Unknown error: $errorCode"
            }
            Log.e(TAG, "Advertising failed: $errorMsg")
            sendEvent(EVENT_ADVERTISING_FAILED, mapOf("error" to errorMsg))
        }
    }

    // ========== Helper Methods ==========

    private fun notifyCharacteristicChanged(characteristic: BluetoothGattCharacteristic, device: BluetoothDevice? = null): Boolean {
        return try {
            if (device != null) {
                gattServer?.notifyCharacteristicChanged(device, characteristic, false) ?: false
            } else {
                // Notify all connected devices
                connectedDevices.values.forEach { dev ->
                    gattServer?.notifyCharacteristicChanged(dev, characteristic, false)
                }
                true
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error notifying characteristic changed", e)
            false
        }
    }

    private fun sendEvent(eventName: String, params: Map<String, Any?>) {
        try {
            val map = Arguments.createMap()
            params.forEach { (key, value) ->
                when (value) {
                    is String -> map.putString(key, value)
                    is Int -> map.putInt(key, value)
                    is Double -> map.putDouble(key, value)
                    is Boolean -> map.putBoolean(key, value)
                    else -> map.putString(key, value?.toString())
                }
            }

            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, map)
        } catch (e: Exception) {
            Log.e(TAG, "Error sending event $eventName", e)
        }
    }

    private fun convertMapToJsonString(map: ReadableMap): String {
        val jsonObject = org.json.JSONObject()
        val iterator = map.keySetIterator()

        while (iterator.hasNextKey()) {
            val key = iterator.nextKey()
            when (map.getType(key)) {
                ReadableType.String -> jsonObject.put(key, map.getString(key))
                ReadableType.Number -> jsonObject.put(key, map.getDouble(key))
                ReadableType.Boolean -> jsonObject.put(key, map.getBoolean(key))
                ReadableType.Map -> jsonObject.put(key, convertMapToJsonString(map.getMap(key)!!))
                ReadableType.Array -> {
                    val array = map.getArray(key)
                    if (array != null) {
                        jsonObject.put(key, convertArrayToJsonArray(array))
                    }
                }
                else -> {}
            }
        }

        return jsonObject.toString()
    }

    private fun convertArrayToJsonArray(array: ReadableArray): org.json.JSONArray {
        val jsonArray = org.json.JSONArray()
        for (i in 0 until array.size()) {
            when (array.getType(i)) {
                ReadableType.String -> jsonArray.put(array.getString(i))
                ReadableType.Number -> jsonArray.put(array.getDouble(i))
                ReadableType.Boolean -> jsonArray.put(array.getBoolean(i))
                ReadableType.Map -> jsonArray.put(convertMapToJsonString(array.getMap(i)))
                ReadableType.Array -> jsonArray.put(convertArrayToJsonArray(array.getArray(i)))
                else -> {}
            }
        }
        return jsonArray
    }

    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        try {
            moduleScope.cancel()
            stopBleAdvertising()
            stopGattServer()
            Log.d(TAG, "Module destroyed and resources cleaned up")
        } catch (e: Exception) {
            Log.e(TAG, "Error during cleanup", e)
        }
    }
}
