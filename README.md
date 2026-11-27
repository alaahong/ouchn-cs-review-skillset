# 国开实验学院计科论文审核 Skills

面向国家开放大学实验学院计算机科学与技术专业本科（专科起点）的两个 Qoder Skills，用于开题报告和学位论文的规范审核。审核以学校现行文件、本学期模板和人工判断为准，机器统计只提供辅助证据。

> 当前审核口径基于 2026 年秋季学期材料。开题脚本内置了 2026 秋时间节点，更换学期时必须同步更新脚本常量与 `references/` 中的要求说明。

## Skills

| Skill | 适用阶段 | 主要检查 | 产出 |
| --- | --- | --- | --- |
| [`guokai-cs-proposal-review`](guokai-cs-proposal-review/SKILL.md) | 开题报告 | 五栏表单、选题质量与撞题、研究现状、技术路线、技术栈、工作量、二级提纲、文献、进度、AI 味 | 结论先行的开题审核报告、优先修改清单、学生版反馈 |
| [`guokai-cs-thesis-review`](guokai-cs-thesis-review/SKILL.md) | 初稿、修改稿、定稿、答辩前；也覆盖开题口径 | 字数与结构、目录逻辑、章节内容、图表样式、文献、格式、查重材料、AI 味、硬门槛 | 四维估分区间、硬门槛判定、章节与样式核查、学生版反馈 |

开题报告优先使用 `guokai-cs-proposal-review`。该 Skill 不会把论文阶段的 6000 字底线、摘要、目录、表格样式和查重要求套用到开题报告上。

## 仓库结构

```text
.
├── guokai-cs-proposal-review/
│   ├── SKILL.md
│   ├── assets/report-template.md
│   ├── references/
│   │   ├── ai-flavor-check.md
│   │   ├── proposal-check.md
│   │   └── proposal-requirements.md
│   └── scripts/proposal_metrics.cjs
├── guokai-cs-thesis-review/
│   ├── SKILL.md
│   ├── assets/report-template.md
│   ├── references/
│   │   ├── ai-flavor-check.md
│   │   ├── content-logic-check.md
│   │   ├── requirements.md
│   │   └── structure.md
│   └── scripts/extract_metrics.cjs
└── .gitignore
```

学校原始培训材料、学生论文和审核报告不纳入仓库。`references/` 保存从学校材料中整理出的审核口径与来源清单，正式审核时仍应核对当前学期模板和最新通知。

## 环境依赖

- Node.js：两个指标脚本均为 CommonJS 脚本，已在 Node.js 24 上验证。
- `unzip`：读取 `.docx` 中的正文、样式和文档属性。
- `pdftotext`：读取 `.pdf`，通常由 Poppler 提供。
- 以上命令必须可在执行脚本的环境中调用；Windows 下需确保已加入 `PATH`。

支持 `.docx`、`.pdf`、`.txt`。旧版 `.doc` 请先用 Word 或 WPS 另存为 `.docx`。

检查依赖：

```bash
node --version
unzip -v
pdftotext -v
```

## 安装

克隆仓库：

```bash
git clone git@github.com:alaahong/ouchn-cs-review-skillset.git
cd ouchn-cs-review-skillset
```

将需要使用的 Skill 目录复制到 Qoder 的用户技能目录。当前 Windows 环境对应：

```text
C:\Users\<用户名>\.qoder-cn\skills\
```

复制后应形成：

```text
C:\Users\<用户名>\.qoder-cn\skills\guokai-cs-proposal-review\SKILL.md
C:\Users\<用户名>\.qoder-cn\skills\guokai-cs-thesis-review\SKILL.md
```

Qoder 能扫描到技能目录后，即可通过 Skill 名称或自然语言触发。

## 使用

### 在 Qoder 中审核

开题报告：

```text
请用 guokai-cs-proposal-review 审核这份开题报告：
D:\papers\开题报告.docx
本学期为 2026 秋，学生申请学位，请给出完整审核报告和学生版反馈。
```

学位论文：

```text
请用 guokai-cs-thesis-review 审核这份论文修改稿：
D:\papers\论文修改稿.docx
学生申请学位，请重点检查目录逻辑、章节内容合理性、图表样式、参考文献和 AI 味。
```

建议同时提供审核阶段、是否申请学位、本学期和已有选题评审意见。缺少信息时，Skill 会按默认口径预审并标注待确认项。

### 单独运行指标脚本

开题指标：

```bash
node guokai-cs-proposal-review/scripts/proposal_metrics.cjs "D:\papers\开题报告.docx"
node guokai-cs-proposal-review/scripts/proposal_metrics.cjs "D:\papers\开题报告.pdf" --json
```

论文指标：

```bash
node guokai-cs-thesis-review/scripts/extract_metrics.cjs "D:\papers\论文定稿.docx"
node guokai-cs-thesis-review/scripts/extract_metrics.cjs "D:\papers\论文定稿.pdf" --json
```

`--json` 输出机器可读结果，便于接入其他审核流程。脚本统计包括：

- 开题：表单五栏、提纲、观测点承诺、文献、进度节点、技术栈和 AI 味信号。
- 论文：字数、结构、文献、章节篇幅、目录逻辑、表格样式和 AI 味信号。

`.pdf` 与 `.txt` 无法提供 `.docx` 的全部样式信息，目录逻辑和表格样式需要人工补查。

## 审核口径

### 开题报告

- 学校五栏表单齐全，参考文献不少于 5 篇。
- 只估“选题与设计 20 分”，其余维度证据不足时不估分。
- 进度按学校节点倒排，必须留出实现、测试和查重时间。
- 不适用正文 6000 字底线、查重率和论文图表样式要求。
- 批次撞题需要本地选题记录或用户提供的同批次题目；没有记录时会要求补充信息。

### 学位论文

- 正文不少于 6000 字，不含程序清单、截图和图纸。
- 参考文献不少于 10 篇，建议 15 篇左右，外文文献 2—3 篇。
- 申请学位按 80 分门槛审核；不申请学位按 60 分及格线审核。
- 初稿不强制提供查重报告，但重复率须低于 30%；定稿和答辩前必须凭查重报告判断。
- 目录逻辑、样式统一性、章节内容合理性和 AI 味均需逐项给证据，不能用“基本规范”概括通过。

## 边界与诚信

- 本仓库是审核辅助工具，不替代指导教师、责任教师或答辩小组的正式评价。
- 字数、文献数量、年份和日期推断为脚本近似值，临界值必须人工复核。
- 套话、排比、翻译腔等 AI 味信号不等于 AI 代写证明；定性必须有实锤。
- 查不到的信息写“未能核实”，不虚构页码、分数、查重率或文献。
- 不代写论文，不整段改写学生材料。
- 学生原始材料和生成的审核报告不应提交到 Git；`.gitignore` 已忽略常见文档格式与 `审核报告_*` 文件。

## 更新 Skill

1. 修改对应 Skill 的 `SKILL.md`、`references/` 或脚本。
2. 更新 frontmatter 中的 `version`，并在 `SKILL.md` 的“版本说明”中追加记录。
3. 更换学期时，同步更新开题脚本的 `MILESTONES`、`SEMESTER_WINDOW`、`BASE_YEAR` 和两份要求说明中的时间节点。
4. 执行语法与冒烟测试：

   ```bash
   node --check guokai-cs-proposal-review/scripts/proposal_metrics.cjs
   node --check guokai-cs-thesis-review/scripts/extract_metrics.cjs
   ```

5. 用脱敏样本验证 `.docx`、`.pdf`、`.txt` 和 `--json` 输出，确认脚本提示与人工审核一致后再提交。
