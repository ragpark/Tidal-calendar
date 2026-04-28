# Club Group Membership Design Proposal (Privacy-first)

## Problem with current flow

Current implementation allows a club admin to pick from a broad list of users that are not yet in the club. That creates unnecessary exposure of personal data (email addresses) and does not provide a consent-based join process.

## Goals

1. Let the right people join a club quickly.
2. Avoid exposing global user directories to club admins.
3. Preserve role-based authorization and auditability.
4. Support both admin-initiated and user-initiated membership.
5. Align with common privacy principles (data minimization, purpose limitation, explicit user action).

## Proposed model: Invite + Request + Verified Domain

Use three complementary paths to join a club:

### A) Admin-generated invite links (default path)

- Club admin creates an invite from **Club > Members > Invite**.
- Invite options:
  - role on join (member only)
  - expiry (e.g., 48h / 7d)
  - max uses (1 for individual invite, N for batch)
- Server generates a secure token (random 256-bit, stored as hash).
- Admin shares link out-of-band (email/WhatsApp/noticeboard).
- Recipient signs in (or creates account), opens link, confirms join.
- Server validates token + expiry + usage + club scope, then creates membership.

**Why this helps:** admin never sees unrelated users; only people with invite link can join.

### B) User “request to join” (consent-first path)

- User searches/selects a club (public club directory can be name + coarse location only).
- User submits join request with optional note.
- Club admin sees a queue of pending requests and can approve/reject.
- On approval, membership is created; on rejection, request closes with reason.

**Why this helps:** users can initiate membership without admin browsing user lists.

### C) Optional verified-domain auto-approval (enterprise clubs)

- Club admin verifies control of domain (e.g., `@myclub.org`) via DNS TXT.
- Policy option: auto-approve users registering with verified domain.
- Still creates audit event and sends confirmation.

**Why this helps:** removes friction for trusted organizations while keeping controls.

## Security architecture

## 1) Data model additions

- `club_invites`
  - `id`, `club_id`, `token_hash`, `created_by`, `expires_at`, `max_uses`, `used_count`, `revoked_at`, `created_at`
- `club_join_requests`
  - `id`, `club_id`, `user_id`, `status` (`pending|approved|rejected|cancelled`), `note`, `reviewed_by`, `reviewed_at`, `created_at`
- `membership_audit_log`
  - `id`, `club_id`, `actor_user_id`, `target_user_id`, `action` (`invite_created|invite_revoked|invite_used|request_submitted|request_approved|member_removed`), `metadata`, `created_at`

Keep existing `club_memberships` as source of truth for active membership.

## 2) API and authorization rules

- `POST /api/club-admin/invites` (club_admin only for own club)
- `GET /api/club-admin/invites` (masked token display; no raw token after creation)
- `POST /api/club/invites/:token/accept` (authenticated user)
- `POST /api/clubs/:clubId/join-requests` (authenticated user)
- `GET /api/club-admin/join-requests` (club_admin only)
- `POST /api/club-admin/join-requests/:id/approve`
- `POST /api/club-admin/join-requests/:id/reject`

Authorization invariants:

- Club admins can only manage invites/requests for their own club.
- Users can only accept invites for themselves.
- Membership writes are transaction-protected and idempotent.
- Never return global user lists to club-admin endpoints.

## 3) Token and abuse controls

- Invite token format: opaque random string (not JWT), hash with SHA-256 in DB.
- Constant-time hash comparison on accept.
- Short TTL and usage limits.
- Rate-limit invite acceptance and join requests per IP + user.
- Add CAPTCHA only if abuse threshold is crossed.
- Revoke all outstanding invites when admin account is compromised.

## 4) Privacy by design

- Remove `availableUsers` concept from club admin UI/API.
- Data minimization:
  - admin sees only pending request profile: email + display name (if any).
  - no searchable directory of non-members.
- Purpose limitation:
  - membership data used only for club operations and booking.
- Retention:
  - auto-delete expired invites after 30 days.
  - archive/rotate old audit events per policy.
- DSAR readiness:
  - all membership events attributable and exportable.

## UX changes

### Club admin page

Replace “Select calendar user” dropdown with:

1. **Create invite link** button + invite table (status, expiry, uses, revoke).
2. **Pending join requests** panel (approve/reject).
3. Existing member list remains.

### User side

Add:

- **Join a club** section in profile:
  - “Enter invite code/link”
  - “Find club and request to join”
- Clear confirmation text before membership change.

## Migration plan

1. Add new tables + indexes.
2. Ship new endpoints behind feature flag `club_membership_v2`.
3. Update frontend to hide old dropdown when flag enabled.
4. Soft-deprecate old `/api/club-admin/overview.availableUsers` and `/api/club-admin/members` direct add-by-userId path.
5. After adoption window, remove old behavior and backfill telemetry dashboards.

## Compliance notes (non-legal advice)

- This model better supports GDPR/UK GDPR principles:
  - data minimization (no full user list exposure)
  - integrity/confidentiality (scoped auth + token controls)
  - accountability (audit logs)
- For CCPA/CPRA-style expectations, this reduces internal over-sharing and improves access traceability.
- Keep Records of Processing Activities updated for membership workflows.

## Success metrics

- 0 endpoints returning non-member global user lists to club admins.
- >90% membership additions via invite/request flows.
- Mean join completion time < 2 minutes (invite flow).
- No increase in unauthorized membership incidents.
