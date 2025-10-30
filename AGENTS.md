# Repository Guidelines

## Project Structure & Module Organization
The monorepo uses PNPM workspaces. Mobile code lives under `mobile/beam-app`, shared React Native utilities sit in `mobile/shared`, and the Solana Anchor program resides in `program` with Rust sources in `program/programs` and integration tests in `program/tests`. The attestation microservice is in `verifier/src`. Supporting documentation and architecture notes are collected in `docs`. Place new scripts in `scripts/` to keep package manifests focused.

## Build, Test, and Development Commands
Install dependencies with `pnpm install` from the repo root; this wires all workspaces. Run `pnpm dev:verifier` for the verifier API and `pnpm dev:validator` to launch a local Solana test validator. Use `pnpm --filter @beam/app start` for the React Native Metro server, followed by the `android` or `ios` scripts inside `mobile/beam-app`. Build and test the Anchor program via `pnpm build:program` and `pnpm test:program`, respectively. `pnpm -r test`, `pnpm -r lint`, and `pnpm -r format` execute tests, linting, and formatting across all packages.

## Coding Style & Naming Conventions
TypeScript projects adopt the repo ESLint presets; run `pnpm -r lint` before pushing. Stick to 2-space indentation in JavaScript/TypeScript and follow React Native conventions (PascalCase components, camelCase hooks and utilities). Use `pnpm -r format` to apply the configured Prettier rules. Rust contracts must pass `cargo fmt` and `cargo clippy` (Anchor includes these in CI). Rust modules and files use `snake_case`, while instruction structs use `PascalCase`.

## Testing Guidelines
Write unit tests with Vitest in `verifier` (`pnpm --filter @beam/verifier test`), Jest for the mobile app (`pnpm --filter @beam/app test`), and Anchor integration tests in `program/tests` (`pnpm test:program`). Favor deterministic fixtures and keep Solana accounts seeded via migrations rather than ad-hoc airdrops. When adding features, pair them with regression tests covering both success and failure paths; update or add snapshot files when UI states change.

## Commit & Pull Request Guidelines
Author commits in the imperative mood (“verifier: add Google Play attestation cache”) and keep the first line under 72 characters. Group unrelated work into separate commits so reviewers can follow the diff. Pull requests should describe intent, list test commands executed, and link to tracking issues or specs. Include screenshots or terminal logs when touching UI flows or CLI output. Ensure PRs remain draft until lint, format, and all workspace tests pass locally.

## Security & Configuration Tips
Store secrets (Solana keypairs, Google credentials) in `.env.local` files excluded from version control. Never commit `program/target` or mobile build artifacts. Validate new dependencies for supply-chain risk, and prefer audited Solana crates. When debugging against public clusters, avoid leaving test validators or rate-limit overrides active in committed configs.
