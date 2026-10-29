# House Rent Manager — Tenant sharing edition

Responsive HTML/CSS/vanilla JavaScript app using Supabase Auth + PostgreSQL and GitHub Pages.

## Added tenant sharing
- Landlord/admin dashboard stays separate from tenant portal.
- Tenants sign in using Supabase email/password authentication.
- Tenant portal displays only the linked unit, rent, due amount, arrears, payment history and receipt details.
- WhatsApp share actions create pre-filled messages for statements and payment receipts. They do not send messages automatically; the user reviews and sends in WhatsApp.
- A shared website link does not expose private data. Tenants must sign in.

## Files
- `index.html` — landlord UI and tenant portal
- `styles.css` — responsive styling
- `app.js` — auth, landlord and tenant flows, WhatsApp message creation
- `config.js` — Supabase URL and public anon/publishable key
- `schema.sql` — upgrade SQL for profiles, tenant linking, RLS and ownership guard

## Upgrade an existing deployment
1. Back up your Supabase data.
2. Open Supabase Dashboard → SQL Editor.
3. Run the updated `schema.sql` on your existing project.
4. In SQL Editor, promote the landlord account. Replace the email with the landlord login email and run:
   ```sql
   update public.profiles p
   set role = 'landlord'
   from auth.users u
   where p.user_id = u.id
     and u.email = 'YOUR-LANDLORD-EMAIL@example.com';
   ```
5. Add the tenant portal files to your GitHub repository, replacing `index.html`, `styles.css`, `app.js`, `schema.sql`, and `README.md`. Keep your configured `config.js` unchanged.
6. Commit the changes and wait for GitHub Pages to redeploy.
7. In Supabase Authentication → URL Configuration, ensure the Site URL and Redirect URL include:
   `https://sambd-droid.github.io/house-rent-manager/`

## Invite/link a tenant account
1. Ask the tenant to create an account on the same website using their own email and password. New accounts default to the `tenant` role; do not promote them to landlord.
2. In Supabase SQL Editor, link their Auth account to their tenant record. Use the exact email stored in the landlord's tenant record and the email the tenant uses to log in:
   ```sql
   update public.tenants t
   set auth_user_id = u.id
   from auth.users u
   where t.email = 'TENANT-EMAIL-STORED-IN-TENANT-RECORD@example.com'
     and u.email = 'TENANT-LOGIN-EMAIL@example.com'
     and t.user_id = (
       select id from auth.users
       where email = 'YOUR-LANDLORD-EMAIL@example.com'
     );
   ```
   If tenant's contact email is blank or different, use the tenant row ID instead, ensuring it belongs to your landlord account:
   ```sql
   update public.tenants
   set auth_user_id = (select id from auth.users where email = 'TENANT-LOGIN-EMAIL@example.com')
   where id = 'TENANT-RECORD-UUID'
     and user_id = (select id from auth.users where email = 'YOUR-LANDLORD-EMAIL@example.com');
   ```
3. Confirm that the tenant record is assigned to the correct rental unit.
4. The tenant can now sign in and see only the linked records.

## WhatsApp sharing
- From the landlord dashboard, use a tenant's Share statement action to open WhatsApp with a statement message. Select the tenant/contact and press Send.
- From a payment receipt, use Share on WhatsApp to prepare a receipt summary message.
- The message includes the site URL, not a bypass link. Tenants still need their own login to view the portal.
- For a printable/PDF receipt, open the receipt and use Print receipt, choose Save as PDF, then attach the PDF to WhatsApp manually. Browsers do not permit websites to silently attach files to WhatsApp.

## Security design
- New Auth accounts default to `tenant`; manually promote only the landlord account to `landlord` using SQL.
- RLS policies restrict landlord data to rows owned by their account.
- Tenants can read only their linked tenant row, assigned unit(s), and payments linked to that tenant.
- Tenants cannot insert/update/delete rent, unit or tenant records.
- The public Supabase anon/publishable key may be used in `config.js` only because RLS is enabled. Never expose a service-role/secret key.
- The `profiles` table's role must only be changed by a trusted Supabase administrator. Do not create a public policy allowing users to update their own role.

## Notes
- Monthly arrears use the current rent amount for each month from lease start through selected month. This starter app does not preserve historical rent changes.
- Payment records are entered by the landlord. WhatsApp sharing is manual; this does not integrate direct bKash/Nagad collection.
- Before using with sensitive tenant information, test using one landlord account and two tenant accounts and confirm neither tenant can see the other's records.
