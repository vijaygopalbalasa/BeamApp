# Manual Instruction Building - React Native / Hermes Compatibility

## Problem

When using Anchor's method builder (`.instruction()`) in React Native with Hermes engine, the following error occurs:

```
Cannot read property 'size' of undefined
```

**Root Cause:**
- Anchor's `.instruction()` method uses `BufferLayout` internally for serialization
- `BufferLayout` relies on Node.js-specific `Buffer` behavior
- Hermes engine lacks full Buffer polyfill support
- Even calling `.instruction()` triggers BufferLayout serialization for account metadata and instruction data

## Solution

Completely bypass Anchor's method builder by **manually constructing TransactionInstructions** using:

1. Raw discriminators from the IDL
2. Manual data serialization with `Buffer.alloc()` and encoding methods
3. Explicit accounts array construction
4. Custom transaction compiler that builds wire format without BufferLayout

## Implementation

### File: `/Users/vijaygopalb/Beam/mobile/beam-app/src/solana/BeamProgram.ts`

### Manual Instruction Builders (Private Methods)

#### 1. `buildInitializeNonceRegistryInstruction()` (Lines 151-180)
- **Discriminator**: `[34, 149, 53, 133, 236, 53, 88, 85]`
- **Args**: None
- **Accounts**: payer (signer, writable), nonce_registry (PDA, writable), system_program

#### 2. `buildInitializeEscrowInstruction()` (Lines 459-498)
- **Discriminator**: `[243, 160, 77, 153, 11, 92, 48, 209]`
- **Args**: `initial_amount` (u64, 8 bytes little-endian)
- **Accounts**: escrow_account (PDA, writable), owner (signer, writable), owner_token_account, escrow_token_account, token_program, system_program

#### 3. `buildSettleOfflinePaymentInstruction()` (Lines 599-698)
- **Discriminator**: `[48, 91, 112, 242, 39, 5, 142, 80]`
- **Args**:
  - `amount` (u64, 8 bytes little-endian)
  - `payer_nonce` (u64, 8 bytes little-endian)
  - `bundle_id` (string: 4-byte length prefix + UTF-8)
  - `evidence` (SettlementEvidence struct with Option<AttestationProof> fields)
- **Accounts**: escrow_account, owner, payer (signer), merchant, escrow_token_account, merchant_token_account, nonce_registry, token_program

#### 4. `buildFundEscrowInstruction()` (Lines 805-842)
- **Discriminator**: `[155, 18, 218, 141, 182, 213, 69, 201]`
- **Args**: `amount` (u64, 8 bytes little-endian)
- **Accounts**: escrow_account (writable), owner (signer, writable), owner_token_account, escrow_token_account, token_program

#### 5. `buildWithdrawEscrowInstruction()` (Lines 880-917)
- **Discriminator**: `[81, 84, 226, 128, 245, 47, 96, 104]`
- **Args**: `amount` (u64, 8 bytes little-endian)
- **Accounts**: escrow_account (writable), owner (signer, writable), owner_token_account, escrow_token_account, token_program

#### 6. `buildReportFraudulentBundleInstruction()` (Lines 1066-1126)
- **Discriminator**: `[42, 97, 16, 195, 32, 174, 213, 89]`
- **Args**:
  - `bundle_id` (string: 4-byte length prefix + UTF-8)
  - `conflicting_hash` ([u8; 32], 32 bytes)
  - `reason` (FraudReason enum: 1-byte discriminator)
- **Accounts**: nonce_registry (writable), payer (readonly), reporter (signer)

### Custom Transaction Compiler (Lines 215-362)

The `compileMessage()` method manually constructs the Solana transaction message format:

```typescript
private compileMessage(
  payer: PublicKey,
  instructions: TransactionInstruction[],
  recentBlockhash: string,
)
```

**Output:**
- `message`: Uint8Array containing wire-format transaction message
- `signerPubkeys`: Array of required signer public keys
- `accountKeys`: Ordered array of all account public keys

**Format:**
1. Header (3 bytes): numRequiredSignatures, numReadonlySigned, numReadonlyUnsigned
2. Account keys (short-vec length + 32 bytes per key)
3. Recent blockhash (32 bytes, base58 decoded)
4. Instructions (short-vec length + instruction data):
   - Program ID index (1 byte)
   - Account indices (short-vec length + indices)
   - Instruction data (short-vec length + data bytes)

### Signing and Broadcasting (Lines 335-372)

The `signAndBroadcast()` method:

1. Compiles transaction message with `compileMessage()`
2. Signs message with hardware-backed key via `BeamSigner`
3. Manually assembles wire format: `[num_signatures][signature_bytes][message_bytes]`
4. Sends raw transaction with `connection.sendRawTransaction()`
5. Confirms transaction with blockhash validation

## Data Serialization Details

### Primitive Types

**u64 (8 bytes, little-endian):**
```typescript
const buffer = Buffer.alloc(8);
buffer.writeBigUInt64LE(BigInt(value), 0);
```

**i64 (8 bytes, little-endian, signed):**
```typescript
const buffer = Buffer.alloc(8);
buffer.writeBigInt64LE(BigInt(value), 0);
```

### Complex Types

**String (4-byte length prefix + UTF-8):**
```typescript
const stringBytes = Buffer.from(value, 'utf-8');
const lengthBuffer = Buffer.alloc(4);
lengthBuffer.writeUInt32LE(stringBytes.length, 0);
const data = Buffer.concat([lengthBuffer, stringBytes]);
```

**[u8; 32] (Fixed-size array):**
```typescript
const buffer = Buffer.from(uint8Array); // 32 bytes
```

**Enum (1-byte discriminator):**
```typescript
// FraudReason: DuplicateBundle = 0, InvalidAttestation = 1, Other = 2
const reasonBuffer = Buffer.from([discriminator]);
```

**Option<T> (1-byte flag + optional data):**
```typescript
if (value !== null) {
  const data = Buffer.concat([
    Buffer.from([1]), // Some(T) = 1
    // ... encoded T data
  ]);
} else {
  const data = Buffer.from([0]); // None = 0
}
```

### Struct Serialization Example: SettlementEvidence

```typescript
// SettlementEvidence {
//   payer_proof: Option<AttestationProof>,
//   merchant_proof: Option<AttestationProof>,
// }

const evidenceBuffers: Buffer[] = [];

// payer_proof
if (evidence.payerProof) {
  evidenceBuffers.push(Buffer.from([1])); // Some
  evidenceBuffers.push(Buffer.from(evidence.payerProof.attestationRoot)); // [u8; 32]
  evidenceBuffers.push(Buffer.from(evidence.payerProof.attestationNonce)); // [u8; 32]

  const timestampBuffer = Buffer.alloc(8);
  timestampBuffer.writeBigInt64LE(BigInt(evidence.payerProof.attestationTimestamp), 0);
  evidenceBuffers.push(timestampBuffer); // i64

  evidenceBuffers.push(Buffer.from(evidence.payerProof.verifierSignature)); // [u8; 64]
} else {
  evidenceBuffers.push(Buffer.from([0])); // None
}

// merchant_proof (same structure)
// ...

const evidenceData = Buffer.concat(evidenceBuffers);
```

## Instruction Format

Each Anchor instruction follows this format:

```
[8-byte discriminator][argument data]
```

**Discriminator Calculation:**
```rust
// In Rust (Anchor program):
anchor_lang::prelude::hash::hash(b"global:instruction_name").to_bytes()[..8]
```

**Where to find discriminators:**
- Look in the IDL JSON file: `mobile/beam-app/src/idl/beam.json`
- Each instruction has a `discriminator` array field
- Example: `"discriminator": [243, 160, 77, 153, 11, 92, 48, 209]`

## Accounts Array Construction

Accounts must be ordered **exactly** as defined in the IDL:

```typescript
const keys = [
  { pubkey: escrowAccount, isSigner: false, isWritable: true },
  { pubkey: owner, isSigner: true, isWritable: true },
  { pubkey: ownerTokenAccount, isSigner: false, isWritable: true },
  // ... more accounts in IDL order
];
```

**Flags:**
- `isSigner: true` - Account must sign the transaction
- `isWritable: true` - Account data will be modified
- Both false - Read-only account

## Testing

### Verify Instruction Serialization

Compare with Anchor's output (in Node.js environment):

```typescript
// Node.js test
const anchorIx = await program.methods
  .initializeEscrow(new BN(10_000_000))
  .accounts({ /* ... */ })
  .instruction();

const manualIx = buildInitializeEscrowInstruction(/* ... */);

console.log('Anchor data:', anchorIx.data.toString('hex'));
console.log('Manual data:', manualIx.data.toString('hex'));
// Should match exactly!
```

### Integration Testing

```bash
# Run app on Android device
pnpm android

# Test escrow creation
# Navigate to Setup screen -> Create Escrow
# Monitor logs:
adb logcat -s "ReactNativeJS:I"

# Expected log:
# [BeamProgram] Building initializeEscrow instruction manually...
# [BeamProgram] Submitting escrow transaction...
# [BeamProgram] ✅ Escrow created successfully! <signature>
```

## Benefits

1. **No BufferLayout dependency** - Completely bypassed
2. **React Native compatible** - Works in Hermes engine
3. **Transparent** - Clear serialization logic, easy to debug
4. **Portable** - Same approach works for any Anchor program
5. **Maintainable** - Each instruction builder is self-contained

## Limitations

1. **Manual maintenance** - Discriminators must match IDL
2. **No type safety** - Rust types not enforced by TypeScript
3. **Verbose** - More code than Anchor method builder
4. **IDL sync required** - Program changes require builder updates

## Migration Checklist

To add a new instruction:

1. ✅ Find discriminator in IDL JSON
2. ✅ Identify argument types and order
3. ✅ Identify account order and flags
4. ✅ Create `build[InstructionName]Instruction()` method
5. ✅ Serialize arguments with correct encoding
6. ✅ Build accounts array with correct flags
7. ✅ Return `TransactionInstruction` object
8. ✅ Call builder in public method (not `.instruction()`)
9. ✅ Test on React Native device

## References

- **Solana Transaction Format**: https://docs.solana.com/developing/programming-model/transactions
- **Anchor Discriminators**: https://www.anchor-lang.com/docs/the-accounts-struct#discriminator
- **Buffer Encoding**: https://nodejs.org/api/buffer.html
- **IDL Specification**: https://www.anchor-lang.com/docs/idl

## Support

For questions or issues:
1. Check discriminators match IDL
2. Verify account order matches IDL
3. Test serialization against Anchor in Node.js
4. Compare hex output byte-by-byte
5. Check Solana transaction logs for program errors

---

**Last Updated**: 2025-01-27
**Author**: BEAM Core Team
**Status**: Production-ready for React Native / Hermes
