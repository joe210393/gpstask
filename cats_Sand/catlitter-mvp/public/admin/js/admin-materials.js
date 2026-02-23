import { apiGet, apiPost } from "/js/api.js";

const listEl = document.getElementById("list");

async function load() {
  const data = await apiGet("/api/materials");
  listEl.innerHTML = data
    .map(
      (m) => `
    <div class="card">
      <div><span class="badge">${m.name}</span></div>
      <div class="small">功能：${(m.function_tags || []).join(", ") || "-"}</div>
      <div class="small">${m.function_notes || ""}</div>
    </div>
  `
    )
    .join("");
}

document.getElementById("btnAdd").onclick = async () => {
  const name = document.getElementById("name").value.trim();
  const functions = document
    .getElementById("functions")
    .value.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!name) return alert("請輸入材料名稱");

  try {
    await apiPost("/api/materials", {
      name,
      function_tags: functions,
      function_notes: functions.length ? `${name}－${functions.join("、")}` : null,
    });

    document.getElementById("name").value = "";
    document.getElementById("functions").value = "";
    load();
  } catch (e) {
    alert(`新增失敗：${e.message}`);
  }
};

load();
