# House Rent Manager

A responsive rental management web app built with HTML, CSS and vanilla JavaScript. It uses Supabase Auth and PostgreSQL for online persistence and GitHub Pages for static hosting.

## Features

- Email/password account registration and sign-in
- Row-level security (RLS): users can access only their own tenants, units and payments
- Rental units with individual monthly rent, lease start date, occupancy and active status
- Tenant contact records
- Full and partial rent payments, assigned to a specific rent month
- Payment methods: cash, bank transfer, bKash, Nagad, Rocket and other
- Receipt number, printable receipts and Save as PDF through the browser print dialog
- Monthly dashboard, expected/collected/due rent, accumulated arrears and CSV export
- Responsive layout for desktop and mobile

## Files

- `index.html` — application structure
- `styles.css` — responsive styling
- `app.js` — app logic
- `config.js` — Supabase project URL and public anon/publishable key
- `schema.sql` — database tables, indexes, RLS policies and ownership guard

## 1. Create the Supabase project

1. Open https://supabase.com/ and create a project.
2. In the project dashboard, open **SQL Editor**.
3. Paste all contents of `schema.sql` and run it.
4. In **Project Settings → API** (the exact menu may vary), copy the Project URL and the public `anon` / publishable key.
5. Edit `config.js`:
   - Set `SUPABASE_URL` to your project URL.
   - Set `SUPABASE_ANON_KEY` to the public anon/publishable key.
6. Never put a `service_role` or secret key in browser code. The public key is only safe with correctly configured RLS.

## 2. Configure authentication

1. In Supabase, open **Authentication → URL Configuration**.
2. Add your GitHub Pages URL to **Site URL** and **Redirect URLs**. For example:
   - `https://YOUR-GITHUB-USERNAME.github.io/house-rent-manager/`
3. Under **Authentication → Providers**, make sure Email is enabled.
4. Decide whether to require email confirmation. If enabled, users must confirm their email before signing in. Configure SMTP for reliable production email delivery if needed.
5. The app uses email/password authentication. Passwords are handled by Supabase Auth, not stored in this website's tables.

## 3. Deploy with GitHub Pages

1. Create a GitHub repository, for example `house-rent-manager`.
2. Upload `index.html`, `styles.css`, `app.js`, `config.js`, `schema.sql`, and `README.md` to the repository root.
3. Commit the changes.
4. In the repository, open **Settings → Pages**.
5. Under build/deployment, choose **Deploy from a branch**, select `main` and `/ (root)`, then save.
6. Wait for the Pages deployment to finish. Open the published URL shown in Settings → Pages.
7. Add that exact URL to Supabase Auth's allowed redirect URLs and Site URL.

You can also use GitHub's web UI: **Add file → Upload files**. Do not upload secret keys. `config.js` contains only the public client key.

## 4. How to use

1. Create an account and sign in.
2. Add tenant records in **Tenants**.
3. Add each flat/room/shop in **Rental units**, set its monthly rent and lease start, and assign its tenant.
4. Open **Rent collection → Record payment**. Select the unit, rent month, amount, date and method.
5. Save the payment to store it online and open a receipt. Use **Print receipt** and choose a printer or “Save as PDF”.
6. Choose a month in Dashboard or Reports to view expected rent, collections and unpaid balances. Use Export CSV for a spreadsheet.

## Important behavior and limitations

- Each payment is assigned to one rent month. For a payment that covers several months, record separate payments for each month.
- A partial payment reduces that month's due. Overpayments are recorded as payments, but due is never shown below zero; this app does not automatically carry a credit into another month.
- Arrears are calculated as monthly rent minus recorded payments for every month from the lease-start month through the selected report month. Changing a unit's rent updates the calculation for historical months too; this starter app does not keep a rent-change history.
- Unit/tenant deletion is intentionally constrained by linked records. Avoid deleting a unit that has payment history.
- This starter is not a tax/accounting system and does not send automated reminders or collect money directly through bKash/Nagad. It records those payment methods.
- The browser loads Supabase JS and fonts from CDNs, so an internet connection is required.
- Keep your GitHub repository and account secure. Use a strong password and enable multi-factor authentication on GitHub and Supabase.

## Security notes

- All three data tables enable PostgreSQL Row Level Security.
- Policies restrict access to rows whose `user_id` matches the authenticated user.
- The SQL includes ownership checks for a unit's assigned tenant and payment references.
- Do not remove or bypass RLS. Do not add a Supabase service-role key to `config.js`.
- If this will be used for real tenant/NID documents or a commercial property business, arrange a security review and backups before relying on it for important records.

## Troubleshooting

- **Setup needed message:** check that both values in `config.js` are real, with no placeholder text.
- **Permission denied / RLS error:** rerun `schema.sql` and verify you're signed in to the correct Supabase project.
- **Can't sign in after signup:** if email confirmation is enabled, confirm the email first.
- **Site loads but data doesn't:** check browser devtools Console and Supabase logs; verify the Pages URL is allowed in Auth URL Configuration.
- **GitHub Pages 404:** confirm `index.html` is in the selected branch and folder and wait a few minutes after saving Pages settings.
