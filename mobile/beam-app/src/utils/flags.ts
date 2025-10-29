import AsyncStorage from '@react-native-async-storage/async-storage';
import { Config } from '../config';

let override: boolean | null = null;

export function setUseServerSettlementOverride(value: boolean) {
  override = value;
  void AsyncStorage.setItem('@beam:use_server_settlement', value ? 'true' : 'false').catch(() => {});
}

export function getUseServerSettlement(): boolean {
  return override ?? Config.features.useServerSettlement ?? false;
}

export async function loadUseServerSettlementOverride(): Promise<boolean> {
  try {
    const stored = await AsyncStorage.getItem('@beam:use_server_settlement');
    if (stored === 'true') {
      override = true;
      return true;
    }
    if (stored === 'false') {
      override = false;
      return false;
    }
  } catch {}
  override = null;
  return getUseServerSettlement();
}

