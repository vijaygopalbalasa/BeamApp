# 🔒 BEAM Security Audit: Escrow Balance Caching

**Date**: 2025-11-02
**Auditor**: Claude Code (Automated Security Review)
**Scope**: Escrow balance caching and offline payment validation
**Severity**: CRITICAL

---

## Executive Summary

Found **6 CRITICAL** and **2 HIGH** security vulnerabilities in the escrow balance caching system. The most critical issue causes balance to show $0 when offline, completely breaking offline payments. Additional vulnerabilities allow cache tampering, replay attacks, and wallet confusion.

**Risk Level**: 🔴 CRITICAL - Production Blocking
**User Impact**: 100% of offline users affected
**Exploit Difficulty**: Trivial (device access only)

---

## Vulnerabilities

### 🔴 CRITICAL-1: Cache Overwrite on Network Failure
**Location**: `mobile/beam-app/src/screens/CustomerScreen.tsx:304-315`
**CVE-Equivalent**: Cache poisoning / Data integrity failure

**Issue**:
```typescript
const escrowAccount = await readOnlyClient.getEscrowAccount(pubkey);
if (escrowAccount) {
  await cacheEscrowState(escrowAccount.escrowBalance, true);
} else {
  // ❌ BUG: `else` means BOTH "doesn't exist" AND "network error"
  setEscrowBalance(0);
  await cacheEscrowState(0, false);  // OVERWRITES CACHE!
}
```

**Root Cause**: `BeamProgram.getEscrowAccount()` returns `null` for:
1. Account genuinely doesn't exist
2. RPC network timeout/error

**Attack Scenario**:
1. User funds escrow with $100 USDC (online)
2. User goes offline (airplane mode)
3. `getAccountInfo()` throws network error
4. Code returns `null` → cache overwritten with $0
5. User sees $0 balance, cannot make payments

**Evidence from Logs**:
```
02:03:12 - Offline: "Escrow account does not exist yet" → setEscrowBalance(0)
02:09:34 - Online:  "✅ Escrow balance fetched: 10000000" → Real balance returns
```

**Fix**:
```typescript
// Option A: Check online state before caching 0
if (escrowAccount) {
  await cacheEscrowState(escrowAccount.escrowBalance, true);
} else if (online) {
  // Only cache 0 when ONLINE (confirmed account doesn't exist)
  await cacheEscrowState(0, false);
} else {
  // OFFLINE: Use cached value, don't overwrite
  if (escrowCacheRef.current) {
    setEscrowBalance(escrowCacheRef.current.balance);
  }
}

// Option B: Make getEscrowAccount() throw on network error
// (Preferred - clearer separation of concerns)
```

---

### 🔴 CRITICAL-2: AsyncStorage is Unencrypted
**Location**: All AsyncStorage usage
**CVE-Equivalent**: CWE-312 (Cleartext Storage of Sensitive Information)

**Issue**: Balance cache stored in plaintext XML:
```xml
<!-- /data/data/com.beam.app/shared_prefs/RCTAsyncLocalStorage.xml -->
<string name="@beam_escrow_cache">
  {"balance":10000000,"exists":true,"updatedAt":1762029711235}
</string>
```

**Attack Vector**:
```bash
# With adb (no root needed on debug builds):
adb shell run-as com.beam.app
cat shared_prefs/RCTAsyncLocalStorage.xml

# Or direct file access:
adb pull /data/data/com.beam.app/shared_prefs/RCTAsyncLocalStorage.xml
```

**Impact**:
- Read cached balance (privacy leak)
- Modify balance to fake value (integrity failure)
- User creates invalid offline payments → settlement fails

**Fix**: Use `SecureStorageBridge` (Android Keystore) instead of AsyncStorage:
```typescript
import { NativeModules } from 'react-native';
const { SecureStorageBridge } = NativeModules;

// Encrypt cache with hardware-backed key
await SecureStorageBridge.encryptData(JSON.stringify(cacheData));
```

---

### 🔴 CRITICAL-3: No Integrity Verification (HMAC)
**Location**: `CustomerScreen.tsx:130-142`, `145-167`
**CVE-Equivalent**: CWE-353 (Missing Support for Integrity Check)

**Issue**: No signature/HMAC to prove cache authenticity

**Attack Scenario**:
```bash
# Attacker modifies cache to show $1,000,000:
adb shell run-as com.beam.app
echo '{"balance":1000000000000,"exists":true,"updatedAt":9999999999999}' > \
  shared_prefs/RCTAsyncLocalStorage_@beam_escrow_cache
```

**Impact**:
- User sees fake $1M balance offline
- Creates payments thinking they're valid
- All payments fail settlement → merchant never paid

**Fix**: Add HMAC-SHA256 using wallet's signing key:
```typescript
import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';

const message = `${balance}|${exists}|${updatedAt}|${walletAddress}`;
const key = await wallet.getSigningKey();  // From Android Keystore
const signature = hmac(sha256, key, message);

const cache = { balance, exists, updatedAt, signature };
```

---

### 🔴 CRITICAL-4: Wallet Address Not Bound to Cache
**Location**: `CustomerScreen.tsx:130-142`
**CVE-Equivalent**: CWE-639 (Authorization Bypass Through User-Controlled Key)

**Issue**: Cache key is global, not tied to wallet:
```typescript
const ESCROW_CACHE_KEY = '@beam_escrow_cache';  // ❌ Same for all wallets!
```

**Attack Scenario**:
1. User A has wallet with $100 USDC escrow
2. User switches to wallet B (empty, $0 escrow)
3. Cache still shows $100 from wallet A
4. User B creates payment thinking they have funds
5. Payment fails, funds never sent

**Evidence from Logs**:
```
Wallet A: A1QwNTwNZGiDNiCvcPWjCPk8wtcCNYoBCYvkA73ohmhF
Wallet B: 72bWZnZBJkePHysxQ8oqYukvpRG33GwJbZi8WCpwesb6
Cache key: Same for both! (@beam_escrow_cache)
```

**Fix**:
```typescript
const ESCROW_CACHE_KEY = (address: string) => `@beam_escrow_cache_${address}`;

// Usage:
await AsyncStorage.setItem(
  ESCROW_CACHE_KEY(walletAddress),
  JSON.stringify(cacheData)
);
```

---

### 🔴 CRITICAL-5: No Cache Expiration (Stale Data)
**Location**: `CustomerScreen.tsx:159`
**CVE-Equivalent**: CWE-613 (Insufficient Session Expiration)

**Issue**: `updatedAt` is stored but never validated:
```typescript
const snapshot = {
  balance,
  exists,
  updatedAt: Date.now(),  // Stored...
};
// ...but never checked!
```

**Attack Scenario**:
1. User has $100 cached (1 week ago)
2. Escrow was actually drained 6 days ago (on-chain)
3. User goes offline, sees stale $100 cache
4. Creates payment, sends to merchant
5. Settlement fails (insufficient funds)

**Fix**:
```typescript
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

if (cached && Date.now() - cached.updatedAt < CACHE_TTL) {
  // Cache is fresh
  escrowCacheRef.current = cached;
} else {
  // Cache expired, require online sync
  if (!online) {
    Alert.alert('Stale Cache', 'Please go online to refresh balance');
  }
}
```

---

### 🔴 CRITICAL-6: Race Condition on Rapid Refresh
**Location**: `CustomerScreen.tsx:172` (loadData callback)
**CVE-Equivalent**: CWE-362 (Concurrent Execution using Shared Resource)

**Issue**: Multiple `loadData()` calls can run in parallel:
```typescript
const loadData = useCallback(async () => {
  setRefreshing(true);
  // ... fetch balance
  await cacheEscrowState(balance, true);  // Last call wins!
  setRefreshing(false);
}, []);
```

**Attack Scenario**:
1. User pulls to refresh (loadData call 1)
2. User quickly pulls again (loadData call 2)
3. Call 2 completes first with stale RPC data
4. Call 1 completes second with fresh data
5. Call 2 overwrites cache with stale value

**Fix**: Add debouncing/mutex:
```typescript
const loadingRef = useRef(false);

const loadData = useCallback(async () => {
  if (loadingRef.current) {
    console.log('[CustomerScreen] Already loading, skipping...');
    return;
  }
  loadingRef.current = true;
  try {
    // ... fetch balance
  } finally {
    loadingRef.current = false;
  }
}, []);
```

---

### 🟠 HIGH-1: Missing Cache Recovery on Corruption
**Location**: `CustomerScreen.tsx:164-166`
**Severity**: HIGH (App crash on invalid JSON)

**Issue**:
```typescript
const parsed = JSON.parse(cached);  // ❌ No try-catch!
```

**Fix**:
```typescript
try {
  const parsed = JSON.parse(cached);
} catch (err) {
  console.error('[CustomerScreen] Corrupt cache, clearing...');
  await AsyncStorage.removeItem(ESCROW_CACHE_KEY);
  return null;
}
```

---

### 🟠 HIGH-2: No Rate Limiting on RPC Calls
**Location**: `CustomerScreen.tsx:298-310`
**Severity**: HIGH (RPC quota exhaustion)

**Issue**: Rapid refresh can spam RPC endpoints:
```
02:08:43 - RPC call
02:08:45 - RPC call
02:08:47 - RPC call
... (17 calls in 90 seconds while offline)
```

**Fix**: Add exponential backoff when offline