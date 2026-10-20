/* eslint-disable prettier/prettier */
const path = require("path");

module.exports = function override(config) {
  config.resolve.alias = {
    ...config.resolve.alias,
    "@root": path.resolve(__dirname, "src"),
    "@components": path.resolve(__dirname, "src/components"),
    "@utils": path.resolve(__dirname, "src/utils"),
    "@screens": path.resolve(__dirname, "src/screens"),
    "@models": path.resolve(__dirname, "src/models"),
    "@hooks": path.resolve(__dirname, "src/hooks"),
    "@DAL": path.resolve(__dirname, "src/DAL"),
    "@contexts": path.resolve(__dirname, "src/contexts"),
    "@app": path.resolve(__dirname, "src/app"),
  };

  // No source maps in the production bundle. server.ts serves client/build via
  // express.static, so a .js.map under it is fetchable by URL — which hands any participant
  // the full client source, including the admin UI and the study's screen flow.
  //
  // Set here rather than in .env.production (GENERATE_SOURCEMAP=false) because this file is
  // tracked and that one is not: a fresh clone would silently lose the setting.
  if (config.mode === "production") {
    config.devtool = false;
  }

  return config;
};
