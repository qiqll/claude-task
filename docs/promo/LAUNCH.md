# 发布清单（需要你本人操作）

按顺序做。前 4 步做完之前不要发帖，否则用户点进来会看到缺图或打不开的页面。

## 1. 合并并推送

```sh
git switch main && git merge --ff-only release/0.3.1
git tag v0.3.1 && git push origin main v0.3.1
```

## 2. 修复 gh 登录（可选，后面几步会用到）

```sh
gh auth login
```

## 3. GitHub 仓库设置

- **确认仓库是 Public。**
- **About**（仓库首页右上角齿轮）：
  - Description：`Turn Claude Code into a delivery team: backlog in, reviewed & test-verified commits out.`
  - Website：`https://qiqll.github.io/claude-task/`
  - Topics：`claude-code` `claude-code-plugin` `claude` `ai-agent` `autonomous-agent` `backlog` `developer-tools`
  - 或者用命令：
    ```sh
    gh repo edit qiqll/claude-task \
      --description "Turn Claude Code into a delivery team: backlog in, reviewed & test-verified commits out." \
      --homepage https://qiqll.github.io/claude-task/ \
      --add-topic claude-code,claude-code-plugin,claude,ai-agent,autonomous-agent,backlog,developer-tools
    ```
- **Pages**：Settings → Pages → Source 选 `Deploy from a branch`，分支 `main`，目录 `/docs`。几分钟后检查 https://qiqll.github.io/claude-task/ 能否打开。
- **Social preview**：Settings → General → Social preview，上传 `docs/assets/og.png`。
- **Release**：
  ```sh
  gh release create v0.3.1 --title "v0.3.1" --notes-file <(sed -n '/^## 0.3.1/,/^## 0.3.0/p' CHANGELOG.md | sed '$d')
  ```

## 4. 素材（只有你的机器和真实项目能产出）

- `docs/assets/og.png` 已经导出好了。只有改了 `og.svg` 才需要重新导出：`rsvg-convert -w 1200 -h 630 docs/assets/og.svg -o docs/assets/og.png`。
- **`docs/assets/demo.gif`**（最重要）：在一个真实项目里录 20–40 秒，内容是：`/task:add` 说两三条需求 → `/task:loop` → 面板里任务从「进行中」变成「待验证」。终端宽度 ≥110 列，用 `CLAUDE_CODE_NO_FLICKER=1 claude` 启动。录制工具可以用 [vhs](https://github.com/charmbracelet/vhs)、asciinema + agg，或者 Kap。录完压缩到 5MB 以内，提交到 `docs/assets/demo.gif`。提交后把 `README.md` 和 `README.zh-CN.md` 顶部被注释掉的 `<img>` 取消注释（现在注释着，是为了避免显示破图）；落地页会自动显示 GIF。
- **真实数字**：跑一晚后用 `/task:status` 和 `.claude/auto/run.log` 的结果替换 `posts.md` 里的 `【】`。

## 5. 自测安装链路

用一个没装过插件的环境（或先 `claude plugin uninstall task`）：

```text
/plugin install task --marketplace qiqll/claude-task
```

新开会话，确认 `/task:init` 可用、`/plugin` 里显示版本 0.3.1。

## 6. 发布渠道

帖子草稿见 [posts.md](posts.md)。建议节奏：

| 时间 | 渠道 |
|---|---|
| 第 1 天 | V2EX 分享创造、即刻、朋友圈 |
| 第 2 天 | X thread（@ Claude Code 官方账号）、r/ClaudeCode |
| 第 3–4 天 | 掘金长文、小红书图文、r/ClaudeAI |
| 有了第一批反馈后 | Show HN（工作日美东上午发），给 awesome-claude-code 这类列表提 PR |

## 7. 之后每次发版

1. 改 `plugins/task/.claude-plugin/plugin.json` 和 `.claude-plugin/marketplace.json` 里的 `version`，并在 `CHANGELOG.md` 加一节（CI 会检查前者和 CHANGELOG）。
2. 推送并打 tag、创建 GitHub Release。
3. 提醒老用户：`/plugin marketplace update claude-task`。
