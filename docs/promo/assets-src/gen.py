import html, re, sys
root = sys.argv[1]
raw = open(root + '/docs/promo/assets-src/report.txt').read()
def block(lang):
    m = re.search(r'=====' + re.escape(lang) + r'\n(.*?)\n=====END', raw, re.S); return m.group(1)
def status(lang):
    return re.search(r'STATUS\[' + re.escape(lang) + r'\]: (.*)', raw).group(1)
def colorize(txt):
    out = []
    for line in html.escape(txt).split('\n'):
        l = line
        l = re.sub(r'^(■ .*)$', r'<b class=a>\1</b>', l)
        l = re.sub(r'(● (Running|运行中))', r'<span class=g>\1</span>', l)
        l = re.sub(r'\[(In progress|进行中)\]', r'<span class=a>[\1]</span>', l)
        l = re.sub(r'\[(To verify|待验证)\]', r'<span class=g>[\1]</span>', l)
        l = re.sub(r'\[(Decision|待决策)\]', r'<span class=y>[\1]</span>', l)
        l = re.sub(r'\[(Blocked|阻塞)\]', r'<span class=r>[\1]</span>', l)
        l = re.sub(r'\[(To do|待开始)\]', r'<span class=m>[\1]</span>', l)
        out.append(l)
    return '\n'.join(out)
def term(lang, cls=''):
    return f'''<div class="term {cls}"><div class=bar><i></i><i></i><i></i><span>claude · /task-dash report</span></div>
<pre class=body>{colorize(block(lang))}</pre>
<div class=sl><span class=g>●</span> {html.escape(status(lang))}</div></div>'''

CMD = '/plugin install task --marketplace qiqll/claude-task'
FLOW_EN = [('Request','plain language'),('Ticket','ID · priority · acceptance'),('Worker','fresh context'),('Review gate','code + security'),('Dispatcher re-runs tests','not the worker\'s word'),('To verify','you confirm → archived')]
FLOW_ZH = [('口语需求','随时丢进来'),('规范工单','ID · 优先级 · 验收标准'),('后台 worker','全新上下文实施'),('审查门禁','代码 + 安全审查'),('调度员重跑测试','不信 worker 自述'),('待验证','你确认后归档')]
G_EN = [('Doesn\'t trust the worker','The dispatcher re-runs your tests itself.'),('Catches weakened tests','Deleted cases, new skips, fewer assertions.'),('Asks before risky changes','Schema, auth, billing, deletes, public APIs, deploy, deps.'),('Rolls back failures','Kept under refs/auto-failed/* for review.'),('Never on main, never pushes','Stops on STOP file, budgets, or no progress.')]
G_ZH = [('不信 worker 自述','调度员亲自重跑测试才算完成'),('防止测试被改弱','删用例、加 skip、断言变少都会被发现'),('高风险先问你','schema、认证、计费、删数据、对外 API、部署、依赖'),('失败自动回滚','保留 refs/auto-failed/* 供复盘'),('不碰 main，从不 push','STOP 文件 / 预算 / 连续无进展都会停机')]
def flow(items): return '<ol class=flow>' + ''.join(f'<li><b>{html.escape(a)}</b><span>{html.escape(b)}</span></li>' for a,b in items) + '</ol>'
def rails(items): return '<ul class=rails>' + ''.join(f'<li><i>✓</i><div><b>{html.escape(a)}</b><span>{html.escape(b)}</span></div></li>' for a,b in items) + '</ul>'
foot = '<div class=foot><span>claude-task</span><span>qiqll.github.io/claude-task</span></div>'
demo_en = '<div class=tag>Real plugin output · demo task pool</div>'
demo_zh = '<div class=tag>插件真实输出 · 演示用任务池</div>'

cards = f'''
<section id="xhs-1-cover" class="card xhs"><div class=k>Claude Code 插件 · 开源</div>
<h1>让 Claude Code<br>自己<em>加班</em></h1><p class=sub>需求一股脑丢进任务池就去睡觉<br>后台 agent 逐个交付，测试由调度员亲自重跑</p>
{term('zh_CN.UTF-8','mini')}{foot}</section>

<section id="xhs-2-panel" class="card xhs"><div class=k>进度一目了然</div><h2>正在做什么、做完什么<br>还有什么<em>等你拍板</em></h2>
{term('zh_CN.UTF-8')}{demo_zh}{foot}</section>

<section id="xhs-3-flow" class="card xhs"><div class=k>按工程标准交付</div><h2>每个需求都是一张<em>工单</em></h2>
{flow(FLOW_ZH)}<p class=note>想到就丢：在会话里插话，或在任意终端 <code>qtask "描述"</code>，正在做的任务不受打扰。</p>{foot}</section>

<section id="xhs-4-guardrails" class="card xhs"><div class=k>为什么敢放手</div><h2>五道<em>护栏</em></h2>{rails(G_ZH)}{foot}</section>

<section id="xhs-5-install" class="card xhs"><div class=k>三十秒装好</div><h2>在 Claude Code 里输入</h2>
<div class=cmd>› {CMD}</div>
<ol class=steps><li>新开会话，<code>/task:init</code> 建任务池</li><li><code>/task:add 给订单加 CSV 导出</code></li><li>切到新分支并提交任务池</li><li><code>/task:loop</code>，去忙别的</li></ol>
<p class=note>MIT 开源 · github.com/qiqll/claude-task</p>{foot}</section>

<section id="x-1-hero" class="card x"><div class=split><div><div class=k>Claude Code plugin · open source</div>
<h1>Turn Claude Code from an assistant into a <em>delivery team</em></h1><p class=sub>Dump requests into a backlog and walk away. Each task goes to a fresh worker; the dispatcher re-runs your tests before calling it done.</p>
<div class=cmd sm>› {CMD}</div></div>{term('en_US.UTF-8','mini')}</div>{foot}</section>

<section id="x-2-panel" class="card x"><div class=k>Everything visible at a glance</div><h2>What's running, what's done, what's <em>waiting on you</em></h2>
{term('en_US.UTF-8','wide')}{demo_en}{foot}</section>

<section id="x-3-flow" class="card x"><div class=k>How it works</div><h2>Every request becomes a <em>ticket</em></h2>{flow(FLOW_EN)}
<p class=note>Add tasks any time — in the chat, or <code>qtask "…"</code> from any terminal. The running task is never interrupted.</p>{foot}</section>

<section id="x-4-guardrails" class="card x"><div class=k>Why you can walk away</div><h2>Five <em>guardrails</em></h2>{rails(G_EN)}{foot}</section>

<section id="x-zh-1-hero" class="card x"><div class=split><div><div class=k>Claude Code 插件 · 开源</div>
<h1>让 Claude Code<br>自己<em>加班</em></h1><p class=sub>需求一股脑丢进任务池就去睡觉。后台 agent 逐个交付，测试由调度员亲自重跑才算完成。</p>
<div class=cmd sm>› {CMD}</div></div>{term('zh_CN.UTF-8','mini')}</div>{foot}</section>

<section id="x-zh-2-panel" class="card x"><div class=k>进度一目了然</div><h2>正在做什么、做完什么、还有什么<em>等你拍板</em></h2>
{term('zh_CN.UTF-8','wide')}{demo_zh}{foot}</section>

<section id="x-zh-3-flow" class="card x"><div class=k>按工程标准交付</div><h2>每个需求都是一张<em>工单</em></h2>{flow(FLOW_ZH)}
<p class=note>随时加需求：在会话里说，或在任意终端 <code>qtask "…"</code>。正在做的任务不会被打断。</p>{foot}</section>

<section id="x-zh-4-guardrails" class="card x"><div class=k>为什么敢放手</div><h2>五道<em>护栏</em></h2>{rails(G_ZH)}{foot}</section>
'''
css = '''
:root{--bg:#12110f;--surface:#1f1d1a;--border:#34302b;--text:#f2efe9;--muted:#b3ada3;--accent:#f0955f;--term:#0d0c0b;
--mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;--sans:-apple-system,"PingFang SC","Hiragino Sans GB",system-ui,sans-serif}
*{box-sizing:border-box}body{margin:0;background:#000;font-family:var(--sans);color:var(--text)}
.card{position:relative;background:radial-gradient(1200px 600px at 85% -10%,rgba(240,149,95,.16),transparent 60%),var(--bg);overflow:hidden;margin:0 0 40px;display:flex;flex-direction:column}
.card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:10px;background:var(--accent)}
.xhs{width:1080px;height:1440px;padding:96px 80px 80px}.x{width:1600px;height:900px;padding:70px 90px 60px}
.k{font-family:var(--mono);color:var(--accent);font-size:28px;letter-spacing:.02em;margin-bottom:22px}.x .k{font-size:24px}
h1{font-size:104px;line-height:1.12;margin:0 0 30px;letter-spacing:-.02em}.x h1{font-size:64px}
h2{font-size:68px;line-height:1.2;margin:0 0 44px;letter-spacing:-.01em}.x h2{font-size:52px;margin-bottom:34px}
em{font-style:normal;color:var(--accent)}.sub{font-size:36px;line-height:1.6;color:var(--muted);margin:0 0 48px}.x .sub{font-size:26px;margin-bottom:34px}
code{font-family:var(--mono);background:rgba(240,149,95,.14);padding:.08em .35em;border-radius:8px;font-size:.92em}
.term{background:var(--term);border:1px solid var(--border);border-radius:18px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.5)}
.bar{display:flex;gap:10px;align-items:center;padding:16px 20px;border-bottom:1px solid #221f1c;color:#7d776e;font:20px var(--mono)}
.bar i{width:14px;height:14px;border-radius:50%;background:#3a3631}.bar span{margin-left:10px}
.body{margin:0;padding:22px 26px;font:22px/1.5 var(--mono);color:#e6e1d8;white-space:pre;overflow:hidden}
.sl{border-top:1px solid #221f1c;padding:14px 26px;font:20px var(--mono);color:#cfc9bf;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:#151311}
.mini .body{font-size:19px;max-height:520px;white-space:pre-wrap}.xhs .mini .body{max-height:560px}
.x .term.mini{flex:0 0 640px}.x .mini .body{font-size:15px;max-height:520px}.x .mini .sl{font-size:15px}
.wide .body{white-space:pre-wrap;font-size:17px;line-height:1.42;max-height:560px;columns:2;column-gap:40px}.wide .sl{font-size:17px}
.xhs .term:not(.mini) .body{font-size:17.5px;line-height:1.45;white-space:pre-wrap}.xhs .term:not(.mini) .sl{font-size:17px}
.a{color:var(--accent)}.g{color:#8fd19e}.y{color:#e8c66a}.r{color:#ef7f7f}.m{color:#8d877e}
.tag{margin-top:18px;font:20px var(--mono);color:#7d776e}
.split{display:flex;gap:60px;align-items:center;flex:1}
.cmd{font:30px var(--mono);background:var(--term);border:1px solid var(--border);border-left:4px solid var(--accent);border-radius:14px;padding:26px 30px;margin:0 0 44px;color:var(--text);word-break:break-all}
.x .cmd{font-size:19px;padding:18px 22px;margin:0;white-space:nowrap;word-break:normal}
.flow{list-style:none;margin:0;padding:0;display:grid;gap:16px;counter-reset:s}.x .flow{grid-template-columns:repeat(3,1fr);gap:20px}
.flow li{counter-increment:s;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:20px 30px 20px 96px;position:relative}
.flow li::before{content:counter(s);position:absolute;left:28px;top:50%;transform:translateY(-50%);width:46px;height:46px;border-radius:50%;background:rgba(240,149,95,.16);color:var(--accent);font:700 24px/46px var(--mono);text-align:center}
.flow li:nth-child(5){border-color:var(--accent)}
.flow b{display:block;font-size:34px;margin-bottom:4px}.flow span{color:var(--muted);font-size:25px}
.x .flow b{font-size:28px}.x .flow span{font-size:20px}.x .flow li{padding:24px 24px 24px 86px}
.rails{list-style:none;margin:0;padding:0;display:grid;gap:22px}.x .rails{grid-template-columns:1fr 1fr;gap:18px 28px}
.rails li{display:flex;gap:24px;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:28px 32px}
.rails i{font-style:normal;color:var(--accent);font-size:38px;line-height:1}.rails b{display:block;font-size:38px;margin-bottom:8px}.rails span{color:var(--muted);font-size:27px;line-height:1.45}
.x .rails b{font-size:28px}.x .rails span{font-size:20px}.x .rails li{padding:22px 26px}.x .rails i{font-size:28px}
.steps{margin:0 0 30px;padding-left:46px;font-size:36px;line-height:2}.note{color:var(--muted);font-size:28px;line-height:1.6;margin:30px 0 0}.x .note{font-size:22px}
.foot{margin-top:auto;padding-top:30px;display:flex;justify-content:space-between;font:24px var(--mono);color:#7d776e}.x .foot{font-size:20px}
'''
open(root + '/docs/promo/assets-src/cards.html','w').write(f'<!doctype html><meta charset=utf-8><title>claude-task promo cards</title><!-- Generated from report.txt (real /task-dash report output on a demo pool). Screenshot each <section> by id. --><style>{css}</style>{cards}')
