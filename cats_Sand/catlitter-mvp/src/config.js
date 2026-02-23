import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 3000),
  db: {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "catlitter_mvp",
  },
  llm: {
    baseUrl: process.env.LLM_BASE_URL || "http://127.0.0.1:1234",
    apiKey: process.env.LLM_API_KEY || "",
    model: process.env.LLM_MODEL || "qwen3-30b-vl",
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS || 120000),
    apiStyle: process.env.LLM_API_STYLE || "et",
  },
  reco: {
    kDefault: Number(process.env.RECO_K_DEFAULT || 30),
    neighborsForLLM: Number(process.env.RECO_NEIGHBORS_FOR_LLM || 20),
    maxMixDefault: Number(process.env.RECO_MAX_MIX_DEFAULT || 3),
  },
};
