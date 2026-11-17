# 发布清单（需要你本人操作）

按顺序做。前 4 步做完之前不要发帖，否则用户点进来会看到缺图或打不开的页面。

## 1–3. 一键发布（已合并到 main 并打好 tag v0.3.1，只差推送）

```sh
gh auth login                 # gh 的 token 已失效，先重新登录
docs/promo/publish.sh         # 推送 main+tag、设置 About/topics、开启 Pages、创建 Release；可重复执行
```

网络不通时（GitHub 连不上），先确认代理能访问 github.com 再执行。下面第 3 节是脚本做的事情的手工版本，供核对；只有 Social preview 必须手工上传。

## 3. GitHub 仓库设置（publish.sh 已覆盖，除 Social preview 外）

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

新开会话，确认 `/task:init` 可用、`/plugin` 里显示版本 0.3.1。再用 README 里的两步写法（`/plugin marketplace add` + `/plugin install task@claude-task`）装一次，确认备用方案也能用。

## 6. 插件目录与发布渠道

> 来源：2026-11-17 调研。所有链接调研时都没能直接打开，只核对了搜索摘要；动手前请先点进去确认当前规则。

### 让用户自己发现（被动长尾，先做）

| 渠道 | 怎么做 | 备注 |
|---|---|---|
| **Anthropic 官方插件目录** | 用付费 Claude 账号登录 claude.ai/directory/manage 提交；文档 https://claude.com/docs/directory/publish 。`anthropics/claude-plugins-official` 仓库已不接受 PR | 审核周期、是否进 `/plugin` → Discover 未确认。上架后用户无需加 marketplace |
| **claudemarketplaces.com、claude-plugins.dev** | 不用操作：自动抓取含 `.claude-plugin/marketplace.json` 的公开仓库 | 过几天去站内搜 `claude-task` 确认 |
| **awesome-claude-code** | Issues 页 "Recommend a new resource" 表单（不接受 PR，手写 issue 会被自动关闭） | 可能要求项目满 14 天或 100 star（未核实）。文字见 posts.md |
| **aitmpl / claude-code-templates** | 给 davila7/claude-code-templates 提 PR，先看它的 CONTRIBUTING | 可选 |

### 主动推广（集中在一周内发，借助彼此的热度冲 GitHub Trending）

| 顺序 | 渠道 | 文案 |
|---|---|---|
| 第 1 天 | V2EX（分享创造 + Claude Code 节点）、即刻、朋友圈 | posts.md |
| 第 1 天 | 投 HelloGitHub、阮一峰周刊（编辑周期长，尽早投） | posts.md 末尾 |
| 第 2 天 | X thread（@ Claude Code 官方账号）、r/ClaudeCode | posts.md |
| 第 3 天 | 掘金长文、小红书图文、r/ClaudeAI（先看版规） | posts.md |
| 第 4–5 天 | Show HN（美东工作日上午），首条评论自己写 | posts.md |
| 可选 | Product Hunt / DevHunt、Console.dev（免费提交）、Anthropic Discord（从 claude.com/community 拿官方邀请）、开源中国 / Gitee 同步 | — |

几点：同一个项目不要在同一渠道反复发；及时回复评论；有了真实运行结果（截图 + 数字）后可以发第二轮。

## 7. 之后每次发版

1. 改 `plugins/task/.claude-plugin/plugin.json` 里的 `version`（唯一的版本号来源），并在 `CHANGELOG.md` 加一节；CI 会检查这两处。
2. 推送并打 tag、创建 GitHub Release。
3. 提醒老用户：`/plugin marketplace update claude-task`。
