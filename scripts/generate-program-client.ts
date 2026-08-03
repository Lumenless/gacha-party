import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createFromRoot } from "codama";
import { rootNodeFromAnchor, type AnchorIdl } from "@codama/nodes-from-anchor";
import { renderVisitor } from "@codama/renderers-js";

async function main() {
  const repositoryRoot = resolve(process.cwd());
  const idlPath = resolve(repositoryRoot, "target/idl/gacha_party_room.json");
  const outputFolder = resolve(repositoryRoot, "src/integrations/solana/program-client/src/generated");

  if (!existsSync(idlPath)) {
    throw new Error(`Anchor IDL not found at ${idlPath}. Run pnpm build:program first.`);
  }

  const idl = JSON.parse(readFileSync(idlPath, "utf8")) as AnchorIdl;
  const codama = createFromRoot(rootNodeFromAnchor(idl));

  await codama.accept(renderVisitor(outputFolder, {
    useGranularImports: false,
    formatCode: false,
  }));

  console.log("Generated the Gacha Party room client from the Anchor IDL.");
}

void main();
