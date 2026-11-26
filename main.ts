// main.ts — Token Radar entry program (Node 22, standard library only).
//
// Reads the sealed snapshot, builds the ranked board, writes the
// dashboard's data, copies the dashboard and screenshots, and writes
// dossier.json LAST with buildDossier from vendor/makefun-board.ts.
//
//   node main.ts [--input /input/snapshot.json]
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input kit/input/snapshot.json
//
// Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output.

import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import { boardIssue, buildBoard, dataScript, parseSnapshot } from './lib/model.ts';

const repoRoot = dirname(fileURLToPath(import.meta.url));

function flagValue(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

function main(): void {
  const argv = process.argv.slice(2);
  const inputPath = flagValue(argv, '--input') ?? '/input/snapshot.json';
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

  const snapshot = parseSnapshot(JSON.parse(readFileSync(inputPath, 'utf8')));
  const board = buildBoard(snapshot);
  const issues = boardIssue(board.rows, snapshot.watchlist);
  if (issues.length > 0) {
    throw new Error(`board failed its checks:\n- ${issues.join('\n- ')}`);
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'board.json'), JSON.stringify({ rows: board.rows }) + '\n', 'utf8');
  writeFileSync(join(outDir, 'data.js'), dataScript(board), 'utf8');
  cpSync(join(repoRoot, 'dashboard'), join(outDir, 'dashboard'), { recursive: true });
  cpSync(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });

  // Dossier last: it is written from the finished dashboard/ and screenshots/.
  const dossier = buildDossier(outDir, {
    text_max_bytes: 65536,
    screenshots: { max: 4, max_bytes: 524288 },
    dashboard: { max_files: 400, max_bytes: 4194304 },
  });
  writeFileSync(join(outDir, 'dossier.json'), dossier);

  console.log(
    `Token Radar: ${board.rows.length} board rows, ${board.live.length} live rows, ` +
      `snapshot ${snapshot.as_of}, wrote ${outDir}`,
  );
}

main();
