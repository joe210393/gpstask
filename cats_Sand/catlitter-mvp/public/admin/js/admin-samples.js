import { apiGet } from "/js/api.js";

const listEl = document.getElementById("list");
const searchEl = document.getElementById("search");

document.getElementById("btnNew").onclick = () => {
  window.location.href = "/admin/sample-edit.html";
};

async function load() {
  const q = searchEl.value.trim();
  const data = await apiGet(`/api/samples?search=${encodeURIComponent(q)}&page=1&pageSize=100`);
  listEl.innerHTML = data
    .map(
      (s) => `
    <div class="card">
      <div><span class="badge">${s.name}</span> <span class="small">(${s.status})</span></div>
      <div class="small">X:${s.x_deodor}　Y:${s.y_absorb}　Z:${s.z_crush}</div>
      <div class="row">
        <button onclick="location.href='/admin/sample-edit.html?id=${s.id}'">編輯</button>
        <button onclick="location.href='/admin/bom-edit.html?sampleId=${s.id}'">BOM</button>
      </div>
    </div>
  `
    )
    .join("");
}

searchEl.addEventListener("input", () => load());
load();
