#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const skills = ['guokai-cs-proposal-review', 'guokai-cs-thesis-review'];
const targets = {
  qoder: { user: '.qoder-cn/skills', project: '.qoder/skills' },
  claude: { user: '.claude/skills', project: '.claude/skills' },
  codex: { user: '.agents/skills', project: '.agents/skills' },
  gemini: { user: '.gemini/skills', project: '.gemini/skills' },
  cursor: { user: '.cursor/skills', project: '.cursor/skills' },
  copilot: { user: '.copilot/skills', project: '.agents/skills' },
  agents: { user: '.agents/skills', project: '.agents/skills' },
};

function usage() {
  console.log(`Usage: node scripts/install-skills.cjs [options]

Options:
  --tool <qoder|claude|codex|gemini|cursor|copilot|agents|all>
  --scope <user|project>          Default: user
  --skill <name>                   Install one skill; repeat for multiple
  --force                          Replace an existing skill directory
  --dry-run                        Print destinations without writing
  --help                           Show this help`);
}

const args = process.argv.slice(2);
let tool = 'all';
let scope = 'user';
let force = false;
let dryRun = false;
const selectedSkills = [];

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--help') {
    usage();
    process.exit(0);
  }
  if (arg === '--force') {
    force = true;
    continue;
  }
  if (arg === '--dry-run') {
    dryRun = true;
    continue;
  }
  if (arg === '--tool' || arg === '--scope' || arg === '--skill') {
    const value = args[++i];
    if (!value) {
      console.error(`Missing value for ${arg}.`);
      process.exit(2);
    }
    if (arg === '--tool') tool = value;
    if (arg === '--scope') scope = value;
    if (arg === '--skill') selectedSkills.push(value);
    continue;
  }
  console.error(`Unknown option: ${arg}`);
  usage();
  process.exit(2);
}

if (tool !== 'all' && !Object.hasOwn(targets, tool)) {
  console.error(`Unsupported tool: ${tool}`);
  process.exit(2);
}
if (scope !== 'user' && scope !== 'project') {
  console.error(`Unsupported scope: ${scope}`);
  process.exit(2);
}
if (selectedSkills.some((skill) => !skills.includes(skill))) {
  console.error(`Unknown skill. Available: ${skills.join(', ')}`);
  process.exit(2);
}

const tools = tool === 'all' ? Object.keys(targets) : [tool];
const chosenSkills = selectedSkills.length ? [...new Set(selectedSkills)] : skills;
const destinations = new Map();
for (const name of tools) {
  const base = scope === 'user' ? path.join(os.homedir(), targets[name].user) : path.resolve(process.cwd(), targets[name].project);
  for (const skill of chosenSkills) destinations.set(path.join(base, skill), { tool: name, skill });
}

let failed = false;
for (const [destination, meta] of destinations) {
  if (fs.existsSync(destination) && !force) {
    console.error(`Exists: ${destination} (use --force to replace)`);
    failed = true;
    continue;
  }
  if (dryRun) {
    console.log(`would install ${meta.skill} for ${meta.tool} -> ${destination}`);
    continue;
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(path.join(repoRoot, meta.skill), destination, { recursive: true });
  console.log(`installed ${meta.skill} for ${meta.tool} -> ${destination}`);
}

if (failed) process.exitCode = 1;
