module.exports = {
  apps: [
    {
      name: "boba-fett-web",
      script: "server.js",
      instances: "max",
      exec_mode: "cluster",
      env: {
        PORT: 3000,
        NODE_ENV: "production",
      },
    },
  ],
};
