import QRCode from 'qrcode';
import { BeamQRData } from './types';

export async function generateBeamQR(data: BeamQRData): Promise<string> {
  const url = encodeBeamURL(data);
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: 'M',
    type: 'image/png',
    width: 512,
    margin: 2,
  });
}

export function encodeBeamURL(data: BeamQRData): string {
  const params = new URLSearchParams();

  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  });

  return `beam://${data.type}?${params.toString()}`;
}

export function parseBeamQR(qrContent: string): BeamQRData {
  const url = new URL(qrContent);

  if (url.protocol !== 'beam:') {
    throw new Error('Invalid Beam QR code');
  }

  const type = url.hostname;
  const params = Object.fromEntries(url.searchParams);

  return {
    type,
    ...params,
  } as BeamQRData;
}
