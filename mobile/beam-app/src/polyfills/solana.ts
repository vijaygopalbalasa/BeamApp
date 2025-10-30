import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';

import { Buffer } from '@craftzdog/react-native-buffer';
import process from 'process/browser';
import { encode as btoa } from 'base-64';
import { decode as atob } from 'base-64';
import { TextDecoder, TextEncoder } from 'text-encoding';
import { Crypto } from '@peculiar/webcrypto';

declare global {

  var Buffer: typeof Buffer | undefined;

  var process: typeof process | undefined;

  var structuredClone: (<T>(value: T) => T) | undefined;

  var TextEncoder: typeof TextEncoder | undefined;

  var TextDecoder: typeof TextDecoder | undefined;

  var crypto: Crypto | undefined;

  var atob: undefined | ((data: string) => string);

  var btoa: undefined | ((data: string) => string);

  var setImmediate: ((handler: (...args: any[]) => void, ...args: any[]) => number) | undefined;
}

if (!global.Buffer) {
  global.Buffer = Buffer;
}

if (!global.process) {
  global.process = process;
}

if (typeof global.setImmediate === 'undefined') {
  global.setImmediate = (fn: (...args: any[]) => void, ...args: any[]) =>
    setTimeout(fn, 0, ...args);
}

if (typeof global.structuredClone === 'undefined') {
  global.structuredClone = function structuredClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
  };
}

if (typeof global.atob === 'undefined') {
  global.atob = (data: string) => atob(data);
}

if (typeof global.btoa === 'undefined') {
  global.btoa = (data: string) => btoa(data);
}

if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = TextEncoder;
}

if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = TextDecoder;
}

if (!global.crypto) {
  global.crypto = new Crypto();
}

// Critical fix for buffer-layout span issue in Hermes
// This patches the Layout prototype to ensure span is always available
try {
  const BufferLayout = require('buffer-layout');

  // Patch the Layout prototype to ensure span is always available
  const originalLayout = BufferLayout.Layout.prototype;

  // Create a safe getter for span that doesn't crash
  Object.defineProperty(originalLayout, 'span', {
    get() {
      if (this._span !== undefined) return this._span;
      // Return a default span if not defined
      return 0;
    },
    set(value) {
      this._span = value;
    },
    configurable: true,
    enumerable: true,
  });

  // Patch specific layout types that might be used
  const layoutTypes = ['u8', 'u16', 'u32', 'u64', 's8', 's16', 's32', 's64', 'f32', 'f64', 'blob', 'cstring'];

  layoutTypes.forEach(type => {
    if (BufferLayout[type]) {
      const original = BufferLayout[type];
      BufferLayout[type] = function(...args: any[]) {
        const instance = original.apply(this, args);
        // Ensure span is set
        if (instance.span === undefined && type !== 'blob' && type !== 'cstring') {
          const spans: Record<string, number> = {
            u8: 1, u16: 2, u32: 4, u64: 8,
            s8: 1, s16: 2, s32: 4, s64: 8,
            f32: 4, f64: 8,
          };
          instance.span = spans[type] || 0;
        }
        return instance;
      };
    }
  });

  console.log('[polyfills] ✅ Buffer-layout span patch applied successfully');
} catch (err) {
  console.warn('[polyfills] Buffer-layout patch failed (may be expected):', err);
}
