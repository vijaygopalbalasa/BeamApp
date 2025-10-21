package com.beam.app.modules

import android.util.Base64
import android.util.Log
import com.facebook.react.bridge.*
import org.json.JSONArray
import org.json.JSONObject
import java.security.*
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import net.i2p.crypto.eddsa.EdDSAPrivateKey
import net.i2p.crypto.eddsa.EdDSAPublicKey
import net.i2p.crypto.eddsa.spec.EdDSANamedCurveTable
import net.i2p.crypto.eddsa.spec.EdDSAParameterSpec
import net.i2p.crypto.eddsa.spec.EdDSAPrivateKeySpec
import net.i2p.crypto.eddsa.spec.EdDSAPublicKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SecureStorageBridgeModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "SecureStorageBridge"
        private const val KEYSTORE_PROVIDER = "AndroidKeyStore"
        private const val ENCRYPTION_KEY_ALIAS = "beam_encryption_key"
        private const val PREFS_NAME = "BeamSecureStorage"
        private const val KEY_BUNDLES = "bundles"
        private const val KEY_ED25519_SEED = "ed25519_seed"
    }

    override fun getName(): String = "SecureStorageBridge"

    private fun getSharedPrefs() = reactApplicationContext.getSharedPreferences(PREFS_NAME, 0)

    /**
     * Get or create AES encryption key in Android KeyStore
     */
    private fun getOrCreateEncryptionKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER)
        keyStore.load(null)

        if (!keyStore.containsAlias(ENCRYPTION_KEY_ALIAS)) {
            val keyGenerator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES,
                KEYSTORE_PROVIDER
            )
            val spec = KeyGenParameterSpec.Builder(
                ENCRYPTION_KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()

            keyGenerator.init(spec)
            return keyGenerator.generateKey()
        }

        return keyStore.getKey(ENCRYPTION_KEY_ALIAS, null) as SecretKey
    }

    /**
     * Encrypt data using AES-GCM
     */
    private fun encrypt(data: ByteArray): Pair<ByteArray, ByteArray> {
        val secretKey = getOrCreateEncryptionKey()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey)
        val iv = cipher.iv
        val encrypted = cipher.doFinal(data)
        return Pair(encrypted, iv)
    }

    /**
     * Decrypt data using AES-GCM
     */
    private fun decrypt(encrypted: ByteArray, iv: ByteArray): ByteArray {
        val secretKey = getOrCreateEncryptionKey()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val spec = GCMParameterSpec(128, iv)
        cipher.init(Cipher.DECRYPT_MODE, secretKey, spec)
        return cipher.doFinal(encrypted)
    }

    @ReactMethod
    fun ensureWalletKeypair(promise: Promise) {
        try {
            val prefs = getSharedPrefs()
            var seed: ByteArray

            // Check if we have an existing encrypted seed
            val encryptedSeedB64 = prefs.getString(KEY_ED25519_SEED, null)
            val ivB64 = prefs.getString("${KEY_ED25519_SEED}_iv", null)

            if (encryptedSeedB64 != null && ivB64 != null) {
                // Decrypt existing seed
                val encryptedSeed = Base64.decode(encryptedSeedB64, Base64.NO_WRAP)
                val iv = Base64.decode(ivB64, Base64.NO_WRAP)
                seed = decrypt(encryptedSeed, iv)
                Log.d(TAG, "Loaded existing Ed25519 keypair")
            } else {
                // Generate new 32-byte seed for Ed25519
                seed = ByteArray(32)
                SecureRandom().nextBytes(seed)

                // Encrypt and store the seed
                val (encryptedSeed, iv) = encrypt(seed)
                prefs.edit()
                    .putString(KEY_ED25519_SEED, Base64.encodeToString(encryptedSeed, Base64.NO_WRAP))
                    .putString("${KEY_ED25519_SEED}_iv", Base64.encodeToString(iv, Base64.NO_WRAP))
                    .apply()

                Log.d(TAG, "Generated new Ed25519 keypair")
            }

            // Generate Ed25519 keypair from seed
            val edParams = EdDSANamedCurveTable.getByName("Ed25519")
            val privateKeySpec = EdDSAPrivateKeySpec(seed, edParams)
            val privateKey = EdDSAPrivateKey(privateKeySpec)

            // Derive public key from private key
            // Ed25519 public key is just the A point encoded
            val publicKeyBytes = privateKey.a.toByteArray()

            // Verify we have 32 bytes
            if (publicKeyBytes.size != 32) {
                Log.e(TAG, "Invalid public key size: ${publicKeyBytes.size}")
                promise.reject("WALLET_ERROR", "Generated invalid public key")
                return
            }

            val publicKeyBase64 = Base64.encodeToString(publicKeyBytes, Base64.NO_WRAP)

            Log.d(TAG, "✅ Generated Ed25519 keypair - Public key: ${publicKeyBase64.take(20)}...")
            Log.d(TAG, "✅ Public key size: ${publicKeyBytes.size} bytes (valid for Solana)")
            promise.resolve(publicKeyBase64)
        } catch (e: Exception) {
            Log.e(TAG, "Error ensuring wallet keypair", e)
            promise.reject("WALLET_ERROR", "Failed to ensure wallet keypair: ${e.message}", e)
        }
    }

    @ReactMethod
    fun signDetached(payload: String, options: ReadableMap?, promise: Promise) {
        try {
            val prefs = getSharedPrefs()

            // Load and decrypt the seed
            val encryptedSeedB64 = prefs.getString(KEY_ED25519_SEED, null)
            val ivB64 = prefs.getString("${KEY_ED25519_SEED}_iv", null)

            if (encryptedSeedB64 == null || ivB64 == null) {
                promise.reject("WALLET_ERROR", "Wallet not initialized")
                return
            }

            val encryptedSeed = Base64.decode(encryptedSeedB64, Base64.NO_WRAP)
            val iv = Base64.decode(ivB64, Base64.NO_WRAP)
            val seed = decrypt(encryptedSeed, iv)

            // Recreate private key from seed
            val edParams = EdDSANamedCurveTable.getByName("Ed25519")
            val privateKeySpec = EdDSAPrivateKeySpec(seed, edParams)
            val privateKey = EdDSAPrivateKey(privateKeySpec)

            // Sign the payload
            val signature = Signature.getInstance("NONEwithEdDSA", "EdDSA")
            signature.initSign(privateKey)
            val payloadBytes = Base64.decode(payload, Base64.NO_WRAP)
            signature.update(payloadBytes)
            val signatureBytes = signature.sign()

            val signatureBase64 = Base64.encodeToString(signatureBytes, Base64.NO_WRAP)
            promise.resolve(signatureBase64)
        } catch (e: Exception) {
            Log.e(TAG, "Error in signDetached", e)
            promise.reject("SIGN_ERROR", "Failed to sign: ${e.message}", e)
        }
    }

    @ReactMethod
    fun storeTransaction(bundleId: String, payload: String, metadata: ReadableMap, promise: Promise) {
        try {
            val prefs = getSharedPrefs()
            val bundlesJson = prefs.getString(KEY_BUNDLES, "[]") ?: "[]"
            val bundles = JSONArray(bundlesJson)

            val bundle = JSONObject()
            bundle.put("bundleId", bundleId)
            bundle.put("payload", payload)
            bundle.put("metadata", convertMapToJson(metadata))

            bundles.put(bundle)
            prefs.edit().putString(KEY_BUNDLES, bundles.toString()).apply()
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "Error storing transaction", e)
            promise.reject("STORE_ERROR", "Failed to store transaction: ${e.message}", e)
        }
    }

    @ReactMethod
    fun loadTransactions(promise: Promise) {
        try {
            val prefs = getSharedPrefs()
            val bundlesJson = prefs.getString(KEY_BUNDLES, "[]") ?: "[]"
            val bundles = JSONArray(bundlesJson)

            val result = Arguments.createArray()
            for (i in 0 until bundles.length()) {
                val bundle = bundles.getJSONObject(i)
                val bundleMap = Arguments.createMap()
                bundleMap.putString("bundleId", bundle.getString("bundleId"))
                bundleMap.putString("payload", bundle.getString("payload"))
                if (bundle.has("metadata")) {
                    bundleMap.putMap("metadata", convertJsonToMap(bundle.getJSONObject("metadata")))
                }
                result.pushMap(bundleMap)
            }

            promise.resolve(result)
        } catch (e: Exception) {
            Log.e(TAG, "Error loading transactions", e)
            promise.reject("LOAD_ERROR", "Failed to load transactions: ${e.message}", e)
        }
    }

    @ReactMethod
    fun removeTransaction(bundleId: String, promise: Promise) {
        try {
            val prefs = getSharedPrefs()
            val bundlesJson = prefs.getString(KEY_BUNDLES, "[]") ?: "[]"
            val bundles = JSONArray(bundlesJson)

            val newBundles = JSONArray()
            for (i in 0 until bundles.length()) {
                val bundle = bundles.getJSONObject(i)
                if (bundle.getString("bundleId") != bundleId) {
                    newBundles.put(bundle)
                }
            }

            prefs.edit().putString(KEY_BUNDLES, newBundles.toString()).apply()
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "Error removing transaction", e)
            promise.reject("REMOVE_ERROR", "Failed to remove transaction: ${e.message}", e)
        }
    }

    @ReactMethod
    fun clearAll(promise: Promise) {
        try {
            val prefs = getSharedPrefs()
            prefs.edit().clear().apply()
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "Error clearing storage", e)
            promise.reject("CLEAR_ERROR", "Failed to clear storage: ${e.message}", e)
        }
    }

    @ReactMethod
    fun fetchAttestation(bundleId: String, options: ReadableMap?, promise: Promise) {
        try {
            // Create mock attestation envelope for development
            val attestation = Arguments.createMap()
            attestation.putString("bundleId", bundleId)
            attestation.putString("timestamp", System.currentTimeMillis().toString())
            attestation.putString("nonce", java.util.UUID.randomUUID().toString())
            attestation.putString("attestationReport", "mock_attestation_report")
            attestation.putString("signature", "mock_signature")

            val certificateChain = Arguments.createArray()
            certificateChain.pushString("mock_cert_1")
            certificateChain.pushString("mock_cert_2")
            attestation.putArray("certificateChain", certificateChain)

            val deviceInfo = Arguments.createMap()
            deviceInfo.putString("model", android.os.Build.MODEL)
            deviceInfo.putString("manufacturer", android.os.Build.MANUFACTURER)
            deviceInfo.putString("androidVersion", android.os.Build.VERSION.RELEASE)
            attestation.putMap("deviceInfo", deviceInfo)

            promise.resolve(attestation)
        } catch (e: Exception) {
            Log.e(TAG, "Error fetching attestation", e)
            promise.reject("ATTESTATION_ERROR", "Failed to fetch attestation: ${e.message}", e)
        }
    }

    @ReactMethod
    fun resetWallet(promise: Promise) {
        try {
            val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER)
            keyStore.load(null)
            keyStore.deleteEntry(ENCRYPTION_KEY_ALIAS)

            val prefs = getSharedPrefs()
            prefs.edit().clear().apply()

            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "Error resetting wallet", e)
            promise.reject("RESET_ERROR", "Failed to reset wallet: ${e.message}", e)
        }
    }

    private fun convertMapToJson(readableMap: ReadableMap): JSONObject {
        val json = JSONObject()
        val iterator = readableMap.keySetIterator()
        while (iterator.hasNextKey()) {
            val key = iterator.nextKey()
            when (readableMap.getType(key)) {
                ReadableType.String -> json.put(key, readableMap.getString(key))
                ReadableType.Number -> json.put(key, readableMap.getDouble(key))
                ReadableType.Boolean -> json.put(key, readableMap.getBoolean(key))
                ReadableType.Map -> json.put(key, convertMapToJson(readableMap.getMap(key)!!))
                ReadableType.Array -> {
                    val array = readableMap.getArray(key)
                    if (array != null) {
                        json.put(key, convertArrayToJson(array))
                    }
                }
                else -> {}
            }
        }
        return json
    }

    private fun convertArrayToJson(readableArray: ReadableArray): JSONArray {
        val json = JSONArray()
        for (i in 0 until readableArray.size()) {
            when (readableArray.getType(i)) {
                ReadableType.String -> json.put(readableArray.getString(i))
                ReadableType.Number -> json.put(readableArray.getDouble(i))
                ReadableType.Boolean -> json.put(readableArray.getBoolean(i))
                ReadableType.Map -> json.put(convertMapToJson(readableArray.getMap(i)))
                ReadableType.Array -> json.put(convertArrayToJson(readableArray.getArray(i)))
                else -> {}
            }
        }
        return json
    }

    private fun convertJsonToMap(json: JSONObject): ReadableMap {
        val map = Arguments.createMap()
        val iterator = json.keys()
        while (iterator.hasNext()) {
            val key = iterator.next()
            val value = json.get(key)
            when (value) {
                is String -> map.putString(key, value)
                is Int -> map.putInt(key, value)
                is Double -> map.putDouble(key, value)
                is Boolean -> map.putBoolean(key, value)
                is JSONObject -> map.putMap(key, convertJsonToMap(value))
                is JSONArray -> map.putArray(key, convertJsonToArray(value))
            }
        }
        return map
    }

    private fun convertJsonToArray(json: JSONArray): ReadableArray {
        val array = Arguments.createArray()
        for (i in 0 until json.length()) {
            val value = json.get(i)
            when (value) {
                is String -> array.pushString(value)
                is Int -> array.pushInt(value)
                is Double -> array.pushDouble(value)
                is Boolean -> array.pushBoolean(value)
                is JSONObject -> array.pushMap(convertJsonToMap(value))
                is JSONArray -> array.pushArray(convertJsonToArray(value))
            }
        }
        return array
    }
}
