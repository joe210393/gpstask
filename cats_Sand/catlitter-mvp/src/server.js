import express from "express";
import { config } from "./config.js";

import samplesRouter from "./routes/samples.js";
import materialsRouter from "./routes/materials.js";
import bomsRouter from "./routes/boms.js";
import mapRouter from "./routes/map.js";
import recommendationsRouter from "./routes/recommendations.js";

const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/samples", samplesRouter);
app.use("/api/materials", materialsRouter);
app.use("/api/boms", bomsRouter);
app.use("/api/map", mapRouter);
app.use("/api/recommendations", recommendationsRouter);

app.use((err, _req, res, _next) => {
  console.error("Unhandled API error:", err);
  if (err?.code === "ER_DUP_ENTRY") {
    return res.status(409).json({ ok: false, error: "資料重複，名稱已存在，請換一個名稱。" });
  }
  res.status(500).json({ ok: false, error: err?.message || "Internal Server Error" });
});

app.listen(config.port, () => {
  console.log(`Server running: http://localhost:${config.port}`);
});
