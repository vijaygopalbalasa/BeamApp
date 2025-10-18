# Beam Deployment Checklist

Complete deployment checklist for Beam mobile app and verifier service across different environments.

## Table of Contents

- [Pre-Deployment](#pre-deployment)
- [Development Deployment](#development-deployment)
- [Staging Deployment](#staging-deployment)
- [Production Deployment](#production-deployment)
- [Post-Deployment](#post-deployment)
- [Rollback Procedures](#rollback-procedures)

---

## Pre-Deployment

### Code Review & Testing

- [ ] All tests pass (`npm test`)
- [ ] Linting passes (`npm run lint`)
- [ ] TypeScript compilation succeeds (`tsc --noEmit`)
- [ ] Code review completed and approved
- [ ] Integration tests passed
- [ ] Security audit completed
- [ ] Dependencies updated and audited (`npm audit`)

### Program Deployment

- [ ] Anchor program tested on target network
- [ ] Program deployed to target network
- [ ] Program ID updated in configuration
- [ ] Program upgrade authority secured
- [ ] Program verified on-chain
- [ ] Test transactions executed successfully

### Infrastructure

- [ ] RPC provider account created and configured
- [ ] Rate limits configured appropriately
- [ ] WebSocket endpoints tested (if used)
- [ ] Fallback RPC endpoints configured
- [ ] Monitoring and alerting set up
- [ ] Log aggregation configured

---

## Development Deployment

### Environment: Devnet

#### 1. Solana Configuration

- [ ] Network set to `devnet`
  ```bash
  SOLANA_NETWORK=devnet
  ```

- [ ] RPC URL configured
  ```bash
  SOLANA_RPC_URL=https://api.devnet.solana.com
  # or use dedicated provider for better performance
  ```

- [ ] Program ID updated
  ```bash
  BEAM_PROGRAM_ID=<your-devnet-program-id>
  ```

- [ ] USDC mint set to devnet address
  ```bash
  USDC_MINT=Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr
  ```

#### 2. Verifier Service

- [ ] Deploy verifier service to dev environment
- [ ] Set `DEV_MODE=true`
- [ ] Set `VERIFIER_ALLOW_UNSIGNED=true` (if needed for testing)
- [ ] Update `VERIFIER_URL` in mobile app config
- [ ] Test attestation flow end-to-end
- [ ] Verify logs for errors

#### 3. Mobile App

- [ ] Update `.env` file with devnet configuration
- [ ] Clean build cache
  ```bash
  npm start -- --reset-cache
  ```

- [ ] Build and test Android app
  ```bash
  npm run android
  ```

- [ ] Build and test iOS app
  ```bash
  npm run ios
  ```

- [ ] Test key features:
  - [ ] Wallet creation
  - [ ] Escrow initialization
  - [ ] Offline bundle creation
  - [ ] Attestation generation
  - [ ] Settlement on-chain
  - [ ] BLE communication

#### 4. Testing

- [ ] Create test transactions
- [ ] Verify on Solana Explorer (devnet)
- [ ] Test error handling
- [ ] Test network disconnection scenarios
- [ ] Test rate limiting
- [ ] Verify attestation verification

---

## Staging Deployment

### Environment: Devnet or Mainnet (Isolated)

#### 1. Configuration

- [ ] Create staging environment configuration
- [ ] Use production-like RPC provider
- [ ] Configure proper rate limits
- [ ] Set up staging verifier instance
- [ ] Use staging-specific signing keys
- [ ] Configure monitoring and logging

#### 2. Verifier Service

- [ ] Deploy to staging environment
- [ ] Set `NODE_ENV=staging`
- [ ] Set `DEV_MODE=false`
- [ ] Configure proper `ALLOWED_ORIGINS`
- [ ] Set up SSL/TLS certificates
- [ ] Test HTTPS endpoints
- [ ] Configure proper security headers

#### 3. Mobile App

- [ ] Build staging variant/flavor
- [ ] Configure staging environment variables
- [ ] Test with production build settings
- [ ] Test with ProGuard/R8 (Android)
- [ ] Test with release build (iOS)

#### 4. Integration Testing

- [ ] End-to-end transaction flow
- [ ] Stress testing with multiple users
- [ ] Network failure recovery testing
- [ ] Performance testing
- [ ] Security penetration testing
- [ ] Load testing on verifier service

#### 5. Validation

- [ ] QA sign-off
- [ ] Product team approval
- [ ] Security team approval
- [ ] Performance benchmarks met

---

## Production Deployment

### Environment: Mainnet-Beta

#### 1. Pre-Production Checks

- [ ] All staging tests passed
- [ ] Security audit completed
- [ ] Program audited and verified
- [ ] Disaster recovery plan in place
- [ ] Rollback plan documented
- [ ] Team notified of deployment
- [ ] Maintenance window scheduled (if needed)

#### 2. RPC Provider Setup

- [ ] Production RPC account created
- [ ] Primary RPC endpoint configured
  ```bash
  # Example with Helius
  SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY
  SOLANA_WS_URL=wss://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY
  ```

- [ ] Fallback RPC endpoints configured
- [ ] Rate limits appropriate for production load
- [ ] Monitoring and alerts configured
- [ ] WebSocket connection tested

#### 3. Solana Program

- [ ] Program deployed to mainnet-beta
  ```bash
  anchor deploy --provider.cluster mainnet-beta
  ```

- [ ] Program ID updated in all configurations
- [ ] Upgrade authority properly secured
- [ ] Initial accounts initialized
- [ ] Test transaction executed successfully
- [ ] Program verified on Solana Explorer

#### 4. Environment Configuration

**Mobile App (.env)**

- [ ] Network set to mainnet-beta
  ```bash
  SOLANA_NETWORK=mainnet-beta
  ```

- [ ] Production RPC URL configured
- [ ] Production program ID set
  ```bash
  BEAM_PROGRAM_ID=<your-mainnet-program-id>
  ```

- [ ] Mainnet USDC mint configured
  ```bash
  USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
  ```

- [ ] Production verifier URL set
  ```bash
  VERIFIER_URL=https://verifier.yourdomain.com
  ```

- [ ] Rate limiting configured
  ```bash
  RPC_RATE_LIMIT=100  # Based on your RPC plan
  ```

- [ ] Logging configured appropriately
  ```bash
  VERBOSE_LOGGING=false
  ENABLE_SIMULATION=true
  ```

**Verifier Service (.env)**

- [ ] Production environment set
  ```bash
  NODE_ENV=production
  ```

- [ ] Development mode disabled
  ```bash
  DEV_MODE=false
  ```

- [ ] Network matches mobile app
  ```bash
  SOLANA_NETWORK=mainnet-beta
  ```

- [ ] Production RPC configured
  ```bash
  SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY
  ```

- [ ] Fallback RPCs configured
  ```bash
  SOLANA_FALLBACK_RPCS=https://api.mainnet-beta.solana.com,https://backup.rpc.com
  ```

- [ ] Secure signing key generated and set
  ```bash
  # Generate: openssl rand -hex 32
  VERIFIER_SIGNING_KEY=<secure-key>
  ```

- [ ] Package name verified
  ```bash
  VERIFIER_EXPECTED_PACKAGE_NAME=com.beam.app
  ```

- [ ] APK digests configured
  ```bash
  VERIFIER_ALLOWED_DIGESTS=<your-release-apk-sha256>
  ```

- [ ] Unsigned attestations disabled
  ```bash
  VERIFIER_ALLOW_UNSIGNED=false
  ```

- [ ] CORS properly configured
  ```bash
  ALLOWED_ORIGINS=https://yourdomain.com
  ```

- [ ] Rate limiting configured
  ```bash
  MAX_REQUESTS_PER_MINUTE=1000
  ```

#### 5. Verifier Service Deployment

- [ ] Deploy to production infrastructure
- [ ] SSL/TLS certificates installed and valid
- [ ] HTTPS enforced
- [ ] Health check endpoint responding
  ```bash
  curl https://verifier.yourdomain.com/health
  ```

- [ ] Security headers configured
- [ ] Rate limiting active
- [ ] Logging and monitoring active
- [ ] Alerts configured for errors

#### 6. Mobile App Build

**Android**

- [ ] Update version code and version name
- [ ] Clean build
  ```bash
  cd android && ./gradlew clean
  ```

- [ ] Generate release build
  ```bash
  ./gradlew bundleRelease
  ```

- [ ] Sign APK/AAB with release keystore
- [ ] Test signed build on device
- [ ] Verify ProGuard rules
- [ ] Test Play Integrity attestation

**iOS**

- [ ] Update version and build number
- [ ] Clean build folder
- [ ] Archive for release
- [ ] Sign with distribution certificate
- [ ] Test on physical device
- [ ] Verify entitlements

#### 7. Pre-Release Testing

- [ ] Install production build on test devices
- [ ] Test complete user flow
- [ ] Create and settle real transaction (small amount)
- [ ] Verify on Solana Explorer
- [ ] Test error scenarios
- [ ] Verify attestation works
- [ ] Test with poor network conditions
- [ ] Test on multiple device models

#### 8. App Store Preparation

**Google Play Store**

- [ ] App listing updated
- [ ] Screenshots current
- [ ] Privacy policy updated
- [ ] Release notes prepared
- [ ] Internal testing complete
- [ ] Beta testing complete (if applicable)
- [ ] Upload AAB to Play Console
- [ ] Submit for review

**Apple App Store**

- [ ] App listing updated
- [ ] Screenshots current
- [ ] Privacy policy updated
- [ ] Release notes prepared
- [ ] TestFlight testing complete
- [ ] Upload to App Store Connect
- [ ] Submit for review

#### 9. Deployment Execution

- [ ] Monitor Solana network status
- [ ] Verify RPC endpoints healthy
- [ ] Verify verifier service healthy
- [ ] Begin phased rollout (if supported)
- [ ] Monitor error rates
- [ ] Monitor transaction success rate
- [ ] Monitor RPC usage
- [ ] Monitor verifier service load

---

## Post-Deployment

### Immediate (First Hour)

- [ ] Verify app launches successfully
- [ ] Monitor crash reports
- [ ] Monitor error logs
- [ ] Test critical user flows
- [ ] Monitor RPC request rates
- [ ] Monitor verifier service metrics
- [ ] Check transaction success rates
- [ ] Verify settlements on-chain

### First 24 Hours

- [ ] Monitor user adoption
- [ ] Track transaction volume
- [ ] Monitor RPC costs
- [ ] Review error patterns
- [ ] Check performance metrics
- [ ] Monitor server resources
- [ ] Review user feedback
- [ ] Address critical issues

### First Week

- [ ] Analyze usage patterns
- [ ] Optimize RPC usage if needed
- [ ] Review and optimize costs
- [ ] Plan scaling if needed
- [ ] Address user feedback
- [ ] Update documentation
- [ ] Team retrospective

### Ongoing

- [ ] Weekly metrics review
- [ ] Monthly security audit
- [ ] Dependency updates
- [ ] Performance optimization
- [ ] Cost optimization
- [ ] User feedback incorporation

---

## Monitoring & Alerts

### RPC Monitoring

- [ ] Request rate tracking
- [ ] Error rate alerts
- [ ] Latency monitoring
- [ ] Cost tracking
- [ ] Failover testing

### Verifier Service

- [ ] Uptime monitoring
- [ ] Request rate tracking
- [ ] Error rate alerts
- [ ] Response time monitoring
- [ ] CPU/Memory usage alerts

### Mobile App

- [ ] Crash reporting (Firebase Crashlytics, Sentry)
- [ ] Error tracking
- [ ] Performance monitoring
- [ ] User analytics
- [ ] Transaction success rates

### On-Chain

- [ ] Transaction monitoring
- [ ] Program account monitoring
- [ ] Token balance alerts
- [ ] Escrow balance tracking
- [ ] Fraud detection

---

## Rollback Procedures

### If Critical Issues Detected

#### Mobile App Rollback

1. **Google Play Store**
   - [ ] Halt rollout in Play Console
   - [ ] Create staged rollback
   - [ ] Notify users of issue
   - [ ] Monitor rollback completion

2. **Apple App Store**
   - [ ] Request expedited review for hotfix
   - [ ] Or revert to previous version
   - [ ] Communicate with users

#### Verifier Service Rollback

- [ ] Revert to previous deployment
  ```bash
  # Docker example
  docker service update --rollback verifier
  ```

- [ ] Verify service health
- [ ] Check logs for issues
- [ ] Monitor traffic

#### Program Rollback

- [ ] If upgrade authority available, upgrade to previous version
- [ ] Or deploy hotfix
- [ ] Coordinate with app deployment

### Communication

- [ ] Notify team of rollback
- [ ] Update status page
- [ ] Communicate with users
- [ ] Post-mortem scheduled

---

## Security Checklist

### Before Production

- [ ] All secrets rotated from staging
- [ ] Signing keys secured in vault
- [ ] Access control reviewed
- [ ] Security audit completed
- [ ] Penetration testing done
- [ ] Dependencies scanned for vulnerabilities
- [ ] Code obfuscation enabled (mobile)
- [ ] Certificate pinning implemented
- [ ] Attestation verification working

### Production Hardening

- [ ] `DEV_MODE=false`
- [ ] `VERIFIER_ALLOW_UNSIGNED=false`
- [ ] Strong signing keys generated
- [ ] HTTPS enforced everywhere
- [ ] CORS properly restricted
- [ ] Rate limiting enabled
- [ ] Input validation on all endpoints
- [ ] SQL injection prevention (if applicable)
- [ ] XSS prevention
- [ ] CSRF protection

---

## Emergency Contacts

Document and keep updated:

- [ ] DevOps team contacts
- [ ] Security team contacts
- [ ] RPC provider support
- [ ] On-call rotation
- [ ] Escalation procedures

---

## Sign-Off

### Deployment Approval

- [ ] Technical Lead: _________________ Date: _______
- [ ] Security Lead: _________________ Date: _______
- [ ] Product Manager: _______________ Date: _______
- [ ] DevOps Lead: ___________________ Date: _______

### Post-Deployment Verification

- [ ] QA Lead: ______________________ Date: _______
- [ ] DevOps Lead: __________________ Date: _______

---

## Additional Resources

- [Environment Configuration Guide](./ENVIRONMENT_CONFIGURATION.md)
- [Solana Program Deployment Guide](https://docs.solana.com/cli/deploy-a-program)
- [Anchor Deployment](https://www.anchor-lang.com/docs/cli#deploy)
- [Google Play Release Guide](https://developer.android.com/studio/publish)
- [App Store Release Guide](https://developer.apple.com/app-store/submissions/)
