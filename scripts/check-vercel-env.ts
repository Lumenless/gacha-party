import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { deploymentConfigIssues } from "../src/server/deployment-config";

if (!process.env.VERCEL && existsSync(".env.local")) loadEnvFile(".env.local");

const issues = deploymentConfigIssues();
if (issues.length) {
  console.error("Vercel deployment configuration is incomplete:\n");
  issues.forEach((issue) => console.error(`- ${issue}`));
  process.exit(1);
}
console.log("Vercel deployment environment is valid.");
