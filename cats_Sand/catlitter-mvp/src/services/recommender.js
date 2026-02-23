import { knn } from "../utils/knn.js";
import { safeJsonParse } from "../utils/validate.js";
import { chatCompletions } from "./llm.js";

function mixBoms(samplesByName, mix) {
  const acc = new Map();

  for (const m of mix) {
    const s = samplesByName.get(m.sample);
    if (!s) continue;
    const w = m.weight;
    for (const item of s.bomItems) {
      const key = item.material;
      acc.set(key, (acc.get(key) || 0) + w * item.ratio);
    }
  }

  const arr = [...acc.entries()]
    .map(([material, ratio]) => ({ material, ratio: Number(ratio.toFixed(2)) }))
    .sort((a, b) => b.ratio - a.ratio);

  const sum = arr.reduce((t, x) => t + x.ratio, 0);
  if (sum > 0) {
    for (const x of arr) x.ratio = Number(((x.ratio / sum) * 100).toFixed(2));
  }
  return arr;
}

function weightedXYZ(samplesByName, mix) {
  let x = 0;
  let y = 0;
  let z = 0;
  let sumW = 0;

  for (const m of mix) {
    const s = samplesByName.get(m.sample);
    if (!s) continue;
    const w = m.weight;
    x += w * s.x;
    y += w * s.y;
    z += w * s.z;
    sumW += w;
  }

  if (sumW <= 0) return { x: 0, y: 0, z: 0 };
  return {
    x: Number((x / sumW).toFixed(2)),
    y: Number((y / sumW).toFixed(2)),
    z: Number((z / sumW).toFixed(2)),
  };
}

export async function recommendWithLLM({
  allPoints,
  target,
  k,
  maxMix,
  neighborsForLLM,
  neighborDetails,
  materialFunctions,
}) {
  const neighbors = knn(allPoints, target, k);
  const topForLLM = neighbors.slice(0, neighborsForLLM);

  const compactNeighbors = topForLLM.map((n) => ({
    sample: n.name,
    xyz: { x: n.x, y: n.y, z: n.z },
    bomTop: (neighborDetails.get(n.name)?.bomItems || []).slice(0, 10),
  }));

  const materialDict = {};
  for (const [name, meta] of materialFunctions.entries()) {
    materialDict[name] = {
      functions: meta.function_tags || [],
      minRatio: meta.min_ratio ?? null,
      maxRatio: meta.max_ratio ?? null,
    };
  }

  const system = `
你是「貓砂配方助手」。你只能輸出 JSON，不得輸出任何多餘文字。
目標：使用「既有樣品」的混合（最多 ${maxMix} 個樣品）來接近目標點 Target(XYZ)。
重要定義：
- X = 除臭（越高越好）
- Y = 吸水（越高越好）
- Z = z_crush（越高越不碎/越完整；越低越碎）
你只要決定「挑哪些樣品 + 權重」，以及理由/風險。不要自行亂算BOM與預測分數（會由系統計算）。
輸出 JSON schema：
{
  "candidates": [
    {
      "mix": [{"sample":"樣品名","weight":0.5}, ...],
      "reasons": ["..."],
      "warnings": ["..."]
    }
  ]
}
規則：
- mix 長度 2~${maxMix}
- weight 介於 0~1，總和約=1（容許誤差±0.02）
- candidates 請輸出 3~5 組
- 請避免選擇 XYZ 距離目標太遠的樣品
  `.trim();

  const user = {
    target,
    neighbors: compactNeighbors,
    materialFunctions: materialDict,
    constraints: {
      maxMix,
      note: "材料比例上下限由 materialFunctions 提供（minRatio/maxRatio），如不確定可在 warnings 提醒風險。",
    },
  };

  const content = await chatCompletions({
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(user) },
    ],
    temperature: 0.15,
  });

  const parsed = safeJsonParse(content, null);
  if (!parsed || !Array.isArray(parsed.candidates)) {
    throw new Error("LLM output is not valid JSON candidates.");
  }

  const samplesByName = neighborDetails;
  const enriched = parsed.candidates.slice(0, 5).map((c) => {
    const mix = (c.mix || [])
      .map((m) => ({
        sample: String(m.sample || ""),
        weight: Number(m.weight || 0),
      }))
      .filter((m) => m.sample && Number.isFinite(m.weight) && m.weight > 0);

    const sumW = mix.reduce((t, m) => t + m.weight, 0);
    if (sumW > 0) {
      for (const m of mix) m.weight = Number((m.weight / sumW).toFixed(4));
    }

    const expected = weightedXYZ(samplesByName, mix);
    const bom = mixBoms(samplesByName, mix);

    return {
      mix,
      expectedXYZ: expected,
      bom,
      reasons: Array.isArray(c.reasons) ? c.reasons : [],
      warnings: Array.isArray(c.warnings) ? c.warnings : [],
    };
  });

  return {
    neighbors,
    candidates: enriched,
  };
}
