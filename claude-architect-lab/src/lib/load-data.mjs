import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DATA_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "mcp-server",
  "data",
);

let stateDataset;
let clientDataset;

export function loadStateDataset() {
  if (!stateDataset) {
    stateDataset = JSON.parse(
      readFileSync(path.join(DATA_DIR, "state-mtl-requirements.json"), "utf8"),
    );
  }
  return stateDataset;
}

export function loadClientDataset() {
  if (!clientDataset) {
    clientDataset = JSON.parse(
      readFileSync(path.join(DATA_DIR, "clients.json"), "utf8"),
    );
  }
  return clientDataset;
}
