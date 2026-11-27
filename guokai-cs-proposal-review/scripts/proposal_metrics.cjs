#!/usr/bin/env node
'use strict';

// 开题报告专用指标脚本：只测开题阶段适用项，不套用论文正文的字数/目录/表格样式检查。
// 用法: node proposal_metrics.cjs <开题报告.docx|.pdf|.txt> [--json]
// 学期节点默认 2026 秋；换学期时修改下方 MILESTONES 与 SEMESTER_WINDOW。

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const MILESTONES = {
  开题: '2026-11-15',
  初稿: '2026-11-30',
  修改稿: '2026-12-15',
  定稿: '2026-12-27',
  答辩: '2027-01-04',
  验收: '2027-01-16',
};
const SEMESTER_WINDOW = { start: '2026-09-01', end: '2027-01-16' };
const BASE_YEAR = 2026; // 无年份的“M月D日”按此推断：9—12 月属 BASE_YEAR，1—8 月属 BASE_YEAR+1

const FILE = process.argv[2];
const JSON_ONLY = process.argv.includes('--json');
if (!FILE || !fs.existsSync(FILE)) {
  console.error('用法: node proposal_metrics.cjs <开题报告.docx|.pdf|.txt> [--json]');
  process.exit(2);
}
const ext = path.extname(FILE).toLowerCase();
if (ext === '.doc') {
  console.error('.doc 旧格式无法直接解析：请用 Word/WPS 另存为 .docx 后重试（WPS 生成的 .doc 用 antiword 会失败）。');
  process.exit(2);
}

const decodeXml = (s) => s
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function readDocx(file) {
  const xml = cp.execFileSync('unzip', ['-p', file, 'word/document.xml'], { maxBuffer: 256 * 1024 * 1024 }).toString('utf8');
  const paras = [];
  const re = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let m;
  while ((m = re.exec(xml))) {
    let text = '';
    const tre = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
    let t;
    while ((t = tre.exec(m[1]))) text += decodeXml(t[1]);
    text = text.replace(/\s+/g, ' ').trim();
    if (text) paras.push(text);
  }
  let pages = null;
  try {
    const app = cp.execFileSync('unzip', ['-p', file, 'docProps/app.xml'], { maxBuffer: 16 * 1024 * 1024 }).toString('utf8');
    pages = Number((app.match(/<Pages>(\d+)<\/Pages>/) || [])[1]) || null;
  } catch (_) { /* 无 app.xml */ }
  return { paras, pages, kind: 'docx' };
}
function readPdf(file) {
  const out = cp.execFileSync('pdftotext', ['-enc', 'UTF-8', '-layout', file, '-'], { maxBuffer: 256 * 1024 * 1024 }).toString('utf8');
  const pages = (out.match(/\f/g) || []).length;
  return { paras: out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean), pages, kind: 'pdf' };
}
function readTxt(file) {
  return { paras: fs.readFileSync(file, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean), pages: null, kind: 'txt' };
}

let doc;
try {
  if (ext === '.docx') doc = readDocx(FILE);
  else if (ext === '.pdf') doc = readPdf(FILE);
  else if (ext === '.txt') doc = readTxt(FILE);
  else { console.error('不支持的文件类型: ' + ext + '（请提供 .docx/.pdf/.txt）'); process.exit(2); }
} catch (e) {
  console.error('提取失败: ' + e.message);
  console.error('请确认已安装 ' + (ext === '.pdf' ? 'pdftotext' : 'unzip') + '，或改用其他格式。');
  process.exit(1);
}

const paras = doc.paras;
const allText = paras.join('\n');
const cjkCount = (s) => (s.match(/[一-鿿]/g) || []).length;
const cjkTotal = cjkCount(allText);
const warnings = [];

// ---------- 封面信息 ----------
const cover = {};
[['姓名', /^姓\s*名$/], ['学号', /^学\s*号$/], ['教育层次', /^教育层次$/], ['年级专业', /^年级专业$/], ['题目', /^题\s*目$/]].forEach(([key, re]) => {
  const i = paras.findIndex((t) => re.test(t));
  if (i >= 0 && paras[i + 1]) cover[key] = paras[i + 1];
  else {
    const inline = paras.find((t) => new RegExp('^' + re.source.slice(1, -1) + '[：:\\s]+\\S').test(t));
    if (inline) cover[key] = inline.replace(/^[^：:]+[：:]\s*/, '');
  }
});

// ---------- 表单五栏定位 ----------
const COL_RES = [
  ['第1栏 选题目的意义与研究现状', /^(?:1|一)\s*[\.、．]\s*本选题的目的或意义/],
  ['第2栏 基本观点、研究方法与写作步骤', /^(?:2|二)\s*[\.、．]\s*本选题的基本观点/],
  ['第3栏 论文提纲', /^(?:3|三)\s*[\.、．]\s*论文提纲/],
  ['第4栏 参考文献', /^(?:4|四)\s*[\.、．]\s*与本选题相关的主要参考文献/],
  ['第5栏 指导教师意见', /^(?:5|五)\s*[\.、．]\s*指导教师意见/],
];
const colIdx = COL_RES.map(([label, re]) => ({ label, idx: paras.findIndex((t) => re.test(t)) }));
const form = { cols: colIdx.map((c) => ({ 栏: c.label, 识别: c.idx >= 0, 段首: c.idx >= 0 ? paras[c.idx].slice(0, 50) : null })) };
const missingCols = colIdx.filter((c) => c.idx < 0).map((c) => c.label);
if (missingCols.length) warnings.push('表单栏位未识别：' + missingCols.join('、') + '（可能栏名措辞不同或非学校表单，须人工核五栏齐全）');
const region = (n) => {
  const start = colIdx[n].idx;
  if (start < 0) return [];
  let end = paras.length;
  for (let k = n + 1; k < colIdx.length; k++) if (colIdx[k].idx > start) { end = colIdx[k].idx; break; }
  return paras.slice(start + 1, end);
};

// 第5栏预填检测（意见应由教师填写，学生不得预填）
const col5 = region(4);
const sigIdx = col5.findIndex((t) => /指导教师签名/.test(t));
const opinionBuf = (sigIdx >= 0 ? col5.slice(0, sigIdx) : col5).filter((t) => !/^年\s*月\s*日$/.test(t) && t.length > 4);
const prefilled = opinionBuf.length ? opinionBuf.join(' ').slice(0, 80) : null;
if (prefilled) warnings.push('第5栏指导教师意见已预填文字（「' + prefilled + '」），应清空由教师填写签名');

// ---------- 提纲（第3栏）：章数、小节数、编号连续、体例 ----------
const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
const outlineText = region(2);
const chapters = [];
const sections = [];
outlineText.forEach((t) => {
  let m = t.match(/^第\s*([一二三四五六七八九十百0-9]{1,4})\s*章\s*(.*)$/);
  if (m) { chapters.push({ num: CN[m[1]] || Number(m[1]), title: t, style: '第X章' }); return; }
  m = t.match(/^([一二三四五六七八九十]{1,3})\s*、\s*(.*)$/);
  if (m && t.length <= 50) { chapters.push({ num: CN[m[1]], title: t, style: '一、' }); return; }
  m = t.match(/^(\d{1,2})\s*[\.、．]\s*(?!\d)(.*)$/);
  if (m && t.length <= 50 && !/^\d+\.\d+/.test(t)) { chapters.push({ num: Number(m[1]), title: t, style: '1.' }); return; }
  m = t.match(/^(\d{1,2})\.(\d{1,2})\s*(.*)$/);
  if (m) { sections.push({ chap: Number(m[1]), seq: Number(m[2]), title: t, style: 'X.Y' }); return; }
  m = t.match(/^[（(]([一二三四五六七八九十]{1,3})[）)]\s*(.*)$/);
  if (m && t.length <= 60) { sections.push({ chap: null, seq: CN[m[1]], title: t, style: '（一）' }); return; }
});
const outline = {
  chapters: chapters.length, sections: sections.length,
  chapterTitles: chapters.map((c) => c.title),
  styles: [...new Set(chapters.map((c) => c.style))],
  issues: [],
};
if (chapters.length && (chapters.length < 6 || chapters.length > 8)) outline.issues.push(`提纲 ${chapters.length} 章（论文骨架参考 6—8 章），须人工确认合并/拆分是否合理`);
if (outline.styles.length > 1) outline.issues.push('章编号体例混用：' + outline.styles.join(' / '));
let expect = 1;
chapters.forEach((c) => { if (c.num !== expect) outline.issues.push(`章编号不连续：期望 ${expect} 实为 ${c.num}（${c.title.slice(0, 30)}）`); expect = c.num + 1; });
// X.Y 体例：小节章号须等于所在章、序号连续
if (sections.some((s) => s.style === 'X.Y')) {
  let curChap = 0, expectSeq = 1;
  const chapNums = chapters.map((c) => c.num);
  sections.forEach((s) => {
    if (!chapNums.includes(s.chap)) outline.issues.push(`小节章号无对应章：${s.title.slice(0, 30)}`);
    if (s.chap !== curChap) { curChap = s.chap; expectSeq = 1; }
    if (s.seq !== expectSeq) outline.issues.push(`小节编号不连续：期望 ${curChap}.${expectSeq} 实为 ${s.chap}.${s.seq}（${s.title.slice(0, 30)}）`);
    expectSeq = s.seq + 1;
  });
}
// （一）体例：按章分组核连续（章界用“一、”标题）
if (sections.some((s) => s.style === '（一）')) {
  let expectSeq = 1;
  outlineText.forEach((t) => {
    if (/^[一二三四五六七八九十]{1,3}\s*、/.test(t)) { expectSeq = 1; return; }
    const m = t.match(/^[（(]([一二三四五六七八九十]{1,3})[）)]/);
    if (!m) return;
    const n = CN[m[1]];
    if (n !== expectSeq) outline.issues.push(`小节编号不连续：期望（${Object.keys(CN).find((k) => CN[k] === expectSeq)}）实为（${m[1]}）（${t.slice(0, 30)}）`);
    expectSeq = n + 1;
  });
}
const roleMap = [
  ['绪论/引言', /绪\s*论|引\s*言/], ['相关技术', /相关技术|关键技术|技术基础|技术选型/],
  ['需求分析', /需求/], ['系统设计', /设计/], ['系统实现', /实现/],
  ['系统测试', /测试/], ['总结与展望', /总结|结\s*论|展望/],
];
const roles = {};
roleMap.forEach(([name, re]) => { roles[name] = chapters.some((c) => re.test(c.title)); });
['绪论/引言', '需求分析', '系统设计', '系统实现', '系统测试', '总结与展望'].forEach((r) => {
  if (!roles[r]) outline.issues.push(`提纲未见承担「${r}」的章（章名可能不含关键词，须人工核）`);
});
if (!roles['相关技术']) outline.issues.push('提纲未见「相关技术」章（可并入他章，须人工确认技术选型有落点）');

// ---------- 观测点产出承诺（提纲＋第2栏文字；缺失≠不合格，初稿必须补齐） ----------
const planText = outlineText.join('\n') + '\n' + region(1).join('\n');
const commitments = {};
[['功能结构图', /功能结构图/], ['用例图', /用例图/], ['用例描述表', /用例描述表/], ['业务流程图', /业务流程图/],
 ['E-R图', /E-?R\s*图|实体关系图|ER图/i], ['联系基数', /基数/], ['架构图', /架构图|体系结构/],
 ['活动图或顺序图', /活动图|顺序图|时序图/], ['表结构或数据字典', /表结构|数据字典|字段设计/],
 ['测试环境与条件', /测试环境|测试条件|实验环境/], ['关键代码含注释', /关键代码|核心代码/], ['界面截图', /界面|截图/],
].forEach(([name, re]) => { commitments[name] = re.test(planText); });

// ---------- 参考文献（第4栏，表单内逐条解析） ----------
const refBuf = region(3).filter((t) => !/^主要参考文献[：:]?\s*$/.test(t));
const currentYear = new Date().getFullYear();
const cutoff = currentYear - 5;
const refCore = (l) => l.replace(/https?:\/\/\S+/gi, ' ').replace(/doi\s*:\s*\S+/gi, ' ');
const refs = { total: refBuf.length, entries: [], numbered: 0, unnumbered: [], recent: 0, foreign: 0, noYear: 0, noTypeMark: 0 };
refBuf.forEach((l, i) => {
  const s = refCore(l);
  const numM = l.match(/^\s*\[(\d{1,3})\]/);
  if (numM) refs.numbered++; else refs.unnumbered.push(i + 1);
  const ys = (s.match(/(?:19|20)\d{2}/g) || []).map(Number);
  const year = ys.length ? ys[ys.length - 1] : null;
  if (year === null) refs.noYear++; else if (year >= cutoff) refs.recent++;
  const cjk = cjkCount(s);
  const latin = (s.match(/[A-Za-z]/g) || []).length;
  const foreign = cjk === 0 && latin >= 20;
  if (foreign) refs.foreign++;
  const typeMark = /\[(?:J|M|D|C|N|S|P|EB\/OL|EB|OL|A|G)\]/.test(l);
  if (!typeMark) refs.noTypeMark++;
  refs.entries.push({ n: numM ? Number(numM[1]) : null, year, foreign, typeMark, text: l.slice(0, 60) });
});
if (refs.total && refs.total < 5) warnings.push(`参考文献 ${refs.total} 条，学校表单要求 ≥5 条`);
if (refs.total && refs.recent / refs.total < 0.5) warnings.push(`近 5 年（${cutoff} 年起）文献 ${refs.recent}/${refs.total}，占比不足一半${refs.noYear ? `（${refs.noYear} 条未著录年份须人工核）` : ''}`);
if (refs.foreign < 2) warnings.push(`外文文献疑似 ${refs.foreign} 篇（专业要求 2—3 篇，开题可暂缺、初稿前必须补齐；自动识别须人工确认）`);
if (refs.unnumbered.length) warnings.push(`文献第 ${refs.unnumbered.join('、')} 条缺 [n] 编号，体例不一`);
if (refs.noTypeMark) warnings.push(`${refs.noTypeMark}/${refs.total} 条文献缺 [J]/[M]/[D] 等类型标识，疑似知网/万方题录直接导出，须按 GB/T 7714—2015 逐条重录并人工核著录`);
if (!refs.total) warnings.push('第4栏未解析出文献条目（可能栏名不同或条目合并在一段），须人工核');

// ---------- 进度安排（第2栏）与学校节点比对 ----------
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const schedule = { items: [], issues: [] };
let lastYear = null;
const inferYear = (month) => lastYear || (month >= 9 ? BASE_YEAR : BASE_YEAR + 1);
region(1).forEach((t) => {
  const dates = [];
  const fullRe = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?|(\d{4})-(\d{1,2})-(\d{1,2})/g;
  const mdRe = /(?<![\d-])(\d{1,2})\s*月\s*(\d{1,2})\s*日?/g;
  let m;
  const tokens = [];
  while ((m = fullRe.exec(t))) {
    const y = Number(m[1] || m[4]), mo = Number(m[2] || m[5]), d = Number(m[3] || m[6]);
    tokens.push({ off: m.index, y, mo, d }); lastYear = y;
  }
  while ((m = mdRe.exec(t))) {
    const mo = Number(m[1]), d = Number(m[2]);
    if (tokens.some((x) => Math.abs(x.off - m.index) < 6)) continue; // 已被完整日期覆盖
    tokens.push({ off: m.index, y: inferYear(mo), mo, d, inferred: true });
  }
  tokens.sort((a, b) => a.off - b.off);
  tokens.forEach((x) => dates.push(iso(x.y, x.mo, x.d)));
  if (!dates.length) return;
  const start = dates[0], end = dates[dates.length - 1];
  // 阶段按步骤标题（首个括号/日期之前）识别，长词优先；标题无阶段词时回退全段；查重是初稿/修改稿之后的子活动，不参与节点比对
  const label = t.split(/[（(]/)[0].split(/\d{4}\s*年|\d{1,2}\s*月/)[0];
  const stageOf = (s) => ['修改稿', '定稿', '答辩', '初稿', '开题'].find((k) => s.includes(k)) || null;
  const stage = /查重/.test(label) ? null : (stageOf(label) || stageOf(t));
  const item = { text: t.slice(0, 45), start, end, stage, yearInferred: tokens.some((x) => x.inferred) };
  if (stage && MILESTONES[stage] && end > MILESTONES[stage]) {
    item.verdict = `晚于学校${stage}节点 ${MILESTONES[stage]}`;
    schedule.issues.push(`进度「${item.text}」结束 ${end}，晚于学校${stage}截止 ${MILESTONES[stage]}`);
  }
  if (end > SEMESTER_WINDOW.end || start < SEMESTER_WINDOW.start) {
    item.verdict = (item.verdict ? item.verdict + '；' : '') + '超出本学期窗口';
    schedule.issues.push(`进度「${item.text}」（${start}～${end}）超出本学期窗口 ${SEMESTER_WINDOW.start}～${SEMESTER_WINDOW.end}`);
  }
  schedule.items.push(item);
});
if (!schedule.items.length) warnings.push('第2栏未解析出日期安排（可能用“第X周”表述），须人工比对学校节点');

// ---------- 技术栈时效与命名疑似问题（K5 支撑，逐条人工确认） ----------
const techChecks = [
  [/Vue\s*2(?![.\d])/i, 'Vue 2 已于 2023-12-31 停止维护（EOL），新项目应选 Vue 3'],
  [/\.NET\s*Core\s*[4-9]/i, '.NET Core 品牌止于 3.1，".NET Core 8/9" 命名错误，应写 .NET 8/9 或 ASP.NET Core'],
  [/SignalR\s*中间件/, 'SignalR 是实时通信框架，不是 ASP.NET Core 管道中间件'],
  [/MySql/, '规范写法为 MySQL'],
  [/Uniapp|uniapp/, '规范写法为 uni-app'],
  [/Python\s*2(?![.\d])/, 'Python 2 已于 2020 年停止维护'],
  [/AngularJS/, 'AngularJS（1.x）已停止维护，应选 Angular 或 Vue/React'],
];
const techHits = [];
techChecks.forEach(([re, note]) => {
  paras.forEach((t, i) => {
    if (re.test(t)) techHits.push({ para: i + 1, text: t.slice(0, 40), note });
  });
});
if (/Spring\s*Boot\s*3/i.test(allText) && /JDK\s*(?:1\.)?8\b|Java\s*8\b/i.test(allText)) {
  techHits.push({ para: null, text: '全文同时出现 Spring Boot 3 与 JDK 8/Java 8', note: 'Spring Boot 3 最低要求 JDK 17，版本组合矛盾' });
}

// ---------- AI 味扫描（A1/A2/A3/A4/A5/A7；分母＝全文汉字数，开题无“正文”概念） ----------
const aiFlavor = { residue: [], templateHits: {}, templateTotal: 0, templatePerKchar: null, emptyClaims: [], parallelHits: 0, synonymDrift: [], refYearNote: '', issues: [] };
const snip = (t) => t.slice(0, 30);
const residueRes = [
  ['AI对话开场', /(?:好的[，,]|当然可以|没问题[，,]|以下是(?:为您|为你)?(?:生成|整理|提供)|下面是(?:为您|为你)?)/],
  ['AI对话收尾', /希望(?:以上|这|本文)?(?:内容)?(?:对(?:你|您)|能够)|如果(?:你|您)(?:还)?(?:有|需要)(?:任何|其他)?(?:问题|需求|疑问)|随时(?:告诉|联系)(?:我|我们)/],
  ['AI身份自述', /作为(?:一个|一名)?\s*(?:AI|人工智能|语言模型|智能助手)/],
  ['Markdown残留', /\*\*[^*\n]{1,40}\*\*|```|^#{1,6}\s+\S/],
  ['占位符', /X{3,}|（(?:此处|这里)(?:插入|填写|补充)[^）]{0,20}）|\[(?:插入|填写|待补充|此处)[^\]]{0,20}\]|(?:单击|点击)(?:此处|这里)(?:输入|添加)|待补充|待填写|TODO|Lorem\s+ipsum/i],
];
residueRes.forEach(([label, re]) => {
  paras.forEach((p, i) => { if (re.test(p)) aiFlavor.residue.push(`${label}（段${i + 1}「${snip(p)}」）`); });
});
if (aiFlavor.residue.length) aiFlavor.issues.push(`A1 疑似 AI 对话残留/占位符 ${aiFlavor.residue.length} 处（实锤级信号，逐条人工确认成立/误报）`);
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
aiFlavor.templatePerKchar = cjkTotal ? Math.round((aiFlavor.templateTotal / cjkTotal) * 10000) / 10 : null;
if (aiFlavor.templatePerKchar !== null && aiFlavor.templatePerKchar >= 6) aiFlavor.issues.push(`A2 模板套话 ${aiFlavor.templateTotal} 处，密度 ${aiFlavor.templatePerKchar} 处/千字（参考阈值 6/12；业务术语如“处置闭环”须人工判误报）`);
const emptyRes = [
  /(?:运行|系统)(?:良好|稳定|正常)[^。；\n]{0,20}(?:达到|满足)(?:预期|设计)(?:要求|目标)/g,
  /各项(?:功能|指标|性能)均?(?:达到|满足)(?:预期|设计)(?:要求|目标)/g,
  /取得(?:了)?(?:良好|较好|显著)(?:的)?(?:效果|成效)/g,
];
paras.forEach((p, i) => {
  if (aiFlavor.emptyClaims.length >= 10) return;
  if (emptyRes.some((re) => { re.lastIndex = 0; return re.test(p); })) aiFlavor.emptyClaims.push(`段${i + 1}「${snip(p)}」`);
});
const aiAdj = '(?:高效|稳定|可靠|易用|灵活|安全|便捷|智能|准确|及时|完整|规范|友好|直观|清晰|强大|丰富|全面|快速|简便|健壮|优雅)';
aiFlavor.parallelHits = (allText.match(new RegExp(aiAdj + '(?:、' + aiAdj + '){2,}', 'g')) || []).length;
if (aiFlavor.parallelHits >= 3) aiFlavor.issues.push(`A4 抽象形容词连排 ${aiFlavor.parallelHits} 处，人工核实是否成段堆砌`);
const driftPairs = [
  ['登录', /登入|签入/g], ['数据库', /资料库/g], ['软件', /软体/g], ['硬件', /硬体/g],
  ['网络', /网路/g], ['界面', /介面/g], ['服务器', /伺服器/g], ['内存', /记忆体/g], ['程序', /(?<!方)程式/g],
];
driftPairs.forEach(([std, re]) => {
  const n = (allText.match(re) || []).length;
  if (n) aiFlavor.synonymDrift.push(`${std}→变体×${n}`);
});
if (aiFlavor.synonymDrift.length) aiFlavor.issues.push('A5 疑似术语漂移：' + aiFlavor.synonymDrift.join('、') + '；人工确认是否同一概念混用');
const refYears = refs.entries.map((e) => e.year).filter((y) => y !== null);
const yearSet = [...new Set(refYears)];
if (refs.total >= 6 && refYears.length >= 6 && yearSet.length <= 2) {
  aiFlavor.refYearNote = `文献年份高度集中：${yearSet.join('、')}（${refYears.length} 条有著录年）`;
  aiFlavor.issues.push('A7 ' + aiFlavor.refYearNote + '，抽查 2—3 条可检索性');
}
aiFlavor.issues.forEach((w) => warnings.push(w));
outline.issues.forEach((w) => warnings.push(w));
schedule.issues.forEach((w) => warnings.push(w));
if (doc.kind !== 'docx') warnings.push('非 .docx：表单栏位与段落切分按文本行识别，栏位/条目边界须人工复核');

const result = {
  file: path.basename(FILE), kind: doc.kind, pages: doc.pages, cjkTotal,
  note: '开题报告无字数底线、无摘要/目录/声明栏位；6000 字与查重要求属论文正文阶段',
  cover, form, prefilledOpinion: prefilled,
  outline, roles, commitments, refs, schedule, techHits, aiFlavor, warnings,
};

if (JSON_ONLY) { console.log(JSON.stringify(result, null, 2)); process.exit(0); }

const line = (k, v) => console.log(`| ${k} | ${v} |`);
console.log('## 开题报告指标速览');
console.log('');
console.log('| 项目 | 数值 |');
console.log('| --- | --- |');
line('文件', `${result.file}（${result.kind}）`);
line('页数', result.pages ?? '未读取');
line('全文汉字数', `${cjkTotal}（开题无字数底线，不作 6000 字判定）`);
line('封面', Object.entries(cover).map(([k, v]) => `${k}:${v}`).join('；') || '未识别');
console.log('');
console.log('## 表单五栏');
console.log('');
form.cols.forEach((c) => console.log(`- ${c.栏}：${c.识别 ? '已识别' : '✗ 未识别'}`));
console.log(`- 第5栏预填：${prefilled ? '✗ 有（「' + prefilled + '」），应清空由教师填写' : '无（空白待教师填写）'}`);
console.log('');
console.log('## 提纲（第3栏）');
console.log('');
console.log(`- ${outline.chapters} 章 / ${outline.sections} 节；体例：${outline.styles.join('、') || '未识别'}`);
outline.chapterTitles.forEach((t) => console.log('  - ' + t));
console.log('- 章角色覆盖：' + Object.entries(roles).map(([k, v]) => `${k}${v ? '✓' : '✗'}`).join(' '));
if (outline.issues.length) outline.issues.forEach((w) => console.log('- ✗ ' + w));
else console.log('- 编号连续、体例单一（核心亮点是否显性化须人工核 K7）');
console.log('');
console.log('## 观测点产出承诺（提纲＋第2栏；缺失≠不合格，初稿必须补齐）');
console.log('');
console.log('- ' + Object.entries(commitments).map(([k, v]) => `${k}${v ? '✓' : '✗'}`).join(' '));
console.log('');
console.log('## 参考文献（第4栏）');
console.log('');
console.log(`- 共 ${refs.total} 条（表单要求 ≥5）；近 5 年 ${refs.recent} 条；疑似外文 ${refs.foreign} 条；未著录年份 ${refs.noYear} 条；缺类型标识 ${refs.noTypeMark} 条；缺编号 ${refs.unnumbered.length} 条`);
refs.entries.forEach((e) => console.log(`  - ${e.n ? '[' + e.n + ']' : '[无编号]'} ${e.year || '年份?'}${e.foreign ? '（外文）' : ''}${e.typeMark ? '' : '（缺类型标识）'} ${e.text}`));
console.log('');
console.log('## 进度安排 vs 学校节点（默认 2026 秋，换学期须改脚本常量）');
console.log('');
console.log('| 安排（前45字） | 起 | 止 | 阶段 | 判定 |');
console.log('| --- | --- | --- | --- | --- |');
schedule.items.forEach((s) => console.log(`| ${s.text} | ${s.start}${s.yearInferred ? '*' : ''} | ${s.end}${s.yearInferred ? '*' : ''} | ${s.stage || '—'} | ${s.verdict || '未见晚于节点'} |`));
console.log('');
console.log('* 年份由上下文推断，须人工复核；阶段按步骤标题识别（长词优先），查重等子活动不参与节点比对；一步含多阶段时须人工拆');
if (schedule.issues.length) schedule.issues.forEach((w) => console.log('- ✗ ' + w));
console.log('');
console.log('## 技术栈时效与命名疑似问题（K5，逐条人工确认）');
console.log('');
if (techHits.length) techHits.forEach((h) => console.log(`- 段${h.para ?? '—'}「${h.text}」→ ${h.note}`));
else console.log('- 未命中已知 EOL/命名问题清单（清单有限，人工仍须核技术栈时效与术语）');
console.log('');
console.log('## AI 味扫描（A1/A2/A3/A4/A5/A7；分母＝全文汉字数）');
console.log('');
console.log(`- A1 对话残留/占位符：${aiFlavor.residue.length} 处`);
aiFlavor.residue.slice(0, 15).forEach((s) => console.log('  - ' + s));
console.log(`- A2 模板套话：共 ${aiFlavor.templateTotal} 处，密度 ${aiFlavor.templatePerKchar ?? '—'} 处/千字；${Object.entries(aiFlavor.templateHits).map(([s, n]) => `${s}×${n}`).join('；') || '无'}`);
console.log(`- A3 空泛断言候选：${aiFlavor.emptyClaims.length} 处${aiFlavor.emptyClaims.length ? '（' + aiFlavor.emptyClaims.slice(0, 5).join('；') + '）' : ''}`);
console.log(`- A4 形容词连排候选：${aiFlavor.parallelHits} 处`);
console.log(`- A5 术语漂移：${aiFlavor.synonymDrift.join('、') || '未检出'}`);
console.log(`- A7 文献年份：${aiFlavor.refYearNote || '未见高度集中'}`);
console.log('- A6 开题不适用（无代码/截图/环境表）；A8 与风险等级人工判定；AI 味≠AI 生成，定性须实锤');
console.log('');
console.log('## 自动提示');
console.log('');
if (warnings.length) warnings.forEach((w) => console.log('- ' + w));
else console.log('- 未发现自动可判定的问题（仍需人工按 K1—K10 审读）');
console.log('');
console.log('> 脚本只覆盖可量化项；技术承诺可行性、撞题、需求来源、前后一致性须人工审核。文献条数/外文/年份为近似值，边界须人工复核。');