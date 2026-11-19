## Summary

What changed and why.

## Type

- [ ] Agent manifest
- [ ] Patch rule / canonical string
- [ ] Shim backend
- [ ] CLI / installer
- [ ] Documentation
- [ ] Tests only

## Verification

- [ ] `npm test`
- [ ] `npm run check`
- [ ] `node bin/harness.mjs install --agent <id> --dry-run`
- [ ] Tested against VS Code 1.147.x (state version/commit if applicable)

Patched files changed:

```
```

## Safety

- [ ] Backups still written before the first write
- [ ] A failed rule still prevents all writes
- [ ] Checksums go through `updateChecksums()`
- [ ] No absolute user paths, secrets, or logs committed

## Notes for reviewers

Anything subtle about anchors, idempotency, or agent-specific behavior.
