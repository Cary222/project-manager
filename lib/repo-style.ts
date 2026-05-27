const REPO_STYLES = [
  {
    border: "border-l-blue-500",
    badge: "bg-blue-100 text-blue-800",
    card: "hover:bg-blue-50/60",
  },
  {
    border: "border-l-emerald-500",
    badge: "bg-emerald-100 text-emerald-800",
    card: "hover:bg-emerald-50/60",
  },
  {
    border: "border-l-violet-500",
    badge: "bg-violet-100 text-violet-800",
    card: "hover:bg-violet-50/60",
  },
  {
    border: "border-l-amber-500",
    badge: "bg-amber-100 text-amber-800",
    card: "hover:bg-amber-50/60",
  },
  {
    border: "border-l-rose-500",
    badge: "bg-rose-100 text-rose-800",
    card: "hover:bg-rose-50/60",
  },
  {
    border: "border-l-cyan-500",
    badge: "bg-cyan-100 text-cyan-800",
    card: "hover:bg-cyan-50/60",
  },
] as const;

const BRANCH_STYLES = [
  "bg-sky-100 text-sky-800",
  "bg-orange-100 text-orange-800",
  "bg-lime-100 text-lime-800",
  "bg-fuchsia-100 text-fuchsia-800",
  "bg-teal-100 text-teal-800",
  "bg-pink-100 text-pink-800",
  "bg-indigo-100 text-indigo-800",
  "bg-yellow-100 text-yellow-900",
] as const;

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function repoShortName(repoPath: string) {
  const parts = repoPath.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? repoPath;
}

export function repoStyle(repoPath: string) {
  const style = REPO_STYLES[hashString(repoPath) % REPO_STYLES.length];
  return {
    name: repoShortName(repoPath),
    ...style,
  };
}

export function branchStyle(branch: string) {
  return BRANCH_STYLES[hashString(branch) % BRANCH_STYLES.length];
}
