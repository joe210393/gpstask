import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function safeRmDir(dir) {
  try {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach((f) => {
      const p = path.join(dir, f);
      try {
        const st = fs.statSync(p);
        if (st.isDirectory()) {
          safeRmDir(p);
        } else {
          fs.unlinkSync(p);
        }
      } catch {}
    });
  } catch {}
}

async function main() {
  // 1) 清空檔案：上傳與私有上傳、log
  const publicDir = path.join(__dirname, '..', '..', 'public');
  const uploadsDir = path.join(publicDir, 'uploads');
  const legacyMemberDir = path.join(publicDir, 'member_uploads');
  const privateMemberDir = path.join(__dirname, '..', '..', 'private_member_uploads');
  const logsDir = path.join(__dirname, '..', '..', 'logs');

  safeRmDir(uploadsDir);
  safeRmDir(legacyMemberDir);
  safeRmDir(privateMemberDir);
  safeRmDir(logsDir);

  // 2) 清空資料表（保留 schema）
  const tables = [
    'contacts',
    'course_materials',
    'course_contents',
    'slides',
    'media',
    'materials', // 若不存在會忽略錯誤
    'leaderboard',
    'news',
    'posts',
    'plans',
    'trial_contents',
    'menus',
    'pages',
    'members'
  ];
  for (const t of tables) {
    try { await query(`TRUNCATE TABLE ${t}`); } catch {}
  }
  // 使用者清空後讓 seed 再建立 admin/admin
  try { await query('TRUNCATE TABLE users'); } catch {}
  // 設定可選擇保留或清空，這裡保留（如需清空取消註解）
  // try { await query('TRUNCATE TABLE settings'); } catch {}

  // 3) 重新執行 seed 邏輯（建置預設資料）
  const { default: runSeed } = await import('./seed.js');
}

main().then(()=>{ console.log('Clean done'); process.exit(0); }).catch((e)=>{ console.error(e); process.exit(1); });


