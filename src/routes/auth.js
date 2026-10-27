'use strict';

const crypto = require('node:crypto');
const { hashPassword, verifyPassword } = require('../auth');
const { HttpError, text, phone, email, password, clean, nowIso } = require('../util');
const { seedDemo } = require('../seed');

module.exports = (r, app) => {
  const { q, cfg, limiter, session, model } = app;

  r.post('/api/auth/register', async ({ body, res, ip }) => {
    if (!limiter.hit(`reg:${ip}`, 10, 600_000)) {
      throw new HttpError(429, 'طلبات كثيرة، حاول بعد قليل');
    }
    const store = text(body.store, 'اسم المتجر', { min: 2, max: 60 });
    const ph = phone(body.phone);
    const em = email(body.email);
    const pw = password(body.password, ph);

    if (q('SELECT 1 FROM users WHERE phone = ?').get(ph)) {
      throw new HttpError(409, 'رقم الموبايل مسجل بالفعل، سجّل الدخول بدلًا من ذلك');
    }
    if (em && q('SELECT 1 FROM users WHERE email = ?').get(em)) {
      throw new HttpError(409, 'البريد الإلكتروني مسجل بالفعل');
    }

    const hash = await hashPassword(pw);
    const now = nowIso();
    const id = q(
      'INSERT INTO users (phone, email, pass_hash, store_name, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(ph, em, hash, store, now).lastInsertRowid;

    const user = q('SELECT * FROM users WHERE id = ?').get(id);
    const token = session.issue(res, user);
    return { me: model.meOf(user), token };
  }, { auth: false });

  r.post('/api/auth/login', async ({ body, res, ip }) => {
    const rawId = clean(body.id);
    if (!rawId) throw new HttpError(400, 'أدخل رقم الموبايل أو البريد الإلكتروني');
    const pw = String(body.password ?? '');
    if (!pw) throw new HttpError(400, 'أدخل كلمة المرور');

    if (!limiter.hit(`login:${ip}`, 8, 600_000)) {
      throw new HttpError(429, 'محاولات دخول كثيرة، انتظر قليلًا ثم حاول مجددًا');
    }

    let user = null;
    if (rawId.includes('@')) {
      user = q('SELECT * FROM users WHERE email = ?').get(rawId.toLowerCase());
    } else {
      try {
        const ph = phone(rawId);
        user = q('SELECT * FROM users WHERE phone = ?').get(ph);
      } catch {
        user = null;
      }
    }

    if (!user || user.is_demo || !(await verifyPassword(pw, user.pass_hash))) {
      throw new HttpError(401, 'بيانات الدخول غير صحيحة');
    }

    limiter.reset(`login:${ip}`);
    const token = session.issue(res, user);
    return { me: model.meOf(user), token };
  }, { auth: false });

  r.post('/api/auth/demo', ({ res, ip }) => {
    if (!limiter.hit(`demo:${ip}`, 15, 600_000)) {
      throw new HttpError(429, 'طلبات كثيرة، حاول بعد قليل');
    }
    const demoCount = q('SELECT COUNT(*) n FROM users WHERE is_demo = 1').get().n;
    if (demoCount >= cfg.maxDemos) {
      const oldest = q('SELECT id FROM users WHERE is_demo = 1 ORDER BY created_at ASC LIMIT 1').get();
      if (oldest) q('DELETE FROM users WHERE id = ?').run(oldest.id);
    }

    const demoPhone = `demo-${crypto.randomBytes(6).toString('hex')}`;
    const now = nowIso();
    const integrations = JSON.stringify({ a: 1, n: 1, j: 1, bs: 1, ar: 1, my: 0, fw: 1, vc: 1, eta: 1 });
    const id = q(
      `INSERT INTO users (phone, pass_hash, store_name, tax_id, instapay, plan, is_demo, integrations, created_at)
       VALUES (?, '!', 'متجر النور للإلكترونيات', '412-890-115', 'elnoor.store@instapay', 'pro', 1, ?, ?)`
    ).run(demoPhone, integrations, now).lastInsertRowid;

    seedDemo(app, Number(id));
    const user = q('SELECT * FROM users WHERE id = ?').get(id);
    const token = session.issue(res, user);
    return { me: model.meOf(user), token };
  }, { auth: false });

  r.post('/api/auth/logout', ({ res }) => {
    session.clear(res);
    return { ok: true };
  }, { auth: false });

  r.get('/api/auth/me', ({ user }) => ({
    me: model.meOf(user)
  }));
};
