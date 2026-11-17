"""Illustration of the docked /task-dash pane, drawn after its real layout on the demo task pool.

python3 pane.py <repo root>  ->  docs/promo/assets-src/pane.html; screenshot each <section> by id.
"""
import html, sys

root = sys.argv[1]
e = html.escape

T = {
    'en': dict(
        title='Task Pipeline', state='Running', refresh='Refresh', path='~/code/my-app',
        session='delivered 2/10 · running 1h 59m/8h',
        current='Current task', cur_id='T-071', cur_title='Add CSV export to orders',
        cur_meta='phase running · worker-T-071 · running 24m · base 9f3c2a1b',
        stats=[('Done', '25%', 'g'), ('Delivered', '38%', 'a'), ('First pass', '100%', 'g'), ('7d delivered', '2', 'g'),
               ('Median cycle', '38m', ''), ('WIP', '1', 'g'), ('To verify', '1', 'y'), ('Archived', '2', '')],
        tasks='Tasks', chips=[('Active', 4, True), ('To do', 2, False), ('To verify', 1, False), ('Decision', 1, False), ('Blocked', 1, False), ('All', 6, False)],
        rows=[('P1', 'T-071', 'Add CSV export to orders', 'In progress', 'a', True),
              ('P1', 'T-070', 'Migrate sessions table', 'Decision', 'y', False),
              ('P2', 'T-066', 'Upgrade payment SDK', 'Blocked', 'r', False),
              ('P1', 'T-069', 'Paginate audit log', 'To verify', 'y', False)],
        detail=['orders · depends on T-064', 'Acceptance: GET /orders/export returns CSV; pytest tests/test_export.py passes'],
        decisions='Decisions', dec_extra='1 · answer in chat, e.g. "T-0NN pick A"',
        dec=('T-070', 'Keep old sessions during migration?', 'A. Dual-write for a week (rec.); B. Hard cutover'),
        blockers='Human blockers', blk=('H-003', 'Need sandbox API key from finance', 'T-066'),
        agents='Agents', agents_extra='1 running',
        agent_rows=[(True, 'T-071 · Add CSV export to orders', 'general-purpose · running 24m'),
                    (False, 'T-069 · Paginate audit log', 'general-purpose · finished 38m')],
        log='Recent log', log_extra='8',
        log_rows=[('11-15 01:45', 'T-071', 'DISPATCH nonce=a4'), ('11-15 01:44', 'T-070', 'NEEDS_DECISION schema change, two options'),
                  ('11-15 01:32', 'T-070', 'DISPATCH nonce=a3'), ('11-15 01:31', 'T-069', 'DONE commits 2 · ~38m · audit log pagination'),
                  ('11-15 00:53', 'T-069', 'DISPATCH nonce=a2'), ('11-15 00:10', 'START', 'max=10 hours=8')],
        footer='Read-only · refreshes every 5s · from .claude/backlog.md and .claude/auto/',
        status='Task Pipeline ● Running · T-071 Add CSV export to orders · 24m · To verify 1 · Decision 1 · Blocked 1 · /task-dash',
        chat=[('you', '/task:loop'),
              ('ai', 'Loop started: max 10 tasks, 8h. Dispatching T-065 to a fresh worker.'),
              ('ai', 'T-069 delivered: tests re-run by me, 214 passed. → To verify.'),
              ('ai', 'T-070 touches the schema and has two options; parked in Decisions, moving on.'),
              ('you', 'add a task: login page flickers on Safari'),
              ('ai', 'Added T-072 (P2). Current task T-071 keeps running.')],
        prompt='T-070 pick A',
        tag='Illustration · demo task pool · layout of the real docked pane',
    ),
    'zh': dict(
        title='任务流水线', state='运行中', refresh='刷新', path='~/code/my-app',
        session='已交付 2/10 · 已运行 1h 59m/8h',
        current='当前任务', cur_id='T-071', cur_title='订单列表加 CSV 导出',
        cur_meta='阶段 running · worker-T-071 · 已运行 24m · 基线 9f3c2a1b',
        stats=[('完成率', '25%', 'g'), ('交付率', '38%', 'a'), ('一次通过', '100%', 'g'), ('7日交付', '2', 'g'),
               ('中位周期', '38m', ''), ('WIP', '1', 'g'), ('待验证', '1', 'y'), ('已归档', '2', '')],
        tasks='任务', chips=[('活跃', 4, True), ('待开始', 2, False), ('待验证', 1, False), ('待决策', 1, False), ('阻塞', 1, False), ('全部', 6, False)],
        rows=[('P1', 'T-071', '订单列表加 CSV 导出', '进行中', 'a', True),
              ('P1', 'T-070', '会话表迁移', '待决策', 'y', False),
              ('P2', 'T-066', '升级支付 SDK', '阻塞', 'r', False),
              ('P1', 'T-069', '审计日志分页', '待验证', 'y', False)],
        detail=['orders · 依赖 T-064', '验收：GET /orders/export 返回 CSV；pytest tests/test_export.py 通过'],
        decisions='待决策', dec_extra='1 条 · 在会话里说「T-0NN 选 A」答复',
        dec=('T-070', '迁移期间保留旧会话吗？', 'A. 双写一周（推荐）；B. 直接切换'),
        blockers='人工阻塞', blk=('H-003', '需要财务提供沙箱 API key', 'T-066'),
        agents='Agent', agents_extra='1 运行中',
        agent_rows=[(True, 'T-071 · 订单列表加 CSV 导出', 'general-purpose · 运行中 24m'),
                    (False, 'T-069 · 审计日志分页', 'general-purpose · 已结束 38m')],
        log='最近流水', log_extra='8 条',
        log_rows=[('11-15 01:45', 'T-071', 'DISPATCH nonce=a4'), ('11-15 01:44', 'T-070', 'NEEDS_DECISION 涉及 schema，两种做法'),
                  ('11-15 01:32', 'T-070', 'DISPATCH nonce=a3'), ('11-15 01:31', 'T-069', 'DONE commits 2 · ~38m · 审计日志分页'),
                  ('11-15 00:53', 'T-069', 'DISPATCH nonce=a2'), ('11-15 00:10', 'START', 'max=10 hours=8')],
        footer='只读 · 每 5s 刷新 · 数据来自 .claude/backlog.md 与 .claude/auto/',
        status='任务流水线 ● 运行中 · T-071 订单列表加 CSV 导出 · 24m · 待验证 1 · 待决策 1 · 阻塞 1 · /task-dash',
        chat=[('you', '/task:loop'),
              ('ai', '循环已启动：最多 10 个任务、8 小时。T-065 已派给全新 worker。'),
              ('ai', 'T-069 交付：我亲自重跑测试，214 项通过 → 待验证。'),
              ('ai', 'T-070 涉及 schema、有两种做法，已挂入待决策，先做下一个。'),
              ('you', '加个任务：Safari 下登录页闪烁'),
              ('ai', '已录入 T-072（P2），当前任务 T-071 不受影响。')],
        prompt='T-070 选 A',
        tag='示意图 · 演示用任务池 · 按真实右侧面板的布局绘制',
    ),
}


def pane(t):
    stats = ''.join(f'<span class=stat><i>{e(k)}</i> <b class={c}>{e(v)}</b></span>' for k, v, c in t['stats'])
    chips = ''.join(f'<span class="chip{" on" if on else ""}">{e(k)} {n}</span>' for k, n, on in t['chips'])
    rows = ''
    for p, i, title, st, c, open_ in t['rows']:
        rows += (f'<div class="row{" cur" if open_ else ""}"><span class="pri {"y" if p == "P1" else "m"}">{p}</span>'
                 f'<span class=caret>{"▾" if open_ else "▸"}</span><span class=id>{i}</span>'
                 f'<span class=tt>{e(title)}</span><span class="pill {c}">{e(st)}</span></div>')
        if open_:
            rows += '<div class=detail>' + ''.join(f'<div>{e(d)}</div>' for d in t['detail']) + '</div>'
    agents = ''.join(f'<div class=agent><span class="{"g" if run else "m"}">{"●" if run else "○"}</span>'
                     f'<span class=tt>{e(lbl)}</span><span class=dim>{e(meta)}</span></div>' for run, lbl, meta in t['agent_rows'])
    logs = ''.join(f'<div class=log><span class=dim>{a}</span> <span class="{"g" if s == "START" else "a"}">{s}</span> <span class=tt>{e(d)}</span></div>'
                   for a, s, d in t['log_rows'])
    d = t['dec']; b = t['blk']
    return f'''<div class=pane>
<div class=head><div><b>{e(t["title"])}</b> <span class=dim>[my-app]</span> <span class=g>● {e(t["state"])}</span></div><span class=btn>⟳ {e(t["refresh"])}</span></div>
<div class="dim small">{e(t["path"])} · {e(t["session"])}</div>
<h4>{e(t["current"])}</h4>
<div class=curcard><div><b class=a>{t["cur_id"]}</b> <b>{e(t["cur_title"])}</b></div><div class="dim small">{e(t["cur_meta"])}</div></div>
<div class=stats>{stats}</div>
<h4>{e(t["tasks"])} <span class=dim>6</span></h4>
<div class=chips>{chips}</div>{rows}
<h4>{e(t["decisions"])} <span class=dim>{e(t["dec_extra"])}</span></h4>
<div class=dec><div><b class=y>{d[0]}</b> {e(d[1])}</div><div class=dim>{e(d[2])}</div></div>
<h4>{e(t["blockers"])}</h4>
<div class=blk><b class=r>{b[0]}</b> {e(b[1])} <span class=dim>→ {b[2]}</span></div>
<h4>{e(t["agents"])} <span class=dim>{e(t["agents_extra"])}</span></h4>{agents}
<h4>{e(t["log"])} <span class=dim>{e(t["log_extra"])}</span></h4>{logs}
<div class="foot dim">{e(t["footer"])}</div>
</div>'''


def chat(t):
    out = ''
    for who, msg in t['chat']:
        out += f'<div class="msg {who}"><span>{"›" if who == "you" else "⏺"}</span><p>{e(msg)}</p></div>'
    return out


def window(t, body):
    return f'<div class=win><div class=bar><i></i><i></i><i></i><span>claude — my-app</span></div>{body}</div>'


sections = ''
for lang, t in T.items():
    sections += f'<section id="dash-pane-{lang}" class="card tall">{window(t, pane(t))}<div class=tag>{e(t["tag"])}</div></section>\n'
    term = (f'<div class=split><div class=chat>{chat(t)}<div class=spacer></div>'
            f'<div class=prompt>› {e(t["prompt"])}<b class=cursor></b></div><div class=sl>{e(t["status"])}</div></div>{pane(t)}</div>')
    sections += f'<section id="dash-dock-{lang}" class="card wide">{window(t, term)}<div class=tag>{e(t["tag"])}</div></section>\n'

css = '''
:root{--bg:#12110f;--win:#1a1917;--pane:#161513;--line:#2e2a26;--text:#ece7df;--muted:#8f887e;--accent:#f0955f;
--mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,"PingFang SC",monospace}
*{box-sizing:border-box}body{margin:0;background:#000;color:var(--text);font-family:var(--mono)}
.card{background:radial-gradient(900px 500px at 85% -10%,rgba(240,149,95,.16),transparent 60%),var(--bg);padding:48px 52px 36px;margin:0 0 40px}
.tall{width:820px}.wide{width:1600px}
.win{background:var(--win);border:1px solid var(--line);border-radius:16px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.55)}
.bar{display:flex;gap:9px;align-items:center;padding:13px 18px;border-bottom:1px solid var(--line);color:#76706a;font-size:15px}
.bar i{width:12px;height:12px;border-radius:50%;background:#3a3633}.bar span{margin-left:10px}
.tag{margin-top:16px;color:#7d776e;font-size:15px}
.pane{background:var(--pane);padding:20px 24px 18px;font-size:16px;line-height:1.55}
.wide .pane{flex:0 0 620px;min-width:0;border-left:1px solid var(--line)}
.head{display:flex;justify-content:space-between;align-items:center}
.btn{border:1px solid var(--line);border-radius:8px;padding:2px 10px;color:var(--muted);font-size:14px}
h4{margin:18px 0 8px;padding-top:14px;border-top:1px solid var(--line);font-size:15px;color:var(--accent);letter-spacing:.02em}
.small{font-size:14px}.dim{color:var(--muted)}
.a{color:var(--accent)}.g{color:#8fd19e}.y{color:#e8c66a}.r{color:#ef7f7f}.m{color:#8d877e}
.curcard{border:1px solid rgba(240,149,95,.45);background:rgba(240,149,95,.07);border-radius:10px;padding:10px 14px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px}
.stat{background:#1d1b19;border:1px solid var(--line);border-radius:9px;padding:6px 10px;display:flex;flex-direction:column}
.stat i{font-style:normal;color:var(--muted);font-size:12.5px}.stat b{font-size:19px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.chip{border:1px solid var(--line);border-radius:999px;padding:1px 11px;font-size:13.5px;color:var(--muted)}
.chip.on{border-color:var(--accent);color:var(--accent);background:rgba(240,149,95,.12)}
.row{display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:7px}.row.cur{background:#211f1c}
.pri{font-size:14px;width:22px}.caret{color:var(--muted)}.id{color:var(--text)}
.tt{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pill{font-size:12.5px;border-radius:999px;padding:0 9px;border:1px solid currentColor;opacity:.95}
.detail{margin:2px 0 6px 64px;color:var(--muted);font-size:13.5px;line-height:1.5}
.dec div:last-child{padding-left:56px}
.agent,.log{display:flex;gap:8px;align-items:baseline}.agent .dim{font-size:13.5px}
.log{font-size:14px}.log .dim{flex:none}
.foot{margin-top:14px;font-size:12.5px}
.split{display:flex;width:100%}
.chat{flex:1;min-width:0;display:flex;flex-direction:column;padding:26px 30px 18px;font-size:17px;line-height:1.55}
.msg{display:flex;gap:12px;margin-bottom:16px}.msg p{margin:0}.msg span{flex:none;color:var(--muted)}
.msg.you p{color:#cfc9bf}.msg.ai span{color:var(--accent)}
.spacer{flex:1}
.prompt{border:1px solid var(--line);border-radius:10px;padding:12px 16px;color:var(--text)}
.cursor{display:inline-block;width:9px;height:19px;background:var(--accent);vertical-align:-3px;margin-left:3px}
.sl{margin-top:10px;font-size:14px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
'''
open(root + '/docs/promo/assets-src/pane.html', 'w').write(
    f'<!doctype html><meta charset=utf-8><title>task-dash pane</title><style>{css}</style>{sections}')
