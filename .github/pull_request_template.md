## What and why

## How I checked it
- [ ] `npm run check` passes (type check, bundle up to date, core tests)
- [ ] `claude plugin test claude-plugin` passes (if the panel changed)
- [ ] `node scripts/benchmark.ts` keeps Dream 6/6 with 0 false positives, the handoff 10/10 and the telephone 13/13 (if the handoff or Dream changed)
- [ ] a test that fails without this change

Measured numbers (not estimates):
