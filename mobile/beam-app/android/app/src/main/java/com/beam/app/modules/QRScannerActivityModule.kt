package com.beam.app.modules

import android.app.Activity
import android.content.Intent
import com.beam.app.scanner.QRScannerActivity
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

class QRScannerActivityModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    private var pendingPromise: Promise? = null
    private val REQUEST_CODE = 0xBEA1

    init {
        reactContext.addActivityEventListener(this)
    }

    override fun getName(): String = "QRScannerActivityModule"

    @ReactMethod
    fun openScanner(promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "Activity not available")
            return
        }
        if (pendingPromise != null) {
            promise.reject("IN_PROGRESS", "Scanner already in progress")
            return
        }
        pendingPromise = promise
        val intent = Intent(activity, QRScannerActivity::class.java)
        activity.startActivityForResult(intent, REQUEST_CODE)
    }

    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQUEST_CODE) return
        val promise = pendingPromise
        pendingPromise = null
        if (promise == null) return

        if (resultCode == Activity.RESULT_OK) {
            val value = data?.getStringExtra("qr")
            if (value != null) {
                promise.resolve(value)
            } else {
                promise.reject("NO_DATA", "No QR data returned")
            }
        } else {
            promise.reject("CANCELED", "User canceled")
        }
    }

    override fun onNewIntent(intent: Intent?) { /* no-op */ }
}

