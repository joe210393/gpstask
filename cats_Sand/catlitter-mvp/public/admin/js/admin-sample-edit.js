import { apiGet, apiPost, apiPut } from "/js/api.js";

const params = new URLSearchParams(location.search);
const id = params.get("id");

const title = document.getElementById("title");
const msg = document.getElementById("msg");

async function load() {
  if (!id) {
    title.textContent = "新增樣品";
    return;
  }

  title.textContent = "編輯樣品";
  const s = await apiGet(`/api/samples/${id}`);
  document.getElementById("name").value = s.name;
  document.getElementById("status").value = s.status;
  document.getElementById("x").value = s.x_deodor;
  document.getElementById("y").value = s.y_absorb;
  document.getElementById("z").value = s.z_crush;
  document.getElementById("notes").value = s.notes || "";
}

document.getElementById("btnSave").onclick = async () => {
  msg.textContent = "儲存中…";
  const payload = {
    name: document.getElementById("name").value.trim(),
    status: document.getElementById("status").value,
    x_deodor: Number(document.getElementById("x").value || 0),
    y_absorb: Number(document.getElementById("y").value || 0),
    z_crush: Number(document.getElementById("z").value || 0),
    tags: [],
    notes: document.getElementById("notes").value,
  };

  try {
    if (id) {
      await apiPut(`/api/samples/${id}`, payload);
      msg.textContent = "已更新";
    } else {
      const r = await apiPost("/api/samples", payload);
      msg.textContent = "已新增";
      location.href = `/admin/sample-edit.html?id=${r?.id || ""}`;
    }
  } catch (e) {
    msg.textContent = "失敗：" + e.message;
  }
};

document.getElementById("btnBom").onclick = () => {
  if (!id) return alert("請先儲存樣品，才能編 BOM");
  location.href = `/admin/bom-edit.html?sampleId=${id}`;
};

load();
