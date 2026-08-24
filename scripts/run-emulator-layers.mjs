import { spawnSync } from "node:child_process";

for (const script of ["test:integration:runner", "test:security:runner"]) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    console.error("No se pudo localizar el CLI de npm.");
    process.exit(2);
  }
  const result = spawnSync(process.execPath, [npmCli, "run", script], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit"
  });
  if (result.error || result.status !== 0) {
    if (result.error) console.error(result.error.message);
    process.exit(result.status ?? 2);
  }
}
