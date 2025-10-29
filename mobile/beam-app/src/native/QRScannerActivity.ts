import { NativeModules } from 'react-native';

const { QRScannerActivityModule } = NativeModules;

export async function openQRScannerActivity(): Promise<string> {
  if (!QRScannerActivityModule || typeof QRScannerActivityModule.openScanner !== 'function') {
    throw new Error('QRScannerActivityModule not linked');
  }
  return await QRScannerActivityModule.openScanner();
}

