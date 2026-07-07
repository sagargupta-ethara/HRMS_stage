# Test Credentials for Ethara Company Wiki

## Admin
- Email: `admin@ethara.ai`
- Password: `admin123`
- Role: admin

## Admin (Leadership) – also has today's birthday for testing
- Email: `leadership@ethara.ai`
- Password: `Ethara@2026#Secure`
- Role: admin
- DOB: today (set automatically during birthday testing — month/day match)

## HR – also has upcoming birthday (~3 days) for testing
- Email: `hr@ethara.ai`
- Password: `Ethara@2026#Secure`
- Role: hr
- DOB: ~3 days from today

## Notes
- Login endpoint: `POST /api/auth/login` returns `{token, user}`
- Tokens are stored in `sessionStorage` (not localStorage) under key `token`
- All authenticated requests need `Authorization: Bearer <token>`
- Birthday feature notifications fire only after 11:00 AM IST
- New birthday endpoints:
  - `GET /api/birthdays/today`
  - `GET /api/birthdays/upcoming?days=7`
  - `POST /api/birthdays/wish` (body: `{recipient_email, message}`)
  - `GET /api/birthdays/wishes/{email}`
  - `GET /api/birthdays/settings`
  - `PUT /api/birthdays/settings` (admin/hr)
  - `PUT /api/users/{email}/dob` (admin/hr; body: `{dob: "YYYY-MM-DD"}`)
  - `GET /api/notifications`
  - `POST /api/notifications/{notif_id}/dismiss`
