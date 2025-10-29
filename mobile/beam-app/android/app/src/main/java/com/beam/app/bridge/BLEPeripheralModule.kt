package com.beam.app.bridge

import android.bluetooth.*
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import android.os.ParcelUuid
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.*
import java.util.concurrent.ConcurrentHashMap

class BLEPeripheralModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    // Constants matching iOS implementation
    companion object {
        private const val MODULE_NAME = "BLEPeripheralModule"

        // Beam BLE Protocol UUIDs (matching iOS)
        private val BEAM_SERVICE_UUID = UUID.fromString("00006265-0000-1000-8000-00805f9b34fb")
        private val PAYMENT_REQUEST_CHAR_UUID = UUID.fromString("000062b0-0000-1000-8000-00805f9b34fb")
        private val BUNDLE_WRITE_CHAR_UUID = UUID.fromString("000062b1-0000-1000-8000-00805f9b34fb")
        private val BUNDLE_RESPONSE_CHAR_UUID = UUID.fromString("000062b2-0000-1000-8000-00805f9b34fb")
        private val CHUNK_CONTROL_CHAR_UUID = UUID.fromString("000062b3-0000-1000-8000-00805f9b34fb")
        private val CONNECTION_STATE_CHAR_UUID = UUID.fromString("000062b4-0000-1000-8000-00805f9b34fb")

        // Protocol Constants
        private const val MAX_MTU_SIZE = 512
        private const val DEFAULT_MTU_SIZE = 23
        private const val MAX_CHUNK_SIZE = MAX_MTU_SIZE - 3
        private const val MAX_BUNDLE_SIZE = 256 * 1024 // 256KB

        // Connection States
        private const val STATE_IDLE: Byte = 0
        private const val STATE_READY: Byte = 1
        private const val STATE_RECEIVING: Byte = 2
        private const val STATE_PROCESSING: Byte = 3
        private const val STATE_RESPONDING: Byte = 4

        // Chunk Control Commands
        private const val CMD_START_TRANSFER: Byte = 0x01
        private const val CMD_CHUNK_DATA: Byte = 0x02
        private const val CMD_END_TRANSFER: Byte = 0x03
        private const val CMD_ACK: Byte = 0x04
        private const val CMD_ERROR: Byte = 0x05
    }

    // Bluetooth components
    private var bluetoothManager: BluetoothManager? = null
    private var gattServer: BluetoothGattServer? = null
    private var advertiser: BluetoothLeAdvertiser? = null
    private var isAdvertising = false

    // Merchant info
    private var merchantPubkey: String? = null
    private var merchantName: String? = null

    // Characteristics
    private var paymentRequestChar: BluetoothGattCharacteristic? = null
    private var bundleWriteChar: BluetoothGattCharacteristic? = null
    private var bundleResponseChar: BluetoothGattCharacteristic? = null
    private var chunkControlChar: BluetoothGattCharacteristic? = null
    private var connectionStateChar: BluetoothGattCharacteristic? = null

    // Connection management
    private val connectedDevices = ConcurrentHashMap<String, BluetoothDevice>()
    private val deviceStates = ConcurrentHashMap<String, Byte>()
    private val deviceMTUs = ConcurrentHashMap<String, Int>()

    // Chunked transfer management
    private val incomingChunks = ConcurrentHashMap<String, ChunkBuffer>()
    private val outgoingChunks = ConcurrentHashMap<String, ChunkBuffer>()

    // Chunk Buffer class
    private data class ChunkBuffer(
        val totalSize: Int,
        var receivedSize: Int = 0,
        val chunks: MutableList<ByteArray> = mutableListOf(),
        var lastChunkTime: Long = System.currentTimeMillis()
    )

    override fun getName(): String = MODULE_NAME

    init {
        bluetoothManager = reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    }

    @ReactMethod
    fun startAdvertising(config: ReadableMap, promise: Promise) {
        try {
            val pubkey = config.getString("merchantPubkey")
                ?: return promise.reject("BLE_PERIPHERAL_ERROR", "merchantPubkey required")
            val name = config.getString("merchantName")
                ?: return promise.reject("BLE_PERIPHERAL_ERROR", "merchantName required")

            merchantPubkey = pubkey
            merchantName = name

            val adapter = bluetoothManager?.adapter
            if (adapter == null || !adapter.isEnabled) {
                return promise.reject("BLE_PERIPHERAL_ERROR", "Bluetooth not enabled")
            }

            advertiser = adapter.bluetoothLeAdvertiser
            if (advertiser == null) {
                return promise.reject("BLE_PERIPHERAL_ERROR", "BLE advertising not supported")
            }

            setupGattServer(promise)
        } catch (e: Exception) {
            promise.reject("BLE_PERIPHERAL_ERROR", "Failed to start advertising: ${e.message}", e)
        }
    }

    @ReactMethod
    fun stopAdvertising(promise: Promise) {
        try {
            stopBleAdvertising()
            stopGattServer()
            isAdvertising = false
            promise.resolve(
                Arguments.createMap().apply {
                    putBoolean("success", true)
                }
            )
        } catch (e: Exception) {
            promise.reject("BLE_PERIPHERAL_ERROR", "Failed to stop advertising: ${e.message}", e)
        }
    }

    @ReactMethod
    fun updatePaymentRequest(paymentRequest: ReadableMap, promise: Promise) {
        try {
            val characteristic = paymentRequestChar
                ?: return promise.reject("BLE_PERIPHERAL_ERROR", "GATT server not running")

            val jsonString = convertMapToJson(paymentRequest)
            characteristic.value = jsonString.toByteArray(Charsets.UTF_8)

            // Notify connected devices
            connectedDevices.values.forEach { device ->
                gattServer?.notifyCharacteristicChanged(device, characteristic, false)
            }

            promise.resolve(
                Arguments.createMap().apply {
                    putBoolean("success", true)
                }
            )
        } catch (e: Exception) {
            promise.reject("BLE_PERIPHERAL_ERROR", "Failed to update payment request: ${e.message}", e)
        }
    }

    @ReactMethod
    fun sendResponseBundle(deviceAddress: String, bundle: ReadableMap, promise: Promise) {
        try {
            val device = connectedDevices[deviceAddress]
                ?: return promise.reject("BLE_PERIPHERAL_ERROR", "Device not connected")

            val jsonString = convertMapToJson(bundle)
            val data = jsonString.toByteArray(Charsets.UTF_8)

            if (data.size > MAX_BUNDLE_SIZE) {
                return promise.reject("BLE_PERIPHERAL_ERROR", "Bundle exceeds max size")
            }

            // Start chunked transfer
            val mtu = deviceMTUs[deviceAddress] ?: DEFAULT_MTU_SIZE
            startChunkedTransfer(device, data, mtu)

            promise.resolve(
                Arguments.createMap().apply {
                    putBoolean("success", true)
                    putInt("size", data.size)
                }
            )
        } catch (e: Exception) {
            promise.reject("BLE_PERIPHERAL_ERROR", "Failed to send response: ${e.message}", e)
        }
    }

    @ReactMethod
    fun getConnectedDevices(promise: Promise) {
        try {
            val devices = Arguments.createArray()
            connectedDevices.forEach { (address, device) ->
                devices.pushMap(Arguments.createMap().apply {
                    putString("address", address)
                    putString("name", device.name ?: "Unknown")
                    putInt("mtu", deviceMTUs[address] ?: DEFAULT_MTU_SIZE)
                    putInt("state", deviceStates[address]?.toInt() ?: STATE_IDLE.toInt())
                })
            }
            promise.resolve(devices)
        } catch (e: Exception) {
            promise.reject("BLE_PERIPHERAL_ERROR", "Failed to get devices: ${e.message}", e)
        }
    }

    @ReactMethod
    fun disconnectDevice(deviceAddress: String, promise: Promise) {
        try {
            val device = connectedDevices[deviceAddress]
            if (device != null) {
                gattServer?.cancelConnection(device)
                cleanupDeviceState(deviceAddress)
            }
            promise.resolve(
                Arguments.createMap().apply {
                    putBoolean("success", true)
                }
            )
        } catch (e: Exception) {
            promise.reject("BLE_PERIPHERAL_ERROR", "Failed to disconnect: ${e.message}", e)
        }
    }

    // MARK: - Private Methods

    private fun setupGattServer(promise: Promise) {
        val gattCallback = object : BluetoothGattServerCallback() {
            override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
                handleConnectionStateChange(device, status, newState)
            }

            override fun onCharacteristicWriteRequest(
                device: BluetoothDevice,
                requestId: Int,
                characteristic: BluetoothGattCharacteristic,
                preparedWrite: Boolean,
                responseNeeded: Boolean,
                offset: Int,
                value: ByteArray?
            ) {
                handleCharacteristicWrite(device, requestId, characteristic, responseNeeded, offset, value)
            }

            override fun onCharacteristicReadRequest(
                device: BluetoothDevice,
                requestId: Int,
                offset: Int,
                characteristic: BluetoothGattCharacteristic
            ) {
                handleCharacteristicRead(device, requestId, offset, characteristic)
            }

            override fun onMtuChanged(device: BluetoothDevice, mtu: Int) {
                handleMtuChange(device, mtu)
            }
        }

        gattServer = bluetoothManager?.openGattServer(reactApplicationContext, gattCallback)
        if (gattServer == null) {
            return promise.reject("BLE_PERIPHERAL_ERROR", "Failed to open GATT server")
        }

        // Create service with characteristics
        val service = BluetoothGattService(BEAM_SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)

        // Payment Request (Read, Notify)
        paymentRequestChar = BluetoothGattCharacteristic(
            PAYMENT_REQUEST_CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ
        ).apply {
            addDescriptor(createCCCDescriptor())
        }

        // Bundle Write (Write, Notify)
        bundleWriteChar = BluetoothGattCharacteristic(
            BUNDLE_WRITE_CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        ).apply {
            addDescriptor(createCCCDescriptor())
        }

        // Bundle Response (Notify)
        bundleResponseChar = BluetoothGattCharacteristic(
            BUNDLE_RESPONSE_CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            0
        ).apply {
            addDescriptor(createCCCDescriptor())
        }

        // Chunk Control (Write, Notify)
        chunkControlChar = BluetoothGattCharacteristic(
            CHUNK_CONTROL_CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        ).apply {
            addDescriptor(createCCCDescriptor())
        }

        // Connection State (Read, Notify)
        connectionStateChar = BluetoothGattCharacteristic(
            CONNECTION_STATE_CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ
        ).apply {
            addDescriptor(createCCCDescriptor())
            value = byteArrayOf(STATE_IDLE)
        }

        // Add characteristics to service
        service.addCharacteristic(paymentRequestChar)
        service.addCharacteristic(bundleWriteChar)
        service.addCharacteristic(bundleResponseChar)
        service.addCharacteristic(chunkControlChar)
        service.addCharacteristic(connectionStateChar)

        // Add service to GATT server
        if (!gattServer!!.addService(service)) {
            return promise.reject("BLE_PERIPHERAL_ERROR", "Failed to add service")
        }

        // Start advertising
        startBleAdvertising(promise)
    }

    private fun createCCCDescriptor(): BluetoothGattDescriptor {
        return BluetoothGattDescriptor(
            UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"),
            BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
        ).apply {
            value = BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
        }
    }

    private fun startBleAdvertising(promise: Promise) {
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setConnectable(true)
            .setTimeout(0)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .build()

        val data = AdvertiseData.Builder()
            .setIncludeDeviceName(true)
            .addServiceUuid(ParcelUuid(BEAM_SERVICE_UUID))
            .build()

        val callback = object : AdvertiseCallback() {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
                isAdvertising = true
                sendEvent("onAdvertisingStarted", Arguments.createMap().apply {
                    putString("merchantPubkey", merchantPubkey)
                    putString("merchantName", merchantName)
                })
                promise.resolve(Arguments.createMap().apply {
                    putBoolean("success", true)
                    putString("merchantPubkey", merchantPubkey)
                    putString("merchantName", merchantName)
                })
            }

            override fun onStartFailure(errorCode: Int) {
                sendEvent("onAdvertisingFailed", Arguments.createMap().apply {
                    putInt("errorCode", errorCode)
                    putString("error", getAdvertiseErrorString(errorCode))
                })
                promise.reject("BLE_PERIPHERAL_ERROR", "Advertising failed: ${getAdvertiseErrorString(errorCode)}")
            }
        }

        advertiser?.startAdvertising(settings, data, callback)
    }

    private fun stopBleAdvertising() {
        advertiser?.stopAdvertising(object : AdvertiseCallback() {})
        isAdvertising = false
    }

    private fun stopGattServer() {
        gattServer?.clearServices()
        gattServer?.close()
        gattServer = null
        connectedDevices.clear()
        deviceStates.clear()
        deviceMTUs.clear()
        incomingChunks.clear()
        outgoingChunks.clear()
    }

    private fun handleConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
        val address = device.address
        when (newState) {
            BluetoothProfile.STATE_CONNECTED -> {
                connectedDevices[address] = device
                deviceStates[address] = STATE_READY
                deviceMTUs[address] = DEFAULT_MTU_SIZE
                sendEvent("onDeviceConnected", Arguments.createMap().apply {
                    putString("address", address)
                    putString("name", device.name ?: "Unknown")
                })
            }
            BluetoothProfile.STATE_DISCONNECTED -> {
                cleanupDeviceState(address)
                sendEvent("onDeviceDisconnected", Arguments.createMap().apply {
                    putString("address", address)
                })
            }
        }
    }

    private fun handleCharacteristicWrite(
        device: BluetoothDevice,
        requestId: Int,
        characteristic: BluetoothGattCharacteristic,
        responseNeeded: Boolean,
        offset: Int,
        value: ByteArray?
    ) {
        val address = device.address
        value ?: run {
            if (responseNeeded) {
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_FAILURE, offset, null)
            }
            return
        }

        when (characteristic.uuid) {
            BUNDLE_WRITE_CHAR_UUID -> {
                handleBundleWrite(device, value)
            }
            CHUNK_CONTROL_CHAR_UUID -> {
                handleChunkControl(device, value)
            }
        }

        if (responseNeeded) {
            gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
        }
    }

    private fun handleCharacteristicRead(
        device: BluetoothDevice,
        requestId: Int,
        offset: Int,
        characteristic: BluetoothGattCharacteristic
    ) {
        gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, characteristic.value)
    }

    private fun handleMtuChange(device: BluetoothDevice, mtu: Int) {
        val address = device.address
        deviceMTUs[address] = mtu
        sendEvent("onMtuChanged", Arguments.createMap().apply {
            putString("address", address)
            putInt("mtu", mtu)
        })
    }

    private fun handleBundleWrite(device: BluetoothDevice, data: ByteArray) {
        try {
            val jsonString = String(data, Charsets.UTF_8)
            sendEvent("onBundleReceived", Arguments.createMap().apply {
                putString("deviceAddress", device.address)
                putString("bundle", jsonString)
            })
        } catch (e: Exception) {
            // Log error
        }
    }

    private fun handleChunkControl(device: BluetoothDevice, data: ByteArray) {
        if (data.isEmpty()) return

        val address = device.address
        val command = data[0]

        when (command) {
            CMD_START_TRANSFER -> {
                if (data.size >= 5) {
                    val totalSize = java.nio.ByteBuffer.wrap(data, 1, 4).int
                    incomingChunks[address] = ChunkBuffer(totalSize)
                    deviceStates[address] = STATE_RECEIVING
                    sendAck(device)
                }
            }
            CMD_CHUNK_DATA -> {
                val buffer = incomingChunks[address]
                if (buffer != null && data.size > 1) {
                    val chunkData = data.copyOfRange(1, data.size)
                    buffer.chunks.add(chunkData)
                    buffer.receivedSize += chunkData.size
                    buffer.lastChunkTime = System.currentTimeMillis()
                    sendAck(device)
                }
            }
            CMD_END_TRANSFER -> {
                val buffer = incomingChunks[address]
                if (buffer != null && buffer.receivedSize == buffer.totalSize) {
                    val completeData = buffer.chunks.fold(ByteArray(0)) { acc, chunk -> acc + chunk }
                    handleBundleWrite(device, completeData)
                    incomingChunks.remove(address)
                    deviceStates[address] = STATE_READY
                    sendAck(device)
                }
            }
        }
    }

    private fun startChunkedTransfer(device: BluetoothDevice, data: ByteArray, mtu: Int) {
        val address = device.address
        val chunkSize = (mtu - 3).coerceAtMost(MAX_CHUNK_SIZE)

        // Send START command
        val startCmd = ByteArray(5)
        startCmd[0] = CMD_START_TRANSFER
        java.nio.ByteBuffer.wrap(startCmd, 1, 4).putInt(data.size)
        bundleResponseChar?.value = startCmd
        gattServer?.notifyCharacteristicChanged(device, bundleResponseChar, false)

        // Send data chunks
        var offset = 0
        while (offset < data.size) {
            val chunkLength = (data.size - offset).coerceAtMost(chunkSize)
            val chunk = ByteArray(chunkLength + 1)
            chunk[0] = CMD_CHUNK_DATA
            System.arraycopy(data, offset, chunk, 1, chunkLength)

            bundleResponseChar?.value = chunk
            gattServer?.notifyCharacteristicChanged(device, bundleResponseChar, false)

            offset += chunkLength
            Thread.sleep(10) // Small delay between chunks
        }

        // Send END command
        bundleResponseChar?.value = byteArrayOf(CMD_END_TRANSFER)
        gattServer?.notifyCharacteristicChanged(device, bundleResponseChar, false)
    }

    private fun sendAck(device: BluetoothDevice) {
        chunkControlChar?.value = byteArrayOf(CMD_ACK)
        gattServer?.notifyCharacteristicChanged(device, chunkControlChar, false)
    }

    private fun cleanupDeviceState(address: String) {
        connectedDevices.remove(address)
        deviceStates.remove(address)
        deviceMTUs.remove(address)
        incomingChunks.remove(address)
        outgoingChunks.remove(address)
    }

    private fun sendEvent(eventName: String, params: WritableMap) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    private fun convertMapToJson(map: ReadableMap): String {
        val json = org.json.JSONObject()
        val iterator = map.keySetIterator()
        while (iterator.hasNextKey()) {
            val key = iterator.nextKey()
            when (val value = map.getType(key)) {
                ReadableType.Null -> json.put(key, null)
                ReadableType.Boolean -> json.put(key, map.getBoolean(key))
                ReadableType.Number -> json.put(key, map.getDouble(key))
                ReadableType.String -> json.put(key, map.getString(key))
                ReadableType.Map -> json.put(key, convertMapToJson(map.getMap(key)!!))
                ReadableType.Array -> json.put(key, map.getArray(key))
            }
        }
        return json.toString()
    }

    private fun getAdvertiseErrorString(errorCode: Int): String {
        return when (errorCode) {
            AdvertiseCallback.ADVERTISE_FAILED_DATA_TOO_LARGE -> "Data too large"
            AdvertiseCallback.ADVERTISE_FAILED_TOO_MANY_ADVERTISERS -> "Too many advertisers"
            AdvertiseCallback.ADVERTISE_FAILED_ALREADY_STARTED -> "Already started"
            AdvertiseCallback.ADVERTISE_FAILED_INTERNAL_ERROR -> "Internal error"
            AdvertiseCallback.ADVERTISE_FAILED_FEATURE_UNSUPPORTED -> "Feature unsupported"
            else -> "Unknown error: $errorCode"
        }
    }
}
