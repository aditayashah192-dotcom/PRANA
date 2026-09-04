\# AGENT.md — Phase 2D: Compliance Test Script



Create scripts/test-compliance.ts:

1\. Standalone TypeScript test script executing 5 safety compliance test cases:

&#x20;  - Case 1: All values normal, worker in geofence $\\rightarrow$ Expect SAFE.

&#x20;  - Case 2: $H\_2S > 15\\text{ ppm}$ spike $\\rightarrow$ Expect LOCKOUT.

&#x20;  - Case 3: Depth sensor mismatch (probe not inside manhole) $\\rightarrow$ Expect LOCKOUT.

&#x20;  - Case 4: Missing or null sensor reading $\\rightarrow$ Expect LOCKOUT.

&#x20;  - Case 5: Telemetry outside 50m Haversine radius $\\rightarrow$ Expect LOCKOUT.



STRICT RULE:

\- Output ONLY scripts/test-compliance.ts. Write 100% complete test script code with clear terminal assertions.

\-





Test Fixture Completeness



Whenever a phase or segment creates or modifies a database-backed feature:



\- Do not assume manually seeded database rows exist unless explicitly specified.

\- Every automated test must create or identify its own complete test fixtures.

\- Test fixtures must satisfy all "NOT NULL", foreign-key, CHECK, unique, and other database constraints.

\- Before writing a test INSERT, inspect the current schema/migration and existing application code to determine all required fields and their correct representations.

\- Do not solve test-fixture failures by manually modifying database rows.

\- Do not weaken or alter production schema constraints merely to make tests pass.

\- If a required fixture value cannot be determined from the schema, migrations, existing code, or phase specification, stop and report the ambiguity instead of guessing.

\- Tests must be repeatable from a fresh local database after "supabase db reset"; they must not depend on state left by a previous test run.

\- When a test requires related records, the test must create the complete dependency chain or use an explicitly documented fixture setup.

