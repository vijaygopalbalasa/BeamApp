const ed = require("@noble/ed25519");
const crypto = require("crypto");

async function main() {
  // Generate a test keypair
  const privateKey = crypto.randomBytes(32);
  const publicKey = await ed.getPublicKeyAsync(privateKey);

  console.log("Test Keypair Generated:");
  console.log("======================");
  console.log("\nPrivate Key (hex):");
  console.log(Buffer.from(privateKey).toString('hex'));
  console.log("\nPrivate Key (bytes array for TypeScript):");
  console.log(`Uint8Array.from([${Array.from(privateKey).join(', ')}])`);
  console.log("\nPublic Key (hex):");
  console.log(Buffer.from(publicKey).toString('hex'));
  console.log("\nPublic Key (bytes array for Rust attestation.rs):");
  console.log(`[\n  ${Array.from(publicKey).join(', ')}\n]`);
}

main().catch(console.error);
