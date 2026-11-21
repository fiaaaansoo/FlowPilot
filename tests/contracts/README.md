# Recovery contract fixtures (`flowpilot.recovery/v1`)

Canonical JSON examples of the extension ↔ backend contract. Both implementations validate every file here:

- TypeScript: `packages/shared/src/recovery.contract.test.ts`
- Python: `apps/api/tests/test_contracts.py`

A contract change must update these fixtures, both validators, and bump the contract id if it is not backward compatible.
