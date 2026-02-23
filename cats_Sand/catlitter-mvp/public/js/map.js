import { apiGet, apiPost } from "./api.js";

let points = [];
let selected = null;

function renderPlot(inputPoints) {
  const xs = inputPoints.map((p) => p.x);
  const ys = inputPoints.map((p) => p.y);
  const zs = inputPoints.map((p) => p.z);
  const text = inputPoints.map((p) => p.name);

  const trace = {
    type: "scatter3d",
    mode: "markers",
    x: xs,
    y: ys,
    z: zs,
    text,
    hovertemplate: "<b>%{text}</b><br>X:%{x}<br>Y:%{y}<br>Z:%{z}<extra></extra>",
    marker: { size: 4, opacity: 0.85 },
  };

  const layout = {
    paper_bgcolor: "#0b0d12",
    plot_bgcolor: "#0b0d12",
    scene: {
      xaxis: { title: "X 除臭" },
      yaxis: { title: "Y 吸水" },
      zaxis: { title: "Z z_crush（高=不碎）" },
    },
    margin: { l: 0, r: 0, t: 0, b: 0 },
  };

  Plotly.newPlot("plot", [trace], layout, { responsive: true });

  const plot = document.getElementById("plot");
  plot.on("plotly_click", (data) => {
    const idx = data?.points?.[0]?.pointNumber;
    if (idx == null) return;
    selected = inputPoints[idx];
    document.getElementById("sampleInfo").innerHTML = `<div><span class="badge">${selected.name}</span></div>
       <div>X 除臭：${selected.x}</div>
       <div>Y 吸水：${selected.y}</div>
       <div>Z 抗粉碎：${selected.z}（低=更碎）</div>
       <div class="small">（BOM 會在 V1.1 加入：點選後拉 /api/boms/by-sample）</div>`;
  });
}

function renderCandidates(out) {
  const el = document.getElementById("candidates");
  el.innerHTML = "";
  const { candidates = [] } = out;

  for (const c of candidates) {
    const mixHtml = (c.mix || []).map((m) => `${m.sample} × ${(m.weight * 100).toFixed(0)}%`).join("<br>");
    const bomHtml = (c.bom || [])
      .slice(0, 12)
      .map((b) => `${b.material}: ${b.ratio}%`)
      .join("<br>");

    const reasons = (c.reasons || []).map((x) => `<li>${x}</li>`).join("");
    const warnings = (c.warnings || []).map((x) => `<li>${x}</li>`).join("");

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="small">混合樣品</div>
      <div>${mixHtml || "-"}</div>
      <hr />
      <div class="small">系統加權平均預期 XYZ</div>
      <div>X:${c.expectedXYZ?.x}　Y:${c.expectedXYZ?.y}　Z:${c.expectedXYZ?.z}</div>
      <hr />
      <div class="small">合成 BOM（前 12 項）</div>
      <div class="small">${bomHtml || "-"}</div>
      <hr />
      <div class="small">理由</div>
      <ul class="small">${reasons || "<li>-</li>"}</ul>
      <div class="small">風險/提醒</div>
      <ul class="small">${warnings || "<li>-</li>"}</ul>
    `;
    el.appendChild(card);
  }
}

async function main() {
  points = await apiGet("/api/map/points");
  renderPlot(points);

  document.getElementById("btnReco").addEventListener("click", async () => {
    const status = document.getElementById("recoStatus");
    status.textContent = "LLM 推理中…";
    try {
      const target = {
        x: Number(document.getElementById("tx").value),
        y: Number(document.getElementById("ty").value),
        z: Number(document.getElementById("tz").value),
      };
      const k = Number(document.getElementById("k").value || 30);
      const maxMix = Number(document.getElementById("maxMix").value || 3);

      const out = await apiPost("/api/recommendations", { target, k, maxMix });
      status.textContent = "完成";
      renderCandidates(out);
    } catch (e) {
      status.textContent = "失敗：" + e.message;
    }
  });
}

main();
