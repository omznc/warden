# Issue tracker: GitHub

Issues for this repository live in its GitHub Issues. Use the `gh` CLI for all operations.
`gh` finds the repository from `git remote -v` when you run it inside a clone.

## Commands

- Create an issue: `gh issue create --title "..." --body "..."`. Use `--body-file` for a long body.
- Read an issue: `gh issue view <number> --comments`.
- List issues: `gh issue list --state open --json number,title,labels`.
- Comment on an issue: `gh issue comment <number> --body "..."`.
- Close an issue: `gh issue close <number> --comment "..."`.
- Read a pull request: `gh pr view <number> --comments` and `gh pr diff <number>`.

## Rules

- The repository is public. Do not write a secret, a personal name, a host name, a domain or a project id in an issue, a comment or a pull request.
- The issues and pull requests that warden opens on other repositories use the label `warden`. Do not use this label for work on warden itself.
- A bare `#42` can be an issue or a pull request. They share one number space. Run `gh pr view 42`, and if it fails, `gh issue view 42`.
- When a skill says "publish to the issue tracker", create a GitHub issue.
- When a skill says "fetch the relevant ticket", run `gh issue view <number> --comments`.
