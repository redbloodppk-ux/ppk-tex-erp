/* ============================================================
   PPK TEX ERP — Shared shell
   Injects sidebar + topbar into every module page.
   - Sidebar auto-collapses to 76 px when cursor leaves,
     expands to 260 px on hover.
   - Active item highlighted from <aside data-active="..."> attr.
   - Topbar search, notifications, user pill — same on every page.
   - Edge auto-scroll: cursor near top/bottom auto-scrolls page.
   ============================================================ */

(function () {
  'use strict';

  // Resolve relative path to root from current page depth.
  function rootPath() {
    const path = window.location.pathname;
    const idx = path.indexOf('/ppk_tex_erp/');
    if (idx === -1) return '../';
    const after = path.slice(idx + '/ppk_tex_erp/'.length);
    const slashes = (after.match(/\//g) || []).length;
    return slashes > 0 ? '../'.repeat(slashes) : './';
  }

  const ROOT = rootPath();

  // Sidebar nav items — single source of truth
  const NAV = [
    { id: 'dashboard', icon: '\u229E', label: 'Dashboard',          href: '02_dashboard/index.html' },
    { section: 'Transactions' },
    { id: 'sales',     icon: '\u21C5', label: 'Sales Orders',       href: '04_sales_orders/index.html', badge: '7' },
    { id: 'production',icon: '\u25A4', label: 'Production',         href: '05_production/index.html' },
    { id: 'outsourced',icon: '\u21C9', label: 'Outsourced Weaving', href: '06_outsourced/index.html' },
    { id: 'jobwork',   icon: '\u21C7', label: 'Job-work Received',  href: '07_jobwork/index.html' },
    { id: 'resale',    icon: '\u21BB', label: 'Fabric Resale',      href: '08_resale/index.html' },
    { section: 'Inventory' },
    { id: 'yarn-inv',  icon: '\u25A6', label: 'Yarn Inventory',     href: '09_yarn_inventory/index.html' },
    { id: 'yarn-buy',  icon: '\u2295', label: 'Yarn Purchase',      href: '10_yarn_purchase/index.html' },
    { id: 'bobbin',    icon: '\u25C9', label: 'Bobbin Stock',       href: '11_bobbin/index.html' },
    { section: 'Tools' },
    { id: 'costing',   icon: '\u20B9', label: 'Fabric Costing',     href: '12_fabric_costing/index.html' },
    { id: 'attendance',icon: '\u23F1', label: 'Attendance',         href: '13_attendance/index.html' },
    { id: 'reports',   icon: '\u229F', label: 'Reports',            href: '14_reports/index.html' },
    { section: 'Masters' },
    { id: 'mill',      icon: '\u2302', label: 'Mill Master',        href: '03_mill_master/index.html' },
    { id: 'customer',  icon: '\u263A', label: 'Customer Master',    href: '15_customer_master/index.html' },
    { id: 'fabric',    icon: '\u22A0', label: 'Fabric Master',      href: '16_fabric_master/index.html' },
    { id: 'count',     icon: '\u2116', label: 'Count Master',       href: '17_count_master/index.html' },
    { section: 'System' },
    { id: 'settings',  icon: '\u2699', label: 'Settings',           href: '18_settings/index.html' }
  ];

  function buildSidebar(activeId) {
    const aside = document.createElement('aside');
    aside.className = 'app-sidebar';

    const brand = ''
      + '<div class="app-sidebar-brand">'
      + '  <img class="app-sidebar-brand-logo" src="' + ROOT + 'assets/logo-mark.svg" alt="PPK TEX">'
      + '  <div class="app-sidebar-brand-text">'
      + '    PPK <span style="color: var(--gold-400);">TEX</span>'
      + '    <small>ERP \u00B7 v3.0</small>'
      + '  </div>'
      + '</div>';

    let body = '';
    for (const item of NAV) {
      if (item.section) {
        body += '<div class="app-sidebar-section">' + item.section + '</div>';
        continue;
      }
      const isActive = item.id === activeId ? ' active' : '';
      const badge = item.badge
        ? '<span class="app-sidebar-link-badge">' + item.badge + '</span>'
        : '';
      body += ''
        + '<a class="app-sidebar-link' + isActive + '"'
        + '   href="' + ROOT + item.href + '"'
        + '   data-tip="' + item.label + '">'
        + '  <span class="app-sidebar-link-icon">' + item.icon + '</span>'
        + '  <span class="app-sidebar-link-text">' + item.label + '</span>'
        + '  ' + badge
        + '</a>';
    }

    aside.innerHTML = brand + body;
    return aside;
  }

  function buildTopbar(opts) {
    opts = opts || {};
    const placeholder = opts.searchPlaceholder ||
      'Search orders, mills, customers, fabrics\u2026';
    const userName = opts.userName || 'Praveen Kumar';
    const userRole = opts.userRole || 'Owner';
    const userInitials = opts.userInitials || 'PK';

    const header = document.createElement('header');
    header.className = 'app-topbar';
    header.innerHTML = ''
      + '<div class="app-topbar-search">'
      + '  <span style="opacity:0.5">\u2315</span>'
      + '  <input type="text" placeholder="' + placeholder + '">'
      + '  <kbd>\u2318 K</kbd>'
      + '</div>'
      + '<div class="app-topbar-actions">'
      + '  <button class="app-topbar-icon-btn" title="Notifications" aria-label="Notifications">'
      + '    \uD83D\uDD14'
      + '    <span class="app-topbar-icon-btn-dot"></span>'
      + '  </button>'
      + '  <button class="app-topbar-icon-btn" title="Help" aria-label="Help">?</button>'
      + '  <div class="app-topbar-user">'
      + '    <div class="app-topbar-user-avatar">' + userInitials + '</div>'
      + '    <div>'
      + '      <div class="app-topbar-user-name">' + userName + '</div>'
      + '      <div class="app-topbar-user-role">' + userRole + '</div>'
      + '    </div>'
      + '  </div>'
      + '</div>';
    return header;
  }

  function mount() {
    const sidebarSlot = document.getElementById('sidebar-slot');
    if (sidebarSlot) {
      const activeId = sidebarSlot.getAttribute('data-active') || '';
      const sidebar = buildSidebar(activeId);
      sidebarSlot.replaceWith(sidebar);
    }
    const topbarSlot = document.getElementById('topbar-slot');
    if (topbarSlot) {
      const opts = {
        searchPlaceholder: topbarSlot.getAttribute('data-search') || undefined,
        userName: topbarSlot.getAttribute('data-user') || undefined,
        userRole: topbarSlot.getAttribute('data-role') || undefined,
        userInitials: topbarSlot.getAttribute('data-initials') || undefined
      };
      const topbar = buildTopbar(opts);
      topbarSlot.replaceWith(topbar);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  /* Edge auto-scroll v2: cursor within EDGE_PX of top/bottom -> scrolls.
     Finds the nearest scrollable ancestor under the cursor (sidebar, main,
     drawer body, or page). Subtle gradient hints appear at the active edge.
     Disabled while typing in inputs, and on touch devices. */
  (function setupEdgeAutoScroll() {
    const EDGE_PX   = 80;
    const MAX_SPEED = 18;
    const MIN_SPEED = 0.5;

    let mouseX = -1, mouseY = -1, hasMouse = false;
    let rafId = null;
    let topHint = null, bottomHint = null;

    if (window.matchMedia && window.matchMedia('(hover: none)').matches) return;

    // Visual hints: thin gradient strips at top and bottom of viewport.
    function ensureHints() {
      if (topHint) return;
      topHint = document.createElement('div');
      bottomHint = document.createElement('div');
      const base = ''
        + 'position:fixed; left:0; right:0; height:80px;'
        + 'pointer-events:none; opacity:0;'
        + 'transition: opacity 0.18s ease-out;'
        + 'z-index: 50;';
      topHint.style.cssText = base
        + 'top:0; background: linear-gradient(to bottom, '
        + 'rgba(99,102,241,0.18) 0%, rgba(99,102,241,0.04) 60%, transparent 100%);';
      bottomHint.style.cssText = base
        + 'bottom:0; background: linear-gradient(to top, '
        + 'rgba(99,102,241,0.18) 0%, rgba(99,102,241,0.04) 60%, transparent 100%);';
      document.body.appendChild(topHint);
      document.body.appendChild(bottomHint);
    }

    function setHint(direction, intensity) {
      if (!topHint) ensureHints();
      topHint.style.opacity    = direction === 'up'   ? Math.min(intensity, 1).toFixed(2) : '0';
      bottomHint.style.opacity = direction === 'down' ? Math.min(intensity, 1).toFixed(2) : '0';
    }

    function shouldSkip() {
      const a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return true;
      return false;
    }

    function isScrollable(el) {
      if (!el || el === document.body || el === document.documentElement) return false;
      const cs = getComputedStyle(el);
      const oy = cs.overflowY;
      if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') return false;
      return el.scrollHeight > el.clientHeight + 1;
    }

    /* Walk up from element under cursor to find first scrollable ancestor.
       If none found, fall back to document.scrollingElement (the page). */
    function getScrollTarget() {
      let node = document.elementFromPoint(mouseX, mouseY);
      while (node && node !== document.body) {
        if (isScrollable(node)) return node;
        node = node.parentElement;
      }
      return document.scrollingElement || document.documentElement;
    }

    function scrollBy(target, delta) {
      // scrollingElement / documentElement use window.scrollBy for smoothness
      if (target === document.scrollingElement || target === document.documentElement) {
        window.scrollBy(0, delta);
      } else {
        target.scrollTop += delta;
      }
    }

    function tick() {
      rafId = null;
      if (!hasMouse || shouldSkip()) {
        setHint(null, 0);
        scheduleNext();
        return;
      }
      const vh = window.innerHeight;
      let delta = 0;
      let direction = null;
      let intensity = 0;
      if (mouseY < EDGE_PX) {
        intensity = (EDGE_PX - mouseY) / EDGE_PX;
        delta = -Math.pow(intensity, 1.4) * MAX_SPEED;
        direction = 'up';
      } else if (mouseY > vh - EDGE_PX) {
        intensity = (mouseY - (vh - EDGE_PX)) / EDGE_PX;
        delta = Math.pow(intensity, 1.4) * MAX_SPEED;
        direction = 'down';
      }
      if (Math.abs(delta) >= MIN_SPEED) {
        const target = getScrollTarget();
        // Only scroll if the chosen target can actually move in that direction
        const canMove = (delta < 0 && target.scrollTop > 0)
          || (delta > 0 && target.scrollTop < target.scrollHeight - target.clientHeight - 1);
        if (canMove) {
          scrollBy(target, delta);
          setHint(direction, intensity);
        } else {
          setHint(null, 0);
        }
      } else {
        setHint(null, 0);
      }
      scheduleNext();
    }

    function scheduleNext() {
      if (!rafId && hasMouse) {
        rafId = requestAnimationFrame(tick);
      }
    }

    document.addEventListener('mousemove', function (e) {
      mouseX = e.clientX;
      mouseY = e.clientY;
      hasMouse = true;
      scheduleNext();
    }, { passive: true });

    document.addEventListener('mouseleave', function () {
      hasMouse = false;
      setHint(null, 0);
    });
    window.addEventListener('blur', function () {
      hasMouse = false;
      setHint(null, 0);
    });
  })();

  window.showToast = function (msg, type) {
    type = type || 'info';
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.textContent = msg;
    el.style.cssText = ''
      + 'position: fixed; bottom: 24px; left: 50%;'
      + 'transform: translateX(-50%) translateY(20px);'
      + 'background: var(--ink-900); color: white;'
      + 'padding: 12px 20px; border-radius: 12px;'
      + 'box-shadow: var(--shadow-2xl);'
      + 'font-size: 14px; font-weight: 500;'
      + 'opacity: 0; transition: all 0.3s; z-index: 1000;';
    document.body.appendChild(el);
    requestAnimationFrame(function () {
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%) translateY(0)';
    });
    setTimeout(function () {
      el.style.opacity = '0';
      el.style.transform = 'translateX(-50%) translateY(20px)';
      setTimeout(function () { el.remove(); }, 300);
    }, 2400);
  };
})();
