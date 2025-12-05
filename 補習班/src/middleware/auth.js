export function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

export function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') return next();
  return res.status(403).json({ error: 'Forbidden' });
}

// 允許 editor 或 admin（編輯者可以管理除使用者外之後台功能）
export function requireEditorOrAdmin(req, res, next) {
  if (req.session && req.session.user && (req.session.user.role === 'admin' || req.session.user.role === 'editor')) return next();
  return res.status(403).json({ error: 'Forbidden' });
}


