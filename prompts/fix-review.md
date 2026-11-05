# Review your change before the final message

This part applies only to a run that gives action `pr` or `pr-update`.
Do these two passes in this order after your last edit. Do the cleanup first. Never do it in place of the review.

The repository can have its own copy of a skill in `.agents/skills/<name>/SKILL.md` or `.claude/skills/<name>/SKILL.md`, with the name `deslop` or `pr-review`.
If a copy exists, read it and follow it for the matching pass. Skip each step in it that needs a tool that you do not have.

The target of both passes is the uncommitted change: `git diff` and `git status` against `HEAD`.

## Tools that you do not have

You cannot run `gh`, fetch a web page, install packages, run tests, start the app, or make a worktree.
Do not try. Do not claim that you did these things.

- For a claim about a dependency, cite a file in the repository or in `node_modules` if it exists. If you cannot cite it, list it as uncertain.
- For tests, add or change the test in the file where the sibling tests are. Name it in the body. The tester runs it after the run.

## Pass 1: cleanup (deslop)

Make no change to the behavior. Examine each changed hunk for these items:

1. A comment that a maintainer would not write: narration, an explanation of the syntax, or text that restates the code. A comment must state a reason.
2. A defensive check or a `try`/`catch` block that is not normal for the module, or that protects only a state that cannot occur.
3. A cast that launders a type, for example `as any` or `as unknown as T`. Do not add a cast.
4. A redundant variable, or a helper with one use, that adds no meaning.
5. A shim, an alias, a retry or a fallback branch with no clear reason.
6. A name, a control flow, an import form or a format that is different from the file around it. Match that file.

Fix an item when the fix is small and keeps the behavior. Otherwise, list it for the reviewer.

## Pass 2: review (pr-review)

Do each check. Read each changed file in full, not only the hunks.

1. Reuse. For each function, constant, type and pattern that you added, search the repository for one that already exists.
   Use the existing one. If you added a new helper, put it next to its siblings and give it the same form.
2. Data in code. Find each value that your code sends to telemetry, a log, an error tracker or a response.
   It must not hold a raw error, a query, request data or user data. Use the redaction helper of the repository.
   If the repository has no such helper, do not write one. Use action `issue` in place of `pr`.
3. Dependencies. For each call into a library or a framework, cite what it returns, throws or swallows. Ask what it does in the cases that your change does not handle.
4. Siblings. Search for each string, constant and pattern that you changed. If the same defect is in a different place, fix it there too, or name it in the body.
5. Callers. List each caller of each changed exported function. Say how your change affects each caller.
6. Old against new. For each replaced expression, give the old code and the new code the same edge values (`0`, empty, unset, `null`). A different result is a defect, unless the body states it.
   Each new `catch` that does not rethrow must log the error or state why not. A swallowed error with no trace is a defect.
7. Tests. Each behavior change needs a test. Put it in the test file of the sibling code.
8. Rules. Check the change against each rule in the `AGENTS.md` and `CLAUDE.md` files that you read, and against the privacy rule of this prompt.
9. The body. Each claim in the body must be true for the change in the checkout.

Before you keep a finding, try to prove it wrong. Fix each finding that you can fix safely. Then do Pass 2 again on the lines that you changed.

## In the body

End the body with a section `## Review` with:

- One line for each check above that found something, and what you did.
- Each item that you did not fix, with the file and the line.
- What a person must run before the merge, for example the typecheck or the lint.

If a finding is high and you cannot fix it, use action `issue` in place of `pr`.
