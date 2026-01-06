const http = require('http');
const querystring = require('querystring');

const PORT = 3000; // 假設本地伺服器 Port

// 輔助函式：發送請求
function request(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve({ 
            statusCode: res.statusCode, 
            headers: res.headers, 
            data: body ? JSON.parse(body) : null 
          });
        } catch (e) {
          resolve({ statusCode: res.statusCode, headers: res.headers, data: body });
        }
      });
    });

    req.on('error', (e) => reject(e));

    if (data) {
      req.write(data);
    }
    req.end();
  });
}

async function runTests() {
  console.log('🚀 開始原生 Node.js 全功能測試...\n');

  try {
    // ------------------------------------------------------------
    // 1. 測試一般用戶登入 (無密碼)
    // ------------------------------------------------------------
    console.log('🔹 [User] 測試無密碼登入...');
    const userData = JSON.stringify({ username: '0900999888', role: 'user' });
    const userRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(userData)
      }
    }, userData);

    if (userRes.statusCode === 200) {
      console.log('  ✅ 登入成功');
    } else {
      console.error('  ❌ 登入失敗:', userRes.data);
    }

    // ------------------------------------------------------------
    // 2. 測試 Admin 登入
    // ------------------------------------------------------------
    console.log('\n🔹 [Admin] 測試管理員登入...');
    const adminData = JSON.stringify({ username: 'admin', password: 'admin', role: 'admin' });
    const adminRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(adminData)
      }
    }, adminData);

    let adminCookie = '';
    if (adminRes.statusCode === 200) {
      console.log('  ✅ Admin 登入成功');
      const cookies = adminRes.headers['set-cookie'];
      if (cookies) adminCookie = cookies.map(c => c.split(';')[0]).join('; ');
    } else {
      console.error('  ❌ Admin 登入失敗:', adminRes.data);
      return; // Admin 登入失敗就無法測試後續
    }

    // ------------------------------------------------------------
    // 3. 測試會員列表排序 (created_at DESC)
    // ------------------------------------------------------------
    console.log('\n🔹 [Admin] 驗證會員列表排序 (created_at DESC)...');
    const listRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/users?page=1&limit=5',
      method: 'GET',
      headers: {
        'Cookie': adminCookie
      }
    });

    if (listRes.statusCode === 200 && listRes.data.success) {
      const users = listRes.data.users;
      if (users.length >= 2) {
        const time1 = new Date(users[0].created_at).getTime();
        const time2 = new Date(users[1].created_at).getTime();
        
        console.log(`  🔍 第一筆: ${users[0].username} (${users[0].created_at})`);
        console.log(`  🔍 第二筆: ${users[1].username} (${users[1].created_at})`);

        if (time1 >= time2) {
          console.log('  ✅ 排序正確: 時間倒序');
        } else {
          console.error('  ❌ 排序錯誤: 時間並非倒序');
        }
      } else {
        console.log('  ⚠️ 資料不足無法比較排序');
      }
    } else {
      console.error('  ❌ 獲取列表失敗:', listRes.data);
    }

  } catch (err) {
    console.error('測試失敗 (可能是伺服器未啟動):', err.message);
  }
}

runTests();

