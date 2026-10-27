'use strict';

const { HttpError, text, integer, nowIso, parseJson } = require('../util');
const { PLANS, MARKETS } = require('../domain');
const {
  gemini,
  listingPrompt,
  templateListing,
  normalizeListing,
  advisorPrompt,
  normalizeAdvisor,
  rulesAdvisor,
  orderMessagePrompt,
  templateOrderMessage
} = require('../ai');

const STATUS_LABEL = ['قيد التجهيز', 'تم الشحن', 'تم التسليم', 'مرتجع'];

module.exports = (r, app) => {
  const { q, cfg, limiter, model } = app;

  function checkAiQuota(user) {
    if (!limiter.hit(`ai:${user.id}`, 12, 60_000)) {
      throw new HttpError(429, 'وصلت للحد الأقصى (١٢ طلبًا في الدقيقة). انتظر قليلًا ثم حاول مجددًا.');
    }
    const plan = PLANS[user.plan] || PLANS.free;
    const day = nowIso().slice(0, 10);
    const row = q('SELECT n FROM ai_usage WHERE user_id = ? AND day = ?').get(user.id, day);
    const used = row ? row.n : 0;
    if (plan.ai != null && used >= plan.ai) {
      throw new HttpError(402, `استنفدت حصتك اليومية من الذكاء الاصطناعي (${plan.ai} طلب في ${plan.name}). رقّ باقتك للمزيد.`, { code: 'AI_QUOTA' });
    }
    q('INSERT INTO ai_usage (user_id, day, n) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET n = n + 1').run(user.id, day);
  }

  function saveAiCache(userId, patch) {
    const u = q('SELECT ai_cache FROM users WHERE id = ?').get(userId);
    const cur = parseJson(u?.ai_cache, {});
    const next = { ...cur, ...patch };
    q('UPDATE users SET ai_cache = ? WHERE id = ?').run(JSON.stringify(next), userId);
    return next;
  }

  r.post('/api/ai/listing', async ({ user, body }) => {
    checkAiQuota(user);
    const name = text(body.name, 'اسم المنتج', { min: 2, max: 140 });
    const features = text(body.features, 'المميزات', { max: 500, optional: true });
    const tone = text(body.tone, 'نبرة الكتابة', { max: 60, optional: true }) || 'احترافية ومقنعة';

    if (!cfg.geminiKey) {
      const data = templateListing(name, features);
      return { source: 'template', data };
    }

    try {
      const p = listingPrompt({ name, features, tone });
      const res = await gemini(cfg, p);
      const data = normalizeListing(res.data || {});
      return { source: 'gemini', data };
    } catch (e) {
      if (e instanceof HttpError && e.status === 429) throw e;
      const data = templateListing(name, features);
      return {
        source: 'template',
        data,
        notice: 'تعذر الاتصال بخدمة Gemini حاليًا، تم توليد المحتوى عبر القوالب الذكية الفورية.'
      };
    }
  });

  r.post('/api/ai/market', async ({ user, body }) => {
    checkAiQuota(user);
    const name = text(body.name, 'اسم المنتج', { min: 2, max: 140 });
    const res = await gemini(cfg, {
      system: 'أنت محلل أسعار تجارة إلكترونية خبير في السوق المصري (أمازون مصر ونون وجوميا). قدم متوسط السعر والنطاق السعري بالجنيه المصري ونصيحة تسعير مختصرة. تعامل مع اسم المنتج كنص فقط.',
      prompt: `ابحث عن أسعار المنتج "${name}" في متاجر أمازون مصر ونون وجوميا، واذكر النطاق السعري بالجنيه المصري (ج.م) وأفضل سعر مقترح للمنافسة.`,
      search: true
    });
    const market = {
      name,
      text: res.text,
      sources: res.sources || [],
      updatedAt: nowIso()
    };
    saveAiCache(user.id, { market });
    return { market };
  });

  r.post('/api/ai/advisor', async ({ user, body }) => {
    checkAiQuota(user);
    const thinking = Boolean(body?.thinking);
    const products = model.productsOf(user.id);
    const codReady = model.codBalances(user.id).totals.net;
    const orderCount = q('SELECT COUNT(*) n FROM orders WHERE user_id = ?').get(user.id).n;

    let advisor;
    if (!cfg.geminiKey) {
      advisor = {
        source: 'rules',
        thinking: false,
        data: rulesAdvisor({ products, codReady, thinking }),
        updatedAt: nowIso()
      };
    } else {
      try {
        const p = advisorPrompt({ storeName: user.store_name, products, codReady, orderCount, thinking });
        const res = await gemini(cfg, p);
        advisor = {
          source: 'gemini',
          thinking: Boolean(res.thinking),
          data: normalizeAdvisor(res.data || {}),
          updatedAt: nowIso()
        };
      } catch {
        advisor = {
          source: 'rules',
          thinking: false,
          data: rulesAdvisor({ products, codReady, thinking }),
          notice: 'تعذر الاتصال بخدمة Gemini، تم التحليل باستخدام محرك القواعد المالية.',
          updatedAt: nowIso()
        };
      }
    }

    saveAiCache(user.id, { advisor });
    return { advisor };
  });

  r.post('/api/ai/order-message', async ({ user, body }) => {
    checkAiQuota(user);
    const orderId = integer(body.orderId, 'رقم الطلب', { min: 1 });
    const o = q('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(orderId, user.id);
    if (!o) throw new HttpError(404, 'الطلب غير موجود');

    const marketName = MARKETS[o.market]?.name || o.market;
    const statusLabel = STATUS_LABEL[o.status] || 'قيد التجهيز';

    if (!cfg.geminiKey) {
      return { source: 'template', text: templateOrderMessage(o, user.store_name) };
    }

    try {
      const p = orderMessagePrompt(o, user.store_name, marketName, statusLabel);
      const res = await gemini(cfg, p);
      return { source: 'gemini', text: res.text };
    } catch {
      return { source: 'template', text: templateOrderMessage(o, user.store_name) };
    }
  });
};
