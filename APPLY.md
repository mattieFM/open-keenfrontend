# CI lockfile self-test fix

This overlay changes only `scripts/release-pipeline-self-test.mjs`.

From the repository root, either apply the accompanying `.patch`, or copy the
`scripts/` directory from this archive over the repository's `scripts/`
directory.

Then run:

```bash
npm run validate:release-workflow
npm run test:release
```

The self-test now creates isolated fixtures for both dependency-install states:
no lockfile and an existing `package-lock.json`. It therefore produces the same
result before and after the workflow's dependency installation step.
