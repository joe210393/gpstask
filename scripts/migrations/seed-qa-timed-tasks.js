const mysql = require('mysql2/promise');
const { getDbConfig } = require('../../db-config');

const dbConfig = getDbConfig();

const SEED_TASKS = [
  {
    name: '[測試] 問答體驗關',
    lat: 24.59855,
    lng: 121.52885,
    radius: 80,
    points: 30,
    description: '【測試用 qa 單題】請描述你在此地點看到的最有趣的事物（開放式問答，提交後需等待工作人員審核）。',
    photoUrl: '/images/mascot.png',
    task_type: 'qa',
    type: 'single',
    correct_answer: null
  },
  {
    name: '[測試] 限時選擇題',
    lat: 24.59885,
    lng: 121.52915,
    radius: 80,
    points: 50,
    description: '【測試用限時任務】在限時期間內完成此選擇題。題目：GPS 任務系統主要使用哪種定位技術？',
    photoUrl: '/images/feature-map.png',
    task_type: 'multiple_choice',
    type: 'timed',
    options: JSON.stringify(['衛星定位 (GPS)', 'Wi-Fi 定位', '藍牙定位', '紅外線定位']),
    correct_answer: '衛星定位 (GPS)',
    time_limit_start: new Date(Date.now() - 24 * 60 * 60 * 1000),
    time_limit_end: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    max_participants: 200
  }
];

async function seed() {
  let connection;
  try {
    console.log('🔄 檢查 qa / 限時任務測試資料...');
    connection = await mysql.createConnection(dbConfig);

    let inserted = 0;
    for (const task of SEED_TASKS) {
      const [existing] = await connection.execute(
        'SELECT id FROM tasks WHERE name = ? LIMIT 1',
        [task.name]
      );
      if (existing.length > 0) {
        console.log(`ℹ️  已存在，跳過：${task.name} (#${existing[0].id})`);
        continue;
      }

      await connection.execute(
        `INSERT INTO tasks (
          name, lat, lng, radius, points, description, photoUrl, iconUrl,
          task_type, options, correct_answer, type,
          time_limit_start, time_limit_end, max_participants, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '/images/flag-red.png', ?, ?, ?, ?, ?, ?, ?, 'admin')`,
        [
          task.name,
          task.lat,
          task.lng,
          task.radius,
          task.points,
          task.description,
          task.photoUrl,
          task.task_type,
          task.options || null,
          task.correct_answer,
          task.type,
          task.time_limit_start || null,
          task.time_limit_end || null,
          task.max_participants || null
        ]
      );
      inserted += 1;
      console.log(`✅ 已新增：${task.name}`);
    }

    if (inserted === 0) {
      console.log('✅ qa / 限時測試任務已就緒（無需新增）');
    } else {
      console.log(`✅ 共新增 ${inserted} 筆測試任務`);
    }

    // 修復：劇情線拍照已上傳但未審核的紀錄，改為自動完成（補發積分若尚未記錄）
    const [stuck] = await connection.execute(`
      SELECT ut.id, ut.user_id, ut.task_id, t.name, t.points
      FROM user_tasks ut
      JOIN tasks t ON ut.task_id = t.id
      WHERE ut.status = '進行中'
        AND t.task_type = 'photo'
        AND t.quest_chain_id IS NOT NULL
        AND ut.answer IS NOT NULL AND TRIM(ut.answer) != ''
    `);
    for (const row of stuck) {
      await connection.execute(
        `UPDATE user_tasks SET status = '完成', finished_at = COALESCE(finished_at, NOW()) WHERE id = ?`,
        [row.id]
      );
      if (row.points > 0) {
        const [tx] = await connection.execute(
          `SELECT id FROM point_transactions
           WHERE user_id = ? AND reference_type = 'task_completion' AND reference_id = ?`,
          [row.user_id, row.task_id]
        );
        if (tx.length === 0) {
          await connection.execute(
            `INSERT INTO point_transactions (user_id, type, points, description, reference_type, reference_id)
             VALUES (?, 'earned', ?, ?, 'task_completion', ?)`,
            [row.user_id, row.points, `完成任務: ${row.name}`, row.task_id]
          );
        }
      }
    }
    if (stuck.length > 0) {
      console.log(`✅ 已自動完成 ${stuck.length} 筆卡住的劇情拍照任務`);
    }
  } catch (err) {
    console.error('❌ seed-qa-timed-tasks 失敗:', err.message);
    process.exitCode = 1;
  } finally {
    if (connection) await connection.end();
  }
}

seed();
