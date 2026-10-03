---
name: git-workflow
description: Git remote setup and branching workflow for both repos. both have a single remote, origin (the sdk-private repo was retired 2026-10-03). Working branch is develop.
when_to_use: Use when pushing, pulling, syncing remotes, or explaining the git setup for either repo.
---

# Git Workflow

## Working Branch

Always work on **`develop`** — never commit directly to `main`.

```bash
git checkout develop
git pull origin develop
```

---

## Remote Setup

### SDK Repo (`messaging-platform-sdk`)

One remote only (the `-private` repo was retired 2026-10-03):

| Remote | URL | Purpose |
|--------|-----|---------|
| `origin` | `git@github.com:HaithamMubarak/messaging-platform-sdk.git` | Public — the only remote |

**Default remote is `origin`.** All work goes here.

```bash
git push origin develop
```

### Services Repo (`messaging-platform-services`)

One remote only — **private**:

| Remote | URL | Purpose |
|--------|-----|---------|
| `origin` | `git@github.com:HaithamMubarak/messaging-platform-services.git` | Private — only remote |

```bash
git push origin develop
git pull origin develop
```

Services repo is **never pushed to a public remote** — it contains private backend implementation.

---

## Common Operations

```bash
# Pull latest (discard local changes — take remote as-is)
git fetch origin
git reset --hard origin/develop

# Pull with local changes (stash first)
git stash
git pull origin develop
git stash pop

# Check status
git status
git log --oneline -10

# Check remotes
git remote -v
```

---

## What Goes Where

| Content | SDK private | SDK public | Services |
|---------|-------------|------------|----------|
| Client library source | ✅ | ✅ | ❌ |
| Public docs / README | ✅ | ✅ | ❌ |
| AI skills (SDK) | ✅ | ❌ | ❌ |
| Backend services | ❌ | ❌ | ✅ |
| Private config / keys | ❌ | ❌ | ❌ (use .env) |

**Rule:** Never let services code or private implementation details reach the public SDK remote.
