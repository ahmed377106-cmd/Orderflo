(function () {
  'use strict';

  const appEl = document.getElementById('app');
  const toastEl = document.getElementById('toast');
  const dlgEl = document.getElementById('dlg');

  const MARKETS = {
    a: { name: 'أمازون مصر', short: 'أمازون', bg: '#ff9900', color: '#111827', code: 'A', fee: 12 },
    n: { name: 'نون مصر', short: 'نون', bg: '#feee00', color: '#111827', code: 'N', fee: 10 },
    j: { name: 'جوميا', short: 'جوميا', bg: '#f68b1e', color: '#ffffff', code: 'J', fee: 11 }
  };

  const STATUS_META = [
    { id: 0, label: 'قيد التجهيز', cls: 'wn', next: [{ to: 1, label: 'تم الشحن', cls: 'btn-sm' }] },
    { id: 1, label: 'تم الشحن', cls: 'pr', next: [
      { to: 2, label: 'تم التسليم', cls: 'btn-sm btn-ok' },
      { to: 3, label: 'مرتجع', cls: 'btn-sm btn-er' }
    ] },
    { id: 2, label: 'تم التسليم', cls: 'ok', next: [] },
    { id: 3, label: 'مرتجع', cls: 'er', next: [] }
  ];

  const GOVS = [
    'القاهرة', 'الجيزة', 'الإسكندرية', 'القاهرة الجديدة', 'الدقهلية', 'الشرقية',
    'الغربية', 'القليوبية', 'المنوفية', 'أسيوط', 'سوهاج', 'المنيا', 'البحيرة',
    'الفيوم', 'بورسعيد', 'السويس', 'الإسماعيلية', 'كفر الشيخ', 'أسوان'
  ];

  const PAYMENTS = ['عند الاستلام', 'فودافون كاش', 'إنستاباي', 'بطاقة بنكية', 'فوري'];
  const COURIERS = ['بوسطة', 'أرامكس', 'مايلرز'];

  const state = {
    booted: false,
    busy: false,
    token: localStorage.getItem('omni_token') || '',
    theme: localStorage.getItem('omni_theme') || 'light',
    tab: 'dash', // dash | products | orders | cod | ai | integrations | settings
    me: null,
    settings: null,
    plan: null,
    counts: { lowStock: 0, pendingOrders: 0 },
    products: [],
    ai: {},
    // Dashboard state
    dashRange: 30,
    dashMarket: '',
    dashData: null,
    // Products filter state
    prodSearch: '',
    prodMarket: '',
    prodLowOnly: false,
    // Orders filter state
    ordersData: { items: [], total: 0, page: 1, pages: 1, perPage: 25 },
    orderFilter: { status: '', market: '', q: '', page: 1 },
    // COD state
    codData: null,
    // AI Studio state
    aiThinking: true,
    aiListingResult: null,
    aiLoading: ''
  };

  function applyTheme(t) {
    state.theme = t;
    localStorage.setItem('omni_theme', t);
    document.documentElement.setAttribute('data-theme', t);
  }
  applyTheme(state.theme);

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function fmt(n, d = 0) {
    return Number(n || 0).toLocaleString('ar-EG', { maximumFractionDigits: d });
  }

  function egp(n, d = 0) {
    return `${fmt(n, d)} ج.م`;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('ar-EG', {
        year: 'numeric', month: 'short', day: 'numeric'
      });
    } catch {
      return String(iso).slice(0, 10);
    }
  }

  let toastTimer = null;
  function toast(msg) {
    if (!toastEl) return;
    clearTimeout(toastTimer);
    toastEl.innerHTML = `<span>${esc(msg)}</span>`;
    toastTimer = setTimeout(() => { toastEl.innerHTML = ''; }, 3600);
  }

  function openDialog(title, bodyHtml) {
    if (!dlgEl) return;
    dlgEl.innerHTML = `
      <div class="dlg-head">
        <h3>${esc(title)}</h3>
        <button type="button" class="close-btn" data-a="close-dlg" aria-label="إغلاق">✕</button>
      </div>
      <div>${bodyHtml}</div>
    `;
    if (!dlgEl.open) dlgEl.showModal();
  }

  function closeDialog() {
    if (dlgEl && dlgEl.open) dlgEl.close();
  }

  async function api(method, path, body) {
    const headers = { 'X-Requested-With': 'omniarab' };
    if (state.token) {
      headers['Authorization'] = `Bearer ${state.token}`;
      headers['X-Omni-Token'] = state.token;
    }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    const data = isJson ? await res.json() : await res.text();
    if (!res.ok) {
      const err = new Error((data && data.error) || 'تعذر تنفيذ الطلب');
      err.status = res.status;
      err.code = data && data.code;
      throw err;
    }
    return data;
  }

  function setToken(token) {
    state.token = token || '';
    if (state.token) localStorage.setItem('omni_token', state.token);
    else localStorage.removeItem('omni_token');
  }

  async function bootstrap() {
    appEl.setAttribute('aria-busy', 'true');
    try {
      const data = await api('GET', '/api/bootstrap');
      state.me = data.me;
      state.settings = data.settings;
      state.plan = data.plan;
      state.counts = data.counts || { lowStock: 0, pendingOrders: 0 };
      state.products = data.products || [];
      state.ai = data.ai || {};
      state.booted = true;
      await loadTabData(state.tab);
    } catch (e) {
      if (e.status === 401) {
        state.me = null;
        setToken('');
      }
      state.booted = true;
    } finally {
      appEl.removeAttribute('aria-busy');
      render();
    }
  }

  async function loadTabData(tab) {
    try {
      if (tab === 'dash') {
        const q = new URLSearchParams({ range: String(state.dashRange) });
        if (state.dashMarket) q.set('market', state.dashMarket);
        state.dashData = await api('GET', `/api/dashboard?${q.toString()}`);
      } else if (tab === 'orders') {
        const q = new URLSearchParams({ page: String(state.orderFilter.page || 1) });
        if (state.orderFilter.status !== '') q.set('status', String(state.orderFilter.status));
        if (state.orderFilter.market) q.set('market', state.orderFilter.market);
        if (state.orderFilter.q) q.set('q', state.orderFilter.q);
        const res = await api('GET', `/api/orders?${q.toString()}`);
        state.ordersData = res;
        if (res.counts) state.counts = res.counts;
      } else if (tab === 'cod') {
        state.codData = await api('GET', '/api/cod');
      } else if (tab === 'products') {
        const res = await api('GET', '/api/products');
        state.products = res.products || [];
      }
    } catch (e) {
      toast(e.message);
    }
  }

  function renderMarketBadges(marketsStr) {
    return String(marketsStr || '').split('').map((k) => {
      const m = MARKETS[k];
      if (!m) return '';
      return `<span class="mk-badge" title="${esc(m.name)}" style="background:${m.bg};color:${m.color}">${m.code}</span>`;
    }).join(' ');
  }

  // =========================================================================
  // 1. شاشة الهبوط للتاجر غير المسجل (Landing Page)
  // =========================================================================
  function renderLanding() {
    return `
      <header class="navbar">
        <div class="container">
          <a href="#" class="logo" data-a="home">
            <i>O</i>
            <span>OmniArab</span>
          </a>
          <nav class="nav-links">
            <a href="#features">المميزات</a>
            <a href="#why-omni">لماذا OmniArab؟</a>
            <a href="#pricing">الباقات</a>
            <a href="#faq">الأسئلة الشائعة</a>
          </nav>
          <div class="sp"></div>
          <a href="/Orderf-fixed.zip" download="Orderf-fixed.zip" class="btn btn-ac btn-sm">⬇ تحميل المشروع الكامل (ZIP)</a>
          <button type="button" class="btn btn-gh btn-sm" data-a="theme">
            ${state.theme === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي'}
          </button>
          <button type="button" class="btn btn-gh btn-sm" data-a="open-login">تسجيل الدخول</button>
          <button type="button" class="btn btn-sm" data-a="open-register">ابدأ مجانًا</button>
        </div>
      </header>

      <section class="hero">
        <div class="container">
          <div>
            <div style="margin-bottom:12px;font-size:13px;color:#93c5fd;font-weight:700">
              منصة التجار الموحدة في مصر · أمازون مصر · نون · جوميا
            </div>
            <h1>أدِر متاجرك على أمازون ونون وجوميا من شاشة واحدة بالجنيه المصري</h1>
            <p class="lead">
              مخزون موحّد يتحدث تلقائيًا، حساب دقيق لصافي الربح بعد عمولات المنصات وضريبة ١٤٪ والمرتجعات، ومتابعة تحصيلات الدفع عند الاستلام (COD) من بوسطة وأرامكس ومايلرز مع مستشار ذكاء اصطناعي فائق التفكير.
            </p>
            <div class="row-wrap" style="gap:14px">
              <button type="button" class="btn btn-ac btn-lg" data-a="start-demo">
                جرّب الحساب التجريبي الفوري (بيانات سنة كاملة)
              </button>
              <a href="/Orderf-fixed.zip" download="Orderf-fixed.zip" class="btn btn-gh btn-lg" style="background:rgba(255,255,255,0.14);color:#fff;border-color:rgba(255,255,255,0.3)">
                ⬇ تنزيل ملفات المشروع الكاملة (ZIP)
              </a>
            </div>
            <div class="row-wrap" style="margin-top:24px;font-size:13px;color:#cbd5e1;gap:18px">
              <span>دعم الفاتورة الضريبية المبسطة (QR)</span>
              <span>·</span>
              <span>سحب تحصيلات COD عبر InstaPay</span>
              <span>·</span>
              <span>بوالص شحن مجمعة AWB</span>
            </div>
          </div>

          <div class="glass-card">
            <div class="row" style="justify-content:space-between;margin-bottom:14px">
              <div>
                <div style="font-size:12.5px;color:#93c5fd">معاينة مباشرة — متجر النور للإلكترونيات</div>
                <strong style="font-size:18px">صافي الأرباح والتحصيلات الحية</strong>
              </div>
              <span class="ai-badge">Gemini AI</span>
            </div>
            <div class="grid-equal" style="margin-bottom:14px">
              <div style="background:rgba(255,255,255,0.06);padding:14px;border-radius:12px">
                <div style="font-size:12px;color:#cbd5e1">مبيعات آخر ٣٠ يومًا</div>
                <div style="font-size:22px;font-weight:800;margin-top:4px;font-variant-numeric:tabular-nums">١٤٨,٩٥٠ ج.م</div>
                <div style="font-size:12px;color:#4ade80;margin-top:2px">+٢٤.٨٪ عن الشهر السابق</div>
              </div>
              <div style="background:rgba(255,255,255,0.06);padding:14px;border-radius:12px">
                <div style="font-size:12px;color:#cbd5e1">رصيد COD جاهز للسحب</div>
                <div style="font-size:22px;font-weight:800;margin-top:4px;font-variant-numeric:tabular-nums">٣٤,٢١٠ ج.م</div>
                <div style="font-size:12px;color:#fde047;margin-top:2px">متاح للتحويل الفوري لـ InstaPay</div>
              </div>
            </div>
            <div class="glass-row row" style="justify-content:space-between;font-size:13.5px">
              <span>أمازون مصر (عمولة ١٢٪ + ض.ق.م)</span>
              <strong style="font-variant-numeric:tabular-nums">٥٢٪ من المبيعات</strong>
            </div>
            <div class="glass-row row" style="justify-content:space-between;font-size:13.5px">
              <span>نون مصر (عمولة ١٠٪ + ض.ق.م)</span>
              <strong style="font-variant-numeric:tabular-nums">٣١٪ من المبيعات</strong>
            </div>
            <div class="glass-row row" style="justify-content:space-between;font-size:13.5px">
              <span>جوميا مصر (عمولة ١١٪ + ض.ق.م)</span>
              <strong style="font-variant-numeric:tabular-nums">١٧٪ من المبيعات</strong>
            </div>
            <div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.14);display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:12.5px;color:#cbd5e1">جرّب المنصة الآن بدون تسجيل بيانات بطاقة</span>
              <button type="button" class="btn btn-sm btn-ac" data-a="start-demo">افتح اللوحة التجريبية ←</button>
            </div>
          </div>
        </div>
      </section>

      <section id="why-omni" class="sec alt">
        <div class="container">
          <div class="ctr" style="max-width:720px;margin:0 auto 32px">
            <h2>لماذا صُمم OmniArab خصيصًا للتاجر المصري؟</h2>
            <p class="mu">حلول عملية للمشكلات اليومية التي تواجه التجار على منصات البيع وشركات الشحن في مصر</p>
          </div>
          <div class="grid-cards">
            <div class="card">
              <h3>Diagnostic: لماذا تتعطل الحسابات؟</h3>
              <p class="mu" style="font-size:14px;margin-top:6px">
                بيع آخر قطعة على أمازون ونسيان تصفيرها على نون يؤدي لإلغاء الطلب وفرض غرامات تقييم. OmniArab يخصم المخزون مركزيًا ويعيد المرتجع تلقائيًا فور تحديث الحالة.
              </p>
            </div>
            <div class="card">
              <h3>حساب صافي الربح الحقيقي</h3>
              <p class="mu" style="font-size:14px;margin-top:6px">
                المبيعات الإجمالية ليست هي ربحك. المنصة تخصم تلقائيًا عمولة السوق (١٠٪ إلى ١٢٪) + ضريبة القيمة المضافة ١٤٪ على العمولة + تكلفة البضاعة ورسوم الشحن والمرتجعات.
              </p>
            </div>
            <div class="card">
              <h3>تسريع دورة الكاش و COD</h3>
              <p class="mu" style="font-size:14px;margin-top:6px">
                راقب أموالك المحصلة لدى بوسطة وأرامكس ومايلرز لحظة بلحظة، واسحب صافي التحصيلات مباشرة إلى حسابك في InstaPay لتمويل شراء البضاعة الجديدة.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="features" class="sec">
        <div class="container">
          <div class="ctr" style="max-width:680px;margin:0 auto 36px">
            <h2>كل ما يحتاجه متجرك في مكان واحد</h2>
            <p class="mu">أدوات متكاملة لإدارة المنتجات، الطلبات، الفواتير، والذكاء الاصطناعي</p>
          </div>
          <div class="grid-cards">
            <div class="card card-hover">
              <h3>١. كتالوج ومخزون موحّد</h3>
              <p class="mu" style="font-size:14px;margin-top:6px">إدارة الكود (SKU) وتكلفة الشراء وسعر البيع والمنصات المنشور عليها المنتج مع تنبيهات النفاد المبكر.</p>
            </div>
            <div class="card card-hover">
              <h3>٢. بوالص شحن وفواتير QR</h3>
              <p class="mu" style="font-size:14px;margin-top:6px">طباعة فواتير ضريبية مبسطة متوافقة بصريًا مع رمز QR وبوالص شحن مجمعة (AWB) جاهزة للطباعة بضغطة زر.</p>
            </div>
            <div class="card card-hover">
              <h3>٣. رسائل واتساب لتقليل المرتجعات</h3>
              <p class="mu" style="font-size:14px;margin-top:6px">توليد رسائل تأكيد عنوان وموعد توصيل باللهجة المصرية الراقية لكل طلب لتقليل نسبة رفض الاستلام (RTO).</p>
            </div>
            <div class="card card-hover">
              <h3>٤. مستشار Gemini فائق التفكير</h3>
              <p class="mu" style="font-size:14px;margin-top:6px">تحليل مالي واستراتيجي لبيانات متجرك، كتابة عناوين SEO لأمازون ونون وجوميا، وفحص أسعار المنافسين في السوق المصري.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" class="sec alt">
        <div class="container">
          <div class="ctr" style="max-width:650px;margin:0 auto 36px">
            <h2>باقات مرنة تناسب حجم أعمالك</h2>
            <p class="mu">ابدأ مجانًا بدون بطاقة بنكية ورقِّ باقتك مع نمو مبيعاتك</p>
          </div>
          <div class="grid-cards">
            <div class="card">
              <div class="mu" style="font-size:13px;font-weight:700">للتجار المبتدئين</div>
              <h3 style="font-size:20px;margin-top:4px">باقة البداية</h3>
              <div style="font-size:28px;font-weight:800;margin:12px 0;font-variant-numeric:tabular-nums">مجانًا</div>
              <p class="mu" style="font-size:13.5px;margin-bottom:16px">حتى ٥٠ منتجًا · ربط سوقين · ١٥ طلب ذكاء اصطناعي يوميًا</p>
              <button type="button" class="btn btn-gh" style="width:100%" data-a="open-register">ابدأ مجانًا</button>
            </div>
            <div class="card" style="border-color:var(--pr);box-shadow:var(--sh-md)">
              <div class="pr-tx" style="font-size:13px;font-weight:800">الأكثر اختيارًا للتجار</div>
              <h3 style="font-size:20px;margin-top:4px">باقة التاجر المحترف</h3>
              <div style="font-size:28px;font-weight:800;margin:12px 0;font-variant-numeric:tabular-nums">٤٩٠ ج.م <span class="mu" style="font-size:14px;font-weight:600">/ شهريًا</span></div>
              <p class="mu" style="font-size:13.5px;margin-bottom:16px">حتى ١,٥٠٠ منتج · ربط ٣ أسواق كاملة · ٢٠٠ طلب ذكاء اصطناعي يوميًا</p>
              <button type="button" class="btn" style="width:100%" data-a="start-demo">جرّبها الآن في الحساب التجريبي</button>
            </div>
            <div class="card">
              <div class="mu" style="font-size:13px;font-weight:700">للموزعين والعلامات التجارية</div>
              <h3 style="font-size:20px;margin-top:4px">باقة الشركات والعلامات</h3>
              <div style="font-size:28px;font-weight:800;margin:12px 0;font-variant-numeric:tabular-nums">١,٢٥٠ ج.م <span class="mu" style="font-size:14px;font-weight:600">/ شهريًا</span></div>
              <p class="mu" style="font-size:13.5px;margin-bottom:16px">منتجات غير محدودة · ربط كل الأسواق وشركات الشحن · ١,٠٠٠ طلب ذكاء اصطناعي</p>
              <button type="button" class="btn btn-gh" style="width:100%" data-a="open-register">انضم الآن</button>
            </div>
          </div>
        </div>
      </section>

      <section id="faq" class="sec">
        <div class="container" style="max-width:820px">
          <h2 class="ctr" style="margin-bottom:24px">الأسئلة الشائعة</h2>
          <details open>
            <summary>لماذا لم يعمل الموقع عندما رُفعت الملفات سابقًا على GitHub؟</summary>
            <p class="mu" style="margin-top:8px">
              عند رفع جميع الملفات في المجلد الرئيسي مباشرةً بدون مجلدات فرعية (<code>src/</code> و<code>src/routes/</code> و<code>public/</code>)، حدث تصادم في أسماء الملفات المتشابهة مثل <code>app.js</code> و<code>auth.js</code> و<code>ai.js</code>، وتمت إعادة بناء الهيكل الكامل هنا ليعمل الخادم والواجهة بكفاءة ١٠٠٪.
            </p>
          </details>
          <details>
            <summary>كيف يتم حساب صافي الربح في لوحة التحكم؟</summary>
            <p class="mu" style="margin-top:8px">
              يُحسب صافي الربح بطرح عمولة المنصة (أمازون ١٢٪، نون ١٠٪، جوميا ١١٪ مضافًا إليها ١٤٪ ضريبة قيمة مضافة على العمولة) + تكلفة شراء المنتجات + رسوم الشحن، وفي حالة المرتجع تُحتسب تكلفة الشحن المزدوجة ويعود المنتج للمخزون تلقائيًا.
            </p>
          </details>
          <details>
            <summary>هل يمكنني تجربة النظام بدون تسجيل حساب؟</summary>
            <p class="mu" style="margin-top:8px">
              نعم، اضغط على زر «جرّب الحساب التجريبي الفوري» ليتم إنشاء متجر تجريبي خاص بك يحتوي على بيانات مبيعات واقعية لسنة كاملة وأكثر من ٨٠٠ طلب جاهز للتجربة.
            </p>
          </details>
        </div>
      </section>

      <footer style="padding:28px 0;border-top:1px solid var(--bd);text-align:center;font-size:13.5px" class="mu">
        <div class="container row-wrap" style="justify-content:space-between">
          <span>© ${new Date().getFullYear()} OmniArab — منصة إدارة التجارة الإلكترونية الموحدة في مصر</span>
          <span>جميع الأسعار والعمليات بالجنيه المصري (ج.م)</span>
        </div>
      </footer>
    `;
  }

  // =========================================================================
  // 2. هيكل لوحة التحكم للتاجر (Dashboard App Shell)
  // =========================================================================
  function renderShell() {
    const u = state.me;
    const c = state.counts || { lowStock: 0, pendingOrders: 0 };
    const nav = [
      { id: 'dash', label: 'لوحة التحكم', icon: '📊', count: 0 },
      { id: 'products', label: 'المنتجات والمخزون', icon: '📦', count: c.lowStock },
      { id: 'orders', label: 'الطلبات والبوالص', icon: '🧾', count: c.pendingOrders },
      { id: 'cod', label: 'تحصيلات COD', icon: '💳', count: 0 },
      { id: 'ai', label: 'الذكاء الاصطناعي', icon: '✨', count: 0 },
      { id: 'integrations', label: 'ربط القنوات', icon: '🔗', count: 0 },
      { id: 'settings', label: 'الإعدادات والباقة', icon: '⚙️', count: 0 }
    ];

    return `
      <div class="shell">
        <aside class="sidebar">
          <div class="logo" style="padding:6px 10px 16px">
            <i>O</i>
            <span>OmniArab</span>
          </div>

          ${nav.map((item) => `
            <a href="#${item.id}" class="nav-item ${state.tab === item.id ? 'on' : ''}" data-a="tab" data-tab="${item.id}">
              <span>${item.icon}</span>
              <span>${esc(item.label)}</span>
              ${item.count ? `<span class="nav-count">${fmt(item.count)}</span>` : ''}
            </a>
          `).join('')}

          <div class="sp side-extra"></div>

          <div class="side-extra card" style="padding:12px;margin-top:12px;background:var(--bg-sub);border:none">
            <div style="font-size:12px" class="mu">الباقة الحالية: <strong style="color:var(--tx)">${esc(state.plan?.name || 'باقة البداية')}</strong></div>
            <div style="font-size:12px;margin-top:4px" class="mu">
              المنتجات: <span style="font-variant-numeric:tabular-nums">${fmt(state.plan?.used || 0)}${state.plan?.limit ? ` / ${fmt(state.plan.limit)}` : ' (غير محدود)'}</span>
            </div>
            <div class="progress" style="margin-top:8px">
              <i style="width:${state.plan?.limit ? Math.min(100, Math.round(((state.plan.used || 0) / state.plan.limit) * 100)) : 25}%;background:var(--pr)"></i>
            </div>
          </div>
        </aside>

        <main>
          ${u.isDemo ? `
            <div class="demo-banner">
              <span>أنت تتصفح <strong>الحساب التجريبي (${esc(u.storeName)})</strong> — جميع البيانات للتجربة الحية ويمكنك إضافة طلبات أو منتجات بحرية.</span>
              <div class="row-wrap" style="gap:8px">
                <button type="button" class="btn btn-sm btn-gh" data-a="demo-reset">إعادة ضبط بيانات التجربة</button>
                <button type="button" class="btn btn-sm" data-a="open-register">إنشاء حساب متجر حقيقي</button>
              </div>
            </div>
          ` : ''}

          <div class="topbar">
            <div>
              <h2 style="font-size:21px;margin:0">${esc(u.storeName)}</h2>
              <div class="mu" style="font-size:12.5px">
                آخر مزامنة للقنوات: ${state.settings?.lastSyncAt ? fmtDate(state.settings.lastSyncAt) : 'لم تتم المزامنة بعد'}
              </div>
            </div>
            <div class="sp"></div>
            <a href="/Orderf-fixed.zip" download="Orderf-fixed.zip" class="btn btn-ac btn-sm">⬇ تحميل ملفات المشروع (ZIP)</a>
            <button type="button" class="btn btn-gh btn-sm" data-a="sync-now">مزامنة القنوات الآن</button>
            <button type="button" class="btn btn-gh btn-sm" data-a="theme">
              ${state.theme === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي'}
            </button>
            <button type="button" class="btn btn-er btn-sm" data-a="logout">خروج</button>
          </div>

          ${renderActiveTab()}
        </main>
      </div>
    `;
  }

  function renderActiveTab() {
    switch (state.tab) {
      case 'dash': return renderDashboardTab();
      case 'products': return renderProductsTab();
      case 'orders': return renderOrdersTab();
      case 'cod': return renderCodTab();
      case 'ai': return renderAiTab();
      case 'integrations': return renderIntegrationsTab();
      case 'settings': return renderSettingsTab();
      default: return renderDashboardTab();
    }
  }

  // =========================================================================
  // 3. تبويب لوحة التحكم (Dashboard Tab)
  // =========================================================================
  function renderDashboardTab() {
    const d = state.dashData;
    if (!d) {
      return `<div class="card ctr mu" style="padding:48px">جاري تحميل مؤشرات الأداء...</div>`;
    }
    const k = d.kpis || {};
    const months = d.months || [];
    const maxRev = Math.max(1, ...months.map((m) => m.revenue || 0));

    return `
      <div class="row-wrap" style="justify-content:space-between;margin-bottom:18px">
        <div class="row-wrap" style="gap:8px">
          <button type="button" class="pill ${state.dashMarket === '' ? 'on' : ''}" data-a="dash-market" data-market="">كل المنصات</button>
          <button type="button" class="pill ${state.dashMarket === 'a' ? 'on' : ''}" data-a="dash-market" data-market="a">أمازون مصر</button>
          <button type="button" class="pill ${state.dashMarket === 'n' ? 'on' : ''}" data-a="dash-market" data-market="n">نون مصر</button>
          <button type="button" class="pill ${state.dashMarket === 'j' ? 'on' : ''}" data-a="dash-market" data-market="j">جوميا</button>
        </div>
        <div class="row-wrap" style="gap:8px">
          <button type="button" class="pill ${state.dashRange === 7 ? 'on' : ''}" data-a="dash-range" data-range="7">آخر ٧ أيام</button>
          <button type="button" class="pill ${state.dashRange === 30 ? 'on' : ''}" data-a="dash-range" data-range="30">آخر ٣٠ يومًا</button>
          <button type="button" class="pill ${state.dashRange === 90 ? 'on' : ''}" data-a="dash-range" data-range="90">آخر ٩٠ يومًا</button>
        </div>
      </div>

      <div class="grid-kpi" style="margin-bottom:20px">
        <div class="card kpi-card">
          <span class="mu" style="font-size:13px">إجمالي المبيعات (بدون المرتجع)</span>
          <b style="font-variant-numeric:tabular-nums">${egp(k.gross)}</b>
          <span style="font-size:12.5px" class="${k.grossDelta >= 0 ? 'ok-tx' : 'er-tx'}">
            ${k.grossDelta != null ? `${k.grossDelta >= 0 ? '+' : ''}${fmt(k.grossDelta, 1)}٪ عن الفترة السابقة` : `${fmt(k.orders)} طلب مسجل`}
          </span>
        </div>

        <div class="card kpi-card">
          <span class="mu" style="font-size:13px">صافي الربح الحقيقي (بعد العمولات والشحن)</span>
          <b class="ok-tx" style="font-variant-numeric:tabular-nums">${egp(k.net)}</b>
          <span class="mu" style="font-size:12.5px">هامش الربح الصافي: ${fmt(k.margin, 1)}٪</span>
        </div>

        <div class="card kpi-card">
          <span class="mu" style="font-size:13px">عمولات المنصات + ض.ق.م (١٤٪)</span>
          <b class="wn-tx" style="font-variant-numeric:tabular-nums">${egp(k.fees)}</b>
          <span class="mu" style="font-size:12.5px">نسبة التسليم الناجح: ${fmt(k.deliveryRate, 1)}٪</span>
        </div>

        <div class="card kpi-card">
          <span class="mu" style="font-size:13px">رصيد COD الجاهز للسحب</span>
          <b class="pr-tx" style="font-variant-numeric:tabular-nums">${egp(k.codReady)}</b>
          <div>
            <button type="button" class="btn btn-sm btn-gh" data-a="tab" data-tab="cod">سحب عبر InstaPay ←</button>
          </div>
        </div>
      </div>

      <div class="grid-2" style="margin-bottom:20px">
        <div class="card">
          <div class="row" style="justify-content:space-between;margin-bottom:14px">
            <div>
              <h3>نمو المبيعات وصافي الأرباح (١٢ شهرًا)</h3>
              <span class="mu" style="font-size:12.5px">الأزرق: إجمالي المبيعات · الأخضر: صافي الربح بعد العمولات</span>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(12,1fr);gap:8px;align-items:end;height:190px;padding-top:20px;border-bottom:1px solid var(--bd)">
            ${months.map((m) => {
              const revH = Math.max(6, Math.round(((m.revenue || 0) / maxRev) * 145));
              const profH = Math.max(4, Math.round((Math.max(0, m.profit || 0) / maxRev) * 145));
              return `
                <div style="display:flex;flex-direction:column;align-items:center;gap:4px" title="${esc(m.label)}: المبيعات ${egp(m.revenue)} | الصافي ${egp(m.profit)}">
                  <div style="display:flex;align-items:flex-end;gap:3px;height:150px">
                    <span style="width:9px;height:${revH}px;background:var(--pr);border-radius:4px 4px 0 0"></span>
                    <span style="width:9px;height:${profH}px;background:var(--ok);border-radius:4px 4px 0 0"></span>
                  </div>
                  <span class="mu" style="font-size:11px;white-space:nowrap">${esc(m.label)}</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div class="card">
          <h3>توزيع المبيعات حسب المنصة وطريقة الدفع</h3>
          <p class="mu" style="font-size:12.5px;margin-bottom:14px">خلال الفترة المحددة (${fmt(state.dashRange)} يومًا)</p>

          ${['a', 'n', 'j'].map((k) => {
            const m = MARKETS[k];
            const share = d.marketShare?.[k] || { amount: 0, pct: 0 };
            return `
              <div style="margin-bottom:12px">
                <div class="row" style="justify-content:space-between;font-size:13.5px;margin-bottom:4px">
                  <span>${renderMarketBadges(k)} <strong>${esc(m.name)}</strong></span>
                  <span style="font-variant-numeric:tabular-nums">${egp(share.amount)} (${fmt(share.pct, 1)}٪)</span>
                </div>
                <div class="progress">
                  <i style="width:${Math.min(100, share.pct || 0)}%;background:${m.bg === '#feee00' ? '#eab308' : m.bg}"></i>
                </div>
              </div>
            `;
          }).join('')}

          <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--bd);font-size:13px" class="row-wrap">
            <span>الدفع عند الاستلام: <strong style="font-variant-numeric:tabular-nums">${fmt(d.payShare?.cod || 0, 1)}٪</strong></span>
            <span>·</span>
            <span>المحافظ وInstaPay: <strong style="font-variant-numeric:tabular-nums">${fmt(d.payShare?.wallet || 0, 1)}٪</strong></span>
            <span>·</span>
            <span>البطاقات وفوري: <strong style="font-variant-numeric:tabular-nums">${fmt(d.payShare?.card || 0, 1)}٪</strong></span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="row-wrap" style="justify-content:space-between;margin-bottom:12px">
          <div>
            <h3>أحدث الطلبات</h3>
            <span class="mu" style="font-size:12.5px">آخر ٥ طلبات مسجلة على متجرك</span>
          </div>
          <div class="row-wrap" style="gap:8px">
            <button type="button" class="btn btn-sm" data-a="open-new-order">+ تسجيل طلب جديد</button>
            <button type="button" class="btn btn-sm btn-gh" data-a="tab" data-tab="orders">عرض كل الطلبات</button>
          </div>
        </div>
        ${renderOrdersTable(d.recent || [], true)}
      </div>
    `;
  }

  // =========================================================================
  // 4. تبويب المنتجات والمخزون الموحد (Products Tab)
  // =========================================================================
  function renderProductsTab() {
    const list = state.products.filter((p) => {
      if (state.prodMarket && !p.markets.includes(state.prodMarket)) return false;
      if (state.prodLowOnly && p.stock > 5) return false;
      if (state.prodSearch) {
        const q = state.prodSearch.toLowerCase();
        if (!p.name.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q) && !p.cat.toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });

    return `
      <div class="card" style="margin-bottom:18px">
        <div class="row-wrap" style="justify-content:space-between;gap:12px">
          <div class="row-wrap" style="gap:8px;flex:1">
            <input type="search" id="prod-search" placeholder="ابحث باسم المنتج أو كود SKU أو الفئة..." value="${esc(state.prodSearch)}" style="max-width:320px;margin:0">
            <button type="button" class="pill ${state.prodMarket === '' ? 'on' : ''}" data-a="prod-market" data-market="">الكل (${fmt(state.products.length)})</button>
            <button type="button" class="pill ${state.prodMarket === 'a' ? 'on' : ''}" data-a="prod-market" data-market="a">أمازون</button>
            <button type="button" class="pill ${state.prodMarket === 'n' ? 'on' : ''}" data-a="prod-market" data-market="n">نون</button>
            <button type="button" class="pill ${state.prodMarket === 'j' ? 'on' : ''}" data-a="prod-market" data-market="j">جوميا</button>
            <button type="button" class="pill ${state.prodLowOnly ? 'on' : ''}" data-a="prod-low">نواقص المخزون (${fmt(state.counts?.lowStock || 0)})</button>
          </div>
          <div class="row-wrap" style="gap:8px">
            <a href="/api/products/export.csv" class="btn btn-gh btn-sm" download>تصدير CSV</a>
            <button type="button" class="btn btn-sm" data-a="open-product-modal">+ إضافة منتج جديد</button>
          </div>
        </div>
      </div>

      ${list.length === 0 ? `
        <div class="card empty">
          <div class="empty-icon">📦</div>
          <h3>لا توجد منتجات مطابقة</h3>
          <p class="mu">أضف منتجاتك ليتم توحيد مخزونها وحساب هامش الربح الصافي عبر أمازون ونون وجوميا.</p>
          <button type="button" class="btn" data-a="open-product-modal">+ إضافة أول منتج</button>
        </div>
      ` : `
        <div class="card">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>المنتج</th>
                  <th>كود SKU</th>
                  <th>الفئة</th>
                  <th>المنصات</th>
                  <th>التكلفة</th>
                  <th>سعر البيع</th>
                  <th>هامش الربح</th>
                  <th>المخزون المتاح</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                ${list.map((p) => {
                  const margin = p.price > 0 ? Math.round(((p.price - p.cost) / p.price) * 100) : 0;
                  const stockCls = p.stock <= 5 ? 'er-tx' : p.stock <= 15 ? 'wn-tx' : 'ok-tx';
                  return `
                    <tr>
                      <td><strong>${esc(p.name)}</strong></td>
                      <td style="font-variant-numeric:tabular-nums"><code>${esc(p.sku)}</code></td>
                      <td>${esc(p.cat)}</td>
                      <td>${renderMarketBadges(p.markets)}</td>
                      <td style="font-variant-numeric:tabular-nums">${egp(p.cost)}</td>
                      <td style="font-variant-numeric:tabular-nums"><strong>${egp(p.price)}</strong></td>
                      <td style="font-variant-numeric:tabular-nums" class="${margin < 20 ? 'wn-tx' : 'ok-tx'}">${fmt(margin)}٪</td>
                      <td style="font-variant-numeric:tabular-nums" class="${stockCls}">
                        <strong>${fmt(p.stock)} قطعة</strong>
                        ${p.stock <= 5 ? ' <span class="mu" style="font-size:11.5px">(منخفض)</span>' : ''}
                      </td>
                      <td>
                        <div class="row" style="gap:6px">
                          <button type="button" class="btn btn-sm btn-gh" data-a="restock-product" data-id="${p.id}">+١٠ مخزون</button>
                          <button type="button" class="btn btn-sm btn-gh" data-a="edit-product" data-id="${p.id}">تعديل</button>
                          <button type="button" class="btn btn-sm btn-er" data-a="delete-product" data-id="${p.id}">حذف</button>
                        </div>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `}
    `;
  }

  // =========================================================================
  // 5. تبويب الطلبات والفواتير وبوالص الشحن (Orders Tab)
  // =========================================================================
  function renderOrdersTable(items, compact) {
    if (!items || !items.length) {
      return `
        <div class="empty">
          <div class="empty-icon">🧾</div>
          <h3>لا توجد طلبات مطابقة</h3>
          <p class="mu">سجّل طلبًا جديدًا أو غيّر معايير البحث والفلترة.</p>
          <button type="button" class="btn btn-sm" data-a="open-new-order">+ تسجيل طلب جديد</button>
        </div>
      `;
    }

    return `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>رقم الطلب</th>
              <th>المنصة</th>
              <th>العميل والمحافظة</th>
              <th>المنتجات</th>
              <th>الدفع والشحن</th>
              <th>الإجمالي</th>
              <th>الحالة</th>
              <th>إجراءات وتحديث</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((o) => {
              const st = STATUS_META[o.status] || STATUS_META[0];
              return `
                <tr>
                  <td style="font-variant-numeric:tabular-nums">
                    <strong>#${o.no}</strong>
                    <div class="mu" style="font-size:11.5px">${fmtDate(o.createdAt)}</div>
                  </td>
                  <td>${renderMarketBadges(o.market)} <span style="font-size:13px">${esc(MARKETS[o.market]?.short || o.market)}</span></td>
                  <td>
                    <strong>${esc(o.customer)}</strong>
                    <div class="mu" style="font-size:12px">${esc(o.gov)}${o.phone ? ` · ${esc(o.phone)}` : ''}</div>
                  </td>
                  <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis" title="${esc(o.items)}">${esc(o.items)}</td>
                  <td>
                    <div>${esc(o.pay)}</div>
                    <div class="mu" style="font-size:12px">${esc(o.courier)} (${egp(o.shipFee)})</div>
                  </td>
                  <td style="font-variant-numeric:tabular-nums"><strong>${egp(o.total)}</strong></td>
                  <td>
                    <span class="${st.cls}-tx" style="font-weight:700">${esc(st.label)}</span>
                    ${o.settled ? '<div class="mu" style="font-size:11px">تمت تسوية COD</div>' : ''}
                  </td>
                  <td>
                    <div class="row" style="gap:6px">
                      ${st.next.map((nx) => `
                        <button type="button" class="btn ${nx.cls}" data-a="order-status" data-id="${o.id}" data-status="${nx.to}">
                          ${esc(nx.label)}
                        </button>
                      `).join('')}
                      <a href="/api/orders/${o.id}/invoice" target="_blank" class="btn btn-sm btn-gh" title="فاتورة ضريبية بـ QR">فاتورة</a>
                      ${!compact ? `<button type="button" class="btn btn-sm btn-gh" data-a="ai-order-msg" data-id="${o.id}" title="رسالة واتساب للعميل">واتساب AI</button>` : ''}
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderOrdersTab() {
    const f = state.orderFilter;
    const od = state.ordersData || { items: [], total: 0, page: 1, pages: 1 };

    return `
      <div class="card" style="margin-bottom:18px">
        <div class="row-wrap" style="justify-content:space-between;gap:12px">
          <div class="row-wrap" style="gap:8px;flex:1">
            <input type="search" id="order-search" placeholder="ابحث باسم العميل، المحافظة، شركة الشحن أو رقم الطلب..." value="${esc(f.q)}" style="max-width:320px;margin:0">
            <button type="button" class="pill ${f.status === '' ? 'on' : ''}" data-a="order-filter-status" data-status="">كل الحالات (${fmt(od.total)})</button>
            <button type="button" class="pill ${f.status === '0' ? 'on' : ''}" data-a="order-filter-status" data-status="0">قيد التجهيز</button>
            <button type="button" class="pill ${f.status === '1' ? 'on' : ''}" data-a="order-filter-status" data-status="1">تم الشحن</button>
            <button type="button" class="pill ${f.status === '2' ? 'on' : ''}" data-a="order-filter-status" data-status="2">تم التسليم</button>
            <button type="button" class="pill ${f.status === '3' ? 'on' : ''}" data-a="order-filter-status" data-status="3">مرتجع</button>
          </div>
          <div class="row-wrap" style="gap:8px">
            <a href="/api/orders/awb" target="_blank" class="btn btn-gh btn-sm">طباعة بوالص الشحن (AWB)</a>
            <a href="/api/orders/export.csv" class="btn btn-gh btn-sm" download>تصدير CSV</a>
            <button type="button" class="btn btn-sm" data-a="open-new-order">+ طلب جديد</button>
          </div>
        </div>
      </div>

      <div class="card">
        ${renderOrdersTable(od.items, false)}
        ${od.pages > 1 ? `
          <div class="pager">
            <button type="button" class="btn btn-sm btn-gh" data-a="order-page" data-page="${od.page - 1}" ${od.page <= 1 ? 'disabled' : ''}>السابق</button>
            <span class="mu" style="font-variant-numeric:tabular-nums">صفحة ${fmt(od.page)} من ${fmt(od.pages)} (إجمالي ${fmt(od.total)} طلب)</span>
            <button type="button" class="btn btn-sm btn-gh" data-a="order-page" data-page="${od.page + 1}" ${od.page >= od.pages ? 'disabled' : ''}>التالي</button>
          </div>
        ` : ''}
      </div>
    `;
  }

  // =========================================================================
  // 6. تبويب تحصيلات الدفع عند الاستلام (COD & Finance Tab)
  // =========================================================================
  function renderCodTab() {
    const c = state.codData;
    if (!c) {
      return `<div class="card ctr mu" style="padding:48px">جاري تحميل أرصدة شركات الشحن...</div>`;
    }
    const t = c.totals || { collected: 0, pending: 0, fees: 0, net: 0 };

    return `
      <div class="grid-kpi" style="margin-bottom:20px">
        <div class="card kpi-card">
          <span class="mu" style="font-size:13px">إجمالي المحصّل (تم التسليم)</span>
          <b style="font-variant-numeric:tabular-nums">${egp(t.collected)}</b>
          <span class="mu" style="font-size:12.5px">مبالغ استلمتها شركات الشحن من العملاء</span>
        </div>
        <div class="card kpi-card">
          <span class="mu" style="font-size:13px">رسوم الشحن المخصومة</span>
          <b class="wn-tx" style="font-variant-numeric:tabular-nums">${egp(t.fees)}</b>
          <span class="mu" style="font-size:12.5px">تُخصم تلقائيًا قبل التحويل</span>
        </div>
        <div class="card kpi-card">
          <span class="mu" style="font-size:13px">صافي جاهز للسحب الفوري</span>
          <b class="ok-tx" style="font-variant-numeric:tabular-nums">${egp(t.net)}</b>
          <span class="mu" style="font-size:12.5px">عنوان InstaPay: <strong>${esc(c.instaPayHandle || 'غير مضبوط')}</strong></span>
        </div>
        <div class="card kpi-card">
          <span class="mu" style="font-size:13px">شحنات بالطريق (قيد التحصيل)</span>
          <b class="pr-tx" style="font-variant-numeric:tabular-nums">${egp(t.pending)}</b>
          <span class="mu" style="font-size:12.5px">تُضاف للرصيد الجاهز فور التسليم</span>
        </div>
      </div>

      <div class="grid-cards">
        ${(c.couriers || []).map((cr) => `
          <div class="card">
            <div class="row" style="justify-content:space-between;margin-bottom:8px">
              <h3>شركة شحن ${esc(cr.courier)}</h3>
              <span class="mu" style="font-size:12.5px">${esc(cr.cycle)}</span>
            </div>
            <div style="margin:14px 0;display:grid;gap:8px;font-size:14px">
              <div class="row" style="justify-content:space-between">
                <span class="mu">مبالغ محصلة (تم التسليم):</span>
                <strong style="font-variant-numeric:tabular-nums">${egp(cr.collected)}</strong>
              </div>
              <div class="row" style="justify-content:space-between">
                <span class="mu">رسوم الشحن (${fmt(cr.feePerOrder)} ج.م/طلب):</span>
                <span class="wn-tx" style="font-variant-numeric:tabular-nums">-${egp(cr.fees)}</span>
              </div>
              <div class="row" style="justify-content:space-between;padding-top:8px;border-top:1px solid var(--bd)">
                <span><strong>صافي قابل للسحب الآن:</strong></span>
                <strong class="ok-tx" style="font-size:18px;font-variant-numeric:tabular-nums">${egp(cr.net)}</strong>
              </div>
              <div class="row" style="justify-content:space-between;font-size:12.5px" class="mu">
                <span class="mu">قيد التوصيل حاليًا:</span>
                <span class="mu" style="font-variant-numeric:tabular-nums">${egp(cr.pending)}</span>
              </div>
            </div>
            <button type="button" class="btn" style="width:100%" data-a="cod-payout" data-courier="${esc(cr.key)}" ${cr.net <= 0 ? 'disabled' : ''}>
              ${cr.net > 0 ? `سحب ${egp(cr.net)} إلى InstaPay` : 'لا توجد مبالغ جاهزة للسحب'}
            </button>
          </div>
        `).join('')}
      </div>
    `;
  }

  // =========================================================================
  // 7. تبويب استوديو الذكاء الاصطناعي (AI Studio & Advisor Tab)
  // =========================================================================
  function renderAiTab() {
    const adv = state.ai?.advisor;
    const mkt = state.ai?.market;
    const lst = state.aiListingResult;

    return `
      <div class="card ai-glow" style="margin-bottom:20px">
        <div class="row-wrap" style="justify-content:space-between;gap:12px;margin-bottom:14px">
          <div>
            <div class="row" style="gap:8px;margin-bottom:4px">
              <span class="ai-badge">Gemini Advisor</span>
              <h3>المستشار المالي والاستراتيجي للمتجر</h3>
            </div>
            <p class="mu" style="font-size:13.5px">
              يحلل كتالوج منتجاتك وهوامش الربح وتحصيلات COD ليقدم خطة عمل مخصصة للسوق المصري.
            </p>
          </div>
          <div class="row-wrap" style="gap:10px">
            <label style="display:inline-flex;align-items:center;gap:8px;margin:0;cursor:pointer;font-size:13px">
              <input type="checkbox" id="ai-thinking-toggle" ${state.aiThinking ? 'checked' : ''} style="width:auto;margin:0">
              <span>تفعيل التفكير العميق (High Thinking)</span>
            </label>
            <button type="button" class="btn" data-a="run-advisor" ${state.aiLoading === 'advisor' ? 'disabled' : ''}>
              ${state.aiLoading === 'advisor' ? '<span class="spinner"></span> جاري التحليل...' : 'تحليل أداء المتجر الآن'}
            </button>
          </div>
        </div>

        ${adv && adv.data ? `
          <div class="card" style="background:var(--bg-elev)">
            <div style="font-size:16px;font-weight:800;margin-bottom:12px">${esc(adv.data.headline)}</div>
            <div class="grid-cards" style="margin-bottom:14px">
              <div>
                <div class="er-tx" style="font-size:12.5px;font-weight:700">توصية المخزون والتوريد العاجل</div>
                <p style="font-size:14px;margin-top:4px">${esc(adv.data.urgentRestockTip)}</p>
              </div>
              <div>
                <div class="ok-tx" style="font-size:12.5px;font-weight:700">تحسين هامش الربح والحزم</div>
                <p style="font-size:14px;margin-top:4px">${esc(adv.data.profitOptimizationTip)}</p>
              </div>
              <div>
                <div class="pr-tx" style="font-size:12.5px;font-weight:700">التدفقات النقدية وتحصيلات COD</div>
                <p style="font-size:14px;margin-top:4px">${esc(adv.data.cashflowAndCodTip)}</p>
              </div>
            </div>
            ${adv.data.strategicPlan ? `
              <div style="padding-top:12px;border-top:1px solid var(--bd)">
                <div style="font-size:13px;font-weight:800;margin-bottom:6px">الخطة التنفيذية المقترحة:</div>
                <div style="white-space:pre-line;font-size:13.5px" class="mu">${esc(adv.data.strategicPlan)}</div>
              </div>
            ` : ''}
          </div>
        ` : `
          <div class="mu" style="font-size:13.5px">اضغط على «تحليل أداء المتجر الآن» لتوليد التقرير المالي والاستراتيجي.</div>
        `}
      </div>

      <div class="grid-2">
        <div class="card">
          <h3>مولّد عناوين ووصف المنتجات (SEO أمازون ونون وجوميا)</h3>
          <p class="mu" style="font-size:13px;margin-bottom:14px">اكتب اسم المنتج وأهم مميزاته ليقوم النظام بصياغة عناوين عالية التحويل لكل منصة</p>
          <form id="ai-listing-form">
            <label>اسم المنتج</label>
            <input type="text" name="name" required placeholder="مثال: سماعة بلوتوث لاسلكية عازلة للضوضاء" value="${esc(state.products[0]?.name || '')}">
            <label>أهم المميزات والمواصفات (مفصولة بفاصلة)</label>
            <input type="text" name="features" placeholder="مثال: بطارية ٣٠ ساعة، شحن سريع Type-C، مايك مزدوج للمكالمات">
            <button type="submit" class="btn" style="width:100%" ${state.aiLoading === 'listing' ? 'disabled' : ''}>
              ${state.aiLoading === 'listing' ? '<span class="spinner"></span> جاري التوليد...' : 'توليد محتوى القوائم التسويقية'}
            </button>
          </form>

          ${lst ? `
            <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--bd);display:grid;gap:10px;font-size:13.5px">
              <div><strong>عنوان أمازون مصر:</strong><div class="mu">${esc(lst.amazonTitle)}</div></div>
              <div><strong>عنوان نون مصر:</strong><div class="mu">${esc(lst.noonTitle)}</div></div>
              <div><strong>عنوان جوميا:</strong><div class="mu">${esc(lst.jumiaTitle)}</div></div>
              <div><strong>المقدمة التسويقية:</strong><div class="mu">${esc(lst.descriptionIntro)}</div></div>
              <div>
                <strong>النقاط البيعية (Bullet Points):</strong>
                <ul style="padding-inline-start:20px;margin-top:4px" class="mu">
                  ${(lst.bulletPoints || []).map((b) => `<li>${esc(b)}</li>`).join('')}
                </ul>
              </div>
              <div><strong>الكلمات المفتاحية:</strong> <span class="mu">${esc(lst.keywords)}</span></div>
              <div><strong>نصيحة التسعير:</strong> <span class="ok-tx">${esc(lst.pricingTip)}</span></div>
            </div>
          ` : ''}
        </div>

        <div class="card">
          <h3>رادار أسعار السوق المصري (بحث حي عبر Google)</h3>
          <p class="mu" style="font-size:13px;margin-bottom:14px">افحص النطاق السعري للمنتج في المتاجر المصرية لتحديد السعر التنافسي الأمثل</p>
          <form id="ai-market-form">
            <label>اسم المنتج للبحث في السوق المصري</label>
            <input type="text" name="name" required placeholder="مثال: باور بانك 20000 مللي أمبير" value="${esc(mkt?.name || state.products[0]?.name || '')}">
            <button type="submit" class="btn btn-gh" style="width:100%" ${state.aiLoading === 'market' ? 'disabled' : ''}>
              ${state.aiLoading === 'market' ? '<span class="spinner"></span> جاري فحص السوق...' : 'فحص النطاق السعري في مصر'}
            </button>
          </form>

          ${mkt ? `
            <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--bd);font-size:13.5px">
              <div style="font-weight:700;margin-bottom:6px">نتيجة فحص السوق لـ «${esc(mkt.name)}»:</div>
              <p style="white-space:pre-line" class="mu">${esc(mkt.text)}</p>
              ${mkt.sources && mkt.sources.length ? `
                <div style="margin-top:10px;font-size:12.5px">
                  <strong>المصادر المرجعية:</strong>
                  <ul style="padding-inline-start:18px;margin-top:4px">
                    ${mkt.sources.map((s) => `<li><a href="${esc(s.uri)}" target="_blank" rel="noopener noreferrer" class="pr-tx">${esc(s.title)}</a></li>`).join('')}
                  </ul>
                </div>
              ` : ''}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  // =========================================================================
  // 8. تبويب ربط القنوات والتكاملات (Integrations Tab)
  // =========================================================================
  function renderIntegrationsTab() {
    const intg = state.settings?.integrations || {};
    const items = [
      { key: 'a', title: 'أمازون مصر (Amazon Seller Central)', desc: 'مزامنة المخزون والطلبات وعمولة ١٢٪ تلقائيًا' },
      { key: 'n', title: 'نون مصر (Noon Partners)', desc: 'سحب طلبات FBN وربط الأكواد والأسعار بالجنيه' },
      { key: 'j', title: 'جوميا مصر (Jumia Vendor Center)', desc: 'تحديث الكميات الفوري وتجنب غرامات الإلغاء' },
      { key: 'bs', title: 'شركة شحن بوسطة (Bosta)', desc: 'إصدار البوالص ومتابعة حالة التسليم وتحصيلات COD' },
      { key: 'ar', title: 'شركة شحن أرامكس (Aramex)', desc: 'تتبع الشحنات والتسويات المالية الأسبوعية' },
      { key: 'my', title: 'شركة شحن مايلرز (Mylerz)', desc: 'توصيل سريع بالقاهرة والمحافظات وتحصيل فوري' },
      { key: 'eta', title: 'منظومة الفاتورة الإلكترونية المصرية (ETA)', desc: 'إصدار الفواتير الضريبية المبسطة برمز QR' },
      { key: 'fw', title: 'مدفوعات فوري (Fawry Pay)', desc: 'تحصيل المدفوعات المسبقة عبر منافذ فوري' },
      { key: 'vc', title: 'فودافون كاش وInstaPay', desc: 'استلام التحويلات الفورية وتسوية الحسابات' }
    ];

    return `
      <div class="card" style="margin-bottom:18px">
        <div class="row-wrap" style="justify-content:space-between">
          <div>
            <h3>ربط منصات البيع وشركات الشحن والدفع</h3>
            <p class="mu" style="font-size:13.5px">فعّل القنوات المتصلة بمتجرك ليتم توحيد المخزون والطلبات عند الضغط على «مزامنة القنوات»</p>
          </div>
          <button type="button" class="btn btn-sm" data-a="sync-now">مزامنة القنوات المفعّلة الآن</button>
        </div>
      </div>

      <div class="grid-cards">
        ${items.map((it) => {
          const on = Boolean(intg[it.key]);
          return `
            <div class="card row" style="justify-content:space-between;align-items:flex-start;gap:14px">
              <div>
                <h3 style="font-size:15.5px">${esc(it.title)}</h3>
                <p class="mu" style="font-size:13px;margin-top:4px">${esc(it.desc)}</p>
                <div style="margin-top:8px;font-size:12px" class="${on ? 'ok-tx' : 'mu'}">
                  ${on ? 'متصل ومفعّل للمزامنة' : 'غير مفعّل'}
                </div>
              </div>
              <div role="switch" tabindex="0" aria-checked="${on}" class="switch ${on ? 'on' : ''}" data-a="toggle-integration" data-key="${it.key}"></div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // =========================================================================
  // 9. تبويب الإعدادات والباقات (Settings & Plans Tab)
  // =========================================================================
  function renderSettingsTab() {
    const s = state.settings || {};
    const p = state.plan || { id: 'free', name: 'باقة البداية' };
    const notif = s.notifications || {};

    return `
      <div class="grid-2" style="margin-bottom:20px">
        <div class="card">
          <h3>بيانات المتجر والفوترة الضريبية</h3>
          <p class="mu" style="font-size:13px;margin-bottom:14px">تظهر هذه البيانات على الفاتورة الضريبية المبسطة وبوالص الشحن</p>
          <form id="settings-form">
            <label>اسم المتجر أو الشركة</label>
            <input type="text" name="storeName" required value="${esc(s.storeName || '')}">

            <label>الرقم الضريبي (للفاتورة الإلكترونية)</label>
            <input type="text" name="taxId" placeholder="مثال: 412-890-115" value="${esc(s.taxId || '')}">

            <label>عنوان InstaPay لاستلام تحصيلات COD</label>
            <input type="text" name="instaPayHandle" placeholder="username@instapay" value="${esc(s.instaPayHandle || '')}">

            <label>رقم الموبايل</label>
            <input type="text" name="storePhone" value="${esc(s.storePhone || '')}" ${state.me?.isDemo ? 'disabled' : ''}>

            <label>البريد الإلكتروني</label>
            <input type="email" name="storeEmail" value="${esc(s.storeEmail || '')}" ${state.me?.isDemo ? 'disabled' : ''}>

            <button type="submit" class="btn">حفظ إعدادات المتجر</button>
          </form>
        </div>

        <div>
          <div class="card" style="margin-bottom:18px">
            <h3>الباقة الحالية وترقية الحساب</h3>
            <p class="mu" style="font-size:13px;margin-bottom:14px">اختر الباقة المناسبة لعدد منتجاتك والمنصات المتصلة</p>
            <div style="display:grid;gap:10px">
              ${[
                { id: 'free', name: 'باقة البداية (مجانًا)', desc: 'حتى ٥٠ منتجًا · سوقين · ١٥ طلب ذكاء اصطناعي' },
                { id: 'pro', name: 'باقة التاجر المحترف (٤٩٠ ج.م/شهريًا)', desc: 'حتى ١,٥٠٠ منتج · ٣ أسواق · ٢٠٠ طلب ذكاء اصطناعي' },
                { id: 'business', name: 'باقة الشركات والعلامات (١,٢٥٠ ج.م/شهريًا)', desc: 'منتجات غير محدودة · ٣ أسواق · ١,٠٠٠ طلب ذكاء اصطناعي' }
              ].map((pl) => `
                <div class="row" style="justify-content:space-between;padding:12px;border:1px solid ${p.id === pl.id ? 'var(--pr)' : 'var(--bd)'};border-radius:12px">
                  <div>
                    <strong>${esc(pl.name)}</strong>
                    <div class="mu" style="font-size:12.5px">${esc(pl.desc)}</div>
                  </div>
                  ${p.id === pl.id
                    ? `<span class="pr-tx" style="font-weight:800;font-size:13px">باقتك الحالية</span>`
                    : `<button type="button" class="btn btn-sm btn-gh" data-a="change-plan" data-plan="${pl.id}">اختيار الباقة</button>`}
                </div>
              `).join('')}
            </div>
          </div>

          <div class="card">
            <h3>تفضيلات التنبيهات</h3>
            <div style="display:grid;gap:12px;margin-top:12px">
              ${[
                { key: 's', label: 'تنبيهات انخفاض المخزون (أقل من ٥ قطع)' },
                { key: 'o', label: 'إشعارات الطلبات الجديدة والمرتجعات' },
                { key: 'f', label: 'إشعارات جاهزية تحويلات COD من شركات الشحن' },
                { key: 'w', label: 'التقرير المالي الأسبوعي عبر واتساب' }
              ].map((n) => {
                const on = Boolean(notif[n.key]);
                return `
                  <div class="row" style="justify-content:space-between">
                    <span style="font-size:14px">${esc(n.label)}</span>
                    <div role="switch" tabindex="0" aria-checked="${on}" class="switch ${on ? 'on' : ''}" data-a="toggle-notif" data-key="${n.key}"></div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function render() {
    if (!state.booted) {
      appEl.innerHTML = `<div class="container ctr mu" style="padding:80px 0">جاري تحميل منصة OmniArab...</div>`;
      return;
    }
    appEl.innerHTML = state.me ? renderShell() : renderLanding();
  }

  // =========================================================================
  // النوافذ المنبثقة (Modals: Login, Register, Product, New Order)
  // =========================================================================
  function showLoginModal() {
    openDialog('تسجيل الدخول إلى متجرك', `
      <form id="login-form">
        <label>رقم الموبايل المصري أو البريد الإلكتروني</label>
        <input type="text" name="id" required placeholder="01012345678 أو email@example.com">
        <label>كلمة المرور</label>
        <input type="password" name="password" required placeholder="••••••••">
        <button type="submit" class="btn" style="width:100%">دخول إلى لوحة التحكم</button>
      </form>
      <div class="ctr mu" style="margin-top:14px;font-size:13px">
        ليس لديك حساب؟ <a href="#" class="pr-tx" data-a="open-register">أنشئ حساب متجر جديد</a> أو <a href="#" class="pr-tx" data-a="start-demo">جرّب الحساب التجريبي</a>
      </div>
    `);
  }

  function showRegisterModal() {
    openDialog('إنشاء حساب متجر جديد (مجانًا)', `
      <form id="register-form">
        <label>اسم المتجر أو العلامة التجارية</label>
        <input type="text" name="store" required placeholder="مثال: متجر النور للإلكترونيات">
        <label>رقم الموبايل المصري</label>
        <input type="tel" name="phone" required placeholder="01012345678">
        <label>البريد الإلكتروني (اختياري)</label>
        <input type="email" name="email" placeholder="owner@store.com">
        <label>كلمة المرور (٨ أحرف على الأقل)</label>
        <input type="password" name="password" required minlength="8" placeholder="••••••••">
        <button type="submit" class="btn" style="width:100%">إنشاء المتجر والبدء الآن</button>
      </form>
    `);
  }

  function showProductModal(product) {
    const isEdit = Boolean(product);
    const p = product || { name: '', sku: '', cat: 'إلكترونيات', price: '', cost: '', stock: 10, markets: 'anj' };
    openDialog(isEdit ? 'تعديل بيانات المنتج' : 'إضافة منتج جديد للكتالوج الموحد', `
      <form id="product-form" data-id="${isEdit ? p.id : ''}">
        <label>اسم المنتج</label>
        <input type="text" name="name" required value="${esc(p.name)}" placeholder="مثال: سماعة بلوتوث لاسلكية">
        <div class="grid-equal">
          <div>
            <label>كود المنتج (SKU)</label>
            <input type="text" name="sku" required value="${esc(p.sku)}" placeholder="101-BT">
          </div>
          <div>
            <label>الفئة</label>
            <input type="text" name="cat" value="${esc(p.cat)}" placeholder="إلكترونيات">
          </div>
        </div>
        <div class="grid-equal">
          <div>
            <label>سعر البيع (ج.م)</label>
            <input type="number" step="0.01" name="price" required value="${esc(p.price)}">
          </div>
          <div>
            <label>تكلفة الشراء (ج.م)</label>
            <input type="number" step="0.01" name="cost" required value="${esc(p.cost)}">
          </div>
        </div>
        <label>الكمية المتاحة بالمخزون</label>
        <input type="number" name="stock" required value="${esc(p.stock)}">
        <label>المنصات المنشور عليها المنتج</label>
        <div class="row-wrap" style="gap:14px;margin:8px 0 18px">
          <label style="display:inline-flex;align-items:center;gap:6px"><input type="checkbox" name="mk_a" ${p.markets.includes('a') ? 'checked' : ''} style="width:auto;margin:0"> أمازون مصر</label>
          <label style="display:inline-flex;align-items:center;gap:6px"><input type="checkbox" name="mk_n" ${p.markets.includes('n') ? 'checked' : ''} style="width:auto;margin:0"> نون مصر</label>
          <label style="display:inline-flex;align-items:center;gap:6px"><input type="checkbox" name="mk_j" ${p.markets.includes('j') ? 'checked' : ''} style="width:auto;margin:0"> جوميا</label>
        </div>
        <button type="submit" class="btn" style="width:100%">${isEdit ? 'حفظ التعديلات' : 'إضافة المنتج'}</button>
      </form>
    `);
  }

  function showNewOrderModal() {
    if (!state.products.length) {
      toast('أضف منتجًا واحدًا على الأقل في الكتالوج قبل تسجيل طلب جديد');
      return;
    }
    openDialog('تسجيل طلب جديد وخصم المخزون تلقائيًا', `
      <form id="new-order-form">
        <div class="grid-equal">
          <div>
            <label>منصة البيع</label>
            <select name="market">
              <option value="a">أمازون مصر</option>
              <option value="n">نون مصر</option>
              <option value="j">جوميا</option>
            </select>
          </div>
          <div>
            <label>المحافظة</label>
            <select name="gov">
              ${GOVS.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="grid-equal">
          <div>
            <label>اسم العميل</label>
            <input type="text" name="customer" required placeholder="أحمد محمد علي">
          </div>
          <div>
            <label>موبايل العميل (اختياري)</label>
            <input type="tel" name="phone" placeholder="01012345678">
          </div>
        </div>
        <div class="grid-equal">
          <div>
            <label>المنتج</label>
            <select name="productId">
              ${state.products.map((p) => `<option value="${p.id}">${esc(p.name)} (${egp(p.price)} — متاح ${p.stock})</option>`).join('')}
            </select>
          </div>
          <div>
            <label>الكمية</label>
            <input type="number" name="qty" min="1" max="99" value="1" required>
          </div>
        </div>
        <div class="grid-equal">
          <div>
            <label>طريقة الدفع</label>
            <select name="pay">
              ${PAYMENTS.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label>شركة الشحن</label>
            <select name="courier">
              ${COURIERS.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
            </select>
          </div>
        </div>
        <button type="submit" class="btn" style="width:100%">تأكيد الطلب وخصم المخزون</button>
      </form>
    `);
  }

  // =========================================================================
  // معالجات الأحداث والنقرات (Event Delegation)
  // =========================================================================
  document.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-a]');
    if (!btn) return;
    const action = btn.getAttribute('data-a');

    if (action === 'close-dlg') {
      ev.preventDefault();
      closeDialog();
    } else if (action === 'theme') {
      ev.preventDefault();
      applyTheme(state.theme === 'dark' ? 'light' : 'dark');
      render();
    } else if (action === 'open-login') {
      ev.preventDefault();
      showLoginModal();
    } else if (action === 'open-register') {
      ev.preventDefault();
      showRegisterModal();
    } else if (action === 'start-demo') {
      ev.preventDefault();
      try {
        btn.disabled = true;
        const res = await api('POST', '/api/auth/demo');
        if (res.token) setToken(res.token);
        closeDialog();
        toast('مرحبًا بك في الحساب التجريبي لمتجر النور للإلكترونيات');
        await bootstrap();
      } catch (e) {
        toast(e.message);
      } finally {
        btn.disabled = false;
      }
    } else if (action === 'logout') {
      ev.preventDefault();
      try { await api('POST', '/api/auth/logout'); } catch {}
      setToken('');
      state.me = null;
      render();
      toast('تم تسجيل الخروج بنجاح');
    } else if (action === 'tab') {
      ev.preventDefault();
      const tab = btn.getAttribute('data-tab') || 'dash';
      state.tab = tab;
      await loadTabData(tab);
      render();
    } else if (action === 'dash-range') {
      state.dashRange = Number(btn.getAttribute('data-range')) || 30;
      await loadTabData('dash');
      render();
    } else if (action === 'dash-market') {
      state.dashMarket = btn.getAttribute('data-market') || '';
      await loadTabData('dash');
      render();
    } else if (action === 'prod-market') {
      state.prodMarket = btn.getAttribute('data-market') || '';
      render();
    } else if (action === 'prod-low') {
      state.prodLowOnly = !state.prodLowOnly;
      render();
    } else if (action === 'open-product-modal') {
      showProductModal(null);
    } else if (action === 'edit-product') {
      const id = Number(btn.getAttribute('data-id'));
      const p = state.products.find((x) => x.id === id);
      if (p) showProductModal(p);
    } else if (action === 'restock-product') {
      const id = Number(btn.getAttribute('data-id'));
      try {
        const res = await api('POST', `/api/products/${id}/restock`, { qty: 10 });
        state.products = state.products.map((p) => (p.id === id ? res.product : p));
        if (res.counts) state.counts = res.counts;
        toast(`تم تزويد مخزون "${res.product.name}" بـ ١٠ قطع`);
        render();
      } catch (e) {
        toast(e.message);
      }
    } else if (action === 'delete-product') {
      const id = Number(btn.getAttribute('data-id'));
      try {
        const res = await api('DELETE', `/api/products/${id}`);
        state.products = state.products.filter((p) => p.id !== id);
        if (res.counts) state.counts = res.counts;
        if (res.plan) state.plan = res.plan;
        toast('تم حذف المنتج');
        render();
      } catch (e) {
        toast(e.message);
      }
    } else if (action === 'open-new-order') {
      showNewOrderModal();
    } else if (action === 'order-filter-status') {
      state.orderFilter.status = btn.getAttribute('data-status') ?? '';
      state.orderFilter.page = 1;
      await loadTabData('orders');
      render();
    } else if (action === 'order-page') {
      state.orderFilter.page = Number(btn.getAttribute('data-page')) || 1;
      await loadTabData('orders');
      render();
    } else if (action === 'order-status') {
      const id = Number(btn.getAttribute('data-id'));
      const next = Number(btn.getAttribute('data-status'));
      try {
        const res = await api('POST', `/api/orders/${id}/status`, { status: next });
        if (res.counts) state.counts = res.counts;
        if (res.products && res.products.length) {
          const map = new Map(res.products.map((p) => [p.id, p]));
          state.products = state.products.map((p) => map.get(p.id) || p);
        }
        toast('تم تحديث حالة الطلب بنجاح');
        await loadTabData(state.tab);
        render();
      } catch (e) {
        toast(e.message);
      }
    } else if (action === 'ai-order-msg') {
      const orderId = Number(btn.getAttribute('data-id'));
      try {
        btn.disabled = true;
        const res = await api('POST', '/api/ai/order-message', { orderId });
        openDialog('رسالة واتساب جاهزة للعميل', `
          <p class="mu" style="font-size:13px;margin-bottom:8px">انسخ الرسالة التالية وأرسلها للعميل عبر واتساب لتأكيد الموعد وتقليل المرتجعات:</p>
          <textarea rows="5" readonly style="font-size:14px">${esc(res.text)}</textarea>
          <button type="button" class="btn" style="width:100%" data-a="copy-text" data-text="${esc(res.text)}">نسخ الرسالة</button>
        `);
      } catch (e) {
        toast(e.message);
      } finally {
        btn.disabled = false;
      }
    } else if (action === 'copy-text') {
      const txt = btn.getAttribute('data-text') || '';
      navigator.clipboard?.writeText(txt);
      toast('تم نسخ النص إلى الحافظة');
      closeDialog();
    } else if (action === 'cod-payout') {
      const courier = btn.getAttribute('data-courier');
      try {
        btn.disabled = true;
        const res = await api('POST', `/api/cod/${courier}/payout`);
        state.codData = res;
        toast(`تم تحويل ${egp(res.net)} بنجاح إلى ${res.handle}`);
        render();
      } catch (e) {
        toast(e.message);
      } finally {
        btn.disabled = false;
      }
    } else if (action === 'run-advisor') {
      try {
        const chk = document.getElementById('ai-thinking-toggle');
        if (chk) state.aiThinking = chk.checked;
        state.aiLoading = 'advisor';
        render();
        const res = await api('POST', '/api/ai/advisor', { thinking: state.aiThinking });
        state.ai.advisor = res.advisor;
        toast('تم تحديث التحليل المالي والاستراتيجي للمتجر');
      } catch (e) {
        toast(e.message);
      } finally {
        state.aiLoading = '';
        render();
      }
    } else if (action === 'toggle-integration') {
      const key = btn.getAttribute('data-key');
      const cur = Boolean(state.settings?.integrations?.[key]);
      try {
        const res = await api('PUT', '/api/settings/integrations', { key, on: !cur });
        state.settings.integrations = res.integrations;
        toast('تم تحديث حالة ربط القناة');
        render();
      } catch (e) {
        toast(e.message);
      }
    } else if (action === 'toggle-notif') {
      const key = btn.getAttribute('data-key');
      const cur = Boolean(state.settings?.notifications?.[key]);
      try {
        const res = await api('PUT', '/api/settings/notifications', { key, on: !cur });
        state.settings.notifications = res.notifications;
        toast('تم حفظ تفضيلات التنبيهات');
        render();
      } catch (e) {
        toast(e.message);
      }
    } else if (action === 'sync-now') {
      try {
        btn.disabled = true;
        const res = await api('POST', '/api/sync');
        if (state.settings) state.settings.lastSyncAt = res.lastSyncAt;
        toast(res.message || 'تمت مزامنة القنوات بنجاح');
        render();
      } catch (e) {
        toast(e.message);
      } finally {
        btn.disabled = false;
      }
    } else if (action === 'demo-reset') {
      try {
        await api('POST', '/api/demo/reset');
        toast('تمت إعادة ضبط بيانات الحساب التجريبي');
        await bootstrap();
      } catch (e) {
        toast(e.message);
      }
    } else if (action === 'change-plan') {
      const plan = btn.getAttribute('data-plan');
      try {
        const res = await api('POST', '/api/plan', { plan });
        state.plan = res.plan;
        toast(`تم تحديث باقتك إلى ${res.plan.name}`);
        render();
      } catch (e) {
        toast(e.message);
      }
    }
  });

  document.addEventListener('input', (ev) => {
    if (ev.target.id === 'prod-search') {
      state.prodSearch = ev.target.value;
      render();
      const input = document.getElementById('prod-search');
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
  });

  document.addEventListener('change', async (ev) => {
    if (ev.target.id === 'order-search') {
      state.orderFilter.q = ev.target.value;
      state.orderFilter.page = 1;
      await loadTabData('orders');
      render();
    } else if (ev.target.id === 'ai-thinking-toggle') {
      state.aiThinking = ev.target.checked;
    }
  });

  document.addEventListener('submit', async (ev) => {
    const form = ev.target;
    if (form.id === 'login-form') {
      ev.preventDefault();
      const fd = new FormData(form);
      try {
        const res = await api('POST', '/api/auth/login', {
          id: fd.get('id'),
          password: fd.get('password')
        });
        if (res.token) setToken(res.token);
        closeDialog();
        toast('تم تسجيل الدخول بنجاح');
        await bootstrap();
      } catch (e) {
        toast(e.message);
      }
    } else if (form.id === 'register-form') {
      ev.preventDefault();
      const fd = new FormData(form);
      try {
        const res = await api('POST', '/api/auth/register', {
          store: fd.get('store'),
          phone: fd.get('phone'),
          email: fd.get('email') || undefined,
          password: fd.get('password')
        });
        if (res.token) setToken(res.token);
        closeDialog();
        toast('تم إنشاء متجرك بنجاح');
        await bootstrap();
      } catch (e) {
        toast(e.message);
      }
    } else if (form.id === 'product-form') {
      ev.preventDefault();
      const fd = new FormData(form);
      const id = form.getAttribute('data-id');
      const markets = ['a', 'n', 'j'].filter((k) => fd.get(`mk_${k}`)).join('');
      const payload = {
        name: fd.get('name'),
        sku: fd.get('sku'),
        cat: fd.get('cat'),
        price: fd.get('price'),
        cost: fd.get('cost'),
        stock: fd.get('stock'),
        markets
      };
      try {
        if (id) {
          const res = await api('PUT', `/api/products/${id}`, payload);
          state.products = state.products.map((p) => (p.id === Number(id) ? res.product : p));
          if (res.counts) state.counts = res.counts;
          if (res.plan) state.plan = res.plan;
          toast('تم تحديث المنتج بنجاح');
        } else {
          const res = await api('POST', '/api/products', payload);
          state.products.unshift(res.product);
          if (res.counts) state.counts = res.counts;
          if (res.plan) state.plan = res.plan;
          toast('تمت إضافة المنتج إلى الكتالوج');
        }
        closeDialog();
        render();
      } catch (e) {
        toast(e.message);
      }
    } else if (form.id === 'new-order-form') {
      ev.preventDefault();
      const fd = new FormData(form);
      try {
        const res = await api('POST', '/api/orders', {
          market: fd.get('market'),
          gov: fd.get('gov'),
          customer: fd.get('customer'),
          phone: fd.get('phone') || '',
          pay: fd.get('pay'),
          courier: fd.get('courier'),
          items: [{ productId: Number(fd.get('productId')), qty: Number(fd.get('qty')) }]
        });
        if (res.counts) state.counts = res.counts;
        if (res.products && res.products.length) {
          const map = new Map(res.products.map((p) => [p.id, p]));
          state.products = state.products.map((p) => map.get(p.id) || p);
        }
        closeDialog();
        toast(`تم تسجيل الطلب #${res.order.no} وخصم المخزون`);
        await loadTabData(state.tab);
        render();
      } catch (e) {
        toast(e.message);
      }
    } else if (form.id === 'ai-listing-form') {
      ev.preventDefault();
      const fd = new FormData(form);
      try {
        state.aiLoading = 'listing';
        render();
        const res = await api('POST', '/api/ai/listing', {
          name: fd.get('name'),
          features: fd.get('features')
        });
        state.aiListingResult = res.data;
        if (res.notice) toast(res.notice);
        else toast('تم توليد العناوين والوصف التسويقي');
      } catch (e) {
        toast(e.message);
      } finally {
        state.aiLoading = '';
        render();
      }
    } else if (form.id === 'ai-market-form') {
      ev.preventDefault();
      const fd = new FormData(form);
      try {
        state.aiLoading = 'market';
        render();
        const res = await api('POST', '/api/ai/market', { name: fd.get('name') });
        state.ai.market = res.market;
        toast('تم تحديث رادار أسعار السوق المصري');
      } catch (e) {
        toast(e.message);
      } finally {
        state.aiLoading = '';
        render();
      }
    } else if (form.id === 'settings-form') {
      ev.preventDefault();
      const fd = new FormData(form);
      try {
        const res = await api('PUT', '/api/settings', {
          storeName: fd.get('storeName'),
          taxId: fd.get('taxId'),
          instaPayHandle: fd.get('instaPayHandle'),
          storePhone: fd.get('storePhone'),
          storeEmail: fd.get('storeEmail')
        });
        state.settings = res.settings;
        state.me = res.me;
        toast('تم حفظ إعدادات المتجر بنجاح');
        render();
      } catch (e) {
        toast(e.message);
      }
    }
  });

  bootstrap();
})();
