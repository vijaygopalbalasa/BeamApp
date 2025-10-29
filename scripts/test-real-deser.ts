const base64Data = "KPAShX2/iY7rFTDTLvmm9C3xypT6+m0gue+B6+IFnOG+JLmOlx7ucdKYL1ekNfgF7xX9mauKeTlZrVE3+oZsFgotkDytCCcugJaYAAAAAAAAAAAAAAAAAGQAAAAAAAAAAADV6P5oAAAAAP8=";

const buffer = Buffer.from(base64Data, 'base64');

console.log('Testing deserialization with REAL on-chain data');
console.log('Total buffer length:', buffer.length);

let offset = 8; // Skip discriminator

// Parse each field exactly as BeamProgram.ts does
const owner = buffer.slice(offset, offset + 32);
offset += 32;

const escrowTokenAccount = buffer.slice(offset, offset + 32);
offset += 32;

const escrowBalance = Number(buffer.readBigUInt64LE(offset));
offset += 8;

const lastNonce = Number(buffer.readBigUInt64LE(offset));
offset += 8;

const reputationScore = buffer.readUInt16LE(offset);
offset += 2;

const totalSpent = Number(buffer.readBigUInt64LE(offset));
offset += 8;

const createdAt = Number(buffer.readBigInt64LE(offset));
offset += 8;

const bump = buffer.readUInt8(offset);

console.log('\n=== PARSED DATA ===');
console.log('Escrow Balance:', escrowBalance, '(raw)');
console.log('Escrow Balance in USDC:', escrowBalance / 1_000_000);
console.log('Last Nonce:', lastNonce);
console.log('Reputation Score:', reputationScore);
console.log('Total Spent:', totalSpent);
console.log('Created At:', createdAt);
console.log('Bump:', bump);
