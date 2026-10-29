# House Rent Manager — Private tenant sharing edition

Responsive HTML/CSS/vanilla JavaScript rent collection app using Supabase Auth + PostgreSQL and GitHub Pages.

## Features
- Landlord login and dashboard for rental units, tenants, rent collection, reports and CSV export.
- Tenant does **not** need an account or password to view a statement.
- From the Tenants page, click **Share private link** to create a unique link and open WhatsApp with a prepared message. Review and press Send yourself.
- Each private link shows only that tenant's active unit, monthly rent, payment history, due amount, arrears and printable receipts.
- Creating a new link automatically revokes the previous link for that tenant. Use **Revoke link** beside the tenant to disable it without creating a replacement.
- Tokens are high-entropy random values; only SHA-256 hashes are stored in Supabase. Anonymous users cannot select directly from tenant/unit/payment tables through this feature.

## Project files
- `index.html` — app layout and public shared statement view
- `styles.css` — responsive styling
- `app.js` — landlord authentication/dashboard and token-based public view
- `config.js` — Supabase URL and public anon/publishable key
- `schema.sql` — role/RLS setup plus secure share-link RPCs

## Setup
1. Back up your database before changing an existing Supabase project.
2. Open Supabase Dashboard → SQL Editor and run `schema.sql`. The script assumes your existing app tables `tenants`, `rental_units`, and `rent_payments` are already present.
3. Promote your existing landlord login. The email below is the configured owner email in this project; change it if you use another login.
   ```sql
   update public.profiles p
   set role = 'landlord'
   from auth.users u
   where p.user_id = u.id
     and u.email = 'samsung.bd.galaxy2@gmail.com';
   ```
4. Edit `config.js` and put your Supabase Project URL and **public anon/publishable key**. Never put the `service_role` or secret key in browser code.
5. Upload all project files to your GitHub repository, replacing `index.html`, `styles.css`, `app.js`, `schema.sql`, and `README.md`. Keep your real configured `config.js` values. Commit and wait for GitHub Pages to redeploy.
6. In Supabase → Authentication → URL Configuration, set the Site URL and Redirect URL to `https://sambd-droid.github.io/house-rent-manager/`.
7. Sign in as the landlord, add tenant records, assign them to active rental units, and record payments. Use **Share private link** on the Tenants page.

## Revoke a tenant link
On the Tenants page, click **Revoke link** and confirm. This disables the current link without replacing it. Clicking **Share private link** later creates a new link and also revokes any prior active link for that tenant.

## Security notes
- Anyone who possesses a tenant's private URL can view that tenant's statement; the URL is a bearer secret and can be forwarded. Share it only with the intended tenant.
- Creating a new link revokes the previous link for that tenant.
- The public RPC returns a deliberately limited set of fields and never returns tenant phone/email, landlord user ID, or other tenants' data.
- Keep Supabase Row Level Security enabled. Never expose the service-role key.
- Test with two tenants and verify each unique link returns only its own unit and payment history before using it with real tenant information.

## Notes
- Arrears are calculated using the current monthly rent for each month since lease start. This starter app does not preserve historical rent changes.
- WhatsApp does not send automatically; you review and send the prepared message.
- Printable receipts open a browser print dialog; choose “Save as PDF” to save a PDF copy.
