// Small chart kit for the dashboard (Stats and Visits tabs): plain SVG, no library (the admin only runs its own scripts).
// Every chart: one series colour (--series-1, checked for contrast and colour-blindness), thin marks, recessive grid,
// a tooltip on hover / tap / keyboard focus, labels only on the extremes, a "Show as table" view underneath, and it redraws
// when its width changes (phone ↔ computer).
//
//   Charts.columns(el, { data: [{ label, title, value, rows }], format, name })   columns over time (months)
//   Charts.line(el, { data: [{ label, title, value, rows }], format, name })      a line with a light wash (days)
//   Charts.split(el, { parts: [{ name, value, color }], name })                    one whole split into parts
// `label` = short axis text, `title` = tooltip heading, `rows` = extra tooltip lines [[name, value]].

(() => {
	const NS = 'http://www.w3.org/2000/svg';
	const svg = (tag, attrs = {}) => {
		const node = document.createElementNS(NS, tag);
		for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
		return node;
	};
	const html = (tag, className, text) => {
		const node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined) node.textContent = text;
		return node;
	};

	/** Clean axis steps: 0 and 3–5 round numbers up to at least the maximum (whole numbers only for counts). */
	function ticks(max, whole) {
		if (max <= 0) return [0, 1];
		const rough = max / 4;
		const pow = 10 ** Math.floor(Math.log10(rough));
		let step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough && (!whole || Number.isInteger(s)));
		if (whole) step = Math.max(1, step ?? 1);
		const out = [];
		for (let v = 0; v < max + step * 0.999; v += step) out.push(Math.round(v * 1000) / 1000);
		return out;
	}
	const compact = (v) => (v >= 10000 ? `${Math.round(v / 1000)}k` : Number(v).toLocaleString('de-CH'));

	/** Frame shared by every chart: a box with the SVG, one tooltip and the table view; redraws on resize. */
	function frame(el, name, draw, table) {
		el.replaceChildren();
		el.classList.add('chart');
		const plot = html('div', 'chart-plot');
		const tip = html('div', 'chart-tip');
		tip.hidden = true;
		plot.append(tip);
		el.append(plot);
		if (table) {
			const details = html('details', 'chart-table');
			details.append(html('summary', '', 'Show as table'));
			const t = html('table');
			const head = html('tr');
			for (const h of table.head) head.append(html('th', '', h));
			t.append(head);
			for (const row of table.rows) {
				const tr = html('tr');
				for (const cell of row) tr.append(html('td', '', cell));
				t.append(tr);
			}
			details.append(t);
			el.append(details);
		}
		const showTip = (x, y, title, value, rows = []) => {
			tip.replaceChildren(html('strong', '', value), html('span', 'chart-tip-title', title), ...rows.map(([k, v]) => html('span', '', `${k}: ${v}`)));
			tip.hidden = false;
			const w = plot.clientWidth;
			const left = Math.min(Math.max(x - tip.offsetWidth / 2, 0), w - tip.offsetWidth);
			tip.style.left = `${left}px`;
			tip.style.top = `${Math.max(0, y - tip.offsetHeight - 10)}px`;
		};
		const hideTip = () => (tip.hidden = true);
		let width = 0;
		const render = () => {
			const w = Math.floor(plot.clientWidth);
			if (!w || w === width) return;
			width = w;
			plot.querySelector('svg')?.remove();
			const root = draw(w, { showTip, hideTip });
			root.setAttribute('role', 'img');
			root.setAttribute('aria-label', name);
			plot.prepend(root);
		};
		new ResizeObserver(render).observe(plot);
		render();
	}

	/** Y axis and gridlines; returns the scale. */
	function yAxis(root, { w, top, bottom, h, max, format, whole }) {
		const values = ticks(max, whole);
		const top1 = values[values.length - 1];
		const left = Math.max(...values.map((v) => (format ? format(v, true) : compact(v)).length)) * 7 + 10;
		const y = (v) => top + (h - top - bottom) * (1 - v / top1);
		for (const v of values) {
			root.append(svg('line', { class: 'chart-grid', x1: left, x2: w, y1: y(v), y2: y(v) }));
			const t = svg('text', { class: 'chart-axis', x: left - 8, y: y(v) + 4, 'text-anchor': 'end' });
			t.textContent = format ? format(v, true) : compact(v);
			root.append(t);
		}
		return { y, left };
	}

	/** X labels that never overlap: every k-th one, always the last. */
	function xLabels(root, data, xOf, baseline, plotWidth) {
		const longest = Math.max(...data.map((d) => d.label.length)) * 6.5 + 10;
		const every = Math.max(1, Math.ceil((longest * data.length) / plotWidth));
		data.forEach((d, i) => {
			if ((data.length - 1 - i) % every) return;
			const t = svg('text', { class: 'chart-axis', x: xOf(i), y: baseline + 18, 'text-anchor': 'middle' });
			t.textContent = d.label;
			root.append(t);
		});
	}

	function columns(el, { data, format = compact, name, whole = false, valueName = name }) {
		const table = { head: ['', valueName, ...(data[0]?.rows ?? []).map((r) => r[0])], rows: data.map((d) => [d.title, format(d.value), ...(d.rows ?? []).map((r) => r[1])]) };
		frame(
			el,
			name,
			(w, tip) => {
				const h = 220;
				const root = svg('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}` });
				const max = Math.max(...data.map((d) => d.value), 0);
				const { y, left } = yAxis(root, { w, top: 22, bottom: 26, h, max, format: (v) => compact(v), whole });
				const base = y(0);
				const band = (w - left) / data.length;
				const bar = Math.min(24, band * 0.62);
				const xOf = (i) => left + band * i + band / 2;
				const best = data.reduce((b, d, i) => (d.value > data[b].value ? i : b), 0);
				data.forEach((d, i) => {
					const x = xOf(i) - bar / 2;
					const top = y(d.value);
					const g = svg('g', { class: 'chart-col', tabindex: 0, 'aria-label': `${d.title}: ${format(d.value)}` });
					if (d.value > 0) {
						const r = Math.min(4, base - top, bar / 2);
						g.append(svg('path', { class: 'chart-mark', d: `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + bar - r}Q${x + bar},${top} ${x + bar},${top + r}V${base}Z` }));
					}
					// Labels only on the best and the latest column.
					if (d.value > 0 && (i === best || i === data.length - 1)) {
						// Kept inside the chart: near the right edge the label ends at the column instead of centring on it.
						const text = format(d.value);
						const nearEdge = xOf(i) + (text.length * 7) / 2 > w;
						const t = svg('text', { class: 'chart-value', x: nearEdge ? xOf(i) + bar / 2 : xOf(i), y: top - 6, 'text-anchor': nearEdge ? 'end' : 'middle' });
						t.textContent = text;
						g.append(t);
					}
					// The hit area is the whole band, not just the painted bar.
					g.append(svg('rect', { class: 'chart-hit', x: left + band * i, y: 0, width: band, height: base }));
					const show = () => tip.showTip(xOf(i), Math.min(top, base - 4), d.title, format(d.value), d.rows);
					g.addEventListener('pointerenter', show);
					g.addEventListener('focus', show);
					g.addEventListener('pointerleave', tip.hideTip);
					g.addEventListener('blur', tip.hideTip);
					root.append(g);
				});
				root.append(svg('line', { class: 'chart-base', x1: left, x2: w, y1: base, y2: base }));
				xLabels(root, data, xOf, base, w - left);
				return root;
			},
			table,
		);
	}

	function line(el, { data, format = compact, name, whole = false, valueName = name }) {
		const table = { head: ['', valueName, ...(data[0]?.rows ?? []).map((r) => r[0])], rows: [...data].reverse().map((d) => [d.title, format(d.value), ...(d.rows ?? []).map((r) => r[1])]) };
		frame(
			el,
			name,
			(w, tip) => {
				const h = 200;
				const root = svg('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}` });
				const max = Math.max(...data.map((d) => d.value), 0);
				const { y, left } = yAxis(root, { w: w - 8, top: 22, bottom: 26, h, max, whole });
				const base = y(0);
				const right = w - 12 - Math.max(String(format(data.at(-1)?.value ?? 0)).length * 7, 0);
				const xOf = (i) => (data.length < 2 ? left : left + ((right - left) * i) / (data.length - 1));
				const points = data.map((d, i) => `${xOf(i)},${y(d.value)}`);
				root.append(svg('path', { class: 'chart-wash', d: `M${xOf(0)},${base}L${points.join('L')}L${xOf(data.length - 1)},${base}Z` }));
				root.append(svg('path', { class: 'chart-line', d: `M${points.join('L')}` }));
				root.append(svg('line', { class: 'chart-base', x1: left, x2: w - 8, y1: base, y2: base }));
				// End dot and its value (the one direct label).
				const last = data.length - 1;
				if (last >= 0) {
					root.append(svg('circle', { class: 'chart-dot', cx: xOf(last), cy: y(data[last].value), r: 4 }));
					const t = svg('text', { class: 'chart-value', x: xOf(last) + 8, y: y(data[last].value) + 4 });
					t.textContent = format(data[last].value);
					root.append(t);
				}
				xLabels(root, data, xOf, base, right - left);
				// Crosshair: snaps to the nearest day; arrow keys move it.
				const cross = svg('line', { class: 'chart-cross', y1: 10, y2: base, visibility: 'hidden' });
				const dot = svg('circle', { class: 'chart-dot', r: 4, visibility: 'hidden' });
				root.append(cross, dot);
				const overlay = svg('rect', { class: 'chart-hit', x: left, y: 0, width: Math.max(1, w - left), height: base, tabindex: 0, 'aria-label': `${name}: use the arrow keys` });
				let at = last;
				const show = (i) => {
					at = Math.max(0, Math.min(last, i));
					const d = data[at];
					for (const [k, v] of [['x1', xOf(at)], ['x2', xOf(at)]]) cross.setAttribute(k, v);
					dot.setAttribute('cx', xOf(at));
					dot.setAttribute('cy', y(d.value));
					cross.setAttribute('visibility', 'visible');
					dot.setAttribute('visibility', 'visible');
					tip.showTip(xOf(at), y(d.value), d.title, format(d.value), d.rows);
				};
				const hide = () => {
					cross.setAttribute('visibility', 'hidden');
					dot.setAttribute('visibility', 'hidden');
					tip.hideTip();
				};
				overlay.addEventListener('pointermove', (e) => {
					const box = root.getBoundingClientRect();
					const x = e.clientX - box.left;
					show(Math.round(((x - left) / Math.max(1, right - left)) * last));
				});
				overlay.addEventListener('pointerleave', hide);
				overlay.addEventListener('focus', () => show(at));
				overlay.addEventListener('blur', hide);
				overlay.addEventListener('keydown', (e) => {
					if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
						e.preventDefault();
						show(at + (e.key === 'ArrowRight' ? 1 : -1));
					}
				});
				root.append(overlay);
				return root;
			},
			table,
		);
	}

	/** One whole split into parts (a tall bar, 28 px): share printed inside where it fits, names in the legend below. */
	function split(el, { parts, name }) {
		const total = parts.reduce((t, p) => t + p.value, 0);
		el.replaceChildren();
		el.classList.add('chart');
		const bar = html('div', 'chart-split');
		bar.setAttribute('role', 'img');
		bar.setAttribute('aria-label', `${name}: ${parts.map((p) => `${p.name} ${p.value}`).join(', ')}`);
		const legend = html('ul', 'chart-legend');
		for (const p of parts) {
			const item = html('li');
			const key = html('span', 'chart-key');
			key.style.background = p.color;
			item.append(key, `${p.name} ${p.value.toLocaleString('de-CH')}`);
			legend.append(item);
			if (!p.value) continue;
			const share = Math.round((p.value / total) * 100);
			const block = html('span', 'chart-part');
			block.style.flexGrow = String(p.value);
			block.style.background = p.color;
			block.style.color = p.ink ?? '#fff';
			block.title = `${p.name}: ${p.value} (${share} %)`;
			const label = html('span', '', `${share} %`);
			block.append(label);
			bar.append(block);
			// No label in a block too narrow for it (the legend and the title still give the number).
			requestAnimationFrame(() => {
				if (label.offsetWidth + 12 > block.clientWidth) label.hidden = true;
			});
		}
		if (!total) bar.append(html('span', 'chart-empty', 'Nothing yet.'));
		el.append(bar, legend);
	}

	window.Charts = { columns, line, split };
})();
