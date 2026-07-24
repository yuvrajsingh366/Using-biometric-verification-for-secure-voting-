# EVM — Electronic Voting Machine (Fixed & Final)

## What was fixed

| # | Issue | Fix |
|---|-------|-----|
| 1 | **OTP not generated** | Added `/register` JSON API with `send_otp` step — generates random 6-digit OTP, stores in DB, returns to frontend |
| 2 | **Missing routes** | Added all routes: `logout`, `admin_logout`, `/admin/login`, `/admin/dashboard`, `/admin/add_candidate`, `/admin/delete_candidate`, `/admin/delete_voter`, `/admin/update_settings`, `/admin/toggle_election`, `/admin/reset_election` |
| 3 | **DB schema mismatch** | Rebuilt schema with all required columns: `phone`, `registered_at`, `face_image`, `face_descriptor`, `fingerprint_data` in voters; `party_symbol`, `party_color`, `manifesto`, `symbol_image` in candidates; added `otp_store`, `settings`, `audit_log` tables |
| 4 | **Vote page crash** | Fixed — now passes `settings`, `voter_name`, `candidates` (with all fields) to template |
| 5 | **Admin dashboard crash** | Fixed — passes `settings`, `session.admin_user`, `total_voters`, `total_votes`, `logs`, `candidates`, `voters` |
| 6 | **Session key mismatch** | Standardised to `voter_id`, `voter_name`, `is_admin`, `admin_user` throughout |
| 7 | **Results variable name** | Fixed `total_votes` → `total` to match what template expects |
| 8 | **Duplicate voter check** | Backend blocks duplicate Voter ID and duplicate email at OTP step |
| 9 | **Double-vote protection** | `cast_vote` checks `has_voted` flag before recording vote |
| 10 | **`thank_you` clears session** | Session cleared after vote is confirmed |

---

## Quick Start

### 1. Install dependencies
```bash
pip install flask werkzeug
```

### 2. Run
```bash
python app.py
```

### 3. Open browser
- **Voter portal**: http://127.0.0.1:5000
- **Admin panel**: http://127.0.0.1:5000/admin
  - Username: `admin`
  - Password: `admin123`

---

## Voter Flow

1. **Register** → Fill personal info → Click **Send OTP** → OTP appears on screen (big yellow box) → Click **Use This OTP** → Face biometric → Fingerprint → Done
2. **Login** → Enter Voter ID + Password → (optional face verify) → Redirected to vote page
3. **Vote** → Select candidate → Fingerprint confirm → Vote cast → Thank you page

---

## OTP System

- OTP is **randomly generated** (6 digits) server-side using `random.choices(string.digits)`
- Stored securely in `otp_store` table (per email, expires on use)
- Displayed on-screen immediately in a large yellow box (no email server needed)
- If SMTP environment variables are set, also sends to email inbox:
  ```
  SMTP_HOST=smtp.gmail.com
  SMTP_USER=yourmail@gmail.com
  SMTP_PASS=your_app_password
  ```

---

## Admin Features

- Add/remove candidates (with symbol image upload)
- View all registered voters
- Live results with donut chart
- Full audit log (all logins, votes, admin actions)
- Election settings (name, date)
- Pause/resume election
- Reset all votes (danger zone)

---

## Database Tables

| Table | Purpose |
|-------|---------|
| `voters` | Registered voters with biometric data |
| `candidates` | Election candidates |
| `otp_store` | Temporary OTP storage (cleared after use) |
| `settings` | Election configuration |
| `audit_log` | Immutable event log |
