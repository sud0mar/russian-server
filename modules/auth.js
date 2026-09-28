const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

let supabaseClient;

function getSupabase() {
  if (!supabaseClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;

    if (!url || !key) {
      throw new Error(
        'Не заданы SUPABASE_URL и/или SUPABASE_SECRET_KEY'
      );
    }

    supabaseClient = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return supabaseClient;
}

function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function createToken(user) {
  if (!process.env.JWT_SECRET) {
    throw new Error('Не задан JWT_SECRET');
  }

  return jwt.sign(
    { username: user.username, role: user.role },
    process.env.JWT_SECRET,
    {
      subject: String(user.id),
      expiresIn: '7d',
      algorithm: 'HS256',
    }
  );
}

function authMiddleware(allowedRoles = []) {
  return async (req, res, next) => {
    const match = /^Bearer\s+(.+)$/i.exec(
      req.headers.authorization || ''
    );

    if (!match) {
      return res.status(401).json({ error: 'Требуется токен' });
    }

    let payload;

    try {
      payload = jwt.verify(match[1], process.env.JWT_SECRET, {
        algorithms: ['HS256'],
      });
    } catch {
      return res.status(401).json({ error: 'Недействительный токен' });
    }

    try {
      // Читаем роль из базы при каждом запросе: удаление пользователя
      // или изменение его роли сработает без ожидания окончания JWT.
      const { data: user, error } = await getSupabase()
        .from('users')
        .select('id, username, role')
        .eq('id', payload.sub)
        .maybeSingle();

      if (error) throw error;

      if (!user) {
        return res.status(401).json({ error: 'Пользователь не найден' });
      }

      if (allowedRoles.length && !allowedRoles.includes(user.role)) {
        return res.status(403).json({ error: 'Недостаточно прав' });
      }

      req.user = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}

async function ensureAdminExists() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password || !process.env.JWT_SECRET) {
    throw new Error(
      'Задайте ADMIN_USERNAME, ADMIN_PASSWORD и JWT_SECRET'
    );
  }

  const { data: existing, error: lookupError } = await getSupabase()
    .from('users')
    .select('id, role')
    .eq('username', username)
    .maybeSingle();

  if (lookupError) throw lookupError;

  if (existing) {
    if (existing.role !== 'admin') {
      throw new Error(
        'Имя ADMIN_USERNAME занято пользователем без роли admin'
      );
    }
    return;
  }

  const password_hash = await hashPassword(password);

  const { error: insertError } = await getSupabase()
    .from('users')
    .insert({
      username,
      password_hash,
      role: 'admin',
    });

  if (insertError) throw insertError;

  console.log('Первый администратор создан');
}

module.exports = {
  get supabase() {
    return getSupabase();
  },
  hashPassword,
  verifyPassword,
  createToken,
  authMiddleware,
  ensureAdminExists,
};
