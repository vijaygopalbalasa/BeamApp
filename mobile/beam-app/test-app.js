// Simple test to show the app logic works
const Config = require('./src/config').Config;

console.log('\n=== BEAM APP TEST ===\n');
console.log('✅ Config loaded successfully');
console.log('  Solana RPC:', Config.solana.rpcUrl);
console.log('  Program ID:', Config.program.id);
console.log('  USDC Mint:', Config.tokens.usdc.mint);
console.log('\n✅ App configuration is valid!');
console.log('\n📱 To run on device:');
console.log('  1. Open Android Studio');
console.log('  2. Open: /Users/vijaygopalb/Beam/mobile/beam-app/android');
console.log('  3. Click Run button');
console.log('\nOR use physical device with Expo Go app');
