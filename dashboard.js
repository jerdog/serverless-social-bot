// Serves the feedback dashboard: a self-contained HTML page (no external assets)
// that lists the bot's generated posts and replies and lets you upvote/downvote
// each one. Votes are persisted via /api/vote and can be used to tune the model.

export function renderDashboard() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bot Feedback Dashboard</title>
<style>
  :root {
    --bg: #f6f7f9; --card: #ffffff; --text: #1a1d21; --muted: #6b7280;
    --border: #e3e6ea; --up: #16a34a; --down: #dc2626; --accent: #2563eb;
    --badge: #eef2f7;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f1216; --card: #171b21; --text: #e7eaee; --muted: #9aa4b2;
      --border: #262c34; --up: #22c55e; --down: #ef4444; --accent: #60a5fa;
      --badge: #222831;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  header {
    padding: 20px 16px; border-bottom: 1px solid var(--border);
    background: var(--card); position: sticky; top: 0; z-index: 2;
  }
  .wrap { max-width: 820px; margin: 0 auto; }
  h1 { margin: 0 0 4px; font-size: 20px; }
  .sub { color: var(--muted); font-size: 13px; }
  .stats { display: flex; gap: 16px; margin-top: 12px; flex-wrap: wrap; font-size: 13px; }
  .stats b { font-size: 16px; }
  .filters { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
  .filters button {
    border: 1px solid var(--border); background: var(--card); color: var(--text);
    padding: 6px 12px; border-radius: 999px; cursor: pointer; font-size: 13px;
  }
  .filters button.active { background: var(--accent); border-color: var(--accent); color: #fff; }
  .models { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; align-items: center; }
  .models-label { color: var(--muted); font-size: 12px; }
  .model-chip {
    border: 1px solid var(--border); background: var(--card); color: var(--text);
    padding: 5px 10px; border-radius: 8px; cursor: pointer; font-size: 12px;
    display: flex; gap: 8px; align-items: center;
  }
  .model-chip.active { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  .model-chip .name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .model-chip .up { color: var(--up); }
  .model-chip .down { color: var(--down); }
  .model-chip .net { color: var(--muted); }
  main { max-width: 820px; margin: 0 auto; padding: 16px; }
  .card {
    background: var(--card); border: 1px solid var(--border); border-radius: 12px;
    padding: 14px 16px; margin-bottom: 12px; display: flex; gap: 14px; align-items: flex-start;
  }
  .card.up { border-left: 3px solid var(--up); }
  .card.down { border-left: 3px solid var(--down); }
  .votes { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .votes button {
    border: 1px solid var(--border); background: transparent; color: var(--muted);
    width: 40px; height: 34px; border-radius: 8px; cursor: pointer; font-size: 16px; line-height: 1;
  }
  .votes button.up.active { background: var(--up); border-color: var(--up); color: #fff; }
  .votes button.down.active { background: var(--down); border-color: var(--down); color: #fff; }
  .body { flex: 1; min-width: 0; }
  .content { white-space: pre-wrap; word-wrap: break-word; }
  .context {
    margin-top: 8px; padding: 8px 10px; border-left: 2px solid var(--border);
    color: var(--muted); font-size: 13px; white-space: pre-wrap; word-wrap: break-word;
  }
  .meta { margin-top: 8px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .badge {
    background: var(--badge); color: var(--muted); border-radius: 6px;
    padding: 2px 8px; font-size: 12px; text-transform: capitalize;
  }
  .badge.model { text-transform: none; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
  .time { color: var(--muted); font-size: 12px; }
  .empty, .error { text-align: center; color: var(--muted); padding: 48px 16px; }
  .error { color: var(--down); }
  .actions { display: flex; gap: 8px; margin-top: 12px; }
  .actions button {
    border: 1px solid var(--border); background: var(--card); color: var(--text);
    padding: 6px 12px; border-radius: 8px; cursor: pointer; font-size: 13px;
  }
  .actions button.danger { color: var(--down); border-color: var(--down); }
  .title-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
</style>
</head>
<body>
<header>
  <div class="wrap">
    <div class="title-row">
      <h1>Bot Feedback Dashboard</h1>
      <div class="actions">
        <button id="refresh">↻ Refresh</button>
        <button id="clear" class="danger">Clear all</button>
      </div>
    </div>
    <div class="sub">Upvote or downvote generated posts and replies to build a labeled dataset for tuning.</div>
    <div class="stats" id="stats"></div>
    <div class="filters" id="filters">
      <button data-filter="all" class="active">All</button>
      <button data-filter="post">Posts</button>
      <button data-filter="reply">Replies</button>
      <button data-filter="unrated">Unrated</button>
    </div>
    <div class="models" id="models"></div>
  </div>
</header>
<main id="list"><div class="empty">Loading…</div></main>
<script>
(function () {
  var items = [];
  var filter = 'all';
  var modelFilter = null;
  var listEl = document.getElementById('list');
  var statsEl = document.getElementById('stats');
  var modelsEl = document.getElementById('models');

  function fmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString();
  }

  function matches(item) {
    if (modelFilter !== null && (item.model || 'unknown') !== modelFilter) return false;
    if (filter === 'all') return true;
    if (filter === 'unrated') return item.vote === 0;
    return item.type === filter;
  }

  function modelChip(value, label, stats) {
    var chip = document.createElement('button');
    chip.className = 'model-chip' + (modelFilter === value ? ' active' : '');
    var name = document.createElement('span');
    name.className = 'name';
    name.textContent = label;
    chip.appendChild(name);
    if (stats) {
      var up = document.createElement('span');
      up.className = 'up';
      up.textContent = '▲' + stats.up;
      var down = document.createElement('span');
      down.className = 'down';
      down.textContent = '▼' + stats.down;
      var net = stats.up - stats.down;
      var netEl = document.createElement('span');
      netEl.className = 'net';
      netEl.textContent = '(' + (net >= 0 ? '+' : '') + net + ')';
      chip.appendChild(up);
      chip.appendChild(down);
      chip.appendChild(netEl);
    }
    chip.onclick = function () {
      modelFilter = (modelFilter === value) ? null : value;
      render();
    };
    return chip;
  }

  function renderModels() {
    // Group votes by the model that produced each item — an at-a-glance A/B view.
    var groups = {};
    items.forEach(function (i) {
      var m = i.model || 'unknown';
      if (!groups[m]) groups[m] = { up: 0, down: 0, total: 0 };
      groups[m].total++;
      if (i.vote === 1) groups[m].up++;
      else if (i.vote === -1) groups[m].down++;
    });

    var models = Object.keys(groups).sort();
    modelsEl.textContent = '';
    // Only worth showing once there is more than one model to compare.
    if (models.length <= 1) {
      modelsEl.style.display = 'none';
      return;
    }
    modelsEl.style.display = 'flex';

    var label = document.createElement('span');
    label.className = 'models-label';
    label.textContent = 'By model:';
    modelsEl.appendChild(label);
    modelsEl.appendChild(modelChip(null, 'all models', null));
    models.forEach(function (m) {
      modelsEl.appendChild(modelChip(m, m, groups[m]));
    });
  }

  function renderStats() {
    var up = 0, down = 0, unrated = 0;
    items.forEach(function (i) {
      if (i.vote === 1) up++; else if (i.vote === -1) down++; else unrated++;
    });
    statsEl.textContent = '';
    [['Total', items.length], ['Upvoted', up], ['Downvoted', down], ['Unrated', unrated]]
      .forEach(function (pair) {
        var span = document.createElement('span');
        var b = document.createElement('b');
        b.textContent = pair[1];
        span.appendChild(b);
        span.appendChild(document.createTextNode(' ' + pair[0]));
        statsEl.appendChild(span);
      });
  }

  function voteButton(item, value, label) {
    var btn = document.createElement('button');
    btn.className = (value === 1 ? 'up' : 'down') + (item.vote === value ? ' active' : '');
    btn.textContent = label;
    btn.title = value === 1 ? 'Upvote' : 'Downvote';
    btn.onclick = function () {
      // Toggle off if the same vote is clicked again.
      var next = item.vote === value ? 0 : value;
      castVote(item, next);
    };
    return btn;
  }

  function renderCard(item) {
    var card = document.createElement('div');
    card.className = 'card' + (item.vote === 1 ? ' up' : item.vote === -1 ? ' down' : '');

    var votes = document.createElement('div');
    votes.className = 'votes';
    votes.appendChild(voteButton(item, 1, '▲'));
    votes.appendChild(voteButton(item, -1, '▼'));
    card.appendChild(votes);

    var body = document.createElement('div');
    body.className = 'body';

    var content = document.createElement('div');
    content.className = 'content';
    content.textContent = item.content || '';
    body.appendChild(content);

    if (item.context) {
      var ctx = document.createElement('div');
      ctx.className = 'context';
      ctx.textContent = 'In reply to: ' + item.context;
      body.appendChild(ctx);
    }

    var meta = document.createElement('div');
    meta.className = 'meta';
    // Back-compat: older records used a singular platform field.
    var platforms = item.platforms || (item.platform ? [item.platform] : []);
    [item.type].concat(platforms).forEach(function (t) {
      if (!t) return;
      var badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = t;
      meta.appendChild(badge);
    });
    if (item.model) {
      var modelBadge = document.createElement('span');
      modelBadge.className = 'badge model';
      modelBadge.textContent = item.model;
      meta.appendChild(modelBadge);
    }
    var time = document.createElement('span');
    time.className = 'time';
    time.textContent = fmtTime(item.createdAt);
    meta.appendChild(time);
    body.appendChild(meta);

    card.appendChild(body);
    return card;
  }

  function render() {
    renderStats();
    renderModels();
    var visible = items.filter(matches);
    listEl.textContent = '';
    if (!visible.length) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = items.length ? 'Nothing matches this filter.' : 'No generated content yet. Run the bot to populate this list.';
      listEl.appendChild(empty);
      return;
    }
    visible.forEach(function (item) { listEl.appendChild(renderCard(item)); });
  }

  function castVote(item, value) {
    var prev = item.vote;
    item.vote = value;           // optimistic
    render();
    var platform = (item.platforms && item.platforms[0]) || item.platform || '';
    fetch('/api/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: item.type, platform: platform, id: item.id, vote: value })
    }).then(function (res) {
      if (!res.ok) throw new Error('vote failed');
    }).catch(function () {
      item.vote = prev;          // revert on failure
      render();
    });
  }

  function load() {
    listEl.textContent = '';
    var loading = document.createElement('div');
    loading.className = 'empty';
    loading.textContent = 'Loading…';
    listEl.appendChild(loading);
    fetch('/api/feedback').then(function (res) {
      if (!res.ok) throw new Error('load failed');
      return res.json();
    }).then(function (data) {
      items = Array.isArray(data.items) ? data.items : [];
      render();
    }).catch(function () {
      listEl.textContent = '';
      var err = document.createElement('div');
      err.className = 'error';
      err.textContent = 'Failed to load feedback data.';
      listEl.appendChild(err);
    });
  }

  document.getElementById('filters').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    filter = b.getAttribute('data-filter');
    Array.prototype.forEach.call(this.children, function (c) { c.classList.remove('active'); });
    b.classList.add('active');
    render();
  });

  document.getElementById('refresh').onclick = load;

  document.getElementById('clear').onclick = function () {
    if (!window.confirm('Delete ALL feedback records? This cannot be undone.')) return;
    fetch('/api/feedback/clear', { method: 'POST' })
      .then(function (res) { if (!res.ok) throw new Error('clear failed'); return res.json(); })
      .then(function () { modelFilter = null; load(); })
      .catch(function () { window.alert('Failed to clear feedback.'); });
  };

  load();
})();
</script>
</body>
</html>`;
}
