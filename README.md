# Abra Logistics CRM - HTML Email Delivery

The CRM supports two direct HTML email delivery providers:

- **Email Marketing**: sends through the authorized Gmail account (`abralogisticsupport@gmail.com`).
- **Gmail**: sends through the Gmail API as `abralogisticsupport@gmail.com` using OAuth 2.0.

The selected provider is saved with each campaign. Clicking **Send Email** uses that campaign's selected provider. Both providers send a real multipart/alternative message with `text/plain` and `text/html` parts so Outlook, Gmail, and webmail can render the HTML formatting.

## SMTP environment variables


## Gmail OAuth 2.0 setup

Create an OAuth 2.0 Web application client in Google Cloud for the Gmail account. Add this exact redirect URI:

`http://localhost:3000/api/email/gmail/oauth/callback`

For Render, add the deployed URL instead:

`https://YOUR-RENDER-DOMAIN/api/email/gmail/oauth/callback`

Then set:

- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_USER_EMAIL=abralogisticsupport@gmail.com`
- `GMAIL_REDIRECT_URI`

Start the CRM locally and open Email Marketing → New Campaign → choose **Gmail** → **Authorize Gmail**. Complete Google consent. Google will display a refresh token on the callback page. Put that value into `GMAIL_REFRESH_TOKEN` in the local `.env` and restart the server.

For Render, put the same OAuth credentials and refresh token in the Render environment variables. Do not commit `.env` or the refresh token to GitHub.

## Firebase quota behavior

The direct email-send endpoint does not perform a Firestore read before sending. Campaign/recipient tracking is attempted after the provider accepts the message, so Firestore quota exhaustion does not falsely turn a successful provider send into an email failure.
