import express from "express";
import { exec, query } from "../db.js";
import { mustNumber, safeJsonParse } from "../utils/validate.js";

const router = express.Router();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get(
  "/",
  ah(async (req, res) => {
  const search = (req.query.search || "").toString().trim();
  const page = Math.max(1, Number.parseInt(String(req.query.page || 1), 10));
  const pageSize = Math.min(200, Math.max(10, Number.parseInt(String(req.query.pageSize || 50), 10)));
  const offset = (page - 1) * pageSize;

  const where = search ? "WHERE name LIKE ?" : "";
  const limitSql = `LIMIT ${pageSize} OFFSET ${offset}`;
  const params = search ? [`%${search}%`] : [];

  const rows = await query(
    `SELECT id, name, x_deodor, y_absorb, z_crush, tags, status, updated_at
     FROM samples ${where}
     ORDER BY updated_at DESC
     ${limitSql}`,
    params
  );

  rows.forEach((r) => {
    r.tags = safeJsonParse(r.tags, []);
  });

  res.json({ ok: true, data: rows, page, pageSize });
})
);

router.post(
  "/",
  ah(async (req, res) => {
  const { name, x_deodor, y_absorb, z_crush, tags, status, notes } = req.body || {};
  if (!name) return res.status(400).json({ ok: false, error: "name required" });

  const x = mustNumber(x_deodor ?? 0, "x_deodor");
  const y = mustNumber(y_absorb ?? 0, "y_absorb");
  const z = mustNumber(z_crush ?? 0, "z_crush");
  const tagsJson = JSON.stringify(Array.isArray(tags) ? tags : []);
  const st = ["draft", "tested", "archived"].includes(status) ? status : "draft";

  const { meta } = await exec(
    `INSERT INTO samples (name, x_deodor, y_absorb, z_crush, tags, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name, x, y, z, tagsJson, st, notes || null]
  );

  res.json({ ok: true, id: meta.insertId });
})
);

router.get(
  "/:id",
  ah(async (req, res) => {
  const id = Number(req.params.id);
  const rows = await query(`SELECT * FROM samples WHERE id=?`, [id]);
  if (!rows.length) return res.status(404).json({ ok: false, error: "not found" });
  const sample = rows[0];
  sample.tags = safeJsonParse(sample.tags, []);
  res.json({ ok: true, data: sample });
})
);

router.put(
  "/:id",
  ah(async (req, res) => {
  const id = Number(req.params.id);
  const { name, x_deodor, y_absorb, z_crush, tags, status, notes } = req.body || {};

  const x = mustNumber(x_deodor ?? 0, "x_deodor");
  const y = mustNumber(y_absorb ?? 0, "y_absorb");
  const z = mustNumber(z_crush ?? 0, "z_crush");

  const tagsJson = JSON.stringify(Array.isArray(tags) ? tags : []);
  const st = ["draft", "tested", "archived"].includes(status) ? status : "draft";

  await exec(
    `UPDATE samples
     SET name=?, x_deodor=?, y_absorb=?, z_crush=?, tags=?, status=?, notes=?
     WHERE id=?`,
    [name, x, y, z, tagsJson, st, notes || null, id]
  );

  res.json({ ok: true });
})
);

export default router;
