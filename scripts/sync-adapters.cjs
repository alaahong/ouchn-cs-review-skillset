#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const skills = ['guokai-cs-proposal-review', 'guokai-cs-thesis-review'];
const adapterRoots = ['.agents/skills', '.qoder/skills'];
const checkOnly = process.argv.includes('--check');

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? listFiles(full) : [full];
    })
    .sort();
}

function sameTree(source, target) {
  const sourceFiles = listFiles(source);
  const targetFiles = listFiles(target);
  if (sourceFiles.length !== targetFiles.length) return false;
  return sourceFiles.every((file, index) => {
    const relative = path.relative(source, file);
    const targetFile = path.join(target, relative);
    return targetFiles[index] === targetFile && fs.readFileSync(file).equals(fs.readFileSync(targetFile));
  });
}

function validateSkill(name) {
  const file = path.join(root, name, 'SKILL.md');
  const text = fs.readFileSync(file, 'utf8');
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  const errors = [];
  if (!frontmatter) return ['missing YAML frontmatter'];
  const nameLine = frontmatter[1].split(/\r?\n/).find((line) => line.startsWith('name:'));
  const descriptionLine = frontmatter[1].split(/\r?\n/).find((line) => line.startsWith('description:'));
  const declaredName = nameLine ? nameLine.slice('name:'.length).trim() : '';
  const description = descriptionLine ? descriptionLine.slice('description:'.length).trim() : '';
  if (declaredName !== name) errors.push(`name must be ${name}`);
  if (!/^[a-z0-9-]+$/.test(declaredName)) errors.push('name must use lowercase letters, digits, and hyphens');
  if (!description) errors.push('description is required');
  if (description.length > 1024) errors.push('description exceeds 1024 characters');
  if (text.slice(frontmatter[0].length).split(/\r?\n/).length >= 500) errors.push('SKILL.md body must stay under 500 lines');
  if (/\bTODO:/.test(text)) errors.push('unresolved TODO marker');
  return errors;
}

let failed = false;
for (const skill of skills) {
  for (const error of validateSkill(skill)) {
    console.error(`${skill}: ${error}`);
    failed = true;
  }
}

for (const adapterRoot of adapterRoots) {
  for (const skill of skills) {
    const source = path.join(root, skill);
    const target = path.join(root, adapterRoot, skill);
    if (sameTree(source, target)) {
      if (checkOnly) console.log(`up-to-date ${path.relative(root, target)}`);
      continue;
    }
    if (checkOnly) {
      console.error(`out-of-date ${path.relative(root, target)}`);
      failed = true;
      continue;
    }
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true });
    console.log(`synced ${path.relative(root, target)}`);
  }
}

if (failed) {
  console.error(checkOnly ? 'Adapter validation failed.' : 'Skill validation failed.');
  process.exitCode = 1;
}
