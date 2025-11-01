# progress-tracker-for-anime-TV-shows-and-movies

This repo contains a Chrome extension prototype and a lightweight Node.js backend for tracking live watch progress across streaming platforms and syncing it across devices.

Quick setup for Render deployment

1. Create a Render Web Service and connect this repository. Set the Root Directory to `server` and use `npm start` as the start command.
2. In the Render dashboard, add the following Environment Variables to the service:
	- `BASE_URL` = https://progress-tracker-for-anime-tv-shows-and.onrender.com
	- `GOOGLE_CLIENT_ID` = (from Google Cloud Console)
	- `GOOGLE_CLIENT_SECRET` = (from Google Cloud Console)
	- `MICROSOFT_CLIENT_ID` = (from Azure App Registration)
	- `MICROSOFT_CLIENT_SECRET` = (from Azure App Registration)
	- `JWT_SECRET` = (generate with `openssl rand -hex 32`)
3. Redeploy the Render service. The server will expose OAuth endpoints at `/auth/google` and `/auth/microsoft` and will issue JWTs on successful login.

Local testing

You can test locally by running the server and registering redirect URIs using `http://localhost:4000`:

```bash
cd server
npm install
BASE_URL=http://localhost:4000 JWT_SECRET=yoursecret npm start
```

Then set the extension popup Backend URL to `http://localhost:4000` and use the Login buttons to authenticate.
