# Anonymous E2E Chat — with login gate

## Local setup

1. `npm install`
2. Set a real secret and start the server:
   SITE_SECRET=your-own-secret-here npm start
3. Open http://localhost:8080 in a browser — you'll land on the login page
4. In another terminal, get the current code:
   SITE_SECRET=your-own-secret-here node get-current-code.js
5. Type that 6-digit code into the login page, pick a room name, hit Enter
6. You'll be redirected into the chat

Test with two tabs the same way you did before — both need to log in
separately (each login issues its own one-time ticket).

## How the login gate works

- The "site password" is a 6-digit code derived from SITE_SECRET, and it
  changes every 5 minutes (same idea as Google Authenticator).
- Whoever runs the server tells people the current code (out of band —
  text, Slack, whatever) using get-current-code.js.
- Logging in with the correct code gets you a one-time ticket, valid for
  60 seconds, which chat.html uses to open its WebSocket connection.
- The server deletes the ticket the instant it's used (or the instant it's
  checked and found invalid) — so a ticket can never be reused, and
  chat.html cannot be reached directly without going through login.html
  first, because there is no other way to obtain a ticket.

## Deploying

Same as before (Render), with one addition: set an environment variable
SITE_SECRET on Render (Dashboard -> your service -> Environment) to a
real secret, and use that same value locally with get-current-code.js so
the codes match.
