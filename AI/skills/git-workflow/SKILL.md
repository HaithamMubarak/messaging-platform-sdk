---
name: git-workflow
description: Git remote setup and branching workflow for both repos. SDK has two remotes (private origin + public); services has private only. Working branch is develop.
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

Two remotes:

| Remote | URL | Purpose |
|--------|-----|---------|
| `origin` | `git@github.com:HaithamMubarak/messaging-platform-sdk-private.git` | **Private** — default for day-to-day push/pull |
| `public` | `git@github.com:HaithamMubarak/messaging-platform-sdk.git` | **Public** — push releases and public-facing changes |

**Default remote is `origin` (private).** All regular work goes here.

```bash
# Regular push (private, default)
git push origin develop

# Push to public repo (releases / public updates only)
git push public develop
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
