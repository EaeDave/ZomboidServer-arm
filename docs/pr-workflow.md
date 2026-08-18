# Fork-first pull request workflow

This repository is maintained from the contributor fork. Pull requests must target the fork by
default, not the original upstream repository.

## Repository roles

| Role | Repository | Default use |
| --- | --- | --- |
| Working fork | `EaeDave/ZomboidServer-arm` | Push branches and open PRs here |
| Upstream | `kaanzapkinus/ZomboidServer-arm` | Read, compare, and synchronize from here |

## Routing rule

1. Push the feature branch to `EaeDave/ZomboidServer-arm`.
2. Open the PR in `EaeDave/ZomboidServer-arm` with base `main`.
3. Open a PR in `kaanzapkinus/ZomboidServer-arm` only when the user explicitly requests an
   upstream PR or names the upstream repository as the target.
4. Never infer the PR destination from the name of a Git remote, from the repository shown by a
   GitHub tool, or from the upstream project's default branch.
5. Before creating the PR, verify both the repository owner and base branch in the final creation
   request.

The default target is therefore:

```text
Repository: EaeDave/ZomboidServer-arm
Base:       main
Head:       <feature-branch>
```

## Before opening a PR

- Confirm the current branch contains only the intended changes.
- Confirm `git remote -v` shows the fork as the push remote.
- Confirm the fork branch exists and contains the latest commit.
- Review the staged file list; do not include unrelated user files, generated artifacts, saves,
  credentials, binaries, or environment files.
- Run the validations that apply to the changed surface.
- Write the PR body using the template below and mark only checks that actually ran.

## Branch naming

Use a short, descriptive branch name:

- `feat/<subject>` for new behavior;
- `fix/<subject>` for a bug fix;
- `docs/<subject>` for documentation-only changes;
- `chore/<subject>` for maintenance.

## PR body template

Every PR should use these sections. Keep the summary concrete and state operational impact
explicitly.

```markdown
## Summary

- Describe the behavior or change.
- List the important files or subsystems involved.
- State whether production files, services, or data were touched.

## Validation

- [ ] List the focused tests or commands that passed.
- [ ] List the relevant smoke test or UI/CLI verification.
- [ ] List any validation that could not run and why.

## Security review

- [ ] No secrets, saves, SSH keys, binaries, or generated credentials were added.
- [ ] New operations are authenticated, allowlisted, and role-checked where applicable.
- [ ] Destructive actions require explicit confirmation.
- [ ] No public shell, RCON, systemd, or unauthenticated host endpoint was added.

## Deployment

- [ ] Production was not changed during validation, or the exact change is documented.
- [ ] Rollback or migration impact is documented when applicable.
- [ ] Production deployment is separately approved; merging the PR is not deployment approval.
```

## If a PR is opened in the wrong repository

1. Close the incorrectly targeted PR immediately.
2. Keep the branch and commits; do not rewrite work just to change the destination.
3. Push the same head branch to `EaeDave/ZomboidServer-arm` if needed.
4. Recreate the PR in the fork with base `main`.
5. Verify the new PR URL and repository before reporting completion.
