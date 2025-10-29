#!/bin/bash
# Verify environment configuration is properly set up

set -e

echo "🔍 Verifying Beam App Environment Configuration..."
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track results
ERRORS=0
WARNINGS=0

# 1. Check if .env file exists
echo "1. Checking .env file..."
if [ -f ".env" ]; then
    echo -e "   ${GREEN}✓${NC} .env file exists"
else
    echo -e "   ${RED}✗${NC} .env file not found"
    echo "      Run: cp .env.example .env"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# 2. Check required environment variables in .env
echo "2. Checking required environment variables..."
REQUIRED_VARS=("VERIFIER_URL" "SOLANA_NETWORK" "BEAM_PROGRAM_ID" "USDC_MINT")

if [ -f ".env" ]; then
    for var in "${REQUIRED_VARS[@]}"; do
        if grep -q "^${var}=" .env; then
            VALUE=$(grep "^${var}=" .env | cut -d '=' -f2-)
            echo -e "   ${GREEN}✓${NC} $var is set: $VALUE"
        else
            echo -e "   ${RED}✗${NC} $var is not set in .env"
            ERRORS=$((ERRORS + 1))
        fi
    done
else
    echo "   Skipping (no .env file)"
fi
echo ""

# 3. Check babel configuration
echo "3. Checking babel configuration..."
if [ -f "babel.config.js" ]; then
    if grep -q "react-native-dotenv" babel.config.js; then
        echo -e "   ${GREEN}✓${NC} react-native-dotenv plugin configured"
    else
        echo -e "   ${RED}✗${NC} react-native-dotenv plugin not found in babel.config.js"
        ERRORS=$((ERRORS + 1))
    fi
else
    echo -e "   ${RED}✗${NC} babel.config.js not found"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# 4. Check TypeScript types
echo "4. Checking TypeScript type definitions..."
if [ -f "types/env.d.ts" ]; then
    echo -e "   ${GREEN}✓${NC} types/env.d.ts exists"
    if grep -q "VERIFIER_URL" types/env.d.ts; then
        echo -e "   ${GREEN}✓${NC} VERIFIER_URL type is defined"
    else
        echo -e "   ${YELLOW}⚠${NC} VERIFIER_URL type not found"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo -e "   ${RED}✗${NC} types/env.d.ts not found"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# 5. Check Android gradle configuration
echo "5. Checking Android gradle configuration..."
if [ -f "android/app/build.gradle" ]; then
    if grep -q "getEnvVariable" android/app/build.gradle; then
        echo -e "   ${GREEN}✓${NC} getEnvVariable function found in build.gradle"
    else
        echo -e "   ${YELLOW}⚠${NC} getEnvVariable function not found"
        WARNINGS=$((WARNINGS + 1))
    fi

    if grep -q 'buildConfigField.*VERIFIER_URL' android/app/build.gradle; then
        echo -e "   ${GREEN}✓${NC} VERIFIER_URL BuildConfig field defined"
    else
        echo -e "   ${YELLOW}⚠${NC} VERIFIER_URL BuildConfig field not found"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo -e "   ${RED}✗${NC} android/app/build.gradle not found"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# 6. Check .gitignore
echo "6. Checking .gitignore configuration..."
if [ -f ".gitignore" ]; then
    if grep -q "^.env$" .gitignore || grep -q "^.env$" .gitignore; then
        echo -e "   ${GREEN}✓${NC} .env is in .gitignore"
    else
        echo -e "   ${RED}✗${NC} .env is NOT in .gitignore (security risk!)"
        ERRORS=$((ERRORS + 1))
    fi
else
    echo -e "   ${YELLOW}⚠${NC} .gitignore not found"
    WARNINGS=$((WARNINGS + 1))
fi
echo ""

# 7. Check package.json for react-native-dotenv
echo "7. Checking dependencies..."
if [ -f "package.json" ]; then
    if grep -q "react-native-dotenv" package.json; then
        echo -e "   ${GREEN}✓${NC} react-native-dotenv is installed"
    else
        echo -e "   ${RED}✗${NC} react-native-dotenv is not installed"
        echo "      Run: pnpm add -D react-native-dotenv"
        ERRORS=$((ERRORS + 1))
    fi
else
    echo -e "   ${RED}✗${NC} package.json not found"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# 8. Validate VERIFIER_URL format
echo "8. Validating configuration values..."
if [ -f ".env" ]; then
    VERIFIER_URL=$(grep "^VERIFIER_URL=" .env | cut -d '=' -f2- | tr -d ' ')

    if [[ $VERIFIER_URL == http://192.168.* ]] || [[ $VERIFIER_URL == http://10.* ]]; then
        echo -e "   ${YELLOW}⚠${NC} VERIFIER_URL uses local IP address: $VERIFIER_URL"
        echo "      This will not work in production builds"
        echo "      Consider using: https://beam-verifier.vercel.app"
        WARNINGS=$((WARNINGS + 1))
    elif [[ $VERIFIER_URL == https://* ]]; then
        echo -e "   ${GREEN}✓${NC} VERIFIER_URL uses HTTPS: $VERIFIER_URL"
    elif [[ $VERIFIER_URL == http://localhost* ]]; then
        echo -e "   ${YELLOW}⚠${NC} VERIFIER_URL uses localhost: $VERIFIER_URL"
        echo "      This is OK for development but won't work on physical devices"
        WARNINGS=$((WARNINGS + 1))
    else
        echo -e "   ${RED}✗${NC} VERIFIER_URL format is invalid: $VERIFIER_URL"
        ERRORS=$((ERRORS + 1))
    fi
fi
echo ""

# Summary
echo "═══════════════════════════════════════════════════════════"
if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed!${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Review your .env configuration"
    echo "  2. Restart Metro bundler: pnpm start -- --reset-cache"
    echo "  3. Rebuild the app: pnpm android"
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}⚠ Configuration OK with $WARNINGS warning(s)${NC}"
    echo ""
    echo "Review the warnings above and adjust if needed."
    exit 0
else
    echo -e "${RED}✗ Found $ERRORS error(s) and $WARNINGS warning(s)${NC}"
    echo ""
    echo "Please fix the errors above before proceeding."
    exit 1
fi
