export interface OfflineBundle {
  tx_id: string;
  escrow_pda: string;
  token: {
    symbol: string;
    mint: string;
    decimals: number;
    amount: number;
  };
  payer_pubkey: string;
  merchant_pubkey: string;
  nonce: number;
  timestamp: number;
  version: number;
  payer_signature?: Uint8Array;
  merchant_signature?: Uint8Array;
}

export interface BeamQRPaymentRequest {
  type: 'pay';
  merchant: string;
  escrow?: string;
  amount?: number;
  currency?: string;
  display_amount?: string;
  reference?: string;
  ble_service?: string;
  timestamp: number;
  signature?: string;
}

export interface BeamQRReceipt {
  type: 'receipt';
  bundle: string; // base64 CBOR
  payer_sig: string;
  merchant_sig: string;
  tx_id: string;
}

export interface BeamQREscrowProof {
  type: 'escrow-proof';
  payer: string;
  escrow: string;
  balance: number;
  last_nonce: number;
  timestamp: number;
  signature: string;
}

export type BeamQRData =
  | BeamQRPaymentRequest
  | BeamQRReceipt
  | BeamQREscrowProof;
