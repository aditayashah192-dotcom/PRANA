\# AGENT.md — Phase 1C: Ingest Test Script



\# AGENT.md — Phase 1D: ESP32 Firmware



Create firmware/esp32\_prana.ino:

1\. Complete C++ Arduino/ESP32 sketch.

2\. Configured for gas reading sampling ($H\_2S$, $O\_2$), ultrasonic depth, and battery level.

3\. Implements HMAC SHA-256 payload signing using mbedtls/md.h before HTTP POST transmission.

4\. Includes heartbeat loop and local memory ring buffer array for offline caching when Wi-Fi is unavailable.



STRICT RULE:

\- Output ONLY firmware/esp32\_prana.ino. Write full C++ firmware code.

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

