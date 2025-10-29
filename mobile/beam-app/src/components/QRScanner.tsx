import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { openQRScannerActivity } from '../native/QRScannerActivity';

interface QRScannerProps {
  onScan: (data: string) => void;
  onClose: () => void;
}

export const QRScanner: React.FC<QRScannerProps> = ({ onScan, onClose }) => {
  const [launching, setLaunching] = useState(true);

  useEffect(() => {
    let isActive = true;
    (async () => {
      try {
        const data: string = await openQRScannerActivity();
        if (!isActive) return;
        try {
          const parsed = JSON.parse(data);
          console.log('[QRScanner] ✅ Valid JSON, type:', parsed?.type);
          onScan(data);
        } catch (err) {
          console.error('[QRScanner] ❌ Invalid JSON:', err);
          Alert.alert('Invalid QR Code', 'This QR code is not a valid Beam payment request.');
        }
      } catch (e) {
        // User canceled or error
      } finally {
        if (isActive) {
          setLaunching(false);
          onClose();
        }
      }
    })();
    return () => {
      isActive = false;
    };
  }, [onScan, onClose]);

  return (
    <View style={styles.container}>
      <View style={styles.overlay}>
        <View style={styles.frame} />
        <Text style={styles.instruction}>{launching ? 'Opening camera…' : 'Closing…'}</Text>
      </View>

      <TouchableOpacity style={styles.closeButton} onPress={onClose}>
        <Text style={styles.closeText}>✕ Close</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    pointerEvents: 'box-none',
  },
  frame: {
    width: 300,
    height: 300,
    borderWidth: 2,
    borderColor: '#fff',
    borderRadius: 12,
  },
  instruction: {
    color: '#fff',
    fontSize: 16,
    marginTop: 24,
    textAlign: 'center',
  },
  closeButton: {
    position: 'absolute',
    bottom: 48,
    alignSelf: 'center',
    backgroundColor: '#ef4444',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 24,
  },
  closeText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
});
