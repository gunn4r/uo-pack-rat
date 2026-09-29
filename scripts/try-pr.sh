#!/usr/bin/env bash
# try-pr.sh — run one or more open PRs locally before merging. Usage: npm run try -- <pr> [<pr>...] [--demo] [--devtools]
# The first PR is checked out into a reusable scratch worktree (../pack-rat-wt/try, or $PACKRAT_TRY_DIR); every
# further PR is merged on top of it there, locally only (a stack like "100 110 111"). Then the desktop app starts
# from that worktree. Nothing is pushed, and your own checkout is never touched. Needs git and gh.
set -euo pipefail
# The main checkout, even when this runs from a worktree: the try worktree and node_modules live beside it.
root="$(dirname "$(cd "$(dirname "$0")/.." && git rev-parse --path-format=absolute --git-common-dir)")"
wt="${PACKRAT_TRY_DIR:-$(dirname "$root")/pack-rat-wt/try}"
prs=(); flags=()
for a in "$@"; do
  case "$a" in
    --demo|--devtools) flags+=("$a") ;;
    *[!0-9]*|"") echo "usage: npm run try -- <pr> [<pr>...] [--demo] [--devtools]" >&2; exit 2 ;;
    *) prs+=("$a") ;;
  esac
done
[ ${#prs[@]} -gt 0 ] || { echo "usage: npm run try -- <pr> [<pr>...] [--demo] [--devtools]" >&2; exit 2; }

cd "$root"
git fetch -q origin main
for p in "${prs[@]}"; do git fetch -q origin "+pull/$p/head:refs/try/$p"; done
if [ -d "$wt" ]; then
  git -C "$wt" merge --abort 2>/dev/null || true
  git -C "$wt" reset -q --hard
  git -C "$wt" clean -fdq -e node_modules
  git -C "$wt" checkout -q --detach "refs/try/${prs[0]}"
else
  git -C "$root" worktree add -q --detach "$wt" "refs/try/${prs[0]}"
fi
[ -e "$wt/node_modules" ] || ln -s "$root/node_modules" "$wt/node_modules"
for p in "${prs[@]:1}"; do
  if ! git -C "$wt" merge -q --no-edit "refs/try/$p" >/dev/null 2>&1; then
    files=$(git -C "$wt" diff --name-only --diff-filter=U | tr "\n" " ")
    git -C "$wt" merge --abort
    echo "PR #$p conflicts with the PRs before it (${files% }); try it on its own, or ask for the PRs to be stacked." >&2; exit 1
  fi
done

echo "Trying in $wt:"
for p in "${prs[@]}"; do echo "  #$p  $(gh pr view "$p" --json title -q .title 2>/dev/null || echo '(title unavailable)')"; done
if [ -n "$(git -C "$wt" diff --name-only origin/main...HEAD -- adapters)" ]; then
  echo "These PRs change the game scripts: stop them in game, then Settings › Reinstall in this window. Reinstall again from your normal app afterwards."
fi
case " ${flags[*]-} " in
  *" --demo "*) ;;
  *) echo "Using your real Pack Rat data: quit the installed Pack Rat first (one app per data folder). Add --demo for sample data." ;;
esac
cd "$wt"
exec npm run desktop -- ${flags[@]+"${flags[@]}"}
