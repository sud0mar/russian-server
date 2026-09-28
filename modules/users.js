const express = require('express');
const auth = require('./auth');

const router = express.Router();
const ALLOWED_ROLES = new Set(['admin', 'editor', 'viewer']);

router.use(auth.authMiddleware(['admin']));

router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await auth.supabase
      .from('users')
      .select('id, username, role, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { username, password, role } = req.body || {};
    const cleanUsername =
      typeof username === 'string' ? username.trim() : '';

    if (
      !/^[a-zA-Z0-9_-]{3,32}$/.test(cleanUsername) ||
      typeof password !== 'string' ||
      password.length < 8 ||
      !ALLOWED_ROLES.has(role)
    ) {
      return res.status(400).json({
        error: 'Проверьте username, пароль (от 8 символов) и роль',
      });
    }

    const password_hash = await auth.hashPassword(password);

    const { data, error } = await auth.supabase
      .from('users')
      .insert({
        username: cleanUsername,
        password_hash,
        role,
      })
      .select('id, username, role, created_at')
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({
          error: 'Такой username уже существует',
        });
      }
      throw error;
    }

    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    if (req.params.id === String(req.user.id)) {
      return res.status(400).json({
        error: 'Нельзя удалить собственную учётную запись',
      });
    }

    const { data: target, error: lookupError } = await auth.supabase
      .from('users')
      .select('id, role')
      .eq('id', req.params.id)
      .maybeSingle();

    if (lookupError) throw lookupError;

    if (!target) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    if (target.role === 'admin') {
      const { count, error: countError } = await auth.supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin');

      if (countError) throw countError;

      if (count <= 1) {
        return res.status(400).json({
          error: 'Нельзя удалить последнего администратора',
        });
      }
    }

    const { error } = await auth.supabase
      .from('users')
      .delete()
      .eq('id', target.id);

    if (error) throw error;

    res.json({ message: 'Пользователь удалён' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
