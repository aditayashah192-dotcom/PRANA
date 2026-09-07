PROJECT PRANA — CONTRACTOR ADMIN: ASSIGN FIELD SUPERVISOR

Implement ONLY the missing Contractor Admin workflow for assigning a Field Supervisor to a workzone.

IMPORTANT:
The backend `assign_field_supervisor()` SECURITY DEFINER RPC was previously implemented. Reuse it. Do NOT create a duplicate RPC, duplicate assignment table, or alternate authorization path.

FIRST inspect the current implementation and existing Contractor Admin dashboard to understand what already exists.

Required workflow:

Contractor Admin
→ sees their contractor's workzones
→ selects a workzone
→ `ASSIGN FIELD SUPERVISOR`
→ sees eligible Field Supervisors from the SAME contractor
→ selects one
→ assignment is performed through existing `assign_field_supervisor()`
→ UI confirms success
→ assigned supervisor is displayed
→ Field Supervisor subsequently sees the assigned workzone

Security requirements:
- Contractor Admin only.
- Caller must be authorized server-side.
- Field Supervisor must belong to the SAME contractor as the workzone.
- Cannot assign another contractor's Field Supervisor.
- Cannot assign arbitrary users/non-field-supervisors.
- Do not trust client-side role/tenant checks.
- Do not use service-role credentials in the browser.
- Preserve existing RLS and SECURITY DEFINER authorization.
- Do not weaken any existing policies.

UI:
- Add an obvious `ASSIGN FIELD SUPERVISOR` control to the existing Contractor Admin workzone UI.
- Make the assignment workzone-specific.
- Show ONLY eligible Field Supervisors belonging to the Contractor Admin's contractor.
- Show the currently assigned supervisor if one exists.
- If the existing RPC supports reassignment, expose reassignment appropriately; otherwise do not invent new semantics.
- Show clear success/error states.
- Follow the existing Project Prana industrial/utility UI style.
- Do not redesign the dashboard.

Tests:
- Contractor Admin can assign a same-contractor Field Supervisor.
- Contractor Admin cannot assign a Field Supervisor from another contractor.
- Contractor Admin cannot assign a non-field-supervisor user.
- Non-Contractor-Admin cannot perform the assignment.
- Assigned Field Supervisor sees the workzone.
- Other/unassigned Field Supervisor does not see it.
- Existing RLS/security tests remain passing.

Run:
- `tsc`
- build
- existing Contractor Admin tests
- existing Field Supervisor/RLS tests
- any focused test needed for the new UI flow

Manual verification:
1. Login as Contractor Admin.
2. Open Contractor dashboard.
3. Select a workzone.
4. Click `ASSIGN FIELD SUPERVISOR`.
5. Select the appropriate same-contractor Field Supervisor.
6. Confirm assignment.
7. Login as that Field Supervisor.
8. Confirm the workzone appears.
9. Confirm another Field Supervisor cannot see the unassigned workzone.

SCOPE CONTROL:
DO NOT TOUCH:
- authentication/session/middleware
- Government Auditor workzone creation/allocation
- PayPal
- hash-chain verifier
- permit issuance
- lockout/escalation
- telemetry safety logic
- unrelated dashboards/features

Do not modify the existing backend authorization unless inspection proves it is actually incorrect.

Do not commit.

Final report:
1. What already existed
2. What was missing
3. Files changed
4. Tests/results
5. Manual verification result
6. Any remaining gap