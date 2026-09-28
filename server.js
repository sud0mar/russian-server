require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('node:path');

const auth = require('./modules/auth');
const regionsRouter = require('./modules/regions');
const uploadRouter = require('./modules/upload');
const usersRouter = require('./modules/users');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};

    if (
      typeof username !== 'string' ||
      typeof password !== 'string'
    ) {
      return res.status(400).json({
        error: 'Укажите username и password',
      });
    }

    const { data: user, error } = await auth.supabase
      .from('users')
      .select('id, username, role, password_hash')
      .eq('username', username.trim())
      .maybeSingle();

    if (error) throw error;

    const validPassword =
      user && await auth.verifyPassword(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({
        error: 'Неверный логин или пароль',
      });
    }

    res.json({
      token: auth.createToken(user),
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/me', auth.authMiddleware(), (req, res) => {
  res.json(req.user);
});

app.use('/api/regions', regionsRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/users', usersRouter);

// Не отдаём HTML вместо ошибки при неизвестном API-запросе.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API-маршрут не найден' });
  }

  if (req.method !== 'GET') {
    return res.status(404).json({ error: 'Маршрут не найден' });
  }

  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((error, req, res, next) => {
  console.error(error);

  if (res.headersSent) return next(error);

  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

const server = app.listen(PORT, '0.0.0.0', async (listenError) => {
  if (listenError) {
    console.error('Не удалось запустить сервер:', listenError);
    process.exit(1);
  }

  try {
    await auth.ensureAdminExists();
    console.log(`Сервер запущен на порту ${PORT}`);
  } catch (error) {
    console.error('Ошибка инициализации администратора:', error);
    server.close(() => process.exit(1));
  }
});
