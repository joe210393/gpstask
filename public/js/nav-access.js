document.addEventListener('DOMContentLoaded', () => {
  let loginUser = window.loginUser;
  if (!loginUser) {
    try {
      loginUser = JSON.parse(localStorage.getItem('loginUser') || 'null');
      if (loginUser) {
        window.loginUser = loginUser;
      }
    } catch (err) {
      loginUser = null;
    }
  }

  const navTasksList = document.getElementById('navTasksList');
  const navUserTasks = document.getElementById('navUserTasks');
  const navStaff = document.getElementById('navStaff');
  const navRedeem = document.getElementById('navRedeem');
  const reviewLinks = document.querySelectorAll('a[href="/user-tasks.html"]');

  const show = el => { if (el) el.style.display = ''; };
  const hide = el => { if (el) el.style.display = 'none'; };

  const showReviewLinks = isVisible => {
    reviewLinks.forEach(link => {
      if (isVisible) {
        link.style.display = '';
      } else {
        link.style.display = 'none';
      }
    });
  };

  if (!loginUser) {
    // 未登入：僅保留一般頁面
    show(navTasksList);
    hide(navUserTasks);
    hide(navStaff);
    hide(navRedeem);
    showReviewLinks(false);
    return;
  }

  if (loginUser.role === 'user') {
    show(navTasksList);
    show(navUserTasks);
    hide(navStaff);
    hide(navRedeem);
    showReviewLinks(false);
  } else if (loginUser.role === 'staff') {
    // staff：只能審核，不顯示任務列表/用戶任務管理
    hide(navTasksList);
    hide(navUserTasks);
    hide(navStaff);
    hide(navRedeem);
    showReviewLinks(true);
  } else {
    hide(navTasksList);
    hide(navUserTasks);
    show(navStaff);
    show(navRedeem);
    showReviewLinks(true);
  }
});

