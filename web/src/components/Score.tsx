export function Score({ value }: { value?: number }) {
  if (value === undefined) return <span className="score">–</span>;
  const tone = value >= 85 ? "good" : value >= 60 ? "ok" : "bad";
  return <span className={`score ${tone}`}>{value}</span>;
}
