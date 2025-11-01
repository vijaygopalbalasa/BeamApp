# Project Overview: Beam Monorepo

Beam is an ambitious project focused on enabling offline-first, peer-to-peer (P2P) payments on the Solana blockchain, incorporating an escrow mechanism for secure transactions. The project is structured as a monorepo, encompassing several key components that work in concert to deliver its unique functionality.

## Core Components:

1.  **`program` (Solana Program - Rust/Anchor):**
    *   This directory contains the core Solana smart contract logic, written in Rust and built using the Anchor framework.
    *   It is responsible for managing on-chain operations, including the escrow system and the final settlement of payments.
    *   Utilizes `ed25519-dalek` and `sha2` for cryptographic operations, likely for verifying off-chain generated data or signatures.

2.  **`verifier` (Attestation Verifier Service - Node.js/Express):**
    *   An Express.js-based backend service that acts as a crucial security and attestation layer.
    *   It integrates with Google Play Integrity to verify the authenticity and integrity of the mobile application, preventing tampering and ensuring it runs on a genuine device.
    *   Performs cryptographic checks (using `@noble/ed25519` and `@noble/hashes`) that mirror those in the Solana program, adding an extra layer of security before sensitive interactions with the blockchain.

3.  **`mobile` (Mobile Application - React Native):**
    *   This workspace houses the mobile application, which is built using React Native for cross-platform compatibility.
    *   **`beam-app`:** The main user-facing application. It functions as a full Solana wallet, capable of managing keys, creating, and signing transactions.
    *   **`shared`:** A shared TypeScript library containing common, reusable code for the mobile application, primarily focused on cryptographic utilities (`@noble/ed25519`, `@noble/curves`, `@noble/hashes`), Base58 encoding (`bs58`), and QR code generation (`qrcode`).

## High-Level Architecture:

*   The **React Native mobile app** serves as the primary user interface, capable of operating both online and offline.
*   In **online mode**, the app interacts directly with the Solana network and the `verifier` service.
*   In **offline mode**, the app utilizes **Bluetooth** to enable direct communication between users' devices, allowing them to create and sign transactions. These transactions can then be broadcast to the Solana network once either device regains an internet connection.
*   The **`verifier` service** acts as a critical gatekeeper, ensuring that only legitimate and untampered mobile applications can perform sensitive operations with the Solana program.
*   The **Solana `program`** on the blockchain maintains the integrity of the escrow system and finalizes payment settlements.

This architecture demonstrates a robust and innovative approach to secure, offline-capable P2P payments on Solana.

## Building and Running:

The project uses `pnpm` as its package manager and `cargo` for the Rust-based Solana program.

*   **Install all dependencies and build the Solana program:**
    ```bash
    pnpm install:all
    ```
*   **Run the verifier service in development mode:**
    ```bash
    pnpm dev:verifier
    ```
*   **Start a local Solana test validator:**
    ```bash
    pnpm dev:validator
    ```
*   **Build the Solana program:**
    ```bash
    pnpm build:program
    ```
*   **Test the Solana program:**
    ```bash
    pnpm test:program
    ```
*   **Run tests across all workspaces:**
    ```bash
    pnpm test:all
    ```
*   **Lint all workspaces:**
    ```bash
    pnpm lint
    ```
*   **Format code across all workspaces:**
    ```bash
    pnpm format
    ```
*   **Mobile App Specific Commands (from `mobile/beam-app`):**
    *   Run on Android: `react-native run-android`
    *   Run on iOS: `react-native run-ios`
    *   Start React Native packager: `react-native start`
    *   Clean Android build: `cd android && ./gradlew clean`
    *   Clean iOS build: `cd ios && xcodebuild clean && rm -rf Pods && rm -rf ~/Library/Developer/Xcode/DerivedData/*`
    *   Install iOS Pods: `cd ios && pod install --repo-update`

## Development Conventions:

*   **Language:** Primarily TypeScript for JavaScript/Node.js components and React Native, and Rust for the Solana program.
*   **Package Management:** `pnpm` is used for managing dependencies across the monorepo.
*   **Code Quality:** `eslint` for linting and `prettier` for code formatting are used across the JavaScript/TypeScript workspaces.
*   **Testing:** `vitest` is used for testing JavaScript/TypeScript components, and `anchor test` for the Solana program.


## Offline Payment Implementation Plan (2025 Ready)

This section outlines a refined plan to implement secure and robust offline payment functionality, addressing identified gaps and leveraging modern, actively maintained libraries suitable for 2025 development.

### A. BLE Communication Stack (Hybrid Aproach):

Given the absence of a single, actively maintained React Native BLE library that comprehensively supports both central and peripheral roles with full GATT server functionality out-of-the-box, a hybrid approach is proposed:

1.  **Central Role (Customer App):**
    *   **Library:** Continue using **`react-native-ble-plx`** (`@ble-plx/react-native-ble-plx`). This library is robust and actively maintained for central operations (scanning, connecting, reading/writing characteristics). Android 12+ permissions will be carefully managed.

2.  **Peripheral Role (Merchant App):**
    *   **Solution:** Develop a **custom native module** (Swift for iOS, Kotlin/Java for Android).
    *   **Functionality:** This native module will encapsulate:
        *   Starting/stopping BLE advertising with custom data (including the merchant's authenticated identifier).
        *   Creating and managing a GATT server with custom services and characteristics (e.g., for Diffie-Hellman public key exchange, encrypted transaction bundle transfer, and response notifications).
        *   Handling characteristic read/write/notify requests.
        *   Exposing a clear JavaScript API to React Native for merchant-specific BLE operations.
    *   **Justification:** This approach provides the necessary control, leverages modern native BLE APIs for future compatibility, and ensures robust GATT server implementation, critical for secure, dynamic data exchange as required for payment transactions.

### B. Secure Cryptographic Operations and Storage:

To ensure the highest level of security for offline transactions, hardware-backed cryptographic operations and storage will be leveraged:

1.  **Cryptographic Primitives:** Continue using `@noble/curves` (e.g., `secp256k1` for ECDH) and `@noble/hashes` for Diffie-Hellman key exchange, encryption key derivation, and hashing operations.

2.  **Hardware-Backed Secure Key Storage:** Utilize **`react-native-keychain`** (`@react-native-community/keychain`) for storing low-level sensitive data such as ephemeral Diffie-Hellman private keys and permanent Solana private keys (if the application's architecture requires local storage for signing).

3.  **Encrypted Local Transaction Storage (TEE/Hardware-Backed):** Implement the storage of transaction bundles using **`react-native-secure-encryption-module`** (`react-native-secure-encryption-module`). This ensures that locally stored bundles are encrypted using hardware-backed keys (Secure Enclave on iOS, Android Keystore on Android), significantly protecting them even if the device's file system is compromised.

### C. Implementation Phases (Refined):

1.  **Phase 1: Foundation (Current - partly completed):**
    *   `GEMINI.md` generation (completed).
    *   Confirmed `react-native-ble-plx` for central role.
    *   Updated `Config/index.ts` with Diffie-Hellman characteristic UUIDs (completed).
    *   *Upcoming:* Install `react-native-keychain` and `react-native-secure-encryption-module`.

2.  **Phase 2: Secure BLE Communication & Key Exchange (Requires Native Module):**
    *   **Merchant Identity Verification (Pre-Connection):**
        *   Modify QR code generation to include the merchant's Solana public key and a signed timestamp/nonce.
        *   The customer app, using `react-native-ble-plx`, will scan, read advertising data, and cryptographically verify the merchant's signature *before* connecting.
    *   **Diffie-Hellman Key Exchange over BLE (via Native Module):**
        *   A new API will be exposed from the native module to handle DH key pair generation, public key advertising, receiving customer's public key, and deriving a shared symmetric secret.
        *   The customer app will use `react-native-ble-plx` to perform its part of the DH key exchange.
    *   **Encrypted Data Transfer over BLE (via Native Module):** All sensitive data (payment requests, transaction bundles) will be encrypted with the derived shared secret and authenticated before being transferred via BLE characteristics.

3.  **Phase 3: Offline Transaction Bundling & Secure Local Storage:**
    *   **Transaction Bundle Structure:** Define a robust data structure for offline transaction data, including encrypted payment details, customer and merchant signatures, timestamps, and unique transaction IDs.
    *   **Secure Local Storage:** Utilize `react-native-secure-encryption-module` to encrypt and store these bundles, with keys managed by `react-native-keychain` or the encryption module itself leveraging hardware security.

4.  **Phase 4: Online Synchronization and Settlement:**
    *   **Network Status Monitoring:** Continue using `@react-native-community/netinfo` to detect when the device comes online.
    *   **Synchronization Service:** Develop a dedicated service to retrieve, decrypt, verify, and submit stored offline transactions to the Solana network (potentially via the `verifier` service) when online.

5.  **Phase 5: UI/UX Enhancements:**
    *   Provide clear user feedback on secure BLE connection status, offline payment confirmation, and online synchronization notifications, including transaction signatures and explorer links.