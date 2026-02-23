import express from "express";
import { exec, query } from "../db.js";
import { safeJsonParse } from "../utils/validate.js";

const router = express.Router();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get(
  "/",
  ah(async (_req, res) => {
  const rows = await query(`SELECT * FROM materials ORDER BY updated_at DESC`);
  rows.forEach((r) => {
    r.function_tags = safeJsonParse(r.function_tags, []);
  });
  res.json({ ok: true, data: rows });
})
);

router.post(
  "/",
  ah(async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ ok: false, error: "name required" });

  const { meta } = await exec(
    `INSERT INTO materials (name, category, function_tags, function_notes, min_ratio, max_ratio, cost_per_kg)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      b.name,
      b.category || null,
      JSON.stringify(Array.isArray(b.function_tags) ? b.function_tags : []),
      b.function_notes || null,
      b.min_ratio ?? null,
      b.max_ratio ?? null,
      b.cost_per_kg ?? null,
    ]
  );

  res.json({ ok: true, id: meta.insertId });
})
);

router.put(
  "/:id",
  ah(async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  await exec(
    `UPDATE materials
     SET name=?, category=?, function_tags=?, function_notes=?, min_ratio=?, max_ratio=?, cost_per_kg=?
     WHERE id=?`,
    [
      b.name,
      b.category || null,
      JSON.stringify(Array.isArray(b.function_tags) ? b.function_tags : []),
      b.function_notes || null,
      b.min_ratio ?? null,
      b.max_ratio ?? null,
      b.cost_per_kg ?? null,
      id,
    ]
  );
  res.json({ ok: true });
})
);

router.delete(
  "/:id",
  ah(async (req, res) => {
  const id = Number(req.params.id);
  await exec(`DELETE FROM materials WHERE id=?`, [id]);
  res.json({ ok: true });
})
);

export default router;
