#!/usr/bin/env node
'use strict';

const express = require('express');
const { registerSafetyRoutes } = require('../server/safety-routes');

function mockPool() {
  return {
    async getConnection() {
      return {
        async execute(sql, params) {
          if (/INSERT INTO sos_events/i.test(sql)) {
            return [{ insertId: 99 }, []];
          }
          if (/safety_settings/i.test(sql)) {
            return [[{ sos_enabled: 1, emergency_phone: '0912345678' }], []];
          }
          if (/user_emergency_contacts/i.test(sql)) {
            return [[], []];
          }
          if (/FROM users/i.test(sql)) {
            return [[{ id: 1, role: 'user' }], []];
          }
          return [[], []];
        },
        release() {}
      };
    }
  };
}

function authenticateToken(req, res, next) {
  req.user = req.headers['x-test-user']
    ? JSON.parse(req.headers['x-test-user'])
    : { username: '0911111111', role: 'user' };
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'forbidden' });
    }
    next();
  };
}

function adminAuth(req, res, next) {
  authenticateToken(req, res, () => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'admin only' });
    }
    next();
  });
}

async function request(app, method, path, { body, headers } = {}) {
  const server = app.listen(0);
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(headers || {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  await new Promise((resolve) => server.close(resolve));
  return { status: res.status, json };
}

async function main() {
  const app = express();
  app.use(express.json());
  registerSafetyRoutes(app, mockPool(), { authenticateToken, requireRole, adminAuth });

  const checks = [];

  async function check(name, fn) {
    try {
      await fn();
      checks.push({ name, ok: true });
      console.log(`✅ ${name}`);
    } catch (err) {
      checks.push({ name, ok: false, err: err.message });
      console.log(`❌ ${name} — ${err.message}`);
    }
  }

  await check('GET /api/safety/settings', async () => {
    const { json } = await request(app, 'GET', '/api/safety/settings');
    if (!json.success || !('sos_enabled' in json.settings)) throw new Error(JSON.stringify(json));
  });

  await check('POST /api/safety/sos requires user', async () => {
    const { status, json } = await request(app, 'POST', '/api/safety/sos', {
      body: { lat: 24.5, lng: 121.5, location_status: 'success' },
      headers: { 'x-test-user': JSON.stringify({ username: '0911111111', role: 'user' }) }
    });
    if (status !== 200 || !json.success) throw new Error(JSON.stringify(json));
  });

  await check('POST /api/safety/sos blocks staff', async () => {
    const { status } = await request(app, 'POST', '/api/safety/sos', {
      body: { lat: 24.5, lng: 121.5, location_status: 'success' },
      headers: { 'x-test-user': JSON.stringify({ username: 'admin', role: 'admin' }) }
    });
    if (status !== 403) throw new Error(`expected 403 got ${status}`);
  });

  await check('Admin facilities requires admin', async () => {
    const { status } = await request(app, 'GET', '/api/admin/safety/facilities', {
      headers: { 'x-test-user': JSON.stringify({ username: '0911111111', role: 'user' }) }
    });
    if (status !== 403) throw new Error(`expected 403 got ${status}`);
  });

  const failed = checks.filter((c) => !c.ok);
  if (failed.length) process.exit(1);
  console.log(`\nAll ${checks.length} safety API checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
