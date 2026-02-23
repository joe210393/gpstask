import { apiGet, apiPost, apiPut } from "/js/api.js";

const params = new URLSearchParams(location.search);
const sampleId = params.get("sampleId");

const bomSelect = document.getElementById("bomSelect");
const materialSelect = document.getElementById("materialSelect");
const itemsEl = document.getElementById("items");
const title = document.getElementById("title");
document.getElementById("back").href = `/admin/sample-edit.html?id=${sampleId}`;

let boms = [];
let currentBomId = null;
let materials = [];

async function loadMaterials() {
  materials = await apiGet("/api/materials");
  materialSelect.innerHTML = materials.map((m) => `<option value="${m.id}">${m.name}</option>`).join("");
}

async function loadBoms() {
  boms = await apiGet(`/api/boms/by-sample/${sampleId}`);
  bomSelect.innerHTML = boms
    .map((b) => `<option value="${b.id}">${b.version}${b.is_active ? " (active)" : ""}</option>`)
    .join("");
  currentBomId = Number(bomSelect.value || boms?.[0]?.id);
}

async function loadItems() {
  if (!currentBomId) {
    itemsEl.innerHTML = `<div class="small">尚無 BOM，請先新增版本。</div>`;
    return;
  }

  const items = await apiGet(`/api/boms/${currentBomId}/items`);
  const sum = items.reduce((t, it) => t + Number(it.ratio), 0);
  itemsEl.innerHTML = `
    <div class="small">加總：${sum.toFixed(2)}%</div>
    <hr />
    ${items.map((it) => `<div class="small">${it.material}：${it.ratio}%</div>`).join("")}
  `;
}

document.getElementById("btnNewBom").onclick = async () => {
  const v = prompt("版本名稱（例如 v2）", "v2");
  if (!v) return;
  await apiPost("/api/boms", { sample_id: Number(sampleId), version: v });
  await loadBoms();
  await loadItems();
};

document.getElementById("btnSetActive").onclick = async () => {
  if (!currentBomId) return;
  await apiPut(`/api/boms/${currentBomId}/set-active`, {});
  await loadBoms();
};

document.getElementById("btnAddItem").onclick = async () => {
  if (!currentBomId) return alert("請先新增 BOM 版本");
  const material_id = Number(materialSelect.value);
  const ratio = Number(document.getElementById("ratio").value || 0);
  if (!material_id || ratio <= 0) return alert("材料與比例必填");

  const items = await apiGet(`/api/boms/${currentBomId}/items`);
  const newItems = items
    .map((it) => {
      const m = materials.find((x) => x.name === it.material);
      return { material_id: m?.id, ratio: it.ratio, note: null };
    })
    .filter((x) => x.material_id);

  newItems.push({ material_id, ratio, note: null });

  await apiPut(`/api/boms/${currentBomId}/items`, { items: newItems });
  document.getElementById("ratio").value = "";
  await loadItems();
};

bomSelect.onchange = async () => {
  currentBomId = Number(bomSelect.value);
  await loadItems();
};

async function main() {
  title.textContent = `樣品 ${sampleId} - BOM`;
  await loadMaterials();
  await loadBoms();
  await loadItems();
}

main();
