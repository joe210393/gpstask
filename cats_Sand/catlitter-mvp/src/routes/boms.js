import express from "express";
import { exec, query } from "../db.js";

const router = express.Router();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/by-sample/:sampleId", ah(async (req, res) => {
  const sampleId = Number(req.params.sampleId);
  const boms = await query(`SELECT * FROM boms WHERE sample_id=? ORDER BY created_at DESC`, [sampleId]);
  res.json({ ok: true, data: boms });
}));

router.get("/:bomId/items", ah(async (req, res) => {
  const bomId = Number(req.params.bomId);
  const items = await query(
    `SELECT bi.id, bi.ratio, bi.note, m.name AS material
     FROM bom_items bi
     JOIN materials m ON m.id = bi.material_id
     WHERE bi.bom_id=?
     ORDER BY bi.ratio DESC`,
    [bomId]
  );
  res.json({ ok: true, data: items });
}));

router.post("/", ah(async (req, res) => {
  const { sample_id, version } = req.body || {};
  if (!sample_id) return res.status(400).json({ ok: false, error: "sample_id required" });

  const { meta } = await exec(`INSERT INTO boms (sample_id, version, is_active) VALUES (?, ?, 0)`, [
    Number(sample_id),
    version || "v1",
  ]);

  res.json({ ok: true, id: meta.insertId });
}));

router.put("/:bomId/set-active", ah(async (req, res) => {
  const bomId = Number(req.params.bomId);
  const rows = await query(`SELECT sample_id FROM boms WHERE id=?`, [bomId]);
  if (!rows.length) return res.status(404).json({ ok: false, error: "bom not found" });
  const sampleId = rows[0].sample_id;

  await exec(`UPDATE boms SET is_active=0 WHERE sample_id=?`, [sampleId]);
  await exec(`UPDATE boms SET is_active=1 WHERE id=?`, [bomId]);

  res.json({ ok: true });
}));

router.put("/:bomId/items", ah(async (req, res) => {
  const bomId = Number(req.params.bomId);
  const items = Array.isArray(req.body?.items) ? req.body.items : [];

  await exec(`DELETE FROM bom_items WHERE bom_id=?`, [bomId]);

  for (const it of items) {
    if (!it.material_id) continue;
    await exec(`INSERT INTO bom_items (bom_id, material_id, ratio, note) VALUES (?, ?, ?, ?)`, [
      bomId,
      Number(it.material_id),
      Number(it.ratio || 0),
      it.note || null,
    ]);
  }

  res.json({ ok: true });
}));

export default router;
