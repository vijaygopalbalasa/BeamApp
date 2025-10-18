//
//  BLEPeripheralModule.swift
//  BeamApp
//
//  Enhanced BLE Peripheral Module for Beam Merchant Mode
//  Provides full BLE peripheral support for iOS devices
//

import Foundation
import CoreBluetooth
import React

@objc(BLEPeripheralModule)
class BLEPeripheralModule: RCTEventEmitter {

    // MARK: - Constants

    // Beam BLE Protocol UUIDs
    static let beamServiceUUID = CBUUID(string: "00006265-0000-1000-8000-00805f9b34fb")
    static let paymentRequestCharUUID = CBUUID(string: "000062b0-0000-1000-8000-00805f9b34fb")
    static let bundleWriteCharUUID = CBUUID(string: "000062b1-0000-1000-8000-00805f9b34fb")
    static let bundleResponseCharUUID = CBUUID(string: "000062b2-0000-1000-8000-00805f9b34fb")
    static let chunkControlCharUUID = CBUUID(string: "000062b3-0000-1000-8000-00805f9b34fb")
    static let connectionStateCharUUID = CBUUID(string: "000062b4-0000-1000-8000-00805f9b34fb")

    // Protocol Constants
    static let maxMTUSize = 512
    static let defaultMTUSize = 23
    static let maxChunkSize = maxMTUSize - 3
    static let maxBundleSize = 256 * 1024 // 256KB

    // Connection States
    static let stateIdle: UInt8 = 0
    static let stateReady: UInt8 = 1
    static let stateReceiving: UInt8 = 2
    static let stateProcessing: UInt8 = 3
    static let stateResponding: UInt8 = 4

    // Chunk Control Commands
    static let cmdStartTransfer: UInt8 = 0x01
    static let cmdChunkData: UInt8 = 0x02
    static let cmdEndTransfer: UInt8 = 0x03
    static let cmdAck: UInt8 = 0x04
    static let cmdError: UInt8 = 0x05

    // MARK: - Properties

    private var peripheralManager: CBPeripheralManager?
    private var isAdvertising = false
    private var merchantPubkey: String?
    private var merchantName: String?

    // Characteristics
    private var paymentRequestChar: CBMutableCharacteristic?
    private var bundleWriteChar: CBMutableCharacteristic?
    private var bundleResponseChar: CBMutableCharacteristic?
    private var chunkControlChar: CBMutableCharacteristic?
    private var connectionStateChar: CBMutableCharacteristic?

    // Connection management
    private var connectedCentrals = Set<CBCentral>()
    private var centralStates = [UUID: UInt8]()
    private var centralMTUs = [UUID: Int]()

    // Chunked transfer management
    private var incomingChunks = [UUID: ChunkBuffer]()
    private var outgoingChunks = [UUID: ChunkBuffer]()

    // MARK: - Chunk Buffer

    class ChunkBuffer {
        var totalSize: Int
        var receivedSize: Int = 0
        var chunks: [Data] = []
        var lastChunkTime: Date = Date()

        init(totalSize: Int) {
            self.totalSize = totalSize
        }
    }

    // MARK: - RCTEventEmitter

    override init() {
        super.init()
    }

    override static func requiresMainQueueSetup() -> Bool {
        return true
    }

    override func supportedEvents() -> [String]! {
        return [
            "onAdvertisingStarted",
            "onAdvertisingFailed",
            "onDeviceConnected",
            "onDeviceDisconnected",
            "onMtuChanged",
            "onBundleReceived"
        ]
    }

    // MARK: - Public Methods

    @objc func startAdvertising(_ config: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let pubkey = config["merchantPubkey"] as? String,
              let name = config["merchantName"] as? String else {
            reject("BLE_PERIPHERAL_ERROR", "merchantPubkey and merchantName required", nil)
            return
        }

        merchantPubkey = pubkey
        merchantName = name

        // Initialize peripheral manager if needed
        if peripheralManager == nil {
            peripheralManager = CBPeripheralManager(
                delegate: self,
                queue: nil,
                options: [CBPeripheralManagerOptionShowPowerAlertKey: true]
            )
        }

        // Check state and start advertising
        if peripheralManager?.state == .poweredOn {
            startGattServer(resolve: resolve, reject: reject)
        } else {
            // Will start in peripheralManagerDidUpdateState
            resolve([
                "success": true,
                "merchantPubkey": pubkey,
                "merchantName": name,
                "pending": true
            ])
        }
    }

    @objc func stopAdvertising(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        stopBleAdvertising()
        stopGattServer()
        isAdvertising = false

        resolve(["success": true])
    }

    @objc func updatePaymentRequest(_ paymentRequest: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let characteristic = paymentRequestChar else {
            reject("BLE_PERIPHERAL_ERROR", "GATT server not running", nil)
            return
        }

        do {
            let data = try JSONSerialization.data(withJSONObject: paymentRequest)

            // Update characteristic value
            let success = peripheralManager?.updateValue(data, for: characteristic, onSubscribedCentrals: nil)

            resolve(["success": success ?? false])
        } catch {
            reject("BLE_PERIPHERAL_ERROR", "Failed to serialize payment request", error)
        }
    }

    @objc func sendResponseBundle(_ deviceAddress: String, bundleJson: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let data = bundleJson.data(using: .utf8) else {
            reject("BLE_PERIPHERAL_ERROR", "Invalid bundle JSON", nil)
            return
        }

        if data.count > BLEPeripheralModule.maxBundleSize {
            reject("BLE_PERIPHERAL_ERROR", "Bundle too large: \(data.count) bytes", nil)
            return
        }

        // Find the central by address
        // Note: iOS doesn't expose MAC addresses, so we'll send to all connected centrals
        // In production, you'd need a mapping mechanism
        for central in connectedCentrals {
            sendChunkedData(data: data, to: central)
            centralStates[central.identifier] = BLEPeripheralModule.stateReady
        }

        resolve([
            "success": true,
            "bytesSent": data.count
        ])
    }

    @objc func getConnectedDevices(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        var devices: [[String: Any]] = []

        for central in connectedCentrals {
            let state = centralStates[central.identifier] ?? BLEPeripheralModule.stateIdle
            let mtu = centralMTUs[central.identifier] ?? BLEPeripheralModule.defaultMTUSize

            devices.append([
                "address": central.identifier.uuidString,
                "name": "iOS Central", // iOS doesn't expose central name
                "state": state,
                "mtu": mtu
            ])
        }

        resolve(devices)
    }

    @objc func disconnectDevice(_ deviceAddress: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        // iOS doesn't allow peripheral to forcibly disconnect centrals
        // We can only stop responding to them

        if let uuid = UUID(uuidString: deviceAddress) {
            connectedCentrals.removeAll { $0.identifier == uuid }
            centralStates.removeValue(forKey: uuid)
            centralMTUs.removeValue(forKey: uuid)
            incomingChunks.removeValue(forKey: uuid)
            outgoingChunks.removeValue(forKey: uuid)
        }

        resolve(["success": true])
    }

    // MARK: - Private Methods

    private func startGattServer(resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let manager = peripheralManager else {
            reject("BLE_PERIPHERAL_ERROR", "Peripheral manager not initialized", nil)
            return
        }

        // Create service
        let service = CBMutableService(type: BLEPeripheralModule.beamServiceUUID, primary: true)

        // Payment Request Characteristic (Read, Notify)
        paymentRequestChar = CBMutableCharacteristic(
            type: BLEPeripheralModule.paymentRequestCharUUID,
            properties: [.read, .notify],
            value: nil,
            permissions: [.readable]
        )

        // Bundle Write Characteristic (Write, Notify)
        bundleWriteChar = CBMutableCharacteristic(
            type: BLEPeripheralModule.bundleWriteCharUUID,
            properties: [.write, .writeWithoutResponse, .notify],
            value: nil,
            permissions: [.writeable]
        )

        // Bundle Response Characteristic (Notify)
        bundleResponseChar = CBMutableCharacteristic(
            type: BLEPeripheralModule.bundleResponseCharUUID,
            properties: [.notify],
            value: nil,
            permissions: []
        )

        // Chunk Control Characteristic (Write, Notify)
        chunkControlChar = CBMutableCharacteristic(
            type: BLEPeripheralModule.chunkControlCharUUID,
            properties: [.write, .notify],
            value: nil,
            permissions: [.writeable]
        )

        // Connection State Characteristic (Read, Notify)
        connectionStateChar = CBMutableCharacteristic(
            type: BLEPeripheralModule.connectionStateCharUUID,
            properties: [.read, .notify],
            value: nil,
            permissions: [.readable]
        )

        // Add characteristics to service
        service.characteristics = [
            paymentRequestChar!,
            bundleWriteChar!,
            bundleResponseChar!,
            chunkControlChar!,
            connectionStateChar!
        ]

        // Add service
        manager.add(service)

        // Start advertising
        startBleAdvertising()

        resolve([
            "success": true,
            "merchantPubkey": merchantPubkey ?? "",
            "merchantName": merchantName ?? ""
        ])
    }

    private func stopGattServer() {
        peripheralManager?.removeAllServices()
        connectedCentrals.removeAll()
        centralStates.removeAll()
        centralMTUs.removeAll()
        incomingChunks.removeAll()
        outgoingChunks.removeAll()
    }

    private func startBleAdvertising() {
        guard let manager = peripheralManager,
              let name = merchantName else {
            return
        }

        let deviceName = "Beam-\(name)"

        let advertisementData: [String: Any] = [
            CBAdvertisementDataServiceUUIDsKey: [BLEPeripheralModule.beamServiceUUID],
            CBAdvertisementDataLocalNameKey: deviceName
        ]

        manager.startAdvertising(advertisementData)
        isAdvertising = true

        print("[BLEPeripheral] Started advertising as \(deviceName)")
    }

    private func stopBleAdvertising() {
        peripheralManager?.stopAdvertising()
        isAdvertising = false
    }

    private func sendChunkedData(data: Data, to central: CBCentral) {
        guard let manager = peripheralManager,
              let controlChar = chunkControlChar else {
            return
        }

        let mtu = centralMTUs[central.identifier] ?? BLEPeripheralModule.defaultMTUSize
        let chunkSize = min(mtu - 3, BLEPeripheralModule.maxChunkSize)

        // Send start transfer command
        var startCmd = Data()
        startCmd.append(BLEPeripheralModule.cmdStartTransfer)
        var size = UInt32(data.count).bigEndian
        startCmd.append(Data(bytes: &size, count: 4))

        manager.updateValue(startCmd, for: controlChar, onSubscribedCentrals: [central])

        // Send data in chunks
        var offset = 0
        while offset < data.count {
            let remainingBytes = data.count - offset
            let currentChunkSize = min(remainingBytes, chunkSize)

            var chunkData = Data()
            chunkData.append(BLEPeripheralModule.cmdChunkData)
            chunkData.append(data.subdata(in: offset..<(offset + currentChunkSize)))

            manager.updateValue(chunkData, for: controlChar, onSubscribedCentrals: [central])

            offset += currentChunkSize

            // Small delay between chunks
            usleep(10000) // 10ms
        }

        // Send end transfer command
        let endCmd = Data([BLEPeripheralModule.cmdEndTransfer])
        manager.updateValue(endCmd, for: controlChar, onSubscribedCentrals: [central])
    }

    private func handleChunkControl(data: Data, from central: CBCentral) {
        guard !data.isEmpty else { return }

        let command = data[0]
        let centralId = central.identifier

        switch command {
        case BLEPeripheralModule.cmdStartTransfer:
            if data.count >= 5 {
                let totalSize = data.subdata(in: 1..<5).withUnsafeBytes { $0.load(as: UInt32.self).bigEndian }
                incomingChunks[centralId] = ChunkBuffer(totalSize: Int(totalSize))
                centralStates[centralId] = BLEPeripheralModule.stateReceiving

                // Send ACK
                sendChunkControlAck(to: central)
            }

        case BLEPeripheralModule.cmdChunkData:
            if let buffer = incomingChunks[centralId], data.count > 1 {
                let chunkData = data.subdata(in: 1..<data.count)
                buffer.chunks.append(chunkData)
                buffer.receivedSize += chunkData.count
                buffer.lastChunkTime = Date()
            }

        case BLEPeripheralModule.cmdEndTransfer:
            if let buffer = incomingChunks.removeValue(forKey: centralId) {
                var completeData = Data()
                buffer.chunks.forEach { completeData.append($0) }

                if let bundleJson = String(data: completeData, encoding: .utf8) {
                    processBundleReceived(bundleJson: bundleJson, from: central)
                    centralStates[centralId] = BLEPeripheralModule.stateProcessing
                }
            }

        default:
            break
        }
    }

    private func sendChunkControlAck(to central: CBCentral) {
        guard let manager = peripheralManager,
              let controlChar = chunkControlChar else {
            return
        }

        let ackData = Data([BLEPeripheralModule.cmdAck])
        manager.updateValue(ackData, for: controlChar, onSubscribedCentrals: [central])
    }

    private func processBundleReceived(bundleJson: String, from central: CBCentral) {
        print("[BLEPeripheral] Received payment bundle from \(central.identifier)")

        sendEvent(withName: "onBundleReceived", body: [
            "deviceAddress": central.identifier.uuidString,
            "bundle": bundleJson
        ])
    }
}

// MARK: - CBPeripheralManagerDelegate

extension BLEPeripheralModule: CBPeripheralManagerDelegate {

    func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        switch peripheral.state {
        case .poweredOn:
            print("[BLEPeripheral] Bluetooth powered on")
            if merchantPubkey != nil && !isAdvertising {
                startBleAdvertising()
            }

        case .poweredOff:
            print("[BLEPeripheral] Bluetooth powered off")
            sendEvent(withName: "onAdvertisingFailed", body: [
                "error": "Bluetooth is powered off"
            ])

        case .unauthorized:
            print("[BLEPeripheral] Bluetooth unauthorized")
            sendEvent(withName: "onAdvertisingFailed", body: [
                "error": "Bluetooth permission denied"
            ])

        case .unsupported:
            print("[BLEPeripheral] Bluetooth unsupported")
            sendEvent(withName: "onAdvertisingFailed", body: [
                "error": "Bluetooth not supported on this device"
            ])

        default:
            break
        }
    }

    func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
        if let error = error {
            print("[BLEPeripheral] Failed to start advertising: \(error.localizedDescription)")
            sendEvent(withName: "onAdvertisingFailed", body: [
                "error": error.localizedDescription
            ])
        } else {
            print("[BLEPeripheral] Advertising started successfully")
            sendEvent(withName: "onAdvertisingStarted", body: [
                "merchantName": merchantName ?? ""
            ])
        }
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didSubscribeTo characteristic: CBCharacteristic) {
        connectedCentrals.insert(central)
        centralStates[central.identifier] = BLEPeripheralModule.stateReady

        print("[BLEPeripheral] Central subscribed: \(central.identifier)")

        sendEvent(withName: "onDeviceConnected", body: [
            "deviceAddress": central.identifier.uuidString,
            "deviceName": "iOS Central"
        ])
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didUnsubscribeFrom characteristic: CBCharacteristic) {
        connectedCentrals.remove(central)
        centralStates.removeValue(forKey: central.identifier)
        centralMTUs.removeValue(forKey: central.identifier)

        print("[BLEPeripheral] Central unsubscribed: \(central.identifier)")

        sendEvent(withName: "onDeviceDisconnected", body: [
            "deviceAddress": central.identifier.uuidString
        ])
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveRead request: CBATTRequest) {
        switch request.characteristic.uuid {
        case BLEPeripheralModule.paymentRequestCharUUID:
            if let value = paymentRequestChar?.value {
                if request.offset > value.count {
                    peripheral.respond(to: request, withResult: .invalidOffset)
                } else {
                    request.value = value.subdata(in: request.offset..<value.count)
                    peripheral.respond(to: request, withResult: .success)
                }
            } else {
                peripheral.respond(to: request, withResult: .success)
            }

        case BLEPeripheralModule.connectionStateCharUUID:
            let state = centralStates[request.central.identifier] ?? BLEPeripheralModule.stateIdle
            request.value = Data([state])
            peripheral.respond(to: request, withResult: .success)

        default:
            peripheral.respond(to: request, withResult: .readNotPermitted)
        }
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
        for request in requests {
            guard let value = request.value else {
                peripheral.respond(to: request, withResult: .invalidAttributeValueLength)
                continue
            }

            switch request.characteristic.uuid {
            case BLEPeripheralModule.bundleWriteCharUUID:
                // For small bundles, handle directly
                if value.count < BLEPeripheralModule.maxChunkSize {
                    if let bundleJson = String(data: value, encoding: .utf8) {
                        processBundleReceived(bundleJson: bundleJson, from: request.central)
                    }
                }
                peripheral.respond(to: request, withResult: .success)

            case BLEPeripheralModule.chunkControlCharUUID:
                handleChunkControl(data: value, from: request.central)
                peripheral.respond(to: request, withResult: .success)

            default:
                peripheral.respond(to: request, withResult: .writeNotPermitted)
            }
        }
    }
}
