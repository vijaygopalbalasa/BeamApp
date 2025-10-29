package com.beam.app.bridge

import android.os.Build
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.security.MessageDigest

/**
 * PlayIntegrityBridge - Google Play Integrity API Integration
 *
 * Provides hardware attestation for secure offline payments.
 * In production, this would integrate with Google Play Integrity API.
 * For development/testing, this generates mock tokens.
 */
class PlayIntegrityBridge(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "PlayIntegrityBridge"
        private const val DEV_MODE = true // Set to false in production
    }

    private val coroutineScope = CoroutineScope(Dispatchers.Default)

    override fun getName(): String = "PlayIntegrityBridge"

    /**
     * Request Play Integrity attestation token
     */
    @ReactMethod
    fun requestIntegrityToken(nonce: String, promise: Promise) {
        if (DEV_MODE) {
            // Development mode: Generate mock token
            coroutineScope.launch {
                try {
                    val mockToken = generateMockIntegrityToken(nonce)
                    promise.resolve(mockToken)
                } catch (e: Exception) {
                    promise.reject("INTEGRITY_MOCK_ERROR", "Failed to generate mock token", e)
                }
            }
            return
        }

        // Production mode: Use Play Integrity API
        // This requires Google Play Services and proper configuration
        // See: https://developer.android.com/google/play/integrity
        promise.reject("NOT_IMPLEMENTED", "Play Integrity API integration pending")
    }

    /**
     * Get device information for attestation
     */
    @ReactMethod
    fun getDeviceInfo(promise: Promise) {
        try {
            val deviceInfo = Arguments.createMap().apply {
                putString("model", Build.MODEL)
                putString("osVersion", "Android ${Build.VERSION.RELEASE}")
                putString("securityLevel", getSecurityLevel())
                putString("manufacturer", Build.MANUFACTURER)
                putString("device", Build.DEVICE)
                putString("fingerprint", Build.FINGERPRINT)
                putInt("sdkVersion", Build.VERSION.SDK_INT)
            }

            promise.resolve(deviceInfo)
        } catch (e: Exception) {
            promise.reject("DEVICE_INFO_ERROR", "Failed to get device info", e)
        }
    }

    /**
     * Check if device supports hardware-backed keystore
     */
    @ReactMethod
    fun checkSecurityLevel(promise: Promise) {
        try {
            val securityLevel = getSecurityLevel()
            val isSecure = securityLevel == "STRONGBOX" || securityLevel == "TEE"

            val result = Arguments.createMap().apply {
                putString("securityLevel", securityLevel)
                putBoolean("isSecure", isSecure)
                putBoolean("supportsStrongBox", Build.VERSION.SDK_INT >= Build.VERSION_CODES.P)
                putBoolean("supportsTEE", true) // Most modern devices support TEE
            }

            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("SECURITY_CHECK_ERROR", "Failed to check security level", e)
        }
    }

    /**
     * Get unique device ID (SHA-256 of device fingerprint)
     */
    @ReactMethod
    fun getDeviceId(promise: Promise) {
        try {
            val fingerprint = Build.FINGERPRINT
            val hash = MessageDigest.getInstance("SHA-256")
            val hashBytes = hash.digest(fingerprint.toByteArray())
            val deviceId = hashBytes.joinToString("") { "%02x".format(it) }

            promise.resolve(deviceId)
        } catch (e: Exception) {
            promise.reject("DEVICE_ID_ERROR", "Failed to get device ID", e)
        }
    }

    /**
     * Determine device security level
     */
    private fun getSecurityLevel(): String {
        // Check for StrongBox support (Android 9+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            // In production, you would check if StrongBox is actually available
            // via KeyInfo.isInsideSecureHardware() and SecurityLevel
            return "STRONGBOX"
        }

        // Check for TEE support (most modern devices)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return "TEE"
        }

        // Fallback to software-backed
        return "SOFTWARE"
    }

    /**
     * Generate mock integrity token for development
     * In production, this would be replaced with actual Play Integrity API calls
     */
    private fun generateMockIntegrityToken(nonce: String): String {
        val deviceFingerprint = Build.FINGERPRINT
        val timestamp = System.currentTimeMillis()

        // Create a mock JWT-like token structure
        val header = """{"alg":"RS256","typ":"JWT"}"""
        val payload = """{
            "nonce":"$nonce",
            "timestamp":$timestamp,
            "deviceIntegrity":{
                "deviceRecognitionVerdict":["MEETS_DEVICE_INTEGRITY"]
            },
            "accountDetails":{
                "appLicensingVerdict":"LICENSED"
            },
            "appIntegrity":{
                "appRecognitionVerdict":"PLAY_RECOGNIZED",
                "packageName":"com.beam.app",
                "certificateSha256Digest":["mock_sha256_hash"]
            },
            "deviceInfo":{
                "model":"${Build.MODEL}",
                "manufacturer":"${Build.MANUFACTURER}",
                "fingerprint":"$deviceFingerprint",
                "osVersion":"Android ${Build.VERSION.RELEASE}",
                "sdkVersion":${Build.VERSION.SDK_INT}
            }
        }""".trimIndent()

        // Base64 encode (mock signature)
        val headerB64 = android.util.Base64.encodeToString(
            header.toByteArray(),
            android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP
        )
        val payloadB64 = android.util.Base64.encodeToString(
            payload.toByteArray(),
            android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP
        )
        val signatureB64 = android.util.Base64.encodeToString(
            "mock_signature".toByteArray(),
            android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP
        )

        return "$headerB64.$payloadB64.$signatureB64"
    }

    /**
     * Get constants for JavaScript
     */
    override fun getConstants(): Map<String, Any> {
        return mapOf(
            "DEV_MODE" to DEV_MODE,
            "SUPPORTS_STRONGBOX" to (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P),
            "SUPPORTS_TEE" to (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M),
            "SDK_VERSION" to Build.VERSION.SDK_INT,
        )
    }
}
