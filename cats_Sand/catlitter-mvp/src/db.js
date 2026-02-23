import mysql from "mysql2/promise";
import { config } from "./config.js";

export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

export async function exec(sql, params = []) {
  const [rows, meta] = await pool.execute(sql, params);
  // mysql2 for INSERT/UPDATE puts insertId/affectedRows on rows (ResultSetHeader).
  return { rows, meta: meta ?? rows };
}

export async function query(sql, params = []) {
  const { rows } = await exec(sql, params);
  return rows;
}
