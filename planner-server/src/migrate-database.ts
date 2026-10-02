import { Config } from "./Config";
import { DbUtilsInit } from "./utils/DbUtils";
import { RunMigrations } from "./DbMigrations";

// Standalone migration runner: `npm run migrate`
Promise.resolve()
  .then(async () => {
    const config = new Config();
    await config.reload();
    await DbUtilsInit(config);
    await RunMigrations();
    console.log("Migrations complete");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  });
