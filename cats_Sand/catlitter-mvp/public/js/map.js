import { apiGet, apiPost } from "./api.js";

let points = [];
let selected = null;
let plotEl = null;

const BASE_TRACE_INDEX = 0;
const TARGET_TRACE_INDEX = 1;
const INITIAL_CAMERA = {
  eye: { x: 1.6, y: 1.6, z: 1.2 },
  up: { x: 0, y: 0, z: 1 },
  center: { x: 0, y: 0, z: 0 },
};

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
    marker: {
      size: 4,
      opacity: 0.9,
      color: "#111111",
      line: { color: "#000000", width: 1 },
    },
  };

  const targetTrace = {
    type: "scatter3d",
    mode: "markers+text",
    x: [],
    y: [],
    z: [],
    text: [],
    textposition: "top center",
    hovertemplate: "<b>%{text}</b><br>X:%{x}<br>Y:%{y}<br>Z:%{z}<extra></extra>",
    marker: {
      size: 8,
      opacity: 1,
      color: "#e10000",
      line: { color: "#8b0000", width: 1.5 },
      symbol: "diamond",
    },
  };

  const layout = {
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    scene: {
      dragmode: "turntable",
      camera: INITIAL_CAMERA,
      xaxis: {
        title: { text: "X 除臭", font: { color: "#cc0000" } },
        tickfont: { color: "#cc0000" },
        linecolor: "#cc0000",
        zerolinecolor: "#000000",
        gridcolor: "#000000",
        showline: true,
        showbackground: true,
        backgroundcolor: "#ffffff",
      },
      yaxis: {
        title: { text: "Y 吸水", font: { color: "#cc0000" } },
        tickfont: { color: "#cc0000" },
        linecolor: "#cc0000",
        zerolinecolor: "#000000",
        gridcolor: "#000000",
        showline: true,
        showbackground: true,
        backgroundcolor: "#ffffff",
      },
      zaxis: {
        title: { text: "Z z_crush（高=不碎）", font: { color: "#cc0000" } },
        tickfont: { color: "#cc0000" },
        linecolor: "#cc0000",
        zerolinecolor: "#000000",
        gridcolor: "#000000",
        showline: true,
        showbackground: true,
        backgroundcolor: "#ffffff",
      },
    },
    uirevision: "keep-user-camera",
    margin: { l: 0, r: 0, t: 0, b: 0 },
  };

  Plotly.newPlot("plot", [trace, targetTrace], layout, {
    responsive: true,
    doubleClick: false,
  });

  plotEl = document.getElementById("plot");
  plotEl.on("plotly_click", (data) => {
    if (data?.points?.[0]?.curveNumber !== BASE_TRACE_INDEX) return;
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

function showTargetPoint(target) {
  if (!plotEl) return;
  Plotly.restyle(
    plotEl,
    {
      x: [[target.x]],
      y: [[target.y]],
      z: [[target.z]],
      text: [[`Target (${target.x}, ${target.y}, ${target.z})`]],
    },
    [TARGET_TRACE_INDEX]
  );
}

function resetView() {
  if (!plotEl) return;
  Plotly.relayout(plotEl, { "scene.camera": INITIAL_CAMERA });
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
  document.getElementById("btnResetView").addEventListener("click", resetView);

  document.getElementById("btnReco").addEventListener("click", async () => {
    const status = document.getElementById("recoStatus");
    status.textContent = "LLM 推理中…";
    try {
      const target = {
        x: Number(document.getElementById("tx").value),
        y: Number(document.getElementById("ty").value),
        z: Number(document.getElementById("tz").value),
      };
      showTargetPoint(target);
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
