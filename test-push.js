// 測試推送通知功能
const webpush = require('web-push');

// 從環境變數讀取 VAPID 金鑰
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BAEo9iJgNkb9JeFoZZqBQLGGLukhyvmSsOyWI-g614JPO0KxVjAUPun0olA0IhGyli64_vdq0KuJEM6RnT0deVs';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'xCp-3gOayGlZq9uyC7pzt1oHsqEGqLs5Q9TO0qMZ_ng';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:joe210393@gmail.com';

// 設定 VAPID
webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

console.log('🔑 VAPID 配置:');
console.log('Public Key:', VAPID_PUBLIC_KEY.substring(0, 30) + '...');
console.log('Subject:', VAPID_SUBJECT);
console.log('');

// 檢查金鑰格式
if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('❌ 錯誤: VAPID 金鑰未設定');
  process.exit(1);
}

if (VAPID_PUBLIC_KEY.length < 80 || VAPID_PRIVATE_KEY.length < 40) {
  console.error('❌ 錯誤: VAPID 金鑰格式不正確');
  process.exit(1);
}

console.log('✅ VAPID 金鑰格式驗證通過');
console.log('');
console.log('📝 使用說明:');
console.log('1. 確保環境變數已正確設定');
console.log('2. 啟動伺服器後，檢查控制台是否顯示 "✅ Web Push (VAPID) 已初始化"');
console.log('3. 用戶登入後，系統會自動嘗試訂閱推送通知');
console.log('4. 完成任務時，系統會自動發送推送通知');
console.log('');
console.log('🧪 測試步驟:');
console.log('1. 訪問網站並登入');
console.log('2. 允許瀏覽器的通知權限');
console.log('3. 完成一個任務');
console.log('4. 檢查是否收到推送通知');
console.log('');
console.log('✅ 配置檢查完成！');

