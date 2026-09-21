module.exports = {
  apps: [
    {
      name: "flea-or-trader",
      cwd: "/home/debian/home/external-projects/flea-or-trader",
      script: "server/index.ts",
      interpreter: "/home/debian/.bun/bin/bun",
      env: { NODE_ENV: "production", PORT: "3007", HOST: "127.0.0.1" },
      max_memory_restart: "1G",
    },
  ],
};
