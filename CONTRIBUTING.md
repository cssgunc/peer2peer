# Contributing to Peer2Peer

We loosely follow an industry-standard Git workflow. The core idea is that nobody pushes straight to `main`. Every change goes through a branch and a pull request (PR).

If you're new to Git branching, work through [Learn Git Branching](https://learngitbranching.js.org/?locale=en_US) first. It's highly recommended.

For first-time setup (dev container, database, running the app), see the [README](README.md).

## Workflow

### 1. Pick up an issue

All work is tracked as a [GitHub Issue](https://github.com/cssgunc/peer2peer/issues), and each issue has an ID (e.g. `#12`). The issue describes the motivation, the deliverables, and any important notes. If something is unclear, ask in the issue before you start.

### 2. Create a branch

Always start from an up-to-date `main`:

```bash
git checkout main
git pull
```

Then create your branch. Name it `<issue#>/<short-description>`:

```bash
git checkout -b 12/faq-page
```

Commit early and often while you work, and push your branch to GitHub:

```bash
git push   # the first push creates the branch on GitHub automatically
```

### 3. Open a pull request

1. Make sure all your commits are pushed to your branch.
2. Go to the [Pull Requests tab](https://github.com/cssgunc/peer2peer/pulls) and click **New pull request**. Pick your branch.
3. Set the **PR title** by copying the issue's title exactly.
4. Fill out the PR template (it pre-fills the description):
   - **Motivation:** copy it from the issue's description, replacing the placeholder text at the top.
   - **Changes:** a bullet list of what you added, changed, or removed, and why. Don't just restate the issue; summarize what you actually did and note anything that differs from the plan.
   - **`Closes #12`:** use your issue's number so it closes automatically when the PR merges.
5. Add anything a reviewer needs to know: screenshots for UI changes, how to test it, or follow-up work you left out on purpose.
6. Request a review from Caleb (`calebyhan`). This isn't strictly required, but it gets you a faster review.

CI runs automatically on every PR (lint, type checks, tests, and the frontend build). A PR needs a green CI run before it can merge. If a check fails, click **Details** on it to see the logs.

## Important Notes

- **You can't push to `main`.** It's protected on GitHub, and the only way to get code into `main` is through a PR. Only Caleb and Mason can bypass this.
- **Pre-commit hooks run on every commit.** They lint and format the files you staged (Ruff for Python, Prettier and ESLint for the frontend). They fix most issues automatically. If a hook changes a file, the commit stops: re-stage the file (`git add`) and commit again.
- **Tests and type checks run in CI, not on commit.** Run the full CI suite locally before you push, and run it often while you work. That way you know your PR will pass:

  ```bash
  make check   # lint + type checks + tests + build, same as CI
  make lint    # just the pre-commit hooks, on every file
  make test    # just the tests
  ```

- **Keep PRs focused.** One issue per PR. A small PR gets reviewed faster and is easier to fix if something breaks.
- **Keep your branch current.** If `main` moves ahead while you're working, merge it into your branch (`git pull origin main`) and resolve any conflicts before you ask for a review.
- **Never commit secrets.** `.env` files are gitignored. When you add a new setting, add a placeholder to the matching `.env.example` instead.
