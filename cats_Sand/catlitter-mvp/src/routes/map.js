import express from "express";
import { query } from "../db.js";

const router = express.Router();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/points", ah(async (_req, res) => {
  const rows = await query(
    `SELECT id, name, x_deodor, y_absorb, z_crush, status
     FROM samples
     WHERE status != 'archived'
     ORDER BY updated_at DESC`
  );
  const points = rows.map((r) => ({
    id: r.id,
    name: r.name,
    x: Number(r.x_deodor),
    y: Number(r.y_absorb),
    z: Number(r.z_crush),
    status: r.status,
  }));
  res.json({ ok: true, data: points });
}));

export default router;
