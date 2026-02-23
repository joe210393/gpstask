export function dist3(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function knn(points, target, k) {
  return points
    .map((p) => ({ ...p, d: dist3(p, target) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, k);
}
