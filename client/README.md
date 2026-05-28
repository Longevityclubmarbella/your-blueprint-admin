# Your Blueprint Client Web App

Mobile-first customer web app for Your Blueprint.

## What it uses

- Supabase Auth for login
- `clients` for the current customer profile
- `blueprint_reports` for the preloaded Blueprint data
- `daily_checkins` for daily tracking
- `uploads` and `lab-results` storage for follow-up blood results

The browser app only contains the Supabase publishable key. Do not add the `service_role` key here.

## Local preview

From the project root:

```bash
python3 -m http.server 8788
```

Open:

```text
http://127.0.0.1:8788/client/
```

## Deployment

This folder can be deployed as a static site on GitHub Pages, Netlify, Vercel static hosting, or Supabase hosting. Keep the admin app separate from the customer-facing app unless both are intentionally published under the same domain.
