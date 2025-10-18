#!/bin/bash
set -e

echo "🚀 Starting Beam development environment..."

# Start verifier in dev mode
echo "📡 Starting verifier service..."
cd verifier
DEV_MODE=true pnpm dev &
VERIFIER_PID=$!
cd ..

# Start Solana test validator
echo "⚓ Starting Solana test validator..."
solana-test-validator --reset &
VALIDATOR_PID=$!

# Wait for validator to be ready
echo "⏳ Waiting for validator..."
sleep 5

echo "✅ Development environment ready!"
echo "   Verifier: http://localhost:3000"
echo "   Validator: http://localhost:8899"
echo ""
echo "Press Ctrl+C to stop all services"

# Cleanup on exit
trap "kill $VERIFIER_PID $VALIDATOR_PID 2>/dev/null" EXIT

wait
