const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');

// 設定測試目標
const BASE_URL = 'http://localhost:3000'; // 假設本地伺服器運行中，如果是在 Zeabur 則需改網址
// 為了測試，我們先假設是在本地環境運行，或者您提供 Zeabur 網址
// 這裡我們先用 localhost，如果失敗代表環境沒起起來

// 模擬用戶資料
const TEST_USER_PHONE = '0900999888';
const ADMIN_CREDENTIALS = { username: 'admin', password: 'admin', role: 'admin' };

async function runTests() {
  console.log('🚀 開始全功能整合測試...\n');

  try {
    // ------------------------------------------------------------
    // 1. 測試一般用戶登入 (無密碼)
    // ------------------------------------------------------------
    console.log('🔹 [User] 測試無密碼登入/註冊...');
    let userCookie = '';
    try {
      const loginRes = await axios.post(`${BASE_URL}/api/login`, {
        username: TEST_USER_PHONE,
        role: 'user'
      });
      console.log('  ✅ 登入成功:', loginRes.data.user.username);
      // 取得 Cookie
      const cookies = loginRes.headers['set-cookie'];
      if (cookies) userCookie = cookies.map(c => c.split(';')[0]).join('; ');
    } catch (err) {
      console.error('  ❌ 登入失敗:', err.response ? err.response.data : err.message);
      return;
    }

    // ------------------------------------------------------------
    // 2. 測試 Admin 登入與權限
    // ------------------------------------------------------------
    console.log('\n🔹 [Admin] 測試管理員登入...');
    let adminCookie = '';
    try {
      const adminLoginRes = await axios.post(`${BASE_URL}/api/login`, ADMIN_CREDENTIALS);
      console.log('  ✅ Admin 登入成功');
      const cookies = adminLoginRes.headers['set-cookie'];
      if (cookies) adminCookie = cookies.map(c => c.split(';')[0]).join('; ');
    } catch (err) {
      console.error('  ❌ Admin 登入失敗:', err.response ? err.response.data : err.message);
      return;
    }

    // ------------------------------------------------------------
    // 3. 測試新功能：Excel 匯入會員 (API 模擬)
    // ------------------------------------------------------------
    console.log('\n🔹 [Admin] 測試 Excel 匯入會員 API...');
    
    // 建立一個虛擬的 Excel 檔案內容 (這裡用簡單的 CSV 模擬，但 API 吃 Excel)
    // 為了測試方便，我們直接構造 Multipart Request，但不傳真實 Excel，看 API 是否會擋
    // 或是我們測試一個邊界情況：沒有檔案
    
    try {
      const form = new FormData();
      form.append('simulateActivity', 'true');
      form.append('startDate', '2026-01-01');
      form.append('endDate', '2026-01-31');
      
      // 注意：這裡因為無法在純 Node 環境簡單生成 Excel Buffer 傳送，
      // 我們主要測試 "未上傳檔案" 的錯誤處理，確認 API 活著
      await axios.post(`${BASE_URL}/api/admin/import-users`, form, {
        headers: {
          ...form.getHeaders(),
          Cookie: adminCookie
        }
      });
    } catch (err) {
      if (err.response && err.response.status === 400 && err.response.data.message.includes('Excel')) {
        console.log('  ✅ API 正常運作 (正確回傳「請上傳 Excel」錯誤)');
      } else {
        console.error('  ❌ API 異常:', err.response ? err.response.data : err.message);
      }
    }

    // ------------------------------------------------------------
    // 4. 測試會員列表排序 (新功能驗收)
    // ------------------------------------------------------------
    console.log('\n🔹 [Admin] 驗證會員列表排序...');
    try {
      const listRes = await axios.get(`${BASE_URL}/api/admin/users?page=1&limit=5`, {
        headers: { Cookie: adminCookie }
      });
      
      const users = listRes.data.users;
      if (users.length >= 2) {
        // 檢查時間順序
        const time1 = new Date(users[0].created_at).getTime();
        const time2 = new Date(users[1].created_at).getTime();
        if (time1 >= time2) {
          console.log('  ✅ 排序正確: 新註冊者排在前面');
        } else {
          console.error('  ❌ 排序錯誤: 舊註冊者排在前面');
        }
      } else {
        console.log('  ⚠️ 用戶數不足以驗證排序，但 API 回傳正常');
      }
    } catch (err) {
      console.error('  ❌ 獲取列表失敗:', err.message);
    }

    console.log('\n🚀 測試結束');

  } catch (err) {
    console.error('測試過程發生未預期錯誤:', err);
  }
}

runTests();

