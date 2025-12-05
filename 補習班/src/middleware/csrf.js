export function exposeCsrfToken(req, res) {
  const token = req.csrfToken();
  res.json({ csrfToken: token });
}


