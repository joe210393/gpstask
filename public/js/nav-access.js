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
  const navRoleMgmt = document.getElementById('navRoleMgmt');
  const navRedeem = document.getElementById('navRedeem');
  const navAdminUsers = document.getElementById('navAdminUsers');
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
    hide(navRoleMgmt);
    hide(navRedeem);
    hide(navAdminUsers);
    showReviewLinks(false);
    return;
  }

  if (loginUser.role === 'user') {
    show(navTasksList);
    show(navUserTasks);
    hide(navStaff);
    hide(navRoleMgmt);
    hide(navRedeem);
    hide(navAdminUsers);
    showReviewLinks(false);
  } else if (loginUser.role === 'staff') {
    // staff：只能審核，不顯示任務列表/用戶任務管理
    hide(navTasksList);
    hide(navUserTasks);
    hide(navStaff);
    hide(navRoleMgmt);
    hide(navRedeem);
    hide(navAdminUsers);
    showReviewLinks(true);
  } else {
    hide(navTasksList);
    hide(navUserTasks);
    show(navStaff);
    show(navRoleMgmt);
    show(navRedeem);
    // 僅 admin 顯示會員管理
    if (loginUser.role === 'admin') {
      show(navAdminUsers);
    } else {
      hide(navAdminUsers);
    }
    showReviewLinks(true);
  }
});

