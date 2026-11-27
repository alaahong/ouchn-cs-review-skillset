#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const FILE = process.argv[2];
const JSON_ONLY = process.argv.includes('--json');
if (!FILE || !fs.existsSync(FILE)) {
  console.error('用法: node extract_metrics.cjs <论文.docx|.pdf|.txt> [--json]');
  process.exit(2);
}

const decodeXml = (s) => s
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&');

function readDocx(file) {
  const xml = cp.execFileSync('unzip', ['-p', file, 'word/document.xml'], { maxBuffer: 256 * 1024 * 1024 }).toString('utf8');
  let stylesXml = '';
  try {
    stylesXml = cp.execFileSync('unzip', ['-p', file, 'word/styles.xml'], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
  } catch (_) { /* styles.xml 缺失时按无样式处理 */ }

  const styleLevel = {};
  const styleName = {};
  const styleSz = {};
  const sre = /<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g;
  let m;
  while ((m = sre.exec(stylesXml))) {
    const tag = m[1];
    const body = m[2];
    if (!/w:type="paragraph"/.test(tag)) continue;
    const id = (tag.match(/w:styleId="([^"]+)"/) || [])[1];
    if (!id) continue;
    const name = (body.match(/<w:name w:val="([^"]+)"/) || [])[1] || '';
    styleName[id] = name || id;
    const szm = body.match(/<w:sz w:val="(\d+)"/);
    if (szm) styleSz[id] = szm[1];
    const outline = (body.match(/<w:outlineLvl w:val="(\d+)"/) || [])[1];
    const hm = name.match(/(?:heading|标题)\s*([1-9])/i);
    if (hm) styleLevel[id] = Number(hm[1]);
    else if (outline !== undefined && Number(outline) < 9) styleLevel[id] = Number(outline) + 1;
  }

  const paras = [];
  const pre = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  while ((m = pre.exec(xml))) {
    const body = m[1];
    const pStyle = (body.match(/<w:pStyle w:val="([^"]+)"/) || [])[1] || '';
    let text = '';
    const tre = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
    let t;
    while ((t = tre.exec(body))) text += decodeXml(t[1]);
    text = text.replace(/\s+/g, ' ').trim();
    if (text) paras.push({ text, style: pStyle, level: styleLevel[pStyle] || 0 });
  }

  let pages = null;
  try {
    const app = cp.execFileSync('unzip', ['-p', file, 'docProps/app.xml'], { maxBuffer: 16 * 1024 * 1024 }).toString('utf8');
    pages = Number((app.match(/<Pages>(\d+)<\/Pages>/) || [])[1]) || null;
  } catch (_) { /* 无 app.xml */ }
  return { paras, pages, kind: 'docx', xml, styleName, styleSz };
}

function readPdf(file) {
  const out = cp.execFileSync('pdftotext', ['-enc', 'UTF-8', '-layout', file, '-'], { maxBuffer: 256 * 1024 * 1024 }).toString('utf8');
  const pages = (out.match(/\f/g) || []).length;
  const lines = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return { paras: lines.map((text) => ({ text, style: '', level: 0 })), pages, kind: 'pdf' };
}

function readTxt(file) {
  const out = fs.readFileSync(file, 'utf8');
  const lines = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return { paras: lines.map((text) => ({ text, style: '', level: 0 })), pages: null, kind: 'txt' };
}

function detectHeading(text, level) {
  if (level) return level;
  if (text.length > 50) return 0;
  if (/^第\s*[一二三四五六七八九十百0-9]+\s*章/.test(text)) return 1;
  if (/^[一二三四五六七八九十]+、/.test(text)) return 1;
  if (/^(摘\s*要|目\s*录|参考文献|致\s*谢)\s*$/.test(text)) return 1;
  if (/^Abstract\s*$/i.test(text)) return 1;
  if (/^附\s*录\s*([A-Za-z]|[一二三四五六七八九十])?\s*\S{0,15}$/.test(text)) return 1;
  if (/^\d+\.\d+\.\d+\s+\S/.test(text)) return 3;
  if (/^\d+\.\d+\s+\S/.test(text)) return 2;
  if (/^\d+[\.、](绪论|引言|结论|总结)/.test(text)) return 1;
  if (/^\d+[\.、]\s+\S/.test(text) && !/[。；;]$/.test(text)) return 1;
  return 0;
}

// 取最后一次出现的独立标题，避开目录中的同名条目
function findStandaloneHeading(re) {
  let idx = -1;
  for (let i = 0; i < paras.length; i++) {
    if (re.test(paras[i].text)) idx = i;
  }
  return idx;
}

function collectSection(startIdx, stopRe) {
  const buf = [];
  for (let i = startIdx + 1; i < paras.length; i++) {
    const t = paras[i].text;
    if (stopRe.test(t)) break;
    if (paras[i].heading === 1) break;
    if (/^[IVXLC\d]+$/.test(t)) continue;
    buf.push(t);
  }
  return buf;
}

const ext = path.extname(FILE).toLowerCase();
let doc;
try {
  if (ext === '.docx') doc = readDocx(FILE);
  else if (ext === '.pdf') doc = readPdf(FILE);
  else if (ext === '.txt') doc = readTxt(FILE);
  else {
    console.error('不支持的文件类型: ' + ext + '（请提供 .docx/.pdf/.txt）');
    process.exit(2);
  }
} catch (e) {
  console.error('提取失败: ' + e.message);
  const need = ext === '.pdf' ? 'pdftotext' : 'unzip';
  console.error('请确认已安装 ' + need + '，或改用其他格式。');
  process.exit(1);
}

const paras = doc.paras;
const styledHeadings = paras.filter((p) => p.level > 0).length;
const useTextPatterns = doc.kind !== 'docx' || styledHeadings === 0;
paras.forEach((p) => { p.heading = p.level || (useTextPatterns ? detectHeading(p.text, 0) : 0); });

const allText = paras.map((p) => p.text).join('\n');
const cjkCount = (s) => (s.match(/[\u4e00-\u9fff]/g) || []).length;
const findIdx = (re, from = 0) => paras.findIndex((p, i) => i >= from && re.test(p.text));

let abstractIdx = findStandaloneHeading(/^(中文)?摘\s*要\s*$/);
if (abstractIdx < 0) abstractIdx = findIdx(/^摘\s*要[：:]\s*/);
let abstractText = '';
if (abstractIdx >= 0) {
  const inline = paras[abstractIdx].text.replace(/^(中文)?摘\s*要[：:]?\s*/, '').trim();
  const buf = inline ? [inline] : collectSection(abstractIdx, /^关\s*键\s*词/);
  abstractText = buf.join('');
}
const abstractCjk = cjkCount(abstractText);
const kwMatch = allText.match(/关\s*键\s*词[：:]\s*([^\n]+)/);
const keywords = kwMatch ? kwMatch[1].split(/[；;，,、]\s*/).filter(Boolean) : [];

const enIdx = findStandaloneHeading(/^Abstract\s*$/i);
let enAbstract = '';
if (enIdx >= 0) {
  enAbstract = collectSection(enIdx, /^Key\s*words?\b/i).join(' ');
}
const enWords = (enAbstract.match(/[A-Za-z][A-Za-z'-]*/g) || []).length;

const refIdx = Math.max(findIdx(/^参考文献\s*$/), findIdx(/^参考文献[：:]/));
let refText = '';
if (refIdx >= 0) {
  const buf = [];
  for (let i = refIdx + 1; i < paras.length; i++) {
    if (/^(致\s*谢|附\s*录)/.test(paras[i].text)) break;
    buf.push(paras[i].text);
  }
  refText = buf.join('\n');
}
const refNums = new Set();
let rm;
const rre = /\[(\d{1,3})\]/g;
while ((rm = rre.exec(refText))) refNums.add(rm[1]);
let refTotal = refNums.size;
if (!refTotal) refTotal = (refText.match(/^\s*\d+[\.、]/gm) || []).length;
const currentYear = new Date().getFullYear();
const cutoff = currentYear - 5;
const refLines = refText.split(/\n/).filter((l) => /\S/.test(l));
// 年份与语种按“条”判定：整段扫年份会把访问日期、页码区间、会议名里的年份都算进来，条数会超过文献总数
const refCore = (l) => l.replace(/https?:\/\/\S+/gi, ' ').replace(/doi\s*:\s*\S+/gi, ' ')
  .replace(/\[\s*(?:19|20)\d{2}[-/年]\d{1,2}[-/月]\d{1,2}\s*\]/g, ' ')
  .replace(/\b\d{1,4}\s*[-–—]\s*\d{1,4}\b/g, ' ');
let recentRefs = 0;
let foreignRefs = 0;
let noYearRefs = 0;
refLines.forEach((l) => {
  const s = refCore(l);
  const ys = (s.match(/(?:19|20)\d{2}/g) || []).map(Number);
  if (!ys.length) noYearRefs++;
  else if (ys[ys.length - 1] >= cutoff) recentRefs++;
  const cjk = (s.match(/[一-鿿]/g) || []).length;
  const latin = (s.match(/[A-Za-z]/g) || []).length;
  if (cjk === 0 && latin >= 20) foreignRefs++;
});

const capNum = '(?:附\\s*)?(?:\\d{1,2}|[A-Za-z])\\s*[-－—.．]\\s*\\d{1,3}';
const countCap = (kind) => (allText.match(new RegExp('(?:^|\\n)\\s*' + kind + '\\s*' + capNum, 'g')) || []).length;
const figCaptions = countCap('图');
const tabCaptions = countCap('表');
const codeCaptions = countCap('代码');
const bareFig = paras.filter((p) => /^图[\s：:]+[^\d\s]/.test(p.text) && p.text.length <= 40).length;
const bareTab = paras.filter((p) => /^表[\s：:]+[^\d\s]/.test(p.text) && p.text.length <= 40).length;

const isTocLine = (t) => /(\.{3,}|…{2,}|·{3,})\s*[0-9０-９IVXLCivxlc]+\s*$/.test(t)
  || /^第\s*[一二三四五六七八九十百0-9]+\s*章.*[\s　][0-9０-９]{1,3}\s*$/.test(t)
  || /^[一二三四五六七八九十]+、.*[\s　][0-9０-９]{1,3}\s*$/.test(t);
const dedupe = (arr) => {
  const seen = new Set();
  return arr.filter((p) => {
    const k = p.text.replace(/\s+/g, '');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};
const h1 = dedupe(paras.filter((p) => p.heading === 1 && !isTocLine(p.text)));
const h2 = dedupe(paras.filter((p) => p.heading === 2 && !isTocLine(p.text)));
const h3 = dedupe(paras.filter((p) => p.heading === 3 && !isTocLine(p.text)));
const chapterH1 = h1.filter((p) => /^第\s*[一二三四五六七八九十百0-9]+\s*章|^\d+[\.、]\s|^[一二三四五六七八九十百]+\s*、/.test(p.text));

// 正文起点优先认定一级标题，避免命中目录里的同名条目；“一、绪论”这类中文序号体例同样要认
const firstChap = h1.find((p) => /^(第\s*[1一]\s*章|[1一]\s*[\.、])/.test(p.text))
  || h1.find((p) => /(绪\s*论|引\s*言)/.test(p.text));
const bodyStart = firstChap ? paras.indexOf(firstChap)
  : findIdx(/^(第\s*1\s*章|第\s*一\s*章|1[\.、]\s*(绪论|引言)|一\s*、\s*(绪论|引言)|绪\s*论|引\s*言)/);
const bodyEnd = refIdx >= 0 ? refIdx : paras.length;
const bodyCjk = bodyStart >= 0 ? cjkCount(paras.slice(bodyStart, bodyEnd).map((p) => p.text).join('')) : null;

// ---------- 章节篇幅分布（全格式；支撑 content-logic-check.md C2 篇幅比例） ----------
const chapterStats = { checked: false, total: 0, chapters: [], groups: {}, issues: [] };
const isChapBoundary = (p) => p.heading === 1 && /^第\s*[一二三四五六七八九十百0-9]+\s*章|^\d+[\.、]\s|^[一二三四五六七八九十百]+\s*、/.test(p.text);
if (bodyStart >= 0) {
  const bounds = [];
  for (let i = bodyStart; i < bodyEnd; i++) if (isChapBoundary(paras[i])) bounds.push(i);
  if (!bounds.length || bounds[0] !== bodyStart) bounds.unshift(bodyStart);
  const flags = (t) => ({
    intro: /绪\s*论|引\s*言/.test(t),
    tech: /相关技术|关键技术|技术基础|技术选型/.test(t),
    design: /设计/.test(t),
    impl: /实现/.test(t),
    test: /测试/.test(t),
  });
  bounds.forEach((start, k) => {
    const end = k + 1 < bounds.length ? bounds[k + 1] : bodyEnd;
    const title = paras[start].text;
    const cjk = cjkCount(paras.slice(start, end).map((p) => p.text).join(''));
    chapterStats.chapters.push({ title, cjk, ...flags(title) });
  });
  chapterStats.total = chapterStats.chapters.reduce((a, c) => a + c.cjk, 0);
  chapterStats.chapters.forEach((c) => { c.pct = chapterStats.total ? Math.round((c.cjk / chapterStats.total) * 1000) / 10 : 0; });
  const groupPct = (pred) => {
    const s = chapterStats.chapters.filter(pred).reduce((a, c) => a + c.cjk, 0);
    return chapterStats.total ? Math.round((s / chapterStats.total) * 1000) / 10 : null;
  };
  chapterStats.groups = {
    绪论加技术: groupPct((c) => c.intro || c.tech),
    设计加实现: groupPct((c) => c.design || c.impl),
    测试: groupPct((c) => c.test),
  };
  chapterStats.checked = true;
  if (chapterStats.groups.绪论加技术 > 25) chapterStats.issues.push(`C2 绪论+技术介绍占 ${chapterStats.groups.绪论加技术}%（参考 ≤20%），前言偏多`);
  if (chapterStats.total > 0 && chapterStats.groups.设计加实现 < 50) chapterStats.issues.push(`C2 设计+实现合计占 ${chapterStats.groups.设计加实现}%（参考 55%—65%），主体偏少`);
}

const has = (re) => re.test(allText);
// 结构项须看题注与章名，不能只搜正文字面词：图3-1“三层架构”就是架构图，图3-8“六类实体逻辑关系”就是 E-R 图
const capParas = paras.filter((p) => p.text.length <= 60 && /^(图|表|代码)\s*附?\s*\d{1,2}\s*[-－—.．]\s*\d{1,3}/.test(p.text));
const capLines = capParas.map((p) => p.text).join('\n');
const figCapLines = capParas.filter((p) => /^图/.test(p.text)).map((p) => p.text).join('\n');
const hasCap = (re) => re.test(capLines);
const hasFig = (re) => re.test(figCapLines);
const hasH1 = (re) => h1.some((p) => re.test(p.text));
const presence = {
  摘要: has(/摘\s*要/),
  Abstract: enIdx >= 0,
  目录: has(/目\s*录/),
  原创性声明: has(/原创性声明/),
  版权授权: has(/版权使用授权/),
  绪论或引言: has(/(绪\s*论|引\s*言)/),
  相关技术: has(/(相关技术|关键技术|技术基础)/),
  需求分析: has(/需求分析/) || hasH1(/需求/),
  系统设计: has(/(系统设计|总体设计)/) || hasH1(/设计/),
  系统实现: has(/(系统实现|详细设计)/) || hasH1(/实现/),
  系统测试: has(/(系统测试|测试与分析)/) || hasH1(/测试/),
  总结或结论: has(/(总结与展望|结\s*论|结束语)/),
  参考文献: has(/参考文献/),
  致谢: has(/致\s*谢/),
  附录: has(/附\s*录/),
  测试环境: has(/测试环境/),
  E_R图: has(/E-?R\s*图|实体关系图/i) || hasFig(/(实体|E-?R|逻辑关系)/i),
  用例图: has(/用例图/) || hasFig(/用例/),
  架构图: has(/(架构图|体系结构图)/) || hasFig(/(架构|体系结构)/),
  顺序图: has(/(顺序图|时序图)/) || hasFig(/(时序|顺序)/),
  活动图或流程图: has(/(活动图|流程图)/) || hasFig(/(活动|流程|交互流|状态流转)/),
  核心代码: has(/(核心代码|关键代码)/) || hasCap(/^代码/m)
};

const numberingStyles = [];
if (h1.some((p) => /^第\s*[一二三四五六七八九十百0-9]+\s*章/.test(p.text))) numberingStyles.push('第X章');
if (h1.some((p) => /^[一二三四五六七八九十]+、/.test(p.text))) numberingStyles.push('一、');
if (h1.some((p) => /^\d+[\.、]\s/.test(p.text))) numberingStyles.push('1.');

const warnings = [];
if (bodyCjk !== null && bodyCjk < 6000) warnings.push(`正文估计 ${bodyCjk} 字，低于 6000 字硬性底线（不含代码/截图/图纸）`);
else if (bodyCjk !== null && bodyCjk < 12000) warnings.push(`正文估计 ${bodyCjk} 字，低于本专业建议的 1.2 万字`);
if (!abstractText) warnings.push('未识别到中文摘要正文，请人工核对摘要页');
if (abstractCjk && abstractCjk < 300) warnings.push(`中文摘要约 ${abstractCjk} 字，低于 300 字要求`);
if (abstractCjk > 800) warnings.push(`中文摘要约 ${abstractCjk} 字，疑似把引言写进摘要（建议 300—500 字）`);
if (keywords.length && (keywords.length < 3 || keywords.length > 5)) warnings.push(`关键词 ${keywords.length} 个，应为 3—5 个`);
if (!presence.Abstract) warnings.push('未检测到英文摘要 Abstract（2026 秋学位样式未设该栏位，按建议项处理、不得据此扣硬分；若本学期模板要求则不得缺失）');
if (!presence.原创性声明) warnings.push('未检测到原创性声明页');
if (!presence.版权授权) warnings.push('未检测到版权使用授权声明页');
if (!presence.目录) warnings.push('未检测到目录');
if (refTotal && refTotal < 10) warnings.push(`参考文献 ${refTotal} 篇，少于 10 篇`);
if (refTotal && recentRefs / refTotal < 0.5) warnings.push(`近 5 年（${cutoff} 年起）文献 ${recentRefs}/${refTotal} 篇，占比不足一半${noYearRefs ? `（其中 ${noYearRefs} 篇未著录出版年，需人工核对）` : ''}`);
if (foreignRefs < 2) warnings.push('疑似外文文献少于 2 篇（自动识别，需人工确认）');
if (!presence.测试环境) warnings.push('未检测到“测试环境”，测试数据可能缺少条件说明');
if (numberingStyles.length > 1) warnings.push('标题编号体例混用：' + numberingStyles.join(' / '));
if (bareFig) warnings.push(`有 ${bareFig} 处“图”未带章-序号编号`);
if (bareTab) warnings.push(`有 ${bareTab} 处“表”未带章-序号编号`);
if (!doc.pages) warnings.push('未能读取页数（DOCX 属性缺失），按章节定位即可');
if (refTotal === 0) warnings.push('未统计到参考文献条目，请人工核对');

// ---------- 目录逻辑与表格样式实测（仅 docx；对应 structure.md L1-L8、requirements.md T1-T11） ----------
const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
const roman = (s) => { const v = { I: 1, V: 5, X: 10, L: 50, C: 100 }; let n = 0; for (let i = 0; i < s.length; i++) { const c = v[s[i].toUpperCase()]; const nx = v[(s[i + 1] || '').toUpperCase()] || 0; n += c < nx ? -c : c; } return n; };
const pageNum = (s) => /^[0-9]+$/.test(s) ? Number(s) : (/^[IVXLCivxlc]+$/.test(s) ? roman(s) : null);
const norm = (s) => s.replace(/\s+/g, '');
const tocLogic = { checked: false, entries: 0, issues: [] };
const tableStyle = { checked: false, dataTables: 0, codeTables: 0, dataBorderSigs: {}, codeBorderSigs: {}, issues: [] };

if (doc.kind === 'docx' && doc.xml) {
  const xml = doc.xml;
  const ev = [];
  let em;
  const pe = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  while ((em = pe.exec(xml))) {
    const raw = em[0];
    let text = '';
    const te = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
    let tt;
    while ((tt = te.exec(raw))) text += decodeXml(tt[1]);
    ev.push({ off: em.index, kind: 'p', text: text.replace(/\s+/g, ' ').trim(), raw });
  }
  // 假设无嵌套表格；嵌套时外层匹配会提前结束，需人工复核
  const tre = /<w:tbl>[\s\S]*?<\/w:tbl>/g;
  while ((em = tre.exec(xml))) ev.push({ off: em.index, kind: 'tbl', text: '', raw: em[0] });
  ev.sort((a, b) => a.off - b.off);
  let pi = 0;
  ev.forEach((e) => { if (e.kind === 'p' && e.text) e.heading = paras[pi++] ? paras[pi - 1].heading : 0; });

  // L1/L2：目录条目 vs 正文标题、页码单调。目录条目以 PAGEREF 域为准，兼容纯文本目录
  const entryRe = /^(.*?)[\s.·…　]*([0-9]{1,3}|[IVXLCivxlc]{1,6})$/;
  const isTocStyle = (e) => {
    const id = (e.raw.match(/<w:pStyle w:val="([^"]+)"/) || [])[1] || '';
    return /toc|contents|目录/i.test(doc.styleName[id] || '');
  };
  const tocParas = ev.filter((e) => e.kind === 'p' && (/PAGEREF/.test(e.raw) || isTocStyle(e)));
  const tocEntries = [];
  let tocEndOff = -1;
  let tocDepth = 3;
  const sw = xml.match(/TOC[^<]*?\\o\s*(?:&quot;|")(\d)-(\d)/);
  if (sw) tocDepth = Number(sw[2]);
  const pushEntry = (text) => {
    const m = text.replace(/\s+/g, ' ').trim().match(entryRe);
    if (m && m[1].trim()) tocEntries.push({ title: m[1].trim(), page: m[2] });
  };
  if (tocParas.length) {
    tocLogic.checked = true;
    tocEndOff = tocParas[tocParas.length - 1].off;
    tocParas.forEach((e) => pushEntry(e.text));
  } else {
    const tocStart = ev.findIndex((e) => e.kind === 'p' && /^目\s*录$/.test(e.text));
    if (tocStart < 0) tocLogic.issues.push('L1 未找到独立“目录”页，无法比对目录与正文');
    else {
      tocLogic.checked = true;
      for (let i = tocStart + 1; i < ev.length; i++) {
        const e = ev[i];
        if (e.kind !== 'p' || !e.text) continue;
        if (e.heading > 0) { tocEndOff = e.off; break; }
        if (entryRe.test(e.text)) { pushEntry(e.text); tocEndOff = e.off; }
      }
    }
  }
  tocLogic.entries = tocEntries.length;
  tocLogic.depth = tocDepth;
  const bodyParas = ev.filter((e) => e.kind === 'p' && e.text && e.off > tocEndOff);
  const bodyHead = bodyParas.filter((e) => e.heading > 0 && e.heading <= tocDepth);
  if (tocLogic.checked) {
    const tt = tocEntries.map((e) => norm(e.title));
    const bt = bodyHead.map((e) => norm(e.text));
    let cursor = 0;
    const unmatched = [];
    tocEntries.forEach((en) => {
      const t = norm(en.title);
      let k = cursor;
      while (k < bodyParas.length && norm(bodyParas[k].text) !== t) k++;
      if (k >= bodyParas.length) unmatched.push(en.title);
      else cursor = k + 1;
    });
    if (unmatched.length) tocLogic.issues.push('L1 目录条目在正文中找不到同序对应标题：' + unmatched.join('；'));
    const extra = bt.filter((t) => !tt.includes(t));
    if (extra.length) tocLogic.issues.push('L1 正文有标题而目录漏列：' + extra.join('；'));
    let lastA = null, lastR = null, lastTitle = '';
    tocEntries.forEach((e) => {
      const isRoman = /^[IVXLCivxlc]+$/.test(e.page);
      const n = pageNum(e.page);
      if (n === null) return;
      const last = isRoman ? lastR : lastA;
      if (last !== null && n < last) tocLogic.issues.push(`L2 目录页码倒序：「${lastTitle}」${last} → 「${e.title}」${n}`);
      if (isRoman) lastR = n; else lastA = n;
      lastTitle = e.title;
    });
    if (!tocEntries.length) tocLogic.issues.push('L1 目录页未解析出条目（可能为未更新域或图片目录），须人工核');
  }

  // L3：编号连续与体例
  const seqCheck = (items, label) => {
    let expect = 1;
    items.forEach((t) => {
      const m = t.match(/^（?([一二三四五六七八九十]+)）?、?/) || t.match(/^(\d+)[\.、]/);
      if (!m) return;
      const n = CN[m[1]] || Number(m[1]);
      if (!n) return;
      if (n !== expect) tocLogic.issues.push(`L3 ${label}编号不连续：期望 ${expect} 实为 ${n}（${t}）`);
      expect = n + 1;
    });
  };
  let h1buf = [], h2buf = [], h1name = '';
  bodyHead.forEach((e) => {
    if (e.heading === 1) { if (h2buf.length) seqCheck(h2buf, `「${h1name}」节`); h2buf = []; h1name = e.text; h1buf.push(e.text); }
    else if (e.heading === 2) h2buf.push(e.text);
  });
  if (h2buf.length) seqCheck(h2buf, `「${h1name}」节`);
  seqCheck(h1buf.filter((t) => /^[一二三四五六七八九十]+、/.test(t)), '章');
  seqCheck(h1buf.filter((t) => /^第\s*[一二三四五六七八九十0-9]+\s*章/.test(t)).map((t) => t.replace(/^第\s*/, '').replace(/\s*章.*$/, '')), '章');

  // L4：观测点产出归属章（题注与章内文字双通道；合并章如“设计与实现”同时承担多个角色）
  const rolesOf = (t) => {
    const r = [];
    if (/需求/.test(t)) r.push('需求');
    if (/设计/.test(t)) r.push('设计');
    if (/实现/.test(t)) r.push('实现');
    if (/测试/.test(t)) r.push('测试');
    return r;
  };
  const SEP = '[-－—.．]';
  const markers = [
    [new RegExp('^图\\s*\\d+' + SEP + '\\d+\\s*(系统功能结构|功能结构)'), '需求', '功能结构图'],
    [new RegExp('^图\\s*\\d+' + SEP + '\\d+.*用例'), '需求', '用例图'],
    [new RegExp('^表\\s*\\d+' + SEP + '\\d+.*用例描述'), '需求', '用例描述表'],
    [new RegExp('^图\\s*\\d+' + SEP + '\\d+.*(架构|体系结构)'), '设计', '架构图'],
    [new RegExp('^图\\s*\\d+' + SEP + '\\d+.*(实体|E-?R|逻辑关系)'), '设计', 'E-R图'],
    [new RegExp('^表\\s*\\d+' + SEP + '\\d+.*(表结构|字段|集合与主要职责)'), '设计', '表结构'],
    [new RegExp('^代码\\s*\\d+' + SEP + '\\d+'), '实现', '核心代码']
  ];
  const required = { 需求: ['功能结构图', '用例图', '用例描述表'], 设计: ['架构图', 'E-R图'], 实现: ['核心代码'] };
  // 题注判定：编号后带空格/冒号，或短且无句末标点；避免把“代码4-2展示…”这类引导句误判为题注
  const capRe = new RegExp('^(图|表|代码)\\s*(附?)\\s*(\\d{1,2}|[A-Za-z])\\s*(' + SEP + ')\\s*(\\d{1,3})([\\s\\S]*)$');
  const capOf = (t) => {
    if (t.length > 60) return null;
    const m = t.match(capRe);
    if (!m) return null;
    const rest = m[6];
    if (rest === '' || /^[\s　:：]/.test(rest) || (t.length <= 30 && !/[。；;，,]$/.test(t))) {
      return { kind: m[1], app: m[2], chap: m[3], sep: m[4], seq: Number(m[5]) };
    }
    return null;
  };
  const chapNumOf = (t) => {
    let m = t.match(/^第\s*([一二三四五六七八九十百0-9]{1,4})\s*章/);
    if (m) return CN[m[1]] || Number(m[1]) || null;
    m = t.match(/^([一二三四五六七八九十]{1,3})、/);
    if (m) return CN[m[1]] || null;
    m = t.match(/^(\d{1,2})[\.、．]\s*\S/);
    if (m) return Number(m[1]);
    return null;
  };
  const seen = {}, chapText = {};
  // 章标题未用“标题 1”样式时才按文本兜底识别，避免把正文里“第三章将给出…”误判为章界
  const useTextChap = !ev.some((e) => e.kind === 'p' && e.heading === 1 && e.off > tocEndOff && chapNumOf(e.text) !== null);
  let curRoles = [], curTitle = '', curChap = null, curApp = null;
  const captions = [];
  ev.forEach((e, i) => {
    if (e.kind !== 'p' || !e.text || e.off <= tocEndOff) return;
    if (e.heading === 1) {
      curRoles = rolesOf(e.text); curTitle = e.text;
      curChap = chapNumOf(e.text); curApp = null;
      curRoles.forEach((r) => { seen[r] = seen[r] || {}; chapText[r] = ''; });
      return;
    }
    // 附录/参考文献/致谢常用 Title 样式而非 heading 1，须按文本识别区界
    if (e.text.length <= 40 && !/[。；;]$/.test(e.text)) {
      const am = e.text.match(/^附\s*录\s*(\d{1,2}|[A-Za-z]|[一二三四五六七八九十]{1,3})(?!\d)/);
      if (am) { curApp = CN[am[1]] ? String(CN[am[1]]) : am[1]; curChap = null; curRoles = []; curTitle = e.text; }
      else if (/^(参考文献|致\s*谢|摘\s*要|Abstract)\s*$/i.test(e.text)) { curApp = null; curChap = null; curRoles = []; curTitle = e.text; }
      else if (useTextChap && /^(第\s*[一二三四五六七八九十百0-9]{1,4}\s*章|[一二三四五六七八九十]{1,3}、)/.test(e.text)) {
        curRoles = rolesOf(e.text); curTitle = e.text; curChap = chapNumOf(e.text); curApp = null;
        curRoles.forEach((r) => { seen[r] = seen[r] || {}; chapText[r] = ''; });
      }
    }
    curRoles.forEach((r) => { chapText[r] += e.text; });
    const m = capOf(e.text);
    if (!m) return;
    const c = { e, i, ...m };
    captions.push(c);
    const cap = e.text.slice(0, 24);
    // T11：题注章号必须等于所在章/附录序号
    if (curApp !== null) {
      if (!c.app) tableStyle.issues.push(`T11 附录${curApp}内对象未另编序：${cap}（应编为${c.kind}附${curApp}-${c.seq}）`);
      else if (String(c.chap).toUpperCase() !== String(curApp).toUpperCase()) tableStyle.issues.push(`T11 题注章号与所在附录不符：${cap} 位于「${curTitle}」`);
    } else if (curChap !== null) {
      if (c.app) tableStyle.issues.push(`T11 正文第${curChap}章对象误用附录编号：${cap}`);
      else if (Number(c.chap) !== curChap) tableStyle.issues.push(`T11 题注章号与所在章不符：${cap} 位于第${curChap}章「${curTitle}」`);
    } else {
      tableStyle.issues.push(`T11 题注落在非正文区（${curTitle || '前置部分'}）：${cap}`);
    }
    const mk = markers.find((x) => x[0].test(e.text));
    if (mk && curRoles.length) {
      curRoles.forEach((r) => { seen[r][mk[2]] = true; });
      if (!curRoles.includes(mk[1])) tocLogic.issues.push(`L4 ${mk[2]}（${cap}）位于「${curTitle}」，观测点要求放在${mk[1]}章`);
    }
  });
  Object.keys(seen).forEach((r) => (required[r] || []).forEach((lab) => {
    if (!seen[r][lab]) tocLogic.issues.push(`L4 ${r}章存在但全章未见${lab}题注（产出缺失或放错章）`);
  }));
  if (seen['测试'] && !/测试环境|实验环境|测试条件|实验条件/.test(chapText['测试'] || '')) {
    tocLogic.issues.push('L4 测试章未见测试环境与条件说明（文字或表格均可）');
  }

  // T3/T4/T5/T10：题注位置、字体签名、编号连续、正文引导
  const hasImg = (e) => !!e && e.kind === 'p' && /<w:drawing|<w:pict/.test(e.raw);
  const isBlank = (e) => e.kind === 'p' && !e.text && !hasImg(e);
  const prevObjIdx = (i) => { let k = i - 1; while (k >= 0 && isBlank(ev[k])) k--; return k; };
  const nextObjIdx = (i) => { let k = i + 1; while (k < ev.length && isBlank(ev[k])) k++; return k; };
  const prevTextIdx = (i) => { let k = i - 1; while (k >= 0 && (ev[k].kind !== 'p' || !ev[k].text || hasImg(ev[k]))) k--; return k; };
  const dash = (s) => s.replace(/\s+/g, '').replace(/[－—–−.．]/g, '-');
  const desc = (e) => !e ? '无' : (e.kind === 'tbl' ? '表格' : (hasImg(e) ? '图片段' : e.text.slice(0, 20)));
  const capSig = {};
  const capSeq = {};
  captions.forEach((c) => {
    const raw = c.e.raw;
    const pStyle = (raw.match(/<w:pStyle w:val="([^"]+)"/) || [])[1] || '';
    const runSz = [...new Set([...raw.matchAll(/<w:sz w:val="(\d+)"/g)].map((m) => m[1]))];
    const sz = runSz.length ? runSz.map((v) => v / 2 + 'pt').join(',')
      : (doc.styleSz[pStyle] ? doc.styleSz[pStyle] / 2 + 'pt(样式)' : '继承');
    const jc = (raw.match(/<w:jc w:val="([^"]+)"/) || [])[1] || '继承';
    const font = (raw.match(/w:eastAsia="([^"]+)"/) || [])[1] || '继承';
    const key = c.kind + (c.app ? '附' : '');
    capSig[key] = capSig[key] || {};
    const sig = `${doc.styleName[pStyle] || pStyle || '无样式'}|${sz}|${jc}|${font}`;
    capSig[key][sig] = (capSig[key][sig] || 0) + 1;
    const sk = key + c.chap;
    capSeq[sk] = capSeq[sk] || [];
    capSeq[sk].push({ n: c.seq, sub: /[（(]\s*[a-eA-E①-⑤]\s*[）)]/.test(c.e.text) });
    const label = dash(c.kind + c.app + c.chap + c.sep + c.seq);
    const cap = c.e.text.slice(0, 24);
    let leadIdx = -1;
    if (c.kind === '图') {
      const p = prevObjIdx(c.i);
      if (!hasImg(ev[p])) tableStyle.issues.push(`T3 图题不在图下：${cap} 前一段为「${desc(ev[p])}」`);
      leadIdx = prevTextIdx(p >= 0 ? p : c.i);
    } else {
      const nx = ev[nextObjIdx(c.i)];
      const ok = nx && (nx.kind === 'tbl' || (c.kind === '代码' && /Consolas|Courier New/.test(nx.raw)));
      if (!ok) tableStyle.issues.push(`T3 ${c.kind}题未紧邻对象：${cap} 后一段为「${desc(nx)}」`);
      leadIdx = prevTextIdx(c.i);
    }
    if (!c.app && leadIdx >= 0) {
      const p2 = prevTextIdx(leadIdx);
      const ok = dash(ev[leadIdx].text).includes(label) || (p2 >= 0 && dash(ev[p2].text).includes(label));
      if (!ok) tableStyle.issues.push(`T10 正文未编号引出：${cap}（前段「${ev[leadIdx].text.slice(0, 18)}」未出现${label}）`);
    }
  });
  Object.entries(capSig).forEach(([k, sigs]) => {
    if (Object.keys(sigs).length > 1) tableStyle.issues.push(`T4 ${k}题注样式不统一（样式|字号|对齐|中文字体）：` + Object.entries(sigs).map(([s, n]) => `${s}×${n}`).join('；'));
  });
  Object.entries(capSeq).forEach(([k, arr]) => {
    let expect = 1;
    arr.forEach((o, i) => {
      if (o.n === expect) { expect = o.n + 1; return; }
      if (o.n === expect - 1 && o.sub) return; // （a）/（b）分列，允许同号重复
      tableStyle.issues.push(`T5 ${k} 编号不连续：第 ${i + 1} 个题注序号为 ${o.n}（期望 ${expect}）`);
      expect = o.n + 1;
    });
  });

  // T11：编号分隔符体例统一（图3-2 与 图3.2 不得混用）
  const sepKinds = {};
  captions.forEach((c) => {
    const k = /[.．]/.test(c.sep) ? '点号(图3.2)' : '横线(图3-2)';
    sepKinds[k] = (sepKinds[k] || 0) + 1;
  });
  if (Object.keys(sepKinds).length > 1) tableStyle.issues.push('T11 图表编号体例混用：' + Object.entries(sepKinds).map(([s, n]) => `${s}×${n}`).join('；'));

  // T5：正文引用的编号必须有对应题注（悬空引用）
  const capLabels = new Set(captions.map((c) => dash(c.kind + c.app + c.chap + c.sep + c.seq)));
  const capIdx = new Set(captions.map((c) => c.i));
  const refRe = new RegExp('(图|表|代码)\\s*(附?)\\s*(\\d{1,2}|[A-Za-z])\\s*(' + SEP + ')\\s*(\\d{1,3})', 'g');
  const dangling = new Set();
  let refMentions = 0;
  ev.forEach((e, i) => {
    if (e.kind !== 'p' || !e.text || e.off <= tocEndOff || capIdx.has(i)) return;
    refRe.lastIndex = 0;
    let rm;
    while ((rm = refRe.exec(e.text))) {
      refMentions++;
      const lab = dash(rm[1] + rm[2] + rm[3] + rm[4] + rm[5]);
      if (!capLabels.has(lab)) dangling.add(lab);
    }
  });
  if (dangling.size) tableStyle.issues.push('T5 正文引用了不存在的题注编号（悬空引用）：' + [...dangling].join('、'));
  tableStyle.captionCount = captions.length;
  tableStyle.captionKinds = captions.reduce((a, c) => { a[c.kind] = (a[c.kind] || 0) + 1; return a; }, {});
  tableStyle.refMentions = refMentions;
  tableStyle.sepKinds = sepKinds;

  // T1/T2/T6/T7：表格边框签名、代码块区分、表头、表内字号
  const dataSz = new Set(), codeSz = new Set(), headerKinds = new Set();
  ev.forEach((e, i) => {
    if (e.kind !== 'tbl') return;
    const b = (e.raw.match(/<w:tblBorders>[\s\S]*?<\/w:tblBorders>/) || [''])[0];
    const sig = ['top', 'bottom', 'left', 'right', 'insideH', 'insideV'].map((k) => (b.match(new RegExp('w:' + k + ' w:val="([^"]+)"')) || [])[1] || '-').join('/');
    const isCode = /Consolas|Courier New/.test(e.raw);
    const sizes = [...new Set([...e.raw.matchAll(/<w:sz w:val="(\d+)"/g)].map((m) => m[1]))];
    if (isCode) {
      tableStyle.codeTables++;
      tableStyle.codeBorderSigs[sig] = (tableStyle.codeBorderSigs[sig] || 0) + 1;
      sizes.forEach((s) => codeSz.add(s));
    } else {
      tableStyle.dataTables++;
      tableStyle.dataBorderSigs[sig] = (tableStyle.dataBorderSigs[sig] || 0) + 1;
      sizes.forEach((s) => dataSz.add(s));
      const fr = (e.raw.match(/<w:tr\b[\s\S]*?<\/w:tr>/) || [''])[0];
      headerKinds.add(/<w:b\/>|<w:b /.test(fr) ? 'bold' : (/<w:shd[^>]*w:fill="(?!FFFFFF|auto)[0-9A-Fa-f]{6}"/.test(fr) ? 'shd' : 'plain'));
      const prev = ev[prevObjIdx(i)];
      const pt = prev && prev.kind === 'p' ? prev.text : '';
      if (!/^(表|代码)/.test(pt)) tableStyle.issues.push(`T3 表题不在表上：表格前一段为「${desc(prev)}」`);
    }
  });
  if (Object.keys(tableStyle.dataBorderSigs).length > 1) tableStyle.issues.push('T1 数据表边框不统一：' + Object.entries(tableStyle.dataBorderSigs).map(([s, n]) => `${s}×${n}`).join('；'));
  if (Object.keys(tableStyle.codeBorderSigs).length > 1) tableStyle.issues.push('T2 代码块表格边框不统一：' + Object.entries(tableStyle.codeBorderSigs).map(([s, n]) => `${s}×${n}`).join('；'));
  if (dataSz.size > 1) tableStyle.issues.push('T7 数据表表内字号不统一：' + [...dataSz].map((s) => s / 2 + 'pt').join('、'));
  if (codeSz.size > 1) tableStyle.issues.push('T7 代码清单字号不统一：' + [...codeSz].map((s) => s / 2 + 'pt').join('、'));
  if (headerKinds.size > 1) tableStyle.issues.push('T6 表头行样式不统一：' + [...headerKinds].join('、'));
  tableStyle.checked = true;
  tableStyle.captionSigs = capSig;
}

// ---------- AI味扫描（A1—A8 机器可测项；docx/pdf/txt 全格式可用，对应 references/ai-flavor-check.md） ----------
const aiFlavor = { checked: true, residue: [], templateHits: {}, templateTotal: 0, templatePerKchar: null, emptyClaims: [], parallelHits: 0, synonymDrift: [], refYearNote: '', issues: [] };
const snip = (t) => t.slice(0, 30);

// A1：对话残留、Markdown 残留、占位符（实锤级信号，逐条人工确认）
const residueRes = [
  ['AI对话开场', /(?:好的[，,]|当然可以|没问题[，,]|以下是(?:为您|为你)?(?:生成|整理|提供)|下面是(?:为您|为你)?)/],
  ['AI对话收尾', /希望(?:以上|这|本文)?(?:内容)?(?:对(?:你|您)|能够)|如果(?:你|您)(?:还)?(?:有|需要)(?:任何|其他)?(?:问题|需求|疑问)|随时(?:告诉|联系)(?:我|我们)/],
  ['AI身份自述', /作为(?:一个|一名)?\s*(?:AI|人工智能|语言模型|智能助手)/],
  ['Markdown残留', /\*\*[^*\n]{1,40}\*\*|```|^#{1,6}\s+\S/],
  ['占位符', /X{3,}|（(?:此处|这里)(?:插入|填写|补充)[^）]{0,20}）|\[(?:插入|填写|待补充|此处)[^\]]{0,20}\]|(?:单击|点击)(?:此处|这里)(?:输入|添加)|待补充|待填写|TODO|Lorem\s+ipsum/i],
];
residueRes.forEach(([label, re]) => {
  paras.forEach((p, i) => {
    if (re.test(p.text)) aiFlavor.residue.push(`${label}（段${i + 1}「${snip(p.text)}」）`);
  });
});
if (aiFlavor.residue.length) aiFlavor.issues.push(`A1 疑似 AI 对话残留/占位符 ${aiFlavor.residue.length} 处（实锤级信号，逐条人工确认成立/误报）`);

// A2：模板套话计数与密度（处/千字）
const templateRes = [
  ['随着…发展', /随着[^。；\n]{0,20}(?:快速|飞速|迅猛|不断|日益)发展/g],
  ['在…背景下', /在[^。；\n]{0,15}(?:背景|趋势|浪潮)下/g],
  ['综上所述类', /综上所述|总而言之|总的来说|概括来说/g],
  ['值得注意的是类', /值得注意的是|不难发现|由此可见|显而易见|众所周知/g],
  ['空泛意义', /具有(?:重要|重大|深远)(?:的)?(?:意义|价值)|起到了?至关重要(?:的)?作用|发挥(?:着)?(?:重要|关键|不可替代)(?:的)?作用|奠定(?:了)?坚实(?:的)?基础|提供了?(?:有力|强有力)(?:的)?支撑/g],
  ['万能提升', /极大地?(?:提高|提升|改善|优化)/g],
  ['互联网黑话', /赋能|抓手|闭环|痛点|组合拳|全方位|多维度|深层次/g],
];
templateRes.forEach(([name, re]) => {
  const n = (allText.match(re) || []).length;
  if (n) { aiFlavor.templateHits[name] = n; aiFlavor.templateTotal += n; }
});
const aiDenom = bodyCjk || cjkCount(allText);
aiFlavor.templatePerKchar = aiDenom ? Math.round((aiFlavor.templateTotal / aiDenom) * 10000) / 10 : null;
if (aiFlavor.templatePerKchar !== null && aiFlavor.templatePerKchar >= 6) {
  aiFlavor.issues.push(`A2 模板套话 ${aiFlavor.templateTotal} 处，密度 ${aiFlavor.templatePerKchar} 处/千字（参考阈值 6/12，须人工判定是否成段堆砌）`);
}

// A3：空泛断言候选（人工核对是否有数据支撑）
const emptyRes = [
  /(?:运行|系统)(?:良好|稳定|正常)[^。；\n]{0,20}(?:达到|满足)(?:预期|设计)(?:要求|目标)/g,
  /各项(?:功能|指标|性能)均?(?:达到|满足)(?:预期|设计)(?:要求|目标)/g,
  /取得(?:了)?(?:良好|较好|显著)(?:的)?(?:效果|成效)/g,
];
paras.forEach((p, i) => {
  if (aiFlavor.emptyClaims.length >= 10) return;
  if (emptyRes.some((re) => { re.lastIndex = 0; return re.test(p.text); })) aiFlavor.emptyClaims.push(`段${i + 1}「${snip(p.text)}」`);
});

// A4：抽象形容词连排候选（高效、稳定、可靠…；正常名词列举不在此列，结构对称由人工核）
const aiAdj = '(?:高效|稳定|可靠|易用|灵活|安全|便捷|智能|准确|及时|完整|规范|友好|直观|清晰|强大|丰富|全面|快速|简便|健壮|优雅)';
aiFlavor.parallelHits = (allText.match(new RegExp(aiAdj + '(?:、' + aiAdj + '){2,}', 'g')) || []).length;
if (aiFlavor.parallelHits >= 3) aiFlavor.issues.push(`A4 抽象形容词连排 ${aiFlavor.parallelHits} 处（如"高效、稳定、可靠"），人工核实是否成段堆砌`);

// A5：术语漂移（降重工具常见的地域/繁简同义替换）
const driftPairs = [
  ['登录', /登入|签入/g],
  ['数据库', /资料库/g],
  ['软件', /软体/g],
  ['硬件', /硬体/g],
  ['网络', /网路/g],
  ['界面', /介面/g],
  ['服务器', /伺服器/g],
  ['内存', /记忆体/g],
  ['程序', /(?<!方)程式/g],
];
driftPairs.forEach(([std, re]) => {
  const n = (allText.match(re) || []).length;
  if (n) aiFlavor.synonymDrift.push(`${std}→变体×${n}`);
});
if (aiFlavor.synonymDrift.length) aiFlavor.issues.push('A5 疑似术语漂移（降重/繁简替换信号）：' + aiFlavor.synonymDrift.join('、') + '；人工确认是否同一概念混用');

// A7：文献年份高度集中（抽查可检索性的线索）
const refYears = refLines.map((l) => {
  const ys = (refCore(l).match(/(?:19|20)\d{2}/g) || []).map(Number);
  return ys.length ? ys[ys.length - 1] : null;
}).filter((y) => y !== null);
const yearSet = [...new Set(refYears)];
if (refTotal >= 6 && refYears.length >= 6 && yearSet.length <= 2) {
  aiFlavor.refYearNote = `文献年份高度集中：${yearSet.join('、')}（${refYears.length} 篇有著录年）`;
  aiFlavor.issues.push('A7 ' + aiFlavor.refYearNote + '，抽查 2—3 条可检索性');
}

tocLogic.issues.forEach((w) => warnings.push(w));
tableStyle.issues.forEach((w) => warnings.push(w));
aiFlavor.issues.forEach((w) => warnings.push(w));
chapterStats.issues.forEach((w) => warnings.push(w));
if (doc.kind !== 'docx') warnings.push('非 .docx 文件：目录逻辑（L1—L8）与表格样式（T1—T11）未能自动实测，须人工补查并在报告注明');

const result = {
  file: path.basename(FILE),
  kind: doc.kind,
  pages: doc.pages,
  cjkTotal: cjkCount(allText),
  bodyCjk,
  abstractCjk,
  keywords,
  enAbstractWords: enWords,
  refs: { total: refTotal, recent: recentRefs, cutoff, foreignGuess: foreignRefs, noYear: noYearRefs },
  figures: tableStyle.captionKinds ? (tableStyle.captionKinds['图'] || 0) : figCaptions,
  tables: tableStyle.captionKinds ? (tableStyle.captionKinds['表'] || 0) : tabCaptions,
  codeListings: tableStyle.captionKinds ? (tableStyle.captionKinds['代码'] || 0) : codeCaptions,
  chapters: chapterH1.length,
  headings: {
    h1: h1.map((p) => p.text),
    h2: h2.slice(0, 60).map((p) => p.text),
    h2Total: h2.length,
    h3Total: h3.length
  },
  presence,
  tocLogic,
  tableStyle,
  aiFlavor,
  chapterStats,
  warnings
};

if (JSON_ONLY) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const line = (k, v) => console.log(`| ${k} | ${v} |`);
console.log('## 论文指标速览');
console.log('');
console.log('| 项目 | 数值 |');
console.log('| --- | --- |');
line('文件', `${result.file}（${result.kind}）`);
line('页数', result.pages ?? '未读取');
line('汉字总数', result.cjkTotal);
line('正文估计', result.bodyCjk ?? '未定位到第 1 章');
line('中文摘要', result.abstractCjk ? `${result.abstractCjk} 字` : '未识别');
line('关键词', result.keywords.length ? `${result.keywords.length} 个：${result.keywords.join('；')}` : '未识别');
line('英文摘要', result.enAbstractWords ? `约 ${result.enAbstractWords} 词` : '未识别');
line('章节数', result.chapters);
line('图 / 表 / 代码', `${result.figures} / ${result.tables} / ${result.codeListings}（按题注统计，含附录另编序）`);
line('参考文献', `${result.refs.total} 篇；近 5 年 ${result.refs.recent} 篇；疑似外文 ${result.refs.foreignGuess} 篇；未著录出版年 ${result.refs.noYear} 篇`);
console.log('');
console.log('## 一级标题');
console.log('');
if (h1.length) h1.forEach((p) => console.log('- ' + p.text));
else console.log('- 未识别到一级标题（可能未使用标题样式）');
console.log('');
console.log('## 结构项');
console.log('');
Object.entries(presence).forEach(([k, v]) => console.log(`- ${k}：${v ? '有' : '未检测到'}`));
console.log('');
console.log('## 章节篇幅分布（C2 支撑）');
console.log('');
if (chapterStats.checked) {
  chapterStats.chapters.forEach((c) => console.log(`- ${c.title}：${c.cjk} 字（${c.pct}%）`));
  console.log(`- 分组占比：绪论+技术 ${chapterStats.groups.绪论加技术}% / 设计+实现 ${chapterStats.groups.设计加实现}% / 测试 ${chapterStats.groups.测试}%（参考 ≤20% / 55%—65% / 10%—20%）`);
  if (chapterStats.issues.length) chapterStats.issues.forEach((w) => console.log('- ✗ ' + w));
  else console.log('- 篇幅比例未见明显失衡（C1/C3—C8 仍需人工核）');
} else {
  console.log('- 未定位到正文第 1 章，无法统计章节篇幅，须人工核 C2');
}
console.log('');
console.log('## 目录逻辑（L1—L8）');
console.log('');
if (tocLogic.checked) {
  console.log(`- 目录条目：${tocLogic.entries} 条`);
  if (tocLogic.issues.length) tocLogic.issues.forEach((w) => console.log('- ✗ ' + w));
  else console.log('- 目录与正文标题、页码顺序、编号连续性未发现问题（L5—L8 仍需人工核）');
} else {
  console.log('- 未自动实测（非 .docx 或无目录域），须人工逐条核 L1—L8');
}
console.log('');
console.log('## 表格样式（T1—T11）');
console.log('');
if (tableStyle.checked) {
  console.log(`- 数据表 ${tableStyle.dataTables} 张 / 代码块表格 ${tableStyle.codeTables} 张（分开统计）`);
  console.log(`- 题注 ${tableStyle.captionCount || 0} 条；编号体例：${Object.entries(tableStyle.sepKinds || {}).map(([s, n]) => `${s}×${n}`).join('；') || '未识别'}；正文编号引用 ${tableStyle.refMentions || 0} 处`);
  const sig = (o) => Object.entries(o).map(([s, n]) => `${s}×${n}`).join('；') || '无';
  console.log('- 数据表边框签名（top/bottom/left/right/insideH/insideV）：' + sig(tableStyle.dataBorderSigs));
  console.log('- 代码块边框签名：' + sig(tableStyle.codeBorderSigs));
  Object.entries(tableStyle.captionSigs || {}).forEach(([k, sigs]) => {
    console.log(`- ${k}题注样式签名（样式|字号|对齐|中文字体）：` + sig(sigs));
  });
  if (tableStyle.issues.length) tableStyle.issues.forEach((w) => console.log('- ✗ ' + w));
  else console.log('- 边框、表头、字号、题注位置与编号未发现问题（T8—T9 仍需人工核）');
} else {
  console.log('- 未自动实测（非 .docx），须人工逐表核 T1—T11');
}
console.log('');
console.log('## AI味扫描（A1—A8 机器可测项）');
console.log('');
console.log(`- A1 对话残留/占位符：${aiFlavor.residue.length} 处`);
aiFlavor.residue.slice(0, 15).forEach((s) => console.log('  - ' + s));
if (aiFlavor.residue.length > 15) console.log(`  - …其余 ${aiFlavor.residue.length - 15} 处见 --json 输出`);
console.log(`- A2 模板套话：共 ${aiFlavor.templateTotal} 处，密度 ${aiFlavor.templatePerKchar ?? '—'} 处/千字；${Object.entries(aiFlavor.templateHits).map(([s, n]) => `${s}×${n}`).join('；') || '无'}`);
console.log(`- A3 空泛断言候选：${aiFlavor.emptyClaims.length} 处${aiFlavor.emptyClaims.length ? '（' + aiFlavor.emptyClaims.slice(0, 5).join('；') + '）' : ''}`);
console.log(`- A4 形容词连排候选：${aiFlavor.parallelHits} 处`);
console.log(`- A5 术语漂移：${aiFlavor.synonymDrift.join('、') || '未检出'}`);
console.log(`- A7 文献年份：${aiFlavor.refYearNote || '未见高度集中'}`);
if (aiFlavor.issues.length) aiFlavor.issues.forEach((w) => console.log('- ✗ ' + w));
console.log('- A6/A8 与最终风险等级须人工判定；AI 味不等于 AI 生成，定性须实锤（见 references/ai-flavor-check.md）');
console.log('');
console.log('## 自动提示');
console.log('');
if (warnings.length) warnings.forEach((w) => console.log('- ' + w));
else console.log('- 未发现自动可判定的硬性问题（仍需人工审读）');
console.log('');
console.log('> 自动统计只覆盖可量化项，不能替代对论证逻辑、图表质量、代码真实性和查重报告的人工审核；AI 味扫描只是风险信号，不能单独定性 AI 代写。');
