import { claudeCode, interactive } from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";

async function main() {
  await interactive({
    agent: claudeCode("claude-opus-4-8"),
    sandbox: noSandbox(),
    promptFile: "./.sandcastle/prompt.md",
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
