# Tower — CI/CD Pipeline & Version Control Design Spec

**Date:** 2026-04-11
**Status:** Backlog (MVP2 — implement after v1 App Store submission)
**Scope:** Full automated pipeline from PR → test → TestFlight → App Store gate

---

## Overview

A three-workflow GitHub Actions pipeline that automates testing, TestFlight distribution, and App Store submission for the Tower iOS app. Zero new costs. Zero Apple credential management in GitHub (EAS handles certs).

---

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| CI toolchain | GitHub Actions + EAS CLI | Tests run free; EAS handles Apple certs natively |
| Branching model | Simple — `main` is always shippable | Solo developer; no ceremony needed |
| App Store trigger | Git tag (`v*.*.*`) | Human gate — submission is intentional, never accidental |
| Build number management | EAS `autoIncrement: buildNumber` | Never touch it manually |
| Apple credentials | Managed by EAS | Zero secrets in GitHub beyond `EXPO_TOKEN` |

---

## Branch Strategy

```
main          ← always shippable, protected (no direct push)
feature/*     ← development work
hotfix/*      ← urgent production fixes
```

All changes go through a PR. `main` requires the `test` status check to pass.

---

## Workflow 1: `pr.yml` — Test on every PR

**Trigger:** `pull_request` targeting `main`

```yaml
name: Test
on:
  pull_request:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: budget-app/mobile
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: budget-app/mobile/package-lock.json
      - run: npm ci
      - run: npx jest --no-coverage --ci
      - run: npx tsc --noEmit
```

**Time:** ~2 min. Blocks merge if tests fail or TypeScript breaks.

---

## Workflow 2: `deploy.yml` — TestFlight on merge to main

**Trigger:** `push` to `main`

**GitHub Secret required:** `EXPO_TOKEN` (generate at expo.dev → Account Settings → Access Tokens)

```yaml
name: TestFlight
on:
  push:
    branches: [main]
jobs:
  testflight:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: budget-app/mobile/package-lock.json
      - uses: expo/expo-github-action@v8
        with:
          eas-version: latest
          token: ${{ secrets.EXPO_TOKEN }}
      - working-directory: budget-app/mobile
        run: npm ci
      - working-directory: budget-app/mobile
        run: eas build --platform ios --profile production --non-interactive --wait
      - working-directory: budget-app/mobile
        run: eas submit --platform ios --latest --non-interactive
```

**Time:** ~25 min (EAS build). Every merge to `main` lands on TestFlight within the hour.

---

## Workflow 3: `release.yml` — App Store on git tag

**Trigger:** `push` tags matching `v*.*.*`

```yaml
name: App Store Release
on:
  push:
    tags:
      - 'v*.*.*'
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: budget-app/mobile/package-lock.json
      - name: Parse version from tag
        id: version
        run: echo "VERSION=${GITHUB_REF_NAME#v}" >> $GITHUB_OUTPUT
      - name: Update app.json version
        working-directory: budget-app/mobile
        run: |
          node -e "
            const fs = require('fs');
            const config = JSON.parse(fs.readFileSync('app.json','utf8'));
            config.expo.version = '${{ steps.version.outputs.VERSION }}';
            fs.writeFileSync('app.json', JSON.stringify(config, null, 2));
          "
      - uses: expo/expo-github-action@v8
        with:
          eas-version: latest
          token: ${{ secrets.EXPO_TOKEN }}
      - working-directory: budget-app/mobile
        run: npm ci
      - working-directory: budget-app/mobile
        run: eas build --platform ios --profile production --non-interactive --wait
      - working-directory: budget-app/mobile
        run: eas submit --platform ios --latest --non-interactive
      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
```

**Usage:** `git tag v1.0.0 && git push --tags` → App Store review submission + GitHub Release with auto-generated changelog.

---

## EAS Configuration (`eas.json`)

```json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "production": {
      "ios": {
        "autoIncrement": "buildNumber"
      }
    }
  },
  "submit": {
    "production": {
      "ios": {
        "appleId": "YOUR_APPLE_ID",
        "ascAppId": "YOUR_APP_STORE_CONNECT_APP_ID",
        "appleTeamId": "YOUR_TEAM_ID"
      }
    }
  }
}
```

---

## Branch Protection Rules

On `main`:
- Required status checks: `test` (from `pr.yml`) must pass
- No direct pushes — all changes via PR
- No required reviewers (solo developer)

---

## One-Time Setup Checklist

- [ ] Generate `EXPO_TOKEN` at expo.dev → Account Settings → Access Tokens
- [ ] Add `EXPO_TOKEN` to GitHub repo → Settings → Secrets → Actions
- [ ] Fill in `eas.json` submit section: `appleId`, `ascAppId`, `appleTeamId`
- [ ] Enable branch protection on `main` in GitHub repo Settings → Branches
- [ ] Test the pipeline on a feature branch PR

---

## Versioning Convention

| Tag | Meaning |
|---|---|
| `v1.0.0` | Initial App Store release |
| `v1.0.1` | Bug fix |
| `v1.1.0` | New feature |
| `v2.0.0` | Breaking change / major redesign |

Build number is auto-incremented by EAS — never set manually.

---

## What's Implemented Now (MVP1)

Only branch protection + test runner. See `.github/workflows/test.yml`.

Full pipeline (Workflows 2 + 3) deferred until after v1 App Store submission.
