# Legacy Schema Fixtures

The 15 SQL files are unmodified migration fixtures from guide commit
`b110fa955931a7679413662b462e0da28fd96586` (`apps/web/drizzle`, 0000 through 0014).
They construct synthetic legacy databases for the one-way migration tests.
They are not the current database schema, runtime migrations, or application code.

Production persistence and schema upgrades belong to `@information-community/runtime`.
Do not apply these fixtures to a real database.
