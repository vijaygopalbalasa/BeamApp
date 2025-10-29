import { NativeModules } from 'react-native';

interface QRCodeGeneratorInterface {
  generate(content: string, size: number): Promise<string>;
}

const { QRCodeGenerator } = NativeModules;

if (!QRCodeGenerator) {
  throw new Error('QRCodeGenerator native module is not available');
}

export default QRCodeGenerator as QRCodeGeneratorInterface;
