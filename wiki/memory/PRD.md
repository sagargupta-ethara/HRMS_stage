# Company Wiki - Product Requirements Document

## Original Problem Statement
Build a dynamic, user-controlled, login-based, and editable company wiki that can run locally and merge cleanly into a larger HRMS platform.

## Visual Identity (Ethara.ai)
- **Background**: Pure black/charcoal (#09090b)
- **Cards**: Dark zinc (#111113) with subtle borders (#27272a)
- **Primary accent**: Deep purple (#a78bfa), hover (#8b5cf6), deep (#6d28d9)
- **Typography**: White (#fafafa) headings (Manrope), muted (#a1a1aa) body (Inter)
- **Style**: Minimalistic, research-first, futuristic but professional, high-trust
- **Effects**: Subtle purple glow on hover, gradient borders, noise texture overlay

## Architecture
- Frontend: React + Tailwind + Framer Motion + Sonner + DOMPurify
- Backend: FastAPI
- Storage: local JSON document store
## What's Been Implemented
- Full auth system (sessionStorage tokens, generic errors, XSS protection)
- **Ethara.ai-branded dark theme**: black/purple palette across all pages
- Wiki CRUD with categories, feedback section, FAQ page
- Grievance Portal, Holiday Calendar, Secure PDF viewers
- Analytics Dashboard with advanced filters/sorting/CSV export
- Code review fixes: DOMPurify, useCallback, no console.log, stable keys
- **Employee Birthday Notifications** (Feb 2026):
  - Notification Bell with 60s polling + badge count (fires only after 11:00 AM IST)
  - Birthday Spotlight widget on Dashboard: animated balloons, confetti, gradient cards, fun taglines, wish counter, "Send a wish" modal
  - Upcoming birthdays list (configurable window, default 7 days)
  - DOB Prompt modal for users without birthday on file (one-shot per session)
  - HR/Admin "Birthdays" page (`/admin/birthdays`): enable/disable toggle, upcoming-window config, coverage stat, bulk DOB editor
  - **Company Birthday Roster (460 employees)** ingested from HR Excel sheet — stored in `employee_roster` collection, keyed by `ecode`, drives all notifications. Roster stats panel with monthly bar chart on HR settings page.
  - Backend: pytz Asia/Kolkata, collections `employee_roster`, `birthday_settings`, `birthday_wishes`, `dismissed_notifications`
  - New endpoints: `/api/birthdays/{today,upcoming,wish,wishes,settings,roster,roster/stats}`, `/api/users/{email}/dob`, `/api/notifications`, `/api/notifications/{id}/dismiss`
  - Importer: `python -m scripts.import_roster` (reads `/tmp/dob.xlsx`)

## Upcoming Tasks
### P1
- Add Redis Caching

### P2
- Backend Refactoring (split server.py)
- Component splitting (WikiPage, AnalyticsDashboard)

### P3
- Exportable Analytics Reports
