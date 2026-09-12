# Context

<!-- Why does this change exist? Link the requirement IDs from docs/PLAN.md §2. -->

Requirements addressed: <!-- e.g. R01–R05 -->

# What changed

<!-- Concrete changes, grouped by module. Describe behaviour, not file names. -->

# Why this approach

<!-- Alternatives considered and why they were rejected. This is the section a
     reviewer learns the most from — do not leave it empty. -->

# Requirement coverage

<!-- One line per requirement, pointing at the implementation. -->

- [ ] `RXX` — `functionName` (`src/path/to/file.js`)

# How to verify

```bash
npm run validate
```

<!-- Plus any command specific to this change, with the expected output. -->

# Evidence

<!-- For changes touching the HubSpot API: paste real console output from the
     sandbox portal. Redact nothing except credentials — record ids are fine and
     prove the calls were real. -->

# Checklist

- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] `npm run verify:requirements` passes
- [ ] No credentials, tokens or `.env` files are committed
- [ ] Commits follow Conventional Commits 1.0.0
- [ ] `docs/PROGRESS.md` updated
- [ ] `docs/REQUIREMENTS_MATRIX.md` updated if coverage changed
