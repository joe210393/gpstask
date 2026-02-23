import express from "express";
import { query } from "../db.js";
import { config } from "../config.js";
import { mustNumber, safeJsonParse } from "../utils/validate.js";
import { recommendWithLLM } from "../services/recommender.js";

const router = express.Router();

function fallbackMixCandidates(neighbors, maxMix) {
  const list = neighbors.slice(0, 5);
  const candidates = [];

  if (list.length >= 2) {
    candidates.push([
      { sample: list[0].name, weight: 0.6 },
      { sample: list[1].name, weight: 0.4 },
    ]);
  }
  if (list.length >= 3 && maxMix >= 3) {
    candidates.push([
      { sample: list[0].name, weight: 0.5 },
      { sample: list[1].name, weight: 0.3 },
      { sample: list[2].name, weight: 0.2 },
    ]);
  }
  if (list.length >= 3) {
    candidates.push([
      { sample: list[1].name, weight: 0.5 },
      { sample: list[2].name, weight: 0.5 },
    ]);
  }
  if (list.length >= 4 && maxMix >= 3) {
    candidates.push([
      { sample: list[0].name, weight: 0.4 },
      { sample: list[2].name, weight: 0.35 },
      { sample: list[3].name, weight: 0.25 },
    ]);
  }

  return candidates.slice(0, 4);
}

function weightedXYZ(samplesByName, mix) {
  let x = 0;
  let y = 0;
  let z = 0;
  let sumW = 0;
  for (const m of mix) {
    const s = samplesByName.get(m.sample);
    if (!s) continue;
    x += s.x * m.weight;
    y += s.y * m.weight;
    z += s.z * m.weight;
    sumW += m.weight;
  }
  if (!sumW) return { x: 0, y: 0, z: 0 };
  return {
    x: Number((x / sumW).toFixed(2)),
    y: Number((y / sumW).toFixed(2)),
    z: Number((z / sumW).toFixed(2)),
  };
}

function mixedBom(samplesByName, mix) {
  const acc = new Map();
  for (const m of mix) {
    const s = samplesByName.get(m.sample);
    if (!s) continue;
    for (const item of s.bomItems) {
      acc.set(item.material, (acc.get(item.material) || 0) + item.ratio * m.weight);
    }
  }
  const rows = [...acc.entries()].map(([material, ratio]) => ({ material, ratio: Number(ratio.toFixed(2)) }));
  const sum = rows.reduce((t, x) => t + x.ratio, 0);
  if (sum > 0) {
    for (const x of rows) x.ratio = Number(((x.ratio / sum) * 100).toFixed(2));
  }
  return rows.sort((a, b) => b.ratio - a.ratio);
}

function fallbackRecommend({ allPoints, target, maxMix, neighborDetails }) {
  const neighbors = [...allPoints]
    .map((p) => {
      const dx = p.x - target.x;
      const dy = p.y - target.y;
      const dz = p.z - target.z;
      return { ...p, d: Math.sqrt(dx * dx + dy * dy + dz * dz) };
    })
    .sort((a, b) => a.d - b.d)
    .slice(0, 30);

  const mixes = fallbackMixCandidates(neighbors, maxMix);
  const candidates = mixes.map((mix) => ({
    mix,
    expectedXYZ: weightedXYZ(neighborDetails, mix),
    bom: mixedBom(neighborDetails, mix),
    reasons: ["使用近鄰樣品加權組合（LLM 逾時時的穩定降級策略）。"],
    warnings: ["此結果為 fallback 推薦，建議搭配實測再定版。"],
  }));

  return { neighbors, candidates, fallback: true };
}

router.post("/", async (req, res) => {
  try {
    const body = req.body || {};
    const t = body.target || {};
    const target = {
      x: mustNumber(t.x, "target.x"),
      y: mustNumber(t.y, "target.y"),
      z: mustNumber(t.z, "target.z"),
    };

    const k = Number(body.k || config.reco.kDefault);
    const maxMix = Number(body.maxMix || config.reco.maxMixDefault);
    const neighborsForLLM = config.reco.neighborsForLLM;

    const pointsRows = await query(
      `SELECT id, name, x_deodor, y_absorb, z_crush
       FROM samples
       WHERE status != 'archived'`
    );

    const allPoints = pointsRows.map((r) => ({
      id: r.id,
      name: r.name,
      x: Number(r.x_deodor),
      y: Number(r.y_absorb),
      z: Number(r.z_crush),
    }));

    const mats = await query(`SELECT * FROM materials`);
    const materialFunctions = new Map();
    for (const m of mats) {
      materialFunctions.set(m.name, {
        function_tags: safeJsonParse(m.function_tags, []),
        min_ratio: m.min_ratio,
        max_ratio: m.max_ratio,
      });
    }

    const neighborDetails = new Map();
    for (const p of allPoints) {
      neighborDetails.set(p.name, { x: p.x, y: p.y, z: p.z, bomItems: [] });
    }

    const allItems = await query(
      `SELECT s.name AS sample_name, m.name AS material, bi.ratio
       FROM bom_items bi
       JOIN boms b ON b.id=bi.bom_id
       JOIN samples s ON s.id=b.sample_id
       JOIN materials m ON m.id=bi.material_id
       WHERE b.is_active=1 AND s.status!='archived'
       ORDER BY bi.ratio DESC`
    );

    for (const it of allItems) {
      const entry = neighborDetails.get(it.sample_name);
      if (entry) entry.bomItems.push({ material: it.material, ratio: Number(it.ratio) });
    }

    let out;
    try {
      out = await recommendWithLLM({
        allPoints,
        target,
        k,
        maxMix,
        neighborsForLLM,
        neighborDetails,
        materialFunctions,
      });
    } catch (llmErr) {
      out = fallbackRecommend({ allPoints, target, maxMix, neighborDetails });
      out.fallbackReason = String(llmErr?.message || llmErr);
    }

    res.json({ ok: true, data: out });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err.message || err) });
  }
});

export default router;
