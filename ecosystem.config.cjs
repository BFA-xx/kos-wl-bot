// PM2 process definitions for a VPS deployment (no Docker).
//   pnpm build && pm2 start ecosystem.config.cjs
//
// Run from the repo root. The bot loads .env from the repo root via dotenv;
// the dashboard reads apps/dashboard/.env(.local) per Next.js conventions.
module.exports = {
  apps: [
    {
      name: "kos-bot",
      cwd: __dirname,
      script: "apps/bot/dist/index.js",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "400M",
      autorestart: true,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "kos-dashboard",
      cwd: __dirname + "/apps/dashboard",
      script: "node_modules/.bin/next",
      args: "start -p 3001",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "400M",
      autorestart: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
