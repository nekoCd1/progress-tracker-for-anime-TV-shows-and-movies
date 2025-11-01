const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// OAuth & JWT
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');
const jwt = require('jsonwebtoken');

const DATA_FILE = path.join(__dirname, 'data.json');
function readData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8') || '{}'); } catch (e) { return {}; }
}
function writeData(d) { fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2)); }

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 4000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-me';

// Simple session for passport; in production use a persistent store
app.use(session({ secret: process.env.SESSION_SECRET || JWT_SECRET, resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());

// Always define serialize/deserialize
passport.serializeUser(function(user, cb) { cb(null, user.id); });
passport.deserializeUser(function(id, cb) { const data = readData(); cb(null, data.users && data.users[id] ? data.users[id] : null); });

// Passport Google strategy
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${BASE_URL}/auth/google/callback`
  }, function(accessToken, refreshToken, profile, cb) {
    // create or update user in data.json
    const data = readData();
    data.users = data.users || {};
    const userId = `google:${profile.id}`;
    const user = { id: userId, provider: 'google', profileId: profile.id, name: (profile.displayName||''), emails: (profile.emails||[]) };
    data.users[userId] = Object.assign(data.users[userId] || {}, user, { updatedAt: Date.now() });
    writeData(data);
    return cb(null, data.users[userId]);
  }));
}

// Passport Microsoft (Azure AD / Entra) OIDC strategy
const OIDCStrategy = require('passport-azure-ad').OIDCStrategy;
if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
  const tenant = process.env.MICROSOFT_TENANT_ID || 'common';
  const identityMetadata = `https://login.microsoftonline.com/${tenant}/v2.0/.well-known/openid-configuration`;
  passport.use(new OIDCStrategy({
    identityMetadata,
    clientID: process.env.MICROSOFT_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    responseType: 'code',
    responseMode: 'query',
    redirectUrl: `${BASE_URL}/auth/microsoft/callback`,
    allowHttpForRedirectUrl: false,
    scope: ['profile','openid','email']
  }, function(iss, sub, profile, accessToken, refreshToken, done) {
    // create or update user
    const data = readData();
    data.users = data.users || {};
    const profileId = (profile && profile.oid) || (profile && profile.sub) || sub;
    const userId = `microsoft:${profileId}`;
    const user = { id: userId, provider: 'microsoft', profileId, name: (profile.displayName||''), emails: (profile && profile._json && profile._json.email) ? [ { value: profile._json.email } ] : [] };
    data.users[userId] = Object.assign(data.users[userId] || {}, user, { updatedAt: Date.now() });
    writeData(data);
    return done(null, data.users[userId]);
  }));
}

// Routes
app.post('/auth/mocklogin', (req, res) => {
  const userId = uuidv4();
  const token = 'mock-token-' + userId;
  const data = readData();
  data.users = data.users || {};
  data.users[userId] = { id: userId, createdAt: Date.now() };
  writeData(data);
  res.json({ ok: true, userId, token });
});

// Start Google OAuth - redirect to Google
app.get('/auth/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return res.status(500).send('Google OAuth not configured');
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

// Callback
app.get('/auth/google/callback', (req, res, next) => {
  passport.authenticate('google', { failureRedirect: '/auth/failure', session: false }, (err, user) => {
    if (err || !user) return res.redirect('/auth/failure');
    // issue JWT
    const token = jwt.sign({ sub: user.id, name: user.name, emails: user.emails }, JWT_SECRET, { expiresIn: '24h' });
    // redirect with token in fragment so extension can capture it
    const redirectUrl = `${BASE_URL}/auth/complete#token=${token}&userId=${encodeURIComponent(user.id)}`;
    return res.redirect(redirectUrl);
  })(req, res, next);
});

// Start Microsoft OAuth - redirect to Microsoft
app.get('/auth/microsoft', (req, res, next) => {
  if (!process.env.MICROSOFT_CLIENT_ID || !process.env.MICROSOFT_CLIENT_SECRET) return res.status(500).send('Microsoft OAuth not configured');
  passport.authenticate('azuread-openidconnect', { prompt: 'select_account' })(req, res, next);
});

// Microsoft callback
app.get('/auth/microsoft/callback', (req, res, next) => {
  passport.authenticate('azuread-openidconnect', { failureRedirect: '/auth/failure', session: false }, (err, user) => {
    if (err || !user) return res.redirect('/auth/failure');
    const token = jwt.sign({ sub: user.id, name: user.name, emails: user.emails }, JWT_SECRET, { expiresIn: '24h' });
    const redirectUrl = `${BASE_URL}/auth/complete#token=${token}&userId=${encodeURIComponent(user.id)}`;
    return res.redirect(redirectUrl);
  })(req, res, next);
});

app.get('/auth/failure', (req, res) => res.status(401).send('Authentication failed'));

// small page for browser flows
app.get('/auth/complete', (req, res) => {
  res.send(`<!doctype html><html><body><h3>Authentication complete</h3><p>You may close this window and return to the extension.</p></body></html>`);
});

// Return user info
app.get('/auth/me', (req, res) => {
  const auth = (req.headers.authorization || '').replace('Bearer ', '');
  if (!auth) return res.status(401).json({ ok: false, message: 'Unauthorized' });
  try {
    const decoded = jwt.verify(auth, JWT_SECRET);
    const data = readData();
    const user = data.users && data.users[decoded.sub] ? data.users[decoded.sub] : null;
    return res.json({ ok: true, user });
  } catch (e) {
    return res.status(401).json({ ok: false, message: 'Invalid token' });
  }
});

// Sync endpoint: accepts an array of items and stores them under the user or returns 401 for missing auth
app.post('/sync', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return res.status(401).json({ ok: false, message: 'Unauthorized: no token' });
  let decoded;
  try { decoded = jwt.verify(token, JWT_SECRET); } catch (e) { return res.status(401).json({ ok: false, message: 'Unauthorized: invalid token' }); }
  const userId = decoded.sub;

  const items = req.body.items || [];
  const data = readData();
  data.store = data.store || {};
  data.store[userId] = data.store[userId] || {};
  items.forEach(item => {
    const key = `${item.platform}:${item.title}`;
    data.store[userId][key] = Object.assign(data.store[userId][key] || {}, item, { lastSynced: Date.now() });
  });
  writeData(data);
  res.json({ ok: true, stored: items.length });
});

app.get('/user/:id/data', (req, res) => {
  const data = readData();
  res.json({ ok: true, data: data.store && data.store[req.params.id] ? data.store[req.params.id] : {} });
});

const PORT_BIND = process.env.PORT || 4000;
app.listen(PORT_BIND, () => console.log('Backend listening on', PORT_BIND));
