const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
require("dotenv").config({
  path: path.join(root, ".env.local"),
  override: true,
  quiet: true,
});
process.env.NODE_ENV = "development";
function assertLocalDatabase() {
  const url = new URL(process.env.DATABASE_URL);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/joe_wilson_dev"
  ) {
    throw new Error(
      "Local commands require a loopback PostgreSQL URL for joe_wilson_dev in .env.local",
    );
  }
  return url;
}
function run(script, args = [], cwd = root, label = script) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  child.on("error", () => console.error("Unable to start " + label));
  return child;
}
function wait(child) {
  return new Promise((resolve, reject) => {
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("Command failed")),
    );
    child.once("error", reject);
  });
}
async function main() {
  const url = assertLocalDatabase();
  const action = process.argv[2];
  if (action === "database") {
    const { PrismaClient } = require("@prisma/client");
    const adminUrl = new URL(url);
    adminUrl.pathname = "/postgres";
    const admin = new PrismaClient({
      datasources: { db: { url: adminUrl.toString() } },
    });
    try {
      const existing =
        await admin.$queryRaw`SELECT datname FROM pg_database WHERE datname = 'joe_wilson_dev'`;
      if (!existing.length)
        await admin.$executeRawUnsafe('CREATE DATABASE "joe_wilson_dev"');
    } finally {
      await admin.$disconnect();
    }
    await wait(
      run(require.resolve("prisma/build/index.js"), ["migrate", "deploy"]),
    );
    console.log("Local development database is ready.");
    return;
  }
  if (action === "video") {
    await wait(
      run(require.resolve("tsx/cli"), [
        "watch",
        "src/jobs/transcode.worker.ts",
      ]),
    );
    return;
  }
  if (action === "seed") {
    await wait(run(require.resolve("tsx/cli"), ["scripts/local-seed.ts"]));
    return;
  }
  if (action === "accounts") {
    console.log(
      "Local owner: " +
        process.env.SEED_OWNER_EMAIL +
        "\nPassword: " +
        process.env.SEED_OWNER_PASSWORD,
    );
    console.log(
      "Local member: " +
        process.env.SEED_MEMBER_EMAIL +
        "\nPassword: " +
        process.env.SEED_MEMBER_PASSWORD,
    );
    return;
  }
  if (action !== "start")
    throw new Error("Use start, database, seed, accounts or video");
  const ui =
    process.env.UI_DIRECTORY ||
    path.resolve(
      root,
      "../joe-wilson-portfolio-main/joe-wilson-portfolio-main",
    );
  for (const file of [
    "apps/client/vite.config.ts",
    "apps/admin/vite.config.ts",
    "node_modules/vite/bin/vite.js",
  ]) {
    if (!fs.existsSync(path.join(ui, file)))
      throw new Error(
        "UI directory or dependencies missing. Set UI_DIRECTORY and run npm ci in the UI root.",
      );
  }
  const children = [
    run(require.resolve("tsx/cli"), ["watch", "src/server.ts"]),
  ];
  if (process.env.STORAGE_DRIVER === "local")
    children.push(
      run(require.resolve("tsx/cli"), [
        "watch",
        "src/jobs/transcode.worker.ts",
      ]),
    );
  for (const app of ["client", "admin"])
    children.push(
      run(
        path.join(ui, "node_modules/vite/bin/vite.js"),
        [],
        path.join(ui, "apps", app),
        app,
      ),
    );
  console.log(
    "Public UI: http://localhost:3000\nAdmin UI: http://localhost:5174\nAPI: http://localhost:3001\nEmails and reset links appear in this terminal. No Redis or Docker needed. Local storage also starts the FFmpeg video worker.",
  );
  let stopping = false;
  function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    for (const child of children) {
      if (process.platform === "win32")
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      else child.kill("SIGTERM");
    }
    setTimeout(() => process.exit(code), 500).unref();
  }
  for (const child of children) child.on("exit", (code) => stop(code || 0));
  process.on("SIGINT", () => stop());
  process.on("SIGTERM", () => stop());
}
main().catch((error) => {
  console.error(
    "Local setup failed: " +
      (error.code === "P1000"
        ? "PostgreSQL credentials were rejected; check .env.local"
        : error.code === "P1001"
          ? "PostgreSQL is unreachable; check that the local service is running"
          : error.message),
  );
  process.exitCode = 1;
});
