# Beam Deployment Guide

Complete deployment instructions for production environments.

## Table of Contents

- [Overview](#overview)
- [Anchor Program Deployment](#anchor-program-deployment)
- [Verifier Service Deployment](#verifier-service-deployment)
- [Android App Release](#android-app-release)
- [Google Play Store Submission](#google-play-store-submission)
- [Environment Configuration](#environment-configuration)
- [Monitoring and Maintenance](#monitoring-and-maintenance)
- [Security Checklist](#security-checklist)

## Overview

Beam consists of four main components for production:

1. **Solana Program** - Deployed to mainnet-beta
2. **Verifier Service** - Node.js backend (Cloud Run, Railway, etc.)
3. **Android App** - Published to Google Play Store
4. **Supporting Infrastructure** - Monitoring, logging, backups

### Deployment Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Production Stack                      │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌──────────────────┐        ┌──────────────────┐       │
│  │  Solana Mainnet  │        │  Verifier Service│       │
│  │  (Anchor Program)│◄───────┤  (Cloud Run/VPS) │       │
│  └──────────────────┘        └──────────────────┘       │
│          ▲                            ▲                  │
│          │                            │                  │
│          │                            │                  │
│  ┌───────┴────────────────────────────┴──────┐          │
│  │         Android App (Play Store)          │          │
│  │  - Signed APK/AAB                         │          │
│  │  - Play Integrity API                     │          │
│  │  - Auto-updates enabled                   │          │
│  └───────────────────────────────────────────┘          │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

## Anchor Program Deployment

### Prerequisites

- Solana CLI configured for mainnet-beta
- Sufficient SOL for deployment (~5-10 SOL recommended)
- Program audited and tested on devnet
- Upgrade authority keypair secured

### 1. Final Testing on Devnet

```bash
cd program

# Ensure all tests pass
anchor test

# Deploy to devnet for final validation
anchor deploy --provider.cluster devnet

# Test all instructions manually
# Verify escrow initialization, funding, settlement
```

### 2. Build for Mainnet

```bash
# Clean previous builds
anchor clean

# Build optimized program
anchor build --verifiable

# Verify build
anchor verify <PROGRAM_ID>
```

### 3. Configure for Mainnet

Edit `Anchor.toml`:

```toml
[provider]
cluster = "Mainnet"
wallet = "~/.config/solana/mainnet-wallet.json"

[programs.mainnet]
beam = "YourMainnetProgramID"
```

### 4. Deploy to Mainnet

```bash
# Switch to mainnet
solana config set --url mainnet-beta

# Check wallet balance (need ~5 SOL)
solana balance

# Deploy program
anchor deploy --provider.cluster mainnet-beta

# Note the program ID
anchor keys list

# Verify deployment
solana program show <PROGRAM_ID>
```

### 5. Initialize Program State

```bash
# Using Anchor CLI or custom script
# Initialize any required global state accounts

# Example:
anchor run initialize_mainnet
```

### 6. Update Program ID

Update the program ID in all dependent packages:

```bash
# In program/programs/program/src/lib.rs
declare_id!("YourMainnetProgramID");

# In mobile/beam-app/src/config/index.ts
export const BEAM_PROGRAM_ID = 'YourMainnetProgramID';

# Rebuild and redeploy IDL
anchor build
cp target/idl/beam.json ../mobile/beam-app/src/idl/
```

### 7. Freeze Program (Optional)

After thorough testing, consider freezing the program to prevent upgrades:

```bash
# WARNING: This is irreversible!
solana program set-upgrade-authority <PROGRAM_ID> --final

# Or transfer to a multisig
solana program set-upgrade-authority <PROGRAM_ID> <MULTISIG_ADDRESS>
```

### Program Upgrade Process

If you need to upgrade the program:

```bash
# Build new version
anchor build

# Upgrade (not deploy)
anchor upgrade target/deploy/beam.so --program-id <PROGRAM_ID>

# Verify upgrade
solana program show <PROGRAM_ID>
```

## Verifier Service Deployment

The verifier service can be deployed to various platforms:

### Option 1: Google Cloud Run (Recommended)

**Pros:** Serverless, auto-scaling, easy to deploy
**Cons:** Cold start latency

#### Dockerfile

Create `verifier/Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml ./
COPY ../mobile/shared/package.json ../mobile/shared/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build
RUN pnpm build

# Expose port
EXPOSE 8080

# Start
CMD ["pnpm", "start"]
```

#### Deploy to Cloud Run

```bash
cd verifier

# Build and push container
gcloud builds submit --tag gcr.io/YOUR_PROJECT/beam-verifier

# Deploy to Cloud Run
gcloud run deploy beam-verifier \
  --image gcr.io/YOUR_PROJECT/beam-verifier \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "$(cat .env.production)"

# Get service URL
gcloud run services describe beam-verifier --format='value(status.url)'
```

### Option 2: Railway.app

**Pros:** Simple deployment, automatic SSL
**Cons:** Higher cost than VPS

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Initialize project
cd verifier
railway init

# Add environment variables
railway variables set VERIFIER_SIGNING_KEY=your_key
railway variables set DEV_MODE=false

# Deploy
railway up

# Get deployment URL
railway open
```

### Option 3: VPS (DigitalOcean, Linode, AWS EC2)

**Pros:** Full control, predictable costs
**Cons:** Requires maintenance

#### Server Setup

```bash
# SSH into VPS
ssh root@your-server-ip

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# Install pnpm
npm install -g pnpm

# Create app user
useradd -m -s /bin/bash beam
su - beam

# Clone repository
git clone https://github.com/yourusername/beam.git
cd beam/verifier

# Install dependencies
pnpm install --frozen-lockfile

# Build
pnpm build

# Exit back to root
exit
```

#### PM2 Process Manager

```bash
# Install PM2
npm install -g pm2

# Create ecosystem file
cat > /home/beam/beam/verifier/ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'beam-verifier',
    cwd: '/home/beam/beam/verifier',
    script: 'dist/index.js',
    instances: 2,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
}
EOF

# Start with PM2
su - beam
cd beam/verifier
pm2 start ecosystem.config.js

# Setup auto-restart on reboot
pm2 startup systemd
pm2 save
```

#### Nginx Reverse Proxy

```bash
# Install Nginx
apt-get install -y nginx certbot python3-certbot-nginx

# Create Nginx config
cat > /etc/nginx/sites-available/beam-verifier << 'EOF'
server {
    listen 80;
    server_name verifier.beam.app;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
EOF

# Enable site
ln -s /etc/nginx/sites-available/beam-verifier /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx

# Setup SSL with Let's Encrypt
certbot --nginx -d verifier.beam.app
```

### Verifier Environment Configuration

Create `.env.production`:

```bash
# Server
PORT=3000
NODE_ENV=production
DEV_MODE=false

# Security
VERIFIER_SIGNING_KEY=your_production_ed25519_key_hex
VERIFIER_ALLOW_UNSIGNED=false

# Play Integrity
VERIFIER_EXPECTED_PACKAGE_NAME=com.beam.app
VERIFIER_ALLOWED_DIGESTS=your_production_sha256_digest
VERIFIER_CERT_PEM_PATH=/app/config/play_integrity_keys.pem
VERIFIER_ALLOW_FETCH=true

# CORS (if needed)
ALLOWED_ORIGINS=https://beam.app

# Logging
LOG_LEVEL=info
```

### Generate Production Signing Key

```bash
# Generate Ed25519 key for verifier
openssl genpkey -algorithm ed25519 -outform DER -out verifier_key.der

# Convert to hex for env var
xxd -p -c 64 verifier_key.der

# Store securely in environment variables
# NEVER commit to git
```

## Android App Release

### 1. Generate Upload Keystore

```bash
cd mobile/beam-app/android/app

# Generate release keystore (do this once)
keytool -genkeypair -v -storetype PKCS12 \
  -keystore beam-upload.keystore \
  -alias beam-key \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -dname "CN=Beam,OU=Engineering,O=Beam,L=City,ST=State,C=US"

# Backup keystore securely!
# If you lose this, you can't update your app
```

### 2. Configure Signing

Create `android/gradle.properties`:

```properties
BEAM_UPLOAD_STORE_FILE=beam-upload.keystore
BEAM_UPLOAD_KEY_ALIAS=beam-key
BEAM_UPLOAD_STORE_PASSWORD=your_store_password
BEAM_UPLOAD_KEY_PASSWORD=your_key_password
```

Add to `android/app/build.gradle`:

```gradle
android {
    ...

    signingConfigs {
        release {
            if (project.hasProperty('BEAM_UPLOAD_STORE_FILE')) {
                storeFile file(BEAM_UPLOAD_STORE_FILE)
                storePassword BEAM_UPLOAD_STORE_PASSWORD
                keyAlias BEAM_UPLOAD_KEY_ALIAS
                keyPassword BEAM_UPLOAD_KEY_PASSWORD
            }
        }
    }

    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled true
            shrinkResources true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
}
```

### 3. Update Version

Edit `android/app/build.gradle`:

```gradle
android {
    defaultConfig {
        versionCode 1      // Increment for each release
        versionName "1.0.0" // User-visible version
    }
}
```

### 4. Build Release APK/AAB

```bash
cd mobile/beam-app/android

# Clean previous builds
./gradlew clean

# Build release AAB (for Play Store)
./gradlew bundleRelease

# Or build release APK (for direct distribution)
./gradlew assembleRelease

# Output locations:
# AAB: android/app/build/outputs/bundle/release/app-release.aab
# APK: android/app/build/outputs/apk/release/app-release.apk
```

### 5. Test Release Build

```bash
# Install APK on device
adb install android/app/build/outputs/apk/release/app-release.apk

# Test thoroughly:
# - Wallet creation
# - Escrow initialization
# - Offline payment flow
# - Settlement
# - Play Integrity attestation
```

### 6. Setup Play Integrity API

See `mobile/beam-app/PLAY_INTEGRITY_IMPLEMENTATION.md` for details.

**Required steps:**

1. Enable Play Integrity API in Google Cloud Console
2. Link Cloud project to Play Console
3. Add cloud project number to `strings.xml`:

```xml
<!-- android/app/src/main/res/values/strings.xml -->
<string name="play_integrity_cloud_project_number">YOUR_PROJECT_NUMBER</string>
```

4. Get release certificate SHA-256:

```bash
keytool -list -v -keystore beam-upload.keystore -alias beam-key
```

5. Add to Play Console → Release → App Integrity

## Google Play Store Submission

### 1. Create Play Console Account

1. Go to [Google Play Console](https://play.google.com/console/)
2. Pay $25 one-time registration fee
3. Complete account verification

### 2. Create App

1. **Create Application**
   - Go to "All apps" → "Create app"
   - App name: "Beam - Offline Payments"
   - Default language: English (US)
   - App or game: App
   - Free or paid: Free

2. **App Access**
   - Set up store listing
   - All features available without restrictions: Yes
   - (Or explain any restricted features)

3. **Privacy Policy**
   - Required for all apps
   - Host at: https://beam.app/privacy
   - Include:
     - What data is collected (wallet keys, attestations)
     - How it's stored (encrypted local storage)
     - Third-party services (Google Play Integrity, Solana)

4. **App Category**
   - Category: Finance
   - Tags: Payments, Cryptocurrency, Offline

### 3. Store Listing

#### App Details

```
Short Description (80 chars):
Secure offline payments on Solana. Works without internet.

Full Description (4000 chars):
Beam enables peer-to-peer payments when internet fails. Perfect for:
- Internet shutdowns and censorship
- Natural disasters
- Remote areas with poor connectivity
- War zones and conflict areas

HOW IT WORKS:
1. Pre-fund escrow with USDC on Solana
2. Create payment bundles offline
3. Exchange via QR code or Bluetooth
4. Auto-settle when internet returns

SECURITY:
- Escrow-backed trust model
- Ed25519 cryptographic signatures
- Play Integrity device attestation
- Replay protection with nonces
- Solana blockchain settlement

FEATURES:
- 100% offline payment creation
- Dual-signature verification
- Automatic settlement queue
- Secure wallet with biometrics
- Transaction history

Built for the 1.3B people affected by 296 internet shutdowns in 2024.

Learn more: https://beam.app
```

#### Graphics

- **App icon:** 512x512 PNG
- **Feature graphic:** 1024x500 PNG
- **Phone screenshots:** At least 2, up to 8 (1080x1920)
- **Tablet screenshots:** Optional but recommended
- **Video:** Optional YouTube link

#### Contact Details

- Email: support@beam.app
- Website: https://beam.app
- Phone: Optional

### 4. Content Rating

Complete questionnaire:
- Select "Finance" category
- Answer questions about:
  - Real money gambling: No
  - Financial services: Yes (payments)
  - User-generated content: No

### 5. App Content

#### Target Audience

- Age range: 18+ (financial app)
- Target children: No

#### News App

- Is this a news app: No

#### COVID-19 Contact Tracing

- Contact tracing: No

#### Data Safety

Declare data collection:

**Collected:**
- Device ID (for attestation)
- Location: No
- Financial info: Wallet addresses (encrypted)
- Personal info: None

**Security:**
- Data encrypted in transit: Yes
- Data encrypted at rest: Yes
- Users can request deletion: Yes
- Committed to Google Play Families Policy: N/A

### 6. Internal Testing

Before public release, use internal testing:

1. **Create Internal Test Track**
   - Go to Testing → Internal testing
   - Create new release
   - Upload AAB file
   - Add testers by email

2. **Test Thoroughly**
   - Install from Play Store
   - Verify Play Integrity works
   - Test all features
   - Check auto-update

3. **Get Feedback**
   - Minimum 5-10 testers
   - Test for at least 1 week
   - Fix any issues

### 7. Production Release

1. **Create Production Release**
   - Go to Production → Releases
   - Create new release
   - Upload signed AAB
   - Add release notes

2. **Release Notes Template**

```
Version 1.0.0

NEW:
- Offline peer-to-peer payments
- Solana escrow integration
- QR code payment exchange
- Automatic settlement
- Secure wallet with biometric authentication

SECURITY:
- Play Integrity device attestation
- Ed25519 cryptographic signatures
- Hardware-backed key storage
```

3. **Roll Out Strategy**
   - Start with 10% rollout
   - Monitor crash reports
   - Increase to 50% after 24 hours
   - Full rollout after 1 week

4. **Submit for Review**
   - Click "Submit for review"
   - Review can take 1-7 days
   - Address any review feedback

### 8. Post-Release

#### Monitor Metrics

- Install/uninstall rates
- Crash reports
- ANRs (App Not Responding)
- User reviews and ratings
- Play Integrity API success rate

#### Respond to Reviews

- Reply to user reviews within 24 hours
- Address issues in updates
- Thank users for positive feedback

#### Regular Updates

- Bug fixes every 2-4 weeks
- Feature updates monthly
- Security patches immediately

## Environment Configuration

### Development

```bash
# program/Anchor.toml
[provider]
cluster = "Localnet"

# mobile/beam-app/.env.development
SOLANA_CLUSTER=devnet
VERIFIER_URL=http://localhost:3000
BEAM_PROGRAM_ID=DevnetProgramID

# verifier/.env.development
DEV_MODE=true
VERIFIER_ALLOW_UNSIGNED=false
```

### Staging

```bash
# program/Anchor.toml
[provider]
cluster = "Devnet"

# mobile/beam-app/.env.staging
SOLANA_CLUSTER=devnet
VERIFIER_URL=https://staging-verifier.beam.app
BEAM_PROGRAM_ID=DevnetProgramID

# verifier/.env.staging
DEV_MODE=false
VERIFIER_EXPECTED_PACKAGE_NAME=com.beam.app.staging
```

### Production

```bash
# program/Anchor.toml
[provider]
cluster = "Mainnet"

# mobile/beam-app/.env.production
SOLANA_CLUSTER=mainnet-beta
VERIFIER_URL=https://verifier.beam.app
BEAM_PROGRAM_ID=MainnetProgramID

# verifier/.env.production
DEV_MODE=false
VERIFIER_EXPECTED_PACKAGE_NAME=com.beam.app
VERIFIER_ALLOWED_DIGESTS=production_sha256_only
```

## Monitoring and Maintenance

### Solana Program Monitoring

```bash
# Check program status
solana program show <PROGRAM_ID>

# Monitor rent-exempt balance
solana balance <PROGRAM_ID>

# View logs (requires validator access)
solana logs <PROGRAM_ID>

# Track events via RPC
# Use getProgramAccounts and websocket subscriptions
```

### Verifier Service Monitoring

#### Health Checks

Add to `verifier/src/index.ts`:

```typescript
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: Date.now(),
    uptime: process.uptime(),
  });
});

app.get('/metrics', (req, res) => {
  res.json({
    attestations_verified: verificationCount,
    errors_count: errorCount,
    avg_response_time: avgResponseTime,
  });
});
```

#### Logging

Use structured logging:

```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});
```

#### Uptime Monitoring

Use services like:
- UptimeRobot (free)
- Pingdom
- StatusCake
- Custom CloudWatch/Datadog

### Mobile App Monitoring

#### Firebase Crashlytics

```bash
# Add to android/app/build.gradle
implementation 'com.google.firebase:firebase-crashlytics:18.6.0'
```

#### Analytics

Track key metrics:
- Wallet creation rate
- Escrow initialization success
- Offline payment creation
- Settlement success rate
- Attestation verification rate

### Backup Strategy

1. **Keystore Backup**
   - Store keystore in secure vault (1Password, AWS Secrets)
   - Keep offline backup
   - Never commit to git

2. **Environment Variables**
   - Backup all .env files securely
   - Document all configuration

3. **Database** (if added later)
   - Daily automated backups
   - Test restoration monthly

## Security Checklist

### Pre-Launch

- [ ] All secrets in environment variables, not code
- [ ] Keystore backed up securely
- [ ] Program audited for vulnerabilities
- [ ] Rate limiting on verifier endpoints
- [ ] HTTPS enforced on all endpoints
- [ ] CORS properly configured
- [ ] Play Integrity API enabled
- [ ] Certificate pinning (optional but recommended)
- [ ] ProGuard/R8 enabled for Android
- [ ] No console.log in production
- [ ] All dependencies updated
- [ ] Security headers configured (Nginx/CloudFlare)

### Post-Launch

- [ ] Monitor crash reports daily
- [ ] Review user feedback weekly
- [ ] Security patches within 24 hours
- [ ] Dependency updates monthly
- [ ] Penetration testing quarterly
- [ ] Incident response plan documented

### Emergency Procedures

#### Program Vulnerability

1. Pause new escrow initializations (if possible)
2. Notify users via app update
3. Deploy patch to devnet
4. Test thoroughly
5. Upgrade mainnet program
6. Post-mortem and disclosure

#### Verifier Compromise

1. Rotate signing keys immediately
2. Deploy new verifier instance
3. Update mobile app with new verifier URL
4. Investigate breach
5. Notify affected users

#### Play Store Suspension

1. Review suspension reason
2. Fix policy violation
3. Submit appeal with explanation
4. Provide APK for direct distribution while resolving

## Rollback Procedures

### Program Rollback

```bash
# If upgrade authority not frozen
anchor upgrade previous_version.so --program-id <PROGRAM_ID>

# Verify rollback
solana program show <PROGRAM_ID>
```

### Verifier Rollback

```bash
# Git revert
git revert <commit-hash>
git push

# Redeploy
railway up  # or your deployment method
```

### Mobile App Rollback

1. Go to Play Console → Production → Releases
2. Create new release with previous APK/AAB
3. Submit for expedited review
4. User devices will auto-update within 24 hours

## Cost Estimates

### Monthly Costs (Production)

| Component | Service | Cost |
|-----------|---------|------|
| Solana Program | Mainnet rent | ~0.01 SOL/month |
| Verifier | Cloud Run | $5-20/month |
| | Railway | $5-10/month |
| | VPS (DigitalOcean) | $12-24/month |
| Domain | Cloudflare/Route53 | $1-2/month |
| SSL | Let's Encrypt | Free |
| Monitoring | UptimeRobot | Free |
| Play Console | One-time fee | $25 |
| **Total** | | **$20-60/month** |

## Support and Documentation

- **User Support:** support@beam.app
- **Developer Docs:** https://docs.beam.app
- **Status Page:** https://status.beam.app
- **GitHub Issues:** https://github.com/yourusername/beam/issues

---

For setup instructions, see [SETUP.md](./SETUP.md).

For architecture details, see [ARCHITECTURE.md](./ARCHITECTURE.md).
