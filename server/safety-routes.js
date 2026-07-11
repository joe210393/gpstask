'use strict';

const FACILITY_TYPES = ['medical', 'water', 'supply'];
const SOS_STATUSES = ['pending', 'handling', 'resolved'];
const LOCATION_STATUSES = ['success', 'failed', 'denied'];

function parseJsonField(value, fallback = null) {
  if (value == null) return fallback;
  if (Array.isArray(value) || typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeSupplies(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map((item) => String(item).trim()).filter(Boolean);
  }
  return [];
}

function mapFacilityRow(row) {
  return {
    ...row,
    is_active: row.is_active === 1 || row.is_active === true,
    supplies: parseJsonField(row.supplies, [])
  };
}

function mapSosRow(row) {
  return {
    ...row,
    emergency_contacts_snapshot: parseJsonField(row.emergency_contacts_snapshot, [])
  };
}

function registerSafetyRoutes(app, pool, { authenticateToken, requireRole, adminAuth }) {
  async function getUserId(username) {
    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.execute('SELECT id, role FROM users WHERE username = ?', [username]);
      return rows[0] || null;
    } finally {
      conn.release();
    }
  }

  async function getEmergencyContactsSnapshot(userId) {
    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.execute(
        `SELECT name, phone, sort_order FROM user_emergency_contacts
         WHERE user_id = ? ORDER BY sort_order ASC`,
        [userId]
      );
      return rows;
    } finally {
      conn.release();
    }
  }

  // ===== Public =====
  app.get('/api/safety/facilities', async (req, res) => {
    let conn;
    try {
      conn = await pool.getConnection();
      const type = req.query.type;
      let sql = `SELECT id, facility_type, name, lat, lng, description, supplies, open_hours, notes, sort_order
                 FROM safety_facilities WHERE is_active = 1`;
      const params = [];
      if (type && FACILITY_TYPES.includes(type)) {
        sql += ' AND facility_type = ?';
        params.push(type);
      }
      sql += ' ORDER BY sort_order ASC, id ASC';
      const [rows] = await conn.execute(sql, params);
      res.json({ success: true, facilities: rows.map(mapFacilityRow) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: '伺服器錯誤' });
    } finally {
      if (conn) conn.release();
    }
  });

  app.get('/api/safety/settings', async (req, res) => {
    let conn;
    try {
      conn = await pool.getConnection();
      const [rows] = await conn.execute(
        'SELECT sos_enabled, emergency_phone, sos_instructions FROM safety_settings WHERE id = 1'
      );
      const settings = rows[0] || {
        sos_enabled: 1,
        emergency_phone: null,
        sos_instructions: null
      };
      res.json({
        success: true,
        settings: {
          sos_enabled: settings.sos_enabled === 1 || settings.sos_enabled === true,
          emergency_phone: settings.emergency_phone || '',
          sos_instructions: settings.sos_instructions || ''
        }
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: '伺服器錯誤' });
    } finally {
      if (conn) conn.release();
    }
  });

  // ===== User emergency contacts =====
  app.get('/api/user/emergency-contacts', authenticateToken, requireRole('user'), async (req, res) => {
    let conn;
    try {
      const user = await getUserId(req.user.username);
      if (!user) return res.status(401).json({ success: false, message: '用戶不存在' });
      conn = await pool.getConnection();
      const [rows] = await conn.execute(
        `SELECT name, phone, sort_order FROM user_emergency_contacts
         WHERE user_id = ? ORDER BY sort_order ASC`,
        [user.id]
      );
      res.json({ success: true, contacts: rows });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: '伺服器錯誤' });
    } finally {
      if (conn) conn.release();
    }
  });

  app.put('/api/user/emergency-contacts', authenticateToken, requireRole('user'), async (req, res) => {
    const contacts = Array.isArray(req.body.contacts) ? req.body.contacts.slice(0, 2) : [];
    let conn;
    try {
      const user = await getUserId(req.user.username);
      if (!user) return res.status(401).json({ success: false, message: '用戶不存在' });

      const cleaned = contacts
        .map((entry, index) => ({
          name: String(entry.name || '').trim(),
          phone: String(entry.phone || '').trim(),
          sort_order: index + 1
        }))
        .filter((entry) => entry.phone);

      conn = await pool.getConnection();
      await conn.beginTransaction();
      await conn.execute('DELETE FROM user_emergency_contacts WHERE user_id = ?', [user.id]);
      for (const entry of cleaned) {
        await conn.execute(
          `INSERT INTO user_emergency_contacts (user_id, name, phone, sort_order)
           VALUES (?, ?, ?, ?)`,
          [user.id, entry.name || null, entry.phone, entry.sort_order]
        );
      }
      await conn.commit();
      res.json({ success: true, contacts: cleaned });
    } catch (err) {
      if (conn) await conn.rollback();
      console.error(err);
      res.status(500).json({ success: false, message: '伺服器錯誤' });
    } finally {
      if (conn) conn.release();
    }
  });

  // ===== SOS trigger (login required, user role only) =====
  app.post('/api/safety/sos', authenticateToken, requireRole('user'), async (req, res) => {
    const {
      lat,
      lng,
      location_accuracy: locationAccuracy,
      location_status: locationStatus
    } = req.body || {};

    const normalizedLocationStatus = LOCATION_STATUSES.includes(locationStatus)
      ? locationStatus
      : 'failed';

    let conn;
    try {
      conn = await pool.getConnection();
      const [settingsRows] = await conn.execute(
        'SELECT sos_enabled, emergency_phone FROM safety_settings WHERE id = 1'
      );
      const settings = settingsRows[0];
      if (!settings || !(settings.sos_enabled === 1 || settings.sos_enabled === true)) {
        return res.status(403).json({ success: false, message: 'SOS 功能目前未啟用' });
      }

      const user = await getUserId(req.user.username);
      if (!user) return res.status(401).json({ success: false, message: '用戶不存在' });

      const contactsSnapshot = await getEmergencyContactsSnapshot(user.id);
      const parsedLat = lat != null && lat !== '' ? Number(lat) : null;
      const parsedLng = lng != null && lng !== '' ? Number(lng) : null;
      const parsedAccuracy = locationAccuracy != null && locationAccuracy !== ''
        ? Number(locationAccuracy)
        : null;

      const [result] = await conn.execute(
        `INSERT INTO sos_events (
          user_id, username, lat, lng, location_accuracy, location_status, emergency_contacts_snapshot
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          user.id,
          req.user.username,
          Number.isFinite(parsedLat) ? parsedLat : null,
          Number.isFinite(parsedLng) ? parsedLng : null,
          Number.isFinite(parsedAccuracy) ? parsedAccuracy : null,
          normalizedLocationStatus,
          contactsSnapshot.length ? JSON.stringify(contactsSnapshot) : null
        ]
      );

      res.json({
        success: true,
        event: {
          id: result.insertId,
          emergency_phone: settings.emergency_phone || '',
          location_status: normalizedLocationStatus,
          lat: Number.isFinite(parsedLat) ? parsedLat : null,
          lng: Number.isFinite(parsedLng) ? parsedLng : null
        }
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: '伺服器錯誤' });
    } finally {
      if (conn) conn.release();
    }
  });

  // ===== Admin =====
  app.get('/api/admin/safety/facilities', adminAuth, async (req, res) => {
    let conn;
    try {
      conn = await pool.getConnection();
      const [rows] = await conn.execute(
        `SELECT * FROM safety_facilities ORDER BY facility_type ASC, sort_order ASC, id ASC`
      );
      res.json({ success: true, facilities: rows.map(mapFacilityRow) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: '伺服器錯誤' });
    } finally {
      if (conn) conn.release();
    }
  });

  app.post('/api/admin/safety/facilities', adminAuth, async (req, res) => {
    const {
      facility_type: facilityType,
      name,
      lat,
      lng,
      description,
      supplies,
      open_hours: openHours,
      notes,
      is_active: isActive,
      sort_order: sortOrder
    } = req.body || {};

    if (!FACILITY_TYPES.includes(facilityType)) {
      return res.status(400).json({ success: false, message: '設施類型無效' });
    }
    if (!name || lat == null || lng == null) {
      return res.status(400).json({ success: false, message: '缺少必要欄位' });
    }

    let conn;
    try {
      conn = await pool.getConnection();
      const [result] = await conn.execute(
        `INSERT INTO safety_facilities (
          facility_type, name, lat, lng, description, supplies, open_hours, notes, is_active, sort_order, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          facilityType,
          String(name).trim(),
          Number(lat),
          Number(lng),
          description || null,
          JSON.stringify(normalizeSupplies(supplies)),
          openHours || null,
          notes || null,
          isActive === false ? 0 : 1,
          Number(sortOrder) || 0,
          req.user.username
        ]
      );
      const [rows] = await conn.execute('SELECT * FROM safety_facilities WHERE id = ?', [result.insertId]);
      res.json({ success: true, facility: mapFacilityRow(rows[0]) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: '伺服器錯誤' });
    } finally {
      if (conn) conn.release();
    }
  });

  app.put('/api/admin/safety/facilities/:id', adminAuth, async (req, res) => {
    const { id } = req.params;
    const {
      facility_type: facilityType,
      name,
      lat,
      lng,
      description,
      supplies,
      open_hours: openHours,
      notes,
      is_active: isActive,
      sort_order: sortOrder
    } = req.body || {};

    if (facilityType && !FACILITY_TYPES.includes(facilityType)) {
      return res.status(400).json({ success: false, message: '設施類型無效' });
    }

    let conn;
    try {
      conn = await pool.getConnection();
      const [existing] = await conn.execute('SELECT id FROM safety_facilities WHERE id = ?', [id]);
      if (existing.length === 0) {
        return res.status(404).json({ success: false, message: '找不到設施' });
      }

      await conn.execute(
        `UPDATE safety_facilities SET
          facility_type = COALESCE(?, facility_type),
          name = COALESCE(?, name),
          lat = COALESCE(?, lat),
          lng = COALESCE(?, lng),
          description = ?,
          supplies = ?,
          open_hours = ?,
          notes = ?,
          is_active = COALESCE(?, is_active),
          sort_order = COALESCE(?, sort_order)
         WHERE id = ?`,
        [
          facilityType || null,
          name != null ? String(name).trim() : null,
          lat != null ? Number(lat) : null,
          lng != null ? Number(lng) : null,
          description ?? null,
          supplies != null ? JSON.stringify(normalizeSupplies(supplies)) : null,
          openHours ?? null,
          notes ?? null,
          isActive === undefined ? null : (isActive ? 1 : 0),
          sortOrder != null ? Number(sortOrder) : null,
          id
        ]
      );
      const [rows] = await conn.execute('SELECT * FROM safety_facilities WHERE id = ?', [id]);
      res.json({ success: true, facility: mapFacilityRow(rows[0]) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: '伺服器錯誤' });
    } finally {
      if (conn) conn.release();
    }
  });

  app.delete('/api/admin/safety/facilities/:id', adminAuth, async (req, res) => {
    let conn;
    try {
      conn = await pool.getConnection();
      const [result] = await conn.execute('DELETE FROM safety_facilities WHERE id = ?', [req.params.id]);
      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: '找不到設施' });
      }
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: '伺服器錯誤' });
    } finally {
      if (conn) conn.release();
    }
  });

  app.get('/api/admin/safety/settings', adminAuth, async (req, res) => {
    let conn;
    try {
      conn = await pool.getConnection();
      const [rows] = await conn.execute('SELECT * FROM safety_settings WHERE id = 1');
      const settings = rows[0] || {};
      res.json({
        success: true,
        settings: {
          sos_enabled: settings.sos_enabled === 1 || settings.sos_enabled === true,
          emergency_phone: settings.emergency_phone || '',
          sos_instructions: settings.sos_instructions || ''
        }
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: '伺服器錯誤' });
    } finally {
      if (conn) conn.release();
    }
  });

  app.put('/api/admin/safety/settings', adminAuth, async (req, res) => {
    const { sos_enabled: sosEnabled, emergency_phone: emergencyPhone, sos_instructions: sosInstructions } = req.body || {};
    let conn;
    try {
      conn = await pool.getConnection();
      await conn.execute(
        `INSERT INTO safety_settings (id, sos_enabled, emergency_phone, sos_instructions, updated_by)
         VALUES (1, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           sos_enabled = VALUES(sos_enabled),
           emergency_phone = VALUES(emergency_phone),
           sos_instructions = VALUES(sos_instructions),
           updated_by = VALUES(updated_by)`,
        [
          sosEnabled === false ? 0 : 1,
          emergencyPhone ? String(emergencyPhone).trim() : null,
          sosInstructions != null ? String(sosInstructions).trim() : null,
          req.user.username
        ]
      );
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: '伺服器錯誤' });
    } finally {
      if (conn) conn.release();
    }
  });

  app.get('/api/admin/safety/sos-events', adminAuth, async (req, res) => {
    const status = req.query.status;
    const sinceId = req.query.since_id ? Number(req.query.since_id) : null;
    let conn;
    try {
      conn = await pool.getConnection();
      let sql = `SELECT * FROM sos_events WHERE 1=1`;
      const params = [];
      if (status && SOS_STATUSES.includes(status)) {
        sql += ' AND status = ?';
        params.push(status);
      }
      if (Number.isFinite(sinceId) && sinceId > 0) {
        sql += ' AND id > ?';
        params.push(sinceId);
      }
      sql += ' ORDER BY created_at DESC LIMIT 200';
      const [rows] = await conn.execute(sql, params);
      res.json({ success: true, events: rows.map(mapSosRow) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: '伺服器錯誤' });
    } finally {
      if (conn) conn.release();
    }
  });

  app.patch('/api/admin/safety/sos-events/:id', adminAuth, async (req, res) => {
    const { status, admin_notes: adminNotes } = req.body || {};
    if (status && !SOS_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: '狀態無效' });
    }
    let conn;
    try {
      conn = await pool.getConnection();
      const [existing] = await conn.execute('SELECT id FROM sos_events WHERE id = ?', [req.params.id]);
      if (existing.length === 0) {
        return res.status(404).json({ success: false, message: '找不到 SOS 紀錄' });
      }
      await conn.execute(
        `UPDATE sos_events SET
          status = COALESCE(?, status),
          admin_notes = COALESCE(?, admin_notes),
          handled_by = CASE WHEN ? IS NOT NULL THEN ? ELSE handled_by END,
          handled_at = CASE WHEN ? IS NOT NULL THEN NOW() ELSE handled_at END
         WHERE id = ?`,
        [
          status || null,
          adminNotes != null ? String(adminNotes).trim() : null,
          status || null,
          req.user.username,
          status || null,
          req.params.id
        ]
      );
      const [rows] = await conn.execute('SELECT * FROM sos_events WHERE id = ?', [req.params.id]);
      res.json({ success: true, event: mapSosRow(rows[0]) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: '伺服器錯誤' });
    } finally {
      if (conn) conn.release();
    }
  });
}

module.exports = { registerSafetyRoutes, FACILITY_TYPES };
