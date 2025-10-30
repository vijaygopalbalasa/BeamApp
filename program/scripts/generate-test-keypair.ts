import * as ed from "@noble/ed25519";
import * as crypto from "crypto";

async function main() {
  // Generate a test keypair
  const privateKey = crypto.randomBytes(32);
  const publicKey = await ed.getPublicKeyAsync(privateKey);

  console.log("Test Keypair Generated:");
  console.log("======================");
  console.log("\nPrivate Key (hex):");
  console.log(Buffer.from(privateKey).toString("hex"));
  console.log("\nPrivate Key (bytes array for TypeScript):");
  console.log(`[${Array.from(privateKey).join(", ")}]`);
  console.log("\nPublic Key (hex):");
  console.log(Buffer.from(publicKey).toString("hex"));
  console.log("\nPublic Key (bytes array for Rust):");
  console.log(`[${Array.from(publicKey).join(", ")}]`);
}

main().catch(console.error);
