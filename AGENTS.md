Repository Guidelines
=====================

Project Structure & Module Organization
---------------------------------------
- `mobile/beam-app/` – React Native app (TypeScript); key folders: `src/` (screens, services, Solana clients), `android/`, `ios/`, `assets/`.
- `shared/` – cross-platform libraries (`bundle.ts`, types).
- `program/` – on-chain Solana Anchor program.
- `verifier/` – Express backend for hardware attestation, relays, faucet.
- Tests live near their modules (`src/solana/__tests__`).

Build, Test, and Development Commands
-------------------------------------
- `pnpm install` – install monorepo dependencies.
- `pnpm --filter @beam/app android` – run RN Android bundler/emulator.
- `cd mobile/beam-app/android && ./gradlew assembleRelease` – build Android APK.
- `pnpm --filter @beam/app test` – run Jest suite.
- `pnpm --filter verifier dev` – start verifier API locally (Express).

Coding Style & Naming Conventions
---------------------------------
- TypeScript/TSX with 2-space indentation.
- Favor PascalCase for components, camelCase for functions/variables, SCREAMING_SNAKE for constants.
- Run `pnpm lint` before opening PRs (`eslint` with React Native preset).
- Use explicit typing on exported functions; prefer `useCallback`/`useMemo` for hooks.

Testing Guidelines
------------------
- Jest is standard for unit tests (`*.test.ts`/`*.test.tsx`).
- Place component tests alongside source (`Component.test.tsx`).
- Aim to cover Solana program paths and attestation edge cases; snapshot UI states for critical screens.
- Run `pnpm test -- --watch` during development for focused suites.

Commit & Pull Request Guidelines
--------------------------------
- Commit messages follow “type(scope): summary” (e.g., `fix(customer): handle online settlement`).
- Keep PRs focused; include summary, testing notes, screenshots for UI changes, and reference issues (`Closes #123`).
- Ensure CI passes (lint/test/build) before requesting review.

Security & Configuration Tips
-----------------------------
- Store API keys and Solana RPC URLs in `.env` (see `mobile/beam-app/.env.example`); never commit secrets.
- Use `adb reverse tcp:8081 tcp:8081` for device debugging.
- Confirm attestation backend (`verifier`) is reachable before testing online settlements.
- When a shell command fails with “failed in sandbox”, use the permission request tool (with `with_escalated_permissions`) to ask the user for approval before retrying.

